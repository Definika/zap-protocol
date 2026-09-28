// The app's view of the signed-in user: who they are, what signs for them, and the actions every screen uses.

import type { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';
import type { PricedIx } from '@zap-protocol/sdk';
import type { SendResult } from '../engine/tx';

export type WalletName = 'Phantom' | 'Backpack' | 'Solflare';
export type Items = (TransactionInstruction | PricedIx)[];

/** A login provider (Privy, or the local test wallet): identity plus the owner wallet's signer. */
export interface WalletBackend {
  ready: boolean;
  /** Owner wallet address; null while logged out (or while the embedded wallet is being created). */
  address: string | null;
  authenticated: boolean;
  /** Email, Google account or wallet name. */
  label: string;
  via: 'google' | 'email' | 'wallet' | 'dev';
  walletName: string;
  walletLogo: string;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  loginGoogle(): Promise<void>;
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(code: string): Promise<void>;
  loginWallet(name: WalletName): Promise<void>;
  logout(): Promise<void>;
  /** Bearer token for engine endpoints that need to know the user (faucet, relay). */
  accessToken(): Promise<string | null>;
}

export interface ZapUser {
  owner: string;
  label: string;
  via: WalletBackend['via'];
  walletName: string;
  walletLogo: string;
}

export interface Zap {
  ready: boolean;
  user: ZapUser | null;
  /** Logged in, but the login provider is still setting up the wallet. */
  pending: boolean;
  owner: PublicKey | null;
  session: PublicKey | null;
  hasAccount: boolean;
  /** Account exists and this browser holds its current, unexpired session key. */
  tradingReady: boolean;
  /** USDC in the owner's wallet (outside the trading account); null until known. */
  walletUsdc: number | null;
  /** Unix ms when the faucet can be used again; 0 = now; null = unknown. */
  faucetReadyAt: number | null;
  faucetAmount: number;

  loginGoogle(): Promise<void>;
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(code: string): Promise<void>;
  loginWallet(name: WalletName): Promise<void>;
  logout(): Promise<void>;

  /** Opens the one-signature "enable trading" flow. */
  requireTrading(): void;
  /** Opens deposit / withdraw between the wallet and the trading account. */
  openFunds(tab?: 'deposit' | 'withdraw'): void;
  faucet(): Promise<{ signature: string; amount: number }>;
  revokeSession(): Promise<void>;

  /** Signs with the session key and relays (gasless). */
  trade(items: Items, computeUnitLimit?: number): Promise<SendResult>;
  signedPrice(feedId: number): Promise<Uint8Array>;
  signedAll(): Promise<Uint8Array>;
}
