// Vault and equity snapshots. Keeps a live vault view (NAV at oracle prices, LP share price, APR, withdrawable liquidity)
// for the API and, with the `snapshots` role, records the vault every minute and every trading account's equity every
// five minutes for the charts.

import {
  accruedIndices,
  math,
  openOrders,
  openPositions,
  positionHealth,
  positionOwed,
  price12,
  vaultNav,
  type Indices,
  type Market,
  type TradingAccount,
} from '@zap-protocol/sdk';
import type { Db } from './db';
import type { Mirror } from './chain/mirror';
import type { OracleHub } from './oracle/hub';
import { logger } from './log';

const log = logger('snapshots');
const DAY = 86_400;
const VIEW_MS = 5_000;
const VAULT_MS = 60_000;
const EQUITY_MS = 5 * 60_000;
/** APR looks back up to a week and needs at least an hour of history. */
const APR_WINDOW_SECS = 7 * DAY;
const APR_MIN_SECS = 3_600;
const MAX_POINTS = 360;

const nowSecs = () => Math.floor(Date.now() / 1000);

export interface VaultView {
  /** USD, 6 decimals. */
  nav: bigint;
  /** USD per LP share. */
  sharePrice: number;
  /** Annualized share-price growth in percent; null with under an hour of history. */
  apr: number | null;
  /** USD, 6 decimals: assets not reserved for open positions, the most LPs can withdraw now. */
  withdrawable: bigint;
  /** Unix ms. */
  updatedAt: number;
}

/**
 * USD per LP share (shares have 6 decimals), with the program's virtual offsets: what burning one share pays, computed
 * for 1e12 shares so the payout's rounding stays far below display precision.
 */
export const sharePrice = (nav: bigint, lpSupply: bigint) => Number(math.assetsForShares(10n ** 18n, lpSupply, nav)) / 1e18;

const RANGES: Record<string, number> = { '7d': 7 * DAY, '30d': 30 * DAY, all: Infinity };
/** Seconds of history for a `range` query (`7D`, `30D` or `All`, any case); undefined if unrecognized. */
export const rangeSecs = (range = '7D') => RANGES[range.toLowerCase()];

/** Start of a range of `secs` ending at `to` (0 for all history). */
const since = (to: number, secs: number) => (Number.isFinite(secs) ? to - secs : 0);
/** Bucket width that splits `[from, to]` into at most `MAX_POINTS` buckets. */
const bucketSecs = (from: number, to: number) => Math.max(1, Math.ceil((to - from + 1) / MAX_POINTS));

/** Balance, order escrows and each position's collateral plus PnL at the mid, net of owed borrow and funding; null if a position can't be priced. */
function accountEquity(a: TradingAccount, markets: Map<number, Market>, prices: Map<number, bigint>, indices: (m: Market) => Indices) {
  let equity = a.balance;
  for (const o of openOrders(a)) equity += o.collateralEscrow + o.feeEscrow;
  for (const p of openPositions(a)) {
    const market = markets.get(p.marketIndex);
    const mid = prices.get(p.marketIndex);
    if (!market || mid === undefined) return null;
    const owed = positionOwed(p, indices(market));
    equity += p.collateral + positionHealth(p, market, mid, owed).pnl - owed.total;
  }
  return equity;
}

type Listener = (v: VaultView) => void;

export class Snapshots {
  view: VaultView | null = null;
  /** Oldest snapshot inside the APR window: its time and share price. */
  private base: { ts: number; price: number } | null = null;
  private listeners = new Set<Listener>();
  private timers: NodeJS.Timeout[] = [];
  private lastWarn = 0;

