#!/usr/bin/env bash
# Terminal 1 of 2. Runs the whole Mystic allocation pipeline (no UI):
#   optimizer -> prepared transactions -> TEE sign+verify -> contracts build.
# Nothing is signed or broadcast. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> js deps (install only if missing)"
[ -e tee-model/node_modules/.bin/tsx ]  || ( cd tee-model    && npm install --silent --no-audit --no-fund )
[ -e frontend/node_modules/.bin/vite ]  || ( cd frontend     && npm install --silent --no-audit --no-fund )
[ -e prepared-txs/node_modules/viem ]   || ( cd prepared-txs && npm install --silent --no-audit --no-fund viem )

echo; echo "==> [1/4] optimizer: optimal allocation over the live snapshot"
( cd optimizer && python3 optimize.py )

echo; echo "==> [2/4] prepared transactions: unsigned Flare-mainnet bundle"
( cd prepared-txs && node build.mjs )

echo; echo "==> [3/4] TEE model: sign the bounded plan + verify the signature"
( cd tee-model \
  && npm run --silent run > sample-envelope.json \
  && npm run --silent run -- --bad=overcap > sample-envelope-bad.json \
  && npm run --silent run -- --bad=badsigner > sample-envelope-badsigner.json \
  && npm run --silent selftest \
  && node verify-envelope.mjs )

echo; echo "==> [4/4] contracts: compile the enforcement layer"
if command -v forge >/dev/null 2>&1; then
  ( cd contracts && forge build )
  echo "    (contracts compiled; run 'bash forktest.sh' for the live fork test)"
else
  echo "    forge not found - skipping contract build. Install foundry: https://getfoundry.sh"
fi

echo
echo "PIPELINE OK."
echo "Now open the UI in a second terminal:   bash ui.sh   ->  http://localhost:3000"
