// Instruction builders. Account order and signer/writable flags come from the IDL, so builders only name accounts.
// Price-carrying instructions return a `PricedIx`; `assemble` (tx.ts) inserts the ed25519 verification before each.

import { BN, BorshInstructionCoder } from '@anchor-lang/core';
import { PublicKey, TransactionInstruction, type AccountMeta } from '@solana/web3.js';
import { idl } from './accounts';
import {
  INSTRUCTIONS_SYSVAR_ID,
  PROGRAM_ID,
  PYTH_PRO_STORAGE_DEVNET,
  TOKEN_PROGRAM_ID,
  TriggerTarget,
  type SideValue,
} from './constants';
import { accountPda, configPda, custodyPda, marketPda, poolPda } from './pda';

const coder = new BorshInstructionCoder(idl);
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

export interface PricedIx {
  ix: TransactionInstruction;
  /** Signed Pyth Pro message carried as the first argument. */
  priceMsg: Uint8Array;
}

/** bigint → BN and Uint8Array → Buffer, recursively (what the Borsh coder expects). */
function toCoder(v: unknown): unknown {
  if (typeof v === 'bigint') return new BN(v.toString());
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (v instanceof PublicKey || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(toCoder);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toCoder(x)]));
}

type IdlAccount = { name: string; writable?: boolean; signer?: boolean; address?: string };

/** Builds any ZAP instruction by IDL name (camelCase), with accounts by IDL name. */
export function instruction(
  name: string,
  args: Record<string, unknown>,
  accounts: Record<string, PublicKey>,
  remaining: AccountMeta[] = [],
  programId = PROGRAM_ID,
): TransactionInstruction {
  const def = idl.instructions.find((i) => i.name === name);
  if (!def) throw new Error(`unknown instruction ${name}`);
  const keys = (def.accounts as IdlAccount[]).map((a) => {
    const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
    if (!pubkey) throw new Error(`${name}: missing account ${a.name}`);
    return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
  });
  return new TransactionInstruction({
    programId,
    keys: [...keys, ...remaining],
    data: coder.encode(name, toCoder(args) as object),
  });
}

/** Accounts shared by instructions that trade at a price. */
export interface TradeAccounts {
  /** The owner's wallet or its session key. */
  signer: PublicKey;
  owner: PublicKey;
  market: number;
  pythStorage?: PublicKey;
}

function tradeKeys(a: TradeAccounts) {
  return {
    signer: a.signer,
    config: configPda(),
    pool: poolPda(),
    market: marketPda(a.market),
    account: accountPda(a.owner),
    pythStorage: a.pythStorage ?? PYTH_PRO_STORAGE_DEVNET,
    instructions: INSTRUCTIONS_SYSVAR_ID,
  };
}

function noPriceKeys(a: Omit<TradeAccounts, 'pythStorage'>) {
  return { signer: a.signer, config: configPda(), pool: poolPda(), market: marketPda(a.market), account: accountPda(a.owner) };
}

// Accounts

export const createAccount = (owner: PublicKey, rentPayer: PublicKey, sessionKey: PublicKey, sessionExpiresAt: bigint) =>
  instruction('createAccount', { sessionKey, sessionExpiresAt }, { owner, rentPayer, config: configPda(), account: accountPda(owner) });

export const setSession = (owner: PublicKey, sessionKey: PublicKey, sessionExpiresAt: bigint) =>
  instruction('setSession', { sessionKey, sessionExpiresAt }, { owner, config: configPda(), account: accountPda(owner) });

export const revokeSession = (signer: PublicKey, owner: PublicKey) =>
  instruction('revokeSession', {}, { signer, account: accountPda(owner) });

export const deposit = (owner: PublicKey, ownerUsdc: PublicKey, usdcMint: PublicKey, amount: bigint) =>
  instruction(
    'deposit',
    { amount },
    { owner, config: configPda(), account: accountPda(owner), ownerUsdc, custody: custodyPda(), usdcMint, tokenProgram: TOKEN_PROGRAM_ID },
  );

export const withdraw = (owner: PublicKey, ownerUsdc: PublicKey, usdcMint: PublicKey, amount: bigint) =>
  instruction(
    'withdraw',
    { amount },
    {
      owner,
      config: configPda(),
      pool: poolPda(),
      account: accountPda(owner),
      ownerUsdc,
      custody: custodyPda(),
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    },
  );

