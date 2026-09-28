// Indexer: ZAP events into Postgres. A log subscription gives low latency; polling signatures (newest first, back to
// the stored cursor) is the source of truth. Inserts are idempotent on (signature, event index).

import { Connection, type ConfirmedSignatureInfo } from '@solana/web3.js';
import { PROGRAM_ID, parseEvents, type ZapEvent } from '@zap-protocol/sdk';
import type { Db } from './db';
import type { Candles } from './candles';
import { logger } from './log';

const log = logger('indexer');
const POLL_MS = 3_000;

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x?.toBase58 ? x.toBase58() : x));

type Listener = (e: ZapEvent & { signature: string; slot: number }) => void;

export class Indexer {
  private listeners = new Set<Listener>();
  private seen = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private sub: number | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly db: Db,
    private readonly candles: Candles,
  ) {}

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  async start() {
    this.sub = this.connection.onLogs(PROGRAM_ID, (l, ctx) => {
      if (!l.err) void this.ingest(l.signature, ctx.slot, Math.floor(Date.now() / 1000), l.logs);
    }, 'confirmed');
    await this.poll().catch((e) => log.warn('initial poll failed', e));
    this.timer = setInterval(() => void this.poll().catch((e) => log.warn('poll failed', e)), POLL_MS);
  }

  async stop() {
    if (this.sub !== null) await this.connection.removeOnLogsListener(this.sub);
    if (this.timer) clearInterval(this.timer);
  }

  private async poll() {
    const cursor = (await this.db.query<{ value: string }>("select value from cursor where id = 'indexer'"))[0]?.value;
    const sigs: ConfirmedSignatureInfo[] = [];
    let before: string | undefined;
    // Walk back from the newest signature to the cursor (at most a few pages per poll).
    let until = cursor;
    for (let page = 0; page < 10; page++) {
      let batch: ConfirmedSignatureInfo[];
      try {
        // Finalized only: the node resolves `until` cursors against rooted history. The log subscription covers the
        // last few seconds.
        batch = await this.connection.getSignaturesForAddress(PROGRAM_ID, { until, before, limit: 1000 }, 'finalized');
      } catch (e) {
        // The node no longer knows the cursor (pruned history or a reset ledger): continue from recent history.
        if (!until || !/not found/i.test(String(e))) throw e;
        log.warn('indexer cursor unknown to the node; resuming from recent history');
        until = undefined;
        batch = await this.connection.getSignaturesForAddress(PROGRAM_ID, { before, limit: 1000 }, 'finalized');
      }
      sigs.push(...batch);
      if (batch.length < 1000) break;
      before = batch[batch.length - 1]!.signature;
    }
    if (!sigs.length) return;
    for (const s of sigs.reverse()) {
      if (s.err || this.seen.has(s.signature)) continue;
      const tx = await this.connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx?.meta?.logMessages) await this.ingest(s.signature, s.slot, s.blockTime ?? Math.floor(Date.now() / 1000), tx.meta.logMessages);
    }
    await this.db.query(
      "insert into cursor (id, value) values ('indexer', $1) on conflict (id) do update set value = excluded.value",
      [sigs[sigs.length - 1]!.signature],
    );
  }

  private async ingest(signature: string, slot: number, ts: number, logs: string[]) {
    if (this.seen.has(signature)) return;
    this.seen.add(signature);
    if (this.seen.size > 50_000) this.seen.clear();
    let events: ZapEvent[];
    try {
      events = parseEvents(logs);
    } catch (e) {
      log.warn(`could not parse ${signature}`, e);
      return;
    }
    for (const [ix, e] of events.entries()) {
      await this.db.query(
        'insert into events (sig, ix, slot, ts, name, data) values ($1, $2, $3, $4, $5, $6) on conflict do nothing',
        [signature, ix, slot, ts, e.name, json(e.data)],
      );
      if (e.name === 'trade') await this.insertFill(signature, ix, e.data);
      for (const l of this.listeners) l({ ...e, signature, slot });
    }
  }

  private async insertFill(signature: string, ix: number, d: Record<string, unknown>) {
    const s = (k: string) => String(d[k] ?? 0);
    const rows = await this.db.query(
      `insert into fills (sig, ix, pool_seq, ts, account, owner, market, side, kind, position_id, order_id, size_delta,
         size_after, collateral_after, oracle_price, fill_price, open_fee, close_fee, spread_cost, impact_cost, borrow_paid,
         funding_paid, pnl, payout)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       on conflict do nothing returning sig`,
      [
        signature, ix, s('poolSeq'), s('ts'), String((d.account as { toBase58(): string }).toBase58()),
        String((d.owner as { toBase58(): string }).toBase58()), Number(d.market), Number(d.side), Number(d.kind),
        s('positionId'), s('orderId'), s('sizeDelta'), s('sizeAfter'), s('collateralAfter'), s('oraclePrice'), s('fillPrice'),
        s('openFee'), s('closeFee'), s('spreadCost'), s('impactCost'), s('borrowPaid'), s('fundingPaid'), s('pnl'), s('payout'),
      ],
    );
    if (rows.length) this.candles.addVolume(Number(d.market), BigInt(s('sizeDelta')));
  }
}
