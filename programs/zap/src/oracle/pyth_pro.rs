//! Parser for Pyth Pro (formerly Lazer) signed price messages in the Solana format.
//!
//! Envelope: `u32 magic | signature[64] | public_key[32] | u16 payload_len | payload` (little-endian); the signature
//! covers the payload only.
//! Payload: `u32 magic | u64 timestamp_us | u8 channel | u8 n_feeds | n × (u32 feed_id | u8 n_props | props…)`.
//! Property encodings follow `pyth-lazer-protocol` 0.46: prices are i64 with 0 meaning "none"; timestamps, funding
//! rate and interval carry a one-byte presence flag. Unknown properties are rejected, since their size is unknown.

pub const SOLANA_FORMAT_MAGIC: u32 = 2_182_742_457;
pub const PAYLOAD_FORMAT_MAGIC: u32 = 2_479_346_549;
/// magic + signature + public key + payload length.
pub const ENVELOPE_HEADER_LEN: usize = 4 + 64 + 32 + 2;

pub mod property {
    pub const PRICE: u8 = 0;
    pub const BEST_BID_PRICE: u8 = 1;
    pub const BEST_ASK_PRICE: u8 = 2;
    pub const PUBLISHER_COUNT: u8 = 3;
    pub const EXPONENT: u8 = 4;
    pub const CONFIDENCE: u8 = 5;
    pub const FUNDING_RATE: u8 = 6;
    pub const FUNDING_TIMESTAMP: u8 = 7;
    pub const FUNDING_RATE_INTERVAL: u8 = 8;
    pub const MARKET_SESSION: u8 = 9;
    pub const EMA_PRICE: u8 = 10;
    pub const EMA_CONFIDENCE: u8 = 11;
    pub const FEED_UPDATE_TIMESTAMP: u8 = 12;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseError {
    BadMagic,
    Malformed,
    UnknownProperty,
}

#[derive(Clone, Copy, Debug)]
pub struct Envelope<'a> {
    pub signature: &'a [u8],
    pub signer: [u8; 32],
    pub payload: &'a [u8],
}

/// Splits a signed message into signature, signer and payload. The message must be exactly envelope + payload.
pub fn parse_envelope(msg: &[u8]) -> Result<Envelope<'_>, ParseError> {
    if msg.len() < ENVELOPE_HEADER_LEN {
        return Err(ParseError::Malformed);
    }
    if u32::from_le_bytes([msg[0], msg[1], msg[2], msg[3]]) != SOLANA_FORMAT_MAGIC {
        return Err(ParseError::BadMagic);
    }
    let len = u16::from_le_bytes([msg[100], msg[101]]) as usize;
    if msg.len() != ENVELOPE_HEADER_LEN + len {
        return Err(ParseError::Malformed);
    }
    let mut signer = [0u8; 32];
    signer.copy_from_slice(&msg[68..100]);
    Ok(Envelope { signature: &msg[4..68], signer, payload: &msg[ENVELOPE_HEADER_LEN..] })
}

