// The terminal's actions as real transactions, plus the quotes its forms show. Each action keeps the design's toast
// texts; the pending toast now follows the actual relay and confirmation, and the success toast links the real
// signature. Balances and positions update from the account stream, never from local guesses.
//
// Trades are signed by the session key (no wallet pop-up); vault moves stay inside the trading account, so the session
// key signs those too.

import {
  OrderFlags,
  OrderKind,
  Side,
  accruedIndices,
  addCollateral,
  cancelOrder as cancelOrderIx,
  closePosition,
  conf12,
  expectedFill,
  lpDeposit,
  lpWithdraw,
  math,
  openPosition,
  placeOrder,
  positionOwed,
  price12,
  removeCollateral,
  reversePosition,
  setTpsl,
  updateOrder,
  type ConfigParams,
  type Market,
  type Pool,
  type Position,
} from '@zap-protocol/sdk';
import { describeError, type SendResult } from '../engine/tx';
import { store } from '../engine/store';
import type { Items, Zap } from '../wallet/types';
import type { DesignOrder, DesignPosition } from './map';

// The logic instance (loosely typed: it's the design's component).
type C = any;

const MAX = 2n ** 64n - 1n;
const P12 = (x: number) => BigInt(Math.round(x * 1e12));
const U6 = (x: number) => BigInt(Math.round(x * 1e6));
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const sideOf = (s: string) => (s === 'long' ? Side.Long : Side.Short);

/** Engine JSON (integers as decimal strings) back to the SDK's bigint shapes. */
export function revive<T>(v: unknown): T {
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v) as T;
  if (Array.isArray(v)) return v.map(revive) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) as T;
  return v as T;
}

const onchain = (index: number) => store.markets.get(index)?.onchain;
export const sdkMarket = (index: number): Market | null => (onchain(index) ? revive<Market>(onchain(index)) : null);
const sdkPool = (): Pool | null => (store.pool ? revive<Pool>(store.pool) : null);
const sdkParams = (): ConfigParams | null => {
  const p = (store.config?.protocol as { params?: unknown } | undefined)?.params;
  return p ? revive<ConfigParams>(p) : null;
};

/** Oracle mid and confidence (12 decimals) for a market. */
function mid(m: Market): { p: bigint; c: bigint } | null {
  const t = store.prices.get(m.feedId);
  if (!t) return null;
  return { p: price12(BigInt(t.price), t.expo), c: conf12(BigInt(t.conf), t.expo) };
}

export interface Quote {
  /** Average fill price. */
  price: number;
  /** Half-spread and impact as fractions of the price. */
  spread: number;
  impact: number;
}

/** What a market trade of `sizeUsd` would fill at now: the program's own spread and impact functions. */
export function quote(index: number, sizeUsd: number, isBuy: boolean): Quote | null {
  const m = sdkMarket(index);
  const px = m && mid(m);
  if (!m || !px) return null;
  try {
    const f = expectedFill(m, px.p, px.c, U6(Math.max(sizeUsd, 0)), isBuy);
    return { price: Number(f.price) / 1e12, spread: Number(f.spread) / 1e12, impact: Number(f.impact) / 1e12 };
  } catch {
    return null;
  }
}

/** Largest new position the market takes on one side now: open-interest cap, per-position cap and vault capacity. */
export function maxSize(index: number, isLong: boolean): number {
  const m = sdkMarket(index);
  const pool = sdkPool();
  const params = sdkParams();
  if (!m || !pool || !params) return 0;
  const assets = Number(pool.assets) / 1e6;
  const oiCap = (assets * (isLong ? m.params.oiCapLongBps : m.params.oiCapShortBps)) / 1e4;
  const oi = Number(isLong ? m.oiLong : m.oiShort) / 1e6;
  const util = (assets * params.maxUtilBps) / 1e4 - Number(pool.reserved) / 1e6;
  return Math.max(0, Math.min(oiCap - oi, Number(m.params.maxPositionUsd) / 1e6, util));
}

export interface Level {
  /** Average fill price for a trade of `cum` dollars. */
  p: number;
  usd: number;
  cum: number;
}

/**
 * The executable quote ladder: for each price level, how much can be bought (asks) or sold (bids) with an average
 * fill at or better than it. Same spread and quadratic impact as the program (impact only when the skew grows,
 * capped), inverted in closed form: an order of x fills at `P(1 ± s ± (x + 2k)/2D)`, k the skew it trades against.
 */
