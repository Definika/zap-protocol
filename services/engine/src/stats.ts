// Aggregates over indexed fills and events for the API: 24h market stats, the trader leaderboard and the vault's daily
// earnings by source. Each is computed on a timer or cached briefly, so request load never becomes query load.

import { MARKETS, TradeKind, math } from '@zap-protocol/sdk';
import type { Db } from './db';
import type { Candles } from './candles';
import type { Mirror } from './chain/mirror';
import { logger } from './log';

const log = logger('stats');
const DAY = 86_400;
const MARKET_STATS_MS = 30_000;
const LEADERBOARD_TTL_MS = 15_000;
const EARNINGS_TTL_MS = 30_000;

const nowSecs = () => Math.floor(Date.now() / 1000);

/** Memoizes `fn` per key for `ttlMs`; concurrent callers share one computation, and failures aren't kept. */
function cached<K, V>(ttlMs: number, fn: (key: K) => Promise<V>) {
  const memo = new Map<K, { at: number; value: Promise<V> }>();
  return (key: K) => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = fn(key);
    memo.set(key, { at: Date.now(), value });
    value.catch(() => memo.get(key)?.value === value && memo.delete(key));
    return value;
  };
}

export interface MarketStats {
  /** USD, 6 decimals: Σ|size| filled in the last 24h. */
  volume24h: bigint;
  trades24h: number;
  /** 12-decimal open of the one-minute candle at now − 24h, or of the earliest candle when history is shorter. */
  open24h: bigint | null;
  /** Unix ms of that candle, so the change can be labeled with its real span. */
  openAt: number | null;
}

const NO_STATS: MarketStats = { volume24h: 0n, trades24h: 0, open24h: null, openAt: null };

export const LEADERBOARD_WINDOWS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, all: Infinity } as const;
export type LeaderboardWindow = keyof typeof LEADERBOARD_WINDOWS;
export const LEADERBOARD_METRICS = ['pnl', 'volume', 'roi'] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];
/** Window volume (USD, 6 decimals) a trader needs to be ranked by ROI. */
export const MIN_VOLUME_FOR_ROI = 1_000_000_000n;

export interface LeaderboardRow {
  rank: number;
  owner: string;
  /** Realized PnL (USD, 6 decimals, like every amount here). */
  pnl: bigint;
  /** Open, close (or liquidation) and borrow fees paid. */
  fees: bigint;
  /** Net funding paid; negative when received. */
  funding: bigint;
  netPnl: bigint;
  volume: bigint;
  trades: number;
  /** All-time deposits into the trading account. */
  deposits: bigint;
  /** netPnl / deposits; null without deposits. */
  roi: number | null;
}

const desc = (a: bigint, b: bigint) => (a > b ? -1 : a < b ? 1 : 0);
/** `pnl` ranks by PnL net of fees and funding, the figure ROI is based on. */
const ORDER: Record<LeaderboardMetric, (a: LeaderboardRow, b: LeaderboardRow) => number> = {
  pnl: (a, b) => desc(a.netPnl, b.netPnl) || desc(a.volume, b.volume) || a.owner.localeCompare(b.owner),
  volume: (a, b) => desc(a.volume, b.volume) || desc(a.netPnl, b.netPnl) || a.owner.localeCompare(b.owner),
  roi: (a, b) => (b.roi ?? 0) - (a.roi ?? 0) || desc(a.netPnl, b.netPnl) || a.owner.localeCompare(b.owner),
};

/** Vault income (USD, 6 decimals, signed): positive is earned by LPs. */
export interface Earnings {
  /** Open and close fees, net of the protocol share. */
  fees: bigint;
  /** Borrow fees settled on trades (net of the protocol share) and liquidations. */
  borrow: bigint;
  /** The vault's part of liquidation fees. */
  liquidation: bigint;
  /** Net funding paid by traders. */
  funding: bigint;
  /** Traders' realized losses minus their profits, less any bad debt the vault absorbed. */
  traders: bigint;
}

const noEarnings = (): Earnings => ({ fees: 0n, borrow: 0n, liquidation: 0n, funding: 0n, traders: 0n });

interface FillRow {
  sig: string;
  ix: number;
  ts: string;
  kind: number;
  account: string;
  market: number;
  side: number;
  position_id: string;
  size_delta: string;
  collateral_after: string;
  open_fee: string;
  close_fee: string;
  borrow_paid: string;
  funding_paid: string;
  pnl: string;
  payout: string;
  to_vault_fee: string | null;
  bad_debt: string | null;
}

