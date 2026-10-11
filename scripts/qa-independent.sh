#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/standalone-env.sh
exec python3 scripts/run-independent-qa.py "$@"
