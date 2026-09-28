import { PublicKey } from '@solana/web3.js';
import rawIdl from './idl/zap.json';

export const PROGRAM_ID = new PublicKey(rawIdl.address);

export const SEEDS = {
  config: 'config',
  pool: 'pool',
  custody: 'custody',
  market: 'market',
  account: 'account',
} as const;

/** Pyth Pro (formerly Lazer) verifier program and the devnet storage account that lists trusted signers. */
export const PYTH_PRO_PROGRAM_ID = new PublicKey('pytd2yyk641x7ak7mkaasSJVXh6YYZnC7wTmtgAyxPt');
export const PYTH_PRO_STORAGE_DEVNET = new PublicKey('3rdJbqfnagQ4yx9HXJViD4zc4xpiSqmFsKpPuSCQVyQL');

export const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');
export const INSTRUCTIONS_SYSVAR_ID = new PublicKey('Sysvar1nstructions1111111111111111111111111');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

/** Where the signed price message starts in a price-carrying instruction: discriminator (8) + Vec length (4). */
export const PRICE_MESSAGE_OFFSET = 12;

export const MAX_POSITIONS = 16;
export const MAX_ORDERS = 24;
/** Bytes before the account struct in every Anchor account. */
export const DISCRIMINATOR_LEN = 8;

export const Side = { Long: 0, Short: 1 } as const;
export type SideValue = (typeof Side)[keyof typeof Side];

export const OrderKind = { Limit: 1, Stop: 2, TakeProfit: 3, StopLoss: 4 } as const;
export const OrderFlags = { ReduceOnly: 1, PostOnly: 2 } as const;
export const MarketStatus = { Active: 0, ReduceOnly: 1, Paused: 2 } as const;
export const SlotStatus = { Empty: 0, Open: 1 } as const;
export const TradeKind = {
  Open: 0,
  Close: 1,
  Liquidation: 2,
  TakeProfit: 3,
  StopLoss: 4,
  LimitFill: 5,
  StopFill: 6,
} as const;
export const TriggerTarget = { Order: 0, PositionTp: 1, PositionSl: 2 } as const;

/** Pyth Pro channel ids. ZAP accepts the 200ms fixed-rate channel. */
export const PythChannel = { RealTime: 1, FixedRate50: 2, FixedRate200: 3, FixedRate1000: 4 } as const;
