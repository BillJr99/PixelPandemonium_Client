#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d node_modules/@playwright/test ]; then
  echo "Playwright dependencies are missing. Run npm install in $ROOT first." >&2
  exit 1
fi

node scripts/demo-tetris.js