/** The protocol's fee share (bps) in force at a time, from indexed `ConfigUpdated` events; `fallback` before the first. */
function protocolShareAt(updates: { ts: string; bps: string | null }[], fallback: number) {
  const history = updates.flatMap((u) => (u.bps === null ? [] : [{ ts: Number(u.ts), bps: BigInt(u.bps) }]));
  return (ts: number) => {
    let bps = BigInt(fallback);
    for (const u of history) {
      if (u.ts > ts) break;
      bps = u.bps;
    }
    return bps;
  };
}

export class Stats {
  private markets = new Map<number, MarketStats>();

  constructor(
    private readonly db: Db,
    private readonly mirror: Mirror,
    private readonly candles: Candles,
  ) {}

  /** Computes market stats now, then every 30s. */
  async start() {
    const refresh = () => this.refreshMarkets().catch((e) => log.warn('market stats failed', e));
    await refresh();
    setInterval(() => void refresh(), MARKET_STATS_MS);
  }

  market(index: number): MarketStats {
    return this.markets.get(index) ?? NO_STATS;
  }

  private async refreshMarkets() {
    const since = nowSecs() - DAY;
    const [fills, opens] = await Promise.all([
      this.db.query<{ market: number; volume: string; trades: number }>(
        'select market, sum(abs(size_delta))::text as volume, count(*)::int as trades from fills where ts >= $1 group by market',
        [since],
      ),
      this.candles.firstSince(since),
    ]);
    const byMarket = new Map(fills.map((r) => [Number(r.market), r]));
    const next = new Map<number, MarketStats>();
    for (const { index } of MARKETS) {
      const f = byMarket.get(index);
      const o = opens.get(index);
      next.set(index, {
        volume24h: f ? BigInt(f.volume) : 0n,
        trades24h: f ? Number(f.trades) : 0,
        open24h: o?.o ?? null,
        openAt: o ? o.t * 1000 : null,
      });
    }
    this.markets = next;
  }

  /** Every trader with fills in the window, ranked by `metric` (ROI only above `MIN_VOLUME_FOR_ROI`). */
  leaderboard(window: LeaderboardWindow, metric: LeaderboardMetric) {
    return this.leaderboardCache(`${window}:${metric}`);
  }

  /** The vault's realized income per UTC day over the last `days` (today included), by source; see `computeEarnings`. */
  earnings(days: number) {
    return this.earningsCache(days);
  }

  private leaderboardCache = cached(LEADERBOARD_TTL_MS, (key: string) => {
    const [window, metric] = key.split(':') as [LeaderboardWindow, LeaderboardMetric];
    return this.computeLeaderboard(window, metric);
  });

  private earningsCache = cached(EARNINGS_TTL_MS, (days: number) => this.computeEarnings(days));

  private async computeLeaderboard(window: LeaderboardWindow, metric: LeaderboardMetric) {
    const span = LEADERBOARD_WINDOWS[window];
    const raw = await this.db.query<{ owner: string; pnl: string; fees: string; funding: string; volume: string; trades: number; deposits: string }>(
      `select f.owner, f.pnl, f.fees, f.funding, f.volume, f.trades, coalesce(d.deposits, '0') as deposits
       from (select owner, sum(pnl)::text as pnl, sum(open_fee + close_fee + borrow_paid)::text as fees,
                    sum(funding_paid)::text as funding, sum(abs(size_delta))::text as volume, count(*)::int as trades
             from fills where ts >= $1 group by owner) f
       left join (select data->>'owner' as owner, sum((data->>'amount')::numeric)::text as deposits
                  from events where name = 'deposited' group by 1) d on d.owner = f.owner`,
      [Number.isFinite(span) ? nowSecs() - span : 0],
    );
    let rows: LeaderboardRow[] = raw.map((r) => {
      const [pnl, fees, funding, deposits] = [BigInt(r.pnl), BigInt(r.fees), BigInt(r.funding), BigInt(r.deposits)];
      const netPnl = pnl - fees - funding;
      const roi = deposits > 0n ? Number(netPnl) / Number(deposits) : null;
      return { rank: 0, owner: r.owner, pnl, fees, funding, netPnl, volume: BigInt(r.volume), trades: Number(r.trades), deposits, roi };
    });
    if (metric === 'roi') rows = rows.filter((r) => r.volume >= MIN_VOLUME_FOR_ROI && r.roi !== null);
    rows.sort(ORDER[metric]);
    rows.forEach((r, i) => (r.rank = i + 1));
    return { rows, updatedAt: Date.now() };
  }

