#!/usr/bin/env bash
# Tear down the Automated Curation stack (TEE + model containers).
# The on-chain Coston2 deployment stays (it is just contracts); re-running up.sh
# deploys a fresh stack wired to the new TEE key.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"
docker compose down --remove-orphans
echo "down. (frontend: stop its 'npm run dev' terminal with Ctrl-C)"
