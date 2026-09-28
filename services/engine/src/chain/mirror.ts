// In-memory mirror of ZAP's on-chain state: config, pool, every market and every trading account. Loaded with
// getProgramAccounts and kept current through program-account subscriptions plus a periodic resync.
// The keeper, the API and the WebSocket fan-out read from here, so browsers never need an RPC connection.

import { Connection, PublicKey, type AccountInfo } from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  PROGRAM_ID,
  configPda,
  decodeConfig,
  decodeMarket,
  decodePool,
  decodeTradingAccount,
  poolPda,
  type Config,
  type Market,
  type Pool,
  type TradingAccount,
} from '@zap-protocol/sdk';
import { logger } from '../log';

const log = logger('mirror');
const MARKET_SIZE = ACCOUNT_SIZE.Market;
const TRADING_ACCOUNT_SIZE = ACCOUNT_SIZE.TradingAccount;

export interface AccountEntry {
  address: PublicKey;
  account: TradingAccount;
  slot: number;
}

export type MirrorChange =
  | { kind: 'account'; owner: string; entry: AccountEntry | null }
  | { kind: 'market'; index: number; market: Market }
  | { kind: 'pool'; pool: Pool }
  | { kind: 'config'; config: Config };

type Listener = (c: MirrorChange) => void;

export class Mirror {
  config: Config | null = null;
  pool: Pool | null = null;
  markets = new Map<number, Market>();
  /** By owner (base58). */
  accounts = new Map<string, AccountEntry>();
  private byAddress = new Map<string, string>();
  private listeners = new Set<Listener>();
  private subs: number[] = [];
  private resyncTimer: NodeJS.Timeout | null = null;

  constructor(private readonly connection: Connection) {}

  on(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(c: MirrorChange) {
    for (const l of this.listeners) l(c);
  }

  private apply(address: PublicKey, info: AccountInfo<Buffer>, slot: number) {
    const data = info.data;
    try {
      if (address.equals(poolPda())) {
        this.pool = decodePool(data);
        this.emit({ kind: 'pool', pool: this.pool });
      } else if (address.equals(configPda())) {
        this.config = decodeConfig(data);
        this.emit({ kind: 'config', config: this.config });
      } else if (data.length === MARKET_SIZE) {
        const m = decodeMarket(data);
        this.markets.set(m.index, m);
        this.emit({ kind: 'market', index: m.index, market: m });
      } else if (data.length === TRADING_ACCOUNT_SIZE) {
        const account = decodeTradingAccount(data);
        const owner = account.owner.toBase58();
        const prev = this.accounts.get(owner);
        if (prev && prev.slot > slot) return;
        const entry = { address, account, slot };
        this.accounts.set(owner, entry);
        this.byAddress.set(address.toBase58(), owner);
        this.emit({ kind: 'account', owner, entry });
      }
    } catch (e) {
      log.warn(`could not decode ${address.toBase58()}`, e);
    }
  }

  async load() {
    const slot = await this.connection.getSlot('confirmed');
    const [config, pool] = await this.connection.getMultipleAccountsInfo([configPda(), poolPda()], 'confirmed');
    if (config) this.apply(configPda(), config, slot);
    if (pool) this.apply(poolPda(), pool, slot);
    for (const size of [MARKET_SIZE, TRADING_ACCOUNT_SIZE]) {
      const all = await this.connection.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed', filters: [{ dataSize: size }] });
      for (const a of all) this.apply(a.pubkey, a.account, slot);
    }
    log.info(`loaded ${this.markets.size} markets, ${this.accounts.size} accounts`);
  }

  /** Subscribes to program account changes; falls back to periodic resync when subscriptions aren't available. */
  async start(resyncMs = 60_000) {
    await this.load();
    try {
      this.subs.push(
        this.connection.onProgramAccountChange(
          PROGRAM_ID,
          (a, ctx) => this.apply(a.accountId, a.accountInfo, ctx.slot),
          { commitment: 'confirmed' },
        ),
      );
    } catch (e) {
      log.warn('program subscription unavailable, relying on resync', e);
    }
    this.resyncTimer = setInterval(() => this.load().catch((e) => log.warn('resync failed', e)), resyncMs);
  }

  /** Re-reads specific accounts now (after we send a transaction), without waiting for the subscription. */
  async refresh(addresses: PublicKey[]) {
    if (!addresses.length) return;
    const slot = await this.connection.getSlot('confirmed');
    const infos = await this.connection.getMultipleAccountsInfo(addresses, 'confirmed');
    infos.forEach((info, i) => {
      const address = addresses[i]!;
      if (info) this.apply(address, info, slot);
      else {
        const owner = this.byAddress.get(address.toBase58());
        if (owner) {
          this.accounts.delete(owner);
          this.emit({ kind: 'account', owner, entry: null });
        }
      }
    });
  }

  async stop() {
    for (const id of this.subs) await this.connection.removeProgramAccountChangeListener(id);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
  }
}
