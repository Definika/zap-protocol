//! Time-based accrual. Rates are piecewise-constant: every instruction that changes utilization or open interest
//! accrues first (at the old rate), applies its change, then recomputes the rate.

use anchor_lang::prelude::*;
use zap_math::{borrow, fixed, funding, RATE_ONE};

use crate::error::{MathResultExt, ZapError};
use crate::state::{ConfigParams, Market, Pool};

/// Advance the pool-wide borrow index to `now` at the rate implied by current utilization.
pub fn accrue_borrow(pool: &mut Pool, params: &ConfigParams, now: i64) -> Result<()> {
    let dt = now - pool.borrow_last_ts;
    if dt <= 0 {
        return Ok(());
    }
    let util = borrow::utilization_bps(pool.reserved, pool.assets).m()?;
    let apr = borrow::borrow_apr_bps(
        util,
        u32::from(params.borrow_kink_util_bps),
        u32::from(params.borrow_kink_apr_bps),
        u32::from(params.borrow_max_apr_bps),
    )
    .m()?;
    let rate = borrow::rate_per_sec(apr).m()?;
    let index = borrow::accrue(pool.borrow_index.get(), rate, dt as u64).m()?;
    pool.borrow_index.set(index);
    pool.borrow_last_ts = now;
    Ok(())
}

/// Advance both funding indices to `now` at the stored rate, and record the vault's net funding.
pub fn accrue_funding(market: &mut Market, now: i64) -> Result<()> {
    let dt = now - market.last_accrual_ts;
    if dt <= 0 {
        return Ok(());
    }
    let rate = market.funding_rate.get();
    let (long, short) =
        funding::accrue(market.funding_index_long.get(), market.funding_index_short.get(), rate, dt as u64).m()?;
    market.funding_index_long.set(long);
    market.funding_index_short.set(short);
    // The crowded side pays `rate` and the light side receives it, so the vault nets rate · (OI_L − OI_S) · dt.
    let step = rate.checked_mul(dt as i128).ok_or(error!(ZapError::MathOverflow))?;
    let imbalance = i128::from(market.oi_long) - i128::from(market.oi_short);
    let signed = if step < 0 { -imbalance } else { imbalance };
    let net = fixed::mul_div_signed(signed, step.unsigned_abs(), RATE_ONE, fixed::Round::Down).m()?;
    market.cum_funding_net = market.cum_funding_net.saturating_add(net as i64);
    market.last_accrual_ts = now;
    Ok(())
}

/// Recompute the funding rate from current open interest. Call after every open-interest change.
pub fn refresh_funding_rate(market: &mut Market, params: &ConfigParams) -> Result<()> {
    let rate = funding::rate_per_sec(market.oi_long, market.oi_short, u128::from(params.funding_max_hourly)).m()?;
    market.funding_rate.set(rate);
    Ok(())
}
