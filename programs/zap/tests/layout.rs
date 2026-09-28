//! Writes the byte layout of every zero-copy account and nested struct to `packages/sdk/src/generated/layout.json`, so
//! the TypeScript decoders read exactly the offsets the program uses.
//!
//!   cargo test -p zap --test layout -- --ignored

use core::mem::{offset_of, size_of};
use std::fmt::Write;

use zap::state::{Market, MarketParams, Order, Pool, Position, TradingAccount};

macro_rules! fields {
    ($t:ty; $($name:ident : $ty:expr),* $(,)?) => {
        vec![$( (stringify!($name), offset_of!($t, $name), $ty) ),*]
    };
}

fn struct_json(out: &mut String, name: &str, size: usize, fields: Vec<(&str, usize, &str)>) {
    let _ = write!(out, "  \"{name}\": {{ \"size\": {size}, \"fields\": [");
    for (i, (n, off, ty)) in fields.iter().enumerate() {
        let _ = write!(out, "{}\n    [\"{n}\", {off}, \"{ty}\"]", if i == 0 { "" } else { "," });
    }
    out.push_str("\n  ]}");
}

#[test]
#[ignore]
fn write_layout() {
    let mut out = String::from("{\n");
    struct_json(&mut out, "MarketParams", size_of::<MarketParams>(), fields!(MarketParams;
        max_leverage: "u16", mmr_bps: "u16", open_fee_bps: "u16", close_fee_bps: "u16", conf_mult_bps: "u16",
        max_conf_bps: "u16", impact_cap_bps: "u16", oi_cap_long_bps: "u16", oi_cap_short_bps: "u16",
        min_spread_frac: "u64", impact_depth_usd: "u64", max_position_usd: "u64",
    ));
    out.push_str(",\n");
    struct_json(&mut out, "Pool", size_of::<Pool>(), fields!(Pool;
        assets: "u64", reserved: "u64", lp_supply: "u64", protocol_fees: "u64", borrow_index: "u128",
        sum_size_borrow_entry: "u128", borrow_last_ts: "i64", seq: "u64", num_markets: "u16", bump: "u8",
        cum_trading_fees: "u64", cum_borrow_fees: "u64", cum_liquidation_fees: "u64", cum_spread_impact: "u64",
        cum_funding_net: "i64", cum_trader_pnl: "i64", cum_volume: "u64",
    ));
    out.push_str(",\n");
    struct_json(&mut out, "Market", size_of::<Market>(), fields!(Market;
        index: "u16", status: "u8", bump: "u8", feed_id: "u32", expo: "i16", symbol: "str16",
        params: "MarketParams", oi_long: "u64", oi_short: "u64", units_long: "u128", units_short: "u128",
        funding_index_long: "i128", funding_index_short: "i128", sum_sf_long: "i128", sum_sf_short: "i128",
        funding_rate: "i128", last_accrual_ts: "i64", last_price: "u64", last_conf: "u64", last_price_ts_us: "u64",
        trade_seq: "u64", cum_volume: "u64", cum_fees: "u64", cum_funding_net: "i64",
    ));
    out.push_str(",\n");
    struct_json(&mut out, "Position", size_of::<Position>(), fields!(Position;
        position_id: "u64", size_usd: "u64", collateral: "u64", units: "u128", entry_funding_index: "i128",
        entry_borrow_index: "u128", last_price_ts_us: "u64", opened_at: "i64", updated_at: "i64", tp_price: "u64",
        sl_price: "u64", realized_pnl: "i64", fees_paid: "u64", market_index: "u16", side: "u8", status: "u8",
    ));
    out.push_str(",\n");
    struct_json(&mut out, "Order", size_of::<Order>(), fields!(Order;
        order_id: "u64", position_id: "u64", size_usd: "u64", collateral_escrow: "u64", fee_escrow: "u64",
        trigger_price: "u64", acceptable_price: "u64", created_at: "i64", tp_price: "u64", sl_price: "u64",
        market_index: "u16", kind: "u8", side: "u8", flags: "u8", status: "u8",
    ));
    out.push_str(",\n");
    let positions = format!("Position[{}]", zap::constants::MAX_POSITIONS);
    let orders = format!("Order[{}]", zap::constants::MAX_ORDERS);
    struct_json(&mut out, "TradingAccount", size_of::<TradingAccount>(), fields!(TradingAccount;
        owner: "pubkey", session_key: "pubkey", rent_payer: "pubkey", session_expires_at: "i64", balance: "u64",
        lp_shares: "u64", lp_cost_basis: "u64", lp_last_deposit_ts: "i64", next_position_id: "u64",
        next_order_id: "u64", seq: "u64", created_at: "i64", realized_pnl: "i64", fees_paid: "u64",
        funding_paid: "i64", borrow_paid: "u64", volume: "u64", deposited: "u64", withdrawn: "u64", bump: "u8",
        version: "u8", positions: positions.as_str(), orders: orders.as_str(),
    ));
    out.push_str("\n}\n");

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../packages/sdk/src/generated/layout.json");
    std::fs::create_dir_all(std::path::Path::new(path).parent().unwrap()).unwrap();
    std::fs::write(path, out).unwrap();
}
