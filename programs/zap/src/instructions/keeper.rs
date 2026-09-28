use anchor_lang::prelude::*;

use crate::constants::*;
use crate::logic::accrue;
use crate::error::ZapError;
use crate::events::MarketRefreshed;
use crate::oracle;
use crate::state::{Config, Market, Pool};

#[derive(Accounts)]
pub struct RefreshMarkets<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [POOL_SEED], bump = config.pool_bump)]
    pub pool: AccountLoader<'info, Pool>,
    /// CHECK: Pyth Pro storage; checked in `oracle::trust` when signers come from it.
    pub pyth_storage: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (address-checked).
    #[account(address = solana_sdk_ids::sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    // remaining accounts: the markets to refresh (writable), each priced by the message
}

/// Permissionless crank: accrues borrow and funding to now and moves each market's price watermark forward, so idle
/// markets stay current and older prices cannot be replayed against them.
pub fn refresh_markets<'info>(ctx: Context<'info, RefreshMarkets<'info>>, price_msg: Vec<u8>) -> Result<()> {
    let params = ctx.accounts.config.params;
    let now = Clock::get()?.unix_timestamp;
    let prices = oracle::verify(
        &ctx.accounts.instructions.to_account_info(),
        &ctx.accounts.pyth_storage.to_account_info(),
        &params,
        &price_msg,
        now,
    )?;
    require!(!ctx.remaining_accounts.is_empty(), ZapError::MissingMarkets);

    let mut pool = ctx.accounts.pool.load_mut()?;
    accrue::accrue_borrow(&mut pool, &params, now)?;

    for info in ctx.remaining_accounts {
        require!(info.is_writable, ZapError::WrongMarket);
        let loader = AccountLoader::<Market>::try_from(info)?;
        let mut market = loader.load_mut()?;
        let price = prices.for_market(&market, &params)?;
        oracle::apply_watermark(&mut market, &price, params.price_grace_ms)?;
        accrue::accrue_funding(&mut market, now)?;
        accrue::refresh_funding_rate(&mut market, &params)?;
        let pool_seq = pool.next_seq();
        emit!(MarketRefreshed {
            index: market.index,
            price: market.last_price,
            price_ts_us: market.last_price_ts_us,
            funding_rate: market.funding_rate.get(),
            funding_index_long: market.funding_index_long.get(),
            funding_index_short: market.funding_index_short.get(),
            borrow_index: pool.borrow_index.get(),
            pool_seq,
        });
    }
    Ok(())
}
