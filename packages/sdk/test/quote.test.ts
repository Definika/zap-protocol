import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { vaultNav, type ConfigParams, type Market, type Pool } from '../src';
import { PRICE_ONE, RATE_ONE, USD_ONE, unitsFor } from '../src/math';

const NOW = 1_800_000_000n;
const HOUR = 3_600n;

const params = (protocolFeeShareBps = 0): ConfigParams => ({
  pythStorage: PublicKey.default,
  oracleSigners: [],
  oracleSignerExpiry: [],
  usePythStorage: false,
  requiredChannel: 3,
  maxPriceAgeS: 5,
  maxFutureS: 5,
  maxFeedAgeS: 10,
  priceGraceMs: 1_000,
  minOrderUsd: 10n * USD_ONE,
  maxUtilBps: 8_000,
  liqFeeBps: 20,
  liquidatorShareBps: 5_000,
  protocolFeeShareBps,
  borrowKinkUtilBps: 7_500,
  borrowKinkAprBps: 3_000,
  borrowMaxAprBps: 10_000,
  fundingMaxHourly: RATE_ONE / 10_000n,
  sessionMaxSecs: 86_400,
  lpFeeBps: 0,
  lpCooldownS: 0,
  paused: false,
  lpPaused: false,
});

const pool = (p: Partial<Pool>): Pool => ({
  assets: 0n,
  reserved: 0n,
  lpSupply: 0n,
  protocolFees: 0n,
  borrowIndex: 0n,
  sumSizeBorrowEntry: 0n,
  borrowLastTs: NOW,
  seq: 0n,
  numMarkets: 0,
  bump: 255,
  cumTradingFees: 0n,
  cumBorrowFees: 0n,
  cumLiquidationFees: 0n,
  cumSpreadImpact: 0n,
  cumFundingNet: 0n,
  cumTraderPnl: 0n,
  cumVolume: 0n,
  ...p,
});

const market = (index: number, m: Partial<Market> = {}): Market => ({
  index,
  status: 0,
  bump: 255,
  feedId: index + 1,
  expo: -8,
  symbol: `M${index}-USD`,
  params: {
    maxLeverage: 100,
    mmrBps: 50,
    openFeeBps: 5,
    closeFeeBps: 5,
    confMultBps: 0,
    maxConfBps: 100,
    impactCapBps: 0,
    oiCapLongBps: 10_000,
    oiCapShortBps: 10_000,
    minSpreadFrac: 0n,
    impactDepthUsd: 0n,
    maxPositionUsd: 0n,
  },
  oiLong: 0n,
  oiShort: 0n,
  unitsLong: 0n,
  unitsShort: 0n,
  fundingIndexLong: 0n,
  fundingIndexShort: 0n,
  sumSfLong: 0n,
  sumSfShort: 0n,
  fundingRate: 0n,
  lastAccrualTs: NOW,
  lastPrice: 0n,
  lastConf: 0n,
  lastPriceTsUs: 0n,
  tradeSeq: 0n,
  cumVolume: 0n,
  cumFees: 0n,
  cumFundingNet: 0n,
  ...m,
});

// A $10,000 long entered at $100 with both indices at zero, last accrued an hour ago.
const size = 10_000n * USD_ONE;
const longMarket = market(0, {
  oiLong: size,
  unitsLong: unitsFor(size, 100n * PRICE_ONE, true),
  fundingRate: 27_777_777_777n, // ~0.01%/h, longs pay
  lastAccrualTs: NOW - HOUR,
});
const longPool = (assets: bigint) =>
  pool({ assets, lpSupply: assets, reserved: size, borrowIndex: RATE_ONE / 100n, borrowLastTs: NOW - HOUR, numMarkets: 1 });

describe('vaultNav', () => {
  it('equals assets with no open interest and no pending borrow', () => {
    const p = pool({ assets: 5_000_000n * USD_ONE, lpSupply: 5_000_000n * USD_ONE, numMarkets: 2, borrowLastTs: NOW - HOUR });
    // an idle hour accrues nothing at zero utilization, and markets without open interest need no price
    const markets = [market(0, { lastAccrualTs: NOW - HOUR }), market(1)];
    expect(vaultNav(p, markets, new Map(), params(1_000), NOW)).toBe(p.assets);
  });

  it('adds borrow and funding owed and subtracts trader profit, accrued to now', () => {
    const p = longPool(5_000_000n * USD_ONE);
    // util 20bps → 8bps APR → 25,367,834/s; index 1% + 3600s of it on $10k = 100_000_913, less 10% protocol (rounded up)
    const borrow = 100_000_913n - 10_000_092n;
    // 3600s × 27,777,777,777 on $10k, rounded down
    const funding = 999_999n;
    // $100 → $110 on $10k
    const upnl = 1_000n * USD_ONE;
    const prices = new Map([[0, 110n * PRICE_ONE]]);
    expect(vaultNav(p, [longMarket], prices, params(1_000), NOW)).toBe(p.assets + borrow + funding - upnl);
    // floored at zero when traders are owed more than the vault holds
    expect(vaultNav(longPool(500n * USD_ONE), [longMarket], prices, params(1_000), NOW)).toBe(0n);
  });

  it('needs every market, and a price for each with open interest', () => {
    const p = longPool(5_000_000n * USD_ONE);
    expect(() => vaultNav(p, [longMarket], new Map(), params(), NOW)).toThrow(/no price for market 0/);
    expect(() => vaultNav({ ...p, numMarkets: 2 }, [longMarket], new Map([[0, PRICE_ONE]]), params(), NOW)).toThrow(/all 2 markets/);
  });
});
