#!/usr/bin/env bash
# TASK-0015: one-shot PostgreSQL 18 + pgvector container that applies the
# Flyway migrations and runs the five cross-tenant fail-closed SQL tests.
#
# Image version AND digest are frozen by the task card. The container is
# anonymous (--rm), binds no host port and mounts no volume: tests run via
# `docker exec`, satisfying TEMPORARY_PORT_ONLY and TEMPORARY_VOLUME_ONLY.
# It never touches MySQL, Redis, RabbitMQ or Kingbase.
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

echo "== waiting for readiness =="
for _ in $(seq 1 60); do
    if docker exec "$CID" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
        break
    fi
    sleep 0.5
done
if ! docker exec "$CID" pg_isready -U "$DB_USER" >/dev/null 2>&1; then
    echo "postgres did not become ready" >&2
    docker logs "$CID" >&2 || true
    exit 3
fi

echo "== applying migrations V1..V4 =="
for f in $(ls "$MIG_DIR"/V*.sql | sort); do
    echo "  -> $(basename "$f")"
    docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q < "$f"
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
    rm -f "$log"
done

echo "== cleanup =="
if [ "$FAIL" -eq 0 ]; then
    echo "ALL TESTS PASS"
else
    echo "SOME TESTS FAILED"
fi
exit "$FAIL"
