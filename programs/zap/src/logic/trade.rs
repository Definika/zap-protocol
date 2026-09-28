//! Position lifecycle: settlement of accrued fees, opening/increasing, closing/reducing, and health checks.
//!
//! All USDC stays in the custody account; this module only moves value between ledgers: an account's free balance,
//! position collateral, the vault's realized assets and the protocol's fee share. The custody invariant is
//! `custody == Σ balance + Σ collateral + Σ order escrow + pool.assets + pool.protocol_fees`.

use anchor_lang::prelude::*;
use zap_math::{fees, fixed, position as pm, price, Side, FRAC_ONE};

use crate::constants::{side, slot_status};
use crate::error::{MathResultExt, ZapError};
use crate::oracle::MarketPrice;
use crate::state::{ConfigParams, Market, Pool, Position};

pub fn math_side(s: u8) -> Result<Side> {
    match s {
        side::LONG => Ok(Side::Long),
        side::SHORT => Ok(Side::Short),
        _ => err!(ZapError::InvalidParams),
    }
}

fn funding_index(market: &Market, s: u8) -> i128 {
    if s == side::LONG {
        market.funding_index_long.get()
    } else {
        market.funding_index_short.get()
    }
}

/// Splits a fee between the vault and the protocol treasury.
pub fn credit_fee(pool: &mut Pool, amount: u64, protocol_share_bps: u16) -> Result<()> {
    let proto = fixed::to_u64(fees::bps_of(u128::from(amount), protocol_share_bps, fixed::Round::Down).m()?).m()?;
    pool.protocol_fees = pool.protocol_fees.checked_add(proto).ok_or(error!(ZapError::MathOverflow))?;
    pool.assets = pool.assets.checked_add(amount - proto).ok_or(error!(ZapError::MathOverflow))?;
    Ok(())
}

/// Adds (or removes, with negative `v`) a signed amount to the vault's realized assets.
pub fn add_assets(pool: &mut Pool, v: i128) -> Result<()> {
    let next = i128::from(pool.assets).checked_add(v).ok_or(error!(ZapError::MathOverflow))?;
    pool.assets = u64::try_from(next).map_err(|_| error!(ZapError::MathOverflow))?;
    Ok(())
}

/// Accrued borrow and funding since the position's last settlement.
#[derive(Clone, Copy, Debug, Default)]
pub struct Owed {
    pub borrow: u64,
    /// Positive: the position pays; negative: it receives.
    pub funding: i128,
}

impl Owed {
    pub fn total(&self) -> i128 {
        i128::from(self.borrow) + self.funding
    }
}

pub fn owed(pos: &Position, market: &Market, pool: &Pool) -> Result<Owed> {
    let borrow = pm::owed(pos.size_usd, pool.borrow_index.get() as i128, pos.entry_borrow_index.get() as i128).m()?;
    let funding =
        pm::owed(pos.size_usd, funding_index(market, pos.side), pos.entry_funding_index.get()).m()?;
    Ok(Owed { borrow: u64::try_from(borrow.max(0)).map_err(|_| error!(ZapError::MathOverflow))?, funding })
}

/// Moves a position's entry indices (and the aggregates that mirror them) to the current indices.
fn reset_entries(pos: &mut Position, market: &mut Market, pool: &mut Pool) -> Result<()> {
    let s = i128::from(pos.size_usd);
    let (b_old, b_now) = (pos.entry_borrow_index.get(), pool.borrow_index.get());
    let (f_old, f_now) = (pos.entry_funding_index.get(), funding_index(market, pos.side));
    let sb = pool.sum_size_borrow_entry.get() as i128 - s * b_old as i128 + s * b_now as i128;
    pool.sum_size_borrow_entry.set(u128::try_from(sb).map_err(|_| error!(ZapError::MathOverflow))?);
    let sum_sf = if pos.side == side::LONG { &mut market.sum_sf_long } else { &mut market.sum_sf_short };
    sum_sf.set(sum_sf.get() - s * f_old + s * f_now);
    pos.entry_borrow_index.set(b_now);
    pos.entry_funding_index.set(f_now);
    Ok(())
}

