#!/usr/bin/env bash
#
# Run ONE live curation cycle against the deployment in ../addresses.json.
#
#   scripts/cycle.sh          submit a fresh VALID signed plan and print the
#                             tx hash + resulting on-chain positions.
#   scripts/cycle.sh --bad    submit the over-cap plan (venue 0 at 40% > 30%)
#                             and show the on-chain revert ("over venue cap").
#
# Pipeline: the simulated TEE model (no docker, no TEE hardware) produces a
# signed envelope, then submit-cycle.mjs encodes controller.executePlan(...) and
# sends it with viem.
#
# Required env:
#   PK   deployer/relayer private key (funded Coston2 account), from env only.
# Optional env:
#   RPC             RPC override (default = addresses.json rpcUrl)
#   TEE_PRIVATE_KEY the model signing key (must match the registered TEE signer)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$HERE/.." && pwd)"
TEE_MODEL_DIR="$DEMO_ROOT/tee-model"

: "${PK:?PK (relayer private key) must be set}"

PLAN_FILE="/tmp/plan.json"

MODE="valid"
if [ "${1:-}" = "--bad" ]; then
  MODE="bad"
fi

# --- 1. get a signed envelope from the simulated TEE model ---
if [ "$MODE" = "bad" ]; then
  echo "Building an OVER-CAP (bad) plan from the TEE model ..." >&2
  # overcap = one venue over the 30% venue cap; reverts on-chain with
  # "over venue cap" before any funds move.
  (cd "$TEE_MODEL_DIR" && npx --yes tsx src/index.ts run --bad=overcap) \
    > "$PLAN_FILE"
else
  echo "Running one curation cycle in the TEE model ..." >&2
  (cd "$TEE_MODEL_DIR" && npx --yes tsx src/index.ts run) > "$PLAN_FILE"
fi
echo "Signed envelope written to $PLAN_FILE" >&2

# --- 2. submit on-chain ---
# PK and (optional) RPC are passed through the environment to the submitter.
export PK
[ -n "${RPC:-}" ] && export RPC

if [ "$MODE" = "bad" ]; then
  echo "Submitting bad plan (expect an on-chain revert) ..." >&2
  if NODE_PATH="$TEE_MODEL_DIR/node_modules" node "$HERE/submit-cycle.mjs" "$PLAN_FILE"; then
    echo "ERROR: bad plan did NOT revert" >&2
    exit 1
  else
    echo "Bad plan reverted on-chain as expected." >&2
    exit 0
  fi
else
  NODE_PATH="$TEE_MODEL_DIR/node_modules" node "$HERE/submit-cycle.mjs" "$PLAN_FILE"
fi
