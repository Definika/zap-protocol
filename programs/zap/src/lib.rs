//! ZAP Protocol: oracle-priced perpetual futures on Solana.
//!
//! A single USDC vault is the counterparty to every trade. Fills happen at Pyth Pro signed prices carried in the same
//! transaction. See `crates/zap-math` for the pricing, fee, funding and liquidation math.

pub mod constants;
pub mod logic;
pub mod error;
pub mod events;
pub mod instructions;
pub mod oracle;
pub mod state;

use anchor_lang::prelude::*;

use instructions::*;
use state::{ConfigParams, MarketParams};

declare_id!("H7YEstzQnFYuAkSXgPLe1YrL5WoUvgvo4cyndrQsgcwi");

#[program]
pub mod zap {
    use super::*;

    // Admin

    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        instructions::admin::initialize(ctx, params)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
        instructions::admin::update_config(ctx, params)
    }

    pub fn add_market(
        ctx: Context<AddMarket>,
        index: u16,
        feed_id: u32,
        expo: i16,
        symbol: [u8; 16],
        params: MarketParams,
    ) -> Result<()> {
        instructions::admin::add_market(ctx, index, feed_id, expo, symbol, params)
    }

    pub fn update_market(ctx: Context<UpdateMarket>, index: u16, params: MarketParams) -> Result<()> {
        instructions::admin::update_market(ctx, index, params)
    }

    pub fn set_market_status(ctx: Context<UpdateMarket>, index: u16, status: u8) -> Result<()> {
        instructions::admin::set_market_status(ctx, index, status)
    }

    // Trading accounts

    pub fn create_account(ctx: Context<CreateAccount>, session_key: Pubkey, session_expires_at: i64) -> Result<()> {
        instructions::account::create_account(ctx, session_key, session_expires_at)
    }

    pub fn set_session(ctx: Context<SetSession>, session_key: Pubkey, session_expires_at: i64) -> Result<()> {
        instructions::account::set_session(ctx, session_key, session_expires_at)
    }

    pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
        instructions::account::revoke_session(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::account::deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::account::withdraw(ctx, amount)
    }

    pub fn close_account(ctx: Context<CloseAccount>) -> Result<()> {
        instructions::account::close_account(ctx)
    }

    // Trading. `price_msg` must stay the first argument: the ed25519 check expects it at a fixed offset.

    #[allow(clippy::too_many_arguments)]
    pub fn open_position(
        ctx: Context<TradeWithPrice>,
        price_msg: Vec<u8>,
        side: u8,
        size: u64,
        collateral: u64,
        acceptable_price: u64,
        tp_price: u64,
        sl_price: u64,
    ) -> Result<()> {
        instructions::trade::open_position(ctx, price_msg, side, size, collateral, acceptable_price, tp_price, sl_price)
    }

    pub fn close_position(
        ctx: Context<TradeWithPrice>,
        price_msg: Vec<u8>,
        side: u8,
        position_id: u64,
        size: u64,
        acceptable_price: u64,
    ) -> Result<()> {
        instructions::trade::close_position(ctx, price_msg, side, position_id, size, acceptable_price)
    }

    pub fn add_collateral(ctx: Context<TradeNoPrice>, side: u8, position_id: u64, amount: u64) -> Result<()> {
        instructions::trade::add_collateral(ctx, side, position_id, amount)
    }

    pub fn remove_collateral(
        ctx: Context<TradeWithPrice>,
        price_msg: Vec<u8>,
        side: u8,
        position_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::trade::remove_collateral(ctx, price_msg, side, position_id, amount)
    }

    pub fn set_tpsl(ctx: Context<TradeNoPrice>, side: u8, position_id: u64, tp_price: u64, sl_price: u64) -> Result<()> {
        instructions::trade::set_tpsl(ctx, side, position_id, tp_price, sl_price)
    }

    // LP vault (deposits come from, and withdrawals go to, the trading balance)

    pub fn lp_deposit<'info>(ctx: Context<'info, Lp<'info>>, price_msg: Vec<u8>, amount: u64) -> Result<()> {
        instructions::lp::lp_deposit(ctx, price_msg, amount)
    }

    pub fn lp_withdraw<'info>(ctx: Context<'info, Lp<'info>>, price_msg: Vec<u8>, shares: u64) -> Result<()> {
        instructions::lp::lp_withdraw(ctx, price_msg, shares)
    }

    // Keeper

    /// `price_msg` must stay the first argument: the ed25519 check expects it at a fixed offset.
    pub fn refresh_markets<'info>(ctx: Context<'info, RefreshMarkets<'info>>, price_msg: Vec<u8>) -> Result<()> {
        instructions::keeper::refresh_markets(ctx, price_msg)
    }
}