export const closeAccount = (owner: PublicKey, rentPayer: PublicKey) =>
  instruction('closeAccount', {}, { owner, account: accountPda(owner), rentPayer });

// Trading

export interface OpenArgs {
  side: SideValue;
  size: bigint;
  collateral: bigint;
  /** Worst acceptable fill price (12 decimals); 0 = none. */
  acceptablePrice?: bigint;
  tpPrice?: bigint;
  slPrice?: bigint;
}

export const openPosition = (a: TradeAccounts, priceMsg: Uint8Array, o: OpenArgs): PricedIx => ({
  priceMsg,
  ix: instruction(
    'openPosition',
    {
      priceMsg,
      side: o.side,
      size: o.size,
      collateral: o.collateral,
      acceptablePrice: o.acceptablePrice ?? 0n,
      tpPrice: o.tpPrice ?? 0n,
      slPrice: o.slPrice ?? 0n,
    },
    tradeKeys(a),
  ),
});

export const closePosition = (
  a: TradeAccounts,
  priceMsg: Uint8Array,
  side: SideValue,
  positionId: bigint,
  size: bigint = 2n ** 64n - 1n,
  acceptablePrice = 0n,
): PricedIx => ({
  priceMsg,
  ix: instruction('closePosition', { priceMsg, side, positionId, size, acceptablePrice }, tradeKeys(a)),
});

export const reversePosition = (a: TradeAccounts, priceMsg: Uint8Array, side: SideValue, positionId: bigint, acceptablePrice = 0n): PricedIx => ({
  priceMsg,
  ix: instruction('reversePosition', { priceMsg, side, positionId, acceptablePrice }, tradeKeys(a)),
});

export const addCollateral = (a: Omit<TradeAccounts, 'pythStorage'>, side: SideValue, positionId: bigint, amount: bigint) =>
  instruction('addCollateral', { side, positionId, amount }, noPriceKeys(a));

export const removeCollateral = (a: TradeAccounts, priceMsg: Uint8Array, side: SideValue, positionId: bigint, amount: bigint): PricedIx => ({
  priceMsg,
  ix: instruction('removeCollateral', { priceMsg, side, positionId, amount }, tradeKeys(a)),
});

export const setTpsl = (a: Omit<TradeAccounts, 'pythStorage'>, side: SideValue, positionId: bigint, tpPrice: bigint, slPrice: bigint) =>
  instruction('setTpsl', { side, positionId, tpPrice, slPrice }, noPriceKeys(a));

// Orders

export interface PlaceOrderArgs {
  side: SideValue;
  kind: number;
  flags?: number;
  /** Required for reduce orders (take-profit, stop-loss, reduce-only). */
  positionId?: bigint;
  size: bigint;
  collateral?: bigint;
  triggerPrice: bigint;
  acceptablePrice?: bigint;
  tpPrice?: bigint;
  slPrice?: bigint;
}

const orderKeys = (signer: PublicKey, owner: PublicKey, market: number) => ({
  signer,
  config: configPda(),
  market: marketPda(market),
  account: accountPda(owner),
});

export const placeOrder = (signer: PublicKey, owner: PublicKey, market: number, o: PlaceOrderArgs) =>
  instruction(
    'placeOrder',
    {
      side: o.side,
      kind: o.kind,
      flags: o.flags ?? 0,
      positionId: o.positionId ?? 0n,
      sizeUsd: o.size,
      collateral: o.collateral ?? 0n,
      triggerPrice: o.triggerPrice,
      acceptablePrice: o.acceptablePrice ?? 0n,
      tpPrice: o.tpPrice ?? 0n,
      slPrice: o.slPrice ?? 0n,
    },
    orderKeys(signer, owner, market),
  );

export const updateOrder = (signer: PublicKey, owner: PublicKey, market: number, orderId: bigint, triggerPrice: bigint, acceptablePrice = 0n) =>
  instruction('updateOrder', { orderId, triggerPrice, acceptablePrice }, orderKeys(signer, owner, market));

export const cancelOrder = (signer: PublicKey, owner: PublicKey, market: number, orderId: bigint) =>
  instruction('cancelOrder', { orderId }, orderKeys(signer, owner, market));

// Keeper (permissionless)

