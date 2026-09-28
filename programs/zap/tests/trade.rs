mod common;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use zap::error::ZapError;
use zap::state::MarketParams;
use zap_math::{fees, position as pm, price, Side};

const BTC: u16 = 0;
const SOL: u16 = 1;

fn tier_b() -> MarketParams {
    MarketParams {
        max_leverage: 50,
        mmr_bps: 100,
        open_fee_bps: 5,
        close_fee_bps: 5,
        conf_mult_bps: 10_000,
        max_conf_bps: 50,
        impact_cap_bps: 50,
        oi_cap_long_bps: 800,
        oi_cap_short_bps: 800,
        _pad: [0; 6],
        min_spread_frac: 100_000_000,
        impact_depth_usd: 125_000_000 * USD,
        max_position_usd: 100_000 * USD,
    }
}

fn setup() -> (Env, Keypair) {
    let mut env = Env::new();
    env.add_market(BTC, BTC_FEED, "BTC-USD", tier_a()).unwrap();
    env.add_market(SOL, SOL_FEED, "SOL-USD", tier_b()).unwrap();
    let lp = env.seed_vault(1_000_000 * USD, &[(BTC_FEED, 100_000.0), (SOL_FEED, 150.0)]);
    (env, lp)
}

fn run(ixs: Vec<anchor_lang::solana_program::instruction::Instruction>, env: &mut Env, signer: &Keypair) -> TxResult {
    let relayer = env.relayer.insecure_clone();
    env.send(&ixs, &relayer, &[signer])
}

/// Expected fill for a market order on BTC (tier A, no confidence) given the current skew.
fn expected_fill(mid: u64, skew: i128, size: u64, is_buy: bool) -> u64 {
    let p = tier_a();
    let spread = price::spread_frac(mid, 0, u128::from(p.min_spread_frac), p.conf_mult_bps).unwrap();
    let delta = if is_buy { size as i128 } else { -(size as i128) };
    let impact = price::impact_frac(skew, delta, p.impact_depth_usd, p.impact_cap_bps).unwrap();
    price::fill_price(mid, spread, impact, is_buy).unwrap()
}

