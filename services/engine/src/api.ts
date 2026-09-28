// REST + WebSocket API. Browsers read everything here (no RPC): market state and prices, their account from the
// mirror, history from the indexer, and they submit transactions through the relayer.

import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { PublicKey, type Connection } from '@solana/web3.js';
import { MARKETS, PROGRAM_ID, openOrders, openPositions } from '@zap-protocol/sdk';
import type WebSocket from 'ws';
import { config } from './config';
import type { Db } from './db';
import type { Candles } from './candles';
import type { Mirror } from './chain/mirror';
import type { OracleHub } from './oracle/hub';
import type { Indexer } from './indexer';
import { rangeSecs, type Snapshots } from './snapshots';
import { LEADERBOARD_METRICS, LEADERBOARD_WINDOWS, MIN_VOLUME_FOR_ROI, Stats, type LeaderboardMetric, type LeaderboardWindow } from './stats';
import { Faucet, FaucetError } from './faucet';
import { RelayError, type Relayer } from './relayer';
import { AuthError, type Auth, type AuthUser } from './auth';
import { logger } from './log';

const log = logger('api');

export interface ApiDeps {
  db: Db;
  connection: Connection;
  hub: OracleHub;
  mirror: Mirror;
  candles: Candles;
  snapshots: Snapshots;
  indexer?: Indexer;
  relayer?: Relayer;
  faucet?: Faucet;
  /** Privy session checks (disabled locally, without a Privy app). */
  auth?: Auth;
  devOracle?: { shock(feedId: number, pct: number): boolean };
}

/** JSON with bigint → string and PublicKey → base58. */
const serialize = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x instanceof PublicKey ? x.toBase58() : x));

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

function parseKey(s: string, reply: FastifyReply): PublicKey | null {
  try {
    return new PublicKey(s);
  } catch {
    void reply.code(400).send({ error: 'invalid public key' });
    return null;
  }
}

/** Seconds of history for `?range=`, or null after answering 400. */
function parseRange(range: string | undefined, reply: FastifyReply): number | null {
  const secs = rangeSecs(range);
  if (secs === undefined) void reply.code(400).send({ error: 'range must be 7D, 30D or All' });
  return secs ?? null;
}

/** `?window=&metric=` for the leaderboard (default all-time PnL), or null after answering 400. */
function parseBoard(q: { window?: string; metric?: string }, reply: FastifyReply) {
  const window = (q.window ?? 'all').toLowerCase();
  const metric = (q.metric ?? 'pnl').toLowerCase();
  if (!Object.hasOwn(LEADERBOARD_WINDOWS, window) || !(LEADERBOARD_METRICS as readonly string[]).includes(metric)) {
    void reply.code(400).send({ error: 'window must be 24h, 7d, 30d or all; metric pnl, volume or roi' });
    return null;
  }
  return { window: window as LeaderboardWindow, metric: metric as LeaderboardMetric };
}

