// Borrow fee: a single pool-wide index that grows with vault utilization. Port of `crates/zap-math/src/borrow.rs`.
//
// The APR follows a kinked curve: 0% at no utilization, `kinkApr` at `kinkUtil`, `maxApr` at 100%.
// Every open position pays `size * (indexNow - indexEntry)`; the index accrues piecewise-constant between touches.

import { BPS, SECONDS_PER_YEAR } from './constants';
import { MathError, arg, checked } from './errors';
import { mulDiv } from './fixed';

/** Reserved liquidity over vault assets in bps, rounded up and capped at 100%. An empty vault with reservations is 100%. */
export function utilizationBps(reserved: bigint, assets: bigint): bigint {
  arg(reserved, 'u64', 'reserved');
  arg(assets, 'u64', 'assets');
  if (reserved === 0n) return 0n;
  if (assets === 0n) return BPS;
  const u = mulDiv(reserved, BPS, assets, 'Up');
  return u < BPS ? u : BPS;
}

/** APR in bps for a utilization in bps (clamped to 100%), rounded up on both legs of the curve. */
export function borrowAprBps(utilBps: bigint, kinkUtilBps: bigint, kinkAprBps: bigint, maxAprBps: bigint): bigint {
  arg(utilBps, 'u32', 'utilBps');
  arg(kinkUtilBps, 'u32', 'kinkUtilBps');
  arg(kinkAprBps, 'u32', 'kinkAprBps');
  arg(maxAprBps, 'u32', 'maxAprBps');
  const u = utilBps < BPS ? utilBps : BPS;
  const [k, ka, ma] = [kinkUtilBps, kinkAprBps, maxAprBps];
  if (k === 0n || k >= BPS || ma < ka) throw new MathError('InvalidInput');
  // Rust returns this `as u32`; it never exceeds `maxAprBps`, so the cast never truncates.
  return u <= k ? mulDiv(ka, u, k, 'Up') : ka + mulDiv(ma - ka, u - k, BPS - k, 'Up');
}

/** Index growth per second (1e18 = 100%) for an APR in bps, rounded up. */
export function borrowRatePerSec(aprBps: bigint): bigint {
  arg(aprBps, 'u32', 'aprBps');
  // 1e18 * apr / 1e4 = apr * 1e14 per year
  return mulDiv(aprBps, 100_000_000_000_000n, SECONDS_PER_YEAR, 'Up');
}

/** `index + rate * dt`, both steps checked against `u128`. */
export function accrueBorrow(index: bigint, rate: bigint, dtSecs: bigint): bigint {
  arg(index, 'u128', 'index');
  arg(rate, 'u128', 'rate');
  arg(dtSecs, 'u64', 'dtSecs');
  return checked(index + checked(rate * dtSecs, 'u128'), 'u128');
}
