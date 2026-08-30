#!/usr/bin/env bash
# G12 Go capacity profile (synthetic): §19.1 场景 5 (4 gen + 8 SSE stable) and
# 场景 10 (16 gen + 64 SSE capacity profile) against the host Go companiond
# `full` mode with a loopback fake provider. Java is NOT part of this run.
#
# Reuses the g11-switchover compose for db + go-fake-provider only. Secrets
# and the opaque session are synthetic and fabricated locally; never a real
# provider, never real user data. Sample numbers are single-trial; §19.2
# gates stay Owner-frozen (≥3 trials per the spec before freezing).
#
# Usage: bash scripts/measure/g12-go-capacity/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RUN_DIR="$HERE/.run"
ENVFILE="$RUN_DIR/compose.env"
COMPOSE_FILE="$ROOT/ops/deploy/g11-switchover/compose.yml"
PROJECT="vc-g12"
GO_PORT="${G12_GO_PORT:-18082}"
GO_BASE="http://127.0.0.1:$GO_PORT"
GO_FAKE_PORT="${G12_GO_FAKE_PORT:-19091}"
DB_PORT="${G12_DB_PORT:-5432}"
GENS_S5="${G12_GENS_S5:-4}"
SSE_S5="${G12_SSE_S5:-2}"
GENS_S10="${G12_GENS_S10:-16}"
SSE_S10="${G12_SSE_S10:-4}"
CONCURRENCY="${G12_CONCURRENCY:-16}"
OUTSTANDING="${G12_OUTSTANDING:-16}"
WARMUP="${G12_WARMUP:-1}"

mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"

COMPOSE=(docker compose --env-file "$ENVFILE" -f "$COMPOSE_FILE" -p "$PROJECT")

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

