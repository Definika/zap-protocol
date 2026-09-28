// One-minute OHLC candles per market from oracle ticks (prices as 12-decimal integers, like on-chain), volume from
// fills. Larger timeframes are rolled up at query time.

import { MARKETS } from '@zap-protocol/sdk';
import type { Db } from './db';
import type { OracleHub, PriceTick } from './oracle/hub';
import { logger } from './log';

const log = logger('candles');
const MINUTE = 60;

interface Candle {
  t: number;
  o: bigint;
  h: bigint;
  l: bigint;
  c: bigint;
  v: bigint;
}

/** 12-decimal price from a tick (mantissa · 10^(12 + expo)). */
export const price12 = (t: PriceTick) => (t.expo >= -12 ? t.price * 10n ** BigInt(12 + t.expo) : t.price / 10n ** BigInt(-12 - t.expo));

const marketByFeed = new Map(MARKETS.map((m) => [m.pythProFeedId, m.index]));

export class Candles {
  private open = new Map<number, Candle>();

  constructor(private readonly db: Db) {}

  attach(hub: OracleHub) {
    return hub.on((s) => {
      const t = Math.floor(Number(s.tsUs / 1_000_000n) / MINUTE) * MINUTE;
      for (const tick of s.ticks.values()) {
        const market = marketByFeed.get(tick.feedId);
        if (market === undefined) continue;
        const p = price12(tick);
        const cur = this.open.get(market);
        if (!cur || cur.t !== t) {
          if (cur) void this.flush(market, cur);
          this.open.set(market, { t, o: p, h: p, l: p, c: p, v: 0n });
        } else {
          if (p > cur.h) cur.h = p;
          if (p < cur.l) cur.l = p;
          cur.c = p;
        }
      }
    });
  }

  /** Adds traded notional (USD, 6 decimals) to the market's current candle. */
  addVolume(market: number, usd: bigint) {
    const cur = this.open.get(market);
    if (cur) cur.v += usd < 0n ? -usd : usd;
  }

  private async flush(market: number, c: Candle) {
    try {
      await this.db.query(
        `insert into candles (market, tf, t, o, h, l, c, v) values ($1, 60, $2, $3, $4, $5, $6, $7)
         on conflict (market, tf, t) do update set h = greatest(candles.h, excluded.h), l = least(candles.l, excluded.l),
           c = excluded.c, v = candles.v + excluded.v`,
        [market, c.t, c.o.toString(), c.h.toString(), c.l.toString(), c.c.toString(), c.v.toString()],
      );
    } catch (e) {
      log.warn('flush failed', e);
    }
  }

  /** Candles of `tfSecs` (a multiple of 60) from `from` (unix seconds), including the one still forming. */
  async query(market: number, tfSecs: number, from: number, limit = 500) {
    const rows = await this.db.query<{ t: string; o: string; h: string; l: string; c: string; v: string }>(
      `select (t / $2) * $2 as t,
              (array_agg(o order by t))[1] as o, max(h) as h, min(l) as l,
              (array_agg(c order by t desc))[1] as c, sum(v) as v
       from candles where market = $1 and tf = 60 and t >= $3
       group by 1 order by 1 desc limit $4`,
      [market, tfSecs, from, limit],
    );
    const out = rows.reverse().map((r) => ({ t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
    const cur = this.open.get(market);
    if (cur) {
      const bt = Math.floor(cur.t / tfSecs) * tfSecs;
      const last = out[out.length - 1];
      if (last && last.t === bt) {
        last.h = BigInt(last.h) > cur.h ? last.h : cur.h.toString();
        last.l = BigInt(last.l) < cur.l ? last.l : cur.l.toString();
        last.c = cur.c.toString();
        last.v = (BigInt(last.v) + cur.v).toString();
      } else {
        out.push({ t: bt, o: cur.o.toString(), h: cur.h.toString(), l: cur.l.toString(), c: cur.c.toString(), v: cur.v.toString() });
      }
    }
    return out;
  }
}
