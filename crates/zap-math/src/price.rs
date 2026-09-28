//! Oracle price normalization, spread, price impact, fill price and unit conversion.

use crate::fixed::{mul_div, to_u64, Round};
use crate::{MathError, Result, BPS, FRAC_ONE, FRAC_PER_BPS, RATE_ONE};

const PRICE_DECIMALS: i32 = 12;

fn pow10(exp: u32) -> Result<u64> {
    10u64.checked_pow(exp).ok_or(MathError::Overflow)
}

/// Pyth `mantissa * 10^expo` as a 12-decimal price, rounded down. Rejects zero and negative prices.
pub fn normalize_price(mantissa: i64, expo: i32) -> Result<u64> {
    if mantissa <= 0 {
        return Err(MathError::InvalidPrice);
    }
    let p = scale_to_12(mantissa as u64, expo)?;
    if p == 0 {
        return Err(MathError::InvalidPrice);
    }
    Ok(p)
}

/// Pyth confidence (same exponent as the price) as a 12-decimal amount, rounded up. Zero means "not published".
pub fn normalize_conf(conf: u64, expo: i32) -> Result<u64> {
    let shift = PRICE_DECIMALS + expo;
    if shift >= 0 {
        conf.checked_mul(pow10(shift as u32)?).ok_or(MathError::Overflow)
    } else {
        to_u64(mul_div(conf as u128, 1, pow10((-shift) as u32)? as u128, Round::Up)?)
    }
}

fn scale_to_12(m: u64, expo: i32) -> Result<u64> {
    let shift = PRICE_DECIMALS + expo;
    if shift >= 0 {
        m.checked_mul(pow10(shift as u32)?).ok_or(MathError::Overflow)
    } else {
        Ok(m / pow10((-shift) as u32)?)
    }
}

/// Half-spread as a fraction of `FRAC_ONE`: `max(min_spread_bps, conf * conf_mult_bps / 1e4 / price)`, rounded up.
pub fn spread_frac(price12: u64, conf12: u64, min_spread_bps: u16, conf_mult_bps: u16) -> Result<u128> {
    if price12 == 0 {
        return Err(MathError::InvalidPrice);
    }
    let floor = min_spread_bps as u128 * FRAC_PER_BPS;
    if conf12 == 0 || conf_mult_bps == 0 {
        return Ok(floor);
    }
    let from_conf = mul_div(
        conf12 as u128 * conf_mult_bps as u128,
        FRAC_ONE,
        price12 as u128 * BPS,
        Round::Up,
    )?;
    Ok(floor.max(from_conf))
}

/// Price impact as a fraction of `FRAC_ONE` for a trade that moves the long-minus-short skew from `skew` to `skew + delta`
/// (all in USD, 6 decimals; buys are positive, sells negative).
///
/// Only trades that grow `|skew|` pay: `cost = (a² − b²) / (2 · depth)` spread over `|delta|`, capped at `cap_bps`.
/// Because the cost telescopes, splitting a trade into pieces never makes it cheaper (below the cap).
pub fn impact_frac(skew: i128, delta: i128, depth_usd: u64, cap_bps: u16) -> Result<u128> {
    if delta == 0 || depth_usd == 0 {
        return Ok(0);
    }
    let after = skew.checked_add(delta).ok_or(MathError::Overflow)?;
    let a2 = after.unsigned_abs().checked_mul(after.unsigned_abs()).ok_or(MathError::Overflow)?;
    let b2 = skew.unsigned_abs().checked_mul(skew.unsigned_abs()).ok_or(MathError::Overflow)?;
    if a2 <= b2 {
        return Ok(0);
    }
    let frac = mul_div(
        a2 - b2,
        FRAC_ONE,
        2 * depth_usd as u128 * delta.unsigned_abs(),
        Round::Up,
    )?;
    Ok(frac.min(cap_bps as u128 * FRAC_PER_BPS))
}

/// Fill price: buys pay `P · (1 + s + i)` rounded up, sells receive `P · (1 − s − i)` rounded down.
pub fn fill_price(price12: u64, spread: u128, impact: u128, is_buy: bool) -> Result<u64> {
    let adj = spread.checked_add(impact).ok_or(MathError::Overflow)?;
    let p = if is_buy {
        mul_div(price12 as u128, FRAC_ONE + adj, FRAC_ONE, Round::Up)?
    } else {
        if adj >= FRAC_ONE {
            return Err(MathError::InvalidInput);
        }
        mul_div(price12 as u128, FRAC_ONE - adj, FRAC_ONE, Round::Down)?
    };
    let p = to_u64(p)?;
    if p == 0 {
        return Err(MathError::InvalidPrice);
    }
    Ok(p)
}