export function ladder(index: number, isBuy: boolean, prices: number[]): Level[] {
  const m = sdkMarket(index);
  const px = m && mid(m);
  if (!m || !px) return [];
  const P = Number(px.p) / 1e12;
  const s = quote(index, 0, isBuy)?.spread ?? 0;
  const D = Number(m.params.impactDepthUsd) / 1e6;
  const capFrac = m.params.impactCapBps / 1e4;
  const skew = Number(m.oiLong - m.oiShort) / 1e6;
  const k = isBuy ? skew : -skew;
  const most = maxSize(index, isBuy);
  let prev = 0;
  return prices.map((p) => {
    const frac = (isBuy ? p / P - 1 : 1 - p / P) - s;
    let cum = frac < 0 ? 0 : frac >= capFrac || D <= 0 ? most : 2 * D * frac - 2 * k;
    cum = Math.min(most, Math.max(prev, cum, 0));
    const lvl = { p, usd: cum - prev, cum };
    prev = cum;
    return lvl;
  });
}

/** Current borrow rate per hour as a fraction (vault utilization on the kinked curve). */
export function borrowHourly(): number {
  const pool = sdkPool();
  const p = sdkParams();
  if (!pool || !p) return 0;
  try {
    const util = math.utilizationBps(pool.reserved, pool.assets);
    const apr = math.borrowAprBps(util, BigInt(p.borrowKinkUtilBps), BigInt(p.borrowKinkAprBps), BigInt(p.borrowMaxAprBps));
    return Number(apr) / 10_000 / (365 * 24);
  } catch {
    return 0;
  }
}

/** Borrow and funding a position owes right now (USD, positive = owed), exactly as the program would settle them. */
export function owedUsd(raw: DesignPosition['raw']): number {
  const m = sdkMarket(raw.marketIndex);
  const pool = sdkPool();
  const params = sdkParams();
  if (!m || !pool || !params) return 0;
  try {
    const idx = accruedIndices(pool, m, params, BigInt(Math.floor(Date.now() / 1000)));
    return Number(positionOwed(revive<Position>(raw), idx).total) / 1e6;
  } catch {
    return 0;
  }
}

/**
 * Runs `work` (sign + relay) behind the design's pending → success/error toast. `done(ok)` runs once the transaction
 * confirmed or failed.
 */
export function tx(c: C, title: string, work: () => Promise<SendResult>, ok: string, body: string | null, done?: (ok: boolean) => void) {
  const z: Zap = c.props.zap;
  if (!z.tradingReady) {
    z.requireTrading();
    done?.(false);
    return;
  }
  const id = 't' + Date.now() + Math.random();
  c.push({ id, kind: 'pending', title, step: 0 });
  void (async () => {
    try {
      const h = await work();
      c.push({ id, kind: 'pending', title, step: 2 });
      await h.confirmed;
      c.push({ id, kind: 'success', title: ok, body, link: c.K.txUrl(h.signature) });
      setTimeout(() => c.dismiss(id), 9_000);
      done?.(true);
      void store.loadHistory();
    } catch (e) {
      c.push({ id, kind: 'error', title: 'Transaction failed', body: describeError(e) });
      setTimeout(() => c.dismiss(id), 9_000);
      done?.(false);
    }
  })();
}

const acc = (c: C, marketIndex: number) => {
  const z: Zap = c.props.zap;
  return { signer: z.session!, owner: z.owner!, market: marketIndex };
};

/** Worst acceptable price for a market trade at the live price and the user's slippage setting. */
function bound(c: C, symbol: string, buy: boolean): bigint {
  const lp = c.K.live.p[symbol];
  const slip = (Number(c.state.slip) || 1) / 100;
  return P12(buy ? lp * (1 + slip) : lp * (1 - slip));
}

