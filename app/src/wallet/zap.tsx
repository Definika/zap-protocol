// ZAP's account layer on top of a login backend (Privy, or the local test wallet): follows the user's trading
// account, keeps this browser's session key, and runs the owner-signed flows (enable trading, deposit, withdraw) and
// the session-signed, relayer-paid trades.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAccount, deposit, revokeSession as revokeSessionIx, setSession, withdraw } from '@zap-protocol/sdk';
import { ApiError, get, post } from '../engine/client';
import { store } from '../engine/store';
import { connection, send, signedAll, signedPrice } from '../engine/tx';
import { setAddress } from '../terminal/keel';
import { createSession, forgetSession, loadSession, type SessionKey } from './session';
import type { Items, WalletBackend, Zap } from './types';

const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SESSION_SECS = 7 * 86_400;
const U6 = (x: number) => BigInt(Math.round(x * 1e6));

export const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];

const usdcMint = () => new PublicKey(String(store.config?.usdcMint));
const relayer = () => new PublicKey(String(store.config?.relayer));

export interface ZapUi {
  enableOpen: boolean;
  fundsTab: 'deposit' | 'withdraw' | null;
  closeEnable(): void;
  closeFunds(): void;
  setFundsTab(t: 'deposit' | 'withdraw'): void;
  /** Faucet (when the wallet needs USDC), new session key, then one wallet signature for account + deposit. */
  enableTrading(depositUsd: number, onStep: (step: string) => void): Promise<void>;
  depositFunds(amountUsd: number): Promise<string>;
  withdrawFunds(amountUsd: number): Promise<string>;
  refreshWallet(): void;
}

const ZapContext = createContext<(Zap & { ui: ZapUi }) | null>(null);

export function useZap() {
  const z = useContext(ZapContext);
  if (!z) throw new Error('useZap outside ZapProvider');
  return z;
}

