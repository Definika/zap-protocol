#!/usr/bin/env bash
# Devnet deploy in one go: the program (upgrade authority = admin), SOL for the relayer and keeper, then the idempotent
# setup (test USDC mint, config, markets, lookup table, vault seed). Safe to re-run; each step skips what exists.
#
#   scripts/deploy-devnet.sh            (RPC_URL overrides the public devnet endpoint)
#
# Needs ~10 SOL on the admin key: ~5 for the program account (the upload buffer is refunded) and 3 + 1 for the relayer
# and keeper. Keys come from ~/.config/solana/zap (ZAP_KEY_DIR) and never enter the repo.

set -euo pipefail
cd "$(dirname "$0")/.."
KEYS=${ZAP_KEY_DIR:-$HOME/.config/solana/zap}
RPC=${RPC_URL:-https://api.devnet.solana.com}
ADMIN="$KEYS/admin.json"
SO=target/deploy/zap.so

echo "admin $(solana address -k "$ADMIN"): $(solana balance --url "$RPC" "$ADMIN")"
[ -f "$SO" ] || npm run build:program

PROGRAM=$(solana address -k "$KEYS/program.json")
if solana program show --url "$RPC" "$PROGRAM" >/dev/null 2>&1; then
  echo "upgrading $PROGRAM"
  solana program deploy --url "$RPC" --keypair "$ADMIN" --program-id "$PROGRAM" --upgrade-authority "$ADMIN" "$SO" --use-rpc --max-sign-attempts 50
else
  echo "deploying $PROGRAM"
  # room to grow by ~25% without reallocating
  solana program deploy --url "$RPC" --keypair "$ADMIN" --program-id "$KEYS/program.json" --upgrade-authority "$ADMIN" \
    --max-len $(( $(wc -c < "$SO") * 5 / 4 )) "$SO" --use-rpc --max-sign-attempts 50
fi

top_up() {
  local who=$1 want=$2 addr have
  addr=$(solana address -k "$KEYS/$who.json")
  have=$(solana balance --url "$RPC" "$addr" | awk '{print int($1)}')
  if [ "$have" -lt "$want" ]; then
    solana transfer --url "$RPC" --keypair "$ADMIN" --allow-unfunded-recipient "$addr" $(( want - have )) >/dev/null
  fi
  echo "$who $addr: $(solana balance --url "$RPC" "$addr")"
}
top_up relayer 3
top_up keeper 1

CLUSTER=devnet RPC_URL="$RPC" npx tsx scripts/setup.ts
echo "devnet deployment written to config/deployments/devnet.json"