export function open(c: C, side: 'long' | 'short') {
  const K = c.K;
  const s = c.state;
  const m = K.byId[s.market];
  const z: Zap = c.props.zap;
  const lev = Math.min(s.lev, m.max);
  const margin = c.formMargin();
  const size = margin * lev;
  const ot = s.otype || 'market';
  const px = c.num(s.px);
  const L = side === 'long';
  const tif = s.tif || 'gtc';
  const slip = (Number(s.slip) || 1) / 100;
  const ro = s.ro && ['market', 'limit', 'stop'].includes(ot);
  const tp = s.tpsl && !ro ? c.num(s.tp) || null : null;
  const sl = s.tpsl && !ro ? c.num(s.sl) || null : null;
  const tps: { p: number; q: number }[] | null =
    tp && s.tpMulti
      ? [{ p: tp, q: c.num(s.tpQ1) || 50 }]
          .concat((s.tpL || []).map((x: { p: string; q: string }) => ({ p: c.num(x.p), q: c.num(x.q) })).filter((x: { p: number; q: number }) => x.p > 0 && x.q > 0))
          .sort((a, b) => (L ? a.p - b.p : b.p - a.p))
      : null;
  c.setState({ confirm: null, confirmOn: s.dontAsk ? false : s.confirmOn, dontAsk: false });
  if (!z.tradingReady) return z.requireTrading();
  const a = acc(c, m.index);

  if (ro) {
    const opp: DesignPosition | undefined = s.positions.find((p: DesignPosition) => p.market === m.id && p.side !== side);
    if (!opp) return;
    if (ot === 'market' || tif === 'ioc') {
      const f = Math.min(1, size / opp.size);
      return f >= 0.999 ? close(c, opp) : reduce(c, opp, f);
    }
    // a reduce-only limit is a take-profit order on the opposite position, a reduce-only stop is a stop-loss order
    const rs = Math.min(size, opp.size);
    const kind = ot === 'limit' ? OrderKind.TakeProfit : OrderKind.StopLoss;
    return tx(
      c,
      `Place reduce-only ${ot} · ${m.id}`,
      () => z.trade([placeOrder(a.signer, a.owner, m.index, { side: sideOf(opp.side), kind, positionId: opp.pid, size: rs >= opp.size * 0.999 ? MAX : U6(rs), triggerPrice: P12(px) })]),
      `Reduce-only ${ot} placed · ${m.id}`,
      `Reduces ${cap(opp.side)} by ${K.usd(rs)} at ${K.num(px, m.dec)}`,
    );
  }

  if (ot === 'stop' || (ot === 'limit' && tif !== 'ioc')) {
    return tx(
      c,
      `Place ${ot} ${side} · ${m.id}`,
      () =>
        z.trade([
          placeOrder(a.signer, a.owner, m.index, {
            side: sideOf(side),
            kind: ot === 'limit' ? OrderKind.Limit : OrderKind.Stop,
            flags: tif === 'post' ? OrderFlags.PostOnly : 0,
            size: U6(size),
            collateral: U6(margin),
            triggerPrice: P12(px),
            // a stop fills at market once triggered: bound it by the slippage setting around the trigger
            acceptablePrice: ot === 'stop' ? P12(L ? px * (1 + slip) : px * (1 - slip)) : 0n,
            tpPrice: tp ? P12(tp) : 0n,
            slPrice: sl ? P12(sl) : 0n,
          }),
        ]),
      `${cap(ot)} order placed · ${m.id}`,
      `${cap(side)} ${K.usd(size)} at ${K.num(px, m.dec)}`,
    );
  }

  // Market order, or an IOC limit (fills now at the limit or better, or not at all).
  const worst = ot === 'limit' ? P12(px) : bound(c, m.id, L);
  return tx(
    c,
    `Open ${cap(side)} · ${m.id}`,
    async () => {
      const msg = await z.signedPrice(m.feedId);
      const items: Items = [
        openPosition(a, msg, {
          side: sideOf(side),
          size: U6(size),
          collateral: U6(margin),
          acceptablePrice: worst,
          tpPrice: tp && !tps ? P12(tp) : 0n,
          slPrice: sl ? P12(sl) : 0n,
        }),
      ];
      if (tps) {
        // Take-profit levels are reduce orders on the position this trade opens or adds to.
        const existing: DesignPosition | undefined = s.positions.find((p: DesignPosition) => p.market === m.id && p.side === side);
        const pid = existing ? existing.pid : BigInt((store.account as unknown as { nextPositionId?: string } | null)?.nextPositionId ?? '1');
        const total = (existing?.size ?? 0) + size;
        tps.forEach((l, i) =>
          items.push(
            placeOrder(a.signer, a.owner, m.index, {
              side: sideOf(side),
              kind: OrderKind.TakeProfit,
              positionId: pid,
              size: i === tps.length - 1 ? MAX : U6((total * l.q) / 100),
              triggerPrice: P12(l.p),
            }),
          ),
        );
      }
      return z.trade(items, 200_000 + 40_000 * (tps?.length ?? 0));
    },
    `${cap(side)} opened · ${m.id}`,
    `${K.usd(size)} at ${Math.round(lev * 10) / 10}×`,
  );
}

