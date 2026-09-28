// Trading fees. Fees are taken from the trader, so they round up. Port of `crates/zap-math/src/fees.rs`.

import { BPS } from './constants';
import { arg } from './errors';
import { mulDiv, toU64 } from './fixed';
import type { Round } from './fixed';
import { valueOf } from './price';

/** `amount * bps / 1e4`, rounded as asked. */
export function bpsOf(amount: bigint, bps: bigint, round: Round): bigint {
  arg(amount, 'u128', 'amount');
  arg(bps, 'u16', 'bps');
  return mulDiv(amount, bps, BPS, round);
}

/** Open fee on the notional being opened. */
export function openFee(sizeUsd: bigint, feeBps: bigint): bigint {
  arg(sizeUsd, 'u64', 'sizeUsd');
  arg(feeBps, 'u16', 'feeBps');
  return toU64(bpsOf(sizeUsd, feeBps, 'Up'));
}

/** Close fee on the current notional of the units being closed, valued (rounded down) at the exit price. */
export function closeFee(units: bigint, exitPrice12: bigint, feeBps: bigint): bigint {
  arg(units, 'u128', 'units');
  arg(exitPrice12, 'u64', 'exitPrice12');
  arg(feeBps, 'u16', 'feeBps');
  const notional = valueOf(units, exitPrice12, 'Down');
  return toU64(bpsOf(notional, feeBps, 'Up'));
}
