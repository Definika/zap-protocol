//! Vault NAV: realized assets, plus fees traders owe (borrow, funding), minus traders' unrealized PnL.
//! O(1) per market from per-side aggregates; every market with open interest must be priced.

use anchor_lang::prelude::*;
use zap_math::{fees, fixed, vault, Side};

use crate::error::{MathResultExt, ZapError};
use crate::state::{ConfigParams, Market, Pool};

/// Borrow fees accrued but not yet settled across all positions, net of the protocol share.
pub fn pending_borrow(pool: &Pool, params: &ConfigParams) -> Result<i128> {
    let gross = vault::aggregate_owed(
        pool.borrow_index.get() as i128,
        pool.reserved,
        i128::try_from(pool.sum_size_borrow_entry.get()).map_err(|_| error!(ZapError::MathOverflow))?,
    )
    .m()?
    .max(0);
    let proto = fees::bps_of(gross as u128, params.protocol_fee_share_bps, fixed::Round::Up).m()? as i128;
    Ok(gross - proto)
}

/// A market's contribution to NAV at `price`: funding traders owe the vault minus their unrealized PnL.
pub fn market_value(market: &Market, price: u64) -> Result<i128> {
    let funding = vault::aggregate_owed(market.funding_index_long.get(), market.oi_long, market.sum_sf_long.get())
        .m()?
        + vault::aggregate_owed(market.funding_index_short.get(), market.oi_short, market.sum_sf_short.get()).m()?;
    let upnl = vault::side_upnl(Side::Long, market.oi_long, market.units_long.get(), price).m()?
        + vault::side_upnl(Side::Short, market.oi_short, market.units_short.get(), price).m()?;
    Ok(funding - upnl)
}

pub fn nav(pool: &Pool, params: &ConfigParams, markets_value: i128) -> Result<u128> {
    let nav = i128::from(pool.assets) + pending_borrow(pool, params)? + markets_value;
    Ok(nav.max(0) as u128)
}
