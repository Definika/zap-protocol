// Dev oracle: a random walk from live spot prices, signed every 200ms by our own dev key, in exactly the format Pyth
// Pro streams. Used locally and until the Pyth Pro key is live; the app shows a "DEV ORACLE" badge in this mode.

import { createPrivateKey, sign as edSign, type KeyObject } from 'node:crypto';
import type { Keypair } from '@solana/web3.js';
import { MARKETS, buildPayload, signPayload, type FeedInput } from '@zap-protocol/sdk';
import { logger } from '../log';
import type { OracleHub, PriceTick } from './hub';

const log = logger('oracle:dev');
const EXPO = -8;
const TICK_MS = 200;

// Fallbacks when a spot price can't be fetched.
const SEED: Record<string, number> = {
  BTC: 97_412.6, ETH: 3_486.21, XRP: 1.3612, BNB: 612.4, SOL: 184.126, DOGE: 0.09412, HYPE: 39.812, LINK: 9.078,
  AVAX: 9.341, SUI: 0.9447, JUP: 0.84213, PENGU: 0.008214, PUMP: 0.0024531, PYTH: 0.31872, JTO: 0.6102,
};

async function spot(base: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.coinbase.com/v2/prices/${base}-USD/spot`, { signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { amount?: string } };
    const v = Number(j.data?.amount);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function gaussian(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export async function startDevOracle(hub: OracleHub, signer: Keypair): Promise<() => void> {
  const key: KeyObject = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(signer.secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  const sign = (p: Uint8Array) => new Uint8Array(edSign(null, p, key));
  const pk = signer.publicKey.toBytes();

  const anchor = new Map<number, number>();
  await Promise.all(
    MARKETS.map(async (m) => {
      const seed = SEED[m.base] ?? 1;
      const live = await spot(m.base);
      // an exchange ticker can map to a different asset: keep the live price only if it's near our reference
      anchor.set(m.pythProFeedId, live !== null && live > seed / 10 && live < seed * 10 ? live : seed);
    }),
  );
  const price = new Map(anchor);
  log.info(`started with ${MARKETS.length} feeds`, Object.fromEntries(MARKETS.map((m) => [m.base, price.get(m.pythProFeedId)])));

  // ~60% annualized volatility per 200ms step, pulled gently back toward the starting price.
  const sigma = 0.6 / Math.sqrt((365 * 24 * 3600 * 1000) / TICK_MS);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const tsUs = BigInt(Date.now()) * 1000n;
      const ticks = new Map<number, PriceTick>();
      const inputs: FeedInput[] = [];
      for (const m of MARKETS) {
        const id = m.pythProFeedId;
        const a = anchor.get(id)!;
        let p = price.get(id)!;
        p *= Math.exp(sigma * gaussian() + 0.0005 * Math.log(a / p));
        price.set(id, p);
        const mantissa = BigInt(Math.max(1, Math.round(p * 10 ** -EXPO)));
        const conf = mantissa / 30_000n; // ~0.33bp
        ticks.set(id, { feedId: id, price: mantissa, expo: EXPO, conf, tsUs });
        inputs.push({ feedId: id, price: mantissa, exponent: EXPO, confidence: conf, feedUpdateTsUs: tsUs });
      }
      const perFeed = new Map<number, Uint8Array>();
      for (const f of inputs) perFeed.set(f.feedId, await signPayload(buildPayload(tsUs, [f]), pk, sign));
      const all = await signPayload(buildPayload(tsUs, inputs, 3, false), pk, sign);
      hub.publish({ tsUs, ticks, perFeed, all });
    } catch (e) {
      log.error('tick failed', e);
    } finally {
      busy = false;
    }
  };
  await tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}
