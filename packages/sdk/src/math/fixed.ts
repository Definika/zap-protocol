// Exact `a * b / d` with explicit rounding. Port of `crates/zap-math/src/fixed.rs`.

import { I128_MAX, U128_MAX, U64_MAX } from './constants';
import { MathError, arg, badVariant } from './errors';

/** `Down` rounds toward negative infinity, `Up` toward positive infinity. */
export type Round = 'Down' | 'Up';

/**
 * `a * b / d`, rounded as asked. The BigInt product is exact (Rust widens to 256 bits when 128 overflow); the result must
 * fit `u128`, and rounding up can be what pushes it over.
 */
export function mulDiv(a: bigint, b: bigint, d: bigint, round: Round): bigint {
  arg(a, 'u128', 'a');
  arg(b, 'u128', 'b');
  arg(d, 'u128', 'd');
  if (round !== 'Down' && round !== 'Up') throw badVariant('round', round);
  if (d === 0n) throw new MathError('DivByZero');
  const p = a * b;
  const q = round === 'Up' && p % d !== 0n ? p / d + 1n : p / d;
  if (q > U128_MAX) throw new MathError('Overflow');
  return q;
}

export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  return mulDiv(a, b, d, 'Down');
}

export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  return mulDiv(a, b, d, 'Up');
}

/**
 * Signed `a * b / d` with rounding toward -inf (`Down`) or +inf (`Up`). The magnitude must fit `i128` whatever the sign,
 * so an exact result of `-2^127` is an `Overflow`, as in Rust.
 */
export function mulDivSigned(a: bigint, b: bigint, d: bigint, round: Round): bigint {
  arg(a, 'i128', 'a');
  // floor(-x) = -ceil(x) and ceil(-x) = -floor(x)
  const mag = a < 0n ? mulDiv(-a, b, d, flip(round)) : mulDiv(a, b, d, round);
  if (mag > I128_MAX) throw new MathError('Overflow');
  return a < 0n ? -mag : mag;
}

export function toU64(x: bigint): bigint {
  arg(x, 'u128', 'x');
  if (x > U64_MAX) throw new MathError('Overflow');
  return x;
}

export function toI128(x: bigint): bigint {
  arg(x, 'u128', 'x');
  if (x > I128_MAX) throw new MathError('Overflow');
  return x;
}

function flip(round: Round): Round {
  switch (round) {
    case 'Down':
      return 'Up';
    case 'Up':
      return 'Down';
    default:
      throw badVariant('round', round);
  }
}
