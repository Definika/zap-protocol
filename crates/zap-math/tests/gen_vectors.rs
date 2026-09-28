//! Golden vectors for the TypeScript port of this crate (`packages/sdk/src/math`).
//!
//! `cargo test -p zap-math --test gen_vectors -- --ignored` rewrites `packages/sdk/test/vectors/<module>.json`, and
//! `packages/sdk/test/math.test.ts` replays every case against the port, which must match bit for bit.
//!
//! A case is `{"fn", "args", "ok"}` or `{"fn", "args", "err"}`, named after the Rust function, with integers as decimal
//! strings, enums by variant name and struct fields by their Rust names. Where Rust panics on arithmetic overflow instead of
//! returning an error (release builds keep `overflow-checks`, so the transaction aborts), the case records
//! `"err": "Overflow"` plus the panic message under `"panic"`.
//!
//! Every function gets hand-picked edge cases (zero, one, type limits, rounding and overflow boundaries) and `RANDOM` cases
//! from a seeded xorshift that mixes realistic magnitudes with the full range of each type. Output is deterministic.

use std::cell::Cell;
use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use zap_math::fixed::{self, Round, U256};
use zap_math::position::{self, LiquidationSplit};
use zap_math::vault::{self, VIRTUAL_ASSETS, VIRTUAL_SHARES};
use zap_math::{borrow, fees, funding, price, MathError, Side};
use zap_math::{FRAC_ONE, FRAC_PER_BPS, PRICE_ONE, RATE_ONE, USD_ONE};

const RANDOM: usize = 300;
const U128: u128 = u128::MAX;
const U64: u128 = u64::MAX as u128;
const U32: u128 = u32::MAX as u128;
const U16: u128 = u16::MAX as u128;
const I128: u128 = i128::MAX as u128;
const ROUNDS: [Round; 2] = [Round::Down, Round::Up];
const SIDES: [Side; 2] = [Side::Long, Side::Short];
const BOOLS: [bool; 2] = [true, false];

#[test]
#[ignore = "writes the SDK's golden vectors; run with --ignored"]
fn generate_vectors() {
    silence_recorded_panics();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/test/vectors");
    fs::create_dir_all(&dir).unwrap();
    for v in [fixed(), price(), fees(), borrow(), funding(), position(), vault()] {
        println!("{:>9}: {} cases", v.module, v.cases.len());
        let body = format!(
            "{{\n\"module\": \"{}\",\n\"generated_by\": \"cargo test -p zap-math --test gen_vectors -- --ignored\",\n\"cases\": [\n{}\n]\n}}\n",
            v.module,
            v.cases.join(",\n")
        );
        fs::write(dir.join(format!("{}.json", v.module)), body).unwrap();
    }
}

