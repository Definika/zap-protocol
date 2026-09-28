use anchor_lang::prelude::*;

use super::pod::PodU128;

/// The LP vault: realized assets, reserved liquidity, LP share supply, and the pool-wide borrow index.
/// Also the authority of the custody token account that holds all USDC.
#[account(zero_copy)]
pub struct Pool {
    /// LP-owned USDC after realized trader PnL and fees (6 decimals).
    pub assets: u64,
    /// Σ open position sizes: each position reserves its maximum payout.
    pub reserved: u64,
    pub lp_supply: u64,
    /// Protocol's share of fees, withdrawable by the admin.
    pub protocol_fees: u64,
    /// Cumulative borrow index (1e18 = 100%).
    pub borrow_index: PodU128,
    /// Σ size · borrow index at each position's last settlement (unscaled).
    pub sum_size_borrow_entry: PodU128,
    pub borrow_last_ts: i64,
    /// Increments on every event, so indexers can detect gaps.
    pub seq: u64,
    pub num_markets: u16,
    pub bump: u8,
    pub _pad: [u8; 5],
    // Lifetime stats (USD, 6 decimals) for the vault earnings breakdown.
    pub cum_trading_fees: u64,
    pub cum_borrow_fees: u64,
    pub cum_liquidation_fees: u64,
    pub cum_spread_impact: u64,
    pub cum_funding_net: i64,
    pub cum_trader_pnl: i64,
    pub cum_volume: u64,
    pub _reserved: [u8; 128],
}

impl Pool {
    pub const SIZE: usize = 8 + core::mem::size_of::<Pool>();

    pub fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }
}
