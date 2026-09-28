// Pyth Pro stream: a redundant connection pool on the 200ms channel with two kinds of subscriptions, both delivered in
// Pyth's signed Solana format, which the program verifies on-chain:
//   - one per feed, with confidence: the small messages trades carry;
//   - one with every feed, without confidence: keeper refreshes and LP deposits/withdrawals.
// Each all-feed update publishes a snapshot to the hub with the latest per-feed messages (same shape as the dev oracle).

import { PythLazerClient, type JsonOrBinaryResponse } from '@pythnetwork/pyth-lazer-sdk';
import { MARKETS } from '@zap-protocol/sdk';
import { logger } from '../log';
import type { OracleHub, PriceTick } from './hub';

const log = logger('oracle:pyth');
const ALL = 1_000;
const CHANNEL = 'fixed_rate@200ms' as const;

export interface PythOracle {
  stop(): void;
}

export async function startPythOracle(hub: OracleHub, token: string, urls?: string[]): Promise<PythOracle> {
  if (!token) throw new Error('ORACLE_MODE=pyth needs PYTH_PRO_TOKEN');
  const client = await PythLazerClient.create({
    token,
    webSocketPoolConfig: {
      numConnections: 3,
      ...(urls?.length ? { urls } : {}),
      onWebSocketError: (e) => log.warn('stream connection error', e.message),
      onWebSocketPoolError: (e) => log.error('stream pool error', e),
    },
  });
  const ids = MARKETS.map((m) => m.pythProFeedId);
  const bySub = new Map(ids.map((id, i) => [i + 1, id]));
  const perFeed = new Map<number, Uint8Array>();
  const ticks = new Map<number, PriceTick>();

  client.addMessageListener((ev: JsonOrBinaryResponse) => {
    if (ev.type !== 'json') return;
    const m = ev.value;
    if (m.type === 'error' || m.type === 'subscriptionError') {
      log.error('stream error', m);
      return;
    }
    if (m.type === 'subscribedWithInvalidFeedIdsIgnored') log.warn('feeds ignored by Pyth', m.ignoredInvalidFeedIds);
    if (m.type !== 'streamUpdated' || !m.parsed || !m.solana) return;
    const msg = Uint8Array.from(Buffer.from(m.solana.data, m.solana.encoding));
    const tsUs = BigInt(m.parsed.timestampUs);
    if (m.subscriptionId === ALL) {
      for (const f of m.parsed.priceFeeds) {
        if (!f.price || f.exponent === undefined) continue;
        const prev = ticks.get(f.priceFeedId);
        ticks.set(f.priceFeedId, { feedId: f.priceFeedId, price: BigInt(f.price), expo: f.exponent, conf: prev?.conf ?? 0n, tsUs });
      }
      if (perFeed.size) hub.publish({ tsUs, ticks: new Map(ticks), perFeed: new Map(perFeed), all: msg });
      return;
    }
    const id = bySub.get(m.subscriptionId);
    const f = m.parsed.priceFeeds[0];
    if (id === undefined || !f || f.priceFeedId !== id || !f.price || f.exponent === undefined) return;
    perFeed.set(id, msg);
    ticks.set(id, { feedId: id, price: BigInt(f.price), expo: f.exponent, conf: BigInt(Math.round(f.confidence ?? 0)), tsUs });
  });
  client.addAllConnectionsDownListener(() => log.error('all Pyth Pro connections are down; retrying'));
  client.addConnectionRestoredListener(() => log.info('Pyth Pro stream restored'));

  const base = { formats: ['solana' as const], deliveryFormat: 'json' as const, jsonBinaryEncoding: 'base64' as const, parsed: true, channel: CHANNEL };
  ids.forEach((id, i) =>
    client.subscribe({ type: 'subscribe', subscriptionId: i + 1, priceFeedIds: [id], properties: ['price', 'exponent', 'confidence', 'feedUpdateTimestamp'], ...base }),
  );
  client.subscribe({ type: 'subscribe', subscriptionId: ALL, priceFeedIds: ids, properties: ['price', 'exponent', 'feedUpdateTimestamp'], ...base });
  log.info(`subscribed to ${ids.length} feeds on ${CHANNEL}`);
  return { stop: () => client.shutdown() };
}
