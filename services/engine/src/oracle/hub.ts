// Latest signed prices, shared by the API (clients embed them in trades), the keeper and the indexer's candles.
// Sources (the dev oracle now, the Pyth Pro stream later) publish snapshots here.

export interface PriceTick {
  feedId: number;
  /** Mantissa in `expo`. */
  price: bigint;
  expo: number;
  conf: bigint;
  tsUs: bigint;
}

export interface OracleSnapshot {
  tsUs: bigint;
  ticks: Map<number, PriceTick>;
  /** Signed single-feed messages (with confidence), by feed id: what trades carry. */
  perFeed: Map<number, Uint8Array>;
  /** One signed message with every feed (no confidence): for refresh and LP deposits/withdrawals. */
  all: Uint8Array;
}

type Listener = (s: OracleSnapshot) => void;

export class OracleHub {
  latest: OracleSnapshot | null = null;
  readonly mode: 'dev' | 'pyth';
  private listeners = new Set<Listener>();

  constructor(mode: 'dev' | 'pyth') {
    this.mode = mode;
  }

  publish(s: OracleSnapshot) {
    this.latest = s;
    for (const l of this.listeners) {
      try {
        l(s);
      } catch {
        // listeners handle their own errors
      }
    }
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Age of the latest snapshot in milliseconds (Infinity before the first one). */
  ageMs(): number {
    return this.latest ? Date.now() - Number(this.latest.tsUs / 1000n) : Infinity;
  }
}

/** Price as a JS number in dollars, for display and candles. */
export const tickUsd = (t: PriceTick) => Number(t.price) * 10 ** t.expo;