/// Base-asset units (12 decimals) for `size_usd` at `price12`. Longs round down and shorts round up (fewer units hurt a long,
/// more units hurt a short).
pub fn units_for(size_usd: u64, price12: u64, is_long: bool) -> Result<u128> {
    if price12 == 0 {
        return Err(MathError::InvalidPrice);
    }
    let round = if is_long { Round::Down } else { Round::Up };
    mul_div(size_usd as u128, RATE_ONE, price12 as u128, round)
}

/// USD value (6 decimals) of `units` at `price12`.
pub fn value_of(units: u128, price12: u64, round: Round) -> Result<u128> {
    mul_div(units, price12 as u128, RATE_ONE, round)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PRICE_ONE, USD_ONE};

    #[test]
    fn normalizes_pyth_expo_minus_8() {
        // BTC $97,412.60 as a Pyth mantissa with expo -8
        assert_eq!(normalize_price(9_741_260_000_000, -8).unwrap(), 97_412_600_000_000_000);
        assert_eq!(normalize_price(0, -8), Err(MathError::InvalidPrice));
        assert_eq!(normalize_price(-5, -8), Err(MathError::InvalidPrice));
        // expo below -12 rounds down and can underflow to zero
        assert_eq!(normalize_price(123, -14).unwrap(), 1);
        assert_eq!(normalize_price(99, -14), Err(MathError::InvalidPrice));
        assert_eq!(normalize_conf(99, -14).unwrap(), 1);
    }

    #[test]
    fn spread_uses_the_larger_of_floor_and_confidence() {
        let p = 100 * PRICE_ONE;
        // floor 1bp, no confidence
        assert_eq!(spread_frac(p, 0, 1, 10_000).unwrap(), FRAC_PER_BPS);
        // conf = 0.02 on 100 = 2bp at 1.0x multiplier
        let conf = PRICE_ONE / 50;
        assert_eq!(spread_frac(p, conf, 1, 10_000).unwrap(), 2 * FRAC_PER_BPS);
        // 0.5x multiplier gives 1bp, equal to the floor
        assert_eq!(spread_frac(p, conf, 1, 5_000).unwrap(), FRAC_PER_BPS);
    }

    #[test]
    fn impact_only_when_skew_grows() {
        let depth = 1_000_000 * USD_ONE; // $1M
        let t = 10_000 * USD_ONE as i128; // $10k
        // from balanced: cost = (1e10)² / (2 · 1e12) = 5e7 ($50) on a $10k trade = 50bp
        assert_eq!(impact_frac(0, t, depth, 100).unwrap(), 50 * FRAC_PER_BPS);
        // cap applies
        assert_eq!(impact_frac(0, t, depth, 20).unwrap(), 20 * FRAC_PER_BPS);
        // reducing skew pays nothing, crossing to a smaller |skew| pays nothing
        assert_eq!(impact_frac(3 * t, -t, depth, 100).unwrap(), 0);
        assert_eq!(impact_frac(-t, t + t / 2, depth, 100).unwrap(), 0);
        // selling into a short skew pays
        assert!(impact_frac(-t, -t, depth, 1_000).unwrap() > 0);
    }

    #[test]
    fn splitting_never_cheaper_below_cap() {
        let depth = 5_000_000 * USD_ONE;
        let total = 40_000 * USD_ONE as i128;
        let cost = |skew: i128, d: i128| -> u128 {
            mul_div(impact_frac(skew, d, depth, 10_000).unwrap(), d.unsigned_abs(), FRAC_ONE, Round::Up).unwrap()
        };
        let whole = cost(0, total);
        let mut split = 0;
        let mut skew = 0;
        for _ in 0..4 {
            split += cost(skew, total / 4);
            skew += total / 4;
        }
        assert!(split >= whole);
    }

    #[test]
    fn fill_price_rounds_against_trader() {
        let p = 3 * PRICE_ONE + 1;
        let s = FRAC_PER_BPS; // 1bp
        let buy = fill_price(p, s, 0, true).unwrap();
        let sell = fill_price(p, s, 0, false).unwrap();
        assert!(buy > p && sell < p);
        assert_eq!(buy, mul_div(p as u128, FRAC_ONE + s, FRAC_ONE, Round::Up).unwrap() as u64);
        assert_eq!(fill_price(p, FRAC_ONE, 0, false), Err(MathError::InvalidInput));
    }

    #[test]
    fn units_round_against_trader_and_value_back() {
        let px = 3 * PRICE_ONE; // $3
        let long = units_for(10 * USD_ONE, px, true).unwrap();
        let short = units_for(10 * USD_ONE, px, false).unwrap();
        assert_eq!(short, long + 1);
        // 10/3 units with 12 decimals
        assert_eq!(long, 3_333_333_333_333);
        assert_eq!(value_of(long, px, Round::Down).unwrap(), 9_999_999);
        assert_eq!(value_of(short, px, Round::Up).unwrap(), 10_000_001);
    }
}