export const executeTrigger = (
  executor: PublicKey,
  owner: PublicKey,
  market: number,
  priceMsg: Uint8Array,
  target: number,
  side: SideValue,
  id: bigint,
  pythStorage: PublicKey = PYTH_PRO_STORAGE_DEVNET,
): PricedIx => ({
  priceMsg,
  ix: instruction(
    'executeTrigger',
    { priceMsg, target, side, id },
    {
      executor,
      config: configPda(),
      pool: poolPda(),
      market: marketPda(market),
      account: accountPda(owner),
      pythStorage,
      instructions: INSTRUCTIONS_SYSVAR_ID,
    },
  ),
});

export const liquidate = (
  liquidator: PublicKey,
  owner: PublicKey,
  market: number,
  priceMsg: Uint8Array,
  side: SideValue,
  positionId: bigint,
  pythStorage: PublicKey = PYTH_PRO_STORAGE_DEVNET,
): PricedIx => ({
  priceMsg,
  ix: instruction(
    'liquidate',
    { priceMsg, side, positionId },
    {
      liquidator,
      liquidatorAccount: accountPda(liquidator),
      config: configPda(),
      pool: poolPda(),
      market: marketPda(market),
      account: accountPda(owner),
      pythStorage,
      instructions: INSTRUCTIONS_SYSVAR_ID,
    },
  ),
});

const marketMetas = (markets: number[]): AccountMeta[] =>
  markets.map((m) => ({ pubkey: marketPda(m), isSigner: false, isWritable: true }));

export const refreshMarkets = (markets: number[], priceMsg: Uint8Array, pythStorage: PublicKey = PYTH_PRO_STORAGE_DEVNET): PricedIx => ({
  priceMsg,
  ix: instruction(
    'refreshMarkets',
    { priceMsg },
    { config: configPda(), pool: poolPda(), pythStorage, instructions: INSTRUCTIONS_SYSVAR_ID },
    marketMetas(markets),
  ),
});

// LP vault (every listed market must be passed, in index order)

function lpKeys(signer: PublicKey, owner: PublicKey, pythStorage: PublicKey) {
  return { signer, config: configPda(), pool: poolPda(), account: accountPda(owner), pythStorage, instructions: INSTRUCTIONS_SYSVAR_ID };
}

export const lpDeposit = (signer: PublicKey, owner: PublicKey, numMarkets: number, priceMsg: Uint8Array, amount: bigint, pythStorage = PYTH_PRO_STORAGE_DEVNET): PricedIx => ({
  priceMsg,
  ix: instruction('lpDeposit', { priceMsg, amount }, lpKeys(signer, owner, pythStorage), marketMetas([...Array(numMarkets).keys()])),
});

export const lpWithdraw = (signer: PublicKey, owner: PublicKey, numMarkets: number, priceMsg: Uint8Array, shares: bigint, pythStorage = PYTH_PRO_STORAGE_DEVNET): PricedIx => ({
  priceMsg,
  ix: instruction('lpWithdraw', { priceMsg, shares }, lpKeys(signer, owner, pythStorage), marketMetas([...Array(numMarkets).keys()])),
});

// Admin (used by scripts)

export const initialize = (admin: PublicKey, usdcMint: PublicKey, params: Record<string, unknown>) =>
  instruction(
    'initialize',
    { params },
    {
      admin,
      config: configPda(),
      pool: poolPda(),
      usdcMint,
      custody: custodyPda(),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SYSTEM_PROGRAM_ID,
    },
  );

export const updateConfig = (admin: PublicKey, params: Record<string, unknown>) =>
  instruction('updateConfig', { params }, { admin, config: configPda(), pool: poolPda() });

export function symbolBytes(symbol: string): number[] {
  const b = new TextEncoder().encode(symbol);
  if (b.length > 16) throw new Error(`symbol too long: ${symbol}`);
  return [...b, ...new Array(16 - b.length).fill(0)];
}

export const addMarket = (admin: PublicKey, index: number, feedId: number, expo: number, symbol: string, params: Record<string, unknown>) =>
  instruction(
    'addMarket',
    { index, feedId, expo, symbol: symbolBytes(symbol), params },
    { admin, config: configPda(), pool: poolPda(), market: marketPda(index), systemProgram: SYSTEM_PROGRAM_ID },
  );

export const updateMarket = (admin: PublicKey, index: number, params: Record<string, unknown>) =>
  instruction('updateMarket', { index, params }, { admin, config: configPda(), market: marketPda(index) });

export const setMarketStatus = (admin: PublicKey, index: number, status: number) =>
  instruction('setMarketStatus', { index, status }, { admin, config: configPda(), market: marketPda(index) });

export { TriggerTarget };
