// Local test wallet for development without a Privy app: a keypair kept in this browser's storage, standing in for
// every login method. Only reachable in dev builds (see App.tsx); production always logs in through Privy.

import { useCallback, useMemo, useState } from 'react';
import { Keypair, type VersionedTransaction } from '@solana/web3.js';
import type { WalletBackend } from './types';

const KEY = 'zap-dev-wallet';

function stored(): Keypair | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[])) : null;
  } catch {
    return null;
  }
}

export function useDevBackend(): WalletBackend {
  const [kp, setKp] = useState<Keypair | null>(stored);
  const [label, setLabel] = useState('Test wallet');

  const login = useCallback(async (as: string) => {
    const k = stored() ?? Keypair.generate();
    try {
      localStorage.setItem(KEY, JSON.stringify([...k.secretKey]));
    } catch {
      // storage unavailable: the wallet lasts for this page only
    }
    setLabel(as);
    setKp(k);
  }, []);

  return useMemo(
    () => ({
      ready: true,
      address: kp?.publicKey.toBase58() ?? null,
      authenticated: !!kp,
      label,
      via: 'dev' as const,
      walletName: 'Test wallet',
      walletLogo: '/logos/usdc.png',
      signTransaction: async (tx: VersionedTransaction) => {
        if (!kp) throw new Error('Not logged in');
        tx.sign([kp]);
        return tx;
      },
      loginGoogle: () => login('Test wallet'),
      sendEmailCode: async () => {},
      verifyEmailCode: () => login('Test wallet'),
      loginWallet: () => login('Test wallet'),
      logout: async () => setKp(null),
      accessToken: async () => null,
    }),
    [kp, label, login],
  );
}
