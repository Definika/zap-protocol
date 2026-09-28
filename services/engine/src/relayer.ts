// Gasless relayer: co-signs users' transactions as fee payer (and rent payer for new trading accounts).
// The relayer's signature authorizes everything its key appears in, so a transaction is only co-signed when it can't
// spend the relayer's SOL beyond the fee and the rent of a new trading account.

import { createPublicKey, verify as edVerify } from 'node:crypto';
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  VersionedTransaction,
  type Keypair,
  type MessageAccountKeys,
} from '@solana/web3.js';
import { ED25519_PROGRAM_ID, PROGRAM_ID, idl } from '@zap-protocol/sdk';
import { config } from './config';
import { logger } from './log';
import type { Sender } from './chain/send';

const log = logger('relayer');

/** User-facing instructions the relayer pays for. Keeper cranks and admin instructions are not relayed. */
const RELAYABLE = new Set([
  'createAccount', 'setSession', 'revokeSession', 'deposit', 'withdraw', 'closeAccount', 'openPosition', 'closePosition',
  'reversePosition', 'addCollateral', 'removeCollateral', 'setTpsl', 'placeOrder', 'updateOrder', 'cancelOrder',
  'lpDeposit', 'lpWithdraw',
]);
/** Instructions where the relayer may appear, and in which account slot. */
const RELAYER_SLOT: Record<string, string> = { createAccount: 'rentPayer', closeAccount: 'rentPayer' };
/** Rent of a new trading account (4,592 bytes) plus headroom. */
const MAX_RENT_LAMPORTS = 40_000_000;

type IdlIx = { name: string; discriminator: number[]; accounts: { name: string }[] };
const byDiscriminator = new Map((idl.instructions as unknown as IdlIx[]).map((i) => [Buffer.from(i.discriminator).toString('hex'), i]));

export class RelayError extends Error {
  constructor(readonly code: string, message: string, readonly logs?: string[]) {
    super(message);
  }
}

function verifyEd25519(pubkey: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubkey.toBuffer()]),
    format: 'der',
    type: 'spki',
  });
  return edVerify(null, message, key, signature);
}

class Window {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly ms: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.ms);
    if (recent.length >= this.limit) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export interface RelayResult {
  signature: string;
  /** Trading accounts the transaction touches (for fast mirror refresh). */
  accounts: PublicKey[];
}

export class Relayer {
  private perSigner = new Window(config.relayer.perUserPerMinute, 60_000);
  private perIp = new Window(config.relayer.perUserPerMinute * 2, 60_000);
  private spentToday = { day: '', lamports: 0 };

  constructor(
    private readonly connection: Connection,
    private readonly sender: Sender,
    readonly relayer: Keypair,
  ) {}

  /** Validates, co-signs and sends a base64 transaction signed by the user (owner or session key). */
  async relay(txBase64: string, ctx: { ip: string; userId?: string }): Promise<RelayResult> {
    const raw = Buffer.from(txBase64, 'base64');
    if (raw.length > 1232) throw new RelayError('too_large', 'transaction exceeds 1232 bytes');
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(raw);
    } catch {
      throw new RelayError('malformed', 'not a transaction');
    }
    if (tx.version !== 0) throw new RelayError('version', 'only v0 transactions are relayed');
    const msg = tx.message;
    const me = this.relayer.publicKey;
    if (!msg.staticAccountKeys[0]?.equals(me)) throw new RelayError('fee_payer', 'the relayer must be the fee payer');
    if (tx.signatures[0]?.some((b) => b !== 0)) throw new RelayError('fee_payer', 'fee payer signature slot must be empty');

    // Only our lookup table.
    const lut = this.sender.lookupTable;
    for (const l of msg.addressTableLookups) {
      if (!lut || !l.accountKey.equals(lut.key)) throw new RelayError('lookup_table', 'unknown lookup table');
    }
    let keys: MessageAccountKeys;
    try {
      keys = msg.getAccountKeys({ addressLookupTableAccounts: lut ? [lut] : [] });
    } catch {
      throw new RelayError('lookup_table', 'could not resolve lookup table addresses');
    }

