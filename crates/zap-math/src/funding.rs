//! Funding: the crowded side pays the light side at the same rate; the vault keeps the imbalance share.
//!
//! Hourly rate `r = r_max · (OI_L − OI_S) / (OI_L + OI_S)`, accrued per second into two indices:
//! the long index grows by `r·dt` and the short index shrinks by `r·dt`, so a position owes `size · Δindex`
//! (negative means it receives). The vault's net receipt is `r · (OI_L − OI_S) · dt ≥ 0`.

use crate::fixed::{mul_div, to_i128, Round};
use crate::{MathError, Result, SECONDS_PER_HOUR};

/// Signed funding rate per second (1e18 = 100%). Positive means longs pay. Truncated toward zero.
pub fn rate_per_sec(oi_long: u64, oi_short: u64, max_hourly: u128) -> Result<i128> {
    let total = oi_long as u128 + oi_short as u128;
    if total == 0 || oi_long == oi_short {
        return Ok(0);
    }
    let imbalance = (oi_long as i128 - oi_short as i128).unsigned_abs();
    let mag = to_i128(mul_div(max_hourly, imbalance, total * SECONDS_PER_HOUR, Round::Down)?)?;
    Ok(if oi_long > oi_short { mag } else { -mag })
}

/// Advance both side indices by `rate * dt`.
pub fn accrue(index_long: i128, index_short: i128, rate: i128, dt_secs: u64) -> Result<(i128, i128)> {
    let step = rate.checked_mul(dt_secs as i128).ok_or(MathError::Overflow)?;
    Ok((
        index_long.checked_add(step).ok_or(MathError::Overflow)?,
        index_short.checked_sub(step).ok_or(MathError::Overflow)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RATE_ONE;

    const MAX_HOURLY: u128 = RATE_ONE / 10_000; // 0.01%/h

    #[test]
    fn sign_and_magnitude() {
        assert_eq!(rate_per_sec(0, 0, MAX_HOURLY).unwrap(), 0);
        assert_eq!(rate_per_sec(5, 5, MAX_HOURLY).unwrap(), 0);
        // all long: full max rate
        let full = rate_per_sec(100, 0, MAX_HOURLY).unwrap();
        assert_eq!(full, (MAX_HOURLY / 3_600) as i128);
        // 60/40 → 20% of max, shorts crowded flips the sign
        assert_eq!(rate_per_sec(60, 40, MAX_HOURLY).unwrap(), (MAX_HOURLY / 5 / 3_600) as i128);
        assert_eq!(rate_per_sec(40, 60, MAX_HOURLY).unwrap(), -((MAX_HOURLY / 5 / 3_600) as i128));
    }

    #[test]
    fn indices_move_opposite() {
        let (l, s) = accrue(10, 10, 7, 100).unwrap();
        assert_eq!((l, s), (710, -690));
        let (l, s) = accrue(0, 0, -7, 100).unwrap();
        assert_eq!((l, s), (-700, 700));
    }
}
