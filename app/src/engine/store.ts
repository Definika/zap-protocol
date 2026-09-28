// Live engine data for the app: markets, prices, pool, the signed-in trader's account and history, candles and trades.
// A small observable; the terminal subscribes and re-renders (throttled to animation frames).

import { MARKETS, type MarketInfo } from '@zap-protocol/sdk';
import { get, stream } from './client';

/** Integers arrive as decimal strings. */
export type Num = string;

export interface Tick {
  feedId: number;
  price: Num;
  expo: number;
  conf: Num;
  tsUs: Num;
}

export interface OnchainMarket {
  index: number;
  status: number;
  feedId: number;
  params: Record<string, Num | number>;
  oiLong: Num;
  oiShort: Num;
  fundingRate: Num;
  lastPrice: Num;
  lastPriceTsUs: Num;
  cumVolume: Num;
  [k: string]: unknown;
}

export interface MarketStats {
  volume24h: Num;
  trades24h: number;
  /** 12-decimal price 24h ago (or at `openAt`, when history is shorter), null without history. */
  open24h: Num | null;
  openAt?: number;
}

export interface MarketView extends MarketInfo {
  onchain: OnchainMarket | null;
  price: Tick | null;
  stats?: MarketStats;
}

export interface PositionJson {
  positionId: Num;
  sizeUsd: Num;
  collateral: Num;
  units: Num;
  entryFundingIndex: Num;
  entryBorrowIndex: Num;
  tpPrice: Num;
  slPrice: Num;
  openedAt: Num;
  marketIndex: number;
  side: number;
  realizedPnl: Num;
  feesPaid: Num;
}

export interface OrderJson {
  orderId: Num;
  positionId: Num;
  sizeUsd: Num;
  collateralEscrow: Num;
  feeEscrow: Num;
  triggerPrice: Num;
  acceptablePrice: Num;
  createdAt: Num;
  tpPrice: Num;
  slPrice: Num;
  marketIndex: number;
  kind: number;
  side: number;
  flags: number;
}

export interface AccountJson {
  owner: string;
  sessionKey: string;
  sessionExpiresAt: Num;
  balance: Num;
  lpShares: Num;
  lpCostBasis: Num;
  realizedPnl: Num;
  fundingPaid: Num;
  borrowPaid: Num;
  volume: Num;
  positions: PositionJson[];
  orders: OrderJson[];
}

export interface FillJson {
  sig: string;
  ts: Num;
  market: number;
  side: number;
  kind: number;
  size_delta: Num;
  size_after?: Num;
  fill_price: Num;
  oracle_price: Num;
  open_fee: Num;
  close_fee: Num;
  funding_paid: Num;
  borrow_paid: Num;
  pnl: Num;
  payout: Num;
  position_id: Num;
}

/** Vault share price and NAV over time. */
export interface VaultPoint {
  t: number;
  sharePrice: number;
  nav: Num;
}

/** The vault's realized income for one UTC day, by source (signed USD, 6 decimals). */
export interface EarningsDay {
  t: number;
  fees: Num;
  borrow: Num;
  liquidation: Num;
  funding: Num;
  traders: Num;
}

export interface LeaderRow {
  rank: number;
  owner: string;
  pnl: Num;
  fees: Num;
  funding: Num;
  netPnl: Num;
  volume: Num;
  trades: number;
  deposits: Num;
  roi: number | null;
}

export interface Candle {
  t: number;
  o: Num;
  h: Num;
  l: Num;
  c: Num;
  v: Num;
}

type Listener = () => void;

