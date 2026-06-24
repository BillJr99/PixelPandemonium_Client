#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d node_modules/@playwright/test ]; then
  echo "Playwright dependencies are missing. Run npm install in $ROOT first." >&2
  exit 1
fi

if ! npx playwright --version >/dev/null 2>&1; then
  echo "Playwright is not available. Run npm install in $ROOT first." >&2
  exit 1
fi

if [ -f ../PixelPandemonium_Server/main.db ]; then
  (cd ../PixelPandemonium_Server && node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database('./main.db'); db.run('DELETE FROM AUTH_FAILURES', () => db.close());") >/dev/null 2>&1 || true
fi

npx playwright test "$@"
