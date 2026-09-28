//! Exact `a * b / d` with explicit rounding, using a 256-bit product when 128 bits overflow.

use crate::{MathError, Result};

// Own module: the macro expands to code that uses a bare `Result`, which would pick up our alias.
mod wide {
    uint::construct_uint! {
        pub struct U256(4);
    }
}

pub use wide::U256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Round {
    /// Toward negative infinity.
    Down,
    /// Toward positive infinity.
    Up,
}

impl Round {
    fn flip(self) -> Round {
        match self {
            Round::Down => Round::Up,
            Round::Up => Round::Down,
        }
    }
}

/// `a * b / d`, rounded as asked. Exact for any `u128` inputs; errors if the result exceeds `u128`.
pub fn mul_div(a: u128, b: u128, d: u128, round: Round) -> Result<u128> {
    if d == 0 {
        return Err(MathError::DivByZero);
    }
    if let Some(p) = a.checked_mul(b) {
        let q = p / d;
        return Ok(if round == Round::Up && p % d != 0 { q + 1 } else { q });
    }
    let (mut q, r) = (U256::from(a) * U256::from(b)).div_mod(U256::from(d));
    if round == Round::Up && !r.is_zero() {
        q += U256::one();
    }
    if q.bits() > 128 {
        return Err(MathError::Overflow);
    }
    Ok(q.low_u128())
}

pub fn mul_div_floor(a: u128, b: u128, d: u128) -> Result<u128> {
    mul_div(a, b, d, Round::Down)
}

pub fn mul_div_ceil(a: u128, b: u128, d: u128) -> Result<u128> {
    mul_div(a, b, d, Round::Up)
}

/// Signed `a * b / d` with rounding toward -inf (`Down`) or +inf (`Up`).
pub fn mul_div_signed(a: i128, b: u128, d: u128, round: Round) -> Result<i128> {
    let mag = if a < 0 {
        // floor(-x) = -ceil(x) and ceil(-x) = -floor(x)
        mul_div(a.unsigned_abs(), b, d, round.flip())?
    } else {
        mul_div(a as u128, b, d, round)?
    };
    let mag = i128::try_from(mag).map_err(|_| MathError::Overflow)?;
    Ok(if a < 0 { -mag } else { mag })
}

pub fn to_u64(x: u128) -> Result<u64> {
    u64::try_from(x).map_err(|_| MathError::Overflow)
}

pub fn to_i128(x: u128) -> Result<i128> {
    i128::try_from(x).map_err(|_| MathError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_both_ways() {
        assert_eq!(mul_div_floor(10, 10, 3).unwrap(), 33);
        assert_eq!(mul_div_ceil(10, 10, 3).unwrap(), 34);
        assert_eq!(mul_div_ceil(9, 10, 3).unwrap(), 30);
        assert_eq!(mul_div(0, 5, 7, Round::Up).unwrap(), 0);
    }

    #[test]
    fn wide_product_path_is_exact() {
        let a = u128::MAX / 3;
        let q = mul_div_floor(a, 6, 3).unwrap();
        assert_eq!(q, a * 2);
        // (2^127) * 3 / 2 overflows u128 in the product but not in the result
        let a = 1u128 << 127;
        assert_eq!(mul_div_floor(a, 3, 4).unwrap(), (a / 4) * 3);
        assert_eq!(mul_div_ceil(u128::MAX, u128::MAX, u128::MAX).unwrap(), u128::MAX);
    }

    #[test]
    fn overflow_and_div_by_zero() {
        assert_eq!(mul_div_floor(u128::MAX, 2, 1), Err(MathError::Overflow));
        assert_eq!(mul_div_floor(1, 1, 0), Err(MathError::DivByZero));
    }

    #[test]
    fn signed_rounding_is_directional() {
        assert_eq!(mul_div_signed(-10, 10, 3, Round::Down).unwrap(), -34);
        assert_eq!(mul_div_signed(-10, 10, 3, Round::Up).unwrap(), -33);
        assert_eq!(mul_div_signed(10, 10, 3, Round::Down).unwrap(), 33);
        assert_eq!(mul_div_signed(10, 10, 3, Round::Up).unwrap(), 34);
    }
}
