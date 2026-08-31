#!/usr/bin/env bash
# DOGFOOD-STABILIZATION-04 (audit defect A): the REAL V111→latest upgrade
# test. A fresh ephemeral PostgreSQL 18 + pgvector container (same frozen
# image as run-rls-tests.sh) is migrated ONLY to V111; the legacy blocked /
# cancelled world is seeded with the V111-era functions (no TRUNCATE shortcuts
# — the seeded rows are the actual legacy rows); then V112..latest apply on
# top and the assertions prove the backfill repaired them in place.
#
# Usage:  bash infra/db/run-upgrade-test.sh
set -euo pipefail

# Same frozen image and digest as run-rls-tests.sh.
IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
DB_NAME="vc"
DB_USER="postgres"
DB_PASSWORD="vc"
LEGACY_VERSION="111"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$REPO_ROOT/backend/internal/migrate/sql"
UPGRADE_DIR="$SCRIPT_DIR/upgrade"
LOG_DIR="${VC_DB_LOG_DIR:-$(mktemp -d /tmp/vc-db-upgrade.XXXXXX)}"
mkdir -p "$LOG_DIR"
echo "log dir: $LOG_DIR"

CID=""
cleanup() {
    if [ -n "$CID" ]; then
        docker rm -f "$CID" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

echo "== launching ephemeral PostgreSQL 18 + pgvector =="
CID=$(docker run -d --rm \
    --name "vc-upgrade-$$" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    "$IMAGE")

echo "== waiting for stable readiness =="
STABLE=0
for _ in $(seq 1 200); do
    if docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
        STABLE=$((STABLE+1))
        if [ "$STABLE" -ge 3 ]; then
            echo "  ready"
            break
        fi
    else
        STABLE=0
    fi
    sleep 0.5
done
if [ "$STABLE" -lt 3 ]; then
    echo "postgres did not become stable-ready" >&2
    exit 3
fi

run_psql() {
    local file="$1"
    docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$file"
}

echo "== applying the LEGACY schema (V1..V${LEGACY_VERSION} only) =="
legacy_count=0
for f in $(ls "$MIG_DIR"/V*.sql | sort -V); do
    name="$(basename "$f")"
    version="${name%%__*}"
    version="${version#V}"
    if [ "$version" -gt "$LEGACY_VERSION" ]; then
        break
    fi
    echo "  -> $name"
    run_psql "$f" >>"$LOG_DIR/legacy-migration.log" 2>&1
    legacy_count=$((legacy_count+1))
done
echo "  legacy migrations applied: $legacy_count"

echo "== seeding the pre-V112 legacy world =="
run_psql "$UPGRADE_DIR/111-seed.sql" >"$LOG_DIR/seed.log" 2>&1
echo "  seeded"

echo "== applying the UPGRADE migrations (V$((LEGACY_VERSION+1))..latest) =="
for f in $(ls "$MIG_DIR"/V*.sql | sort -V); do
    name="$(basename "$f")"
    version="${name%%__*}"
    version="${version#V}"
    if [ "$version" -le "$LEGACY_VERSION" ]; then
        continue
    fi
    echo "  -> $name"
    run_psql "$f" >>"$LOG_DIR/upgrade-migration.log" 2>&1
done

echo "== asserting the backfill repaired the legacy rows in place =="
if run_psql "$UPGRADE_DIR/latest-assert.sql" >"$LOG_DIR/assert.log" 2>&1; then
    echo "UPGRADE TEST PASS (V${LEGACY_VERSION} -> latest)"
else
    echo "UPGRADE TEST FAIL" >&2
    cat "$LOG_DIR/assert.log" >&2
    exit 1
fi
