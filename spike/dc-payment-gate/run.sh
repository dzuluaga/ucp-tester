#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --silent
fi
# server.js emits an ap2.PaymentMandate on stdout; validate.js runs the 4 gates.
# Pass --raw to skip validation and see the bare mandate.
if [ "${1:-}" = "--raw" ]; then
  shift
  node server.js "$@"
else
  node server.js "$@" | node validate.js
fi