fn fixed() -> Vectors {
    let (mut v, mut r) = Vectors::new("fixed");

    let big = [0, 1, 3, 1 << 64, 1 << 127, U128];
    for a in big {
        for b in big {
            for d in [0, 1, 3, 1 << 64, U128] {
                for round in ROUNDS {
                    case!(v, fixed::mul_div(a, b, d, round));
                }
            }
        }
    }
    for (a, b, d) in [
        (10, 10, 3),
        (9, 10, 3),
        (0, 5, 7),
        ((1 << 64) - 1, (1 << 64) + 1, 1), // product is exactly u128::MAX: the last one on the 128-bit path
        (1 << 64, 1 << 64, 2),             // 256-bit product, quotient fits
        (U128 / 3, 6, 3),
        (1 << 127, 3, 4),
        (U128 - 1, (1 << 127) + 1, 1 << 127), // floor is u128::MAX with a remainder, so only Up overflows
    ] {
        for round in ROUNDS {
            case!(v, fixed::mul_div(a, b, d, round));
        }
    }
    // Quotients on either side of 2^128: `a * b / edge` overflows, `a * b / (edge + 1)` fits.
    for _ in 0..25 {
        let (a, b) = (r.between(1 << 64, U128), r.between(1 << 64, U128));
        let edge = ((U256::from(a) * U256::from(b)) >> 128).low_u128();
        for d in [edge, edge + 1] {
            for round in ROUNDS {
                case!(v, fixed::mul_div(a, b, d, round));
            }
        }
    }
    for _ in 0..RANDOM {
        case!(v, fixed::mul_div(r.int(U128), r.int(U128), r.int(U128), r.round()));
    }

    for a in big {
        for b in [0, 1, 3, U128] {
            for d in [0, 1, 3, U128] {
                case!(v, fixed::mul_div_floor(a, b, d));
                case!(v, fixed::mul_div_ceil(a, b, d));
            }
        }
    }
    for _ in 0..RANDOM {
        case!(v, fixed::mul_div_floor(r.int(U128), r.int(U128), r.int(U128)));
    }
    for _ in 0..RANDOM {
        case!(v, fixed::mul_div_ceil(r.int(U128), r.int(U128), r.int(U128)));
    }

    for a in [i128::MIN, i128::MIN + 1, -(1 << 64), -10, -1, 0, 1, 10, 1 << 64, i128::MAX] {
        for b in [0, 1, 3, 10, U128] {
            for d in [0, 1, 3, U128] {
                for round in ROUNDS {
                    case!(v, fixed::mul_div_signed(a, b, d, round));
                }
            }
        }
    }
    // A magnitude of exactly 2^127 fits u128 but not i128, whatever the sign.
    for (a, b, d) in [(-(1 << 126), 2, 1), (1 << 126, 2, 1), (i128::MIN, 1, 2), (i128::MIN, 3, 3), (i128::MIN, 1, 3)] {
        for round in ROUNDS {
            case!(v, fixed::mul_div_signed(a, b, d, round));
        }
    }
    // Magnitudes on either side of 2^127.
    for _ in 0..25 {
        let a = r.between(1 << 64, I128) as i128;
        let a = if r.bool() { -a } else { a };
        let b = r.between(1 << 64, U128);
        let edge = ((U256::from(a.unsigned_abs()) * U256::from(b)) >> 127).low_u128();
        for d in [edge, edge + 1] {
            for round in ROUNDS {
                case!(v, fixed::mul_div_signed(a, b, d, round));
            }
        }
    }
    for _ in 0..RANDOM {
        case!(v, fixed::mul_div_signed(r.signed(I128), r.int(U128), r.int(U128), r.round()));
    }

    for x in [0, 1, U64 - 1, U64, U64 + 1, 1 << 127, U128] {
        case!(v, fixed::to_u64(x));
    }
    for _ in 0..RANDOM {
        case!(v, fixed::to_u64(r.int(U128)));
    }
    for x in [0, 1, I128 - 1, I128, I128 + 1, U128] {
        case!(v, fixed::to_i128(x));
    }
    for _ in 0..RANDOM {
        case!(v, fixed::to_i128(r.int(U128)));
    }
    v
}

