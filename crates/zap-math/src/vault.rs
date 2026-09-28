//! Vault NAV and LP share accounting.
//!
//! NAV = realized assets + fees traders owe (borrow, funding) − traders' unrealized PnL, all computed in O(1) per market from
//! per-side aggregates (`oi`, `units`, `Σ size·index_entry`). The per-position profit cap and underwater positions are
//! ignored here: the first makes NAV conservative, the second is covered by liquidations.

use crate::fixed::{mul_div, mul_div_signed, to_i128, Round};
use crate::price::value_of;
use crate::{MathError, Result, Side, RATE_ONE};

/// Virtual shares and assets added to both sides of the share price (protects the first depositor from inflation attacks).
pub const VIRTUAL_SHARES: u128 = 1_000_000;
pub const VIRTUAL_ASSETS: u128 = 1_000_000;

/// Traders' aggregate unrealized PnL on one side of a market (a liability of the vault), rounded against the vault.
pub fn side_upnl(side: Side, oi_usd: u64, units: u128, price12: u64) -> Result<i128> {
    let oi = oi_usd as i128;
    Ok(match side {
        Side::Long => to_i128(value_of(units, price12, Round::Up)?)? - oi,
        Side::Short => oi - to_i128(value_of(units, price12, Round::Down)?)?,
    })
}

/// Fees owed to the vault across all positions on an index: `(index · Σsize − Σ size·index_entry) / 1e18`,
/// rounded against the vault. `sum_size_x_entry` is stored unscaled (`size_usd · index`).
pub fn aggregate_owed(index_now: i128, total_size: u64, sum_size_x_entry: i128) -> Result<i128> {
    let gross = index_now
        .checked_mul(total_size as i128)
        .and_then(|g| g.checked_sub(sum_size_x_entry))
        .ok_or(MathError::Overflow)?;
    mul_div_signed(gross, 1, RATE_ONE, Round::Down)
}

/// LP shares minted for depositing `amount` into a vault with `supply` shares and `nav`, rounded down.
pub fn shares_for_deposit(amount: u64, supply: u128, nav: u128) -> Result<u128> {
    mul_div(amount as u128, supply + VIRTUAL_SHARES, nav + VIRTUAL_ASSETS, Round::Down)
}

/// USD paid out for burning `shares`, rounded down.
pub fn assets_for_shares(shares: u128, supply: u128, nav: u128) -> Result<u128> {
    mul_div(shares, nav + VIRTUAL_ASSETS, supply + VIRTUAL_SHARES, Round::Down)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::{owed, pnl};
    use crate::price::units_for;
    use crate::{PRICE_ONE, USD_ONE};

    #[test]
    fn aggregate_upnl_bounds_sum_of_positions() {
        let entries = [(1_000 * USD_ONE, 100 * PRICE_ONE), (2_500 * USD_ONE, 103 * PRICE_ONE + 7), (777, 99 * PRICE_ONE)];
        let exit = 104 * PRICE_ONE + 3;
        let (mut oi, mut units, mut sum) = (0u64, 0u128, 0i128);
        for (s, p) in entries {
            let u = units_for(s, p, true).unwrap();
            oi += s;
            units += u;
            sum += pnl(Side::Long, s, u, exit).unwrap();
        }
        // the aggregate never understates what traders are owed
        assert!(side_upnl(Side::Long, oi, units, exit).unwrap() >= sum);
    }

    #[test]
    fn aggregate_owed_matches_positions() {
        let idx_now: i128 = (RATE_ONE / 50) as i128; // 2%
        let positions = [(1_000 * USD_ONE, 0i128), (400 * USD_ONE, (RATE_ONE / 100) as i128)];
        let total: u64 = positions.iter().map(|p| p.0).sum();
        let sum_entry: i128 = positions.iter().map(|&(s, e)| s as i128 * e).sum();
        let per_position: i128 = positions.iter().map(|&(s, e)| owed(s, idx_now, e).unwrap()).sum();
        let agg = aggregate_owed(idx_now, total, sum_entry).unwrap();
        // 2% of 1000 + 1% of 400 = 24
        assert_eq!(agg, 24 * USD_ONE as i128);
        assert!(agg <= per_position);
    }

    #[test]
    fn shares_round_trip_never_profits() {
        let (supply, nav) = (5_000_000 * USD_ONE as u128, 5_210_000 * USD_ONE as u128);
        for amount in [1, 999, 10 * USD_ONE, 123_456_789] {
            let sh = shares_for_deposit(amount, supply, nav).unwrap();
            let back = assets_for_shares(sh, supply + sh, nav + amount as u128).unwrap();
            assert!(back <= amount as u128);
        }
        // first deposit is 1:1
        assert_eq!(shares_for_deposit(1_000 * USD_ONE, 0, 0).unwrap(), 1_000 * USD_ONE as u128);
    }
}
