#!/usr/bin/env bash
# Disposable production-topology smoke: Go migrator/bootstrap/runtime, H5, DB and MinIO.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENVFILE="$ROOT/ops/deploy/.env.smoke"
MIGRATION_DIR="$ROOT/backend/internal/migrate/sql"
MIGRATION_VERSIONS="$(mktemp "${TMPDIR:-/tmp}/vc-smoke-migrations.XXXXXX")"
COMPOSE=(docker compose --env-file "$ENVFILE" -f "$ROOT/ops/deploy/docker-compose.yml" -p vc-smoke)

cleanup() {
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f -- "$ENVFILE" "$MIGRATION_VERSIONS"
}
trap cleanup EXIT

while IFS= read -r migration_file; do
  migration_name="$(basename "$migration_file")"
  if [[ ! "$migration_name" =~ ^V([0-9]+)__.{1,}\.sql$ ]]; then
    echo "FAIL: invalid migration filename $migration_name" >&2
    exit 10
  fi
  printf '%s\n' "${BASH_REMATCH[1]}" >> "$MIGRATION_VERSIONS"
done < <(find "$MIGRATION_DIR" -maxdepth 1 -type f -name 'V*.sql' -print | sort -V)

sort -n -o "$MIGRATION_VERSIONS" "$MIGRATION_VERSIONS"
if ! expected_history="$(awk '
  NR == 1 { count = 1; min = $1; max = $1; previous = $1; next }
  {
    count++
    if ($1 == previous) {
      printf "duplicate migration version: %s\n", $1 > "/dev/stderr"
      invalid = 1
    } else if ($1 != previous + 1) {
      printf "migration version gap: %s -> %s\n", previous, $1 > "/dev/stderr"
      invalid = 1
    }
    previous = $1
    max = $1
  }
  END {
    if (NR == 0) {
      print "no migrations found" > "/dev/stderr"
      exit 1
    }
    if (invalid) exit 1
    printf "%d|%d|%d", count, min, max
  }
' "$MIGRATION_VERSIONS")"; then
  echo "FAIL: migration files are not a unique continuous sequence" >&2
  exit 10
fi

echo "== build H5 =="
pnpm --dir "$ROOT/frontend" build >/dev/null

MIGRATOR_PASSWORD=$(openssl rand -hex 32)
RUNTIME_PASSWORD=$(openssl rand -hex 32)
OWNER_SECRET=$(openssl rand -base64 32 | tr -d '\n')
REST_KEY=$(openssl rand -base64 32 | tr -d '\n')
MINIO_ACCESS=$(openssl rand -hex 20)
MINIO_SECRET=$(openssl rand -hex 32)
umask 077
cat > "$ENVFILE" <<EOF
VC_DOMAIN=localhost
VC_HTTP_PORT=18080
VC_HTTPS_PORT=18443
VC_MIGRATOR_DB_PASSWORD=$MIGRATOR_PASSWORD
VC_RUNTIME_DB_PASSWORD=$RUNTIME_PASSWORD
VC_OWNER_BINDING_SECRET=$OWNER_SECRET
VC_CRYPTO_REST_KEY=$REST_KEY
VC_ADMIN_SEED_USERNAME=smoke-admin
VC_ADMIN_SEED_PASSWORD=Smoke-Admin-$(openssl rand -hex 8)!
VC_ADMIN_SEED_DISPLAY_NAME=Smoke Admin
VC_EXPORT_S3_ACCESS_KEY=$MINIO_ACCESS
VC_EXPORT_S3_SECRET_KEY=$MINIO_SECRET
VC_EXPORT_S3_BUCKET=vc-smoke-exports
VC_VERSION=smoke
VC_COMMIT=local-smoke
EOF
umask 022

echo "== Go-only stack up =="
"${COMPOSE[@]}" up -d --build

echo "== health + H5 + API probes =="
ready=0
for _ in $(seq 1 90); do
  if curl -sk -m 3 https://localhost:18443/actuator/health | grep -q '"UP"'; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = 1 ] || {
  echo "FAIL: health never went UP" >&2
  "${COMPOSE[@]}" logs --no-color runtime migrate bootstrap >&2 || true
  exit 7
}
curl -sk -m 3 https://localhost:18443/ | grep -q '<div id="app">' \
  || { echo "FAIL: H5 shell not served" >&2; exit 8; }
code=$(curl -sk -m 3 -o /dev/null -w '%{http_code}' https://localhost:18443/api/v1/version)
[ "$code" = 200 ] || { echo "FAIL: /api/v1/version got $code" >&2; exit 9; }

history=$("${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -Atc \
  "SELECT count(*) || '|' || min(version) || '|' || max(version) FROM public.vc_schema_history")
[ "$history" = "$expected_history" ] || {
  echo "FAIL: migration history $history does not match files $expected_history" >&2
  exit 10
}

runtime_command=$("${COMPOSE[@]}" exec -T runtime sh -c \
  "tr '\\0' ' ' </proc/1/cmdline")
case "$runtime_command" in
  /usr/local/bin/companiond*) ;;
  *) echo "FAIL: unexpected runtime command $runtime_command" >&2; exit 11 ;;
esac

echo "== ALL GO-ONLY SMOKE PHASES PASS =="
