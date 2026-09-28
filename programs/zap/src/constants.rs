use anchor_lang::prelude::*;

pub const CONFIG_SEED: &[u8] = b"config";
pub const POOL_SEED: &[u8] = b"pool";
pub const CUSTODY_SEED: &[u8] = b"custody";
pub const MARKET_SEED: &[u8] = b"market";
pub const ACCOUNT_SEED: &[u8] = b"account";

/// Position and order slots held inline in each trading account.
pub const MAX_POSITIONS: usize = 16;
pub const MAX_ORDERS: usize = 24;
/// Upper bound on listed markets (LP deposits and withdrawals must price every market in one transaction).
pub const MAX_MARKETS: u16 = 32;
/// Upper bound on feeds read from one signed price message.
pub const MAX_FEEDS_PER_MESSAGE: usize = 32;

pub const ACCOUNT_VERSION: u8 = 1;

/// Pyth Pro (formerly Lazer) verifier program; its storage account lists the trusted price signers.
pub const PYTH_PRO_PROGRAM_ID: Pubkey = pubkey!("pytd2yyk641x7ak7mkaasSJVXh6YYZnC7wTmtgAyxPt");
/// Anchor discriminator of Pyth Pro's `Storage` account (sha256("account:Storage")[..8]).
pub const PYTH_STORAGE_DISCRIMINATOR: [u8; 8] = [0xd1, 0x75, 0xff, 0xb9, 0xc4, 0xaf, 0x44, 0x09];

/// Market status values.
pub mod market_status {
    pub const ACTIVE: u8 = 0;
    /// Only closes, liquidations and reduce-only orders.
    pub const REDUCE_ONLY: u8 = 1;
    pub const PAUSED: u8 = 2;
}

pub mod side {
    pub const LONG: u8 = 0;
    pub const SHORT: u8 = 1;
}

pub mod order_kind {
    /// Opens (or adds to) a position once the price is at or better than the trigger.
    pub const LIMIT: u8 = 1;
    /// Opens (or adds to) a position once the price breaks through the trigger.
    pub const STOP: u8 = 2;
    /// Reduces a position once the price reaches the take-profit trigger.
    pub const TAKE_PROFIT: u8 = 3;
    /// Reduces a position once the price reaches the stop-loss trigger.
    pub const STOP_LOSS: u8 = 4;
}

pub mod order_flags {
    pub const REDUCE_ONLY: u8 = 1 << 0;
    pub const POST_ONLY: u8 = 1 << 1;
}

/// Slot status for inline positions and orders.
pub mod slot_status {
    pub const EMPTY: u8 = 0;
    pub const OPEN: u8 = 1;
}
