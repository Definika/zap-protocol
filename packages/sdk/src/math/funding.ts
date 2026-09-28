// Funding: the crowded side pays the light side at the same rate; the vault keeps the imbalance share.
// Port of `crates/zap-math/src/funding.rs`.
//
// Hourly rate `r = rMax · (OI_L − OI_S) / (OI_L + OI_S)`, accrued per second into two indices: the long index grows by
// `r·dt` and the short index shrinks by `r·dt`, so a position owes `size · Δindex` (negative means it receives).
// The vault's net receipt is `r · (OI_L − OI_S) · dt ≥ 0`.

import { SECONDS_PER_HOUR } from './constants';
import { arg, checked } from './errors';
import { mulDiv, toI128 } from './fixed';

/** Signed funding rate per second (1e18 = 100%). Positive means longs pay. Truncated toward zero. */
export function fundingRatePerSec(oiLong: bigint, oiShort: bigint, maxHourly: bigint): bigint {
  arg(oiLong, 'u64', 'oiLong');
  arg(oiShort, 'u64', 'oiShort');
  arg(maxHourly, 'u128', 'maxHourly');
  const total = oiLong + oiShort;
  if (total === 0n || oiLong === oiShort) return 0n;
  const imbalance = oiLong > oiShort ? oiLong - oiShort : oiShort - oiLong;
  // the magnitude is floored, so the signed rate truncates toward zero
  const mag = toI128(mulDiv(maxHourly, imbalance, total * SECONDS_PER_HOUR, 'Down'));
  return oiLong > oiShort ? mag : -mag;
}

/** Advance both side indices by `rate * dt`: returns `[indexLong + step, indexShort - step]`, checked against `i128`. */
export function accrueFunding(
  indexLong: bigint,
  indexShort: bigint,
  rate: bigint,
  dtSecs: bigint,
): [indexLong: bigint, indexShort: bigint] {
  arg(indexLong, 'i128', 'indexLong');
  arg(indexShort, 'i128', 'indexShort');
  arg(rate, 'i128', 'rate');
  arg(dtSecs, 'u64', 'dtSecs');
  const step = checked(rate * dtSecs, 'i128');
  return [checked(indexLong + step, 'i128'), checked(indexShort - step, 'i128')];
}
