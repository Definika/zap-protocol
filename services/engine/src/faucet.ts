// Test-USDC faucet: 10,000 per 24h per wallet and per user. The relayer pays for the token account, so a fresh
// Google/email wallet needs no SOL.

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import type { Keypair, PublicKey } from '@solana/web3.js';
import { config } from './config';
import type { Db } from './db';
import type { Sender } from './chain/send';
import { logger } from './log';

const log = logger('faucet');

export class FaucetError extends Error {
  constructor(message: string, readonly nextClaimAt?: number) {
    super(message);
  }
}

export class Faucet {
  constructor(
    private readonly db: Db,
    private readonly sender: Sender,
    private readonly relayer: Keypair,
    private readonly authority: Keypair,
  ) {}

  /** Seconds until `wallet`/`userId` may claim again (0 = now). */
  async cooldown(wallet: PublicKey, userId: string): Promise<number> {
    const since = Math.floor(Date.now() / 1000) - config.faucet.windowSecs;
    const rows = await this.db.query<{ ts: string }>(
      'select max(ts) as ts from faucet_claims where (wallet = $1 or user_id = $2) and ts > $3',
      [wallet.toBase58(), userId, since],
    );
    const last = rows[0]?.ts ? Number(rows[0].ts) : 0;
    return last ? Math.max(0, last + config.faucet.windowSecs - Math.floor(Date.now() / 1000)) : 0;
  }

  async claim(wallet: PublicKey, userId: string): Promise<{ signature: string; amount: number; nextClaimAt: number }> {
    const wait = await this.cooldown(wallet, userId);
    if (wait > 0) throw new FaucetError('already claimed in the last 24 hours', Math.floor(Date.now() / 1000) + wait);
    const now = Math.floor(Date.now() / 1000);
    // record first so concurrent requests can't both mint
    await this.db.query('insert into faucet_claims (wallet, user_id, ts) values ($1, $2, $3)', [wallet.toBase58(), userId, now]);
    try {
      const ata = getAssociatedTokenAddressSync(config.usdcMint, wallet, true);
      const amount = BigInt(config.faucet.amountUsd) * 1_000_000n;
      const signature = await this.sender.send(
        [
          createAssociatedTokenAccountIdempotentInstruction(this.relayer.publicKey, ata, wallet, config.usdcMint),
          createMintToInstruction(config.usdcMint, ata, this.authority.publicKey, amount),
        ],
        [this.relayer, this.authority],
      );
      log.info(`minted ${config.faucet.amountUsd} to ${wallet.toBase58()}`, { signature });
      return { signature, amount: config.faucet.amountUsd, nextClaimAt: now + config.faucet.windowSecs };
    } catch (e) {
      await this.db.query('delete from faucet_claims where wallet = $1 and ts = $2', [wallet.toBase58(), now]);
      throw e;
    }
  }
}
