#!/usr/bin/env bash
# G11 switchover drill (Phase 5 rehearsal): Auth/H5 + generation plane
# 同窗口 maintenance/drain/cutover/rollback rehearsal, synthetic smoke only.
#
# Proves the mechanical sequence of the Phase 5 cutover (§ "Phase 5") on the
# isolated local stack (Caddy + Java runtime + PostgreSQL 18 + MinIO +
# loopback fake provider, same as the G1 baseline stack) plus a host Go
# companiond:
#
#   Java serves  -> maintenance (edge 503) -> drain (cancel active invocation,
#   no live claims) -> backup (dump + restore-to-check-db) -> negative gate
#   (Go full refuses while Java holds the singleton lease) -> stop Java ->
#   lease released -> Go full acquires lease -> Go smoke (opaque login, SSE,
#   cancel) -> Caddy upstream switches to Go -> rollback: maintenance -> drain
#   Go -> stop Go -> lease released -> DB restored from backup -> Java
#   restarts and serves again.
#
# Never touches production, never calls a real provider, never real user data.
# Synthetic secrets only (.run/compose.env, mode 0600). Never prints secrets.
#
# Prereqs: docker (OrbStack) compose v2, jq, JDK 25 (maven build), Go 1.26.7,
# pnpm NOT required (H5 stub is used; the real H5 bundle is not this drill).
#
# Usage: bash ops/deploy/g11-switchover/run-drill.sh
# Keep the stack up afterwards: G11_KEEP=1 bash ops/deploy/g11-switchover/run-drill.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RUN_DIR="$HERE/.run"
ENVFILE="$RUN_DIR/compose.env"
GO_ENV="$RUN_DIR/go.env"
COMPOSE_FILE="$HERE/compose.yml"
PROJECT="vc-g11"
EDGE="http://127.0.0.1:${G11_CADDY_PORT:-18080}"
G11_GO_PORT="${G11_GO_PORT:-18082}"
GO_BASE="http://127.0.0.1:$G11_GO_PORT"
FAKE_BASE="http://127.0.0.1:${G11_FAKE_PROVIDER_PORT:-19090}"
GO_FAKE_BASE="http://127.0.0.1:${G11_GO_FAKE_PORT:-19091}"
G11_RUNTIME_SCRAPE_PORT="${G11_RUNTIME_SCRAPE_PORT:-18081}"
DB_PORT="${G11_DB_PORT:-5432}"
ADMIN_USER="g11-admin"
CONSENT_VERSION="2026-08"
PERSONA_REF="gentle-listener"
KEEP="${G11_KEEP:-0}"
PASS=0
FAIL=0

mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"

COMPOSE=(docker compose --env-file "$ENVFILE" -f "$COMPOSE_FILE" -p "$PROJECT")

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

phase() { printf '\n== %s ==\n' "$1"; }

