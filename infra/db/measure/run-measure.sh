#!/usr/bin/env bash
# MEASURE (§26.3 / R45): scaled acceptance measurements. Standalone entry —
# deliberately NOT part of scripts/check.sh (checks-principles R1 budget):
# a full run takes minutes by design.
#
# Phases (each SQL file prints "PHASE <name> PASS <key numbers>"):
#   10_protocol   10,000 full ZERO_LLM chains; no "completed without persisted
#                 assistant message"; nothing stuck non-terminal.
#   20_cross_tenant  10,000 unauthorized probes from a second tenant across
#                 RLS reads and SD calls; leak count must be 0.
#
# Report: markdown at $VC_MEASURE_REPORT_DIR (default /tmp/vc-measure-<ts>),
# archived by the operator; nothing is written into the repo.
#
# Usage: bash infra/db/measure/run-measure.sh [phase ...]

set -euo pipefail

IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
DB_NAME="vc"
DB_USER="postgres"
DB_PASSWORD="vc"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIG_DIR="$REPO_ROOT/service/platform/persistence/src/main/resources/db/migration"
LOG_DIR="${VC_DB_LOG_DIR:-$(mktemp -d /tmp/vc-db-logs.XXXXXX)}"
REPORT_DIR="${VC_MEASURE_REPORT_DIR:-/tmp/vc-measure-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$LOG_DIR" "$REPORT_DIR"
echo "log dir:    $LOG_DIR"
echo "report dir: $REPORT_DIR"

CID=""
cleanup() { [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== launching ephemeral PostgreSQL 18 + pgvector =="
CID=$(docker run -d --rm --name "vc-measure-$$" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" -e POSTGRES_DB="$DB_NAME" \
    "$IMAGE")
stable=0
for _ in $(seq 1 200); do
    if docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
        stable=$((stable + 1)); [ "$stable" -ge 3 ] && break
    else
        stable=0
    fi
    sleep 0.5
done
[ "$stable" -ge 3 ] || { echo "postgres not ready" >&2; exit 3; }

echo "== applying migrations =="
for f in $(ls "$MIG_DIR"/V*.sql | sort -V); do
    docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -q < "$f" >>"$LOG_DIR/migration.log" 2>&1 \
        || { echo "migration failed: $(basename "$f")" >&2; tail -5 "$LOG_DIR/migration.log" >&2; exit 4; }
done
docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
    < "$REPO_ROOT/infra/db/tests/00_owner_binding_secret_seed.sql" >>"$LOG_DIR/migration.log" 2>&1

REPORT="$REPORT_DIR/measure-report.md"
{
    echo "# MEASURE 报告（$(date '+%F %T')）"
    echo
    echo "| 阶段 | 规模 | 不变量 | 结果 |"
    echo "|---|---|---|---|"
} > "$REPORT"

PHASES=("$@")
[ ${#PHASES[@]} -eq 0 ] && PHASES=(10_protocol 20_cross_tenant 40_cancel_late 50_fault_injection 60_full_fault_drill 70_retry_disconnect)

for phase in "${PHASES[@]}"; do
    echo "== phase $phase =="
    f="$SCRIPT_DIR/phases/$phase.sql"
    [ -f "$f" ] || { echo "  SKIP $phase (driver not present yet)"; continue; }
    start=$(date +%s)
    if docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -q < "$f" >"$LOG_DIR/$phase.log" 2>&1; then
        secs=$(($(date +%s) - start))
        summary=$(grep -o 'PHASE .*' "$LOG_DIR/$phase.log" | tail -1)
        echo "  PASS ($secs s): $summary"
        summary="| $summary |"
        echo "$summary" >> "$REPORT"
    else
        echo "  FAIL $phase" >&2
        tail -10 "$LOG_DIR/$phase.log" >&2
        echo "| $phase | - | - | FAIL |" >> "$REPORT"
        exit 5
    fi
done

echo
echo "== report =="
cat "$REPORT"
echo "report written: $REPORT"
