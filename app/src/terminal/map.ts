// Maps the live trading account and history into the shapes the terminal's view logic renders (dollar numbers,
// 'long'/'short', market symbols), keeping the raw on-chain ids for building transactions.

import { MARKETS, OrderFlags, OrderKind, TradeKind } from '@zap-protocol/sdk';
import type { AccountJson, FillJson, OrderJson, PositionJson } from '../engine/store';

const MAX = 2n ** 64n - 1n;
const usd = (v: string | number | bigint) => Number(v) / 1e6;
const px = (v: string | number | bigint) => Number(v) / 1e12;
const symbol = (index: number) => MARKETS[index]?.symbol ?? `#${index}`;
const sideName = (s: number): 'long' | 'short' => (s === 0 ? 'long' : 'short');
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export interface DesignPosition {
  id: number;
  pid: bigint;
  market: string;
  marketIndex: number;
  side: 'long' | 'short';
  lev: number;
  size: number;
  size0: number;
  entry: number;
  margin: number;
  /** Position-level take profit / stop loss (the program closes the whole position there). */
  tp: number | null;
  sl: number | null;
  /** Partial take-profit orders bound to this position. */
  tps: { p: number; q: number; oid: bigint }[] | null;
  /** Borrow and funding owed now (filled in by the view logic). */
  owed: number;
  openedAt: number;
  mode: 'isolated';
  raw: PositionJson;
}

export function toPosition(p: PositionJson, orders: OrderJson[]): DesignPosition {
  const size = usd(p.sizeUsd);
  const units = Number(p.units) / 1e12;
  const margin = usd(p.collateral);
  const levels = orders
    .filter((o) => o.kind === OrderKind.TakeProfit && o.positionId === p.positionId && o.marketIndex === p.marketIndex)
    .map((o) => ({ p: px(o.triggerPrice), q: BigInt(o.sizeUsd) >= MAX ? 100 : Math.min(100, (usd(o.sizeUsd) / size) * 100), oid: BigInt(o.orderId) }))
    .sort((a, b) => (p.side === 0 ? a.p - b.p : b.p - a.p));
  return {
    id: Number(p.positionId),
    pid: BigInt(p.positionId),
    market: symbol(p.marketIndex),
    marketIndex: p.marketIndex,
    side: sideName(p.side),
    lev: margin ? size / margin : 0,
    size,
    size0: size,
    entry: units ? size / units : 0,
    margin,
    tp: Number(p.tpPrice) ? px(p.tpPrice) : null,
    sl: Number(p.slPrice) ? px(p.slPrice) : null,
    tps: levels.length ? levels : null,
    owed: 0,
    openedAt: Number(p.openedAt) * 1000,
    mode: 'isolated',
    raw: p,
  };
}

const ORDER_LABEL: Record<number, string> = {
  [OrderKind.Limit]: 'Limit',
  [OrderKind.Stop]: 'Stop',
  [OrderKind.TakeProfit]: 'Take profit',
  [OrderKind.StopLoss]: 'Stop loss',
};

export interface DesignOrder {
  id: number;
  oid: bigint;
  market: string;
  marketIndex: number;
  /** Direction of the trade the order makes: reduce orders on a long sell, so they show as 'short'. */
  side: 'long' | 'short';
  /** Chart and validation semantics: limits fill at the price or better, stops trigger past it. */
  type: 'limit' | 'stop';
  kind: number;
  label: string;
  ro: boolean;
  tif: 'gtc' | 'post';
  price: number;
  lev: number;
  size: number;
  margin: number;
  fee: number;
  tp: number | null;
  sl: number | null;
  t: number;
  mode: 'isolated';
  /** Closes whatever is left of the position. */
  full: boolean;
  raw: OrderJson;
}