class Store {
  markets = new Map<number, MarketView>();
  /** By Pyth feed id. */
  prices = new Map<number, Tick>();
  /** Last price direction per feed (+1 / -1) and when it changed, for flashes. */
  dir = new Map<number, { d: number; at: number }>();
  pool: Record<string, Num | number> | null = null;
  /** Vault NAV, share price, APR (percent, null without enough history) and free liquidity, from the engine. */
  vault: { nav: Num; sharePrice: number; apr: number | null; withdrawable: Num; updatedAt: number } | null = null;
  vaultHistory = new Map<string, VaultPoint[]>();
  earnings: { days: EarningsDay[]; totals: Omit<EarningsDay, 't'> } | null = null;
  equity = new Map<string, { t: number; equity: Num }[]>();
  leaderboard = new Map<string, { rows: LeaderRow[]; minVolumeForRoi: Num; updatedAt: number }>();
  myRank = new Map<string, LeaderRow | null>();
  slot: number | null = null;
  /** Round trip to the engine, measured every few seconds. */
  latencyMs: number | null = null;
  private started = false;
  private fetched = new Map<string, number>();
  config: Record<string, unknown> | null = null;
  account: AccountJson | null = null;
  accountLoaded = false;
  history: FillJson[] = [];
  trades = new Map<number, FillJson[]>();
  candles = new Map<string, Candle[]>();
  connected = false;
  oracleAgeMs = Infinity;
  oracleMode: 'dev' | 'pyth' = 'dev';
  private owner: string | null = null;
  private unsubOwner: (() => void) | null = null;
  private listeners = new Set<Listener>();

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Loads config, markets and prices (retrying until the engine answers) and subscribes to live updates once. */
  async init(): Promise<void> {
    if (this.started) return;
    this.started = true;
    stream.onStatus((up) => {
      this.connected = up;
      this.emit();
    });
    for (;;) {
      try {
        await this.load();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
    setInterval(() => void this.ping(), 5_000);
    void this.ping();
  }

  private async ping() {
    const t = performance.now();
    try {
      await get('/v1/health');
      this.latencyMs = Math.round(performance.now() - t);
    } catch {
      this.latencyMs = null;
    }
  }

  private async load() {
    const [config, markets, prices] = await Promise.all([
      get<Record<string, unknown>>('/v1/config'),
      get<MarketView[]>('/v1/markets'),
      get<{ ticks: Tick[] }>('/v1/prices'),
    ]);
    this.config = config;
    this.oracleMode = (config.oracleMode as 'dev' | 'pyth') ?? 'dev';
    this.pool = (config.pool as Record<string, Num | number>) ?? null;
    for (const m of markets) this.markets.set(m.index, m);
    this.applyTicks(prices.ticks);
    stream.subscribe('prices', (d) => this.applyTicks((d as { ticks: Tick[] }).ticks));
    stream.subscribe('markets', (d) => {
      const m = d as MarketView;
      const prev = this.markets.get(m.index);
      this.markets.set(m.index, { ...(prev ?? m), onchain: m.onchain });
      this.emit();
    });
    stream.subscribe('pool', (d) => {
      this.pool = d as Record<string, Num | number>;
      this.emit();
    });
    stream.subscribe('status', (d) => {
      const st = d as { oracle: { ageMs: number }; slot?: number };
      this.oracleAgeMs = st.oracle.ageMs;
      if (st.slot) this.slot = st.slot;
      this.emit();
    });
    stream.subscribe('vault', (d) => {
      this.vault = d as Store['vault'];
      this.emit();
    });
    void get<Store['vault'] & object>('/v1/vault')
      .then((v) => {
        if (v && 'sharePrice' in v) this.vault = v;
        this.emit();
      })
      .catch(() => {});
    this.emit();
  }

  /** Runs `load` unless the same key loaded within `maxAgeMs`. */
  private throttle(key: string, maxAgeMs: number, load: () => Promise<void>) {
    const last = this.fetched.get(key) ?? 0;
    if (Date.now() - last < maxAgeMs) return;
    this.fetched.set(key, Date.now());
    void load()
      .then(() => this.emit())
      .catch(() => this.fetched.delete(key));
  }

  loadVaultHistory(range: string) {
    this.throttle(`vh:${range}`, 60_000, async () => {
      this.vaultHistory.set(range, await get<VaultPoint[]>(`/v1/vault/history?range=${range}`));
    });
  }

  loadEarnings() {
    this.throttle('earn', 60_000, async () => {
      this.earnings = await get<NonNullable<Store['earnings']>>('/v1/vault/earnings?days=30');
    });
  }

  loadEquity(range: string) {
    const owner = this.owner;
    if (!owner) return;
    this.throttle(`eq:${owner}:${range}`, 60_000, async () => {
      this.equity.set(range, await get<{ t: number; equity: Num }[]>(`/v1/accounts/${owner}/equity?range=${range}`));
    });
  }

  loadLeaderboard(window: string, metric: string) {
    const key = `${window}:${metric}`;
    this.throttle(`lb:${key}`, 15_000, async () => {
      this.leaderboard.set(key, await get<NonNullable<ReturnType<Store['leaderboard']['get']>>>(`/v1/leaderboard?window=${window}&metric=${metric}`));
      if (this.owner) {
        const r = await get<{ row: LeaderRow | null }>(`/v1/leaderboard/${this.owner}?window=${window}&metric=${metric}`);
        this.myRank.set(key, r.row);
      }
    });
  }

  private applyTicks(ticks: Tick[]) {
    const now = Date.now();
    for (const t of ticks) {
      const prev = this.prices.get(t.feedId);
      if (prev && prev.price !== t.price) this.dir.set(t.feedId, { d: BigInt(t.price) > BigInt(prev.price) ? 1 : -1, at: now });
      this.prices.set(t.feedId, t);
    }
    this.oracleAgeMs = ticks[0] ? now - Number(BigInt(ticks[0].tsUs) / 1000n) : this.oracleAgeMs;
    this.emit();
  }

  /** Follows one trader's account (live) and loads their history. */
  setOwner(owner: string | null) {
    if (owner === this.owner) return;
    this.unsubOwner?.();
    this.owner = owner;
    this.account = null;
    this.accountLoaded = false;
    this.history = [];
    this.equity.clear();
    this.myRank.clear();
    for (const k of this.fetched.keys()) if (k.startsWith('eq:') || k.startsWith('lb:')) this.fetched.delete(k);
    if (!owner) return this.emit();
    this.unsubOwner = stream.subscribe(`account:${owner}`, (d) => {
      this.account = d as AccountJson | null;
      this.accountLoaded = true;
      this.emit();
      void this.loadHistory();
    });
    void this.loadHistory();
  }

  async loadHistory() {
    if (!this.owner) return;
    this.history = await get<FillJson[]>(`/v1/accounts/${this.owner}/history?limit=200`).catch(() => []);
    this.emit();
  }

  async loadCandles(market: number, tfSecs: number) {
    const key = `${market}:${tfSecs}`;
    const rows = await get<Candle[]>(`/v1/markets/${market}/candles?tf=${tfSecs}&limit=300`).catch(() => []);
    this.candles.set(key, rows);
    this.emit();
  }

  watchTrades(market: number) {
    if (this.trades.has(market)) return;
    this.trades.set(market, []);
    void get<FillJson[]>(`/v1/markets/${market}/trades?limit=50`).then((rows) => {
      this.trades.set(market, rows);
      this.emit();
    });
    stream.subscribe(`trades:${market}`, (d) => {
      const t = d as Record<string, unknown>;
      const row = {
        sig: String(t.signature),
        ts: String(t.ts),
        market,
        side: Number(t.side),
        kind: Number(t.kind),
        size_delta: String(t.sizeDelta),
        fill_price: String(t.fillPrice),
        oracle_price: String(t.oraclePrice),
      } as FillJson;
      this.trades.set(market, [row, ...(this.trades.get(market) ?? [])].slice(0, 50));
      this.emit();
    });
  }
}

export const store = new Store();
export const marketList = () => MARKETS.map((m) => store.markets.get(m.index)).filter((m): m is MarketView => !!m);
