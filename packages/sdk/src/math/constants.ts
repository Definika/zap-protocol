// Units shared with the on-chain program (`crates/zap-math/src/lib.rs`):
// - USD amounts: u64 with 6 decimals (same as USDC).
// - Prices: u64 with 12 decimals (`price12`).
// - Base-asset units: u128 with 12 decimals, so `usd6 = units * price12 / 1e18`.
// - Rates and indices: 1e18 = 100%.
// - Spread and impact fractions: 1e12 = 100%.

/** 1 USD in 6-decimal USD units. */
export const USD_ONE: bigint = 1_000_000n;
/** 1.0 in 12-decimal price units. */
export const PRICE_ONE: bigint = 1_000_000_000_000n;
/** 100% for spread and impact fractions. */
export const FRAC_ONE: bigint = 1_000_000_000_000n;
/** One basis point as a spread/impact fraction. */
export const FRAC_PER_BPS: bigint = 100_000_000n;
/** 100% for rates and indices; also the divisor that turns `units * price12` into USD. */
export const RATE_ONE: bigint = 1_000_000_000_000_000_000n;
/** Basis-point denominator. */
export const BPS: bigint = 10_000n;
export const SECONDS_PER_HOUR: bigint = 3_600n;
export const SECONDS_PER_YEAR: bigint = 31_536_000n;
/** Virtual shares and assets added to both sides of the LP share price (protects the first depositor from inflation attacks). */
export const VIRTUAL_SHARES: bigint = 1_000_000n;
export const VIRTUAL_ASSETS: bigint = 1_000_000n;

// Bounds of the Rust integer types in the crate's signatures.
export const U16_MAX: bigint = 0xffffn;
export const U32_MAX: bigint = 0xffff_ffffn;
export const U64_MAX: bigint = (1n << 64n) - 1n;
export const U128_MAX: bigint = (1n << 128n) - 1n;
export const I32_MIN: bigint = -(1n << 31n);
export const I32_MAX: bigint = (1n << 31n) - 1n;
export const I64_MIN: bigint = -(1n << 63n);
export const I64_MAX: bigint = (1n << 63n) - 1n;
export const I128_MIN: bigint = -(1n << 127n);
export const I128_MAX: bigint = (1n << 127n) - 1n;