cleanup() {
  if [ -f "$RUN_DIR/companiond.pid" ]; then
    kill "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null || true
    rm -f "$RUN_DIR/companiond.pid"
  fi
  if [ "${G12_KEEP:-0}" != "1" ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

psql_q() { "${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -tAc "$1"; }

echo "== G12 preflight =="
docker info >/dev/null 2>&1 || { echo "docker unreachable" >&2; exit 1; }
export PATH="$HOME/.local/go/bin:$PATH"
go build -C "$ROOT/backend" -o "$RUN_DIR/companiond" ./cmd/companiond
echo "  companiond built"

echo "== stack up (db + go-fake-provider) =="
VC_MIGRATOR_DB_PASSWORD=$(openssl rand -hex 32)
VC_RUNTIME_DB_PASSWORD=$(openssl rand -hex 32)
VC_CRYPTO_REST_KEY=$(openssl rand -base64 32 | tr -d '\n')
VC_OWNER_BINDING_SECRET=$(openssl rand -hex 32)
VC_JWT_SECRET=$(openssl rand -hex 32)
VC_SHARED_RATE_LIMIT_SECRET=$(openssl rand -hex 32)
umask 077
cat > "$ENVFILE" <<EOF
VC_MIGRATOR_DB_PASSWORD=$VC_MIGRATOR_DB_PASSWORD
VC_RUNTIME_DB_PASSWORD=$VC_RUNTIME_DB_PASSWORD
VC_CRYPTO_REST_KEY=$VC_CRYPTO_REST_KEY
VC_OWNER_BINDING_SECRET=$VC_OWNER_BINDING_SECRET
VC_JWT_SECRET=$VC_JWT_SECRET
VC_SHARED_RATE_LIMIT_SECRET=$VC_SHARED_RATE_LIMIT_SECRET
VC_ADMIN_USERNAME=g12-admin
VC_ADMIN_PASSWORD=G12-$(openssl rand -hex 8)!
VC_MODEL_SECRET_G1_CRED=$(openssl rand -hex 16)
VC_EXPORT_S3_ACCESS_KEY=$(openssl rand -hex 20)
VC_EXPORT_S3_SECRET_KEY=$(openssl rand -hex 20)
G11_HOLD_MS=0
G11_UPSTREAM=runtime:8080
EOF
umask 022
"${COMPOSE[@]}" up -d db go-fake-provider >/dev/null
for _ in $(seq 1 60); do
  docker ps --filter name=vc-g12-db --format "{{.Status}}" | grep -q healthy && break
  sleep 2
done
echo "  db healthy"

echo "== migrations via the Java runtime as the Flyway migrator (§21.2) =="
# The Go side does not run Flyway; the Java runtime applies V1-V117 and
# provisions roles, then stops. Go waits for the singleton lease afterwards.
"${COMPOSE[@]}" up -d runtime >/dev/null
for _ in $(seq 1 150); do
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${G12_RUNTIME_SCRAPE_PORT:-18081}/actuator/health" && break
  sleep 2
done
"${COMPOSE[@]}" stop runtime >/dev/null
echo "  migrations applied; Java stopped"

echo "== seed: release gate / provider / user / session =="
"${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'g12-capacity-v1');
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
INSERT INTO vc.vc_user(id, display_name) VALUES (2000001, 'G12 user')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (2000001, 'g12-user', 'g12-synthetic-hash', 'USER', 'ACTIVE', 'G12 user')
ON CONFLICT (id) DO NOTHING;
SQL
# Fabricate an opaque session: raw = base64url(32 bytes), hash = sha256 hex.
RAW=$(python3 - <<'PY'
import base64, os
print(base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode())
PY
)
HASH=$(printf '%s' "$RAW" | shasum -a 256 | cut -d' ' -f1)
CSRF=$(python3 -c "import secrets; print(secrets.token_hex(32))")
psql_q "SELECT vc.identity_opaque_session_issue(2000001, '$HASH', now() + interval '12 hours')" >/dev/null
echo "  session fabricated"

echo "== start companiond (full, loopback fake provider) =="
cat > "$RUN_DIR/go.env" <<EOF
VC_MODE=full
VC_HTTP_ADDR=127.0.0.1:$GO_PORT
VC_HTTP_ORIGINS=http://localhost
VC_DB_DSN=postgres://vc_runtime_login:$VC_RUNTIME_DB_PASSWORD@127.0.0.1:$DB_PORT/vc?sslmode=disable
VC_CRYPTO_REST_KEY=$VC_CRYPTO_REST_KEY
VC_OWNER_BINDING_SECRET=$VC_OWNER_BINDING_SECRET
VC_JWT_SECRET=$VC_JWT_SECRET
VC_AUTH_ISSUER=virtual-companion
VC_PROVIDER_ENABLED=true
VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true
VC_PROVIDER_ENDPOINT=http://127.0.0.1:$GO_FAKE_PORT/v1/chat/completions
VC_PROVIDER_TOKEN=g12-fake-token
VC_PROVIDER_MODEL=g1-model
VC_MAX_OUTSTANDING_TURNS=$OUTSTANDING
VC_MAX_CONCURRENT_TURNS=$CONCURRENCY
VC_LOG_LEVEL=info
EOF
chmod 600 "$RUN_DIR/go.env"
env $(cat "$RUN_DIR/go.env") "$RUN_DIR/companiond" > "$RUN_DIR/companiond.log" 2>&1 &
echo $! > "$RUN_DIR/companiond.pid"
for _ in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 "$GO_BASE/actuator/health" && break
  sleep 1
done
echo "  companiond healthy on :$GO_PORT"

# RSS/CPU sampler (macOS ps: rss in KB, %cpu is decaying average, time is
# cumulative). Samples every 0.5s into sample.csv.
(
  while [ -f "$RUN_DIR/companiond.pid" ]; do
    ps -o rss=,%cpu=,time= -p "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null \
      | awk -v t="$(date +%s.%N)" '{print t "," $1 "," $2 "," $3}' >> "$RUN_DIR/sample.csv"
    sleep 0.5
  done
) &
SAMPLER=$!

run_scenario() {
  local name="$1" gens="$2" sse="$3"
  echo "== scenario $name: $gens generation + $((gens * sse)) SSE =="
  python3 "$HERE/workload.py" --base "$GO_BASE" --scenario "$name" \
    --gens "$gens" --sse-per-gen "$sse" --session "$RAW" --csrf "$CSRF" \
    > "$RUN_DIR/$name.json" || echo "  workload exit=$? (errors above)"
  python3 - "$RUN_DIR/$name.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
s = r["stats"]
print(f"  intake p50/p95/max = {s['intake_ms']['p50']}/{s['intake_ms']['p95']}/{s['intake_ms']['max']} ms")
print(f"  terminal p50/p95/max = {s['terminal_ms']['p50']}/{s['terminal_ms']['p95']}/{s['terminal_ms']['max']} ms")
print(f"  stream p50/p95/max = {s['stream_ms']['p50']}/{s['stream_ms']['p95']}/{s['stream_ms']['max']} ms")
print(f"  sse ok {s['sse_ok']}/{s['sse_total']}; errors {s['error_count']}")
for e in s["errors"][:5]:
    print(f"    error: {e}")
PY
}

# Warm-up: one generation so pools/caches settle before the profile.
echo "== warm-up =="
python3 "$HERE/workload.py" --base "$GO_BASE" --scenario s5 \
  --gens 1 --sse-per-gen 1 --session "$RAW" --csrf "$CSRF" >/dev/null || true
rm -f "$RUN_DIR/sample.csv"
run_scenario s5 "$GENS_S5" "$SSE_S5"
run_scenario s10 "$GENS_S10" "$SSE_S10"

echo "== post-idle sample (60s) =="
sleep 60
awk -F, 'BEGIN{idle=0;n=0} {if ($1 > '"$(date +%s)"' - 60) {idle+=$2; n++}} END{if(n>0) printf "  idle RSS last 60s = %.1f MiB (mean of %d samples)\n", idle/n/1024, n}' "$RUN_DIR/sample.csv"
awk -F, 'BEGIN{peak=0} {if ($2>peak) peak=$2} END{printf "  peak RSS over run = %.1f MiB\n", peak/1024}' "$RUN_DIR/sample.csv"
kill "$SAMPLER" 2>/dev/null || true
echo "== G12 sample run done (artifacts in $RUN_DIR) =="