    // Instructions: compute budget (capped), ed25519 (right before a ZAP instruction), and relayable ZAP instructions.
    let cuLimit = 200_000;
    let cuPrice = 0;
    let createsAccount = false;
    // precompile signatures are charged like transaction signatures
    let precompileSigs = 0;
    const touched: PublicKey[] = [];
    const ixs = msg.compiledInstructions;
    ixs.forEach((ix, i) => {
      const program = keys.get(ix.programIdIndex);
      const data = Buffer.from(ix.data);
      if (!program) throw new RelayError('program', 'missing program');
      if (program.equals(ComputeBudgetProgram.programId)) {
        if (data[0] === 2 && data.length === 5) cuLimit = data.readUInt32LE(1);
        else if (data[0] === 3 && data.length === 9) cuPrice = Number(data.readBigUInt64LE(1));
        else throw new RelayError('compute_budget', 'unsupported compute budget instruction');
        return;
      }
      if (program.equals(ED25519_PROGRAM_ID)) {
        const next = ixs[i + 1];
        if (data.length !== 16 || ix.accountKeyIndexes.length !== 0 || !next || !keys.get(next.programIdIndex)?.equals(PROGRAM_ID)) {
          throw new RelayError('ed25519', 'ed25519 verification must directly precede a ZAP instruction');
        }
        precompileSigs += data[0] ?? 0;
        return;
      }
      if (!program.equals(PROGRAM_ID)) throw new RelayError('program', `program ${program.toBase58()} is not allowed`);
      const def = byDiscriminator.get(data.subarray(0, 8).toString('hex'));
      if (!def || !RELAYABLE.has(def.name)) throw new RelayError('instruction', `instruction ${def?.name ?? 'unknown'} is not relayed`);
      if (def.name === 'createAccount') createsAccount = true;
      ix.accountKeyIndexes.forEach((k, slot) => {
        const key = keys.get(k);
        if (!key) return;
        if (key.equals(me) && def.accounts[slot]?.name !== RELAYER_SLOT[def.name]) {
          throw new RelayError('relayer_account', `the relayer can't be ${def.accounts[slot]?.name ?? 'an extra account'} in ${def.name}`);
        }
        if (def.accounts[slot]?.name === 'account') touched.push(key);
      });
    });
    if (cuLimit > config.relayer.maxCuLimit) throw new RelayError('compute_budget', 'compute unit limit too high');
    if (cuPrice > config.relayer.maxCuPriceMicroLamports) throw new RelayError('compute_budget', 'priority fee too high');

    // Every signature except ours must be present and valid.
    const bytes = msg.serialize();
    for (let i = 1; i < msg.header.numRequiredSignatures; i++) {
      const signer = msg.staticAccountKeys[i]!;
      const sig = tx.signatures[i]!;
      if (sig.every((b) => b === 0) || !verifyEd25519(signer, bytes, sig)) throw new RelayError('signature', `missing or invalid signature for ${signer.toBase58()}`);
    }

    const signerKey = msg.staticAccountKeys[1]?.toBase58() ?? 'none';
    if (!this.perSigner.take(ctx.userId ?? signerKey) || !this.perIp.take(ctx.ip)) throw new RelayError('rate_limit', 'too many transactions, slow down');

    const fee = 5_000 * (msg.header.numRequiredSignatures + precompileSigs) + Math.ceil((cuPrice * cuLimit) / 1_000_000);
    const allowance = fee + (createsAccount ? MAX_RENT_LAMPORTS : 0);
    const day = new Date().toISOString().slice(0, 10);
    if (this.spentToday.day !== day) this.spentToday = { day, lamports: 0 };
    if (this.spentToday.lamports + allowance > config.relayer.dailyLamportBudget) throw new RelayError('budget', 'relayer daily budget exhausted');

    tx.sign([this.relayer]);
    const before = await this.connection.getBalance(me, 'confirmed');
    const sim = await this.connection.simulateTransaction(tx, {
      sigVerify: true,
      commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: [me.toBase58()] },
    });
    if (sim.value.err) {
      throw new RelayError('simulation', `transaction would fail: ${JSON.stringify(sim.value.err)}`, sim.value.logs ?? undefined);
    }
    const after = sim.value.accounts?.[0]?.lamports;
    // Whether or not the simulated balance includes the fee, the relayer may lose at most the fee plus allowed rent.
    if (after === undefined || before - after > allowance) {
      throw new RelayError('relayer_spend', 'transaction would spend the relayer’s SOL');
    }

    const signature = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
    this.spentToday.lamports += allowance;
    log.info(`relayed ${signature}`, { signer: signerKey, user: ctx.userId });
    return { signature, accounts: touched };
  }
}