export function ZapProvider({ backend, children }: { backend: WalletBackend; children: ReactNode }) {
  const address = backend.authenticated ? backend.address : null;
  const owner = useMemo(() => (address ? new PublicKey(address) : null), [address]);
  const [session, setSessionKey] = useState<SessionKey | null>(null);
  const [account, setAccount] = useState(() => ({ exists: false, key: '', expires: 0, loaded: false }));
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null);
  const [faucetReadyAt, setFaucetReadyAt] = useState<number | null>(null);
  const [enableOpen, setEnableOpen] = useState(false);
  const [fundsTab, setFundsTab] = useState<'deposit' | 'withdraw' | null>(null);
  const faucetAmount = Number((store.config?.faucet as { amountUsd?: number } | undefined)?.amountUsd ?? 10_000);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;

  // follow the owner's trading account and this browser's session key for it
  useEffect(() => {
    store.setOwner(address);
    setAddress(address ?? '');
    setSessionKey(null);
    setWalletUsdc(null);
    setFaucetReadyAt(null);
    if (!address) return;
    let live = true;
    void loadSession(address).then((s) => live && setSessionKey(s));
    return () => {
      live = false;
    };
  }, [address]);

  useEffect(() => {
    const un = store.subscribe(() => {
      const a = store.account;
      const next = { exists: !!a, key: a?.sessionKey ?? '', expires: Number(a?.sessionExpiresAt ?? 0), loaded: store.accountLoaded };
      setAccount((prev) => (prev.exists === next.exists && prev.key === next.key && prev.expires === next.expires && prev.loaded === next.loaded ? prev : next));
    });
    return () => {
      un();
    };
  }, []);

  const refreshWallet = useCallback(() => {
    const o = ownerRef.current;
    if (!o || !store.config) return;
    void connection
      .getTokenAccountBalance(ata(o, usdcMint()), 'confirmed')
      .then((b) => ownerRef.current === o && setWalletUsdc(Number(b.value.amount) / 1e6))
      .catch(() => ownerRef.current === o && setWalletUsdc(0));
    void get<{ waitSecs: number }>(`/v1/faucet/${o.toBase58()}`)
      .then((r) => ownerRef.current === o && setFaucetReadyAt(Date.now() + r.waitSecs * 1000))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!owner) return;
    refreshWallet();
    const t = setInterval(refreshWallet, 20_000);
    return () => clearInterval(t);
  }, [owner, refreshWallet]);

  const now = Math.floor(Date.now() / 1000);
  const tradingReady = !!(account.exists && session && account.key === session.publicKey.toBase58() && account.expires > now + 60);

  const ownerSend = useCallback(
    async (items: Items) => {
      const h = await send(items, (tx) => backend.signTransaction(tx));
      await h.confirmed;
      return h.signature;
    },
    [backend],
  );

  const faucet = useCallback(async () => {
    const o = ownerRef.current;
    if (!o) throw new Error('Log in first');
    const token = await backend.accessToken();
    try {
      const r = await post<{ signature: string; amount: number; nextClaimAt: number }>('/v1/faucet', { wallet: o.toBase58() }, token ?? undefined);
      setFaucetReadyAt(r.nextClaimAt * 1000);
      await connection.confirmTransaction(r.signature, 'confirmed').catch(() => {});
      refreshWallet();
      return { signature: r.signature, amount: r.amount };
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        refreshWallet();
        throw new Error('Already claimed in the last 24 hours');
      }
      throw e;
    }
  }, [backend, refreshWallet]);

  const enableTrading = useCallback(
    async (depositUsd: number, onStep: (step: string) => void) => {
      const o = ownerRef.current;
      if (!o) throw new Error('Log in first');
      if (depositUsd > 0) {
        const bal = await connection
          .getTokenAccountBalance(ata(o, usdcMint()), 'confirmed')
          .then((b) => Number(b.value.amount) / 1e6)
          .catch(() => 0);
        if (bal < depositUsd) {
          onStep('Getting test USDC…');
          await faucet();
        }
      }
      onStep('Approve in your wallet…');
      const sk = await createSession(o.toBase58(), SESSION_SECS);
      const expires = BigInt(sk.expiresAt);
      const items: Items = [store.account ? setSession(o, sk.publicKey, expires) : createAccount(o, relayer(), sk.publicKey, expires)];
      if (depositUsd > 0) items.push(deposit(o, ata(o, usdcMint()), usdcMint(), U6(depositUsd)));
      const h = await send(items, (tx) => backend.signTransaction(tx));
      onStep('Confirming…');
      await h.confirmed;
      setSessionKey(sk);
      refreshWallet();
    },
    [backend, faucet, refreshWallet],
  );

  const depositFunds = useCallback(
    async (amountUsd: number) => {
      const o = ownerRef.current!;
      const sig = await ownerSend([deposit(o, ata(o, usdcMint()), usdcMint(), U6(amountUsd))]);
      refreshWallet();
      return sig;
    },
    [ownerSend, refreshWallet],
  );

  const withdrawFunds = useCallback(
    async (amountUsd: number) => {
      const o = ownerRef.current!;
      const all = store.account && amountUsd * 1e6 >= Number(store.account.balance) - 0.5;
      const sig = await ownerSend([withdraw(o, ata(o, usdcMint()), usdcMint(), all ? BigInt(store.account!.balance) : U6(amountUsd))]);
      refreshWallet();
      return sig;
    },
    [ownerSend, refreshWallet],
  );

  const trade = useCallback(
    async (items: Items, computeUnitLimit?: number) => {
      if (!session || !tradingReady) {
        setEnableOpen(true);
        throw new Error('Enable trading to continue');
      }
      return send(items, (tx) => session.sign(tx), computeUnitLimit);
    },
    [session, tradingReady],
  );

  const revokeSession = useCallback(async () => {
    const o = ownerRef.current;
    if (!o || !session) return;
    const h = await send([revokeSessionIx(session.publicKey, o)], (tx) => session.sign(tx));
    await h.confirmed;
    await forgetSession(o.toBase58());
    setSessionKey(null);
  }, [session]);

  const value = useMemo(
    () => ({
      ready: backend.ready,
      user: address
        ? { owner: address, label: backend.label, via: backend.via, walletName: backend.walletName, walletLogo: backend.walletLogo }
        : null,
      pending: backend.authenticated && !address,
      owner,
      session: session?.publicKey ?? null,
      hasAccount: account.exists,
      tradingReady,
      walletUsdc,
      faucetReadyAt,
      faucetAmount,
      loginGoogle: backend.loginGoogle,
      sendEmailCode: backend.sendEmailCode,
      verifyEmailCode: backend.verifyEmailCode,
      loginWallet: backend.loginWallet,
      logout: backend.logout,
      requireTrading: () => setEnableOpen(true),
      openFunds: (tab: 'deposit' | 'withdraw' = 'deposit') => (tradingReady || account.exists ? setFundsTab(tab) : setEnableOpen(true)),
      faucet,
      revokeSession,
      trade,
      signedPrice,
      signedAll,
      ui: {
        enableOpen,
        fundsTab,
        closeEnable: () => setEnableOpen(false),
        closeFunds: () => setFundsTab(null),
        setFundsTab,
        enableTrading,
        depositFunds,
        withdrawFunds,
        refreshWallet,
      },
    }),
    [backend, address, owner, session, account, tradingReady, walletUsdc, faucetReadyAt, faucetAmount, faucet, revokeSession, trade, enableOpen, fundsTab, enableTrading, depositFunds, withdrawFunds, refreshWallet],
  );

  return <ZapContext.Provider value={value}>{children}</ZapContext.Provider>;
}
