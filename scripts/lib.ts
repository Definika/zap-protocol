// Shared helpers for admin scripts: cluster/RPC selection, keypairs (kept outside the repo), the deployment record,
// dev-signer price messages and transaction sending.

import { createPrivateKey, sign as edSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from '@solana/web3.js';
import { buildPayload, parseEvents, signPayload, type FeedInput } from '../packages/sdk/src/index.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CLUSTER = (process.env.CLUSTER ?? 'localnet') as 'localnet' | 'devnet';
export const RPC_URL = process.env.RPC_URL ?? (CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899');
export const KEY_DIR = process.env.ZAP_KEY_DIR ?? resolve(homedir(), '.config/solana/zap');
export const connection = new Connection(RPC_URL, 'confirmed');

export function loadKeypair(name: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(KEY_DIR, `${name}.json`), 'utf8'))));
}

export interface Deployment {
  cluster: string;
  programId: string;
  usdcMint: string;
  lookupTable?: string;
  admin: string;
  relayer: string;
  keeper: string;
  faucet: string;
  oracleSigner: string;
  pythStorage: string;
  usePythStorage: boolean;
}

const deploymentPath = () => resolve(ROOT, 'config/deployments', `${CLUSTER}.json`);

export function readDeployment(): Deployment | null {
  return existsSync(deploymentPath()) ? (JSON.parse(readFileSync(deploymentPath(), 'utf8')) as Deployment) : null;
}

export function writeDeployment(d: Deployment) {
  mkdirSync(dirname(deploymentPath()), { recursive: true });
  writeFileSync(deploymentPath(), `${JSON.stringify(d, null, 2)}\n`);
}

/** ed25519 signature with a Solana keypair via node:crypto (PKCS#8 wrapping of the 32-byte seed). */
export function ed25519Sign(kp: Keypair, data: Uint8Array): Uint8Array {
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(kp.secretKey.subarray(0, 32))]);
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  return new Uint8Array(edSign(null, data, key));
}

/** A price message for `feeds` signed by the dev signer, published now (multi-feed messages omit confidence). */
export async function devPriceMessage(signer: Keypair, feeds: { feedId: number; usd: number }[]): Promise<Uint8Array> {
  const nowUs = BigInt(Date.now()) * 1000n;
  const inputs: FeedInput[] = feeds.map((f) => ({
    feedId: f.feedId,
    price: BigInt(Math.round(f.usd * 1e8)),
    exponent: -8,
    feedUpdateTsUs: nowUs,
  }));
  return signPayload(buildPayload(nowUs, inputs, 3, feeds.length === 1), signer.publicKey.toBytes(), (p) => ed25519Sign(signer, p));
}

export async function sendTx(
  instructions: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[] = [],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(message);
  const all = [payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey))];
  tx.sign(all);
  try {
    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  } catch (e) {
    const logs = (e as { logs?: string[] }).logs ?? (e as { transactionLogs?: string[] }).transactionLogs;
    if (logs) console.error(logs.join('\n'));
    throw e;
  }
}

export async function eventsOf(signature: string) {
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  return parseEvents(tx?.meta?.logMessages ?? []);
}

export const exists = async (key: PublicKey) => (await connection.getAccountInfo(key)) !== null;

export const usd = (x: number) => BigInt(Math.round(x * 1e6));
