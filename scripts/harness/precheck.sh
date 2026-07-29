#!/usr/bin/env sh
set -eu

if command -v python3 >/dev/null 2>&1; then
  HARNESS_PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  HARNESS_PYTHON=python
else
  echo "ERROR: Python 3.11+ is required" >&2
  exit 2
fi

exec "$HARNESS_PYTHON" scripts/harness/precheck.py "$@"