  constructor(
    private readonly db: Db,
    private readonly mirror: Mirror,
    private readonly hub: OracleHub,
  ) {}

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Keeps the vault view current; with `record`, also writes snapshots, one of each right away so charts start now. */
  async start(record: boolean) {
    await this.loadBase();
    if (record) {
      await this.recordVault();
      await this.recordEquity();
    }
    this.refresh();
    this.timers.push(setInterval(() => this.refresh(), VIEW_MS));
    if (record) {
      this.timers.push(setInterval(() => void this.recordVault(), VAULT_MS));
      this.timers.push(setInterval(() => void this.recordEquity(), EQUITY_MS));
    } else {
      // another process records: follow its snapshots for the APR
      this.timers.push(setInterval(() => void this.loadBase(), VAULT_MS));
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  /** 12-decimal mid by market index from the latest oracle ticks; a market's last on-chain price if the hub has none. */
  private prices() {
    const ticks = this.hub.latest?.ticks;
    const out = new Map<number, bigint>();
    for (const m of this.mirror.markets.values()) {
      const t = ticks?.get(m.feedId);
      const p = t && t.price > 0n ? price12(t.price, t.expo) : m.lastPrice;
      if (p > 0n) out.set(m.index, p);
    }
    return out;
  }

  /** Recomputes the vault view and tells listeners; keeps the previous view if NAV can't be priced. */
  private refresh() {
    const view = this.compute();
    if (!view) return;
    this.view = view;
    for (const l of this.listeners) {
      try {
        l(view);
      } catch {
        // listeners handle their own errors
      }
    }
  }

  /** The vault view at the latest prices, or null if NAV can't be priced. */
  private compute(): VaultView | null {
    const pool = this.mirror.pool;
    const params = this.mirror.config?.params;
    if (!pool || !params) return null;
    let nav: bigint;
    try {
      nav = vaultNav(pool, [...this.mirror.markets.values()], this.prices(), params, BigInt(nowSecs()));
    } catch (e) {
      if (Date.now() - this.lastWarn > 60_000) {
        this.lastWarn = Date.now();
        log.warn('cannot price the vault', e instanceof Error ? e.message : e);
      }
      return null;
    }
    const price = sharePrice(nav, pool.lpSupply);
    const span = this.base ? nowSecs() - this.base.ts : 0;
    const apr = this.base && span >= APR_MIN_SECS ? (price / this.base.price - 1) * ((365 * DAY) / span) * 100 : null;
    const withdrawable = pool.assets > pool.reserved ? pool.assets - pool.reserved : 0n;
    return { nav, sharePrice: price, apr, withdrawable, updatedAt: Date.now() };
  }

  private async loadBase() {
    try {
      const [r] = await this.db.query<{ ts: string; nav: string; lp_supply: string }>(
        'select ts::text, nav::text, lp_supply::text from vault_snapshots where ts >= $1 order by ts limit 1',
        [nowSecs() - APR_WINDOW_SECS],
      );
      this.base = r ? { ts: Number(r.ts), price: sharePrice(BigInt(r.nav), BigInt(r.lp_supply)) } : null;
    } catch (e) {
      log.warn('could not load the APR base', e);
    }
  }

  private async recordVault() {
    try {
      // NAV and pool read together, so the row is consistent
      const pool = this.mirror.pool;
      const v = this.compute();
      if (!pool || !v) return;
      await this.db.query(
        'insert into vault_snapshots (ts, nav, lp_supply, assets, reserved) values ($1, $2, $3, $4, $5) on conflict (ts) do nothing',
        [Math.floor(v.updatedAt / 1000), v.nav.toString(), pool.lpSupply.toString(), pool.assets.toString(), pool.reserved.toString()],
      );
      await this.loadBase();
    } catch (e) {
      log.warn('vault snapshot failed', e);
    }
  }

  private async recordEquity() {
    try {
      const pool = this.mirror.pool;
      const params = this.mirror.config?.params;
      if (!pool || !params) return;
      const ts = nowSecs();
      const prices = this.prices();
      const cache = new Map<number, Indices>();
      const indices = (m: Market) => {
        let i = cache.get(m.index);
        if (!i) cache.set(m.index, (i = accruedIndices(pool, m, params, BigInt(ts))));
        return i;
      };
      const rows: [owner: string, equity: string][] = [];
      for (const [owner, { account }] of this.mirror.accounts) {
        const equity = accountEquity(account, this.mirror.markets, prices, indices);
        if (equity !== null) rows.push([owner, equity.toString()]);
      }
      // all rows share the timestamp ($1); 500 rows per statement
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const values = chunk.map((_, j) => `($${2 * j + 2}, $1, $${2 * j + 3})`).join(', ');
        await this.db.query(`insert into equity_snapshots (owner, ts, equity) values ${values} on conflict do nothing`, [ts, ...chunk.flat()]);
      }
    } catch (e) {
      log.warn('equity snapshot failed', e);
    }
  }

  // Histories are thinned over the span actually recorded inside the range, so a young history keeps full detail.

  /** Share price and NAV over the last `secs` (Infinity: all history), at most 360 points, ascending. */
  async vaultHistory(secs: number) {
    const to = nowSecs();
    const from = await this.first('select min(ts)::text as t from vault_snapshots where ts >= $1', [since(to, secs)]);
    if (from === null) return [];
    const rows = await this.db.query<{ ts: string; nav: string; lp_supply: string }>(
      `select distinct on ((ts - $1) / $3) ts::text, nav::text, lp_supply::text from vault_snapshots
       where ts between $1 and $2 order by (ts - $1) / $3, ts desc`,
      [from, to, bucketSecs(from, to)],
    );
    return rows.map((r) => ({ t: Number(r.ts) * 1000, sharePrice: sharePrice(BigInt(r.nav), BigInt(r.lp_supply)), nav: r.nav }));
  }

  /** An account's equity over the last `secs` (Infinity: all history), at most 360 points, ascending. */
  async equityHistory(owner: string, secs: number) {
    const to = nowSecs();
    const from = await this.first('select min(ts)::text as t from equity_snapshots where owner = $1 and ts >= $2', [owner, since(to, secs)]);
    if (from === null) return [];
    const rows = await this.db.query<{ ts: string; equity: string }>(
      `select distinct on ((ts - $1) / $3) ts::text, equity::text from equity_snapshots
       where owner = $4 and ts between $1 and $2 order by (ts - $1) / $3, ts desc`,
      [from, to, bucketSecs(from, to), owner],
    );
    return rows.map((r) => ({ t: Number(r.ts) * 1000, equity: r.equity }));
  }

  /** The first snapshot time from a query of `min(ts)`, or null without one. */
  private async first(sql: string, params: unknown[]) {
    const [r] = await this.db.query<{ t: string | null }>(sql, params);
    return r?.t ? Number(r.t) : null;
  }
}
