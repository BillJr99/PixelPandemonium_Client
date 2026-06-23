#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "gh-pages" ]; then
  echo "Switch to the gh-pages branch before deploying. Current branch: $BRANCH" >&2
  exit 1
fi
./scripts/build.sh
git status --short
echo "Review the status above, then commit and push gh-pages to your GitHub remote."
