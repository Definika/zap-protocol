use anchor_lang::prelude::*;

use crate::error::ZapError;

/// Protocol-wide settings. Changed only by the admin.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub custody: Pubkey,
    pub bump: u8,
    pub pool_bump: u8,
    pub custody_bump: u8,
    pub params: ConfigParams,
    pub _reserved: [u8; 128],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, InitSpace)]
pub struct ConfigParams {
    /// Pyth Pro storage account listing trusted signers (used when `use_pyth_storage`).
    pub pyth_storage: Pubkey,
    /// Additional trusted price signers with their expiry (unix seconds); unused slots are the default key.
    pub oracle_signers: [Pubkey; 2],
    pub oracle_signer_expiry: [i64; 2],
    pub use_pyth_storage: bool,
    /// Accepted Pyth Pro channel (3 = fixed rate 200ms).
    pub required_channel: u8,
    /// Oldest accepted message timestamp, seconds.
    pub max_price_age_s: u32,
    /// Furthest accepted message timestamp ahead of the cluster clock, seconds.
    pub max_future_s: u32,
    /// Oldest accepted feed update (guards against carried-forward prices), seconds.
    pub max_feed_age_s: u32,
    /// How far behind a market's latest used price a new price may be, milliseconds.
    pub price_grace_ms: u32,
    pub min_order_usd: u64,
    /// Reserved liquidity / vault assets cap for new risk.
    pub max_util_bps: u16,
    pub liq_fee_bps: u16,
    pub liquidator_share_bps: u16,
    /// Share of trading and borrow fees kept by the protocol; the rest goes to LPs.
    pub protocol_fee_share_bps: u16,
    pub borrow_kink_util_bps: u16,
    pub borrow_kink_apr_bps: u16,
    pub borrow_max_apr_bps: u16,
    /// Funding rate at full imbalance, per hour (1e18 = 100%).
    pub funding_max_hourly: u64,
    pub session_max_secs: u32,
    pub lp_fee_bps: u16,
    pub lp_cooldown_s: u32,
    /// Blocks new risk (opens, order placement) only; closes, liquidations and withdrawals always work.
    pub paused: bool,
    pub lp_paused: bool,
}

impl ConfigParams {
    pub fn validate(&self) -> Result<()> {
        let ok = self.max_price_age_s > 0
            && self.max_price_age_s <= 120
            && self.max_future_s <= 60
            && self.max_feed_age_s > 0
            && self.max_util_bps > 0
            && self.max_util_bps <= 10_000
            && self.liq_fee_bps <= 500
            && self.liquidator_share_bps <= 10_000
            && self.protocol_fee_share_bps <= 10_000
            && self.borrow_kink_util_bps > 0
            && self.borrow_kink_util_bps < 10_000
            && self.borrow_kink_apr_bps <= self.borrow_max_apr_bps
            && self.funding_max_hourly <= 10_000_000_000_000_000 // 1%/h
            && self.session_max_secs > 0
            && self.lp_fee_bps <= 100
            && self.min_order_usd > 0;
        require!(ok, ZapError::InvalidParams);
        Ok(())
    }
}