export function toOrder(o: OrderJson, positions: DesignPosition[]): DesignOrder {
  const reduce = o.kind === OrderKind.TakeProfit || o.kind === OrderKind.StopLoss;
  const full = BigInt(o.sizeUsd) >= MAX;
  const pos = reduce ? positions.find((p) => p.pid === BigInt(o.positionId)) : undefined;
  const size = full ? (pos?.size ?? 0) : usd(o.sizeUsd);
  const margin = usd(o.collateralEscrow);
  return {
    id: Number(o.orderId),
    oid: BigInt(o.orderId),
    market: symbol(o.marketIndex),
    marketIndex: o.marketIndex,
    side: reduce ? sideName(1 - o.side) : sideName(o.side),
    type: o.kind === OrderKind.Limit || o.kind === OrderKind.TakeProfit ? 'limit' : 'stop',
    kind: o.kind,
    label: ORDER_LABEL[o.kind] ?? 'Order',
    ro: reduce,
    tif: o.flags & OrderFlags.PostOnly ? 'post' : 'gtc',
    price: px(o.triggerPrice),
    lev: reduce ? (pos?.lev ?? 0) : margin ? size / margin : 0,
    size,
    margin,
    fee: usd(o.feeEscrow),
    tp: Number(o.tpPrice) ? px(o.tpPrice) : null,
    sl: Number(o.slPrice) ? px(o.slPrice) : null,
    t: Number(o.createdAt) * 1000,
    mode: 'isolated',
    full,
    raw: o,
  };
}

const ACTION: Record<number, (side: string) => string> = {
  [TradeKind.Open]: (s) => `Open ${cap(s)}`,
  [TradeKind.Close]: (s) => `Close ${cap(s)}`,
  [TradeKind.Liquidation]: (s) => `Liquidated ${cap(s)}`,
  [TradeKind.TakeProfit]: (s) => `Take profit ${cap(s)}`,
  [TradeKind.StopLoss]: (s) => `Stop loss ${cap(s)}`,
  [TradeKind.LimitFill]: (s) => `Limit ${cap(s)}`,
  [TradeKind.StopFill]: (s) => `Stop ${cap(s)}`,
};

/** Trades that open or add to a position (the rest reduce or close it). */
export const OPENING: number[] = [TradeKind.Open, TradeKind.LimitFill, TradeKind.StopFill];

export interface DesignHistory {
  t: number;
  market: string;
  action: string;
  price: number;
  size: number;
  fee: number;
  pnl: number | null;
  sig: string;
  kind: number;
}

export function toHistory(f: FillJson): DesignHistory {
  return {
    t: Number(f.ts) * 1000,
    market: symbol(f.market),
    action: (ACTION[f.kind] ?? (() => 'Trade'))(sideName(f.side)),
    price: px(f.fill_price),
    size: Math.abs(usd(f.size_delta)),
    fee: usd(f.open_fee) + usd(f.close_fee),
    pnl: OPENING.includes(f.kind) ? null : usd(f.pnl),
    sig: f.sig,
    kind: f.kind,
  };
}

export interface DesignFunding {
  t: number;
  market: string;
  side: string;
  size: number;
  /** Funding settled as a share of the position size, in percent, over the period since the last settlement. */
  rate: number;
  /** Positive: received; negative: paid. */
  pay: number;
}

/** Funding settles whenever a position changes; each settlement is one row, on the size held before the trade. */
export function toFunding(f: FillJson): DesignFunding | null {
  const paid = usd(f.funding_paid);
  if (!paid) return null;
  const delta = Math.abs(usd(f.size_delta));
  const after = usd(f.size_after ?? 0);
  const size = OPENING.includes(f.kind) ? after - delta : after + delta;
  return { t: Number(f.ts) * 1000, market: symbol(f.market), side: cap(sideName(f.side)), size, rate: size ? (Math.abs(paid) / size) * 100 : 0, pay: -paid };
}

export function fromAccount(a: AccountJson | null, fills: FillJson[]) {
  const positions = a ? a.positions.map((p) => toPosition(p, a.orders)) : [];
  const orders = a ? a.orders.map((o) => toOrder(o, positions)) : [];
  return {
    positions,
    orders,
    usdc: a ? usd(a.balance) : 0,
    shares: a ? usd(a.lpShares) : 0,
    vdep: a ? usd(a.lpCostBasis) : 0,
    history: fills.map(toHistory),
    funding: fills.map(toFunding).filter((x): x is DesignFunding => !!x),
  };
}
