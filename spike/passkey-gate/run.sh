#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --silent
fi
# Passkey gate emits a bare verified WebAuthn assertion on stdout.
# Mock AP2 adapter wraps it in a Payment Mandate (the shape a P1 adapter would produce at checkout).
# Pass --raw to skip the adapter and see the bare assertion (the gate's actual contract).
if [ "${1:-}" = "--raw" ]; then
  shift
  node server.js "$@"
else
  node server.js "$@" | node mock-ap2-adapter.js
fi
