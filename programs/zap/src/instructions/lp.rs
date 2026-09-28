use anchor_lang::prelude::*;
use zap_math::{fees, fixed, vault};

use crate::constants::*;
use crate::error::{MathResultExt, ZapError};
use crate::logic::{accrue, nav};
use crate::oracle;
use crate::state::{Config, Market, Pool, TradingAccount};

#[derive(Accounts)]
pub struct Lp<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub account: AccountLoader<'info, TradingAccount>,
    /// CHECK: Pyth Pro storage; checked in `oracle::trust` when signers come from it.
    pub pyth_storage: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (address-checked).
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    // remaining accounts: every listed market, writable, in index order
}

#[event]
pub struct LpDeposited {
    pub account: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub shares: u64,
    pub nav: u64,
    pub lp_supply_after: u64,
    pub pool_seq: u64,
}

#[event]
pub struct LpWithdrawn {
    pub account: Pubkey,
    pub owner: Pubkey,
    pub shares: u64,
    pub amount: u64,
    pub fee: u64,
    pub nav: u64,
    pub lp_supply_after: u64,
    pub pool_seq: u64,
}

/// Accrues every market and returns the vault NAV at the verified prices. Markets without open interest need no price.
fn accrue_and_nav<'info>(
    ctx: &Context<'info, Lp<'info>>,
    pool: &mut Pool,
    price_msg: &[u8],
    now: i64,
) -> Result<u128> {
    let params = ctx.accounts.config.params;
    let prices = oracle::verify(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.pyth_storage.to_account_info(),
        &params,
        price_msg,
        now,
    )?;
    require!(ctx.remaining_accounts.len() == usize::from(pool.num_markets), ZapError::MissingMarkets);
    accrue::accrue_borrow(pool, &params, now)?;
    let mut value = 0i128;
    for (i, info) in ctx.remaining_accounts.iter().enumerate() {
        require!(info.is_writable, ZapError::WrongMarket);
        let loader = AccountLoader::<Market>::try_from(info)?;
        let mut market = loader.load_mut()?;
        require!(usize::from(market.index) == i, ZapError::MissingMarkets);
        accrue::accrue_funding(&mut market, now)?;
        if market.oi_long == 0 && market.oi_short == 0 {
            continue;
        }
        let p = prices.for_market(&market, &params)?;
        oracle::apply_watermark(&mut market, &p, params.price_grace_ms)?;
        value += nav::market_value(&market, p.price)?;
    }
    nav::nav(pool, &params, value)
}

/// Deposits free balance into the vault at the current NAV per share.
pub fn lp_deposit<'info>(ctx: Context<'info, Lp<'info>>, price_msg: Vec<u8>, amount: u64) -> Result<()> {
    require!(amount > 0, ZapError::ZeroAmount);
    let params = ctx.accounts.config.params;
    require!(!params.lp_paused, ZapError::LpPaused);
    let now = Clock::get()?.unix_timestamp;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let nav = accrue_and_nav(&ctx, &mut pool, &price_msg, now)?;

    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    require!(acct.balance >= amount, ZapError::InsufficientBalance);
    let shares = fixed::to_u64(vault::shares_for_deposit(amount, u128::from(pool.lp_supply), nav).m()?).m()?;
    require!(shares > 0, ZapError::ZeroAmount);

    acct.balance -= amount;
    acct.lp_shares += shares;
    acct.lp_cost_basis = acct.lp_cost_basis.saturating_add(amount);
    acct.lp_last_deposit_ts = now;
    acct.seq += 1;
    pool.assets = pool.assets.checked_add(amount).ok_or(error!(ZapError::MathOverflow))?;
    pool.lp_supply += shares;

    emit!(LpDeposited {
        account: ctx.accounts.account.key(),
        owner: acct.owner,
        amount,
        shares,
        nav: nav as u64,
        lp_supply_after: pool.lp_supply,
        pool_seq: pool.next_seq(),
    });
    Ok(())
}

/// Burns LP shares for USDC at the current NAV per share (minus the optional LP fee, which stays in the vault).
/// Limited to liquidity not reserved for open positions.
pub fn lp_withdraw<'info>(ctx: Context<'info, Lp<'info>>, price_msg: Vec<u8>, shares: u64) -> Result<()> {
    require!(shares > 0, ZapError::ZeroAmount);
    let params = ctx.accounts.config.params;
    require!(!params.lp_paused, ZapError::LpPaused);
    let now = Clock::get()?.unix_timestamp;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let nav = accrue_and_nav(&ctx, &mut pool, &price_msg, now)?;

    let mut acct = ctx.accounts.account.load_mut()?;
    acct.authorize(&ctx.accounts.signer.key(), now, true)?;
    require!(acct.lp_shares >= shares, ZapError::InsufficientBalance);
    require!(
        now >= acct.lp_last_deposit_ts + i64::from(params.lp_cooldown_s),
        ZapError::LpCooldown
    );
    let amount = fixed::to_u64(vault::assets_for_shares(u128::from(shares), u128::from(pool.lp_supply), nav).m()?).m()?;
    let fee = fixed::to_u64(fees::bps_of(u128::from(amount), params.lp_fee_bps, fixed::Round::Up).m()?).m()?;
    let net = amount - fee;
    require!(net <= pool.assets.saturating_sub(pool.reserved), ZapError::WithdrawLimit);

    let basis = fixed::mul_div_floor(u128::from(acct.lp_cost_basis), u128::from(shares), u128::from(acct.lp_shares)).m()?;
    acct.lp_cost_basis -= basis as u64;
    acct.lp_shares -= shares;
    acct.balance = acct.balance.checked_add(net).ok_or(error!(ZapError::MathOverflow))?;
    acct.seq += 1;
    pool.assets -= net;
    pool.lp_supply -= shares;

    emit!(LpWithdrawn {
        account: ctx.accounts.account.key(),
        owner: acct.owner,
        shares,
        amount: net,
        fee,
        nav: nav as u64,
        lp_supply_after: pool.lp_supply,
        pool_seq: pool.next_seq(),
    });
    Ok(())
}
