// Position PnL, accrued fees, health and liquidation. Port of `crates/zap-math/src/position.rs`.

import { BPS, RATE_ONE } from './constants';
import { arg, badVariant, checked } from './errors';
import { mulDiv, mulDivSigned, toI128, toU64 } from './fixed';
import { valueOf } from './price';

export type Side = 'Long' | 'Short';

/**
 * Fees accrued against an index between entry and now: `size · (now − entry) / 1e18`, rounded against the trader
 * (up when owed, toward zero when received).
 */
export function owed(sizeUsd: bigint, indexNow: bigint, indexEntry: bigint): bigint {
  arg(sizeUsd, 'u64', 'sizeUsd');
  arg(indexNow, 'i128', 'indexNow');
  arg(indexEntry, 'i128', 'indexEntry');
  const delta = checked(indexNow - indexEntry, 'i128');
  return mulDivSigned(delta, sizeUsd, RATE_ONE, 'Up');
}

/**
 * PnL for closing `sizeClosed` of entry notional that holds `unitsClosed`, at `exitPrice12` (the close fill price).
 * Rounded against the trader (longs value their units down, shorts up) and capped at `+sizeClosed`: a position can win at
 * most 100% of its size.
 */
export function pnl(side: Side, sizeClosed: bigint, unitsClosed: bigint, exitPrice12: bigint): bigint {
  arg(sizeClosed, 'u64', 'sizeClosed');
  arg(unitsClosed, 'u128', 'unitsClosed');
  arg(exitPrice12, 'u64', 'exitPrice12');
  let raw: bigint;
  switch (side) {
    case 'Long':
      raw = toI128(valueOf(unitsClosed, exitPrice12, 'Down')) - sizeClosed;
      break;
    case 'Short':
      raw = sizeClosed - toI128(valueOf(unitsClosed, exitPrice12, 'Up'));
      break;
    default:
      throw badVariant('side', side);
  }
  return raw < sizeClosed ? raw : sizeClosed;
}

/** Maintenance margin requirement `ceil(size · mmr)`. */
export function maintenanceMargin(sizeUsd: bigint, mmrBps: bigint): bigint {
  arg(sizeUsd, 'u64', 'sizeUsd');
  arg(mmrBps, 'u16', 'mmrBps');
  return toU64(mulDiv(sizeUsd, mmrBps, BPS, 'Up'));
}

/** Position equity: collateral + PnL − accrued borrow/funding − the fee to close it. Each step is checked against `i128`. */
export function equity(collateral: bigint, pnl: bigint, owedTotal: bigint, closeFee: bigint): bigint {
  arg(collateral, 'u64', 'collateral');
  arg(pnl, 'i128', 'pnl');
  arg(owedTotal, 'i128', 'owedTotal');
  arg(closeFee, 'u64', 'closeFee');
  const withPnl = checked(collateral + pnl, 'i128');
  const withOwed = checked(withPnl - owedTotal, 'i128');
  return checked(withOwed - closeFee, 'i128');
}

/** Liquidatable when equity has fallen to the maintenance margin or below. */
export function isLiquidatable(equity: bigint, sizeUsd: bigint, mmrBps: bigint): boolean {
  arg(equity, 'i128', 'equity');
  return equity <= maintenanceMargin(sizeUsd, mmrBps);
}

/** `size ≤ maxLeverage · collateral`. */
export function leverageOk(sizeUsd: bigint, collateral: bigint, maxLeverage: bigint): boolean {
  arg(sizeUsd, 'u64', 'sizeUsd');
  arg(collateral, 'u64', 'collateral');
  arg(maxLeverage, 'u16', 'maxLeverage');
  return sizeUsd <= collateral * maxLeverage;
}

export interface LiquidationSplit {
  toLiquidator: bigint;
  toVaultFee: bigint;
  toTrader: bigint;
}

/**
 * Splits what is left of a liquidated position (`collateral + pnl − owed`, may be negative): the liquidation fee
 * (`liqFeeBps` of size, rounded up) goes first to the liquidator (`liquidatorShareBps` of it, rounded down) and then to the
 * vault; anything left returns to the trader.
 */
export function liquidationSplit(
  remaining: bigint,
  sizeUsd: bigint,
  liqFeeBps: bigint,
  liquidatorShareBps: bigint,
): LiquidationSplit {
  arg(remaining, 'i128', 'remaining');
  arg(sizeUsd, 'u64', 'sizeUsd');
  arg(liqFeeBps, 'u16', 'liqFeeBps');
  arg(liquidatorShareBps, 'u16', 'liquidatorShareBps');
  const rem = checked(remaining > 0n ? remaining : 0n, 'u64');
  const fee = toU64(mulDiv(sizeUsd, liqFeeBps, BPS, 'Up'));
  const liqPart = toU64(mulDiv(fee, liquidatorShareBps, BPS, 'Down'));
  const toLiquidator = rem < liqPart ? rem : liqPart;
  const left = rem - toLiquidator;
  // a share above 100% makes `fee - liq_part` underflow, which panics in Rust
  const feeLeft = checked(fee - liqPart, 'u64');
  const toVaultFee = left < feeLeft ? left : feeLeft;
  return { toLiquidator, toVaultFee, toTrader: left - toVaultFee };
}