export function close(c: C, p: DesignPosition) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const m = K.byId[p.market];
  const pnl = K.pnlOf(p, K.live.p[p.market]);
  tx(
    c,
    `Close ${cap(p.side)} · ${p.market}`,
    async () => z.trade([closePosition(acc(c, m.index), await z.signedPrice(m.feedId), sideOf(p.side), p.pid, MAX, bound(c, p.market, p.side === 'short'))]),
    `Position closed · ${p.market}`,
    `≈ ${K.sUsd(pnl)} before fees`,
  );
}

export function reduce(c: C, p: DesignPosition, f: number) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const m = K.byId[p.market];
  const pc = Math.round(f * 100);
  c.setState({ edit: null });
  tx(
    c,
    `Close ${pc}% · ${p.market}`,
    async () =>
      z.trade([closePosition(acc(c, m.index), await z.signedPrice(m.feedId), sideOf(p.side), p.pid, f >= 0.999 ? MAX : U6(p.size * f), bound(c, p.market, p.side === 'short'))]),
    `Position reduced · ${p.market}`,
    `${pc}% closed`,
  );
}

export function reverse(c: C, p: DesignPosition) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const m = K.byId[p.market];
  const ns = p.side === 'long' ? 'short' : 'long';
  tx(
    c,
    `Reverse ${cap(p.side)} · ${p.market}`,
    async () => z.trade([reversePosition(acc(c, m.index), await z.signedPrice(m.feedId), sideOf(p.side), p.pid, bound(c, p.market, p.side === 'short'))]),
    `Reversed to ${cap(ns)} · ${p.market}`,
    `New ${ns} ${K.usd(p.size)}`,
  );
}

export function closeAll(c: C) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const ps: DesignPosition[] = c.state.positions.slice();
  if (!ps.length) return;
  c.setState({ caArm: false });
  // up to three closes per transaction, each with its own signed price
  for (let i = 0; i < ps.length; i += 3) {
    const batch = ps.slice(i, i + 3);
    tx(
      c,
      `Close ${batch.length} position${batch.length > 1 ? 's' : ''}`,
      async () =>
        z.trade(
          await Promise.all(
            batch.map(async (p) => {
              const m = K.byId[p.market];
              return closePosition(acc(c, m.index), await z.signedPrice(m.feedId), sideOf(p.side), p.pid, MAX, bound(c, p.market, p.side === 'short'));
            }),
          ),
          600_000,
        ),
      batch.length > 1 ? 'Positions closed' : 'Position closed',
      batch.map((p) => `${p.market} ${cap(p.side)}`).join(', '),
    );
  }
}

export function editColl(c: C, p: DesignPosition, d: number) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const m = K.byId[p.market];
  c.setState({ edit: null });
  tx(
    c,
    `${d > 0 ? 'Add' : 'Remove'} collateral · ${p.market}`,
    async () =>
      d > 0
        ? z.trade([addCollateral(acc(c, m.index), sideOf(p.side), p.pid, U6(d))])
        : z.trade([removeCollateral(acc(c, m.index), await z.signedPrice(m.feedId), sideOf(p.side), p.pid, U6(-d))]),
    d > 0 ? 'Collateral added' : 'Collateral removed',
    `${K.usd(Math.abs(d))} · leverage now ${Math.round((p.size / (p.margin + d)) * 10) / 10}×`,
  );
}

export function saveTpsl(c: C, p: DesignPosition, tp: number | null, sl: number | null) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const m = K.byId[p.market];
  c.setState({ edit: null });
  tx(
    c,
    `Update TP / SL · ${p.market}`,
    () => z.trade([setTpsl(acc(c, m.index), sideOf(p.side), p.pid, tp ? P12(tp) : 0n, sl ? P12(sl) : 0n)]),
    'TP / SL updated',
    `${p.market} · TP ${tp ? K.num(tp, m.dec) : '—'} / SL ${sl ? K.num(sl, m.dec) : '—'}`,
  );
}