  /**
   * From each `Trade` event: open/close fees and settled borrow net of the protocol share (the program credits
   * `x − floor(x · share)`), funding as paid, and −PnL (spread and impact are inside the fill price, so already in PnL).
   * Liquidations differ: their event's close fee is the whole liquidation fee, of which the vault keeps
   * `Liquidated.to_vault_fee`; their borrow and fee skip the protocol split; and `Liquidated.bad_debt` is loss the vault
   * never collected (a bankrupt plain close has no such field, see `closeShortfall`). Adding or removing collateral
   * settles borrow and funding too, reported on `CollateralChanged`.
   */
  private async computeEarnings(days: number) {
    const today = Math.floor(nowSecs() / DAY) * DAY;
    const from = today - (days - 1) * DAY;
    const [fills, configs, collateral] = await Promise.all([
      this.db.query<FillRow>(
        `select f.sig, f.ix, f.ts::text, f.kind, f.account, f.market, f.side, f.position_id::text, f.size_delta::text,
                f.collateral_after::text, f.open_fee::text, f.close_fee::text, f.borrow_paid::text, f.funding_paid::text,
                f.pnl::text, f.payout::text, l.data->>'toVaultFee' as to_vault_fee, l.data->>'badDebt' as bad_debt
         from fills f
         left join events l on f.kind = ${TradeKind.Liquidation} and l.sig = f.sig and l.name = 'liquidated'
           and l.data->>'account' = f.account and l.data->>'positionId' = f.position_id::text
         where f.ts >= $1`,
        [from],
      ),
      this.db.query<{ ts: string; bps: string | null }>(
        `select ts::text, data->'params'->>'protocolFeeShareBps' as bps from events where name = 'configUpdated' order by slot, ix`,
      ),
      this.db.query<{ ts: string; borrow: string | null; funding: string | null }>(
        `select ts::text, data->>'borrowPaid' as borrow, data->>'fundingPaid' as funding from events
         where name = 'collateralChanged' and ts >= $1`,
        [from],
      ),
    ]);
    const shareAt = protocolShareAt(configs, this.mirror.config?.params.protocolFeeShareBps ?? 0);
    const byDay = new Map<number, Earnings>();
    for (let d = from; d <= today; d += DAY) byDay.set(d, noEarnings());

    for (const f of fills) {
      const day = byDay.get(Math.floor(Number(f.ts) / DAY) * DAY);
      if (!day) continue;
      const pnl = BigInt(f.pnl);
      day.funding += BigInt(f.funding_paid);
      if (f.kind === TradeKind.Liquidation) {
        day.borrow += BigInt(f.borrow_paid);
        day.liquidation += BigInt(f.to_vault_fee ?? 0);
        day.traders += -pnl - BigInt(f.bad_debt ?? 0);
        continue;
      }
      const bps = shareAt(Number(f.ts));
      const vaultPart = (x: string) => BigInt(x) - math.bpsOf(BigInt(x), bps, 'Down');
      day.fees += vaultPart(f.open_fee) + vaultPart(f.close_fee);
      day.borrow += vaultPart(f.borrow_paid);
      // a close that paid nothing and took no fee may have been bankrupt: the vault then kept only the collateral
      const suspect = BigInt(f.size_delta) < 0n && f.payout === '0' && f.close_fee === '0' && pnl < 0n;
      day.traders += -pnl - (suspect ? await this.closeShortfall(f) : 0n);
    }

    for (const c of collateral) {
      const day = byDay.get(Math.floor(Number(c.ts) / DAY) * DAY);
      if (!day) continue;
      const borrow = BigInt(c.borrow ?? 0);
      day.borrow += borrow - math.bpsOf(borrow, shareAt(Number(c.ts)), 'Down');
      day.funding += BigInt(c.funding ?? 0);
    }

    const totals = noEarnings();
    const out = [...byDay].map(([t, e]) => {
      for (const k of Object.keys(totals) as (keyof Earnings)[]) totals[k] += e[k];
      return { t: t * 1000, ...e };
    });
    return { days: out, totals };
  }

  /**
   * Loss beyond the collateral of a bankrupt close, which the vault absorbed. The closed collateral isn't in the event:
   * it's the position's collateral after its previous event, less the fees settled now and what stays open.
   */
  private async closeShortfall(f: FillRow): Promise<bigint> {
    const [prev] = await this.db.query<{ c: string | null }>(
      `select p.data->>'collateralAfter' as c from events e, events p
       where e.sig = $1 and e.ix = $2 and p.name in ('trade', 'collateralChanged') and p.data->>'account' = $3
         and p.data->>'positionId' = $4 and p.data->>'market' = $5 and p.data->>'side' = $6
         and (p.slot < e.slot or (p.sig = e.sig and p.ix < e.ix))
       order by p.slot desc, p.ix desc limit 1`,
      [f.sig, f.ix, f.account, f.position_id, String(f.market), String(f.side)],
    );
    if (!prev?.c) return 0n;
    const closed = BigInt(prev.c) - BigInt(f.borrow_paid) - BigInt(f.funding_paid) - BigInt(f.collateral_after);
    const shortfall = -(closed + BigInt(f.pnl));
    return closed >= 0n && shortfall > 0n ? shortfall : 0n;
  }
}