/// Settles accrued borrow and funding into the position's collateral: borrow goes to the vault (minus the protocol
/// share), funding goes to or comes from the vault. Fails if the position can't cover it (it should be liquidated).
pub fn settle(pos: &mut Position, market: &mut Market, pool: &mut Pool, params: &ConfigParams) -> Result<Owed> {
    let o = owed(pos, market, pool)?;
    let c = i128::from(pos.collateral) - o.total();
    require!(c >= 0, ZapError::WouldBeLiquidatable);
    pos.collateral = c as u64;
    credit_fee(pool, o.borrow, params.protocol_fee_share_bps)?;
    add_assets(pool, o.funding)?;
    pool.cum_borrow_fees = pool.cum_borrow_fees.saturating_add(o.borrow);
    reset_entries(pos, market, pool)?;
    Ok(o)
}

/// Half-spread and impact for a trade of `size` on `side` (buys: open long / close short).
pub struct Fill {
    pub price: u64,
    pub spread: u128,
    pub impact: u128,
}

pub fn fill(market: &Market, p: &MarketPrice, size: u64, is_buy: bool) -> Result<Fill> {
    let prm = &market.params;
    let spread = price::spread_frac(p.price, p.conf, u128::from(prm.min_spread_frac), prm.conf_mult_bps).m()?;
    let skew = i128::from(market.oi_long) - i128::from(market.oi_short);
    let delta = if is_buy { i128::from(size) } else { -i128::from(size) };
    let impact = price::impact_frac(skew, delta, prm.impact_depth_usd, prm.impact_cap_bps).m()?;
    let price = price::fill_price(p.price, spread, impact, is_buy).m()?;
    Ok(Fill { price, spread, impact })
}

/// Cost of a fraction of `size`, rounded up (for the spread/impact earnings breakdown).
pub fn frac_cost(size: u64, frac: u128) -> Result<u64> {
    fixed::to_u64(fixed::mul_div_ceil(u128::from(size), frac, FRAC_ONE).m()?).m()
}

pub fn check_slippage(fill_price: u64, acceptable: u64, is_buy: bool) -> Result<()> {
    if acceptable != 0 {
        let ok = if is_buy { fill_price <= acceptable } else { fill_price >= acceptable };
        require!(ok, ZapError::Slippage);
    }
    Ok(())
}

/// Position equity at the oracle (mid) price, net of the fee to close it. Owed fees are assumed already settled.
pub fn equity_at(pos: &Position, market: &Market, mid: u64) -> Result<i128> {
    let s = math_side(pos.side)?;
    let pnl = pm::pnl(s, pos.size_usd, pos.units.get(), mid).m()?;
    let close_fee = fees::close_fee(pos.units.get(), mid, market.params.close_fee_bps).m()?;
    pm::equity(pos.collateral, pnl, 0, close_fee).m()
}

/// Opening checks: leverage and maintenance margin at the mid price, with unrealized profit not counted.
pub fn check_open_health(pos: &Position, market: &Market, mid: u64) -> Result<()> {
    require!(
        pm::leverage_ok(pos.size_usd, pos.collateral, market.params.max_leverage),
        ZapError::MaxLeverage
    );
    let eq = equity_at(pos, market, mid)?;
    let s = math_side(pos.side)?;
    let pnl = pm::pnl(s, pos.size_usd, pos.units.get(), mid).m()?;
    // unrealized profit can't back new risk
    let eq = eq - pnl.max(0);
    let mm = pm::maintenance_margin(pos.size_usd, market.params.mmr_bps).m()?;
    require!(eq > i128::from(mm), ZapError::WouldBeLiquidatable);
    Ok(())
}