fn price() -> Vectors {
    let (mut v, mut r) = Vectors::new("price");

    // Around every boundary: 10^|shift| overflowing u64 (|shift| >= 20), rounding to zero, and `12 + expo` overflowing i32.
    let expos = [
        i32::MIN,
        -1_000,
        -33,
        -32,
        -31,
        -20,
        -14,
        -13,
        -12,
        -11,
        -8,
        -5,
        0,
        5,
        7,
        8,
        9,
        100,
        i32::MAX - 12,
        i32::MAX - 11,
        i32::MAX,
    ];
    for mantissa in [i64::MIN, -1, 0, 1, 99, 123, 9_741_260_000_000, i64::MAX] {
        for expo in expos {
            case!(v, price::normalize_price(mantissa, expo));
        }
    }
    for _ in 0..RANDOM {
        if r.chance(50) {
            // what Pyth publishes: a realistic price as a mantissa with an exponent between -12 and -2
            let expo = r.below(11) as i32 - 12;
            let mantissa = (r.price() / 10u64.pow((12 + expo) as u32)).max(1) as i64;
            case!(v, price::normalize_price(mantissa, expo));
        } else {
            let mantissa = r.int(i64::MAX as u128) as i64;
            let mantissa = if r.chance(10) { -mantissa } else { mantissa };
            case!(v, price::normalize_price(mantissa, r.expo(&expos)));
        }
    }
    for conf in [0, 1, 99, 100, 101, 5_000_000, u64::MAX] {
        for expo in expos {
            case!(v, price::normalize_conf(conf, expo));
        }
    }
    for _ in 0..RANDOM {
        case!(v, price::normalize_conf(r.int(U64) as u64, r.expo(&expos)));
    }

    for price12 in [0, 1, PRICE_ONE, 100 * PRICE_ONE, u64::MAX] {
        for conf12 in [0, 1, PRICE_ONE / 50, u64::MAX] {
            for min_spread in [0, FRAC_PER_BPS / 2, U128] {
                for mult in [0, 1, 5_000, 10_000, u16::MAX] {
                    case!(v, price::spread_frac(price12, conf12, min_spread, mult));
                }
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let price12 = r.price();
            let conf12 = r.int(price12 as u128 / 50) as u64;
            case!(v, price::spread_frac(price12, conf12, r.int(50 * FRAC_PER_BPS), r.int(20_000) as u16));
        } else {
            case!(v, price::spread_frac(r.int(U64) as u64, r.int(U64) as u64, r.int(U128), r.int(U16) as u16));
        }
    }

    let t = 10_000 * USD_ONE as i128;
    let depth = 1_000_000 * USD_ONE;
    for (skew, delta, depth_usd, cap_bps) in [
        (0, t, depth, 100),
        (0, t, depth, 20),
        (0, t, depth, 0),
        (3 * t, -t, depth, 100),
        (-t, t + t / 2, depth, 100),
        (-t, -t, depth, 1_000),
        (5, 0, depth, 100),
        (5, t, 0, 100),
        (-(1 << 63), (1 << 64) + (1 << 62), u64::MAX, 100), // `2 * depth * |delta|` overflows u128
    ] {
        case!(v, price::impact_frac(skew, delta, depth_usd, cap_bps));
    }
    let skews = [i128::MIN, -(1 << 64), -(1 << 64) + 1, -t, -1, 0, 1, t, (1 << 64) - 1, 1 << 64, i128::MAX];
    for skew in skews {
        for delta in skews {
            for depth_usd in [1, 1_000_000_000_000, u64::MAX] {
                case!(v, price::impact_frac(skew, delta, depth_usd, u16::MAX));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let skew = r.signed(10_000_000_000 * USD_ONE as u128);
            let delta = r.signed(100_000_000 * USD_ONE as u128);
            let depth_usd = r.between(1_000 * USD_ONE as u128, 1_000_000_000 * USD_ONE as u128) as u64;
            case!(v, price::impact_frac(skew, delta, depth_usd, r.int(1_000) as u16));
        } else {
            case!(v, price::impact_frac(r.signed(1 << 66), r.signed(1 << 66), r.int(U64) as u64, r.int(U16) as u16));
        }
    }

    for price12 in [0, 1, 3 * PRICE_ONE + 1, u64::MAX] {
        for spread in [0, 1, FRAC_PER_BPS, FRAC_ONE - 1, FRAC_ONE, U128 - FRAC_ONE, U128 - FRAC_ONE + 1, U128] {
            for impact in [0, 1, U128] {
                for is_buy in BOOLS {
                    case!(v, price::fill_price(price12, spread, impact, is_buy));
                }
            }
        }
    }
    for _ in 0..RANDOM {
        let price12 = if r.chance(75) { r.price() } else { r.int(U64) as u64 };
        let (spread, impact) = match r.below(4) {
            0 | 1 => (r.int(100 * FRAC_PER_BPS), r.int(100 * FRAC_PER_BPS)),
            2 => {
                let spread = r.int(FRAC_ONE);
                (spread, r.int(FRAC_ONE - spread))
            }
            _ => (r.int(U128), r.int(U128)),
        };
        case!(v, price::fill_price(price12, spread, impact, r.bool()));
    }

    for size in [0, 1, 10 * USD_ONE, u64::MAX] {
        for price12 in [0, 1, 3 * PRICE_ONE, u64::MAX] {
            for is_long in BOOLS {
                case!(v, price::units_for(size, price12, is_long));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            case!(v, price::units_for(r.usd(), r.price(), r.bool()));
        } else {
            case!(v, price::units_for(r.int(U64) as u64, r.int(U64) as u64, r.bool()));
        }
    }

    for units in [0, 1, 3_333_333_333_333, 1 << 64, U128] {
        for price12 in [0, 1, 3 * PRICE_ONE, u64::MAX] {
            for round in ROUNDS {
                case!(v, price::value_of(units, price12, round));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let units = price::units_for(r.usd(), r.price(), r.bool()).unwrap();
            case!(v, price::value_of(units, r.price(), r.round()));
        } else {
            case!(v, price::value_of(r.int(U128), r.int(U64) as u64, r.round()));
        }
    }
    v
}

fn fees() -> Vectors {
    let (mut v, mut r) = Vectors::new("fees");

    for amount in [0, 1, 9_999, 10_000, 10_001, U64, U128] {
        for bps in [0, 1, 4, 9_999, 10_000, 10_001, u16::MAX] {
            for round in ROUNDS {
                case!(v, fees::bps_of(amount, bps, round));
            }
        }
    }
    for _ in 0..RANDOM {
        case!(v, fees::bps_of(r.int(U128), r.bps(), r.round()));
    }

    for size in [0, 1, 2_499, 2_500, 2_501, 1_000 * USD_ONE, u64::MAX] {
        for bps in [0, 1, 4, 10_000, 10_001, u16::MAX] {
            case!(v, fees::open_fee(size, bps));
        }
    }
    for _ in 0..RANDOM {
        let size = if r.chance(75) { r.usd() } else { r.int(U64) as u64 };
        case!(v, fees::open_fee(size, r.bps()));
    }

    for units in [0, 1, 10_000_000_000_000, 1 << 100, U128] {
        for exit in [0, 1, 200 * PRICE_ONE, u64::MAX] {
            for bps in [0, 5, 10_000, u16::MAX] {
                case!(v, fees::close_fee(units, exit, bps));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let units = price::units_for(r.usd(), r.price(), r.bool()).unwrap();
            case!(v, fees::close_fee(units, r.price(), r.bps()));
        } else {
            case!(v, fees::close_fee(r.int(U128), r.int(U64) as u64, r.bps()));
        }
    }
    v
}

fn borrow() -> Vectors {
    let (mut v, mut r) = Vectors::new("borrow");

    for reserved in [0, 1, 41, 100, 200, u64::MAX] {
        for assets in [0, 1, 3, 100, u64::MAX] {
            case!(v, borrow::utilization_bps(reserved, assets));
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let assets = r.usd();
            case!(v, borrow::utilization_bps(r.int(assets as u128 * 6 / 5) as u64, assets));
        } else {
            case!(v, borrow::utilization_bps(r.int(U64) as u64, r.int(U64) as u64));
        }
    }

    let curves = [
        (7_500, 3_000, 10_000),
        (0, 0, 0),       // kink at 0%
        (10_000, 1, 2),  // kink at 100%
        (5_000, 10, 5),  // max below kink APR
        (9_999, 0, 0),
        (1, 1, 1),
        (1, u32::MAX, u32::MAX),
        (9_999, u32::MAX, u32::MAX),
        (7_500, 0, u32::MAX),
        (u32::MAX, 0, 0),
    ];
    for util in [0, 1, 3_750, 7_499, 7_500, 7_501, 8_750, 9_999, 10_000, 12_000, u32::MAX] {
        for (kink_util, kink_apr, max_apr) in curves {
            case!(v, borrow::borrow_apr_bps(util, kink_util, kink_apr, max_apr));
        }
    }
    for _ in 0..RANDOM {
        let util = if r.chance(80) { r.int(12_000) as u32 } else { r.int(U32) as u32 };
        let kink_util = if r.chance(85) { r.between(1, 9_999) as u32 } else { r.int(U32) as u32 };
        let (kink_apr, max_apr) = if r.chance(80) {
            let kink_apr = r.int(20_000) as u32;
            (kink_apr, kink_apr + r.int(100_000) as u32)
        } else {
            (r.int(U32) as u32, r.int(U32) as u32)
        };
        case!(v, borrow::borrow_apr_bps(util, kink_util, kink_apr, max_apr));
    }

    for apr in [0, 1, 315, 10_000, u32::MAX] {
        case!(v, borrow::rate_per_sec(apr));
    }
    for _ in 0..RANDOM {
        let apr = if r.chance(75) { r.int(20_000) as u32 } else { r.int(U32) as u32 };
        case!(v, borrow::rate_per_sec(apr));
    }

    for index in [0, RATE_ONE, U128 - 1, U128] {
        for rate in [0, 1, 3_170_979_198, U128] {
            for dt in [0, 1, 31_536_000, u64::MAX] {
                case!(v, borrow::accrue(index, rate, dt));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let rate = borrow::rate_per_sec(r.int(20_000) as u32).unwrap();
            case!(v, borrow::accrue(r.int(10 * RATE_ONE), rate, r.int(100_000_000) as u64));
        } else {
            case!(v, borrow::accrue(r.int(U128), r.int(U128), r.int(U64) as u64));
        }
    }
    v
}

fn funding() -> Vectors {
    let (mut v, mut r) = Vectors::new("funding");

    let ois = [0, 1, 40, 60, 100, u64::MAX];
    for oi_long in ois {
        for oi_short in ois {
            for max_hourly in [0, RATE_ONE / 10_000, RATE_ONE, U128] {
                case!(v, funding::rate_per_sec(oi_long, oi_short, max_hourly));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            case!(v, funding::rate_per_sec(r.usd(), r.usd(), r.int(RATE_ONE / 100)));
        } else {
            case!(v, funding::rate_per_sec(r.int(U64) as u64, r.int(U64) as u64, r.int(U128)));
        }
    }

    let pairs = [
        (10, 10),
        (0, 0),
        (i128::MAX, i128::MIN),
        (i128::MIN, i128::MAX),
        (i128::MAX, i128::MAX),
        (i128::MIN, i128::MIN),
    ];
    for (index_long, index_short) in pairs {
        for rate in [i128::MIN, -7, -1, 0, 1, 7, i128::MAX] {
            for dt in [0, 1, 100, u64::MAX] {
                case!(v, funding::accrue(index_long, index_short, rate, dt));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let rate = funding::rate_per_sec(r.usd(), r.usd(), RATE_ONE / 10_000).unwrap();
            case!(v, funding::accrue(r.signed(100 * RATE_ONE), r.signed(100 * RATE_ONE), rate, r.int(10_000_000) as u64));
        } else {
            case!(v, funding::accrue(r.signed(I128), r.signed(I128), r.signed(I128), r.int(U64) as u64));
        }
    }
    v
}

fn position() -> Vectors {
    let (mut v, mut r) = Vectors::new("position");

    let pct = RATE_ONE as i128 / 100;
    let indices = [
        (0, 0),
        (1, 0),
        (-1, 0),
        (pct, 0),
        (0, pct),
        (i128::MAX, 0),
        (i128::MIN, 0),
        (i128::MIN, 1),
        (i128::MAX, -1),
        (-1, i128::MAX),
        (0, i128::MIN),
    ];
    // 1.5e18 turns a ~2^127 index delta into a magnitude that fits u128 but not i128.
    for size in [0, 1, USD_ONE, 1_000 * USD_ONE, 1_500_000_000_000_000_000, u64::MAX] {
        for (now, entry) in indices {
            case!(v, position::owed(size, now, entry));
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let entry = r.signed(10 * RATE_ONE);
            case!(v, position::owed(r.usd(), entry + r.signed(RATE_ONE / 10), entry));
        } else {
            case!(v, position::owed(r.int(U64) as u64, r.signed(I128), r.signed(I128)));
        }
    }

    for side in SIDES {
        for size in [0, 1, 1_000 * USD_ONE, u64::MAX] {
            for units in [0, 1, 10_000_000_000_000, 1 << 127, U128] {
                for exit in [0, 1, 100 * PRICE_ONE, RATE_ONE as u64, u64::MAX] {
                    case!(v, position::pnl(side, size, units, exit));
                }
            }
        }
    }
    for side in SIDES {
        let size = 1_000 * USD_ONE;
        let units = price::units_for(size, 100 * PRICE_ONE, side.is_long()).unwrap();
        for exit in [90 * PRICE_ONE, 100 * PRICE_ONE, 110 * PRICE_ONE, 500 * PRICE_ONE] {
            case!(v, position::pnl(side, size, units, exit));
        }
    }
    for _ in 0..RANDOM {
        let side = r.side();
        if r.chance(75) {
            let (size, entry) = (r.usd(), r.price());
            let units = price::units_for(size, entry, side.is_long()).unwrap();
            // exit within ±50% of entry
            let exit = price::fill_price(entry, r.int(FRAC_ONE / 2), 0, r.bool()).unwrap_or(entry);
            case!(v, position::pnl(side, size, units, exit));
        } else {
            case!(v, position::pnl(side, r.int(U64) as u64, r.int(U128), r.int(U64) as u64));
        }
    }

    for size in [0, 1, 10_000 * USD_ONE, u64::MAX] {
        for mmr in [0, 1, 50, 10_000, 10_001, u16::MAX] {
            case!(v, position::maintenance_margin(size, mmr));
        }
    }
    for _ in 0..RANDOM {
        let size = if r.chance(75) { r.usd() } else { r.int(U64) as u64 };
        case!(v, position::maintenance_margin(size, r.bps()));
    }

    let extremes = [i128::MIN, -1, 0, 1, i128::MAX];
    for collateral in [0, 1, u64::MAX] {
        for pnl in extremes {
            for owed in extremes {
                for close_fee in [0, 1, u64::MAX] {
                    case!(v, position::equity(collateral, pnl, owed, close_fee));
                }
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let pnl = r.signed(10_000_000 * USD_ONE as u128);
            let owed = r.signed(100_000 * USD_ONE as u128);
            case!(v, position::equity(r.usd(), pnl, owed, r.int(10_000 * USD_ONE as u128) as u64));
        } else {
            case!(v, position::equity(r.int(U64) as u64, r.signed(I128), r.signed(I128), r.int(U64) as u64));
        }
    }

    for equity in [i128::MIN, -1, 0, 49_999_999, 50_000_000, 50_000_001, i128::MAX] {
        for (size, mmr) in [(10_000 * USD_ONE, 50), (0, 0), (u64::MAX, 10_000), (u64::MAX, 10_001), (u64::MAX, u16::MAX)] {
            case!(v, position::is_liquidatable(equity, size, mmr));
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let (size, mmr) = (r.usd(), r.int(500) as u16);
            let mm = position::maintenance_margin(size, mmr).unwrap() as i128;
            let equity = if r.bool() { mm + r.below(5) as i128 - 2 } else { r.signed(size as u128) };
            case!(v, position::is_liquidatable(equity, size, mmr));
        } else {
            case!(v, position::is_liquidatable(r.signed(I128), r.int(U64) as u64, r.int(U16) as u16));
        }
    }

    for size in [0, 1, 10_000 * USD_ONE, 10_000 * USD_ONE + 1, u64::MAX] {
        for collateral in [0, 1, 100 * USD_ONE, u64::MAX] {
            for max_leverage in [0, 1, 100, u16::MAX] {
                case!(v, position::leverage_ok(size, collateral, max_leverage));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let (collateral, max_leverage) = (r.usd(), r.between(1, 200) as u16);
            let edge = collateral as u128 * max_leverage as u128;
            let size = if r.bool() { (edge + r.below(3) as u128).saturating_sub(1) } else { r.int(U64) };
            case!(v, position::leverage_ok(size.min(U64) as u64, collateral, max_leverage));
        } else {
            case!(v, position::leverage_ok(r.int(U64) as u64, r.int(U64) as u64, r.int(U16) as u16));
        }
    }

    let splits = [
        (10_000 * USD_ONE, 20, 5_000),
        (0, 20, 5_000),
        (10_000 * USD_ONE, 0, 5_000),
        (10_000 * USD_ONE, 20, 0),
        (10_000 * USD_ONE, 20, 10_000),
        (10_000 * USD_ONE, 20, 10_001), // liquidator share above 100%: `fee - liq_part` underflows
        (1, 1, 10_001),                 // ...unless rounding keeps the liquidator's part equal to the fee
        (u64::MAX, 10_000, 10_000),
        (u64::MAX, 10_001, 5_000),
        (u64::MAX, 10_000, u16::MAX),
    ];
    let usd = USD_ONE as i128;
    for remaining in [i128::MIN, -5, 0, 1, 15 * usd, 50 * usd, U64 as i128, U64 as i128 + 1, i128::MAX] {
        for (size, liq_fee_bps, share_bps) in splits {
            case!(v, position::liquidation_split(remaining, size, liq_fee_bps, share_bps));
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let (size, liq_fee_bps) = (r.usd(), r.int(100) as u16);
            let fee = size as u128 * liq_fee_bps as u128 / 10_000;
            case!(v, position::liquidation_split(r.signed(3 * fee + 10), size, liq_fee_bps, r.int(10_000) as u16));
        } else {
            let share_bps = if r.chance(70) { r.int(10_000) } else { r.int(U16) } as u16;
            case!(v, position::liquidation_split(r.signed(I128), r.int(U64) as u64, r.int(U16) as u16, share_bps));
        }
    }
    v
}

fn vault() -> Vectors {
    let (mut v, mut r) = Vectors::new("vault");

    for side in SIDES {
        for oi in [0, 1, u64::MAX] {
            for units in [0, 1, 1 << 127, U128] {
                for price12 in [0, 1, 104 * PRICE_ONE + 3, RATE_ONE as u64, u64::MAX] {
                    case!(v, vault::side_upnl(side, oi, units, price12));
                }
            }
        }
    }
    for _ in 0..RANDOM {
        let side = r.side();
        if r.chance(75) {
            let oi = r.usd();
            let units = price::units_for(oi, r.price(), side.is_long()).unwrap();
            case!(v, vault::side_upnl(side, oi, units, r.price()));
        } else {
            case!(v, vault::side_upnl(side, r.int(U64) as u64, r.int(U128), r.int(U64) as u64));
        }
    }

    for index_now in [i128::MIN, -1, 0, 1, RATE_ONE as i128 / 50, i128::MAX] {
        for total_size in [0, 1, 1_400 * USD_ONE, u64::MAX] {
            for sum in [i128::MIN, -1, 0, 1, i128::MAX] {
                case!(v, vault::aggregate_owed(index_now, total_size, sum));
            }
        }
    }
    // 2% on $1,000 entered at 0 plus 1% on $400 entered at 1% = $24
    case!(v, vault::aggregate_owed(RATE_ONE as i128 / 50, 1_400 * USD_ONE, 400 * USD_ONE as i128 * (RATE_ONE as i128 / 100)));
    for _ in 0..RANDOM {
        if r.chance(75) {
            let (total_size, index_now) = (r.usd(), r.signed(10 * RATE_ONE));
            let sum = total_size as i128 * (index_now - r.signed(RATE_ONE / 10));
            case!(v, vault::aggregate_owed(index_now, total_size, sum));
        } else {
            case!(v, vault::aggregate_owed(r.signed(I128), r.int(U64) as u64, r.signed(I128)));
        }
    }

    // Supplies and NAVs where adding the virtual amount stops fitting u128.
    let supplies = [0, 1, 5_000_000 * USD_ONE as u128, U128 - VIRTUAL_SHARES, U128 - VIRTUAL_SHARES + 1, U128];
    let navs = [0, 1, 5_210_000 * USD_ONE as u128, U128 - VIRTUAL_ASSETS, U128 - VIRTUAL_ASSETS + 1, U128];
    for amount in [0, 1, 1_000 * USD_ONE, u64::MAX] {
        for supply in supplies {
            for nav in navs {
                case!(v, vault::shares_for_deposit(amount, supply, nav));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let nav = r.int(100_000_000 * USD_ONE as u128);
            let supply = nav * r.between(900, 1_100) / 1_000;
            case!(v, vault::shares_for_deposit(r.usd(), supply, nav));
        } else {
            case!(v, vault::shares_for_deposit(r.int(U64) as u64, r.int(U128), r.int(U128)));
        }
    }
    for shares in [0, 1, 1_000_000_000, U128] {
        for supply in supplies {
            for nav in navs {
                case!(v, vault::assets_for_shares(shares, supply, nav));
            }
        }
    }
    for _ in 0..RANDOM {
        if r.chance(75) {
            let nav = r.int(100_000_000 * USD_ONE as u128);
            let supply = nav * r.between(900, 1_100) / 1_000;
            case!(v, vault::assets_for_shares(r.int(supply), supply, nav));
        } else {
            case!(v, vault::assets_for_shares(r.int(U128), r.int(U128), r.int(U128)));
        }
    }
    v
}

// ---------------------------------------------------------------------------------------------------------------------------
// Recording

struct Vectors {
    module: &'static str,
    cases: Vec<String>,
}

impl Vectors {
    fn new(module: &'static str) -> (Vectors, Rng) {
        (Vectors { module, cases: Vec::new() }, Rng::new(module))
    }

    fn record<R: Outcome>(&mut self, f: &str, args: String, call: impl FnOnce() -> R) {
        EXPECTING_PANIC.with(|p| p.set(true));
        let result = panic::catch_unwind(AssertUnwindSafe(call));
        EXPECTING_PANIC.with(|p| p.set(false));
        let outcome = match result {
            Ok(r) => r.encode(),
            Err(payload) => {
                let msg = payload
                    .downcast_ref::<&str>()
                    .map(|s| s.to_string())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_default();
                assert!(msg.starts_with("attempt to ") && msg.ends_with(" with overflow"), "{f}({args}) panicked: {msg}");
                format!("\"err\":\"Overflow\",\"panic\":\"{msg}\"")
            }
        };
        self.cases.push(format!("{{\"fn\":\"{f}\",\"args\":[{args}],{outcome}}}"));
    }
}

/// `case!(vectors, module::function(args..))` evaluates each argument once and records the call under the function's name.
macro_rules! case {
    ($v:expr, $module:ident :: $f:ident ( $($a:expr),+ $(,)? )) => {{
        let args = ($($a,)+);
        let json = ArgList::json(&args);
        $v.record(stringify!($f), json, move || Apply::apply(args, $module::$f));
    }};
}
use case;

thread_local! {
    static EXPECTING_PANIC: Cell<bool> = const { Cell::new(false) };
}

/// Keeps the default panic output for real failures but silences the overflow panics that `record` catches.
fn silence_recorded_panics() {
    let default = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        if !EXPECTING_PANIC.with(Cell::get) {
            default(info);
        }
    }));
}

/// A value as JSON: integers as decimal strings, enums by variant name, structs by Rust field name.
trait Json {
    fn json(&self) -> String;
}

macro_rules! json_int {
    ($($t:ty),*) => {$(
        impl Json for $t {
            fn json(&self) -> String {
                format!("\"{self}\"")
            }
        }
    )*};
}
json_int!(u16, u32, u64, u128, i32, i64, i128);

impl Json for bool {
    fn json(&self) -> String {
        self.to_string()
    }
}

impl Json for Round {
    fn json(&self) -> String {
        format!("\"{self:?}\"")
    }
}

impl Json for Side {
    fn json(&self) -> String {
        format!("\"{self:?}\"")
    }
}

impl Json for (i128, i128) {
    fn json(&self) -> String {
        format!("[{},{}]", self.0.json(), self.1.json())
    }
}

impl Json for LiquidationSplit {
    fn json(&self) -> String {
        format!(
            "{{\"to_liquidator\":{},\"to_vault_fee\":{},\"to_trader\":{}}}",
            self.to_liquidator.json(),
            self.to_vault_fee.json(),
            self.to_trader.json()
        )
    }
}

/// The `"ok"`/`"err"` tail of a case.
trait Outcome {
    fn encode(self) -> String;
}

impl<T: Json> Outcome for Result<T, MathError> {
    fn encode(self) -> String {
        match self {
            Ok(v) => format!("\"ok\":{}", v.json()),
            Err(e) => format!("\"err\":\"{e:?}\""),
        }
    }
}

/// `leverage_ok` is the one function that cannot fail.
impl Outcome for bool {
    fn encode(self) -> String {
        format!("\"ok\":{self}")
    }
}

trait ArgList {
    fn json(&self) -> String;
}

trait Apply<F, R> {
    fn apply(self, f: F) -> R;
}

macro_rules! tuple_args {
    ($($n:tt $t:ident),+) => {
        impl<$($t: Json),+> ArgList for ($($t,)+) {
            fn json(&self) -> String {
                [$(self.$n.json()),+].join(",")
            }
        }

        impl<$($t,)+ R, F: FnOnce($($t),+) -> R> Apply<F, R> for ($($t,)+) {
            fn apply(self, f: F) -> R {
                f($(self.$n),+)
            }
        }
    };
}
tuple_args!(0 A);
tuple_args!(0 A, 1 B);
tuple_args!(0 A, 1 B, 2 C);
tuple_args!(0 A, 1 B, 2 C, 3 D);

// ---------------------------------------------------------------------------------------------------------------------------
// Inputs

/// xorshift64, seeded per module so each file's cases don't depend on the others'.
struct Rng(u64);

impl Rng {
    fn new(module: &str) -> Rng {
        // FNV-1a of the module name
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in module.bytes() {
            h = (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3);
        }
        Rng(h | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    fn bool(&mut self) -> bool {
        self.next() & 1 == 1
    }

    fn round(&mut self) -> Round {
        if self.bool() {
            Round::Up
        } else {
            Round::Down
        }
    }

    fn side(&mut self) -> Side {
        if self.bool() {
            Side::Long
        } else {
            Side::Short
        }
    }

    /// A value in `0..=max` with a log-uniform bit length, plus extra weight on both ends of the range.
    fn int(&mut self, max: u128) -> u128 {
        match self.below(10) {
            0 => (self.below(10) as u128).min(max),
            1 => max - (self.below(10) as u128).min(max),
            _ => {
                let bits = self.below((128 - max.leading_zeros()) as u64 + 1) as u32;
                if bits == 0 {
                    return 0;
                }
                let x = ((self.next() as u128) << 64 | self.next() as u128) >> (128 - bits);
                x.min(max)
            }
        }
    }

    fn between(&mut self, lo: u128, hi: u128) -> u128 {
        lo + self.int(hi - lo)
    }

    /// Magnitude up to `max` (at most `i128::MAX`) with a random sign.
    fn signed(&mut self, max: u128) -> i128 {
        let m = self.int(max.min(I128)) as i128;
        if self.bool() {
            -m
        } else {
            m
        }
    }

    /// A realistic USD amount: up to $10M.
    fn usd(&mut self) -> u64 {
        self.int(10_000_000 * USD_ONE as u128) as u64
    }

    /// A realistic 12-decimal price: $0.000000001 to $1M.
    fn price(&mut self) -> u64 {
        self.between(1_000, 1_000_000 * PRICE_ONE as u128) as u64
    }

    /// Mostly fee-sized basis points, sometimes any `u16`.
    fn bps(&mut self) -> u16 {
        (if self.chance(75) { self.int(100) } else { self.int(U16) }) as u16
    }

    /// Mostly Pyth-like exponents, sometimes wider or extreme.
    fn expo(&mut self, extremes: &[i32]) -> i32 {
        match self.below(10) {
            0 => extremes[self.below(extremes.len() as u64) as usize],
            1 | 2 => self.below(81) as i32 - 40,
            _ => self.below(29) as i32 - 20,
        }
    }
}
