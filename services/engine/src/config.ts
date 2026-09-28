import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
};
const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

const cluster = env('CLUSTER', 'localnet') as 'localnet' | 'devnet';
const repoRoot = resolve(import.meta.dirname, '../../..');
const keyDir = env('ZAP_KEY_DIR', resolve(homedir(), '.config/solana/zap'));

/** A keypair from `<NAME>_SECRET` (JSON byte array, for hosted deploys) or `<keyDir>/<file>.json`. */
function keypair(envName: string, file: string): Keypair {
  const inline = process.env[envName];
  const json = inline ?? readFileSync(resolve(keyDir, `${file}.json`), 'utf8');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
}

interface DeploymentFile {
  usdcMint: string;
  lookupTable?: string;
  pythStorage: string;
  usePythStorage: boolean;
}

const deploymentPath = resolve(repoRoot, 'config/deployments', `${cluster}.json`);
const deployment: DeploymentFile | null = process.env.DEPLOYMENT_JSON
  ? JSON.parse(process.env.DEPLOYMENT_JSON)
  : existsSync(deploymentPath)
    ? JSON.parse(readFileSync(deploymentPath, 'utf8'))
    : null;
if (!deployment) throw new Error(`no deployment for ${cluster}: run scripts/setup.ts or set DEPLOYMENT_JSON`);

export const config = {
  cluster,
  rpcUrls: env('RPC_URLS', cluster === 'devnet' ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899').split(','),
  rpcWsUrl: process.env.RPC_WS_URL,
  port: num('PORT', 8787),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5173').split(','),
  /** postgres://… for Neon; empty for an embedded PGlite database under `.data/`. */
  databaseUrl: process.env.DATABASE_URL ?? '',
  dataDir: env('DATA_DIR', resolve(repoRoot, '.data/engine')),
  usdcMint: new PublicKey(deployment.usdcMint),
  lookupTable: deployment.lookupTable ? new PublicKey(deployment.lookupTable) : null,
  pythStorage: new PublicKey(deployment.pythStorage),
  /** `dev`: our own signer with a random walk (local and pre-key); `pyth`: Pyth Pro stream with PYTH_PRO_TOKEN. */
  oracleMode: env('ORACLE_MODE', 'dev') as 'dev' | 'pyth',
  pythProToken: process.env.PYTH_PRO_TOKEN ?? '',
  /** Optional Pyth Pro stream endpoints (defaults to Pyth's redundant pool). */
  pythProUrls: (process.env.PYTH_PRO_URLS ?? '').split(',').filter(Boolean),
  roles: new Set(env('ENGINE_ROLES', 'oracle,api,relayer,faucet,keeper,indexer,snapshots').split(',')),
  keys: {
    relayer: () => keypair('RELAYER_SECRET', 'relayer'),
    keeper: () => keypair('KEEPER_SECRET', 'keeper'),
    faucet: () => keypair('FAUCET_SECRET', 'faucet'),
    oracle: () => keypair('ORACLE_DEV_SECRET', 'oracle-dev'),
  },
  privy: { appId: process.env.PRIVY_APP_ID ?? '', appSecret: process.env.PRIVY_APP_SECRET ?? '' },
  faucet: { amountUsd: num('FAUCET_AMOUNT_USD', 10_000), windowSecs: num('FAUCET_WINDOW_SECS', 86_400) },
  relayer: {
    maxCuLimit: num('RELAY_MAX_CU', 400_000),
    maxCuPriceMicroLamports: num('RELAY_MAX_CU_PRICE', 200_000),
    perUserPerMinute: num('RELAY_PER_USER_PER_MIN', 30),
    dailyLamportBudget: num('RELAY_DAILY_LAMPORTS', 5_000_000_000),
  },
  keeper: { refreshMs: num('REFRESH_MS', 5_000) },
};

export type Config = typeof config;