#[test]
fn long_round_trip_with_profit() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    let size = 10_000 * USD;

    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    let r = run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, size, 100 * USD, 0), &mut env, &alice).unwrap();
    assert!(r.compute_units_consumed < 200_000, "open used {} CU", r.compute_units_consumed);

    let entry = expected_fill(px(100_000.0), 0, size, true);
    let units = price::units_for(size, entry, true).unwrap();
    let open_fee = fees::open_fee(size, 4).unwrap();
    let a = env.trading_account(&alice.pubkey());
    let p = a.positions[0];
    assert_eq!((p.size_usd, p.collateral, p.units.get(), p.position_id), (size, 100 * USD, units, 1));
    assert_eq!(a.balance, 1_000 * USD - 100 * USD - open_fee);
    assert_eq!(env.market(BTC).oi_long, size);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);

    // price up 1%: close everything
    env.set_time(t + 1);
    let msg = env.price_msg(BTC_FEED, 101_000.0, t + 1);
    let r = run(env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1, u64::MAX, 0), &mut env, &alice).unwrap();
    assert!(r.compute_units_consumed < 200_000, "close used {} CU", r.compute_units_consumed);

    let exit = expected_fill(px(101_000.0), size as i128, size, false);
    let pnl = pm::pnl(Side::Long, size, units, exit).unwrap();
    let close_fee = fees::close_fee(units, exit, 4).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert!(pnl > 90 * USD as i128);
    assert_eq!(a.positions[0].status, 0);
    // funding and borrow accrued over the second the position was open are settled from its collateral
    let owed = a.funding_paid as i128 + a.borrow_paid as i128;
    assert!(owed > 0 && owed < 1_000, "one second of fees: {owed}");
    assert_eq!(a.balance as i128, (1_000 * USD - 100 * USD - open_fee) as i128 + 100 * USD as i128 - owed + pnl - close_fee as i128);
    assert_eq!(a.realized_pnl as i128, pnl);
    assert_eq!(env.market(BTC).oi_long, 0);
    assert_eq!(env.pool().reserved, 0);
    // the vault paid the profit and kept both fees
    assert_eq!(env.pool().assets as i128, (1_000_000 * USD) as i128 - pnl + (open_fee + close_fee) as i128 + owed);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn short_loses_when_price_rises_and_vault_gains() {
    let (mut env, lp) = setup();
    let (bob, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(SOL_FEED, 150.0, t);
    run(env.open_ixs(&bob.pubkey(), &bob.pubkey(), SOL, &msg, SHORT, 5_000 * USD, 500 * USD, 0), &mut env, &bob).unwrap();
    let assets_before = env.pool().assets;
    env.set_time(t + 1);
    let msg = env.price_msg(SOL_FEED, 153.0, t + 1);
    run(env.close_ixs(&bob.pubkey(), &bob.pubkey(), SOL, &msg, SHORT, 1, u64::MAX, 0), &mut env, &bob).unwrap();
    let a = env.trading_account(&bob.pubkey());
    assert!(a.realized_pnl < -99 * USD as i64, "2% against a $5k short loses ~$100: {}", a.realized_pnl);
    assert!(env.pool().assets > assets_before + 99 * USD);
    env.check_invariants(&[bob.pubkey(), lp.pubkey()]);
}

#[test]
fn round_trip_at_the_same_price_never_profits() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(10_000 * USD, None);
    let t = env.now();
    for (i, side) in [LONG, SHORT].into_iter().enumerate() {
        let msg = env.price_msg(BTC_FEED, 100_000.0, t);
        let before = env.trading_account(&alice.pubkey()).balance;
        run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, side, 50_000 * USD, 1_000 * USD, 0), &mut env, &alice).unwrap();
        let id = (i + 1) as u64;
        run(env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, side, id, u64::MAX, 0), &mut env, &alice).unwrap();
        assert!(env.trading_account(&alice.pubkey()).balance < before);
    }
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn partial_close_and_increase() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(5_000 * USD, None);
    let t = env.now();
    let m1 = env.price_msg(BTC_FEED, 100_000.0, t);
    run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &m1, LONG, 20_000 * USD, 400 * USD, 0), &mut env, &alice).unwrap();
    // add at a higher price: units add up, so PnL stays exact (harmonic-mean entry)
    env.set_time(t + 1);
    let m2 = env.price_msg(BTC_FEED, 110_000.0, t + 1);
    run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &m2, LONG, 20_000 * USD, 400 * USD, 0), &mut env, &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    let p = a.positions[0];
    let owed = (a.funding_paid + a.borrow_paid as i64) as u64;
    assert_eq!((p.size_usd, p.collateral), (40_000 * USD, 800 * USD - owed));
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);

    // close a quarter
    env.set_time(t + 2);
    let m3 = env.price_msg(BTC_FEED, 105_000.0, t + 2);
    run(env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &m3, LONG, 1, 10_000 * USD, 0), &mut env, &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    let q = a.positions[0];
    let owed_now = (a.funding_paid + a.borrow_paid as i64) as u64;
    assert_eq!(q.size_usd, 30_000 * USD);
    // three quarters of the collateral left after settling fees
    assert_eq!(q.collateral, (800 * USD - owed_now) - (800 * USD - owed_now) / 4);
    assert_eq!(q.units.get(), p.units.get() - p.units.get() / 4);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);

    // leaving less than the $10 minimum is refused
    let ixs = env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &m3, LONG, 1, 30_000 * USD - 5 * USD, 0);
    assert_error(run(ixs, &mut env, &alice), ZapError::MinSize);
}

#[test]
fn risk_checks_on_open() {
    let (mut env, _lp) = setup();
    let (alice, _) = env.funded_trader(100_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    let open = |env: &Env, size: u64, coll: u64, acceptable: u64| {
        env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, size, coll, acceptable)
    };
    // above 100x
    assert_error(run(open(&env, 10_001 * USD, 100 * USD, 0), &mut env, &alice), ZapError::MaxLeverage);
    // below minimum size
    assert_error(run(open(&env, 9 * USD, 1 * USD, 0), &mut env, &alice), ZapError::MinSize);
    // acceptable price below the fill
    assert_error(run(open(&env, 1_000 * USD, 100 * USD, px(100_000.0)), &mut env, &alice), ZapError::Slippage);
    // more than the balance
    assert_error(run(open(&env, 1_000 * USD, 100_000 * USD, 0), &mut env, &alice), ZapError::InsufficientBalance);
    // single position above the market max ($250k)
    assert_error(run(open(&env, 250_001 * USD, 50_000 * USD, 0), &mut env, &alice), ZapError::MaxPosition);
    // long OI cap: 15% of a $1M vault = $150k
    run(open(&env, 150_000 * USD, 20_000 * USD, 0), &mut env, &alice).unwrap();
    assert_error(run(open(&env, 1_000 * USD, 1_000 * USD, 0), &mut env, &alice), ZapError::OiCap);
}

