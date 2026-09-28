import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  FRAC_ONE,
  FRAC_PER_BPS,
  MathError,
  PRICE_ONE,
  RATE_ONE,
  SECONDS_PER_YEAR,
  U128_MAX,
  U64_MAX,
  USD_ONE,
  accrueBorrow,
  accrueFunding,
  aggregateOwed,
  assetsForShares,
  borrowAprBps,
  borrowRatePerSec,
  bpsOf,
  closeFee,
  equity,
  fillPrice,
  fundingRatePerSec,
  impactFrac,
  isLiquidatable,
  leverageOk,
  liquidationSplit,
  maintenanceMargin,
  mulDiv,
  mulDivCeil,
  mulDivFloor,
  mulDivSigned,
  normalizeConf,
  normalizePrice,
  openFee,
  owed,
  pnl,
  sharesForDeposit,
  sideUpnl,
  spreadFrac,
  toI128,
  toU64,
  unitsFor,
  utilizationBps,
  valueOf,
} from '../src/math';
import type { MathErrorKind, Round, Side } from '../src/math';

// Golden vectors: `cargo test -p zap-math --test gen_vectors -- --ignored` writes one file per Rust module.

type Json = string | boolean | readonly Json[] | { readonly [key: string]: Json };

interface Case {
  fn: string;
  args: Json[];
  ok?: Json;
  err?: MathErrorKind;
  /** Rust panicked (arithmetic overflow, which aborts the transaction); `err` is then `Overflow`. */
  panic?: string;
}

interface VectorFile {
  module: string;
  cases: Case[];
}

type Kind = 'int' | 'side' | 'round' | 'bool';
type Decoded<K> = K extends 'int' ? bigint : K extends 'side' ? Side : K extends 'round' ? Round : boolean;
type Params<Ks extends readonly Kind[]> = { -readonly [I in keyof Ks]: Decoded<Ks[I]> };

type Runner = (args: readonly Json[]) => Json;

/** Binds a port function to the JSON shape of its Rust arguments; tsc checks the kinds against the function's parameters. */
function sig<const Ks extends readonly Kind[]>(kinds: Ks, f: (...args: Params<Ks>) => unknown): Runner {
  return (args) => {
    if (args.length !== kinds.length) throw new Error(`expected ${kinds.length} arguments, got ${args.length}`);
    const decoded = kinds.map((kind, i) => decode(kind, args[i]));
    return encode(f(...(decoded as Params<Ks>)));
  };
}

function decode(kind: Kind, v: Json | undefined): bigint | boolean | string {
  switch (kind) {
    case 'int':
      if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
      break;
    case 'side':
      if (v === 'Long' || v === 'Short') return v;
      break;
    case 'round':
      if (v === 'Down' || v === 'Up') return v;
      break;
    case 'bool':
      if (typeof v === 'boolean') return v;
      break;
  }
  throw new Error(`bad ${kind} argument: ${JSON.stringify(v)}`);
}

/** Result in the vectors' encoding: integers as decimal strings, struct fields by their Rust (snake_case) names. */
function encode(v: unknown): Json {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v).map(([key, x]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), encode(x)]),
    );
  }
  throw new Error(`unexpected result: ${String(v)}`);
}

const runners: Record<string, Record<string, Runner>> = {
  fixed: {
    mul_div: sig(['int', 'int', 'int', 'round'], mulDiv),
    mul_div_floor: sig(['int', 'int', 'int'], mulDivFloor),
    mul_div_ceil: sig(['int', 'int', 'int'], mulDivCeil),
    mul_div_signed: sig(['int', 'int', 'int', 'round'], mulDivSigned),
    to_u64: sig(['int'], toU64),
    to_i128: sig(['int'], toI128),
  },
  price: {
    normalize_price: sig(['int', 'int'], normalizePrice),
    normalize_conf: sig(['int', 'int'], normalizeConf),
    spread_frac: sig(['int', 'int', 'int', 'int'], spreadFrac),
    impact_frac: sig(['int', 'int', 'int', 'int'], impactFrac),
    fill_price: sig(['int', 'int', 'int', 'bool'], fillPrice),
    units_for: sig(['int', 'int', 'bool'], unitsFor),
    value_of: sig(['int', 'int', 'round'], valueOf),
  },
  fees: {
    bps_of: sig(['int', 'int', 'round'], bpsOf),
    open_fee: sig(['int', 'int'], openFee),
    close_fee: sig(['int', 'int', 'int'], closeFee),
  },
  borrow: {
    utilization_bps: sig(['int', 'int'], utilizationBps),
    borrow_apr_bps: sig(['int', 'int', 'int', 'int'], borrowAprBps),
    rate_per_sec: sig(['int'], borrowRatePerSec),
    accrue: sig(['int', 'int', 'int'], accrueBorrow),
  },
  funding: {
    rate_per_sec: sig(['int', 'int', 'int'], fundingRatePerSec),
    accrue: sig(['int', 'int', 'int', 'int'], accrueFunding),
  },
  position: {
    owed: sig(['int', 'int', 'int'], owed),
    pnl: sig(['side', 'int', 'int', 'int'], pnl),
    maintenance_margin: sig(['int', 'int'], maintenanceMargin),
    equity: sig(['int', 'int', 'int', 'int'], equity),
    is_liquidatable: sig(['int', 'int', 'int'], isLiquidatable),
    leverage_ok: sig(['int', 'int', 'int'], leverageOk),
    liquidation_split: sig(['int', 'int', 'int', 'int'], liquidationSplit),
  },
  vault: {
    side_upnl: sig(['side', 'int', 'int', 'int'], sideUpnl),
    aggregate_owed: sig(['int', 'int', 'int'], aggregateOwed),
    shares_for_deposit: sig(['int', 'int', 'int'], sharesForDeposit),
    assets_for_shares: sig(['int', 'int', 'int'], assetsForShares),
  },
};