export async function startApi(deps: ApiDeps) {
  const { db, hub, mirror, candles, snapshots } = deps;
  const app = Fastify({ bodyLimit: 16 * 1024, trustProxy: true });
  app.setReplySerializer((payload) => serialize(payload));
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(websocket);

  const stats = new Stats(db, mirror, candles);
  await stats.start();

  const marketView = (index: number) => {
    const info = MARKETS[index];
    const m = mirror.markets.get(index);
    const tick = info ? hub.latest?.ticks.get(info.pythProFeedId) : undefined;
    return { ...info, onchain: m ?? null, price: tick ?? null, stats: stats.market(index) };
  };

  app.get('/v1/health', async () => ({
    ok: true,
    cluster: config.cluster,
    oracle: { mode: hub.mode, ageMs: hub.ageMs() },
    markets: mirror.markets.size,
    accounts: mirror.accounts.size,
  }));

  app.get('/v1/config', async () => ({
    cluster: config.cluster,
    programId: PROGRAM_ID,
    usdcMint: config.usdcMint,
    lookupTable: config.lookupTable,
    relayer: deps.relayer?.relayer.publicKey ?? null,
    oracleMode: hub.mode,
    pythStorage: config.pythStorage,
    protocol: mirror.config,
    pool: mirror.pool,
    faucet: config.faucet,
  }));

  app.get('/v1/markets', async () => MARKETS.map((m) => marketView(m.index)));

  app.get<{ Params: { index: string } }>('/v1/markets/:index', async (req, reply) => {
    const i = Number(req.params.index);
    if (!MARKETS[i]) return reply.code(404).send({ error: 'unknown market' });
    return marketView(i);
  });

  app.get<{ Params: { index: string }; Querystring: { tf?: string; from?: string; limit?: string } }>(
    '/v1/markets/:index/candles',
    async (req) => {
      const tf = Math.max(60, Number(req.query.tf ?? 900));
      const limit = Math.min(1_000, Number(req.query.limit ?? 300));
      const from = Number(req.query.from ?? Math.floor(Date.now() / 1000) - tf * limit);
      return candles.query(Number(req.params.index), tf, from, limit);
    },
  );

  app.get<{ Params: { index: string }; Querystring: { limit?: string } }>('/v1/markets/:index/trades', async (req) =>
    db.query(
      `select sig, ts, side, kind, size_delta, fill_price, oracle_price from fills where market = $1 order by ts desc, pool_seq desc limit $2`,
      [Number(req.params.index), Math.min(200, Number(req.query.limit ?? 50))],
    ),
  );

  app.get('/v1/prices', async () => ({ tsUs: hub.latest?.tsUs ?? null, ticks: hub.latest ? [...hub.latest.ticks.values()] : [] }));

  // Signed messages clients embed in their transactions.
  app.get<{ Params: { feed: string } }>('/v1/prices/:feed/signed', async (req, reply) => {
    const s = hub.latest;
    if (!s) return reply.code(503).send({ error: 'no price yet' });
    if (req.params.feed === 'all') return { tsUs: s.tsUs, message: b64(s.all) };
    const msg = s.perFeed.get(Number(req.params.feed));
    if (!msg) return reply.code(404).send({ error: 'unknown feed' });
    return { tsUs: s.tsUs, message: b64(msg), tick: s.ticks.get(Number(req.params.feed)) };
  });

  app.get<{ Params: { owner: string } }>('/v1/accounts/:owner', async (req, reply) => {
    const owner = parseKey(req.params.owner, reply);
    if (!owner) return;
    const e = mirror.accounts.get(owner.toBase58());
    if (!e) return reply.code(404).send({ error: 'no trading account' });
    return { address: e.address, slot: e.slot, account: { ...e.account, positions: openPositions(e.account), orders: openOrders(e.account) } };
  });

  app.get<{ Params: { owner: string }; Querystring: { limit?: string } }>('/v1/accounts/:owner/history', async (req) =>
    db.query(`select * from fills where owner = $1 order by ts desc, pool_seq desc limit $2`, [
      req.params.owner,
      Math.min(500, Number(req.query.limit ?? 100)),
    ]),
  );

  app.get<{ Params: { owner: string } }>('/v1/accounts/:owner/events', async (req) =>
    db.query(
      `select sig, ts, name, data from events where data->>'owner' = $1 or data->>'account' = $1 order by ts desc limit 200`,
      [req.params.owner],
    ),
  );

  // Equity (balance + order escrow + positions marked to the oracle, net of owed fees), from 5-minute snapshots.
  app.get<{ Params: { owner: string }; Querystring: { range?: string } }>('/v1/accounts/:owner/equity', async (req, reply) => {
    const owner = parseKey(req.params.owner, reply);
    if (!owner) return;
    const secs = parseRange(req.query.range, reply);
    if (secs === null) return;
    return snapshots.equityHistory(owner.toBase58(), secs);
  });

  app.get('/v1/vault', async (_, reply) => {
    if (!snapshots.view) return reply.code(503).send({ error: 'vault not priced yet' });
    return { pool: mirror.pool, ...snapshots.view };
  });

  app.get<{ Querystring: { range?: string } }>('/v1/vault/history', async (req, reply) => {
    const secs = parseRange(req.query.range, reply);
    if (secs === null) return;
    return snapshots.vaultHistory(secs);
  });

  app.get<{ Querystring: { days?: string } }>('/v1/vault/earnings', async (req) => {
    const n = Math.floor(Number(req.query.days ?? 30));
    return stats.earnings(Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : 30);
  });

  app.get<{ Querystring: { window?: string; metric?: string } }>('/v1/leaderboard', async (req, reply) => {
    const q = parseBoard(req.query, reply);
    if (!q) return;
    const board = await stats.leaderboard(q.window, q.metric);
    return { rows: board.rows.slice(0, 100), minVolumeForRoi: MIN_VOLUME_FOR_ROI, updatedAt: board.updatedAt };
  });

  app.get<{ Params: { owner: string }; Querystring: { window?: string; metric?: string } }>('/v1/leaderboard/:owner', async (req, reply) => {
    const q = parseBoard(req.query, reply);
    if (!q) return;
    const board = await stats.leaderboard(q.window, q.metric);
    return { row: board.rows.find((r) => r.owner === req.params.owner) ?? null };
  });

  // Gasless relay and faucet. With a Privy app configured, both need the user's session, and a transaction may only be
  // signed by the user's own wallets or the session keys of their trading accounts.
  const who = async (header: string | undefined): Promise<AuthUser | undefined> => (deps.auth?.enabled ? deps.auth.user(header) : undefined);
  const ownedBy = (user: AuthUser) => (signer: PublicKey) => {
    const k = signer.toBase58();
    if (user.wallets.has(k)) return true;
    for (const w of user.wallets) if (mirror.accounts.get(w)?.account.sessionKey.toBase58() === k) return true;
    return false;
  };

  app.post<{ Body: { tx?: string } }>('/v1/relay', async (req, reply) => {
    if (!deps.relayer) return reply.code(503).send({ error: 'relayer disabled' });
    if (!req.body?.tx) return reply.code(400).send({ error: 'missing tx' });
    try {
      const user = await who(req.headers.authorization);
      const r = await deps.relayer.relay(req.body.tx, { ip: req.ip, userId: user?.id, signerAllowed: user && ownedBy(user) });
      // refresh the touched accounts once the transaction lands, so WebSocket clients see it quickly
      setTimeout(() => void mirror.refresh(r.accounts).catch(() => {}), 1_200);
      return { signature: r.signature };
    } catch (e) {
      if (e instanceof RelayError) return reply.code(400).send({ error: e.message, code: e.code, logs: e.logs });
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message, code: 'auth' });
      log.error('relay failed', e);
      return reply.code(500).send({ error: 'relay failed' });
    }
  });

  app.get<{ Params: { wallet: string } }>('/v1/faucet/:wallet', async (req, reply) => {
    if (!deps.faucet) return reply.code(503).send({ error: 'faucet disabled' });
    const wallet = parseKey(req.params.wallet, reply);
    if (!wallet) return;
    return { waitSecs: await deps.faucet.cooldown(wallet, wallet.toBase58()), amount: config.faucet.amountUsd };
  });

  app.post<{ Body: { wallet?: string } }>('/v1/faucet', async (req, reply) => {
    if (!deps.faucet) return reply.code(503).send({ error: 'faucet disabled' });
    const wallet = parseKey(req.body?.wallet ?? '', reply);
    if (!wallet) return;
    try {
      const user = await who(req.headers.authorization);
      if (user && !user.wallets.has(wallet.toBase58())) return reply.code(403).send({ error: 'that wallet is not linked to your account' });
      return await deps.faucet.claim(wallet, user?.id ?? wallet.toBase58());
    } catch (e) {
      if (e instanceof FaucetError) return reply.code(429).send({ error: e.message, nextClaimAt: e.nextClaimAt });
      if (e instanceof AuthError) return reply.code(401).send({ error: e.message, code: 'auth' });
      log.error('faucet failed', e);
      return reply.code(500).send({ error: 'faucet failed' });
    }
  });

  // Local testing only: move a dev-oracle price at once (never available with the Pyth oracle or off localnet).
  if (deps.devOracle && config.cluster === 'localnet') {
    app.post<{ Body: { feedId?: number; pct?: number } }>('/v1/dev/shock', async (req, reply) => {
      const { feedId, pct } = req.body ?? {};
      if (typeof feedId !== 'number' || typeof pct !== 'number' || Math.abs(pct) > 50) return reply.code(400).send({ error: 'feedId and pct (±50) required' });
      return { ok: deps.devOracle!.shock(feedId, pct) };
    });
  }

  // WebSocket: { op: 'sub' | 'unsub', ch: 'prices' | 'markets' | 'pool' | 'status' | 'vault' | `account:${owner}` | `trades:${market}` }
  const clients = new Map<WebSocket, Set<string>>();
  const send = (ws: WebSocket, ch: string, data: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(serialize({ ch, data }));
  };
  const broadcast = (ch: string, data: unknown) => {
    for (const [ws, subs] of clients) if (subs.has(ch)) send(ws, ch, data);
  };

  app.get('/v1/ws', { websocket: true }, (socket) => {
    const subs = new Set<string>();
    clients.set(socket, subs);
    socket.on('message', (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as { op?: string; ch?: string };
        if (!m.ch || typeof m.ch !== 'string' || m.ch.length > 80) return;
        if (m.op === 'sub') {
          subs.add(m.ch);
          if (m.ch.startsWith('account:')) {
            const e = mirror.accounts.get(m.ch.slice(8));
            send(socket, m.ch, e ? { ...e.account, positions: openPositions(e.account), orders: openOrders(e.account) } : null);
          } else if (m.ch === 'vault' && snapshots.view) send(socket, m.ch, snapshots.view);
        } else if (m.op === 'unsub') subs.delete(m.ch);
      } catch {
        // ignore malformed messages
      }
    });
    socket.on('close', () => clients.delete(socket));
  });

  // Prices at ~4Hz.
  let lastPush = 0;
  hub.on((s) => {
    if (Date.now() - lastPush < 250) return;
    lastPush = Date.now();
    broadcast('prices', { tsUs: s.tsUs, ticks: [...s.ticks.values()] });
  });
  mirror.on((c) => {
    if (c.kind === 'account') {
      broadcast(`account:${c.owner}`, c.entry ? { ...c.entry.account, positions: openPositions(c.entry.account), orders: openOrders(c.entry.account) } : null);
    } else if (c.kind === 'market') broadcast('markets', marketView(c.index));
    else if (c.kind === 'pool') broadcast('pool', c.pool);
  });
  deps.indexer?.on((e) => {
    if (e.name === 'trade') broadcast(`trades:${String(e.data.market)}`, { ...e.data, signature: e.signature });
  });
  // The vault view is recomputed every 5s.
  snapshots.on((v) => broadcast('vault', v));
  // Oracle health and the latest confirmed slot every 2s.
  let slot: number | null = null;
  const pollSlot = async () => {
    try {
      slot = await deps.connection.getSlot('confirmed');
    } catch {
      // keep the last one
    }
  };
  await pollSlot();
  setInterval(() => {
    void pollSlot();
    broadcast('status', { oracle: { mode: hub.mode, ageMs: hub.ageMs() }, slot });
  }, 2_000);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info(`listening on :${config.port}`);
  return app;
}
