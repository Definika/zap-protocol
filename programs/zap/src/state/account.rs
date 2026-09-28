use anchor_lang::prelude::*;

use super::pod::{PodI128, PodU128};
use crate::constants::{slot_status, MAX_ORDERS, MAX_POSITIONS};
use crate::error::ZapError;

/// A trader's account: USDC balance, LP shares, session key, and inline position and order slots.
/// One account per owner wallet. Rent is paid by the relayer and refunded to it when the account closes.
#[account(zero_copy)]
pub struct TradingAccount {
    pub owner: Pubkey,
    /// Signs trades without the owner (no wallet pop-ups). Cannot withdraw or change the session.
    pub session_key: Pubkey,
    pub rent_payer: Pubkey,
    pub session_expires_at: i64,
    /// Free USDC (6 decimals), not backing any position or order.
    pub balance: u64,
    pub lp_shares: u64,
    /// USDC paid for the LP shares still held, for LP PnL.
    pub lp_cost_basis: u64,
    pub lp_last_deposit_ts: i64,
    pub next_position_id: u64,
    pub next_order_id: u64,
    pub seq: u64,
    pub created_at: i64,
    // Lifetime stats (USD, 6 decimals)
    pub realized_pnl: i64,
    pub fees_paid: u64,
    pub funding_paid: i64,
    pub borrow_paid: u64,
    pub volume: u64,
    pub deposited: u64,
    pub withdrawn: u64,
    pub bump: u8,
    pub version: u8,
    pub _pad: [u8; 6],
    pub _reserved: [u8; 64],
    pub positions: [Position; MAX_POSITIONS],
    pub orders: [Order; MAX_ORDERS],
}

/// An open position (isolated margin). Hedge mode: a market can hold one long and one short at the same time.
#[zero_copy]
#[derive(Default, Debug)]
pub struct Position {
    pub position_id: u64,
    /// Entry notional (USD, 6 decimals).
    pub size_usd: u64,
    pub collateral: u64,
    /// Base-asset units (12 decimals).
    pub units: PodU128,
    /// Indices at the last settlement; accrued funding and borrow are settled into collateral on every change.
    pub entry_funding_index: PodI128,
    pub entry_borrow_index: PodU128,
    /// Publish time of the last price used; later prices for this position may not be older.
    pub last_price_ts_us: u64,
    pub opened_at: i64,
    pub updated_at: i64,
    /// Take-profit and stop-loss trigger prices (12 decimals), 0 when unset.
    pub tp_price: u64,
    pub sl_price: u64,
    pub realized_pnl: i64,
    pub fees_paid: u64,
    pub market_index: u16,
    pub side: u8,
    pub status: u8,
    pub _pad: [u8; 4],
}

/// A resting order: opening limit/stop orders escrow their margin and fee; take-profit and stop-loss orders reduce a
/// position (possibly partially, which gives multi-level take-profits).
#[zero_copy]
#[derive(Default, Debug)]
pub struct Order {
    pub order_id: u64,
    /// Position this order reduces (0 for opening orders).
    pub position_id: u64,
    /// Size to open or close (USD entry notional); u64::MAX closes the whole position.
    pub size_usd: u64,
    pub collateral_escrow: u64,
    pub fee_escrow: u64,
    pub trigger_price: u64,
    /// Worst acceptable fill price (0 = none).
    pub acceptable_price: u64,
    /// Unix seconds; the executing price must be published after this.
    pub created_at: i64,
    /// Take-profit / stop-loss to attach to the position when an opening order fills (0 = none).
    pub tp_price: u64,
    pub sl_price: u64,
    pub market_index: u16,
    pub kind: u8,
    pub side: u8,
    pub flags: u8,
    pub status: u8,
    pub _pad: [u8; 2],
}

impl TradingAccount {
    pub const SIZE: usize = 8 + core::mem::size_of::<TradingAccount>();

    /// The owner can always sign; the session key only until it expires, and never for owner-only actions.
    pub fn authorize(&self, signer: &Pubkey, now: i64, allow_session: bool) -> Result<()> {
        if *signer == self.owner {
            return Ok(());
        }
        if allow_session && *signer == self.session_key && self.session_key != Pubkey::default() {
            require!(now < self.session_expires_at, ZapError::SessionExpired);
            return Ok(());
        }
        err!(ZapError::Unauthorized)
    }

    pub fn find_position(&self, market_index: u16, side: u8) -> Option<usize> {
        self.positions
            .iter()
            .position(|p| p.status == slot_status::OPEN && p.market_index == market_index && p.side == side)
    }

    pub fn free_position_slot(&self) -> Result<usize> {
        self.positions.iter().position(|p| p.status == slot_status::EMPTY).ok_or(error!(ZapError::SlotsFull))
    }

    pub fn find_order(&self, order_id: u64) -> Option<usize> {
        self.orders.iter().position(|o| o.status == slot_status::OPEN && o.order_id == order_id)
    }

    pub fn free_order_slot(&self) -> Result<usize> {
        self.orders.iter().position(|o| o.status == slot_status::EMPTY).ok_or(error!(ZapError::SlotsFull))
    }

    pub fn is_empty(&self) -> bool {
        self.balance == 0
            && self.lp_shares == 0
            && self.positions.iter().all(|p| p.status == slot_status::EMPTY)
            && self.orders.iter().all(|o| o.status == slot_status::EMPTY)
    }
}