/// The properties ZAP uses from one feed. Prices and confidence are raw mantissas in the feed exponent (0 = none).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Feed {
    pub feed_id: u32,
    pub price: i64,
    pub best_bid: i64,
    pub best_ask: i64,
    pub confidence: i64,
    pub exponent: Option<i16>,
    pub publisher_count: Option<u16>,
    pub feed_update_ts_us: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Payload {
    pub timestamp_us: u64,
    pub channel: u8,
    pub feeds: Vec<Feed>,
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], ParseError> {
        let end = self.i.checked_add(N).ok_or(ParseError::Malformed)?;
        let s = self.b.get(self.i..end).ok_or(ParseError::Malformed)?;
        self.i = end;
        let mut out = [0u8; N];
        out.copy_from_slice(s);
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8, ParseError> {
        Ok(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, ParseError> {
        Ok(u16::from_le_bytes(self.take()?))
    }
    fn i16(&mut self) -> Result<i16, ParseError> {
        Ok(i16::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, ParseError> {
        Ok(u32::from_le_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64, ParseError> {
        Ok(u64::from_le_bytes(self.take()?))
    }
    fn i64(&mut self) -> Result<i64, ParseError> {
        Ok(i64::from_le_bytes(self.take()?))
    }
    /// Presence flag followed by a u64 when present.
    fn opt_u64(&mut self) -> Result<Option<u64>, ParseError> {
        Ok(if self.u8()? != 0 { Some(self.u64()?) } else { None })
    }
}

/// Parses a payload, rejecting unknown properties and trailing bytes.
pub fn parse_payload(payload: &[u8], max_feeds: usize) -> Result<Payload, ParseError> {
    let mut r = Reader { b: payload, i: 0 };
    if r.u32()? != PAYLOAD_FORMAT_MAGIC {
        return Err(ParseError::BadMagic);
    }
    let timestamp_us = r.u64()?;
    let channel = r.u8()?;
    let n_feeds = r.u8()? as usize;
    if n_feeds > max_feeds {
        return Err(ParseError::Malformed);
    }
    let mut feeds = Vec::with_capacity(n_feeds);
    for _ in 0..n_feeds {
        let mut f = Feed { feed_id: r.u32()?, ..Feed::default() };
        let n_props = r.u8()?;
        for _ in 0..n_props {
            match r.u8()? {
                property::PRICE => f.price = r.i64()?,
                property::BEST_BID_PRICE => f.best_bid = r.i64()?,
                property::BEST_ASK_PRICE => f.best_ask = r.i64()?,
                property::PUBLISHER_COUNT => f.publisher_count = Some(r.u16()?),
                property::EXPONENT => f.exponent = Some(r.i16()?),
                property::CONFIDENCE => f.confidence = r.i64()?,
                property::FUNDING_RATE => {
                    if r.u8()? != 0 {
                        r.i64()?;
                    }
                }
                property::FUNDING_TIMESTAMP | property::FUNDING_RATE_INTERVAL => {
                    r.opt_u64()?;
                }
                property::MARKET_SESSION => {
                    r.i16()?;
                }
                property::EMA_PRICE | property::EMA_CONFIDENCE => {
                    r.i64()?;
                }
                property::FEED_UPDATE_TIMESTAMP => f.feed_update_ts_us = r.opt_u64()?,
                _ => return Err(ParseError::UnknownProperty),
            }
        }
        feeds.push(f);
    }
    if r.i != payload.len() {
        return Err(ParseError::Malformed);
    }
    Ok(Payload { timestamp_us, channel, feeds })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real signed BTC message from `pyth-lazer-protocol`'s own test suite (Apache-2.0), signed by Pyth's production key.
    const VECTOR: &str = include_str!("../../tests/fixtures/pyth_pro_btc_vector.hex");

    fn hex(s: &str) -> Vec<u8> {
        let s = s.trim();
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn parses_the_real_pyth_vector() {
        let msg = hex(VECTOR);
        let env = parse_envelope(&msg).unwrap();
        let p = parse_payload(env.payload, 32).unwrap();
        assert_eq!(p.timestamp_us, 1_771_339_368_200_000);
        assert_eq!(p.channel, 3);
        assert_eq!(p.feeds.len(), 1);
        let f = p.feeds[0];
        assert_eq!(f.feed_id, 1);
        assert_eq!(f.price, 6_713_436_287_632);
        assert_eq!(f.best_bid, 6_713_017_907_790);
        assert_eq!(f.best_ask, 6_713_596_631_740);
        assert_eq!(f.publisher_count, Some(18));
        assert_eq!(f.exponent, Some(-8));
        assert_eq!(f.confidence, 1_500_580_860);
        assert_eq!(f.feed_update_ts_us, Some(1_771_339_368_200_000));
    }

    #[test]
    fn rejects_malformed_messages() {
        let msg = hex(VECTOR);
        // truncated envelope and payload
        assert_eq!(parse_envelope(&msg[..msg.len() - 1]).unwrap_err(), ParseError::Malformed);
        assert_eq!(parse_envelope(&msg[..50]).unwrap_err(), ParseError::Malformed);
        let env = parse_envelope(&msg).unwrap();
        assert_eq!(parse_payload(&env.payload[..env.payload.len() - 1], 32).unwrap_err(), ParseError::Malformed);
        // bad magic
        let mut bad = msg.clone();
        bad[0] ^= 1;
        assert_eq!(parse_envelope(&bad).unwrap_err(), ParseError::BadMagic);
        // unknown property id: the first property id of the first feed sits right after
        // magic(4) + ts(8) + channel(1) + n_feeds(1) + feed_id(4) + n_props(1)
        let mut p = env.payload.to_vec();
        p[19] = 200;
        assert_eq!(parse_payload(&p, 32).unwrap_err(), ParseError::UnknownProperty);
        // too many feeds for the caller
        assert_eq!(parse_payload(env.payload, 0).unwrap_err(), ParseError::Malformed);
        // trailing bytes
        let mut long = env.payload.to_vec();
        long.push(0);
        assert_eq!(parse_payload(&long, 32).unwrap_err(), ParseError::Malformed);
    }
}