pass() { PASS=$((PASS + 1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL: %s\n' "$1" >&2; }

die() { printf 'FATAL: %s\n' "$1" >&2; exit 1; }

psql_q() { "${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -tAc "$1"; }

wait_http() { # wait_http <url> <timeout_s> [expected_status]
  local url="$1" timeout="$2" want="${3:-200}" i=0
  while [ "$i" -lt "$timeout" ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)
    if [ "$code" = "$want" ]; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  log "wait_http timeout: $url want=$want last=$code"
  return 1
}

# java_* helpers talk to the edge while the Java runtime is upstream.
JAR_COOKIE="$RUN_DIR/java.cookies"
ORIGIN="http://localhost"
java_login() { # java_login <username> <password>
  curl -s -X POST "$EDGE/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"$1\",\"password\":\"$2\"}"
}
java_token() { java_login "$ADMIN_USER" "$VC_ADMIN_PASSWORD" | jq -r '.accessToken // empty'; }

# go_* helpers talk to the Go runtime (direct or via edge) with the opaque
# session cookie jar + double-submit CSRF header + same-origin Origin.
go_login() { # go_login <base> <username> <password>
  local base="$1"
  curl -s -c "$JAR_COOKIE" -X POST "$base/api/v1/auth/login" \
    -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
    -d "{\"username\":\"$2\",\"password\":\"$3\"}"
}
go_csrf() { awk '$6 == "vc_csrf" { print $7 }' "$JAR_COOKIE" | tail -1; }
go_api() { # go_api <base> <method> <path> [json-body]
  local base="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -b "$JAR_COOKIE" -X "$method" "$base$path"
    -H "X-CSRF-Token: $(go_csrf)" -H 'Content-Type: application/json'
    -H "Origin: $ORIGIN")
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  curl "${args[@]}"
}

# terminal statuses of the Java generation contract (G1 workload).
JAVA_TERMINAL="COMPLETED COMPLETED_FALLBACK CANCELLED INPUT_BLOCKED OUTPUT_BLOCKED FAILED_FINAL"
JAVA_DIRECT="http://127.0.0.1:${G11_RUNTIME_SCRAPE_PORT:-18081}"
java_status() { # java_status <base> <generation_id> <token>
  curl -s -H "Authorization: Bearer $3" \
    "$1/api/v1/generations/$2/snapshot" > "$RUN_DIR/java-snap.json" || true
  jq -r '.status // "UNKNOWN"' "$RUN_DIR/java-snap.json"
}
go_status() { # go_status <generation_id> <base>
  go_api "$2" GET "/api/v1/generations/$1/snapshot" | jq -r '.status // "UNKNOWN"'
}
is_terminal() { for s in $JAVA_TERMINAL; do [ "$s" = "$1" ] && return 0; done; return 1; }

cleanup() {
  if [ -f "$RUN_DIR/companiond.pid" ]; then
    kill "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null || true
    rm -f "$RUN_DIR/companiond.pid"
  fi
  # On a failed drill the stack stays up for diagnosis (the .done marker is
  # only written by the success path); G11_KEEP=1 always keeps it up.
  if [ "$KEEP" = "1" ] || [ ! -f "$RUN_DIR/.done" ]; then
    log "keeping the stack up for diagnosis (G11_KEEP=1 or drill incomplete)"
  else
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  # .run/ (drill.log + synthetic secrets, gitignored) is always kept.
  log "artifacts and log kept in $RUN_DIR"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
phase "P0 preflight"
docker info >/dev/null 2>&1 || die "docker daemon unreachable"
command -v jq >/dev/null || die "jq is required"
JDK25="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
if [ -z "$JDK25" ] || ! "$JDK25/bin/java" -version 2>&1 | grep -q 'version "25'; then
  JDK25="/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home"
fi
[ -x "$JDK25/bin/java" ] || die "JDK 25 not found (needed for the Java runtime jar build)"
export PATH="$HOME/.local/go/bin:$PATH"
go version >/dev/null 2>&1 || die "go 1.26.x not found (expected at ~/.local/go/bin/go)"
pass "preflight (docker, jq, JDK 25, go)"

# ---------------------------------------------------------------------------
phase "P1 build artifacts"
JAR=$(ls "$ROOT"/service/apps/runtime/target/virtual-companion-runtime-*.jar 2>/dev/null | head -1 || true)
MIG_DIR="$ROOT/service/platform/persistence/src/main/resources/db/migration"
if [ -z "$JAR" ] || [ -n "$(find "$MIG_DIR" -newer "$JAR" -print -quit 2>/dev/null)" ]; then
  log "rebuilding runtime jar (migrations newer than jar or jar missing)"
  (cd "$ROOT" && JAVA_HOME="$JDK25" ./mvnw --batch-mode --no-transfer-progress -DskipTests package >/dev/null)
  JAR=$(ls "$ROOT"/service/apps/runtime/target/virtual-companion-runtime-*.jar | head -1)
fi
[ -n "$JAR" ] || die "runtime jar not produced"
log "jar: $JAR"
go build -C "$ROOT/backend" -o "$RUN_DIR/companiond" ./cmd/companiond
pass "artifacts (jar, companiond binary)"

# ---------------------------------------------------------------------------
phase "P2 secrets + stack up"
VC_MIGRATOR_DB_PASSWORD=$(openssl rand -hex 32)
VC_RUNTIME_DB_PASSWORD=$(openssl rand -hex 32)
VC_JWT_SECRET=$(openssl rand -hex 32)
VC_OWNER_BINDING_SECRET=$(openssl rand -hex 32)
VC_SHARED_RATE_LIMIT_SECRET=$(openssl rand -hex 32)
VC_CRYPTO_REST_KEY=$(openssl rand -base64 32 | tr -d '\n')
# Java admin password policy: uppercase + lowercase + digit + symbol.
VC_ADMIN_PASSWORD="G11-$(openssl rand -hex 12)!"
VC_MODEL_SECRET_G1_CRED=$(openssl rand -hex 16)
VC_EXPORT_S3_ACCESS_KEY=$(openssl rand -hex 20)
VC_EXPORT_S3_SECRET_KEY=$(openssl rand -hex 20)
umask 077
cat > "$ENVFILE" <<EOF
VC_DOMAIN=localhost
VC_MIGRATOR_DB_PASSWORD=$VC_MIGRATOR_DB_PASSWORD
VC_RUNTIME_DB_PASSWORD=$VC_RUNTIME_DB_PASSWORD
VC_JWT_SECRET=$VC_JWT_SECRET
VC_OWNER_BINDING_SECRET=$VC_OWNER_BINDING_SECRET
VC_SHARED_RATE_LIMIT_SECRET=$VC_SHARED_RATE_LIMIT_SECRET
VC_CRYPTO_REST_KEY=$VC_CRYPTO_REST_KEY
VC_ADMIN_USERNAME=$ADMIN_USER
VC_ADMIN_PASSWORD=$VC_ADMIN_PASSWORD
VC_ADMIN_DISPLAY_NAME=G11 Admin
VC_MODEL_SECRET_G1_CRED=$VC_MODEL_SECRET_G1_CRED
VC_EXPORT_S3_ACCESS_KEY=$VC_EXPORT_S3_ACCESS_KEY
VC_EXPORT_S3_SECRET_KEY=$VC_EXPORT_S3_SECRET_KEY
G11_HOLD_MS=0
G11_UPSTREAM=runtime:8080
EOF
umask 022
"${COMPOSE[@]}" up -d --build >/dev/null
wait_http "$EDGE/actuator/health" 120 || die "Java runtime not healthy via edge within 120s"
# Java must hold the vc.runtime.singleton advisory lease (same key as Go).
[ "$(psql_q "SELECT pg_try_advisory_lock(hashtext('vc.runtime.singleton'))")" = "f" ] \
  || die "expected Java to hold the generation plane lease"
pass "stack up; Java healthy and holds the generation plane lease"

# ---------------------------------------------------------------------------
phase "P2.5 release gate + provider seed (same as the G1 baseline seed)"
"${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'g11-drill-v1');
INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
VALUES ('g11-openai', 'OPENAI_CHAT_COMPLETIONS', '{}', 'ADMITTED')
ON CONFLICT (provider_id) DO UPDATE
   SET admission_state = 'ADMITTED', protocol = 'OPENAI_CHAT_COMPLETIONS';
INSERT INTO vc.model_unit_price(
    provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k,
    effective_from, active)
VALUES ('g11-openai', 'g1-model', 1, 0.001, 0.002, now(), true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
SQL
pass "release gate BETA open; provider deployment ADMITTED; model priced"

# ---------------------------------------------------------------------------
phase "P3 Java serving (synthetic smoke through the edge)"
# Generation requires an ACTIVE role=USER owner; the admin provisions one
# (same as the G1 workload), then the USER runs the whole journey.
USER_USER="g11-user-1"
USER_PASS="G11-U$(openssl rand -hex 8)!"
TOKEN="$(java_token)"
[ -n "$TOKEN" ] || die "Java admin login failed"
curl -s -X POST "$EDGE/api/v1/auth/admin/accounts" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER_USER\",\"password\":\"$USER_PASS\",\"displayName\":\"G11 user 1\",\"role\":\"USER\"}" >/dev/null
USER_TOKEN="$(java_login "$USER_USER" "$USER_PASS" | jq -r '.accessToken // empty')"
[ -n "$USER_TOKEN" ] || die "Java user login failed"
curl -s -X POST "$EDGE/api/v1/age/verification" -H "Authorization: Bearer $USER_TOKEN" >/dev/null
for t in SERVICE_TERMS PRIVACY_POLICY AI_CONTENT_NOTICE THIRD_PARTY_MODEL_PROCESSING SENSITIVE_DATA_PROCESSING; do
  curl -s -X PUT "$EDGE/api/v1/consents" -H "Authorization: Bearer $USER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"consentType\":\"$t\",\"version\":\"$CONSENT_VERSION\",\"granted\":true}" >/dev/null
done
REL=$(curl -s -X POST "$EDGE/api/v1/relationships" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"personaRef\":\"$PERSONA_REF\"}" | jq -r '.relationshipId // empty')
[ -n "$REL" ] || die "Java relationship creation failed"
JAVA_CONV=$(curl -s -X POST "$EDGE/api/v1/conversations" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' -d "{\"relationshipId\":\"$REL\"}" | jq -r '.conversationId // empty')
[ -n "$JAVA_CONV" ] || die "Java conversation creation failed"
GEN=$(curl -s -X POST "$EDGE/api/v1/conversations/$JAVA_CONV/generations" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"g11-java-1","userContent":"hello from the drill"}' > "$RUN_DIR/java-send.json" || true; jq -r '.generationId // empty' "$RUN_DIR/java-send.json")
[ -n "$GEN" ] || die "Java send failed: $(head -c 300 "$RUN_DIR/java-send.json")"
st=""
for _ in $(seq 1 120); do
  st="$(java_status "$EDGE" "$GEN" "$USER_TOKEN")"
  is_terminal "$st" && break
  sleep 1
done
[ "$st" = "COMPLETED" ] || die "Java generation did not complete (status=$st)"
pass "Java generation COMPLETED via edge (fake provider)"

# ---------------------------------------------------------------------------
phase "P4 maintenance entry + drain (cancel active invocation)"
# Slow provider so a generation stays in-flight. It is sent BEFORE the
# maintenance reload — the drain step then cancels it through the direct
# runtime port (the operator path), because the maintenance edge answers 503
# to everything.
sed -i.bak 's/^G11_HOLD_MS=.*/G11_HOLD_MS=15000/' "$ENVFILE" && rm -f "$ENVFILE.bak"
"${COMPOSE[@]}" up -d --force-recreate fake-provider >/dev/null
GEN_SLOW=$(curl -s -X POST "$EDGE/api/v1/conversations/$JAVA_CONV/generations" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"g11-java-slow","userContent":"slow turn"}' | jq -r '.generationId // empty')
[ -n "$GEN_SLOW" ] || die "Java slow send failed"
in_flight=0
for _ in $(seq 1 20); do
  st="$(java_status "$JAVA_DIRECT" "$GEN_SLOW" "$USER_TOKEN")"
  if ! is_terminal "$st"; then in_flight=1; break; fi
  sleep 1
done
[ "$in_flight" = "1" ] || die "slow generation was not in-flight when drain started"
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile.maintenance >/dev/null
wait_http "$EDGE/api/v1/version" 10 503 || die "edge did not enter maintenance (503)"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$EDGE/")" = "503" ] || die "SPA shell not in maintenance"
pass "edge answers 503 in maintenance (no new admission)"
curl -s -X POST "$JAVA_DIRECT/api/v1/generations/$GEN_SLOW/cancel" -H "Authorization: Bearer $USER_TOKEN" >/dev/null
st=""
for _ in $(seq 1 40); do
  st="$(java_status "$JAVA_DIRECT" "$GEN_SLOW" "$USER_TOKEN")"
  is_terminal "$st" && break
  sleep 1
done
[ "$st" = "CANCELLED" ] || die "slow generation did not cancel (status=$st)"
sed -i.bak 's/^G11_HOLD_MS=.*/G11_HOLD_MS=0/' "$ENVFILE" && rm -f "$ENVFILE.bak"
"${COMPOSE[@]}" up -d --force-recreate fake-provider >/dev/null
live_claims=$(psql_q "SELECT count(*) FROM vc.work_item WHERE status = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at > clock_timestamp()")
[ "$live_claims" = "0" ] || die "live work_item claims remain after drain ($live_claims)"
pass "drain: in-flight invocation cancelled, no live claims"

# ---------------------------------------------------------------------------
phase "P5 backup (fix point) + restore-to-check proof"
"${COMPOSE[@]}" exec -T db pg_dump -U vc_migrator -Fc -d vc > "$RUN_DIR/precutover.dump"
[ -s "$RUN_DIR/precutover.dump" ] || die "pg_dump produced an empty dump"
# pg_restore lives inside the db image; -l reads the dump from stdin.
# Buffer the TOC first: grep -q on a live pipe SIGPIPEs pg_restore, which
# pipefail would misread as a failure.
"${COMPOSE[@]}" exec -T db pg_restore -l < "$RUN_DIR/precutover.dump" > "$RUN_DIR/precutover.toc"
grep -q "go_claim_jobs" "$RUN_DIR/precutover.toc" || die "dump misses V117 go_claim_jobs"
grep -q "go_monthly_cost" "$RUN_DIR/precutover.toc" || die "dump misses V117 go_monthly_cost"
grep -q "attempt_intent" "$RUN_DIR/precutover.toc" || die "dump misses attempt_intent"
for tbl in vc.generation vc.attempt_intent vc.work_item vc.message; do
  psql_q "SELECT '$tbl' || ' ' || count(*) FROM $tbl" >> "$RUN_DIR/precutover.counts"
done
"${COMPOSE[@]}" exec -T db psql -U vc_migrator -d postgres -c "DROP DATABASE IF EXISTS vc_precutover_check" >/dev/null
"${COMPOSE[@]}" exec -T db psql -U vc_migrator -d postgres -c "CREATE DATABASE vc_precutover_check" >/dev/null
"${COMPOSE[@]}" exec -T db pg_restore -U vc_migrator -d vc_precutover_check < "$RUN_DIR/precutover.dump" >/dev/null
while read -r tbl want; do
  got=$("${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc_precutover_check -tAc "SELECT count(*) FROM $tbl")
  [ "$got" = "$want" ] || die "restore check: $tbl count $got != $want"
done < "$RUN_DIR/precutover.counts"
"${COMPOSE[@]}" exec -T db psql -U vc_migrator -d postgres -c "DROP DATABASE vc_precutover_check" >/dev/null
pass "backup fixed; dump restores with identical row counts"

# ---------------------------------------------------------------------------
phase "P6 negative gate: Go full refuses while Java holds the lease"
cat > "$GO_ENV" <<EOF
VC_MODE=full
VC_HTTP_ADDR=127.0.0.1:$G11_GO_PORT
VC_HTTP_ORIGINS=http://localhost
VC_DB_DSN=postgres://vc_runtime_login:$VC_RUNTIME_DB_PASSWORD@127.0.0.1:$DB_PORT/vc?sslmode=disable
VC_CRYPTO_REST_KEY=$VC_CRYPTO_REST_KEY
VC_OWNER_BINDING_SECRET=$VC_OWNER_BINDING_SECRET
VC_JWT_SECRET=$VC_JWT_SECRET
VC_AUTH_ISSUER=virtual-companion
VC_PROVIDER_ENABLED=true
VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true
VC_PROVIDER_ENDPOINT=$GO_FAKE_BASE/v1/chat/completions
VC_PROVIDER_TOKEN=g11-fake-token
VC_PROVIDER_MODEL=g1-model
VC_LOG_LEVEL=info
EOF
chmod 600 "$GO_ENV"
if env $(cat "$GO_ENV") "$RUN_DIR/companiond" > "$RUN_DIR/companiond.negative.log" 2>&1; then
  die "Go full started while Java held the generation plane lease"
fi
grep -q "generation plane lease refused" "$RUN_DIR/companiond.negative.log" \
  || die "Go refusal was not about the generation plane lease"
# The edge is still in maintenance (503 for everything), so probe Java directly.
[ "$(curl -s -o /dev/null -w '%{http_code}' "$JAVA_DIRECT/actuator/health")" = "200" ] || die "Java unhealthy after Go refusal"
pass "Go full refused while Java holds the lease; Java still serving"

# ---------------------------------------------------------------------------
phase "P7 stop Java; lease released"
"${COMPOSE[@]}" stop runtime >/dev/null
held=$(psql_q "SELECT pg_try_advisory_lock(hashtext('vc.runtime.singleton'))")
[ "$held" = "t" ] || die "generation plane lease not released after Java stop"
psql_q "SELECT pg_advisory_unlock(hashtext('vc.runtime.singleton'))" >/dev/null
pass "Java stopped; generation plane lease released"

# ---------------------------------------------------------------------------
phase "P8 Go full acquires the lease and serves"
env $(cat "$GO_ENV") "$RUN_DIR/companiond" > "$RUN_DIR/companiond.log" 2>&1 &
echo $! > "$RUN_DIR/companiond.pid"
wait_http "$GO_BASE/actuator/health" 60 || die "Go companiond not healthy"
held=$(psql_q "SELECT pg_try_advisory_lock(hashtext('vc.runtime.singleton'))")
[ "$held" = "f" ] || die "Go did not hold the generation plane lease"
pass "Go full healthy and holds the generation plane lease"

# ---------------------------------------------------------------------------
phase "P9 Go synthetic smoke (opaque auth, SSE, cancel)"
go_login "$GO_BASE" "$USER_USER" "$USER_PASS" | jq -e '.accountId != null' >/dev/null \
  || die "Go opaque login failed"
[ -n "$(go_csrf)" ] || die "Go login did not set the CSRF cookie"
for t in SERVICE_TERMS PRIVACY_POLICY AI_CONTENT_NOTICE THIRD_PARTY_MODEL_PROCESSING SENSITIVE_DATA_PROCESSING; do
  go_api "$GO_BASE" PUT /api/v1/consents "{\"consentType\":\"$t\",\"version\":\"$CONSENT_VERSION\",\"granted\":true}" \
    | jq -e '.type == "'"$t"'" or .consentType == "'"$t"'"' >/dev/null || die "Go consent $t failed"
done
REL=$(go_api "$GO_BASE" POST /api/v1/relationships "{\"personaRef\":\"$PERSONA_REF\"}" | jq -r '.relationshipId // empty')
[ -n "$REL" ] || die "Go relationship creation failed"
GO_CONV=$(go_api "$GO_BASE" POST /api/v1/conversations "{\"relationshipId\":\"$REL\"}" | jq -r '.conversationId // empty')
[ -n "$GO_CONV" ] || die "Go conversation creation failed"
GEN=$(go_api "$GO_BASE" POST "/api/v1/conversations/$GO_CONV/generations" \
  '{"idempotencyKey":"g11-go-1","userContent":"hello from Go"}' | jq -r '.generationId // empty')
[ -n "$GEN" ] || die "Go send failed"
# The hub stream is snapshot-only while the worker has not claimed the
# generation yet (or already terminal), so re-subscribe until the stream
# carries a terminal event. This covers subscribe-before-claim,
# mid-stream, and after-terminal races alike.
sse_ok=0
for _ in $(seq 1 30); do
  curl -s -N -b "$JAR_COOKIE" -H "Origin: $ORIGIN" --max-time 20 \
    "$GO_BASE/api/v1/realtime/streams/$GEN" > "$RUN_DIR/go.sse" || true
  if grep -q "event: chat.failed" "$RUN_DIR/go.sse"; then
    die "Go generation failed (see .run/go.sse)"
  fi
  if grep -qE "event: chat.completed|event: chat.cancelled|event: chat.blocked" "$RUN_DIR/go.sse"; then
    sse_ok=1
    break
  fi
  sleep 1
done
[ "$sse_ok" = "1" ] || die "Go SSE missing a terminal event (worker never streamed?)"
grep -q "event: chat.snapshot" "$RUN_DIR/go.sse" || die "Go SSE missing chat.snapshot"
st="$(go_status "$GEN" "$GO_BASE")"
[ "$st" = "COMPLETED" ] || die "Go generation did not complete (status=$st)"
pass "Go smoke: opaque login, send, SSE snapshot/completed, COMPLETED"

# Cancel-during-stream through the real Go server (drain rehearsal on Go side).
sed -i.bak 's/^G11_HOLD_MS=.*/G11_HOLD_MS=15000/' "$ENVFILE" && rm -f "$ENVFILE.bak"
"${COMPOSE[@]}" up -d --force-recreate go-fake-provider >/dev/null
GEN_SLOW=$(go_api "$GO_BASE" POST "/api/v1/conversations/$GO_CONV/generations" \
  '{"idempotencyKey":"g11-go-slow","userContent":"slow go turn"}' | jq -r '.generationId // empty')
[ -n "$GEN_SLOW" ] || die "Go slow send failed"
claims=0
for _ in $(seq 1 20); do
  claims=$(psql_q "SELECT count(*) FROM vc.work_item WHERE kind='GENERATION' AND status = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at > clock_timestamp()")
  [ "$claims" -ge 1 ] && break
  sleep 1
done
[ "$claims" -ge 1 ] || die "Go slow generation was not claimed"
go_api "$GO_BASE" POST "/api/v1/generations/$GEN_SLOW/cancel" >/dev/null
st=""
for _ in $(seq 1 60); do
  st="$(go_status "$GEN_SLOW" "$GO_BASE")"
  is_terminal "$st" && break
  sleep 1
done
[ "$st" = "CANCELLED" ] || die "Go slow generation did not cancel (status=$st)"
claims=$(psql_q "SELECT count(*) FROM vc.work_item WHERE status = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at > clock_timestamp()")
[ "$claims" = "0" ] || die "Go live claims remain after cancel ($claims)"
sed -i.bak 's/^G11_HOLD_MS=.*/G11_HOLD_MS=0/' "$ENVFILE" && rm -f "$ENVFILE.bak"
"${COMPOSE[@]}" up -d --force-recreate go-fake-provider >/dev/null
go_api "$GO_BASE" POST /api/v1/auth/logout >/dev/null
pass "Go cancel-during-stream -> CANCELLED, no live claims"

# ---------------------------------------------------------------------------
phase "P10 edge cutover to Go"
"${COMPOSE[@]}" exec -T -e G11_UPSTREAM=host.docker.internal:$G11_GO_PORT caddy caddy reload \
  --config /etc/caddy/Caddyfile >/dev/null
wait_http "$EDGE/actuator/health" 30 || die "edge did not reach Go"
rm -f "$JAR_COOKIE"
go_login "$EDGE" "$USER_USER" "$USER_PASS" | jq -e '.accountId != null' >/dev/null \
  || die "edge opaque login (Go) failed"
GEN_EDGE=$(go_api "$EDGE" POST "/api/v1/conversations/$GO_CONV/generations" \
  '{"idempotencyKey":"g11-go-edge","userContent":"through the edge"}' | jq -r '.generationId // empty')
[ -n "$GEN_EDGE" ] || die "edge send to Go failed"
st=""
for _ in $(seq 1 60); do
  st="$(go_status "$GEN_EDGE" "$EDGE")"
  is_terminal "$st" && break
  sleep 1
done
[ "$st" = "COMPLETED" ] || die "edge Go generation did not complete (status=$st)"
pass "Caddy upstream switched to Go; opaque login + generation COMPLETED via edge"

# ---------------------------------------------------------------------------
phase "P11 rollback rehearsal"
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile.maintenance >/dev/null
wait_http "$EDGE/api/v1/version" 10 503 || die "edge did not re-enter maintenance"
claims=$(psql_q "SELECT count(*) FROM vc.work_item WHERE status = 'CLAIMED' AND lease_expires_at IS NOT NULL AND lease_expires_at > clock_timestamp()")
[ "$claims" = "0" ] || die "Go claims remain before rollback stop ($claims)"
kill "$(cat "$RUN_DIR/companiond.pid")"
for _ in $(seq 1 30); do
  kill -0 "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null || break
  sleep 1
done
kill -0 "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null && die "companiond did not exit on SIGTERM"
rm -f "$RUN_DIR/companiond.pid"
held=$(psql_q "SELECT pg_try_advisory_lock(hashtext('vc.runtime.singleton'))")
[ "$held" = "t" ] || die "Go did not release the lease on stop"
psql_q "SELECT pg_advisory_unlock(hashtext('vc.runtime.singleton'))" >/dev/null
pass "Go stopped cleanly; lease released"

# Restore the pre-cutover dump over the live DB (the rollback data path).
"${COMPOSE[@]}" exec -T db pg_restore --clean --if-exists -U vc_migrator -d vc \
  < "$RUN_DIR/precutover.dump" >/dev/null
while read -r tbl want; do
  got=$(psql_q "SELECT count(*) FROM $tbl")
  [ "$got" = "$want" ] || die "post-rollback restore: $tbl count $got != $want"
done < "$RUN_DIR/precutover.counts"
pass "DB restored from the pre-cutover dump (row counts match)"

"${COMPOSE[@]}" start runtime >/dev/null
# The edge is still in maintenance, so wait on the Java port directly
# (G1 compose publishes the runtime scrape port, default 18081).
wait_http "http://127.0.0.1:${G11_RUNTIME_SCRAPE_PORT:-18081}/actuator/health" 120 \
  || die "Java did not come back healthy"
# The Java loopback fake provider shares the runtime netns; give it a fresh
# process now that the runtime is back up.
"${COMPOSE[@]}" up -d --force-recreate fake-provider >/dev/null
held=$(psql_q "SELECT pg_try_advisory_lock(hashtext('vc.runtime.singleton'))")
[ "$held" = "f" ] || die "Java did not re-acquire the lease"
"${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
java_login "$USER_USER" "$USER_PASS" > "$RUN_DIR/rb-login.json" || true
USER_TOKEN="$(jq -r '.accessToken // empty' "$RUN_DIR/rb-login.json")"
[ -n "$USER_TOKEN" ] || die "Java user login after rollback failed: $(head -c 300 "$RUN_DIR/rb-login.json")"
curl -s -X POST "$EDGE/api/v1/conversations/$JAVA_CONV/generations" -H "Authorization: Bearer $USER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"idempotencyKey":"g11-rollback-1","userContent":"after rollback"}' > "$RUN_DIR/rb-send.json" || true
GEN_RB="$(jq -r '.generationId // empty' "$RUN_DIR/rb-send.json")"
[ -n "$GEN_RB" ] || die "Java send after rollback failed: $(head -c 300 "$RUN_DIR/rb-send.json")"
st=""
for _ in $(seq 1 120); do
  curl -s -H "Authorization: Bearer $USER_TOKEN" \
    "$EDGE/api/v1/generations/$GEN_RB/snapshot" > "$RUN_DIR/rb-snap.json" || true
  st="$(jq -r '.status // "UNKNOWN"' "$RUN_DIR/rb-snap.json")"
  is_terminal "$st" && break
  sleep 1
done
[ "$st" = "COMPLETED" ] || die "Java generation after rollback did not complete (status=$st; body=$(head -c 300 "$RUN_DIR/rb-snap.json"))"
pass "rollback: Java re-acquired the lease and serves COMPLETED via the edge"

# ---------------------------------------------------------------------------
printf '\n== drill summary ==\n  PASS %d  FAIL %d\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
touch "$RUN_DIR/.done"
echo "G11 switchover drill PASS"
