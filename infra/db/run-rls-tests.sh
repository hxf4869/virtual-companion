#!/usr/bin/env bash
# TASK-0015: one-shot PostgreSQL 18 + pgvector container that applies the
# Flyway migrations and runs the five cross-tenant fail-closed SQL tests.
#
# Image version AND digest are frozen by the task card. The container is
# anonymous (--rm), binds no host port and mounts no volume: tests run via
# `docker exec`, satisfying TEMPORARY_PORT_ONLY and TEMPORARY_VOLUME_ONLY.
# It never touches MySQL, Redis, RabbitMQ or Kingbase.
#
# P2-28: readiness uses a stable window of consecutive real SQL probes against
# the target database (a single pg_isready success can land inside initdb's
# temporary-server window before the real server and the vc database exist).
# Migration failures caused by recognised startup connection errors are retried
# a bounded number of times; other failures propagate unchanged. All output is
# captured under $VC_DB_LOG_DIR so CI can preserve migration/readiness logs on
# failure (locally it defaults to a fresh /tmp/vc-db-logs.* directory).
#
# Usage (from the repo or via WSL):  bash infra/db/run-rls-tests.sh
set -euo pipefail

IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
DB_NAME="vc"
DB_USER="postgres"
DB_PASSWORD="vc"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$REPO_ROOT/service/platform/persistence/src/main/resources/db/migration"
TEST_DIR="$SCRIPT_DIR/tests"
LOG_DIR="${VC_DB_LOG_DIR:-$(mktemp -d /tmp/vc-db-logs.XXXXXX)}"
mkdir -p "$LOG_DIR"
echo "log dir: $LOG_DIR"

if [ ! -d "$MIG_DIR" ]; then
    echo "migration dir not found: $MIG_DIR" >&2
    exit 2
fi

CID=""
cleanup() {
    if [ -n "$CID" ]; then
        docker rm -f "$CID" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

echo "== launching ephemeral PostgreSQL 18 + pgvector =="
CID=$(docker run -d --rm \
    --name "vc-task0015-$$" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    "$IMAGE")

echo "== waiting for stable readiness (P2-28: consecutive SQL successes) =="
# Probe the target database with real SQL: only the final server has the vc
# database, so a stable window of consecutive successes cannot land inside the
# initdb/entrypoint temporary-server windows. A single probe failure resets the
# count.
STABLE=0
STABLE_REQUIRED=3
for _ in $(seq 1 200); do
    if docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>>"$LOG_DIR/readiness.log"; then
        STABLE=$((STABLE+1))
        if [ "$STABLE" -ge "$STABLE_REQUIRED" ]; then
            echo "  ready (${STABLE_REQUIRED} consecutive SQL successes)"
            break
        fi
    else
        STABLE=0
    fi
    sleep 0.5
done
if [ "$STABLE" -lt "$STABLE_REQUIRED" ]; then
    echo "postgres did not become stable-ready (${STABLE_REQUIRED} consecutive SQL successes required)" >&2
    echo "--- container logs ---" >&2
    docker logs "$CID" >&2 || true
    echo "readiness probe log: $LOG_DIR/readiness.log" >&2
    exit 3
fi

echo "== applying migrations =="
# Version-sort (sort -V) so double-digit versions (V10+) apply after V9; plain
# lexicographic sort puts V10 before V1 because '0' < '_' at the second char.
# Only recognised startup connection errors are retried (bounded); anything
# else fails immediately with the psql output and the preserved migration log.
for f in $(ls "$MIG_DIR"/V*.sql | sort -V); do
    name="$(basename "$f")"
    echo "  -> $name"
    attempt=0
    max_attempts=3
    while :; do
        attempt=$((attempt+1))
        attempt_log="$(mktemp)"
        if docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$f" >"$attempt_log" 2>&1; then
            {
                echo "--- $name attempt $attempt OK ---"
                cat "$attempt_log"
            } >>"$LOG_DIR/migration.log"
            rm -f "$attempt_log"
            break
        else
            # Inside the else branch, $? is the failed psql exit code (the
            # if condition is exempt from set -e). Capturing it after the
            # whole if statement would always read 0 (no else-executed
            # command), which would swallow the failure.
            migrate_rc=$?
        fi
        {
            echo "--- $name attempt $attempt FAILED ---"
            cat "$attempt_log"
        } >>"$LOG_DIR/migration.log"
        # Case-insensitive match: real libpq/psql output varies in casing
        # (e.g. "Connection refused", "connection to server was lost").
        if ! grep -Eiq "connection refused|could not connect to server|server closed the connection unexpectedly|terminating connection due to administrator command|Connection to server was lost|database system is starting up" "$attempt_log"; then
            echo "    FAIL $name" >&2
            cat "$attempt_log" >&2
            rm -f "$attempt_log"
            exit "$migrate_rc"
        fi
        rm -f "$attempt_log"
        if [ "$attempt" -ge "$max_attempts" ]; then
            echo "    FAIL $name (startup connection error persisted after $max_attempts attempts)" >&2
            echo "    migration log: $LOG_DIR/migration.log" >&2
            exit "$migrate_rc"
        fi
        echo "    retry $name (startup connection error, attempt $attempt/$max_attempts)"
        sleep 1
    done
done

echo "== running cross-tenant fail-closed tests =="
FAIL=0
for t in $(ls "$TEST_DIR"/[0-9][0-9]_*.sql | sort); do
    name="$(basename "$t")"
    log="$(mktemp)"
    if docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$t" >"$log" 2>&1; then
        echo "PASS $name"
    else
        echo "FAIL $name"
        cat "$log" >&2
        FAIL=1
    fi
    {
        echo "--- $name ---"
        cat "$log"
    } >>"$LOG_DIR/tests.log"
    rm -f "$log"
done

echo "== cleanup =="
if [ "$FAIL" -eq 0 ]; then
    echo "ALL TESTS PASS"
else
    echo "SOME TESTS FAILED"
    echo "test log: $LOG_DIR/tests.log"
fi
exit "$FAIL"
