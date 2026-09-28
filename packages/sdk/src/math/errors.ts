import { I128_MAX, I128_MIN, I32_MAX, I32_MIN, I64_MAX, I64_MIN, U128_MAX, U16_MAX, U32_MAX, U64_MAX } from './constants';

export type MathErrorKind = 'Overflow' | 'DivByZero' | 'InvalidPrice' | 'InvalidInput';

/** `zap_math::MathError`: the port throws it wherever the Rust crate returns `Err`, with the same variant as `kind`. */
export class MathError extends Error {
  readonly kind: MathErrorKind;

  constructor(kind: MathErrorKind, detail?: string) {
    super(detail === undefined ? kind : `${kind}: ${detail}`);
    this.name = 'MathError';
    this.kind = kind;
  }
}

// Internal helpers (not re-exported from the package).

/** Rust integer types in the crate's signatures and intermediate results. */
export type IntType = 'u16' | 'u32' | 'u64' | 'u128' | 'i32' | 'i64' | 'i128';

const RANGE: Readonly<Record<IntType, readonly [min: bigint, max: bigint]>> = {
  u16: [0n, U16_MAX],
  u32: [0n, U32_MAX],
  u64: [0n, U64_MAX],
  u128: [0n, U128_MAX],
  i32: [I32_MIN, I32_MAX],
  i64: [I64_MIN, I64_MAX],
  i128: [I128_MIN, I128_MAX],
};

function fits(x: bigint, type: IntType): boolean {
  const [min, max] = RANGE[type];
  return x >= min && x <= max;
}

/** Rejects an argument its Rust type could not hold (`InvalidInput`), so the port never computes outside Rust's domain. */
export function arg(x: bigint, type: IntType, name: string): bigint {
  if (typeof x !== 'bigint' || !fits(x, type)) {
    throw new MathError('InvalidInput', `${name} must be a ${type} bigint, got ${String(x)}`);
  }
  return x;
}

/**
 * Range check for a Rust `checked_*` op, or for plain arithmetic that panics under `overflow-checks` (the program is built
 * with them, so the transaction aborts): `Overflow` unless `x` fits `type`.
 */
export function checked(x: bigint, type: IntType): bigint {
  if (!fits(x, type)) throw new MathError('Overflow', `${x} does not fit ${type}`);
  return x;
}

/** `InvalidInput` for a string outside a Rust enum; `never` makes the caller rule out every variant first. */
export function badVariant(name: string, value: never): MathError {
  return new MathError('InvalidInput', `invalid ${name}: ${String(value)}`);
}
