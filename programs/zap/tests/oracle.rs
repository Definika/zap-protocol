mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_signer::Signer;
use zap::constants::{PYTH_PRO_PROGRAM_ID, PYTH_STORAGE_DISCRIMINATOR};
use zap::error::ZapError;

const VECTOR: &str = include_str!("fixtures/pyth_pro_btc_vector.hex");

fn hex(s: &str) -> Vec<u8> {
    let s = s.trim();
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn env_with_markets() -> Env {
    let mut env = Env::new();
    env.add_market(0, BTC_FEED, "BTC-USD", tier_a()).unwrap();
    env.add_market(1, SOL_FEED, "SOL-USD", tier_a()).unwrap();
    env
}

fn refresh(env: &mut Env, markets: &[u16], msg: &[u8]) -> TxResult {
    let ixs = env.refresh_ixs(markets, msg, Pubkey::default());
    let relayer = env.relayer.insecure_clone();
    env.send(&ixs, &relayer, &[])
}

#[test]
fn refresh_with_trusted_test_signer() {
    let mut env = env_with_markets();
    let t = us(env.now());
    let msg = signed_message(&env.oracle, t, 3, &[feed(BTC_FEED, 97_412.6, t), feed(SOL_FEED, 184.126, t)]);
    refresh(&mut env, &[0, 1], &msg).unwrap();
    let btc = env.market(0);
    assert_eq!(btc.last_price, 97_412_600_000_000_000); // 12 decimals
    assert_eq!(btc.last_price_ts_us, t);
    assert_eq!(env.market(1).last_price, 184_126_000_000_000);
    assert_eq!(env.pool().seq, 2);
}

#[test]
fn rejects_untrusted_or_expired_signers() {
    let mut env = env_with_markets();
    let t = us(env.now());
    let stranger = Keypair::new();
    let msg = signed_message(&stranger, t, 3, &[feed(BTC_FEED, 1.0, t)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::UntrustedSigner);

    // the configured signer, but expired
    let mut params = default_params(env.oracle.pubkey());
    params.oracle_signer_expiry[0] = env.now() - 1;
    env.update_config(params).unwrap();
    let msg = signed_message(&env.oracle, t, 3, &[feed(BTC_FEED, 1.0, t)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::UntrustedSigner);
}

#[test]
fn freshness_rules() {
    let mut env = env_with_markets();
    let now = env.now();
    let o = env.oracle.insecure_clone();
    // 6s old message: stale
    let old = us(now - 6);
    let msg = signed_message(&o, old, 3, &[feed(BTC_FEED, 1.0, old)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::PriceStale);
    // 6s in the future
    let fut = us(now + 6);
    let msg = signed_message(&o, fut, 3, &[feed(BTC_FEED, 1.0, fut)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::PriceFromFuture);
    // fresh message but the feed itself last updated 11s ago (carried-forward price)
    let t = us(now);
    let msg = signed_message(&o, t, 3, &[feed(BTC_FEED, 1.0, us(now - 11))]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::FeedStale);
    // wrong channel
    let msg = signed_message(&o, t, 1, &[feed(BTC_FEED, 1.0, t)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::ChannelMismatch);
    // market's feed not in the message
    let msg = signed_message(&o, t, 3, &[feed(SOL_FEED, 1.0, t)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::FeedMissing);
    // zero price means "no price"
    let msg = signed_message(&o, t, 3, &[feed(BTC_FEED, 0.0, t)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::PriceMissing);
}

#[test]
fn watermark_refuses_older_prices_beyond_grace() {
    let mut env = env_with_markets();
    let o = env.oracle.insecure_clone();
    let t = us(env.now());
    refresh(&mut env, &[0], &signed_message(&o, t, 3, &[feed(BTC_FEED, 100.0, t)])).unwrap();
    // 500ms older than the watermark: within the 1s grace, accepted, but the watermark stays
    let within = t - 500_000;
    refresh(&mut env, &[0], &signed_message(&o, within, 3, &[feed(BTC_FEED, 99.0, within)])).unwrap();
    assert_eq!(env.market(0).last_price_ts_us, t);
    assert_eq!(env.market(0).last_price, 100 * 1_000_000_000_000);
    // 2s older: refused
    let older = t - 2_000_000;
    let msg = signed_message(&o, older, 3, &[feed(BTC_FEED, 98.0, older)]);
    assert_error(refresh(&mut env, &[0], &msg), ZapError::BelowWatermark);
    // same timestamp as the watermark: accepted (concurrent users with the same price)
    refresh(&mut env, &[0], &signed_message(&o, t, 3, &[feed(BTC_FEED, 100.0, t)])).unwrap();
}

#[test]
fn ed25519_instruction_must_match() {
    let mut env = env_with_markets();
    let t = us(env.now());
    let msg = signed_message(&env.oracle, t, 3, &[feed(BTC_FEED, 100.0, t)]);
    let relayer = env.relayer.insecure_clone();

    // missing ed25519 instruction
    let ixs = env.refresh_ixs(&[0], &msg, Pubkey::default());
    assert_error(env.send(&ixs[1..], &relayer, &[]), ZapError::Ed25519Missing);

    // offsets pointing elsewhere
    let mut ixs = env.refresh_ixs(&[0], &msg, Pubkey::default());
    ixs[0].data[2] = ixs[0].data[2].wrapping_add(1);
    assert!(env.send(&ixs, &relayer, &[]).is_err());

    // a tampered price in our instruction: the precompile rejects the signature
    let mut forged = msg.clone();
    let n = forged.len();
    forged[n - 30] ^= 0xff;
    let mut ixs = env.refresh_ixs(&[0], &forged, Pubkey::default());
    ixs[0] = ed25519_ix(&forged, 1);
    assert_failed(env.send(&ixs, &relayer, &[]));

    // the verified message is not the one passed to us: sign one, pass another with the same length
    let other = signed_message(&env.oracle, t, 3, &[feed(BTC_FEED, 1.0, t)]);
    let mut ixs = env.refresh_ixs(&[0], &other, Pubkey::default());
    // make the precompile verify bytes from a different instruction (index 0 is itself)
    ixs[0].data[4] = 0;
    assert!(env.send(&ixs, &relayer, &[]).is_err());
}

/// Pyth Pro storage account with one trusted signer, laid out like the real one (381 bytes, owned by the Pyth program).
fn pyth_storage(env: &mut Env, signer: &[u8; 32], expires_at: i64, owner: Pubkey) -> Pubkey {
    let mut d = vec![0u8; 381];
    d[..8].copy_from_slice(&PYTH_STORAGE_DISCRIMINATOR);
    d[80] = 1;
    d[81..113].copy_from_slice(signer);
    d[113..121].copy_from_slice(&expires_at.to_le_bytes());
    let key = Pubkey::new_unique();
    env.svm
        .set_account(key, Account { lamports: 10_000_000, data: d, owner, executable: false, rent_epoch: 0 })
        .unwrap();
    key
}

#[test]
fn verifies_the_real_pyth_message_via_pyth_storage() {
    let mut env = env_with_markets();
    let msg = hex(VECTOR);
    let signer: [u8; 32] = msg[68..100].try_into().unwrap();
    let storage = pyth_storage(&mut env, &signer, 2_000_000_000, PYTH_PRO_PROGRAM_ID);
    let mut params = default_params(env.oracle.pubkey());
    params.use_pyth_storage = true;
    params.pyth_storage = storage;
    env.update_config(params).unwrap();
    // the vector was published at 1771339368.2s
    env.set_time(T0);

    let relayer = env.relayer.insecure_clone();
    let ixs = env.refresh_ixs(&[0], &msg, storage);
    env.send(&ixs, &relayer, &[]).unwrap();
    let btc = env.market(0);
    // BTC $67,134.36287632 with exponent -8 → 12 decimals
    assert_eq!(btc.last_price, 6_713_436_287_632 * 10_000);
    assert_eq!(btc.last_conf, 1_500_580_860 * 10_000);
    assert_eq!(btc.last_price_ts_us, 1_771_339_368_200_000);
}

#[test]
fn pyth_storage_must_be_genuine_and_current() {
    let mut env = env_with_markets();
    let msg = hex(VECTOR);
    let signer: [u8; 32] = msg[68..100].try_into().unwrap();
    let relayer = env.relayer.insecure_clone();

    // same bytes, wrong owner
    let fake = pyth_storage(&mut env, &signer, 2_000_000_000, Pubkey::new_unique());
    let mut params = default_params(env.oracle.pubkey());
    params.use_pyth_storage = true;
    params.pyth_storage = fake;
    env.update_config(params).unwrap();
    env.set_time(T0);
    let ixs = env.refresh_ixs(&[0], &msg, fake);
    assert_error(env.send(&ixs, &relayer, &[]), ZapError::BadPythStorage);

    // genuine owner, but the signer's entry has expired
    let expired = pyth_storage(&mut env, &signer, T0 - 1, PYTH_PRO_PROGRAM_ID);
    params.pyth_storage = expired;
    env.update_config(params).unwrap();
    env.set_time(T0);
    let ixs = env.refresh_ixs(&[0], &msg, expired);
    assert_error(env.send(&ixs, &relayer, &[]), ZapError::UntrustedSigner);

    // a storage account other than the configured one
    let other = pyth_storage(&mut env, &signer, 2_000_000_000, PYTH_PRO_PROGRAM_ID);
    let ixs = env.refresh_ixs(&[0], &msg, other);
    assert_error(env.send(&ixs, &relayer, &[]), ZapError::BadPythStorage);
}
