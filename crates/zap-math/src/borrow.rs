//! Borrow fee: a single pool-wide index that grows with vault utilization.
//!
//! The APR follows a kinked curve: 0% at no utilization, `kink_apr` at `kink_util`, `max_apr` at 100%.
//! Every open position pays `size * (index_now - index_entry)`; the index accrues piecewise-constant between touches.

use crate::fixed::{mul_div, Round};
use crate::{MathError, Result, BPS, SECONDS_PER_YEAR};

/// Reserved liquidity over vault assets, in bps, capped at 100%. Empty vault with reservations counts as 100%.
pub fn utilization_bps(reserved: u64, assets: u64) -> Result<u32> {
    if reserved == 0 {
        return Ok(0);
    }
    if assets == 0 {
        return Ok(BPS as u32);
    }
    let u = mul_div(reserved as u128, BPS, assets as u128, Round::Up)?;
    Ok(u.min(BPS) as u32)
}

/// APR in bps for a utilization in bps.
pub fn borrow_apr_bps(util_bps: u32, kink_util_bps: u32, kink_apr_bps: u32, max_apr_bps: u32) -> Result<u32> {
    let u = util_bps.min(BPS as u32) as u128;
    let (k, ka, ma) = (kink_util_bps as u128, kink_apr_bps as u128, max_apr_bps as u128);
    if k == 0 || k >= BPS || ma < ka {
        return Err(MathError::InvalidInput);
    }
    let apr = if u <= k {
        mul_div(ka, u, k, Round::Up)?
    } else {
        ka + mul_div(ma - ka, u - k, BPS - k, Round::Up)?
    };
    Ok(apr as u32)
}

/// Index growth per second (1e18 = 100%) for an APR in bps, rounded up.
pub fn rate_per_sec(apr_bps: u32) -> Result<u128> {
    // 1e18 * apr / 1e4 = apr * 1e14 per year
    mul_div(apr_bps as u128, 100_000_000_000_000, SECONDS_PER_YEAR, Round::Up)
}

/// `index + rate * dt`.
pub fn accrue(index: u128, rate: u128, dt_secs: u64) -> Result<u128> {
    let growth = rate.checked_mul(dt_secs as u128).ok_or(MathError::Overflow)?;
    index.checked_add(growth).ok_or(MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RATE_ONE;

    #[test]
    fn kinked_curve() {
        let apr = |u| borrow_apr_bps(u, 7_500, 3_000, 10_000).unwrap();
        assert_eq!(apr(0), 0);
        assert_eq!(apr(3_750), 1_500);
        assert_eq!(apr(7_500), 3_000);
        assert_eq!(apr(8_750), 6_500);
        assert_eq!(apr(10_000), 10_000);
        assert_eq!(apr(12_000), 10_000);
    }

    #[test]
    fn a_year_at_100_percent_is_one() {
        let r = rate_per_sec(10_000).unwrap();
        let idx = accrue(0, r, SECONDS_PER_YEAR as u64).unwrap();
        // rounded up per second, so slightly above 1.0 but within 1 unit per second
        assert!(idx >= RATE_ONE && idx - RATE_ONE < SECONDS_PER_YEAR);
    }

    #[test]
    fn utilization() {
        assert_eq!(utilization_bps(0, 0).unwrap(), 0);
        assert_eq!(utilization_bps(5, 0).unwrap(), 10_000);
        assert_eq!(utilization_bps(41, 100).unwrap(), 4_100);
        assert_eq!(utilization_bps(200, 100).unwrap(), 10_000);
    }
}
