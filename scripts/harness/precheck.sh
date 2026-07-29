#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
python scripts/harness/catalog_tool.py validate
python scripts/harness/catalog_tool.py diff --fail-on-drift
python scripts/harness/check_paid_features.py
python scripts/harness/check_beta_gate.py
printf '%s\n' 'Harness precheck: PASS'