#[test]
fn session_keys_trade_but_strangers_and_expired_sessions_cannot() {
    let (mut env, _lp) = setup();
    let session = Keypair::new();
    let (alice, _) = env.funded_trader(1_000 * USD, Some(&session));
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    let relayer = env.relayer.insecure_clone();

    // the session key signs alone (gasless: the relayer pays)
    let ixs = env.open_ixs(&session.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1_000 * USD, 100 * USD, 0);
    env.send(&ixs, &relayer, &[&session]).unwrap();

    let stranger = Keypair::new();
    let ixs = env.open_ixs(&stranger.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1_000 * USD, 100 * USD, 0);
    assert_error(env.send(&ixs, &relayer, &[&stranger]), ZapError::Unauthorized);

    // a day later the session has expired
    let later = t + 86_401;
    env.set_time(later);
    let msg = env.price_msg(BTC_FEED, 100_000.0, later);
    let ixs = env.close_ixs(&session.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1, u64::MAX, 0);
    assert_error(env.send(&ixs, &relayer, &[&session]), ZapError::SessionExpired);
    // the owner still can
    run(env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1, u64::MAX, 0), &mut env, &alice).unwrap();
}

#[test]
fn funding_and_borrow_accrue_and_settle() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(10_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 100_000 * USD, 5_000 * USD, 0), &mut env, &alice).unwrap();
    // all open interest is long: longs pay the max rate (0.01%/h)
    assert!(env.market(BTC).funding_rate.get() > 0);

    let later = t + 3_600;
    env.set_time(later);
    let msg = env.price_msg(BTC_FEED, 100_000.0, later);
    run(env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1, u64::MAX, 0), &mut env, &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    // one hour of funding at 0.01% on $100k ≈ $10 (rounded against the trader)
    assert!((a.funding_paid - 10 * USD as i64).abs() <= 1_000, "funding {}", a.funding_paid);
    // borrow at 10% utilization of a kinked curve (30% APR at 75%): 4% APR for an hour ≈ $0.46
    assert!(a.borrow_paid > 400_000 && a.borrow_paid < 500_000, "borrow {}", a.borrow_paid);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn confidence_pause_and_reduce_only() {
    let (mut env, _lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1_000 * USD, 100 * USD, 0), &mut env, &alice).unwrap();

    // wide confidence (1% > 0.5% max): no new risk, but closing works
    let wide = signed_message(&env.oracle, us(t), 3, &[TestFeed { feed_id: BTC_FEED, price: 10_000_000_000_000, conf: 100_000_000_000, feed_ts_us: us(t) }]);
    let ixs = env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &wide, LONG, 1_000 * USD, 100 * USD, 0);
    assert_error(run(ixs, &mut env, &alice), ZapError::ConfidenceTooWide);

    // protocol paused: opens refused, closes allowed
    let mut params = default_params(env.oracle.pubkey());
    params.paused = true;
    env.update_config(params).unwrap();
    let ixs = env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1_000 * USD, 100 * USD, 0);
    assert_error(run(ixs, &mut env, &alice), ZapError::ProtocolPaused);
    run(env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &wide, LONG, 1, u64::MAX, 0), &mut env, &alice).unwrap();
}

