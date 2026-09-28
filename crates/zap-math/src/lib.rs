//! Fixed-point math for ZAP Protocol.
//!
//! Units used everywhere:
//! - USD amounts: `u64` with 6 decimals (same as USDC).
//! - Prices: `u64` with 12 decimals (`price12`).
//! - Base-asset units: `u128` with 12 decimals, so `usd6 = units * price12 / 1e18`.
//! - Rates and indices: 1e18 = 100%.
//! - Spread and impact fractions: 1e12 = 100%.
//!
//! Every rounding goes against the trader (or the withdrawing LP), so the vault never pays out dust it doesn't have.
//! The program and the TypeScript SDK must agree bit-for-bit; the SDK port is checked against vectors generated from this crate.

#![cfg_attr(not(any(feature = "std", test)), no_std)]

pub mod borrow;
pub mod fees;
pub mod fixed;
pub mod funding;
pub mod position;
pub mod price;
pub mod vault;

/// 1 USD in 6-decimal USD units.
pub const USD_ONE: u64 = 1_000_000;
/// 1.0 in 12-decimal price units.
pub const PRICE_ONE: u64 = 1_000_000_000_000;
/// 100% for spread and impact fractions.
pub const FRAC_ONE: u128 = 1_000_000_000_000;
/// One basis point as a spread/impact fraction.
pub const FRAC_PER_BPS: u128 = 100_000_000;
/// 100% for rates and indices; also the divisor that turns `units * price12` into USD.
pub const RATE_ONE: u128 = 1_000_000_000_000_000_000;
/// Basis-point denominator.
pub const BPS: u128 = 10_000;
pub const SECONDS_PER_HOUR: u128 = 3_600;
pub const SECONDS_PER_YEAR: u128 = 31_536_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MathError {
    Overflow,
    DivByZero,
    /// Price is zero, negative, or not representable.
    InvalidPrice,
    /// Input outside the domain the function accepts (e.g. spread + impact >= 100%).
    InvalidInput,
}

pub type Result<T> = core::result::Result<T, MathError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Long,
    Short,
}

impl Side {
    pub fn is_long(self) -> bool {
        matches!(self, Side::Long)
    }
}
