use anchor_lang::prelude::*;

use super::pod::{PodI128, PodU128};
use crate::error::ZapError;

/// Risk and fee parameters of a market. Changeable by the admin without touching open positions' entries.
/// Stored inside the zero-copy `Market` and also passed as an instruction argument, hence both Pod and Borsh.
#[repr(C)]
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq, bytemuck::Pod, bytemuck::Zeroable,
)]
pub struct MarketParams {
    pub max_leverage: u16,
    pub mmr_bps: u16,
    pub open_fee_bps: u16,
    pub close_fee_bps: u16,
    /// Half-spread from the Pyth confidence interval, as a multiple (1e4 = 1.0×).
    pub conf_mult_bps: u16,
    /// New risk is refused while confidence / price exceeds this.
    pub max_conf_bps: u16,
    pub impact_cap_bps: u16,
    /// Open interest caps per side, as a share of vault assets.
    pub oi_cap_long_bps: u16,
    pub oi_cap_short_bps: u16,
    pub _pad: [u8; 6],
    /// Minimum half-spread (1e12 = 100%, so 1bp = 1e8).
    pub min_spread_frac: u64,
    /// Price-impact depth in USD (6 decimals): larger means less impact.
    pub impact_depth_usd: u64,
    /// Largest single position (USD, 6 decimals).
    pub max_position_usd: u64,
}

impl MarketParams {
    pub fn validate(&self) -> Result<()> {
        let lev = self.max_leverage as u32;
        let ok = lev >= 1
            && lev <= 1_000
            && self.mmr_bps > 0
            // initial margin at max leverage must exceed maintenance plus both fees
            && 10_000 / lev > (self.mmr_bps + self.open_fee_bps + self.close_fee_bps) as u32
            && self.open_fee_bps <= 100
            && self.close_fee_bps <= 100
            && self.conf_mult_bps <= 50_000
            && self.max_conf_bps > 0
            && self.impact_cap_bps <= 500
            && self.oi_cap_long_bps <= 10_000
            && self.oi_cap_short_bps <= 10_000
            && self.min_spread_frac < 100_000_000_000 // < 10%
            && self.impact_depth_usd > 0
            && self.max_position_usd > 0;
        require!(ok, ZapError::InvalidParams);
        Ok(())
    }
}

/// One perpetual market: parameters, per-side open interest aggregates, funding indices and the price watermark.
#[account(zero_copy)]
pub struct Market {
    pub index: u16,
    pub status: u8,
    pub bump: u8,
    /// Pyth Pro feed id.
    pub feed_id: u32,
    /// Pyth exponent of the feed; fixed at listing.
    pub expo: i16,
    pub _pad0: [u8; 6],
    pub symbol: [u8; 16],
    pub params: MarketParams,

    /// Σ size (entry notional, USD 6 decimals) per side.
    pub oi_long: u64,
    pub oi_short: u64,
    /// Σ units (12 decimals) per side: gives the traders' aggregate PnL in O(1).
    pub units_long: PodU128,
    pub units_short: PodU128,
    /// Cumulative funding owed per unit of size (1e18 = 100%); long grows and short shrinks when longs pay.
    pub funding_index_long: PodI128,
    pub funding_index_short: PodI128,
    /// Σ size · funding index at each position's last settlement, per side (unscaled).
    pub sum_sf_long: PodI128,
    pub sum_sf_short: PodI128,
    /// Current funding rate per second (1e18 = 100%), recomputed after every open-interest change.
    pub funding_rate: PodI128,
    pub last_accrual_ts: i64,

    /// Latest accepted oracle price (12 decimals) and confidence, and its publish time: the watermark new prices
    /// must not fall behind (minus the configured grace).
    pub last_price: u64,
    pub last_conf: u64,
    pub last_price_ts_us: u64,
    pub trade_seq: u64,

    pub cum_volume: u64,
    pub cum_fees: u64,
    pub cum_funding_net: i64,
    pub _reserved: [u8; 128],
}

impl Market {
    pub const SIZE: usize = 8 + core::mem::size_of::<Market>();

    pub fn symbol_str(&self) -> &str {
        let end = self.symbol.iter().position(|&b| b == 0).unwrap_or(self.symbol.len());
        core::str::from_utf8(&self.symbol[..end]).unwrap_or("")
    }
}