#[test]
fn collateral_and_tpsl() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(2_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 10_000 * USD, 500 * USD, 0), &mut env, &alice).unwrap();

    let (ix, relayer) = (env.add_collateral_ix(&alice, BTC, LONG, 1, 300 * USD), env.relayer.insecure_clone());
    env.send(&[ix], &relayer, &[&alice]).unwrap();
    assert_eq!(env.trading_account(&alice.pubkey()).positions[0].collateral, 800 * USD);

    // profit can't be withdrawn: price +5%, try to pull the collateral down to 1x of the original
    env.set_time(t + 1);
    let up = env.price_msg(BTC_FEED, 105_000.0, t + 1);
    let ixs = env.remove_collateral_ixs(&alice, BTC, &up, LONG, 1, 750 * USD);
    assert_error(run(ixs, &mut env, &alice), ZapError::MaxLeverage);
    let ixs = env.remove_collateral_ixs(&alice, BTC, &up, LONG, 1, 600 * USD);
    run(ixs, &mut env, &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert_eq!(a.positions[0].collateral, 200 * USD - (a.funding_paid + a.borrow_paid as i64) as u64);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);

    let (ix, relayer) = (env.set_tpsl_ix(&alice, BTC, LONG, 1, px(110_000.0), px(98_000.0)), env.relayer.insecure_clone());
    env.send(&[ix], &relayer, &[&alice]).unwrap();
    let p = env.trading_account(&alice.pubkey()).positions[0];
    assert_eq!((p.tp_price, p.sl_price), (px(110_000.0), px(98_000.0)));
    // wrong position id
    let ix = env.set_tpsl_ix(&alice, BTC, LONG, 7, 0, 0);
    assert_error(env.send(&[ix], &relayer, &[&alice]), ZapError::IdMismatch);
}

#[test]
fn prices_cannot_go_back_for_a_position() {
    let (mut env, _lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    run(env.open_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1_000 * USD, 100 * USD, 0), &mut env, &alice).unwrap();
    // 0.5s older: inside the market grace, but older than the price this position last used
    let older = signed_message(&env.oracle, us(t) - 500_000, 3, &[feed(BTC_FEED, 101_000.0, us(t) - 500_000)]);
    let ixs = env.close_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &older, LONG, 1, u64::MAX, 0);
    assert_error(run(ixs, &mut env, &alice), ZapError::BelowPositionTimestamp);
}

#[test]
fn lp_share_price_follows_trader_losses() {
    let (mut env, lp) = setup();
    let lp_shares = env.trading_account(&lp.pubkey()).lp_shares;
    assert_eq!(lp_shares, 1_000_000 * USD);
    let (bob, _) = env.funded_trader(2_000 * USD, None);
    let t = env.now();
    let msg = env.price_msg(BTC_FEED, 100_000.0, t);
    run(env.open_ixs(&bob.pubkey(), &bob.pubkey(), BTC, &msg, LONG, 50_000 * USD, 1_000 * USD, 0), &mut env, &bob).unwrap();

    // Bob is down ~1% ($500) at 99,000: a new LP pays the higher share price, so gets fewer shares per dollar
    env.set_time(t + 1);
    let (carol, _) = env.funded_trader(10_000 * USD, None);
    let feeds = [feed(BTC_FEED, 99_000.0, us(t + 1)), feed(SOL_FEED, 150.0, us(t + 1))];
    let relayer = env.relayer.insecure_clone();
    let ixs = env.lp_ixs(&carol.pubkey(), &feeds, true, 10_000 * USD);
    env.send(&ixs, &relayer, &[&carol]).unwrap();
    let carol_shares = env.trading_account(&carol.pubkey()).lp_shares;
    assert!(carol_shares < 10_000 * USD && carol_shares > 9_990 * USD, "shares {carol_shares}");
    env.check_invariants(&[bob.pubkey(), lp.pubkey(), carol.pubkey()]);

    // withdrawing everything returns at most the deposit (rounding against the LP)
    let ixs = env.lp_ixs(&carol.pubkey(), &feeds, false, carol_shares);
    env.send(&ixs, &relayer, &[&carol]).unwrap();
    let back = env.trading_account(&carol.pubkey()).balance;
    assert!(back <= 10_000 * USD && back > 9_999 * USD, "got back {back}");

    // markets must all be passed
    let mut ixs = env.lp_ixs(&lp.pubkey(), &feeds, false, 1_000 * USD);
    ixs[1].accounts.pop();
    assert_error(env.send(&ixs, &relayer, &[&lp]), ZapError::MissingMarkets);
    env.check_invariants(&[bob.pubkey(), lp.pubkey(), carol.pubkey()]);
}
