mod common;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use zap::constants::{order_flags, order_kind, slot_status};
use zap::error::ZapError;
use zap::instructions::trigger_target;

const BTC: u16 = 0;

fn setup() -> (Env, Keypair) {
    let mut env = Env::new();
    env.add_market(BTC, BTC_FEED, "BTC-USD", tier_a()).unwrap();
    let lp = env.seed_vault(1_000_000 * USD, &[(BTC_FEED, 100_000.0)]);
    (env, lp)
}

fn open(env: &mut Env, who: &Keypair, side: u8, size: u64, coll: u64, usd: f64, t: i64) {
    let msg = env.price_msg(BTC_FEED, usd, t);
    let ixs = env.open_ixs(&who.pubkey(), &who.pubkey(), BTC, &msg, side, size, coll, 0);
    env.relay(&ixs, who).unwrap();
}

#[test]
fn limit_order_escrows_then_fills_at_its_limit_or_better() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    let ix = env.place_order_ix(&alice, BTC, LONG, order_kind::LIMIT, 0, 0, 10_000 * USD, 200 * USD, px(99_000.0), 0, px(105_000.0), px(97_000.0));
    env.relay(&[ix], &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    let o = a.orders[0];
    assert_eq!((o.order_id, o.kind, o.status), (1, order_kind::LIMIT, slot_status::OPEN));
    assert_eq!(a.balance, 1_000 * USD - 200 * USD - 4 * USD); // collateral + 0.04% fee escrowed
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);

    // not yet: price above the limit
    env.set_time(t + 1);
    let msg = env.price_msg(BTC_FEED, 100_000.0, t + 1);
    assert_error(env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::ORDER, LONG, 1)), ZapError::TriggerNotMet);
    // price drops through the limit: fills, and the position gets the order's TP/SL
    env.set_time(t + 2);
    let msg = env.price_msg(BTC_FEED, 98_800.0, t + 2);
    env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::ORDER, LONG, 1)).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert_eq!(a.orders[0].status, slot_status::EMPTY);
    let p = a.positions[0];
    assert_eq!((p.size_usd, p.collateral, p.tp_price, p.sl_price), (10_000 * USD, 200 * USD, px(105_000.0), px(97_000.0)));
    // entry at or below the limit
    let entry_units_floor = zap_math::price::units_for(10_000 * USD, px(99_000.0), true).unwrap();
    assert!(p.units.get() >= entry_units_floor);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn stop_order_and_price_ordering() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    let ix = env.place_order_ix(&alice, BTC, LONG, order_kind::STOP, 0, 0, 5_000 * USD, 100 * USD, px(101_000.0), 0, 0, 0);
    env.relay(&[ix], &alice).unwrap();
    // a price published before the order was placed can't fill it, even if it crossed the trigger
    let before = signed_message(&env.oracle, us(t) - 1_000_000, 3, &[feed(BTC_FEED, 102_000.0, us(t) - 1_000_000)]);
    assert_error(env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &before, trigger_target::ORDER, LONG, 1)), ZapError::BelowPositionTimestamp);
    env.set_time(t + 1);
    let msg = env.price_msg(BTC_FEED, 101_500.0, t + 1);
    env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::ORDER, LONG, 1)).unwrap();
    assert_eq!(env.trading_account(&alice.pubkey()).positions[0].size_usd, 5_000 * USD);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn post_only_refuses_marketable_limits() {
    let (mut env, _lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    // establish the market's last price at 100,000
    let t = env.now();
    open(&mut env, &alice, LONG, 1_000 * USD, 100 * USD, 100_000.0, t);
    let ix = env.place_order_ix(&alice, BTC, LONG, order_kind::LIMIT, order_flags::POST_ONLY, 0, 1_000 * USD, 100 * USD, px(101_000.0), 0, 0, 0);
    assert_error(env.relay(&[ix], &alice), ZapError::PostOnlyWouldFill);
    let ix = env.place_order_ix(&alice, BTC, LONG, order_kind::LIMIT, order_flags::POST_ONLY, 0, 1_000 * USD, 100 * USD, px(99_000.0), 0, 0, 0);
    env.relay(&[ix], &alice).unwrap();
}

#[test]
fn cancel_refunds_and_update_moves_the_trigger() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let ix = env.place_order_ix(&alice, BTC, SHORT, order_kind::LIMIT, 0, 0, 2_000 * USD, 100 * USD, px(102_000.0), 0, 0, 0);
    env.relay(&[ix], &alice).unwrap();
    let ix = env.update_order_ix(&alice, BTC, 1, px(103_000.0), 0);
    env.relay(&[ix], &alice).unwrap();
    assert_eq!(env.trading_account(&alice.pubkey()).orders[0].trigger_price, px(103_000.0));
    let ix = env.cancel_order_ix(&alice, BTC, 1);
    env.relay(&[ix], &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert_eq!((a.balance, a.orders[0].status), (1_000 * USD, slot_status::EMPTY));
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn position_tp_and_sl_execute_at_their_triggers() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(2_000 * USD, None);
    let t = env.now();
    open(&mut env, &alice, LONG, 10_000 * USD, 500 * USD, 100_000.0, t);
    let ix = env.set_tpsl_ix(&alice, BTC, LONG, 1, px(102_000.0), px(99_000.0));
    env.relay(&[ix], &alice).unwrap();

    env.set_time(t + 1);
    let msg = env.price_msg(BTC_FEED, 101_000.0, t + 1);
    assert_error(env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::POSITION_TP, LONG, 1)), ZapError::TriggerNotMet);
    assert_error(env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::POSITION_SL, LONG, 1)), ZapError::TriggerNotMet);
    env.set_time(t + 2);
    let msg = env.price_msg(BTC_FEED, 102_100.0, t + 2);
    env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::POSITION_TP, LONG, 1)).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert_eq!(a.positions[0].status, slot_status::EMPTY);
    assert!(a.realized_pnl > 200 * USD as i64);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn multi_level_take_profit() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(2_000 * USD, None);
    let t = env.now();
    open(&mut env, &alice, LONG, 20_000 * USD, 1_000 * USD, 100_000.0, t);
    for (trigger, size) in [(101_000.0, 10_000 * USD), (102_000.0, u64::MAX)] {
        let ix = env.place_order_ix(&alice, BTC, LONG, order_kind::TAKE_PROFIT, 0, 1, size, 0, px(trigger), 0, 0, 0);
        env.relay(&[ix], &alice).unwrap();
    }
    env.set_time(t + 1);
    let msg = env.price_msg(BTC_FEED, 101_200.0, t + 1);
    env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::ORDER, LONG, 1)).unwrap();
    assert_eq!(env.trading_account(&alice.pubkey()).positions[0].size_usd, 10_000 * USD);
    env.set_time(t + 2);
    let msg = env.price_msg(BTC_FEED, 102_300.0, t + 2);
    env.crank(&env.execute_trigger_ixs(&alice.pubkey(), BTC, &msg, trigger_target::ORDER, LONG, 2)).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert_eq!(a.positions[0].status, slot_status::EMPTY);
    assert!(a.orders.iter().all(|o| o.status == slot_status::EMPTY));
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}