type Outcome = { ok: Json } | { err: MathErrorKind };

function outcome(run: () => Json): Outcome {
  try {
    return { ok: run() };
  } catch (e) {
    if (e instanceof MathError) return { err: e.kind };
    throw e;
  }
}

function expected(c: Case): Outcome {
  if (c.err !== undefined) return { err: c.err };
  if (c.ok !== undefined) return { ok: c.ok };
  throw new Error(`case has neither ok nor err: ${JSON.stringify(c)}`);
}

const vectorDir = new URL('./vectors/', import.meta.url);
const vectorFiles = readdirSync(vectorDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('golden vectors from crates/zap-math', () => {
  it('exist for every module', () => {
    expect(vectorFiles).toEqual(Object.keys(runners).map((m) => `${m}.json`).sort());
  });

  for (const file of vectorFiles) {
    const { module, cases } = JSON.parse(readFileSync(new URL(file, vectorDir), 'utf8')) as VectorFile;
    const table = runners[module] ?? {};

    describe(module, () => {
      it('cover every function of the module', () => {
        expect([...new Set(cases.map((c) => c.fn))].sort()).toEqual(Object.keys(table).sort());
      });

      for (const [fn, run] of Object.entries(table)) {
        const mine = cases.filter((c) => c.fn === fn);
        it(`${fn}: ${mine.length} cases match bit for bit`, () => {
          expect(mine.length).toBeGreaterThan(0);
          for (const c of mine) {
            expect(outcome(() => run(c.args)), JSON.stringify(c)).toEqual(expected(c));
          }
        });
      }
    });
  }
});

function errorKind(f: () => unknown): MathErrorKind | undefined {
  try {
    f();
  } catch (e) {
    if (e instanceof MathError) return e.kind;
    throw e;
  }
  return undefined;
}

describe('math', () => {
  it('never profits from a round trip at the same price', () => {
    for (const price of [1n, 7n, 3n * PRICE_ONE + 1n, 97_412n * PRICE_ONE + 6n]) {
      for (const size of [10n * USD_ONE, 12_345_678n, 1_000_000n * USD_ONE]) {
        expect(pnl('Long', size, unitsFor(size, price, true), price)).toBeLessThanOrEqual(0n);
        expect(pnl('Short', size, unitsFor(size, price, false), price)).toBeLessThanOrEqual(0n);
      }
    }
  });

  it('rounds fees up', () => {
    expect(openFee(1_000n * USD_ONE, 4n)).toBe(400_000n); // 4bp on $1,000 = $0.40
    expect(openFee(1n, 4n)).toBe(1n); // 4bp on $0.000001 still charges one unit
    const units = unitsFor(1_000n * USD_ONE, 100n * PRICE_ONE, true);
    expect(closeFee(units, 200n * PRICE_ONE, 5n)).toBe(1_000_000n); // price doubled: 5bp on $2,000 = $1.00
  });

  it('rounds signed results toward -inf (Down) or +inf (Up)', () => {
    expect(mulDivSigned(-10n, 10n, 3n, 'Down')).toBe(-34n);
    expect(mulDivSigned(-10n, 10n, 3n, 'Up')).toBe(-33n);
    expect(mulDivSigned(10n, 10n, 3n, 'Down')).toBe(33n);
    expect(mulDivSigned(10n, 10n, 3n, 'Up')).toBe(34n);
    // owed rounds up; received rounds toward zero
    expect(owed(USD_ONE, 1n, 0n)).toBe(1n);
    expect(owed(USD_ONE, -1n, 0n)).toBe(0n);
  });

  it('pays the liquidator first, then the vault, then the trader', () => {
    const size = 10_000n * USD_ONE; // fee 0.2% = $20, liquidator half = $10
    expect(liquidationSplit(50n * USD_ONE, size, 20n, 5_000n)).toEqual({
      toLiquidator: 10n * USD_ONE,
      toVaultFee: 10n * USD_ONE,
      toTrader: 30n * USD_ONE,
    });
    expect(liquidationSplit(15n * USD_ONE, size, 20n, 5_000n)).toEqual({
      toLiquidator: 10n * USD_ONE,
      toVaultFee: 5n * USD_ONE,
      toTrader: 0n,
    });
    expect(liquidationSplit(-5n, size, 20n, 5_000n)).toEqual({ toLiquidator: 0n, toVaultFee: 0n, toTrader: 0n });
  });

  it('never profits from an LP deposit and immediate withdrawal', () => {
    const [supply, nav] = [5_000_000n * USD_ONE, 5_210_000n * USD_ONE];
    for (const amount of [1n, 999n, 10n * USD_ONE, 123_456_789n]) {
      const shares = sharesForDeposit(amount, supply, nav);
      expect(assetsForShares(shares, supply + shares, nav + amount)).toBeLessThanOrEqual(amount);
    }
    expect(sharesForDeposit(1_000n * USD_ONE, 0n, 0n)).toBe(1_000n * USD_ONE); // first deposit is 1:1
  });

  it('throws MathError with the Rust variant, including where Rust panics on overflow', () => {
    expect(() => mulDiv(1n, 1n, 0n, 'Down')).toThrow(MathError);
    expect(errorKind(() => mulDiv(1n, 1n, 0n, 'Down'))).toBe('DivByZero');
    expect(errorKind(() => mulDiv(U128_MAX, 2n, 1n, 'Down'))).toBe('Overflow');
    expect(errorKind(() => normalizePrice(0n, -8n))).toBe('InvalidPrice');
    expect(errorKind(() => fillPrice(PRICE_ONE, FRAC_ONE, 0n, false))).toBe('InvalidInput');
    // `FRAC_ONE + adj` overflows u128 on a buy: a panic in Rust, an Overflow here
    expect(errorKind(() => fillPrice(PRICE_ONE, U128_MAX - FRAC_ONE + 1n, 0n, true))).toBe('Overflow');
  });

  it('rejects arguments outside their Rust integer type', () => {
    expect(errorKind(() => openFee(-1n, 4n))).toBe('InvalidInput');
    expect(errorKind(() => openFee(U64_MAX + 1n, 4n))).toBe('InvalidInput');
    expect(errorKind(() => openFee(1n, 65_536n))).toBe('InvalidInput');
    expect(errorKind(() => mulDiv(U128_MAX + 1n, 1n, 1n, 'Down'))).toBe('InvalidInput');
    expect(errorKind(() => mulDiv(1n, 1n, 1n, 'up' as string as Round))).toBe('InvalidInput');
    expect(errorKind(() => mulDivSigned(-1n, 1n, 1n, 'up' as string as Round))).toBe('InvalidInput');
    expect(errorKind(() => pnl('long' as string as Side, 1n, 1n, 1n))).toBe('InvalidInput');
    expect(errorKind(() => toU64(1 as unknown as bigint))).toBe('InvalidInput');
  });

  it('matches the landmarks of the Rust unit tests', () => {
    expect(normalizePrice(9_741_260_000_000n, -8n)).toBe(97_412_600_000_000_000n); // BTC $97,412.60 at expo -8
    expect(spreadFrac(100n * PRICE_ONE, PRICE_ONE / 50n, FRAC_PER_BPS, 10_000n)).toBe(2n * FRAC_PER_BPS); // conf 0.02 on 100
    expect(impactFrac(0n, 10_000n * USD_ONE, 1_000_000n * USD_ONE, 100n)).toBe(50n * FRAC_PER_BPS); // $10k into $1M depth
    expect(borrowAprBps(8_750n, 7_500n, 3_000n, 10_000n)).toBe(6_500n); // halfway up the steep leg
    expect(accrueBorrow(0n, borrowRatePerSec(10_000n), SECONDS_PER_YEAR)).toBeGreaterThanOrEqual(RATE_ONE);
    expect(fundingRatePerSec(40n, 60n, RATE_ONE / 10_000n)).toBe(-(RATE_ONE / 10_000n / 5n / 3_600n)); // shorts pay
    expect(accrueFunding(10n, 10n, 7n, 100n)).toEqual([710n, -690n]);
    expect(isLiquidatable(maintenanceMargin(10_000n * USD_ONE, 50n), 10_000n * USD_ONE, 50n)).toBe(true);
    expect(isLiquidatable(50n * USD_ONE + 1n, 10_000n * USD_ONE, 50n)).toBe(false);
    expect(leverageOk(10_000n * USD_ONE + 1n, 100n * USD_ONE, 100n)).toBe(false);
    expect(aggregateOwed(RATE_ONE / 50n, 1_400n * USD_ONE, 400n * USD_ONE * (RATE_ONE / 100n))).toBe(24n * USD_ONE);
  });
});
