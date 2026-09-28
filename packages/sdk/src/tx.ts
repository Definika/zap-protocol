import {
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type PublicKey,
} from '@solana/web3.js';
import type { PricedIx } from './instructions';
import { ed25519Instruction } from './pythPro';

export interface AssembleOptions {
  computeUnitLimit?: number;
  /** Micro-lamports per compute unit. */
  computeUnitPrice?: number;
}

const isPriced = (x: TransactionInstruction | PricedIx): x is PricedIx => 'priceMsg' in x;

/**
 * Orders instructions for a transaction: compute budget first, then each instruction, with the ed25519 verification
 * inserted directly before every price-carrying one (pointing at that instruction's index).
 */
export function assemble(items: (TransactionInstruction | PricedIx)[], opts: AssembleOptions = {}): TransactionInstruction[] {
  const out: TransactionInstruction[] = [];
  if (opts.computeUnitLimit) out.push(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnitLimit }));
  if (opts.computeUnitPrice) out.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: opts.computeUnitPrice }));
  for (const item of items) {
    if (isPriced(item)) {
      out.push(ed25519Instruction(item.priceMsg, out.length + 1));
      out.push(item.ix);
    } else {
      out.push(item);
    }
  }
  return out;
}

export interface BuildTxArgs {
  /** Fee payer: the relayer for gasless transactions. */
  payer: PublicKey;
  instructions: TransactionInstruction[];
  recentBlockhash: string;
  lookupTables?: AddressLookupTableAccount[];
}

/** An unsigned v0 transaction. Sign with the user's key (session or owner) and send to the relayer, which co-signs. */
export function buildV0(a: BuildTxArgs): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: a.payer,
    recentBlockhash: a.recentBlockhash,
    instructions: a.instructions,
  }).compileToV0Message(a.lookupTables ?? []);
  return new VersionedTransaction(message);
}

/** Serialized size check against the 1232-byte packet limit. */
export const txSize = (tx: VersionedTransaction) => tx.serialize().length;
export const MAX_TX_SIZE = 1232;
