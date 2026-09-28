// Oracle price normalization, spread, price impact, fill price and unit conversion. Port of `crates/zap-math/src/price.rs`.

import { BPS, FRAC_ONE, FRAC_PER_BPS, RATE_ONE } from './constants';
import { MathError, arg, checked } from './errors';
import { mulDiv, toU64 } from './fixed';
import type { Round } from './fixed';

const PRICE_DECIMALS = 12n;

/** `10u64.checked_pow(exp)`: 10^20 and up overflow `u64`. */
function pow10(exp: bigint): bigint {
  if (exp > 19n) throw new MathError('Overflow');
  return 10n ** exp;
}

/** `12 + expo` as Rust computes it: an `i32` add, which panics (here: `Overflow`) for `expo > i32::MAX - 12`. */
function shiftTo12(expo: bigint): bigint {
  return checked(PRICE_DECIMALS + expo, 'i32');
}

/**
 * Pyth `mantissa * 10^expo` as a 12-decimal price, rounded down. Rejects zero and negative prices, and prices that round
 * to zero. An exponent of -32 or below is an `Overflow` (the divisor 10^20 doesn't fit `u64`), not `InvalidPrice`.
 */
export function normalizePrice(mantissa: bigint, expo: bigint): bigint {
  arg(mantissa, 'i64', 'mantissa');
  arg(expo, 'i32', 'expo');
  if (mantissa <= 0n) throw new MathError('InvalidPrice');
  const shift = shiftTo12(expo);
  const p = shift >= 0n ? checked(mantissa * pow10(shift), 'u64') : mantissa / pow10(-shift);
  if (p === 0n) throw new MathError('InvalidPrice');
  return p;
}

/** Pyth confidence (same exponent as the price) as a 12-decimal amount, rounded up. Zero means "not published". */
export function normalizeConf(conf: bigint, expo: bigint): bigint {
  arg(conf, 'u64', 'conf');
  arg(expo, 'i32', 'expo');
  const shift = shiftTo12(expo);
  return shift >= 0n ? checked(conf * pow10(shift), 'u64') : toU64(mulDiv(conf, 1n, pow10(-shift), 'Up'));
}

/**
 * Half-spread as a fraction of `FRAC_ONE`: `max(minSpread, conf * confMultBps / 1e4 / price)`, rounded up.
 * `minSpread` is itself a `FRAC_ONE` fraction so it can go below 1bp (e.g. 0.5bp = 5e7).
 */
export function spreadFrac(price12: bigint, conf12: bigint, minSpread: bigint, confMultBps: bigint): bigint {
  arg(price12, 'u64', 'price12');
  arg(conf12, 'u64', 'conf12');
  arg(minSpread, 'u128', 'minSpread');
  arg(confMultBps, 'u16', 'confMultBps');
  if (price12 === 0n) throw new MathError('InvalidPrice');
  if (conf12 === 0n || confMultBps === 0n) return minSpread;
  const fromConf = mulDiv(conf12 * confMultBps, FRAC_ONE, price12 * BPS, 'Up');
  return minSpread > fromConf ? minSpread : fromConf;
}

/**
 * Price impact as a fraction of `FRAC_ONE` for a trade that moves the long-minus-short skew from `skew` to `skew + delta`
 * (all in USD, 6 decimals; buys are positive, sells negative).
 *
 * Only trades that grow `|skew|` pay: `cost = (a² − b²) / (2 · depth)` spread over `|delta|`, rounded up and capped at
 * `capBps`. Because the cost telescopes, splitting a trade into pieces never makes it cheaper (below the cap).
 */
export function impactFrac(skew: bigint, delta: bigint, depthUsd: bigint, capBps: bigint): bigint {
  arg(skew, 'i128', 'skew');
  arg(delta, 'i128', 'delta');
  arg(depthUsd, 'u64', 'depthUsd');
  arg(capBps, 'u16', 'capBps');
  if (delta === 0n || depthUsd === 0n) return 0n;
  const after = checked(skew + delta, 'i128');
  const a2 = checked(after * after, 'u128');
  const b2 = checked(skew * skew, 'u128');
  if (a2 <= b2) return 0n;
  // Rust computes `2 * depth * |delta|` in plain u128 arithmetic, which panics if it overflows
  const denom = checked(2n * depthUsd * abs(delta), 'u128');
  const frac = mulDiv(a2 - b2, FRAC_ONE, denom, 'Up');
  const cap = capBps * FRAC_PER_BPS;
  return frac < cap ? frac : cap;
}

/** Fill price: buys pay `P · (1 + s + i)` rounded up, sells receive `P · (1 − s − i)` rounded down. */
export function fillPrice(price12: bigint, spread: bigint, impact: bigint, isBuy: boolean): bigint {
  arg(price12, 'u64', 'price12');
  arg(spread, 'u128', 'spread');
  arg(impact, 'u128', 'impact');
  const adj = checked(spread + impact, 'u128');
  let p: bigint;
  if (isBuy) {
    // `FRAC_ONE + adj` is plain u128 arithmetic in Rust (panics on overflow)
    p = mulDiv(price12, checked(FRAC_ONE + adj, 'u128'), FRAC_ONE, 'Up');
  } else {
    if (adj >= FRAC_ONE) throw new MathError('InvalidInput');
    p = mulDiv(price12, FRAC_ONE - adj, FRAC_ONE, 'Down');
  }
  const out = toU64(p);
  if (out === 0n) throw new MathError('InvalidPrice');
  return out;
}

/**
 * Base-asset units (12 decimals) for `sizeUsd` at `price12`. Longs round down and shorts round up (fewer units hurt a long,
 * more units hurt a short).
 */
export function unitsFor(sizeUsd: bigint, price12: bigint, isLong: boolean): bigint {
  arg(sizeUsd, 'u64', 'sizeUsd');
  arg(price12, 'u64', 'price12');
  if (price12 === 0n) throw new MathError('InvalidPrice');
  return mulDiv(sizeUsd, RATE_ONE, price12, isLong ? 'Down' : 'Up');
}

/** USD value (6 decimals) of `units` at `price12`. */
export function valueOf(units: bigint, price12: bigint, round: Round): bigint {
  arg(units, 'u128', 'units');
  arg(price12, 'u64', 'price12');
  return mulDiv(units, price12, RATE_ONE, round);
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}
