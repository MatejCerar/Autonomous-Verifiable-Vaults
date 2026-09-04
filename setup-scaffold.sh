#!/usr/bin/env bash
#
# One-command setup of the full FCC tee-node stack for the AVV extension.
#
# This is the ONLY path that runs the model inside a real Flare TEE (attestation).
# It clones Flare's fce-extension-scaffold, forward-ports it to the versions
# Coston2 runs (tee-proxy v0.0.21), wires in this repo's AVV extension, and drops
# the config templates. You then fill 2 secrets + the DB block and deploy.
#
# Scaffold upstream: https://github.com/flare-foundation/fce-extension-scaffold
#

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAFFOLD_URL="${SCAFFOLD_URL:-https://github.com/flare-foundation/fce-extension-scaffold.git}"
SCAFFOLD_DIR="${SCAFFOLD_DIR:-$REPO_DIR/../fce-extension-scaffold}"

echo "[setup-scaffold] repo:     $REPO_DIR"
echo "[setup-scaffold] scaffold: $SCAFFOLD_DIR"
echo "[setup-scaffold] upstream: $SCAFFOLD_URL"

# 1. Clone (or reuse) the scaffold.
if [ -d "$SCAFFOLD_DIR/.git" ]; then
  echo "[setup-scaffold] scaffold already present, reusing it"
else
  git clone "$SCAFFOLD_URL" "$SCAFFOLD_DIR"
fi
cd "$SCAFFOLD_DIR"

# 2. Forward-port to the versions coston2-1 runs (tee-node v0.0.24 + tee-proxy
#    v0.0.21). The scaffold ships tee-proxy v0.0.18; a mismatched proxy makes the
#    FTDC availability check REJECT the attestation. tee-node is already v0.0.24.
DF="proxy/Dockerfile"
if [ -f "$DF" ]; then
  sed -i 's/TEE_PROXY_VERSION=v0\.0\.18/TEE_PROXY_VERSION=v0.0.21/' "$DF"
  sed -i 's/FROM golang:1\.25\.1-alpine/FROM golang:1.26-alpine/' "$DF"
  sed -i 's#/app/tee-proxy/config\.example\.toml#/app/tee-proxy/config/config.example.toml#' "$DF"
  echo "[setup-scaffold] patched $DF (tee-proxy v0.0.21, golang 1.26, moved config path)"
else
  echo "[setup-scaffold] WARN: $DF not found; scaffold layout may have changed, apply the 4 edits from tee-extension/COSTON2-FCC.md by hand"
fi

if [ -f tools/go.mod ]; then
  if command -v go >/dev/null 2>&1; then
    ( cd tools && go get github.com/flare-foundation/tee-proxy@v0.0.21 && go mod tidy ) \
      && echo "[setup-scaffold] bumped tools/go.mod tee-proxy -> v0.0.21"
  else
    echo "[setup-scaffold] WARN: 'go' not found; run: cd tools && go get github.com/flare-foundation/tee-proxy@v0.0.21 && go mod tidy"
  fi
fi

# 3. Wire in the AVV extension (the model + handler).
mkdir -p typescript/src/app typescript/src/__tests__ contracts
cp "$REPO_DIR/tee-extension/extension/"*.ts        typescript/src/app/
cp -r "$REPO_DIR/tee-extension/extension/vendor"   typescript/src/app/
cp "$REPO_DIR/tee-extension/extension/__tests__/curation.test.ts" typescript/src/__tests__/ 2>/dev/null || true
cp "$REPO_DIR/tee-extension/InstructionSender.sol" contracts/ 2>/dev/null || true
echo "[setup-scaffold] copied the AVV extension into the scaffold"

# 4. Drop the config templates. You fill the secrets locally; they are NOT in git.
cp "$REPO_DIR/tee-extension/env/.env.coston2.example" .env.coston2
mkdir -p config/proxy
cp "$REPO_DIR/tee-extension/env/extension_proxy.coston2.docker.toml.example" \
   config/proxy/extension_proxy.coston2.docker.toml
chmod 644 config/proxy/extension_proxy.coston2.docker.toml
echo "[setup-scaffold] staged .env.coston2 + config/proxy/extension_proxy.coston2.docker.toml"

cat <<'NEXT'

[setup-scaffold] DONE. Now, inside the scaffold dir:

  1. .env.coston2         -> fill PROXY_PRIVATE_KEY, DEPLOYMENT_PRIVATE_KEY,
                             INITIAL_OWNER (funded Coston2 keys). Keep SIMULATED_TEE=true.
  2. config/proxy/extension_proxy.coston2.docker.toml -> fill the [db] block:
                             host, database, username, password  (Coston2 indexer, from Flare)
  3. bash scripts/check-versions.sh          # expect "all version pins consistent"
  4. ./scripts/full-setup.sh --chain coston2 --tunnel --test
  5. On success, copy the printed InstructionSender + ext-proxy URL into this repo's
     src/tee.config.ts  (INSTRUCTION_SENDER + EXT_PROXY_URL).

Details + traps: tee-extension/COSTON2-FCC.md
NEXT
