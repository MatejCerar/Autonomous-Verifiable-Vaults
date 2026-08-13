#!/usr/bin/env bash
# Optional Terminal 3. Live-fork test: deposits into the real Mystic Core vaults
# on a Flare-mainnet fork (read-only fork, nothing broadcast). Needs foundry.
set -euo pipefail
cd "$(dirname "$0")/contracts"
forge test \
  --fork-url https://flare-api.flare.network/ext/C/rpc \
  --match-contract MysticVenueFork -vvv
