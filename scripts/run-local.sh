#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-4000}"
if command -v bundle >/dev/null 2>&1 && [ -f Gemfile.lock ]; then
  bundle exec jekyll serve --host 127.0.0.1 --port "$PORT"
elif command -v jekyll >/dev/null 2>&1; then
  jekyll serve --host 127.0.0.1 --port "$PORT"
else
  echo "Jekyll is not installed. Run bundle install or gem install jekyll webrick." >&2
  exit 1
fi
