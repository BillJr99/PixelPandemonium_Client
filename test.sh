#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

SERVER_URL="$(sed -n 's/^server_url:[[:space:]]*//p' config.yaml | head -n 1 | tr -d '"' | tr -d "'")"
SERVER_URL="${SERVER_URL:-http://localhost:8000}"

echo "Checking configured server: $SERVER_URL"
if ! curl -fsS "$SERVER_URL/health" >/dev/null 2>&1; then
  echo "Start the Pixel Pandemonium server at $SERVER_URL, then press Enter."
  read -r _
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
test -f assets/js/pixel-pandemonium.js
test -f assets/css/drawingcanvas.css

grep -q "tileSelectorCanvas" instructions.html
grep -q "Teacher Dashboard" teacher-dashboard.html
grep -q "Auto Finish" replay.html
grep -q "initStudent" assets/js/pixel-pandemonium.js
grep -q "getTileStatus" assets/js/pixel-pandemonium.js
grep -q "FFE0B2" assets/js/pixel-pandemonium.js

CREATE_RESPONSE="$(curl -fsS -H "Origin: http://localhost:4000" -H "Content-Type: application/json" \
  -d '{"pictureId":"tetris","teacherName":"Client Test","dateTime":"2026-06-23T13:00:00","expirationHours":1}' \
  "$SERVER_URL/instance/create")"

node -e "const d=JSON.parse(process.argv[1]); if(!d.studentUrl || !d.replayUrl || !d.adminUrl || !d.instanceCode) process.exit(1)" "$CREATE_RESPONSE"

if command -v jekyll >/dev/null 2>&1; then
  jekyll build >/tmp/pixel-pandemonium-client-jekyll.log
elif command -v bundle >/dev/null 2>&1 && [ -f Gemfile.lock ]; then
  bundle exec jekyll build >/tmp/pixel-pandemonium-client-jekyll.log
else
  echo "Jekyll is not installed; skipped Jekyll build."
fi

echo "Client tests passed."
