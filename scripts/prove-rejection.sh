#!/usr/bin/env bash
#
# SIGNED REJECTION PROOF wrapper.
#
# Builds a valid, bounded, enclave-signed allocation Plan signed by the WRONG
# enclave key, and proves the deployed CurationController rejects it on-chain
# with "bad signer". No funds move.
#
#   scripts/prove-rejection.sh
#       simulate only (eth_call): print the decoded revert reason and write the
#       raw signed tx artifact scripts/rejection-tx.signed.json.
#
#   BROADCAST=1 scripts/prove-rejection.sh
#       also broadcast the signed, self-reverting tx so it is MINED with
#       status 0 (reverted); prints the tx hash + a Coston2 explorer link.
#
# Required env (only for BROADCAST, and to embed the raw signed tx in the
# artifact):
#   PK    funded Coston2 EOA private key (0x-prefixed). It signs and pays for the
#         transaction. It does NOT sign the plan.
# Optional env:
#   RPC        RPC override (default = addresses.json rpcUrl, i.e. Coston2)
#   ROGUE_PK   the rogue enclave key that signs the PLAN. If unset, a fresh
#              throwaway key is generated and its address printed.
#   BROADCAST  set to 1 to actually mine the reverted tx.
#
# Secrets are env-only; nothing is hardcoded.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_ROOT="$(cd "$HERE/.." && pwd)"
TEE_MODEL_DIR="$DEMO_ROOT/tee-model"

RPC="${RPC:-https://coston2-api.flare.network/ext/C/rpc}"
export RPC

if [ "${BROADCAST:-}" = "1" ]; then
  : "${PK:?PK (funded EOA private key) must be set to broadcast}"
fi
[ -n "${PK:-}" ] && export PK
[ -n "${ROGUE_PK:-}" ] && export ROGUE_PK
[ -n "${BROADCAST:-}" ] && export BROADCAST

NODE_PATH="$TEE_MODEL_DIR/node_modules" node "$HERE/prove-rejection.mjs"
