#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v bundle >/dev/null 2>&1 && [ -f Gemfile.lock ]; then
  bundle exec jekyll build
elif command -v jekyll >/dev/null 2>&1; then
  jekyll build
else
  echo "Jekyll is not installed. Static syntax checks can still run through ./test.sh." >&2
  exit 1
fi
