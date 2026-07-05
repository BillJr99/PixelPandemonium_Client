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

# The committed config.yaml points at the production deployment. Browser tests
# create their fixtures on the local sibling server, so the client must talk to
# that same server — swap the URLs for the duration of the run and restore the
# production config afterwards (PIXEL_SERVER_URL overrides the local target).
LOCAL_SERVER_URL="${PIXEL_SERVER_URL:-http://127.0.0.1:8000}"
cp config.yaml config.yaml.browser-test-backup
restore_config() {
  mv config.yaml.browser-test-backup config.yaml
}
trap restore_config EXIT
sed -i.sedbak \
  -e "s|^server_url:.*|server_url: $LOCAL_SERVER_URL|" \
  -e "s|^realtime_url:.*|realtime_url: $LOCAL_SERVER_URL|" \
  -e "s|^base_url:.*|base_url: http://localhost:4000|" \
  config.yaml
rm -f config.yaml.sedbak

npx playwright test "$@"
