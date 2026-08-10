#!/usr/bin/env sh
set -eu

HARNESS_PYTHON=
for candidate in python; do
  if command -v "$candidate" >/dev/null 2>&1 \
    && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 2)' >/dev/null 2>&1; then
    HARNESS_PYTHON=$candidate
    break
  fi
done

if [ -z "$HARNESS_PYTHON" ]; then
  echo "ERROR: Python 3.11+ is required (expected literal 'python' on PATH)" >&2
  exit 2
fi

exec "$HARNESS_PYTHON" scripts/harness/precheck.py "$@"
