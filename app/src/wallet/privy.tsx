// Privy login: Google, email one-time code, or a Solana wallet (Phantom, Backpack, Solflare), driven headlessly by the
// design's own login screen. Google and email users get a Privy embedded Solana wallet as their owner key; wallet
// users sign with their wallet.

import { useCallback, useMemo, type ReactNode } from 'react';
import { VersionedTransaction } from '@solana/web3.js';
import { PrivyProvider, useLogin, useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth';
import { toSolanaWalletConnectors, useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import type { WalletBackend, WalletName } from './types';

const WALLET_LOGOS: Record<string, string> = { phantom: '/logos/phantom.svg', backpack: '/logos/backpack.png', solflare: '/logos/solflare_icon.svg' };

export function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['google', 'email', 'wallet'],
        appearance: { theme: 'dark', accentColor: '#7B5CFA', walletChainType: 'solana-only', walletList: ['phantom', 'backpack', 'solflare'] },
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

type Linked = { type: string; address?: string; chainType?: string; walletClientType?: string };

export function usePrivyBackend(): WalletBackend {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();
  const { login } = useLogin();

  // the owner key: the external wallet the user logged in with, else their embedded Solana wallet
  const linked = (user?.linkedAccounts ?? []) as Linked[];
  const solana = linked.filter((a) => a.type === 'wallet' && a.chainType === 'solana');
  const external = solana.find((a) => a.walletClientType && a.walletClientType !== 'privy');
  const embedded = solana.find((a) => a.walletClientType === 'privy');
  const owner = external ?? embedded;
  const address = owner?.address ?? null;
  const wallet = wallets.find((w) => w.address === address);
  const client = external?.walletClientType ?? 'privy';

  const sign = useCallback(
    async (tx: VersionedTransaction) => {
      if (!wallet) throw new Error('Wallet not connected; reconnect it and try again');
      const { signedTransaction } = await signTransaction({ transaction: tx.serialize(), wallet, chain: 'solana:devnet' });
      return VersionedTransaction.deserialize(signedTransaction);
    },
    [wallet, signTransaction],
  );

  return useMemo(
    () => ({
      ready,
      authenticated,
      address,
      label: user?.google?.email ?? user?.email?.address ?? (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : ''),
      via: user?.google ? 'google' : user?.email ? 'email' : 'wallet',
      walletName: external ? client[0]!.toUpperCase() + client.slice(1) : 'ZAP wallet',
      walletLogo: WALLET_LOGOS[client] ?? '/logos/usdc.png',
      signTransaction: sign,
      loginGoogle: () => initOAuth({ provider: 'google' }),
      sendEmailCode: (email: string) => sendCode({ email }),
      verifyEmailCode: (code: string) => loginWithCode({ code }),
      // Privy's wallet picker, limited to Solana wallets (the design's buttons name the wallet the user meant)
      loginWallet: async (_name: WalletName) => login({ loginMethods: ['wallet'], walletChainType: 'solana-only' }),
      logout,
      accessToken: () => getAccessToken(),
    }),
    [ready, authenticated, address, user, external, client, sign, initOAuth, sendCode, loginWithCode, login, logout, getAccessToken],
  );
}
