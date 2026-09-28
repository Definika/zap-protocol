//! Trading fees. Fees are taken from the trader, so they round up.

use crate::fixed::{mul_div, to_u64, Round};
use crate::price::value_of;
use crate::{Result, BPS};

/// `amount * bps / 1e4`, rounded as asked.
pub fn bps_of(amount: u128, bps: u16, round: Round) -> Result<u128> {
    mul_div(amount, bps as u128, BPS, round)
}

/// Open fee on the notional being opened.
pub fn open_fee(size_usd: u64, fee_bps: u16) -> Result<u64> {
    to_u64(bps_of(size_usd as u128, fee_bps, Round::Up)?)
}

/// Close fee on the current notional of the units being closed, valued at the exit price.
pub fn close_fee(units: u128, exit_price12: u64, fee_bps: u16) -> Result<u64> {
    let notional = value_of(units, exit_price12, Round::Down)?;
    to_u64(bps_of(notional, fee_bps, Round::Up)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::price::units_for;
    use crate::{PRICE_ONE, USD_ONE};

    #[test]
    fn fees_round_up() {
        // 4bp on $1,000 = $0.40
        assert_eq!(open_fee(1_000 * USD_ONE, 4).unwrap(), 400_000);
        // 4bp on $0.000001 still charges 1 unit
        assert_eq!(open_fee(1, 4).unwrap(), 1);
        let units = units_for(1_000 * USD_ONE, 100 * PRICE_ONE, true).unwrap();
        // price doubled: notional $2,000 → 5bp = $1.00
        assert_eq!(close_fee(units, 200 * PRICE_ONE, 5).unwrap(), 1_000_000);
    }
}
