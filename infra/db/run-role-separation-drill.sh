#!/usr/bin/env bash
# S0-27 ephemeral proof: dedicated migrator + composite least-privilege runtime.
set -euo pipefail

IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/backend/internal/migrate/sql"
INIT_DIR="$ROOT/ops/deploy/db-init"
MIGRATOR_PASSWORD="role-drill-migrator"
RUNTIME_PASSWORD="role-drill-runtime"
CID=""
cleanup() { [ -z "$CID" ] || docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

CID=$(docker run -d --rm --name "vc-role-drill-$$" \
  -e POSTGRES_USER=vc_migrator \
  -e POSTGRES_PASSWORD="$MIGRATOR_PASSWORD" \
  -e VC_MIGRATOR_DB_PASSWORD="$MIGRATOR_PASSWORD" \
  -e POSTGRES_DB=vc \
  -e VC_RUNTIME_DB_PASSWORD="$RUNTIME_PASSWORD" \
  -v "$INIT_DIR:/docker-entrypoint-initdb.d:ro" \
  "$IMAGE")

stable=0
for _ in $(seq 1 200); do
  if docker exec -e PGPASSWORD="$MIGRATOR_PASSWORD" "$CID" \
    psql -U vc_migrator -d vc -t -A -c "SELECT 1" >/dev/null 2>&1; then
    stable=$((stable + 1))
    [ "$stable" -ge 3 ] && break
  else
    stable=0
  fi
  sleep 0.5
done
[ "$stable" -ge 3 ] || { echo "database did not become stable-ready" >&2; exit 3; }

for migration in $(ls "$MIG_DIR"/V*.sql | sort -V); do
  docker exec -i -e PGPASSWORD="$MIGRATOR_PASSWORD" "$CID" \
    psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q < "$migration"
done

ATTRS=$(docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" "$CID" \
  psql -U vc_runtime_login -d vc -t -A -F '|' -c \
  "SELECT current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
          has_schema_privilege(current_user, 'vc', 'CREATE'),
          pg_has_role(current_user, 'vc_api', 'MEMBER'),
          pg_has_role(current_user, 'vc_worker', 'MEMBER'),
          pg_has_role(current_user, 'vc_job_coordinator', 'MEMBER'),
          pg_has_role(current_user, 'vc_dispatcher', 'MEMBER')
     FROM pg_roles WHERE rolname=current_user")
[ "$ATTRS" = "vc_runtime_login|f|f|f|f|f|t|t|t|t" ] || {
  echo "runtime role attributes invalid: $ATTRS" >&2; exit 10;
}

if docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" "$CID" \
  psql -U vc_runtime_login -d vc -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE vc.runtime_must_not_create(id int)" >/dev/null 2>&1; then
  echo "runtime unexpectedly created a table" >&2; exit 11
fi
if docker exec -e PGPASSWORD="$RUNTIME_PASSWORD" "$CID" \
  psql -U vc_runtime_login -d vc -v ON_ERROR_STOP=1 -q -c \
  "SELECT secret FROM vc._owner_binding_secret" >/dev/null 2>&1; then
  echo "runtime unexpectedly read owner-binding secret" >&2; exit 12
fi

# Migrator remains able to apply schema changes; this temporary object is removed.
docker exec -e PGPASSWORD="$MIGRATOR_PASSWORD" "$CID" \
  psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE vc.migrator_probe(id int); DROP TABLE vc.migrator_probe"

echo "ROLE SEPARATION DRILL PASS"