/// Caps on new risk: per-side open interest (share of vault assets), vault utilization, and single-position size.
pub fn check_caps(market: &Market, pool: &Pool, params: &ConfigParams, s: u8, pos_size: u64) -> Result<()> {
    let assets = u128::from(pool.assets);
    let (oi, cap) = if s == side::LONG {
        (market.oi_long, market.params.oi_cap_long_bps)
    } else {
        (market.oi_short, market.params.oi_cap_short_bps)
    };
    // Most specific first: a single oversized position says so rather than hitting a pool-wide cap.
    require!(pos_size <= market.params.max_position_usd, ZapError::MaxPosition);
    require!(u128::from(oi) * 10_000 <= assets * u128::from(cap), ZapError::OiCap);
    require!(u128::from(pool.reserved) * 10_000 <= assets * u128::from(params.max_util_bps), ZapError::UtilizationCap);
    Ok(())
}

/// Adds `size` notional holding `units` and `collateral` to a position and to the market and pool aggregates.
/// The position must already be settled (entry indices current).
pub fn add_to_position(pos: &mut Position, market: &mut Market, pool: &mut Pool, size: u64, units: u128, collateral: u64) -> Result<()> {
    let s = i128::from(size);
    pos.size_usd = pos.size_usd.checked_add(size).ok_or(error!(ZapError::MathOverflow))?;
    pos.units.set(pos.units.get().checked_add(units).ok_or(error!(ZapError::MathOverflow))?);
    pos.collateral = pos.collateral.checked_add(collateral).ok_or(error!(ZapError::MathOverflow))?;
    let f = pos.entry_funding_index.get();
    if pos.side == side::LONG {
        market.oi_long += size;
        market.units_long.set(market.units_long.get() + units);
        market.sum_sf_long.set(market.sum_sf_long.get() + s * f);
    } else {
        market.oi_short += size;
        market.units_short.set(market.units_short.get() + units);
        market.sum_sf_short.set(market.sum_sf_short.get() + s * f);
    }
    pool.reserved = pool.reserved.checked_add(size).ok_or(error!(ZapError::MathOverflow))?;
    let sb = pool.sum_size_borrow_entry.get() + u128::from(size) * pos.entry_borrow_index.get();
    pool.sum_size_borrow_entry.set(sb);
    Ok(())
}

/// Removes `size` notional and `units` from a position's aggregates (collateral is handled by the caller).
pub fn remove_from_position(pos: &mut Position, market: &mut Market, pool: &mut Pool, size: u64, units: u128) -> Result<()> {
    let s = i128::from(size);
    pos.size_usd -= size;
    pos.units.set(pos.units.get() - units);
    let f = pos.entry_funding_index.get();
    if pos.side == side::LONG {
        market.oi_long -= size;
        market.units_long.set(market.units_long.get() - units);
        market.sum_sf_long.set(market.sum_sf_long.get() - s * f);
    } else {
        market.oi_short -= size;
        market.units_short.set(market.units_short.get() - units);
        market.sum_sf_short.set(market.sum_sf_short.get() - s * f);
    }
    pool.reserved -= size;
    pool.sum_size_borrow_entry.set(pool.sum_size_borrow_entry.get() - u128::from(size) * pos.entry_borrow_index.get());
    Ok(())
}

/// Units and collateral that belong to closing `size` of a position (the whole position returns everything).
pub fn close_share(pos: &Position, size: u64) -> Result<(u128, u64)> {
    if size >= pos.size_usd {
        return Ok((pos.units.get(), pos.collateral));
    }
    let round = if pos.side == side::LONG { fixed::Round::Down } else { fixed::Round::Up };
    let units = fixed::mul_div(pos.units.get(), u128::from(size), u128::from(pos.size_usd), round).m()?;
    let collateral =
        fixed::to_u64(fixed::mul_div_floor(u128::from(pos.collateral), u128::from(size), u128::from(pos.size_usd)).m()?)
            .m()?;
    Ok((units, collateral))
}

pub fn clear_position(pos: &mut Position) {
    *pos = Position::default();
    pos.status = slot_status::EMPTY;
}
