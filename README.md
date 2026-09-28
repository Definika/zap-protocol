# ZAP Protocol

Perpetual futures on Solana with the feel of a centralized exchange. You log in with Google, an email code or a Solana wallet, then
trade with no wallet pop-ups and no gas. Everything settles on-chain.

- **Model:** one USDC liquidity vault is the counterparty to every trade. Each fill is priced from a signed Pyth Pro price, and
  the program verifies that signature inside the same transaction.
- **Status:** built for the Solana Foundation *Perps and Prediction Markets* hackathon (October 2026). It targets **devnet**,
  with test USDC from a built-in faucet.

## What works today

| | |
|---|---|
| **Markets** | 15 perpetuals: BTC and ETH up to 100×; SOL, XRP, BNB, DOGE, SUI, LINK and AVAX up to 50×; HYPE, JUP, JTO, PYTH, PUMP and PENGU up to 20× |
| **Orders** | Market (single-transaction fill), limit, stop, take-profit/stop-loss (including multi-level take profit), reduce-only, post-only, IOC |
| **Positions** | Isolated margin in hedge mode (a long and a short on the same market), add/remove collateral, partial close, reverse |
| **Keeper** | Executes triggers, TP/SL and liquidations, and refreshes idle markets. Anyone can run one: the instructions are permissionless |
| **Gasless** | A relayer pays every network fee and account rent. Trades are signed by a session key that lives only in the browser, can trade, and can never withdraw |
| **Onboarding** | "Enable trading" takes one signature: test USDC from the faucet, a trading account with a 7-day session key, and a deposit |
| **Vault** | Deposit and withdraw at NAV (realized assets + fees owed − traders' unrealized PnL). Fees go 100% to LPs (the protocol share is an admin setting, 0 by default) |
| **App** | Chart from oracle candles; order book and depth drawn from the program's own quote function; positions, orders, history, funding; portfolio and equity history; vault earnings; leaderboard; price alerts |
| **API / SDK** | Public REST + WebSocket API and a TypeScript SDK with a bit-exact port of the on-chain math |

## How it works

```
 browser ──(REST/WS: prices, account, history)──▶ engine ──▶ Postgres (fills, candles, snapshots)
    │                                              │  ├ oracle: Pyth Pro stream (dev oracle until the key is live)
    │ session-key-signed v0 tx                     │  ├ mirror: every ZAP account, pushed to clients
    └──────────────▶ relayer (fee payer) ──────────┤  ├ keeper: triggers, liquidations, refresh
                                                   │  └ indexer: events → fills, candles, leaderboard
                                    Solana ◀───────┘
                     ed25519 verify + ZAP program (Anchor 1.2)
```

- **Oracle.** Every price-dependent instruction carries a Pyth Pro signed message. The instruction just before it is the
  ed25519 precompile, and it points into ZAP's own instruction data, so the message is carried only once. The program re-reads its
  own instruction to reject CPI tricks, then checks four things:
  - the signer against Pyth's on-chain storage account;
  - freshness: at most 5 s old and at most 5 s in the future;
  - the channel: the 200 ms feed;
  - monotonic timestamps per market, per position and per order, so traders can't pick an old price.
- **Pricing.**
  - **Spread:** `max(min spread, oracle confidence)`.
  - **Impact:** quadratic, charged only when a trade grows the long/short skew, and capped. Splitting a trade into pieces never
    makes it cheaper.
  - **Borrow fee:** a kinked APR on vault utilization, 0 → 30% at 75% → 100%.
  - **Funding:** the crowded side pays the light side, accrued every second.
  - **Rounding:** every rounding goes against the trader or the withdrawing LP.
- **Math.** `crates/zap-math` is shared by the program and a golden-tested BigInt port in the SDK, so the keeper, the app and the
  program agree to the last unit.

## Repository layout

| Path | What it is |
|---|---|
| `crates/zap-math` | Fixed-point math shared by the program and the SDK: fills, fees, funding, borrow, PnL, liquidation, vault NAV |
| `programs/zap` | Anchor program: state, Pyth Pro verification, trading, orders, keeper instructions, LP vault. LiteSVM tests |
| `packages/sdk` | TypeScript SDK: account decoders, exact math port, quotes, transaction builders, Pyth Pro message tools |
| `services/engine` | Backend: oracle stream, state mirror, keeper, indexer, REST/WS API, gasless relayer, faucet, snapshots |
| `app` | Web app (Vite + React). `src/design/generated` is the design, converted to React; `src/terminal` wires it to ZAP |
| `scripts` | Setup, smoke tests and the headless browser end-to-end test |
| `config/markets.json` | Markets, risk tiers and display metadata (the source for the program listing, SDK and app) |

## Run it locally

Requirements: Rust (the toolchain is pinned in `rust-toolchain.toml`), Solana CLI, Anchor CLI 1.2 and Node 22+. The keypairs
(admin, relayer, keeper, faucet, dev oracle) are read from `~/.config/solana/zap/` and never committed.

```bash
npm ci
npm run build:program                  # anchor build --arch v0: the binary the tests run is the one we deploy
solana-test-validator --reset --bpf-program H7YEstzQnFYuAkSXgPLe1YrL5WoUvgvo4cyndrQsgcwi target/deploy/zap.so
node scripts/setup.ts                  # test USDC mint, config, 15 markets, lookup table, 5M vault seed
npm run dev:engine                     # engine on :8787 (embedded Postgres, dev oracle)
npm run dev:app                        # app on :5173; without a Privy app ID, dev builds log in with a local test wallet
```

Tests:

```bash
cargo test -p zap-math && cargo test -p zap   # math and program (LiteSVM with the ed25519 precompile, real Pyth vector)
npm test                                      # SDK golden vectors and unit tests
npx tsx scripts/smoke-engine.ts               # gasless trading through the API with a wallet holding zero SOL
npx tsx scripts/smoke-keeper.ts               # keeper take-profit, limit fill and liquidation
node scripts/ui-e2e.ts                        # the whole flow in a headless browser
```

## Deploy

- **Engine:** `services/engine/Dockerfile`, built from the repository root. `services/engine/railway.json` configures Railway.
  - Required env: `CLUSTER=devnet`, `RPC_URLS`, `DATABASE_URL` (Neon), `CORS_ORIGINS`, `DEPLOYMENT_JSON`.
  - Keys: `RELAYER_SECRET`, `KEEPER_SECRET`, `FAUCET_SECRET` and `ORACLE_DEV_SECRET`, as JSON byte arrays.
  - `ORACLE_MODE=pyth` needs `PYTH_PRO_TOKEN`.
- **App:** Vercel with `app` as the root directory (`app/vercel.json`). Env: `VITE_API_URL`, `VITE_RPC_URL`, `VITE_PRIVY_APP_ID`.

## Open-source components

The program verifies Pyth Pro messages with its own parser. `programs/zap/tests/fixtures` includes Pyth's published signed BTC
test vector (Apache-2.0), used to prove the verification path. The web app's design was produced with Claude Design and
converted to React by `app/tools/convert-template.ts`.
