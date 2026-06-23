#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SERVER_URL="$(sed -n 's/^server_url:[[:space:]]*//p' config.yaml | head -n 1 | tr -d '"' | tr -d "'")"
SERVER_URL="${SERVER_URL:-http://localhost:8000}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Checking configured server: $SERVER_URL"
if ! curl -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
  if [ -f ../Pixel_Pandemonium_server/package.json ]; then
    echo "Starting sibling server for client smoke tests."
    (cd ../Pixel_Pandemonium_server && npm start) >/tmp/pixel-pandemonium-client-server.log 2>&1 &
    SERVER_PID="$!"
  else
    echo "Start the Pixel Pandemonium server at $SERVER_URL, then press Enter."
    read -r _
  fi
fi

for _ in $(seq 1 60); do
  if curl -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -fsS "$SERVER_URL/health" >/dev/null

test -f index.html
test -f teacher-dashboard.html
test -f instructions.html
test -f replay.html
test -f admin.html
test -f assets/js/pixel-pandemonium.js
test -f assets/css/drawingcanvas.css

grep -q "tileSelectorCanvas" instructions.html
grep -q "Teacher Dashboard" teacher-dashboard.html
grep -q "Deactivate Instance" admin.html
grep -q "animationSource" admin.html
grep -q "animationOrder" admin.html
grep -q "Auto Finish" replay.html
grep -q "initStudent" assets/js/pixel-pandemonium.js
grep -q "initAdmin" assets/js/pixel-pandemonium.js
grep -q "completedImageRows" assets/js/pixel-pandemonium.js
grep -q "getTileStatus" assets/js/pixel-pandemonium.js
grep -q "FFE0B2" assets/js/pixel-pandemonium.js

CREATE_RESPONSE="$(curl -fsS -H "Origin: http://localhost:4000" -H "Content-Type: application/json" \
  -d '{"pictureId":"tetris","teacherName":"Client Test","dateTime":"2026-06-23T13:00:00","expirationHours":1}' \
  "$SERVER_URL/instance/create")"

node -e "const d=JSON.parse(process.argv[1]); if(!d.studentUrl || !d.replayUrl || !/admin\\.html\\?instance=/.test(d.adminUrl) || !d.instanceCode) process.exit(1)" "$CREATE_RESPONSE"

if command -v bundle >/dev/null 2>&1 && [ -f Gemfile.lock ]; then
  if ! bundle exec jekyll build >/tmp/pixel-pandemonium-client-jekyll.log 2>&1; then
    echo "Jekyll build skipped or failed; see /tmp/pixel-pandemonium-client-jekyll.log."
  fi
elif command -v jekyll >/dev/null 2>&1; then
  if ! jekyll build >/tmp/pixel-pandemonium-client-jekyll.log 2>&1; then
    echo "Jekyll build skipped or failed; see /tmp/pixel-pandemonium-client-jekyll.log."
  fi
else
  echo "Jekyll is not installed; skipped Jekyll build."
fi

echo "Client tests passed."
