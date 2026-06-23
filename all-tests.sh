#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
./test.sh
./browser-test.sh
