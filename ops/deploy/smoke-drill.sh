#!/usr/bin/env bash
# DEPLOY smoke drill (R47): proves the production topology boots and that the
# production profile is genuinely fail-closed — a missing at-rest key refuses
# startup BEFORE any bean exists. Runs entirely on localhost.
#
# Prereqs: docker compose v2; ./mvnw verify output jar (built on demand when
# JAVA_HOME points at JDK 25); frontend/dist (built on demand via pnpm).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENVFILE="$ROOT/ops/deploy/.env.smoke"
COMPOSE="docker compose --env-file $ENVFILE -f $ROOT/ops/deploy/docker-compose.yml -p vc-smoke"

cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== build artifacts =="
if ! ls "$ROOT"/service/apps/runtime/target/virtual-companion-runtime-*.jar >/dev/null 2>&1; then
    echo "  runtime jar missing -> ./mvnw verify"
    export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 25 2>/dev/null)}"
    (cd "$ROOT" && ./mvnw --batch-mode --no-transfer-progress -DskipTests package >/dev/null)
fi
if [ ! -f "$ROOT/frontend/dist/index.html" ]; then
    echo "  H5 dist missing -> pnpm build"
    (cd "$ROOT" && pnpm --dir frontend build >/dev/null)
fi

echo "== fail-closed: production without VC_CRYPTO_REST_KEY must refuse startup =="
KEY32=$(openssl rand -base64 32)
# Run the jar directly (compose interpolation would demand every :? secret
# up front, which is exactly what this step refuses to provide).
JAR=$(ls "$ROOT"/service/apps/runtime/target/virtual-companion-runtime-*.jar | head -1)
# JDK 25 resolution: java_home may fall back to the default JVM even for an
# unmatched -v, so verify the reported version before trusting it.
JDK25="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
if [ -z "$JDK25" ] || ! "$JDK25/bin/java" -version 2>&1 | grep -q 'version "25'; then
    JDK25="/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home"
fi
JAVA_BIN="$JDK25/bin/java"
if env SPRING_PROFILES_ACTIVE=production \
    VC_AUTH_ENABLED=true VC_AUTH_DATASOURCE_ENABLED=true \
    VC_FLYWAY_ENABLED=false \
    VC_JWT_SECRET="$KEY32" VC_OWNER_BINDING_SECRET="$KEY32" \
    "$JAVA_BIN" -jar "$JAR" \
    >"$ROOT/ops/deploy/smoke-failclosed.log" 2>&1; then
    echo "FAIL: production started without the at-rest key" >&2
    exit 5
fi
grep -q "VC_CRYPTO_REST_KEY" "$ROOT/ops/deploy/smoke-failclosed.log" \
    || { echo "FAIL: refusal was not about the crypto key" >&2; cat "$ROOT/ops/deploy/smoke-failclosed.log" >&2; exit 6; }
echo "  OK: refused with 'VC_CRYPTO_REST_KEY ... rejected'"

echo "== full stack up =="
cat > "$ENVFILE" <<EOF
VC_DOMAIN=localhost
VC_POSTGRES_PASSWORD=smoke-postgres
VC_JWT_SECRET=$KEY32
VC_OWNER_BINDING_SECRET=$KEY32
VC_CRYPTO_REST_KEY=$KEY32
EOF
$COMPOSE up -d --build >>"$ROOT/ops/deploy/smoke-up.log" 2>&1

echo "== health + H5 + API probes =="
ok=0
for _ in $(seq 1 60); do
    if curl -sk -m 3 https://localhost/actuator/health | grep -q '"UP"'; then ok=1; break; fi
    sleep 2
done
[ "$ok" = 1 ] || { echo "FAIL: health never went UP (see smoke-up.log)" >&2; exit 7; }
curl -sk -m 3 https://localhost/ | grep -q '<div id="app">' \
    || { echo "FAIL: H5 shell not served" >&2; exit 8; }
code=$(curl -sk -m 3 -o /dev/null -w '%{http_code}' https://localhost/api/v1/version)
[ "$code" = 200 ] || { echo "FAIL: /api/v1/version got $code" >&2; exit 9; }
echo "  OK: health UP, H5 shell served, public version API 200"

echo "== ALL SMOKE PHASES PASS =="
