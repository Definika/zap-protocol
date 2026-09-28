use anchor_lang::prelude::*;
use zap_math::{fees, position as pm};

use super::trade::cancel_bound_orders;
use crate::constants::*;
use crate::error::{MathResultExt, ZapError};
use crate::events::{trade_kind, Trade};
use crate::logic::{accrue, trade};
use crate::oracle;
use crate::state::{Config, Market, Pool, TradingAccount};

#[event]
pub struct Liquidated {
    pub account: Pubkey,
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub market: u16,
    pub side: u8,
    pub position_id: u64,
    pub size: u64,
    pub collateral: u64,
    pub oracle_price: u64,
    pub pnl: i64,
    pub owed: i64,
    pub to_liquidator: u64,
    pub to_vault_fee: u64,
    pub to_trader: u64,
    /// Loss beyond the position's collateral, absorbed by the vault.
    pub bad_debt: u64,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub liquidator: Signer<'info>,
    /// The liquidator's own trading account, credited with the liquidation reward.
    #[account(mut, seeds = [ACCOUNT_SEED, liquidator.key().as_ref()], bump)]
    pub liquidator_account: AccountLoader<'info, TradingAccount>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    #[account(mut)]
    pub market: AccountLoader<'info, Market>,
    #[account(mut)]
    pub account: AccountLoader<'info, TradingAccount>,
    /// CHECK: Pyth Pro storage; checked in `oracle::trust` when signers come from it.
    pub pyth_storage: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (address-checked).
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
}

/// Permissionless: closes a position whose equity (collateral + PnL − owed fees − close fee, at the oracle mid price)
/// has fallen to its maintenance margin. The liquidation fee goes to the liquidator and the vault; whatever is left
/// returns to the trader; a shortfall is absorbed by the vault.
pub fn liquidate(ctx: Context<Liquidate>, price_msg: Vec<u8>, side_: u8, position_id: u64) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    require_keys_neq!(ctx.accounts.liquidator_account.key(), ctx.accounts.account.key(), ZapError::Unauthorized);
    let mut market = ctx.accounts.market.load_mut()?;
    let prices = oracle::verify(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.pyth_storage.to_account_info(),
        &params,
        &price_msg,
        now,
    )?;
    let p = prices.for_market(&market, &params)?;
    oracle::apply_watermark(&mut market, &p, params.price_grace_ms)?;
    let mut pool = ctx.accounts.pool.load_mut()?;
    let mut acct = ctx.accounts.account.load_mut()?;
    accrue::accrue_borrow(&mut pool, &params, now)?;
    accrue::accrue_funding(&mut market, now)?;

    let i = acct.find_position(market.index, side_).ok_or(error!(ZapError::PositionNotFound))?;
    let pos = acct.positions[i];
    require!(pos.position_id == position_id, ZapError::IdMismatch);
    require!(p.ts_us >= pos.last_price_ts_us, ZapError::BelowPositionTimestamp);

    let s = trade::math_side(pos.side)?;
    let owed = trade::owed(&pos, &market, &pool)?;
    let pnl = pm::pnl(s, pos.size_usd, pos.units.get(), p.price).m()?;
    let close_fee = fees::close_fee(pos.units.get(), p.price, market.params.close_fee_bps).m()?;
    let equity = pm::equity(pos.collateral, pnl, owed.total(), close_fee).m()?;
    require!(pm::is_liquidatable(equity, pos.size_usd, market.params.mmr_bps).m()?, ZapError::NotLiquidatable);

    let remaining = i128::from(pos.collateral) + pnl - owed.total();
    let split = pm::liquidation_split(remaining, pos.size_usd, params.liq_fee_bps, params.liquidator_share_bps).m()?;
    let bad_debt = (-remaining).max(0) as u64;
    // Everything from the collateral that doesn't go to the liquidator or back to the trader is the vault's:
    // trader losses, owed borrow and funding, and the vault's share of the fee (minus any bad debt).
    let vault_delta = i128::from(pos.collateral) - i128::from(split.to_liquidator) - i128::from(split.to_trader);
    trade::add_assets(&mut pool, vault_delta)?;
    pool.cum_liquidation_fees = pool.cum_liquidation_fees.saturating_add(split.to_liquidator + split.to_vault_fee);
    pool.cum_trader_pnl = pool.cum_trader_pnl.saturating_add(pnl as i64);
    pool.cum_volume = pool.cum_volume.saturating_add(pos.size_usd);
    market.cum_volume = market.cum_volume.saturating_add(pos.size_usd);
    market.trade_seq += 1;

    let size = pos.size_usd;
    let units = pos.units.get();
    trade::remove_from_position(&mut acct.positions[i], &mut market, &mut pool, size, units)?;
    trade::clear_position(&mut acct.positions[i]);
    cancel_bound_orders(&mut acct, position_id);
    acct.balance = acct.balance.checked_add(split.to_trader).ok_or(error!(ZapError::MathOverflow))?;
    acct.realized_pnl = acct.realized_pnl.saturating_add(pnl as i64);
    acct.volume = acct.volume.saturating_add(size);
    acct.seq += 1;
    accrue::refresh_funding_rate(&mut market, &params)?;
    {
        let mut liq = ctx.accounts.liquidator_account.load_mut()?;
        liq.balance = liq.balance.checked_add(split.to_liquidator).ok_or(error!(ZapError::MathOverflow))?;
        liq.seq += 1;
    }

    emit!(Liquidated {
        account: ctx.accounts.account.key(),
        owner: acct.owner,
        liquidator: ctx.accounts.liquidator.key(),
        market: market.index,
        side: side_,
        position_id,
        size,
        collateral: pos.collateral,
        oracle_price: p.price,
        pnl: pnl as i64,
        owed: owed.total() as i64,
        to_liquidator: split.to_liquidator,
        to_vault_fee: split.to_vault_fee,
        to_trader: split.to_trader,
        bad_debt,
    });
    emit!(Trade {
        pool_seq: pool.next_seq(),
        ts: now,
        account: ctx.accounts.account.key(),
        owner: acct.owner,
        market: market.index,
        side: side_,
        kind: trade_kind::LIQUIDATION,
        position_id,
        order_id: 0,
        size_delta: -(size as i64),
        size_after: 0,
        collateral_after: 0,
        oracle_price: p.price,
        fill_price: p.price,
        price_ts_us: p.ts_us,
        open_fee: 0,
        close_fee: split.to_liquidator + split.to_vault_fee,
        spread_cost: 0,
        impact_cost: 0,
        borrow_paid: owed.borrow,
        funding_paid: owed.funding as i64,
        pnl: pnl as i64,
        payout: split.to_trader,
        oi_long_after: market.oi_long,
        oi_short_after: market.oi_short,
    });
    Ok(())
}
