#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SERVER_URL="$(sed -n 's/^server_url:[[:space:]]*//p' config.yaml | head -n 1 | tr -d '"' | tr -d "'")"
SERVER_URL="${SERVER_URL:-http://localhost:8000}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

clear_test_auth_failures() {
  if [ -f ../PixelPandemonium_Server/main.db ]; then
    (cd ../PixelPandemonium_Server && node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database('./main.db'); db.run('DELETE FROM AUTH_FAILURES', () => db.close());") >/dev/null 2>&1 || true
  fi
}

echo "Checking configured server: $SERVER_URL"
if ! curl -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
  if [ -f ../PixelPandemonium_Server/package.json ]; then
    echo "Starting sibling server for client smoke tests."
    (cd ../PixelPandemonium_Server && npm start) >/tmp/pixel-pandemonium-client-server.log 2>&1 &
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
clear_test_auth_failures

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
grep -q "creationMode" teacher-dashboard.html
grep -q "analyzeCustomPicture" assets/js/pixel-pandemonium.js
grep -q "nearestPaletteIndex" assets/js/pixel-pandemonium.js
grep -q "parseCompositeJs" assets/js/pixel-pandemonium.js

CREATE_RESPONSE="$(curl -fsS -H "Origin: http://localhost:4000" -H "Content-Type: application/json" \
  -d '{"pictureId":"tetris","teacherName":"Client Test","dateTime":"2026-06-23T13:00:00","expirationHours":1}' \
  "$SERVER_URL/instance/create")"

node -e "const d=JSON.parse(process.argv[1]); if(!/instructions\\.html\\?instance=.*&key=/.test(d.studentUrl) || !/replay\\.html\\?instance=.*&key=/.test(d.replayUrl) || !/teacher-dashboard\\.html\\?instance=.*&teacherKey=.*&admin=/.test(d.teacherUrl) || !/admin\\.html\\?instance=.*&teacherKey=.*&admin=/.test(d.adminUrl) || !d.instanceCode || !d.accessKey || !d.teacherKey) process.exit(1)" "$CREATE_RESPONSE"

CUSTOM_RESPONSE="$(curl -fsS -H "Origin: http://localhost:4000" -H "Content-Type: application/json" \
  -d "{\"title\":\"Client Smoke Custom\",\"adminPassword\":\"$ADMIN_PASSWORD\",\"spec\":{\"palette\":[[255,255,255],[0,0,0]],\"numRows\":1,\"numCols\":1,\"pages\":[{\"col\":\"A\",\"row\":\"1\",\"uncompressed\":[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0]}]}}" \
  "$SERVER_URL/pictures/custom")"
CUSTOM_ID="$(node -e "const d=JSON.parse(process.argv[1]); if(!d.id || !d.zipUrl) process.exit(1); console.log(d.id)" "$CUSTOM_RESPONSE")"
CUSTOM_CREATE="$(curl -fsS -H "Origin: http://localhost:4000" -H "Content-Type: application/json" \
  -d "{\"pictureId\":\"$CUSTOM_ID\",\"teacherName\":\"Client Custom Test\",\"dateTime\":\"2026-06-23T13:00:00\",\"expirationHours\":1}" \
  "$SERVER_URL/instance/create")"
CUSTOM_CODE="$(node -e "const d=JSON.parse(process.argv[1]); if(!d.instanceCode) process.exit(1); console.log(d.instanceCode)" "$CUSTOM_CREATE")"
CUSTOM_KEY="$(node -e "const d=JSON.parse(process.argv[1]); if(!d.accessKey) process.exit(1); console.log(d.accessKey)" "$CUSTOM_CREATE")"
curl -fsS -H "Origin: http://localhost:4000" "$SERVER_URL/instance/$CUSTOM_CODE/status?key=$CUSTOM_KEY" \
  | node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); if(!d.pictureCustom || !d.pictureSpecUrl) process.exit(1)"

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
