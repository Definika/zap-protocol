// Keeper end-to-end on localnet (validator + setup + engine with the dev oracle): shocks the dev price and checks that
// the keeper executes a take-profit, fills a limit order and liquidates an over-levered position — with no action from
// the traders after they place their orders.
//
//   npx tsx scripts/smoke-keeper.ts

import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  MARKETS,
  OrderKind,
  Side,
  assemble,
  buildV0,
  createAccount,
  deposit,
  openPosition,
  placeOrder,
} from '../packages/sdk/src/index.ts';
import { connection, readDeployment, usd } from './lib.ts';

const API = process.env.API_URL ?? 'http://localhost:8787';
const get = async <T>(path: string): Promise<T> => (await fetch(API + path)).json() as Promise<T>;
const post = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string; logs?: string[] };
  if (!r.ok) throw new Error(`${path}: ${j.error}\n${(j.logs ?? []).join('\n')}`);
  return j;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const d = readDeployment()!;
const mint = new PublicKey(d.usdcMint);
const lut = (await connection.getAddressLookupTable(new PublicKey(d.lookupTable!))).value!;
const payer = new PublicKey((await get<{ relayer: string }>('/v1/config')).relayer);
const sol = MARKETS.find((m) => m.base === 'SOL')!;

async function relay(ixs: Parameters<typeof buildV0>[0]['instructions'], signer: Keypair) {
  const { blockhash } = await connection.getLatestBlockhash();
  const tx = buildV0({ payer, instructions: ixs, recentBlockhash: blockhash, lookupTables: [lut] });
  tx.sign([signer]);
  const { signature } = await post<{ signature: string }>('/v1/relay', { tx: Buffer.from(tx.serialize()).toString('base64') });
  await connection.confirmTransaction(signature, 'confirmed');
}

async function trader() {
  const user = Keypair.generate();
  const session = Keypair.generate();
  await post('/v1/faucet', { wallet: user.publicKey.toBase58() });
  const ata = getAssociatedTokenAddressSync(mint, user.publicKey);
  const expires = BigInt(Math.floor(Date.now() / 1000) + 86_400);
  await relay([createAccount(user.publicKey, payer, session.publicKey, expires), deposit(user.publicKey, ata, mint, usd(5_000))], user);
  return { user, session, trade: { signer: session.publicKey, owner: user.publicKey, market: sol.index } };
}

const signed = async () => Buffer.from((await get<{ message: string }>(`/v1/prices/${sol.pythProFeedId}/signed`)).message, 'base64');
const price = async () => {
  const r = await get<{ tick: { price: string } }>(`/v1/prices/${sol.pythProFeedId}/signed`);
  return BigInt(r.tick.price) * 10_000n; // expo -8 → 12 decimals
};
const account = async (u: Keypair) =>
  (await get<{ account: { positions: { positionId: string }[]; orders: unknown[]; balance: string } }>(`/v1/accounts/${u.publicKey.toBase58()}`)).account;
async function until(what: string, check: () => Promise<boolean>, ms = 20_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await check()) return console.log(`✓ ${what} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    await sleep(500);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

// 1. Take-profit: long with TP 0.5% above; shock +1%.
const a = await trader();
let p = await price();
await relay(assemble([openPosition(a.trade, await signed(), { side: Side.Long, size: usd(5_000), collateral: usd(500), tpPrice: (p * 1005n) / 1000n })]), a.session);
await post('/v1/dev/shock', { feedId: sol.pythProFeedId, pct: 1 });
await until('keeper executed the take-profit', async () => (await account(a.user)).positions.length === 0);

// 2. Limit order 1% below; shock −1.5%.
const b = await trader();
p = await price();
await relay([placeOrder(b.session.publicKey, b.user.publicKey, sol.index, { side: Side.Long, kind: OrderKind.Limit, size: usd(2_000), collateral: usd(200), triggerPrice: (p * 99n) / 100n })], b.session);
await sleep(1_500);
await post('/v1/dev/shock', { feedId: sol.pythProFeedId, pct: -1.5 });
await until('keeper filled the limit order', async () => {
  const acct = await account(b.user);
  return acct.orders.length === 0 && acct.positions.length === 1;
});

// 3. Liquidation: 50x long; shock −2.5%.
const c = await trader();
await relay(assemble([openPosition(c.trade, await signed(), { side: Side.Long, size: usd(10_000), collateral: usd(200) })]), c.session);
await post('/v1/dev/shock', { feedId: sol.pythProFeedId, pct: -2.5 });
await until('keeper liquidated the 50x long', async () => (await account(c.user)).positions.length === 0);

const history = await get<{ kind: number }[]>(`/v1/accounts/${c.user.publicKey.toBase58()}/history`);
console.log('liquidated trader history kinds:', history.map((h) => h.kind));
console.log('keeper smoke test passed');
