//! Oracle: every price-dependent instruction carries its own Pyth Pro signed price message, verified in the same
//! transaction by the ed25519 precompile. Freshness rules stop callers from picking an older, more favorable price:
//! - the message must be at most `max_price_age_s` old and not from the future;
//! - each feed must have updated within `max_feed_age_s` (Pyth can carry prices forward);
//! - a market's price may lag the latest price used on that market by at most `price_grace_ms` (the watermark), so
//!   concurrent traders using the same fresh price never conflict, but stale prices are refused.

pub mod ed25519;
pub mod pyth_pro;
pub mod trust;

use anchor_lang::prelude::*;
use zap_math::price::{normalize_conf, normalize_price};

use crate::constants::MAX_FEEDS_PER_MESSAGE;
use crate::error::{MathResultExt, ZapError};
use crate::state::{ConfigParams, Market};
use pyth_pro::{Feed, ParseError};

const MICROS: u64 = 1_000_000;

impl From<ParseError> for ZapError {
    fn from(e: ParseError) -> Self {
        match e {
            ParseError::BadMagic => ZapError::BadMagic,
            ParseError::Malformed => ZapError::MalformedPriceMessage,
            ParseError::UnknownProperty => ZapError::UnknownProperty,
        }
    }
}

/// A verified, fresh price message.
pub struct VerifiedPrices {
    pub timestamp_us: u64,
    pub now_us: u64,
    pub feeds: Vec<Feed>,
}

/// A market's price from a verified message (12-decimal price and confidence).
#[derive(Clone, Copy, Debug)]
pub struct MarketPrice {
    pub price: u64,
    pub conf: u64,
    pub ts_us: u64,
}

pub fn verify(
    instructions: &AccountInfo,
    pyth_storage: &AccountInfo,
    params: &ConfigParams,
    price_msg: &[u8],
    now: i64,
) -> Result<VerifiedPrices> {
    ed25519::verify_signed_message(instructions, price_msg)?;
    let env = pyth_pro::parse_envelope(price_msg).map_err(ZapError::from)?;
    trust::check_signer(params, pyth_storage, &env.signer, now)?;
    let payload = pyth_pro::parse_payload(env.payload, MAX_FEEDS_PER_MESSAGE).map_err(ZapError::from)?;
    require!(payload.channel == params.required_channel, ZapError::ChannelMismatch);

    let now_us = u64::try_from(now).map_err(|_| error!(ZapError::MathOverflow))? * MICROS;
    require!(
        payload.timestamp_us <= now_us + u64::from(params.max_future_s) * MICROS,
        ZapError::PriceFromFuture
    );
    require!(
        now_us.saturating_sub(payload.timestamp_us) <= u64::from(params.max_price_age_s) * MICROS,
        ZapError::PriceStale
    );
    Ok(VerifiedPrices { timestamp_us: payload.timestamp_us, now_us, feeds: payload.feeds })
}

impl VerifiedPrices {
    pub fn for_market(&self, market: &Market, params: &ConfigParams) -> Result<MarketPrice> {
        let f = self.feeds.iter().find(|f| f.feed_id == market.feed_id).ok_or(error!(ZapError::FeedMissing))?;
        require!(f.price > 0, ZapError::PriceMissing);
        require!(f.exponent == Some(market.expo), ZapError::ExponentMismatch);
        let feed_ts = f.feed_update_ts_us.ok_or(error!(ZapError::FeedStale))?;
        require!(
            self.now_us.saturating_sub(feed_ts) <= u64::from(params.max_feed_age_s) * MICROS,
            ZapError::FeedStale
        );
        let expo = i32::from(market.expo);
        let price = normalize_price(f.price, expo).m()?;
        let conf = if f.confidence > 0 { normalize_conf(f.confidence as u64, expo).m()? } else { 0 };
        Ok(MarketPrice { price, conf, ts_us: self.timestamp_us })
    }
}

/// Watermark: refuse prices older than the market's latest used price minus the grace; move the watermark forward.
pub fn apply_watermark(market: &mut Market, p: &MarketPrice, grace_ms: u32) -> Result<()> {
    let floor = market.last_price_ts_us.saturating_sub(u64::from(grace_ms) * 1_000);
    require!(p.ts_us >= floor, ZapError::BelowWatermark);
    if p.ts_us >= market.last_price_ts_us {
        market.last_price_ts_us = p.ts_us;
        market.last_price = p.price;
        market.last_conf = p.conf;
    }
    Ok(())
}
