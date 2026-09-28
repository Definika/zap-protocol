// Keeper: executes triggered orders and position TP/SL, liquidates unhealthy positions, and refreshes idle markets.
// Every action is permissionless on-chain and re-checked by the program; the keeper only decides when to try, using
// the same math (bit-exact SDK port) so it rarely wastes a transaction.

import { PublicKey, type Keypair } from '@solana/web3.js';
import {
  MARKETS,
  OrderKind,
  Side,
  TriggerTarget,
  accountPda,
  accruedIndices,
  assemble,
  conf12,
  createAccount,
  executeTrigger,
  expectedFill,
  liquidate,
  openOrders,
  openPositions,
  positionHealth,
  positionOwed,
  price12,
  refreshMarkets,
  triggered,
  type PricedIx,
} from '@zap-protocol/sdk';
import { config } from './config';
import type { Mirror } from './chain/mirror';
import type { Sender } from './chain/send';
import type { OracleHub, OracleSnapshot } from './oracle/hub';
import { logger } from './log';

const log = logger('keeper');
const EVAL_MS = 400;
const INFLIGHT_MS = 10_000;
/** Errors that just mean "not anymore" (someone else acted, or the price moved back). */
const EXPECTED = /TriggerNotMet|NotLiquidatable|IdMismatch|PositionNotFound|BelowWatermark|BelowPositionTimestamp|Slippage/;

const feedToMarket = new Map(MARKETS.map((m) => [m.pythProFeedId, m.index]));

export class Keeper {
  private inflight = new Map<string, number>();
  private lastEval = 0;
  private busy = false;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly mirror: Mirror,
    private readonly hub: OracleHub,
    private readonly sender: Sender,
    private readonly keeper: Keypair,
  ) {}

  async start() {
    // Liquidation rewards are credited to the keeper's own trading account.
    if (!this.mirror.accounts.has(this.keeper.publicKey.toBase58())) {
      try {
        await this.sender.send([createAccount(this.keeper.publicKey, this.keeper.publicKey, PublicKey.default, 0n)], [this.keeper]);
        await this.mirror.refresh([accountPda(this.keeper.publicKey)]);
        log.info('created keeper trading account');
      } catch (e) {
        log.warn('could not create keeper account (it may exist already)', e);
      }
    }
    this.hub.on((s) => {
      if (Date.now() - this.lastEval < EVAL_MS || this.busy) return;
      this.lastEval = Date.now();
      this.busy = true;
      void this.evaluate(s).finally(() => (this.busy = false));
    });
    this.refreshTimer = setInterval(() => void this.refreshIdle().catch((e) => log.warn('refresh failed', e)), config.keeper.refreshMs);
    log.info(`running as ${this.keeper.publicKey.toBase58()}`);
  }

  stop() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private take(key: string): boolean {
    const now = Date.now();
    const until = this.inflight.get(key);
    if (until && until > now) return false;
    this.inflight.set(key, now + INFLIGHT_MS);
    return true;
  }

  private async submit(key: string, owner: PublicKey, ix: PricedIx) {
    if (!this.take(key)) return;
    try {
      const sig = await this.sender.send(assemble([ix], { computeUnitLimit: 200_000 }), [this.keeper]);
      log.info(`${key} → ${sig}`);
      await this.mirror.refresh([accountPda(owner), accountPda(this.keeper.publicKey)]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (EXPECTED.test(msg) || /Custom":6(019|021|009|008|043|044|020)/.test(msg)) log.debug(`${key} skipped: ${msg.slice(0, 160)}`);
      else log.warn(`${key} failed`, msg.slice(0, 400));
    }
  }

  private async evaluate(s: OracleSnapshot) {
    const pool = this.mirror.pool;
    const params = this.mirror.config?.params;
    if (!pool || !params) return;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const jobs: Promise<void>[] = [];
    for (const [ownerKey, entry] of this.mirror.accounts) {
      const owner = entry.account.owner;
      for (const pos of openPositions(entry.account)) {
        const market = this.mirror.markets.get(pos.marketIndex);
        const tick = market ? s.ticks.get(market.feedId) : undefined;
        const msg = market ? s.perFeed.get(market.feedId) : undefined;
        if (!market || !tick || !msg) continue;
        const mid = price12(tick.price, tick.expo);
        const owed = positionOwed(pos, accruedIndices(pool, market, params, now));
        const health = positionHealth(pos, market, mid, owed);
        const id = pos.positionId;
        if (health.liquidatable) {
          jobs.push(this.submit(`liquidate:${ownerKey}:${id}`, owner, liquidate(this.keeper.publicKey, owner, market.index, msg, pos.side as 0 | 1, id, config.pythStorage)));
        } else if (pos.tpPrice && triggered(OrderKind.TakeProfit, pos.side, pos.tpPrice, mid)) {
          jobs.push(this.submit(`tp:${ownerKey}:${id}`, owner, executeTrigger(this.keeper.publicKey, owner, market.index, msg, TriggerTarget.PositionTp, pos.side as 0 | 1, id, config.pythStorage)));
        } else if (pos.slPrice && triggered(OrderKind.StopLoss, pos.side, pos.slPrice, mid)) {
          jobs.push(this.submit(`sl:${ownerKey}:${id}`, owner, executeTrigger(this.keeper.publicKey, owner, market.index, msg, TriggerTarget.PositionSl, pos.side as 0 | 1, id, config.pythStorage)));
        }
      }
      for (const o of openOrders(entry.account)) {
        const market = this.mirror.markets.get(o.marketIndex);
        const tick = market ? s.ticks.get(market.feedId) : undefined;
        const msg = market ? s.perFeed.get(market.feedId) : undefined;
        if (!market || !tick || !msg) continue;
        // the price must be published after the order was placed
        if (tick.tsUs < o.createdAt * 1_000_000n) continue;
        const mid = price12(tick.price, tick.expo);
        if (!triggered(o.kind, o.side, o.triggerPrice, mid)) continue;
        if (o.kind === OrderKind.Limit) {
          const isBuy = o.side === Side.Long;
          const fill = expectedFill(market, mid, conf12(tick.conf, tick.expo), o.sizeUsd, isBuy);
          if (isBuy ? fill.price > o.triggerPrice : fill.price < o.triggerPrice) continue;
        }
        jobs.push(
          this.submit(
            `order:${ownerKey}:${o.orderId}`,
            owner,
            executeTrigger(this.keeper.publicKey, owner, market.index, msg, TriggerTarget.Order, o.side as 0 | 1, o.orderId, config.pythStorage),
          ),
        );
      }
    }
    await Promise.all(jobs);
  }

  /** Moves the price watermark of markets that haven't traded in a few seconds (and accrues their funding). */
  private async refreshIdle() {
    const s = this.hub.latest;
    if (!s) return;
    const staleBefore = BigInt(Date.now() - 4_000) * 1000n;
    const idle = [...this.mirror.markets.values()]
      .filter((m) => m.status !== 2 && m.lastPriceTsUs < staleBefore && feedToMarket.has(m.feedId))
      .map((m) => m.index)
      .sort((a, b) => a - b);
    if (!idle.length) return;
    try {
      await this.sender.send(assemble([refreshMarkets(idle, s.all, config.pythStorage)], { computeUnitLimit: 400_000 }), [this.keeper]);
    } catch (e) {
      log.debug('refresh skipped', e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
}
