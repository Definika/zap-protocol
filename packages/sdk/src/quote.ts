// Off-chain views of what the program will compute: accrued indices, owed fees, equity, liquidation price, trigger
// conditions and expected fills. Built on the bit-exact math port, so keepers and the app agree with the program.

import type { ConfigParams, Market, Pool, Position } from './accounts';
import { OrderKind, Side } from './constants';
import * as m from './math';

const side = (s: number): m.Side => (s === Side.Long ? 'Long' : 'Short');

export interface Indices {
  borrow: bigint;
  fundingLong: bigint;
  fundingShort: bigint;
}

/** Borrow and funding indices accrued to `nowSecs`, exactly as the program would before acting. */
export function accruedIndices(pool: Pool, market: Market, params: ConfigParams, nowSecs: bigint): Indices {
  let borrow = pool.borrowIndex;
  const dtB = nowSecs - pool.borrowLastTs;
  if (dtB > 0n) {
    const util = m.utilizationBps(pool.reserved, pool.assets);
    const apr = m.borrowAprBps(util, BigInt(params.borrowKinkUtilBps), BigInt(params.borrowKinkAprBps), BigInt(params.borrowMaxAprBps));
    borrow = m.accrueBorrow(borrow, m.borrowRatePerSec(apr), dtB);
  }
  let fundingLong = market.fundingIndexLong;
  let fundingShort = market.fundingIndexShort;
  const dtF = nowSecs - market.lastAccrualTs;
  if (dtF > 0n) [fundingLong, fundingShort] = m.accrueFunding(fundingLong, fundingShort, market.fundingRate, dtF);
  return { borrow, fundingLong, fundingShort };
}

export interface Owed {
  borrow: bigint;
  funding: bigint;
  total: bigint;
}

export function positionOwed(pos: Position, idx: Indices): Owed {
  const borrow = m.owed(pos.sizeUsd, idx.borrow, pos.entryBorrowIndex);
  const fIdx = pos.side === Side.Long ? idx.fundingLong : idx.fundingShort;
  const funding = m.owed(pos.sizeUsd, fIdx, pos.entryFundingIndex);
  const b = borrow > 0n ? borrow : 0n;
  return { borrow: b, funding, total: b + funding };
}

export interface Health {
  pnl: bigint;
  equity: bigint;
  maintenance: bigint;
  liquidatable: boolean;
}

/** Equity at the oracle mid price net of owed fees and the close fee; liquidatable at or below maintenance. */
export function positionHealth(pos: Position, market: Market, mid12: bigint, owed: Owed): Health {
  const pnl = m.pnl(side(pos.side), pos.sizeUsd, pos.units, mid12);
  const closeFee = m.closeFee(pos.units, mid12, BigInt(market.params.closeFeeBps));
  const equity = m.equity(pos.collateral, pnl, owed.total, closeFee);
  const maintenance = m.maintenanceMargin(pos.sizeUsd, BigInt(market.params.mmrBps));
  return { pnl, equity, maintenance, liquidatable: equity <= maintenance };
}

/**
 * Price at which the position becomes liquidatable (12 decimals), given what it owes now:
 * long `(S(1+mmr) − C + owed) / (U(1 − fc))`, short `(C + S(1−mmr) − owed) / (U(1 + fc))`.
 */
export function liquidationPrice(pos: Position, market: Market, owedTotal: bigint): bigint {
  const S = pos.sizeUsd;
  const mmr = BigInt(market.params.mmrBps);
  const fc = BigInt(market.params.closeFeeBps);
  if (pos.units === 0n) return 0n;
  if (pos.side === Side.Long) {
    const num = (S * (10_000n + mmr)) / 10_000n - pos.collateral + owedTotal;
    if (num <= 0n) return 0n;
    return (num * 10n ** 18n * 10_000n) / (pos.units * (10_000n - fc));
  }
  const num = pos.collateral + (S * (10_000n - mmr)) / 10_000n - owedTotal;
  if (num <= 0n) return 0n;
  return (num * 10n ** 18n * 10_000n) / (pos.units * (10_000n + fc));
}

/** Order trigger rule, identical to the program's. */
export function triggered(kind: number, orderSide: number, trigger: bigint, mid12: bigint): boolean {
  const long = orderSide === Side.Long;
  switch (kind) {
    case OrderKind.Limit:
      return long ? mid12 <= trigger : mid12 >= trigger;
    case OrderKind.Stop:
      return long ? mid12 >= trigger : mid12 <= trigger;
    case OrderKind.TakeProfit:
      return long ? mid12 >= trigger : mid12 <= trigger;
    case OrderKind.StopLoss:
      return long ? mid12 <= trigger : mid12 >= trigger;
    default:
      return false;
  }
}

export interface Fill {
  price: bigint;
  spread: bigint;
  impact: bigint;
}

/** Expected fill for `size` at the oracle price and confidence, given the market's current skew. */
export function expectedFill(market: Market, mid12: bigint, conf12: bigint, size: bigint, isBuy: boolean): Fill {
  const p = market.params;
  const spread = m.spreadFrac(mid12, conf12, p.minSpreadFrac, BigInt(p.confMultBps));
  const skew = market.oiLong - market.oiShort;
  const impact = m.impactFrac(skew, isBuy ? size : -size, p.impactDepthUsd, BigInt(p.impactCapBps));
  return { price: m.fillPrice(mid12, spread, impact, isBuy), spread, impact };
}

/** A tick's mantissa and exponent as a 12-decimal price. */
export const price12 = (mantissa: bigint, expo: number) => m.normalizePrice(mantissa, BigInt(expo));
export const conf12 = (mantissa: bigint, expo: number) => (mantissa > 0n ? m.normalizeConf(mantissa, BigInt(expo)) : 0n);
