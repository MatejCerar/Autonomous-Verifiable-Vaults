#!/usr/bin/env bash
# ============================================================================
# Automated Curation - bring up the real TEE + AVV on Coston2 (Docker only).
#
#   export PK=0x<your funded Coston2 key>
#   bash up.sh
#
# Host needs only Docker (Go + forge run inside containers). Node is needed only
# for the optional frontend, which the script prints a command for at the end.
# Tear everything down with:  bash down.sh
# ============================================================================
set -euo pipefail
: "${PK:?export PK=0x<funded Coston2 key> first, then re-run}"
cd "$(cd "$(dirname "$0")" && pwd)"
export RPC="${RPC:-https://coston2-api.flare.network/ext/C/rpc}"
export OWNER="${OWNER:-0xF9F3a52Bee73c53b6d0a5548DA41e4f77af9AB4e}"
step(){ printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

step "clean slate"
docker compose down --remove-orphans >/dev/null 2>&1 || true
# also remove any standalone leftovers from older scripts that hold :7701/:8080
docker rm -f avv-tee avv-model >/dev/null 2>&1 || true

step "build images (Go + Node build INSIDE Docker - no host toolchain)"
docker compose build

step "start the real TEE node"
docker compose up -d tee

step "read the TEE signing address (waits until the TEE is ready)"
TEE_ADDR="$(docker compose run --rm -e TEE_SIGN_URL=http://tee:7701/sign model node get-address.mjs)"
[ -n "$TEE_ADDR" ] || { echo "could not read TEE address"; docker compose logs tee | tail -20; exit 1; }
echo "TEE address: $TEE_ADDR"

step "model code fingerprint"
CODE_HASH="$(docker compose run --rm model node --import tsx src/index.ts measure | tr -d '[:space:]')"
echo "codeHash: $CODE_HASH"

step "deploy AVV on Coston2 wired to the TEE (forge in a container)"
docker run --rm -v "$PWD":/demo -w /demo/contracts \
  -e TEE_SIGNER="$TEE_ADDR" -e CODE_HASH="$CODE_HASH" -e MODEL_VERSION=1 \
  --entrypoint sh ghcr.io/foundry-rs/foundry:latest -c '
    set -e
    git config --global --add safe.directory "*" || true
    if [ ! -d lib/forge-std ]; then
      rm -f .gitmodules; rm -rf lib
      git init -q . 2>/dev/null || true
      forge install foundry-rs/forge-std \
        OpenZeppelin/openzeppelin-contracts@v5.0.2 \
        OpenZeppelin/openzeppelin-contracts-upgradeable@v5.0.2
      # drop the transient git the installer creates so it never leaves a
      # nested repo inside contracts/ (which would break `git add` up-tree)
      rm -rf .git .gitmodules
    fi
    rm -rf out cache
    forge script script/Deploy.s.sol --rpc-url '"$RPC"' --broadcast --private-key '"$PK"' --slow
  '
tmp="$(mktemp)"; jq '.network="coston2"|.rpcUrl="'"$RPC"'"' addresses.json > "$tmp" && mv "$tmp" addresses.json
echo "controller: $(jq -r .deployed.curationController addresses.json)"

step "start the model service (TEE-signing mode)"
docker compose up -d model

step "frontend env"
cat > frontend/.env.local <<ENV
VITE_RPC_URL=$RPC
VITE_MODEL_URL=http://127.0.0.1:8080
VITE_DEV_KEY=$PK
ENV

cat <<DONE

============================================================
 UP.  TEE + model in Docker;  AVV deployed on Coston2.
   controller : $(jq -r .deployed.curationController addresses.json)
   TEE signer : $TEE_ADDR
   model API  : http://127.0.0.1:8080  (/health /inputs /cycle)

 Start the UI (needs Node), keep the terminal open:
   cd frontend && npm install && npm run dev
 Then open  http://127.0.0.1:3000  and click "Run cycle".

 Tear everything down:  bash down.sh
============================================================
DONE
