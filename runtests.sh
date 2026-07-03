#!/usr/bin/env bash
# runtests.sh — run every test suite in the repo (regression / pre-commit).
#
# Runs all three surfaces and reports each; exits nonzero if any fails:
#   1. JavaScript unit tests  (node:test, web/js/**/*.test.js)
#   2. Go server tests        (go test ./..., in srv/)
#   3. C-generator parity     (node web/tools/parity.js — compiles with cc)
#
# Usage:  ./runtests.sh            run everything
#         ./runtests.sh --quick    skip the parity harness (no cc / slow step)

set -uo pipefail
cd "$(dirname "$0")" || exit 1

quick=0
[ "${1:-}" = "--quick" ] && quick=1

fail=0
run() {
  local name="$1"; shift
  echo "=== $name ==="
  if "$@"; then
    echo "PASS: $name"
  else
    echo "FAIL: $name"
    fail=1
  fi
  echo
}

run "JS unit tests" node --test 'web/js/**/*.test.js'
run "Go tests" bash -c 'cd srv && go test ./...'
if [ "$quick" -eq 0 ]; then
  run "C-generator parity" node web/tools/parity.js
else
  echo "=== C-generator parity ==="
  echo "SKIP: --quick"
  echo
fi

if [ "$fail" -ne 0 ]; then
  echo "SOME TESTS FAILED"
  exit 1
fi
echo "ALL TESTS PASSED"