#[test]
fn liquidation_pays_liquidator_vault_and_returns_the_rest() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let (keeper, _) = env.funded_trader(0, None);
    let t = env.now();
    // 100x long: $10k with $100
    open(&mut env, &alice, LONG, 10_000 * USD, 100 * USD, 100_000.0, t);
    env.set_time(t + 1);

    // healthy at -0.3%
    let msg = env.price_msg(BTC_FEED, 99_700.0, t + 1);
    assert_error(env.relay(&env.liquidate_ixs(&keeper.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1), &keeper), ZapError::NotLiquidatable);
    // no self-liquidation
    let own = env.liquidate_ixs(&alice.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1);
    assert_error(env.relay(&own, &alice), ZapError::Unauthorized);

    // -0.55%: equity ≈ 100 − 55 − 4 (close fee) < 50 maintenance
    env.set_time(t + 2);
    let msg = env.price_msg(BTC_FEED, 99_450.0, t + 2);
    let balance_before = env.trading_account(&alice.pubkey()).balance;
    env.relay(&env.liquidate_ixs(&keeper.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1), &keeper).unwrap();
    let a = env.trading_account(&alice.pubkey());
    assert_eq!(a.positions[0].status, slot_status::EMPTY);
    // liquidator gets half of the 0.2% fee: $10
    assert_eq!(env.trading_account(&keeper.pubkey()).balance, 10 * USD);
    // the trader keeps what's left after the full $20 fee: ~$45 − $20
    let returned = a.balance - balance_before;
    assert!(returned > 20 * USD && returned < 30 * USD, "returned {returned}");
    env.check_invariants(&[alice.pubkey(), lp.pubkey(), keeper.pubkey()]);
}

#[test]
fn gap_past_liquidation_is_absorbed_by_the_vault() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let (keeper, _) = env.funded_trader(0, None);
    let t = env.now();
    open(&mut env, &alice, LONG, 10_000 * USD, 100 * USD, 100_000.0, t);
    env.set_time(t + 1);
    // -2%: a $200 loss on $100 of collateral
    let msg = env.price_msg(BTC_FEED, 98_000.0, t + 1);
    let assets_before = env.pool().assets;
    let balance_before = env.trading_account(&alice.pubkey()).balance;
    env.relay(&env.liquidate_ixs(&keeper.pubkey(), &alice.pubkey(), BTC, &msg, LONG, 1), &keeper).unwrap();
    // nothing is left for the trader or the liquidator; the vault keeps the collateral and eats the rest
    assert_eq!(env.trading_account(&alice.pubkey()).balance, balance_before);
    assert_eq!(env.trading_account(&keeper.pubkey()).balance, 0);
    assert_eq!(env.pool().assets, assets_before + 100 * USD);
    env.check_invariants(&[alice.pubkey(), lp.pubkey(), keeper.pubkey()]);
}

#[test]
fn reverse_flips_the_position() {
    let (mut env, lp) = setup();
    let (alice, _) = env.funded_trader(1_000 * USD, None);
    let t = env.now();
    open(&mut env, &alice, LONG, 10_000 * USD, 200 * USD, 100_000.0, t);
    env.set_time(t + 1);
    let msg = env.price_msg(BTC_FEED, 100_500.0, t + 1);
    let ixs = env.reverse_ixs(&alice, BTC, &msg, LONG, 1, 0);
    env.relay(&ixs, &alice).unwrap();
    let a = env.trading_account(&alice.pubkey());
    let short = a.positions.iter().find(|p| p.status == slot_status::OPEN).unwrap();
    assert_eq!((short.side, short.size_usd, short.position_id), (SHORT, 10_000 * USD, 2));
    assert!(short.collateral > 199 * USD && short.collateral <= 200 * USD);
    env.check_invariants(&[alice.pubkey(), lp.pubkey()]);
}
