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
