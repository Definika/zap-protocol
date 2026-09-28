use anchor_lang::prelude::*;

use crate::state::{ConfigParams, MarketParams};

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub params: ConfigParams,
}

#[event]
pub struct MarketListed {
    pub index: u16,
    pub feed_id: u32,
    pub expo: i16,
    pub symbol: [u8; 16],
    pub params: MarketParams,
}

#[event]
pub struct MarketUpdated {
    pub index: u16,
    pub status: u8,
    pub params: MarketParams,
}

#[event]
pub struct AccountCreated {
    pub owner: Pubkey,
    pub account: Pubkey,
    pub session_key: Pubkey,
    pub session_expires_at: i64,
}

#[event]
pub struct SessionChanged {
    pub owner: Pubkey,
    pub session_key: Pubkey,
    pub session_expires_at: i64,
}

#[event]
pub struct Deposited {
    pub owner: Pubkey,
    pub amount: u64,
    pub balance: u64,
    pub account_seq: u64,
}

#[event]
pub struct Withdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub balance: u64,
    pub account_seq: u64,
}

#[event]
pub struct AccountClosed {
    pub owner: Pubkey,
}

#[event]
pub struct MarketRefreshed {
    pub index: u16,
    pub price: u64,
    pub price_ts_us: u64,
    pub funding_rate: i128,
    pub funding_index_long: i128,
    pub funding_index_short: i128,
    pub borrow_index: u128,
    pub pool_seq: u64,
}

/// Trade kinds in `Trade.kind`.
pub mod trade_kind {
    pub const OPEN: u8 = 0;
    pub const CLOSE: u8 = 1;
    pub const LIQUIDATION: u8 = 2;
    pub const TAKE_PROFIT: u8 = 3;
    pub const STOP_LOSS: u8 = 4;
    pub const LIMIT_FILL: u8 = 5;
    pub const STOP_FILL: u8 = 6;
}

/// Every fill. USD amounts have 6 decimals; prices 12.
#[event]
pub struct Trade {
    pub pool_seq: u64,
    pub ts: i64,
    pub account: Pubkey,
    pub owner: Pubkey,
    pub market: u16,
    pub side: u8,
    pub kind: u8,
    pub position_id: u64,
    pub order_id: u64,
    /// Entry notional opened (positive) or closed (negative).
    pub size_delta: i64,
    pub size_after: u64,
    pub collateral_after: u64,
    pub oracle_price: u64,
    pub fill_price: u64,
    pub price_ts_us: u64,
    pub open_fee: u64,
    pub close_fee: u64,
    pub spread_cost: u64,
    pub impact_cost: u64,
    pub borrow_paid: u64,
    /// Positive: paid by the trader; negative: received.
    pub funding_paid: i64,
    pub pnl: i64,
    /// Credited to the trader's balance.
    pub payout: u64,
    pub oi_long_after: u64,
    pub oi_short_after: u64,
}

#[event]
pub struct CollateralChanged {
    pub account: Pubkey,
    pub market: u16,
    pub side: u8,
    pub position_id: u64,
    /// Positive: added from the balance; negative: removed to the balance.
    pub delta: i64,
    pub collateral_after: u64,
}

#[event]
pub struct TpslChanged {
    pub account: Pubkey,
    pub market: u16,
    pub side: u8,
    pub position_id: u64,
    pub tp_price: u64,
    pub sl_price: u64,
}
