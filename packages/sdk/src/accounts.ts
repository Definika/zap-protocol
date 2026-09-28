// Decoders for ZAP's zero-copy accounts, driven by the byte layout generated from the Rust structs
// (`generated/layout.json`, written by `cargo test -p zap --test layout -- --ignored`).

import { BorshAccountsCoder, convertIdlToCamelCase, type Idl } from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import rawIdl from './idl/zap.json';
import layout from './generated/layout.json';
import { DISCRIMINATOR_LEN, SlotStatus } from './constants';

type Layout = typeof layout;
type StructName = keyof Layout;

const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function readField(view: DataView, bytes: Uint8Array, at: number, ty: string): unknown {
  switch (ty) {
    case 'u8':
      return view.getUint8(at);
    case 'u16':
      return view.getUint16(at, true);
    case 'i16':
      return view.getInt16(at, true);
    case 'u32':
      return view.getUint32(at, true);
    case 'u64':
      return view.getBigUint64(at, true);
    case 'i64':
      return view.getBigInt64(at, true);
    case 'u128':
      return view.getBigUint64(at, true) | (view.getBigUint64(at + 8, true) << 64n);
    case 'i128':
      return BigInt.asIntN(128, view.getBigUint64(at, true) | (view.getBigUint64(at + 8, true) << 64n));
    case 'pubkey':
      return new PublicKey(bytes.subarray(at, at + 32));
    case 'str16': {
      const s = bytes.subarray(at, at + 16);
      const end = s.indexOf(0);
      return new TextDecoder().decode(end < 0 ? s : s.subarray(0, end));
    }
    default: {
      const arr = ty.match(/^(\w+)\[(\d+)\]$/);
      if (arr) {
        const [, inner, n] = arr as unknown as [string, StructName, string];
        const size = layout[inner].size;
        return Array.from({ length: Number(n) }, (_, i) => decodeStruct(inner, bytes, at + i * size));
      }
      if (ty in layout) return decodeStruct(ty as StructName, bytes, at);
      throw new Error(`layout: unknown field type ${ty}`);
    }
  }
}

/** Decodes one struct at `base` into an object with camelCase keys. */
export function decodeStruct(name: StructName, bytes: Uint8Array, base = 0): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, unknown> = {};
  for (const [field, offset, ty] of layout[name].fields as [string, number, string][]) {
    out[camel(field)] = readField(view, bytes, base + offset, ty);
  }
  return out;
}

export interface MarketParams {
  maxLeverage: number;
  mmrBps: number;
  openFeeBps: number;
  closeFeeBps: number;
  confMultBps: number;
  maxConfBps: number;
  impactCapBps: number;
  oiCapLongBps: number;
  oiCapShortBps: number;
  minSpreadFrac: bigint;
  impactDepthUsd: bigint;
  maxPositionUsd: bigint;
}

export interface Pool {
  assets: bigint;
  reserved: bigint;
  lpSupply: bigint;
  protocolFees: bigint;
  borrowIndex: bigint;
  sumSizeBorrowEntry: bigint;
  borrowLastTs: bigint;
  seq: bigint;
  numMarkets: number;
  bump: number;
  cumTradingFees: bigint;
  cumBorrowFees: bigint;
  cumLiquidationFees: bigint;
  cumSpreadImpact: bigint;
  cumFundingNet: bigint;
  cumTraderPnl: bigint;
  cumVolume: bigint;
}

export interface Market {
  index: number;
  status: number;
  bump: number;
  feedId: number;
  expo: number;
  symbol: string;
  params: MarketParams;
  oiLong: bigint;
  oiShort: bigint;
  unitsLong: bigint;
  unitsShort: bigint;
  fundingIndexLong: bigint;
  fundingIndexShort: bigint;
  sumSfLong: bigint;
  sumSfShort: bigint;
  fundingRate: bigint;
  lastAccrualTs: bigint;
  lastPrice: bigint;
  lastConf: bigint;
  lastPriceTsUs: bigint;
  tradeSeq: bigint;
  cumVolume: bigint;
  cumFees: bigint;
  cumFundingNet: bigint;
}

export interface Position {
  positionId: bigint;
  sizeUsd: bigint;
  collateral: bigint;
  units: bigint;
  entryFundingIndex: bigint;
  entryBorrowIndex: bigint;
  lastPriceTsUs: bigint;
  openedAt: bigint;
  updatedAt: bigint;
  tpPrice: bigint;
  slPrice: bigint;
  realizedPnl: bigint;
  feesPaid: bigint;
  marketIndex: number;
  side: number;
  status: number;
}

