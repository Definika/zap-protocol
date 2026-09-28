# ZAP Protocol

Perpetual futures on Solana with the feel of a centralized exchange: log in with Google or email, trade without wallet pop-ups or gas,
and settle everything on-chain.

- **Model:** a single USDC liquidity vault is the counterparty to every trade. Fills happen at the Pyth Pro price, which is
  signed and verified inside the same transaction.
- **Status:** under active development for the Solana Foundation *Perps and Prediction Markets* hackathon (Oct 2026). The target network is **devnet**.

## Repository layout

| Path | What it is |
|---|---|
| `crates/zap-math` | Fixed-point math shared by the program and the SDK: fills, fees, funding, borrow, PnL, liquidation, vault NAV |
| `programs/zap` | Anchor program (on-chain engine) |
| `packages/sdk` | TypeScript SDK (accounts, exact math port, quotes, transaction builders) |
| `services/engine` | Backend: oracle stream, keeper, indexer, API, gasless relayer, faucet, alerts |
| `app` | Web app (Vite + React) |

## Development

Requirements: Rust (the toolchain is pinned in `rust-toolchain.toml`), Solana CLI 4.x, Anchor CLI 1.2, Node 22+.

```bash
cargo test -p zap-math        # math unit tests
npm run build:program         # anchor build --arch v0 (SBPF v0: what we test in LiteSVM is what we deploy)
cargo test -p zap             # program unit + LiteSVM integration tests
npm run design:extract -w app # unpack fonts, logos and design reference files (needed once for the app)
npm run dev:app               # web app (dev)
```
