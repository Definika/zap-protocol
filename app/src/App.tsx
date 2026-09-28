import { lazy, Suspense, useEffect, useState } from 'react';
import { store } from './engine/store';
import { Terminal } from './terminal/Terminal';
import { useDevBackend } from './wallet/dev';
import { PrivyRoot, usePrivyBackend } from './wallet/privy';
import type { WalletBackend } from './wallet/types';
import { useZap, ZapProvider } from './wallet/zap';

// Dev-only: the design's original logic (with its mock data) rendered through the converted components, for visual parity
// checks (`?design`). `import.meta.env.DEV` is false in production builds, so this code and its mocks are never shipped.
const DesignPreview = import.meta.env.DEV ? lazy(() => import('./design/preview/DesignPreview')) : null;

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined;

function Shell() {
  return <Terminal zap={useZap()} />;
}

function WithBackend({ useBackend }: { useBackend: () => WalletBackend }) {
  const backend = useBackend();
  return (
    <ZapProvider backend={backend}>
      <Shell />
    </ZapProvider>
  );
}

function Unconfigured(): WalletBackend {
  const no = () => Promise.reject(new Error('Login is not configured for this deployment'));
  return {
    ready: true,
    address: null,
    authenticated: false,
    label: '',
    via: 'wallet',
    walletName: '',
    walletLogo: '',
    signTransaction: no,
    loginGoogle: no,
    sendEmailCode: no,
    verifyEmailCode: no,
    loginWallet: no,
    logout: async () => {},
    accessToken: async () => null,
  };
}

export function App() {
  const [, setReady] = useState(false);
  useEffect(() => {
    void store.init().then(() => setReady(true));
  }, []);

  if (DesignPreview && new URLSearchParams(location.search).has('design')) {
    return (
      <Suspense fallback={null}>
        <DesignPreview />
      </Suspense>
    );
  }
  if (PRIVY_APP_ID) {
    return (
      <PrivyRoot appId={PRIVY_APP_ID}>
        <WithBackend useBackend={usePrivyBackend} />
      </PrivyRoot>
    );
  }
  // without a Privy app, development builds log in with a local test wallet
  return <WithBackend useBackend={import.meta.env.DEV ? useDevBackend : Unconfigured} />;
}