export interface Order {
  orderId: bigint;
  positionId: bigint;
  sizeUsd: bigint;
  collateralEscrow: bigint;
  feeEscrow: bigint;
  triggerPrice: bigint;
  acceptablePrice: bigint;
  createdAt: bigint;
  tpPrice: bigint;
  slPrice: bigint;
  marketIndex: number;
  kind: number;
  side: number;
  flags: number;
  status: number;
}

export interface TradingAccount {
  owner: PublicKey;
  sessionKey: PublicKey;
  rentPayer: PublicKey;
  sessionExpiresAt: bigint;
  balance: bigint;
  lpShares: bigint;
  lpCostBasis: bigint;
  lpLastDepositTs: bigint;
  nextPositionId: bigint;
  nextOrderId: bigint;
  seq: bigint;
  createdAt: bigint;
  realizedPnl: bigint;
  feesPaid: bigint;
  fundingPaid: bigint;
  borrowPaid: bigint;
  volume: bigint;
  deposited: bigint;
  withdrawn: bigint;
  bump: number;
  version: number;
  /** All 16 slots; use `openPositions` for the live ones. */
  positions: Position[];
  /** All 24 slots; use `openOrders` for the live ones. */
  orders: Order[];
}

export const idl = convertIdlToCamelCase(rawIdl as Idl);
const accountsCoder = new BorshAccountsCoder(idl);

function checkDiscriminator(name: string, data: Uint8Array): Uint8Array {
  const expected = (idl.accounts ?? []).find((a) => a.name.toLowerCase() === name.toLowerCase())?.discriminator;
  if (!expected) throw new Error(`IDL has no account ${name}`);
  for (let i = 0; i < DISCRIMINATOR_LEN; i++) {
    if (data[i] !== expected[i]) throw new Error(`not a ${name} account`);
  }
  return data.subarray(DISCRIMINATOR_LEN);
}

export const decodePool = (data: Uint8Array) => decodeStruct('Pool', checkDiscriminator('Pool', data)) as unknown as Pool;
export const decodeMarket = (data: Uint8Array) =>
  decodeStruct('Market', checkDiscriminator('Market', data)) as unknown as Market;
export const decodeTradingAccount = (data: Uint8Array) =>
  decodeStruct('TradingAccount', checkDiscriminator('TradingAccount', data)) as unknown as TradingAccount;

export interface ConfigParams {
  pythStorage: PublicKey;
  oracleSigners: PublicKey[];
  oracleSignerExpiry: bigint[];
  usePythStorage: boolean;
  requiredChannel: number;
  maxPriceAgeS: number;
  maxFutureS: number;
  maxFeedAgeS: number;
  priceGraceMs: number;
  minOrderUsd: bigint;
  maxUtilBps: number;
  liqFeeBps: number;
  liquidatorShareBps: number;
  protocolFeeShareBps: number;
  borrowKinkUtilBps: number;
  borrowKinkAprBps: number;
  borrowMaxAprBps: number;
  fundingMaxHourly: bigint;
  sessionMaxSecs: number;
  lpFeeBps: number;
  lpCooldownS: number;
  paused: boolean;
  lpPaused: boolean;
}

export interface Config {
  admin: PublicKey;
  usdcMint: PublicKey;
  custody: PublicKey;
  bump: number;
  poolBump: number;
  custodyBump: number;
  params: ConfigParams;
}

const toBig = (v: unknown) => BigInt((v as { toString(): string }).toString());

/** Config is a Borsh account; decoded with the Anchor coder, with BN fields converted to bigint. */
export function decodeConfig(data: Uint8Array): Config {
  const raw = accountsCoder.decode('config', Buffer.from(data)) as Record<string, any>;
  const p = raw.params as Record<string, any>;
  return {
    admin: raw.admin,
    usdcMint: raw.usdcMint,
    custody: raw.custody,
    bump: raw.bump,
    poolBump: raw.poolBump,
    custodyBump: raw.custodyBump,
    params: {
      ...(p as ConfigParams),
      oracleSignerExpiry: (p.oracleSignerExpiry as unknown[]).map(toBig),
      minOrderUsd: toBig(p.minOrderUsd),
      fundingMaxHourly: toBig(p.fundingMaxHourly),
    },
  };
}

export const openPositions = (a: TradingAccount) => a.positions.filter((p) => p.status === SlotStatus.Open);
export const openOrders = (a: TradingAccount) => a.orders.filter((o) => o.status === SlotStatus.Open);
