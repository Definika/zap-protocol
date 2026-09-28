//! Position PnL, accrued fees, health and liquidation.

use crate::fixed::{mul_div, mul_div_signed, to_i128, to_u64, Round};
use crate::price::value_of;
use crate::{MathError, Result, Side, BPS, RATE_ONE};

/// Fees accrued against an index between entry and now: `size · (now − entry) / 1e18`, rounded against the trader
/// (up when owed, toward zero when received).
pub fn owed(size_usd: u64, index_now: i128, index_entry: i128) -> Result<i128> {
    let delta = index_now.checked_sub(index_entry).ok_or(MathError::Overflow)?;
    mul_div_signed(delta, size_usd as u128, RATE_ONE, Round::Up)
}

/// PnL for closing `size_closed` of entry notional that holds `units_closed`, at `exit_price12` (the close fill price).
/// Rounded against the trader and capped at `+size_closed`: a position can win at most 100% of its size.
pub fn pnl(side: Side, size_closed: u64, units_closed: u128, exit_price12: u64) -> Result<i128> {
    let s = size_closed as i128;
    let raw = match side {
        Side::Long => to_i128(value_of(units_closed, exit_price12, Round::Down)?)? - s,
        Side::Short => s - to_i128(value_of(units_closed, exit_price12, Round::Up)?)?,
    };
    Ok(raw.min(s))
}

/// Maintenance margin requirement `ceil(size · mmr)`.
pub fn maintenance_margin(size_usd: u64, mmr_bps: u16) -> Result<u64> {
    to_u64(mul_div(size_usd as u128, mmr_bps as u128, BPS, Round::Up)?)
}

/// Position equity: collateral + PnL − accrued borrow/funding − the fee to close it.
pub fn equity(collateral: u64, pnl: i128, owed_total: i128, close_fee: u64) -> Result<i128> {
    (collateral as i128)
        .checked_add(pnl)
        .and_then(|e| e.checked_sub(owed_total))
        .and_then(|e| e.checked_sub(close_fee as i128))
        .ok_or(MathError::Overflow)
}

/// Liquidatable when equity has fallen to the maintenance margin or below.
pub fn is_liquidatable(equity: i128, size_usd: u64, mmr_bps: u16) -> Result<bool> {
    Ok(equity <= maintenance_margin(size_usd, mmr_bps)? as i128)
}

/// `size ≤ max_leverage · collateral`.
pub fn leverage_ok(size_usd: u64, collateral: u64, max_leverage: u16) -> bool {
    (size_usd as u128) <= collateral as u128 * max_leverage as u128
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LiquidationSplit {
    pub to_liquidator: u64,
    pub to_vault_fee: u64,
    pub to_trader: u64,
}

/// Splits what is left of a liquidated position (`collateral + pnl − owed`, may be negative):
/// the liquidation fee (`liq_fee_bps` of size, rounded up) goes first to the liquidator (`liquidator_share_bps` of it)
/// and then to the vault; anything left returns to the trader.
pub fn liquidation_split(
    remaining: i128,
    size_usd: u64,
    liq_fee_bps: u16,
    liquidator_share_bps: u16,
) -> Result<LiquidationSplit> {
    let rem = u64::try_from(remaining.max(0)).map_err(|_| MathError::Overflow)?;
    let fee = to_u64(mul_div(size_usd as u128, liq_fee_bps as u128, BPS, Round::Up)?)?;
    let liq_part = to_u64(mul_div(fee as u128, liquidator_share_bps as u128, BPS, Round::Down)?)?;
    let to_liquidator = rem.min(liq_part);
    let to_vault_fee = (rem - to_liquidator).min(fee - liq_part);
    Ok(LiquidationSplit {
        to_liquidator,
        to_vault_fee,
        to_trader: rem - to_liquidator - to_vault_fee,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::price::units_for;
    use crate::{PRICE_ONE, USD_ONE};

    #[test]
    fn long_and_short_pnl() {
        let s = 1_000 * USD_ONE;
        let u = units_for(s, 100 * PRICE_ONE, true).unwrap();
        assert_eq!(pnl(Side::Long, s, u, 110 * PRICE_ONE).unwrap(), 100 * USD_ONE as i128);
        assert_eq!(pnl(Side::Long, s, u, 90 * PRICE_ONE).unwrap(), -(100 * USD_ONE as i128));
        let u = units_for(s, 100 * PRICE_ONE, false).unwrap();
        assert_eq!(pnl(Side::Short, s, u, 90 * PRICE_ONE).unwrap(), 100 * USD_ONE as i128);
        // capped at +100% of size
        let u = units_for(s, 100 * PRICE_ONE, true).unwrap();
        assert_eq!(pnl(Side::Long, s, u, 500 * PRICE_ONE).unwrap(), s as i128);
    }

    #[test]
    fn round_trip_at_same_price_never_profits() {
        for price in [1, 7, 3 * PRICE_ONE + 1, 97_412 * PRICE_ONE + 6] {
            for size in [10 * USD_ONE, 12_345_678, 1_000_000 * USD_ONE] {
                let ul = units_for(size, price, true).unwrap();
                let us = units_for(size, price, false).unwrap();
                assert!(pnl(Side::Long, size, ul, price).unwrap() <= 0);
                assert!(pnl(Side::Short, size, us, price).unwrap() <= 0);
            }
        }
    }

    #[test]
    fn owed_rounds_against_trader() {
        // 1 unit of index on $1 → 1e-12 USD: owed rounds up to 1, received rounds toward zero
        assert_eq!(owed(USD_ONE, 1, 0).unwrap(), 1);
        assert_eq!(owed(USD_ONE, -1, 0).unwrap(), 0);
        // 1% of $1,000
        assert_eq!(owed(1_000 * USD_ONE, (RATE_ONE / 100) as i128, 0).unwrap(), 10 * USD_ONE as i128);
    }

    #[test]
    fn liquidation_boundary() {
        // $10,000 at 100x: $100 collateral, mmr 0.5% = $50
        let s = 10_000 * USD_ONE;
        assert_eq!(maintenance_margin(s, 50).unwrap(), 50 * USD_ONE);
        assert!(is_liquidatable(50 * USD_ONE as i128, s, 50).unwrap());
        assert!(!is_liquidatable(50 * USD_ONE as i128 + 1, s, 50).unwrap());
        assert!(leverage_ok(s, 100 * USD_ONE, 100));
        assert!(!leverage_ok(s + 1, 100 * USD_ONE, 100));
    }

    #[test]
    fn liquidation_split_order() {
        let s = 10_000 * USD_ONE; // fee 0.2% = $20, liquidator half = $10
        let full = liquidation_split(50 * USD_ONE as i128, s, 20, 5_000).unwrap();
        assert_eq!(full, LiquidationSplit { to_liquidator: 10 * USD_ONE, to_vault_fee: 10 * USD_ONE, to_trader: 30 * USD_ONE });
        let short = liquidation_split(15 * USD_ONE as i128, s, 20, 5_000).unwrap();
        assert_eq!(short, LiquidationSplit { to_liquidator: 10 * USD_ONE, to_vault_fee: 5 * USD_ONE, to_trader: 0 });
        let bad_debt = liquidation_split(-5, s, 20, 5_000).unwrap();
        assert_eq!(bad_debt, LiquidationSplit { to_liquidator: 0, to_vault_fee: 0, to_trader: 0 });
    }
}
