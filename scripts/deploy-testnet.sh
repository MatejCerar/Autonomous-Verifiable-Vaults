#!/usr/bin/env bash
#
# Deploy the FULL Automated Curation stack on Coston2 (chainId 114) with fake
# money. NO docker, NO GCP TEE, NO Mystic required: the three venues are mock
# ERC-4626 vaults over a single mock USD. This is what an external curator runs
# to stand the whole thing up themselves.
#
# Required env:
#   PK   deployer private key (funded Coston2 C-chain account, 0x-prefixed)
# Optional env:
#   RPC             Coston2 RPC (default https://coston2-api.flare.network/ext/C/rpc)
#   TEE_PRIVATE_KEY key the simulated TEE model signs plans with. Its address is
#                   registered as the write-once TEE signer. Defaults to the
#                   tee-model default key so `npm run --silent run` plans verify
#                   out of the box.
#   TEE_SIGN_URL    if set (a live TEE /sign endpoint), the signer address is
#                   recovered from it via tee-model/get-address.mjs instead.
#   MODEL_VERSION   default 1
#
# Writes ../addresses.json (repo root) in the schema tee-model/config.ts consumes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$HERE/.." && pwd)"
TEE_MODEL_DIR="$DEMO_ROOT/tee-model"
CONTRACTS_DIR="$DEMO_ROOT/contracts"

: "${PK:?PK (deployer private key) must be set}"
RPC="${RPC:-https://coston2-api.flare.network/ext/C/rpc}"
MODEL_VERSION="${MODEL_VERSION:-1}"

# --- 1. TEE signer address ---
# With a live TEE /sign endpoint, recover the running node's address. Otherwise
# (the no-TEE testnet path) derive the address the local model key signs with,
# so the plans emitted by `tee-model run` verify against the registered signer.
if [ -n "${TEE_SIGN_URL:-}" ]; then
  echo "Recovering TEE signer from $TEE_SIGN_URL ..." >&2
  TEE_SIGNER="$(node "$TEE_MODEL_DIR/get-address.mjs")"
else
  DEFAULT_TEE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  MODEL_KEY="${TEE_PRIVATE_KEY:-$DEFAULT_TEE_KEY}"
  TEE_SIGNER="$(cast wallet address --private-key "$MODEL_KEY")"
fi
echo "TEE_SIGNER=$TEE_SIGNER" >&2

# --- 2. model codeHash (fingerprint) ---
# Self-measured by the model service. The package has no `measure` npm script,
# so invoke the measure subcommand directly (equivalent to `npm run measure`).
CODE_HASH="$(cd "$TEE_MODEL_DIR" && npx --yes tsx src/index.ts measure)"
CODE_HASH="$(echo "$CODE_HASH" | tr -d '[:space:]')"
echo "CODE_HASH=$CODE_HASH" >&2

# --- 3. deploy ---
cd "$CONTRACTS_DIR"
TEE_SIGNER="$TEE_SIGNER" \
CODE_HASH="$CODE_HASH" \
MODEL_VERSION="$MODEL_VERSION" \
  forge script DeployTestnet \
    --rpc-url "$RPC" \
    --private-key "$PK" \
    --broadcast \
    --via-ir

echo "" >&2
echo "Deployment complete. Wrote: $DEMO_ROOT/addresses.json" >&2
