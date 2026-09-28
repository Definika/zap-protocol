// Transaction pipeline for the app: every ZAP transaction is paid by the relayer. Trades are signed by the local session
// key (no wallet pop-up); owner actions (creating the account, deposits, withdrawals) are signed by the user's wallet.

import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { ZapErrorCode, assemble, buildV0, type PricedIx } from '@zap-protocol/sdk';
import { get, post } from './client';
import { store } from './store';

const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined) ?? 'http://127.0.0.1:8899';
export const connection = new Connection(RPC_URL, 'confirmed');

let lut: AddressLookupTableAccount | null = null;
async function lookupTable(): Promise<AddressLookupTableAccount | null> {
  if (lut) return lut;
  const key = store.config?.lookupTable as string | undefined;
  if (!key) return null;
  lut = (await connection.getAddressLookupTable(new PublicKey(key))).value;
  return lut;
}

/** Latest signed price message for a feed (what trades carry). */
export async function signedPrice(feedId: number): Promise<Uint8Array> {
  const r = await get<{ message: string }>(`/v1/prices/${feedId}/signed`);
  return Uint8Array.from(atob(r.message), (c) => c.charCodeAt(0));
}

/** One signed message with every feed (LP deposits and withdrawals price the whole vault). */
export async function signedAll(): Promise<Uint8Array> {
  const r = await get<{ message: string }>('/v1/prices/all/signed');
  return Uint8Array.from(atob(r.message), (c) => c.charCodeAt(0));
}

export type Signer = (tx: VersionedTransaction) => Promise<VersionedTransaction>;

const errorNames = new Map(Object.entries(ZapErrorCode).map(([name, code]) => [code, name]));
const FRIENDLY: Record<string, string> = {
  InsufficientBalance: 'Not enough balance in your trading account',
  MaxLeverage: 'Above the maximum leverage for this market',
  WouldBeLiquidatable: 'This would put the position at liquidation risk',
  Slippage: 'Price moved past your slippage tolerance',
  OiCap: 'Open interest cap reached for this side',
  UtilizationCap: 'Vault capacity reached; try a smaller size',
  MaxPosition: 'Position size above this market’s maximum',
  MinSize: 'Below the $10 minimum',
  PriceStale: 'Price was too old; please try again',
  BelowWatermark: 'A newer price was already used; please try again',
  SessionExpired: 'Your trading session expired; enable trading again',
  ProtocolPaused: 'Trading is paused',
  MarketPaused: 'This market is paused',
  MarketReduceOnly: 'This market only accepts closing trades',
  PostOnlyWouldFill: 'Post-only order would fill immediately',
  ConfidenceTooWide: 'Price is too uncertain right now; try again shortly',
  WithdrawLimit: 'Not enough free vault liquidity to withdraw that much now',
};

/** Human message for a relay/simulation failure (program error codes → names → sentences). */
export function describeError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const logs = (e as { logs?: string[] }).logs ?? [];
  const custom = [text, ...logs].join(' ').match(/Custom":?\s*(\d+)|custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const code = custom[1] ? Number(custom[1]) : parseInt(custom[2]!, 16);
    const name = errorNames.get(code);
    if (name) return FRIENDLY[name] ?? name.replace(/([A-Z])/g, ' $1').trim();
  }
  return text;
}

export interface SendResult {
  signature: string;
  confirmed: Promise<void>;
}

/** Builds a relayer-paid v0 transaction, signs it, relays it and returns once the relayer accepted it. */
export async function send(items: (TransactionInstruction | PricedIx)[], sign: Signer, computeUnitLimit = 300_000): Promise<SendResult> {
  const relayer = store.config?.relayer as string | undefined;
  if (!relayer) throw new Error('relayer unavailable');
  const [{ blockhash, lastValidBlockHeight }, table] = await Promise.all([connection.getLatestBlockhash('confirmed'), lookupTable()]);
  const tx = buildV0({
    payer: new PublicKey(relayer),
    instructions: assemble(items, { computeUnitLimit }),
    recentBlockhash: blockhash,
    lookupTables: table ? [table] : [],
  });
  const signed = await sign(tx);
  const { signature } = await post<{ signature: string }>('/v1/relay', { tx: btoa(String.fromCharCode(...signed.serialize())) });
  const confirmed = connection
    .confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
    .then((r) => {
      if (r.value.err) throw new Error(JSON.stringify(r.value.err));
    });
  return { signature, confirmed };
}
