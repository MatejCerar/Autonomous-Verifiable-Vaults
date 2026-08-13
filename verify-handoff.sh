#!/usr/bin/env bash
# Pre-handoff safety check. Fails (exit 1) if anything unsafe would ship.
# Run from the repo root. Checks what GIT WOULD SHIP (tracked files only).
set -uo pipefail
cd "$(dirname "$0")"
fail=0
say(){ printf '%s\n' "$*"; }
bad(){ printf 'FAIL: %s\n' "$*"; fail=1; }

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  say "not a git repo - init one and commit before handoff (git archive ships only tracked files)"; exit 1
fi

say "== 1. no secrets tracked =="
if git ls-files | grep -iE '(^|/)\.env$|(^|/)\.env\.[^.]*$' | grep -v '\.env\.example$' >/dev/null; then
  bad "a real .env is tracked:"; git ls-files | grep -iE '(^|/)\.env' | grep -v example
else say "  ok - only .env.example files tracked"; fi

if git ls-files | grep -E '^TEE/' >/dev/null; then bad "TEE/ is tracked (must stay gitignored)"; else say "  ok - TEE/ not tracked"; fi

# private-key-shaped values in tracked files, excluding the known-public Anvil demo key
ANVIL='ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
hits=$(git ls-files | grep -vE 'contracts/lib/|package-lock|\.example$' | while read -r f; do
  grep -oIE '0x[0-9a-fA-F]{64}' "$f" 2>/dev/null | grep -iv "$ANVIL" | sed "s#^#$f: #"; done)
# feed ids / hashes are 0x + 64 hex too; only flag ones that look like raw keys in env/config assignment
keyish=$(printf '%s' "$hits" | grep -iE 'PRIVATE_KEY|PK=|secret|mnemonic' || true)
if [ -n "$keyish" ]; then bad "possible private key in a tracked file:"; printf '%s\n' "$keyish"; else say "  ok - no assignment-style private keys in tracked files"; fi

say "== 2. no build artifacts / deps tracked =="
if git ls-files | grep -E '(^|/)node_modules/|(^|/)dist/|contracts/out/|contracts/cache/' >/dev/null; then
  bad "build artifacts or node_modules are tracked"; else say "  ok - node_modules/out/cache/dist not tracked"; fi

say "== 3. contracts build from a clean checkout =="
if command -v forge >/dev/null 2>&1; then
  if git ls-files | grep -E '^contracts/lib/.+\.sol$' >/dev/null; then say "  ok - vendored libs are committed"; else bad "contracts/lib not committed - clean clone will not build"; fi
else say "  (skip - forge not installed)"; fi

echo
if [ "$fail" = 0 ]; then say "HANDOFF CHECK PASSED"; else say "HANDOFF CHECK FAILED - fix the above before sharing"; fi
exit $fail
