// Session keys: the key that signs trades without a wallet pop-up. It lives in this browser only, as a non-extractable
// WebCrypto Ed25519 key in IndexedDB (a plain keypair where the browser lacks Ed25519), one per owner. The program lets
// it trade and move funds between the trading balance and the vault, never withdraw.

import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

export interface SessionKey {
  publicKey: PublicKey;
  /** Unix seconds; the on-chain session must match this key and not be expired. */
  expiresAt: number;
  sign(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

interface Stored {
  owner: string;
  publicKey: Uint8Array;
  expiresAt: number;
  /** WebCrypto private key (non-extractable) or a raw 64-byte secret key (fallback). */
  key: CryptoKey | Uint8Array;
}

const DB = 'zap';
const STORE = 'sessions';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'owner' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

function wrap(s: Stored): SessionKey {
  const publicKey = new PublicKey(s.publicKey);
  return {
    publicKey,
    expiresAt: s.expiresAt,
    async sign(tx) {
      if (s.key instanceof Uint8Array) {
        tx.sign([Keypair.fromSecretKey(s.key)]);
        return tx;
      }
      const sig = await crypto.subtle.sign('Ed25519', s.key, new Uint8Array(tx.message.serialize()));
      tx.addSignature(publicKey, new Uint8Array(sig));
      return tx;
    },
  };
}

/** The stored session key for `owner`, if any (expired or not). */
export async function loadSession(owner: string): Promise<SessionKey | null> {
  try {
    const s = await run<Stored | undefined>('readonly', (st) => st.get(owner));
    return s ? wrap(s) : null;
  } catch {
    return null;
  }
}

/** Creates and stores a new session key for `owner` (replacing any previous one). */
export async function createSession(owner: string, lifetimeSecs: number): Promise<SessionKey> {
  const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSecs;
  let stored: Stored;
  try {
    const pair = (await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify'])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    stored = { owner, publicKey: raw, expiresAt, key: pair.privateKey };
  } catch {
    const kp = Keypair.generate();
    stored = { owner, publicKey: kp.publicKey.toBytes(), expiresAt, key: kp.secretKey };
  }
  try {
    await run('readwrite', (st) => st.put(stored));
  } catch {
    // private browsing without IndexedDB: the key still works for this page's lifetime
  }
  return wrap(stored);
}

export async function forgetSession(owner: string): Promise<void> {
  try {
    await run('readwrite', (st) => st.delete(owner));
  } catch {
    // nothing stored
  }
}
