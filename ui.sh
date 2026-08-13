#!/usr/bin/env bash
# Terminal 2 of 2. Serves the six-step walkthrough UI on http://localhost:3000.
# 'predev' auto-syncs the latest JSON artifacts into public/data first.
# Leave this running; Ctrl-C to stop.
set -euo pipefail
cd "$(dirname "$0")/frontend"
[ -e node_modules/.bin/vite ] || npm install --silent --no-audit --no-fund
npm run dev
