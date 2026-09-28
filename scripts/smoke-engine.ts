// End-to-end through the engine's HTTP API, as the app will do it: a user with zero SOL claims test USDC, creates a
// trading account with a session key and deposits (one owner signature), then trades with the session key. Every
// transaction goes through the relayer, which pays all fees and the account rent.
//
//   (validator + scripts/setup.ts + engine running)  npx tsx scripts/smoke-engine.ts

import { Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { MARKETS, Side, assemble, buildV0, closePosition, createAccount, deposit, openPosition } from '../packages/sdk/src/index.ts';
import { connection, readDeployment, usd } from './lib.ts';

const API = process.env.API_URL ?? 'http://localhost:8787';
const get = async <T>(path: string): Promise<T> => (await fetch(API + path)).json() as Promise<T>;
const post = async <T>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json()) as T & { error?: string; logs?: string[] };
  if (!r.ok) throw new Error(`${path}: ${j.error}\n${(j.logs ?? []).join('\n')}`);
  return j;
};
const d = readDeployment()!;
const mint = new PublicKey(d.usdcMint);
const lut = (await connection.getAddressLookupTable(new PublicKey(d.lookupTable!))).value!;
const { relayer } = await get<{ relayer: string }>('/v1/config');
const payer = new PublicKey(relayer);

async function relay(ixs: Parameters<typeof buildV0>[0]['instructions'], signer: Keypair | null) {
  const { blockhash } = await connection.getLatestBlockhash();
  const tx: VersionedTransaction = buildV0({ payer, instructions: ixs, recentBlockhash: blockhash, lookupTables: [lut] });
  if (signer) tx.sign([signer]);
  const { signature } = await post<{ signature: string }>('/v1/relay', { tx: Buffer.from(tx.serialize()).toString('base64') });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

const user = Keypair.generate();
const session = Keypair.generate();
console.log('user SOL balance:', await connection.getBalance(user.publicKey));

const claim = await post<{ amount: number }>('/v1/faucet', { wallet: user.publicKey.toBase58() });
console.log('faucet:', claim.amount, 'test USDC');
const again = await fetch(`${API}/v1/faucet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: user.publicKey.toBase58() }) });
console.log('second claim refused:', again.status === 429);

const ata = getAssociatedTokenAddressSync(mint, user.publicKey);
const expires = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
await relay([createAccount(user.publicKey, payer, session.publicKey, expires), deposit(user.publicKey, ata, mint, usd(2_000))], user);
console.log('trading account created and funded (owner signed once)');

const eth = MARKETS.find((m) => m.base === 'ETH')!;
const trade = { signer: session.publicKey, owner: user.publicKey, market: eth.index };
const signed = async () => Buffer.from((await get<{ message: string }>(`/v1/prices/${eth.pythProFeedId}/signed`)).message, 'base64');
await relay(assemble([openPosition(trade, await signed(), { side: Side.Short, size: usd(20_000), collateral: usd(400) })], { computeUnitLimit: 200_000 }), session);
await new Promise((r) => setTimeout(r, 1_500));
let acct = await get<{ account: { balance: string; positions: { positionId: string; sizeUsd: string; side: number }[] } }>(`/v1/accounts/${user.publicKey.toBase58()}`);
const pos = acct.account.positions[0]!;
console.log('short open (session key, gasless):', { size: pos.sizeUsd, side: pos.side, balance: acct.account.balance });

await relay(assemble([closePosition(trade, await signed(), Side.Short, BigInt(pos.positionId))], { computeUnitLimit: 200_000 }), session);
await new Promise((r) => setTimeout(r, 4_000));
acct = await get(`/v1/accounts/${user.publicKey.toBase58()}`);
const history = await get<{ kind: number; pnl: string }[]>(`/v1/accounts/${user.publicKey.toBase58()}/history`);
console.log('closed; balance', acct.account.balance, '· indexed fills:', history.map((h) => ({ kind: h.kind, pnl: h.pnl })));
console.log('user SOL balance at the end:', await connection.getBalance(user.publicKey));
// the relayer must refuse to sign anything that moves its own SOL
try {
  // needs only the relayer's signature, like a real attack
  await relay([SystemProgram.transfer({ fromPubkey: payer, toPubkey: user.publicKey, lamports: 1_000_000 })], null);
  throw new Error('relayer signed a transfer of its own SOL');
} catch (e) {
  const m = (e as Error).message.split('\n')[0]!;
  if (!m.includes('is not allowed')) throw e;
  console.log('relayer refused to sign a SOL transfer from itself:', m);
}
if (history.length < 2) throw new Error('expected two indexed fills');
console.log('engine smoke test passed');
