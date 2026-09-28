// Transaction sending for the engine's own keys (keeper, relayer, faucet): cached blockhash, the lookup table,
// confirmation, and rebroadcast until the blockhash expires.

import {
  Connection,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Keypair,
  type PublicKey,
  type TransactionInstruction,
} from '@solana/web3.js';
import { config } from '../config';
import { logger } from '../log';

const log = logger('send');

export class Sender {
  private blockhash: { blockhash: string; lastValidBlockHeight: number; at: number } | null = null;
  lookupTable: AddressLookupTableAccount | null = null;

  constructor(readonly connection: Connection) {}

  async init() {
    if (config.lookupTable) {
      this.lookupTable = (await this.connection.getAddressLookupTable(config.lookupTable)).value;
      if (!this.lookupTable) log.warn(`lookup table ${config.lookupTable.toBase58()} not found`);
    }
    await this.latestBlockhash();
  }

  async latestBlockhash() {
    if (!this.blockhash || Date.now() - this.blockhash.at > 2_000) {
      const b = await this.connection.getLatestBlockhash('confirmed');
      this.blockhash = { ...b, at: Date.now() };
    }
    return this.blockhash;
  }

  async build(instructions: TransactionInstruction[], payer: PublicKey): Promise<VersionedTransaction> {
    const { blockhash } = await this.latestBlockhash();
    const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(
      this.lookupTable ? [this.lookupTable] : [],
    );
    return new VersionedTransaction(msg);
  }

  /** Sends a fully signed transaction, rebroadcasting every 2s until it confirms or its blockhash expires. */
  async sendSigned(tx: VersionedTransaction, skipPreflight = true): Promise<string> {
    const raw = tx.serialize();
    const { lastValidBlockHeight } = await this.latestBlockhash();
    const sig = await this.connection.sendRawTransaction(raw, { skipPreflight, maxRetries: 0 });
    const rebroadcast = setInterval(() => {
      this.connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }, 2_000);
    try {
      const res = await this.connection.confirmTransaction(
        { signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (res.value.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    } finally {
      clearInterval(rebroadcast);
    }
  }

  /** Builds, signs with `signers` (first is the fee payer) and sends. */
  async send(instructions: TransactionInstruction[], signers: Keypair[]): Promise<string> {
    const tx = await this.build(instructions, signers[0]!.publicKey);
    tx.sign(signers);
    return this.sendSigned(tx, false);
  }
}