export function clearTrig(c: C, p: DesignPosition, k: 'tp' | 'sl') {
  const lbl = k === 'tp' ? 'Take profit' : 'Stop loss';
  const z: Zap = c.props.zap;
  const m = c.K.byId[p.market];
  tx(
    c,
    `Cancel ${lbl.toLowerCase()} · ${p.market}`,
    () => z.trade([setTpsl(acc(c, m.index), sideOf(p.side), p.pid, k === 'tp' ? 0n : p.tp ? P12(p.tp) : 0n, k === 'sl' ? 0n : p.sl ? P12(p.sl) : 0n)]),
    `${lbl} cancelled`,
    p.market,
  );
}

export function cancelOrder(c: C, o: DesignOrder) {
  const z: Zap = c.props.zap;
  tx(
    c,
    `Cancel ${o.label.toLowerCase()} order · ${o.market}`,
    () => z.trade([cancelOrderIx(z.session!, z.owner!, o.marketIndex, o.oid)]),
    'Order cancelled',
    o.ro ? 'Reduce-only order removed' : `${c.K.usd(o.margin + o.fee)} returned to your balance`,
  );
}

/** Dragging a position's TP/SL line or an order line on the chart to a new price. */
export function moveLine(c: C, ln: { kind: string; pid?: number; oid?: number; p0: number; market: string }, price: number, done: (ok: boolean) => void) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const d = K.byId[ln.market].dec;
  const s = c.state;
  if (ln.kind === 'tp' || ln.kind === 'sl') {
    const pos: DesignPosition | undefined = s.positions.find((x: DesignPosition) => x.id === ln.pid);
    if (!pos) return done(false);
    const nm = ln.kind === 'tp' ? 'Take profit' : 'Stop loss';
    const tp = ln.kind === 'tp' ? price : pos.tp;
    const sl = ln.kind === 'sl' ? price : pos.sl;
    return tx(
      c,
      `Move ${nm.toLowerCase()} · ${pos.market}`,
      () => z.trade([setTpsl(acc(c, pos.marketIndex), sideOf(pos.side), pos.pid, tp ? P12(tp) : 0n, sl ? P12(sl) : 0n)]),
      `${nm} moved`,
      `${K.num(ln.p0, d)} → ${K.num(price, d)} · est. ${K.sUsd(K.pnlOf(pos, price))}`,
      done,
    );
  }
  const o: DesignOrder | undefined = s.orders.find((x: DesignOrder) => x.id === ln.oid);
  if (!o) return done(false);
  const slip = (Number(s.slip) || 1) / 100;
  // a moved stop keeps its slippage bound relative to the new trigger
  const acceptable = o.kind === OrderKind.Stop ? P12(o.side === 'long' ? price * (1 + slip) : price * (1 - slip)) : 0n;
  tx(
    c,
    `Move ${o.label.toLowerCase()} order · ${o.market}`,
    () => z.trade([updateOrder(z.session!, z.owner!, o.marketIndex, o.oid, P12(price), acceptable)]),
    'Order moved',
    `${K.num(ln.p0, d)} → ${K.num(price, d)}`,
    done,
  );
}

export function vault(c: C) {
  const K = c.K;
  const z: Zap = c.props.zap;
  const s = c.state;
  const amount = c.num(s.vamt);
  const n = store.markets.size;
  if (s.vtab === 'deposit') {
    tx(c, 'Deposit to vault', async () => z.trade([lpDeposit(z.session!, z.owner!, n, await z.signedAll(), U6(amount))], 600_000), 'Deposited to vault', `${K.usd(amount)} for ≈ ${K.num(amount / K.VAULT.price)} shares`);
  } else {
    const all = amount >= s.shares * K.VAULT.price * 0.999;
    const shares = all ? BigInt(store.account?.lpShares ?? '0') : U6(Math.min(s.shares, amount / K.VAULT.price));
    tx(c, 'Withdraw from vault', async () => z.trade([lpWithdraw(z.session!, z.owner!, n, await z.signedAll(), shares)], 600_000), 'Withdrawn from vault', `≈ ${K.usd(amount)} to your trading balance`);
  }
  c.setState({ vamt: '' });
}
