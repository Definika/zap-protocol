// Fixed-point math, bit-for-bit identical to the on-chain `zap-math` crate. Every integer is a `bigint` in the range of the
// Rust type it stands for; arguments outside it throw `MathError('InvalidInput')`. Checked against golden vectors generated
// from the crate (`packages/sdk/test/vectors`).

export * from './constants';
export { MathError } from './errors';
export type { MathErrorKind } from './errors';
export * from './fixed';
export * from './price';
export * from './fees';
export * from './borrow';
export * from './funding';
export * from './position';
export * from './vault';
