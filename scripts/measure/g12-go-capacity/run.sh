#!/usr/bin/env bash
# G12 Go capacity profile (synthetic): §19.1 场景 5 (4 gen + 8 SSE stable) and
# 场景 10 (16 gen + 64 SSE capacity profile) against the host Go companiond
# `full` mode with a loopback fake provider. Java is not measured; it runs only
# long enough to apply Flyway migrations and is stopped before Go sampling.
#
# Reuses the g11-switchover compose for db + go-fake-provider only. Secrets
# and the opaque session are synthetic and fabricated locally; never a real
# provider, never real user data. Each invocation is one independent trial;
# §19.2 gates require at least three trials before Owner confirmation.
#
# Usage: bash scripts/measure/g12-go-capacity/run.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RUN_DIR="${G12_OUTPUT_DIR:-$HERE/.run}"
ENVFILE="$RUN_DIR/compose.env"
COMPOSE_FILE="$ROOT/ops/deploy/g11-switchover/compose.yml"
PROJECT="vc-g12"
TRIAL_ID="${G12_TRIAL_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
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
SOAK_TURNS="${G12_SOAK_TURNS:-100}"
SOAK_BATCH="${G12_SOAK_BATCH:-10}"
IDLE_SECONDS="${G12_IDLE_SECONDS:-60}"
WARM_IDLE_SECONDS="${G12_WARM_IDLE_SECONDS:-10}"
POST_IDLE_SECONDS="${G12_POST_IDLE_SECONDS:-60}"

mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"

COMPOSE=(docker compose --env-file "$ENVFILE" -f "$COMPOSE_FILE" -p "$PROJECT")

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { printf 'G12 FAIL: %s\n' "$*" >&2; exit 1; }

metric_value() {
  local name="$1"
  curl -fsS "$GO_BASE/actuator/prometheus" \
    | awk -v metric="$name" '$1 == metric { value=$2; found=1 } END { if (found) print value; else exit 1 }'
}

provider_stats() {
  curl -fsS "http://127.0.0.1:$GO_FAKE_PORT/g1/stats"
}

process_fds() {
  lsof -n -P -p "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null \
    | awk 'NR > 1 { count++ } END { print count + 0 }'
}

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

# The migrator image copies a prebuilt Boot jar. Refresh it only when absent
# or when a forward migration is newer, so a stale local image cannot silently
# stop before the schema version required by the Go binary.
RUNTIME_JAR=$(find "$ROOT/service/apps/runtime/target" -maxdepth 1 -type f \
  -name 'virtual-companion-runtime-*.jar' ! -name '*.original' -print 2>/dev/null \
  | head -1 || true)
if [ -z "$RUNTIME_JAR" ] || [ -n "$(find "$ROOT/service/platform/persistence/src/main/resources/db/migration" \
    -type f -name 'V*.sql' -newer "$RUNTIME_JAR" -print -quit 2>/dev/null)" ]; then
  echo "  packaging Java Flyway migrator (migration source is newer than Boot jar)"
  docker run --rm -v "$ROOT:/src" -v vc-g1-m2:/root/.m2 -w /src \
    eclipse-temurin:25-jdk \
    ./mvnw --batch-mode --no-transfer-progress -DskipTests package >/dev/null
fi

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
"${COMPOSE[@]}" build runtime >/dev/null
"${COMPOSE[@]}" up -d db go-fake-provider >/dev/null
DB_READY=0
for _ in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' vc-g12-db-1 2>/dev/null || true)" = "healthy" ]; then
    DB_READY=1
    break
  fi
  sleep 2
done
[ "$DB_READY" = "1" ] || die "database did not become healthy"
for _ in $(seq 1 60); do
  curl -fsS --max-time 2 "http://127.0.0.1:$GO_FAKE_PORT/health" >/dev/null && break
  sleep 1
done
curl -fsS --max-time 2 "http://127.0.0.1:$GO_FAKE_PORT/health" >/dev/null \
  || die "fake provider did not become healthy"
echo "  db healthy"

echo "== migrations via the Java runtime as the Flyway migrator (§21.2) =="
# The Go side does not run Flyway; the Java runtime applies all migrations in
# the packaged artifact and provisions roles, then stops. Go waits for the
# singleton lease afterwards.
"${COMPOSE[@]}" up -d runtime >/dev/null
JAVA_READY=0
for _ in $(seq 1 150); do
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:${G12_RUNTIME_SCRAPE_PORT:-18081}/actuator/health" 2>/dev/null; then
    JAVA_READY=1
    break
  fi
  sleep 2
done
[ "$JAVA_READY" = "1" ] || die "Java migrator runtime did not become healthy"
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
VC_PROVIDER_ID=g11-openai
VC_PROVIDER_SUPPLIER_NAME=g11-local-fake
VC_PROVIDER_ENDPOINT=http://127.0.0.1:$GO_FAKE_PORT/v1/chat/completions
VC_PROVIDER_TOKEN=g12-fake-token
VC_PROVIDER_MODEL=g1-model
VC_MAX_OUTSTANDING_TURNS=$OUTSTANDING
VC_MAX_CONCURRENT_TURNS=$CONCURRENCY
VC_LOG_LEVEL=info
EOF
chmod 600 "$RUN_DIR/go.env"
START_NS=$(python3 -c 'import time; print(time.monotonic_ns())')
env $(cat "$RUN_DIR/go.env") "$RUN_DIR/companiond" > "$RUN_DIR/companiond.log" 2>&1 &
echo $! > "$RUN_DIR/companiond.pid"
GO_READY=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 2 "$GO_BASE/actuator/health" 2>/dev/null; then
    GO_READY=1
    break
  fi
  sleep 0.05
done
[ "$GO_READY" = "1" ] || die "companiond did not become healthy"
READY_NS=$(python3 -c 'import time; print(time.monotonic_ns())')
COLD_START_MS=$(python3 - "$START_NS" "$READY_NS" <<'PY'
import sys
print(round((int(sys.argv[2]) - int(sys.argv[1])) / 1_000_000, 1))
PY
)
if BINARY_BYTES=$(stat -f '%z' "$RUN_DIR/companiond" 2>/dev/null); then
  :
else
  BINARY_BYTES=$(stat -c '%s' "$RUN_DIR/companiond")
fi
echo "  companiond healthy on :$GO_PORT"

# Warm-up uses a unique key prefix; it must not replay the first measured turn.
echo "== warm-up =="
for i in $(seq 1 "$WARMUP"); do
  python3 "$HERE/workload.py" --base "$GO_BASE" --scenario s5 \
    --gens 1 --sse-per-gen 1 --key-prefix "$TRIAL_ID-warmup-$i" \
    --session "$RAW" --csrf "$CSRF" >/dev/null \
    || die "warm-up workload failed"
done

# RSS/CPU sampler (macOS ps: rss in KB, %cpu is a point sample, time is
# cumulative). Scenario CPU deltas come from companiond's process metric.
: > "$RUN_DIR/sample.csv"
(
  while [ -f "$RUN_DIR/companiond.pid" ]; do
    ps -o rss=,%cpu=,time= -p "$(cat "$RUN_DIR/companiond.pid")" 2>/dev/null \
      | awk -v t="$(python3 -c 'import time; print(time.time())')" \
          '{print t "," $1 "," $2 "," $3}' >> "$RUN_DIR/sample.csv"
    sleep 0.5
  done
) &
SAMPLER=$!

echo "== measured idle (${IDLE_SECONDS}s) =="
sleep "$IDLE_SECONDS"
IDLE_RSS_MIB=$(awk -F, 'BEGIN{sum=0;n=0} {sum+=$2;n++} END{if(n<1) exit 1; printf "%.3f", sum/n/1024}' "$RUN_DIR/sample.csv")
echo "  idle RSS mean = $IDLE_RSS_MIB MiB"

run_scenario() {
  local name="$1" gens="$2" sse="$3"
  local result="$RUN_DIR/$name.json" summary="$RUN_DIR/$name.summary.json"
  local provider_before provider_after cpu_before cpu_after worker_active worker_peak
  local started ended
  echo "== scenario $name: $gens generation + $((gens * sse)) SSE =="
  provider_before=$(provider_stats)
  cpu_before=$(metric_value process_cpu_seconds_total)
  started=$(python3 -c 'import time; print(time.time())')
  if ! python3 "$HERE/workload.py" --base "$GO_BASE" --scenario "$name" \
      --gens "$gens" --sse-per-gen "$sse" --key-prefix "$TRIAL_ID-$name" \
      --session "$RAW" --csrf "$CSRF" > "$result"; then
    [ -s "$result" ] && cat "$result" >&2
    die "$name workload failed"
  fi
  ended=$(python3 -c 'import time; print(time.time())')
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  provider_after=$(provider_stats)
  if ! python3 - "$result" "$gens" "$sse" "$CONCURRENCY" \
      "$provider_before" "$provider_after" "$cpu_before" "$cpu_after" \
      "$worker_active" "$worker_peak" "$started" "$ended" "$RUN_DIR/sample.csv" \
      > "$summary" <<'PY'
import json, sys

(path, gens, sse, concurrency, provider_before, provider_after, cpu_before,
 cpu_after, worker_active, worker_peak, started, ended, samples) = sys.argv[1:]
gens, sse, concurrency = int(gens), int(sse), int(concurrency)
started, ended = float(started), float(ended)
r = json.load(open(path))
before, after = json.loads(provider_before), json.loads(provider_after)
s = r["stats"]
expected_sse = gens * sse
expected_active = min(gens, concurrency)
errors = []
if r.get("generations") != gens:
    errors.append(f"accepted generations {r.get('generations')} want {gens}")
if r.get("expected_sse") != expected_sse:
    errors.append(f"expected_sse {r.get('expected_sse')} want {expected_sse}")
if s.get("sse_total") != expected_sse or s.get("sse_ok") != expected_sse:
    errors.append(f"SSE {s.get('sse_ok')}/{s.get('sse_total')} want {expected_sse}")
if s.get("error_count") != 0:
    errors.append(f"workload errors: {s.get('errors')}")
provider_delta = after["streamRequests"] - before["streamRequests"]
if provider_delta != gens:
    errors.append(f"provider requests {provider_delta} want {gens}")
if after["activeStreamRequests"] != 0:
    errors.append(f"provider active after scenario {after['activeStreamRequests']}")
if after["peakActiveStreamRequests"] < expected_active:
    errors.append(
        f"provider peak {after['peakActiveStreamRequests']} want at least {expected_active}")
if int(float(worker_active)) != 0:
    errors.append(f"worker active after scenario {worker_active}")
if int(float(worker_peak)) < expected_active:
    errors.append(f"worker peak {worker_peak} want at least {expected_active}")
rss = []
with open(samples) as fh:
    for line in fh:
        fields = line.strip().split(",")
        if len(fields) >= 2 and started <= float(fields[0]) <= ended:
            rss.append(float(fields[1]) / 1024)
summary = {
    "scenario": r["scenario"],
    "generations": gens,
    "sse": expected_sse,
    "intake_ms": s["intake_ms"],
    "terminal_ms": s["terminal_ms"],
    "stream_ms": s["stream_ms"],
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "peak_rss_mib": round(max(rss), 3) if rss else None,
    "provider_peak": after["peakActiveStreamRequests"],
    "worker_peak": int(float(worker_peak)),
    "errors": errors,
}
print(json.dumps(summary, ensure_ascii=False))
if errors:
    for error in errors:
        print(f"G12 assertion failed: {error}", file=sys.stderr)
    raise SystemExit(1)
PY
  then
    die "$name capacity assertions failed"
  fi
  python3 - "$summary" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"  intake p50/p95 = {r['intake_ms']['p50']}/{r['intake_ms']['p95']} ms")
print(f"  terminal p50/p95 = {r['terminal_ms']['p50']}/{r['terminal_ms']['p95']} ms")
print(f"  stream p50/p95 = {r['stream_ms']['p50']}/{r['stream_ms']['p95']} ms")
print(f"  CPU = {r['cpu_seconds']} s; peak RSS = {r['peak_rss_mib']} MiB")
print(f"  provider/worker peak = {r['provider_peak']}/{r['worker_peak']}; errors = 0")
PY
}

run_scenario s5 "$GENS_S5" "$SSE_S5"
run_scenario s10 "$GENS_S10" "$SSE_S10"

echo "== 100-turn soak and post-idle recovery =="
PRE_SOAK_IDLE_STARTED=$(python3 -c 'import time; print(time.time())')
sleep "$WARM_IDLE_SECONDS"
PRE_SOAK_RSS_MIB=$(awk -F, -v start="$PRE_SOAK_IDLE_STARTED" \
  'BEGIN{sum=0;n=0} $1>=start {sum+=$2;n++} END{if(n<1) exit 1; printf "%.3f", sum/n/1024}' \
  "$RUN_DIR/sample.csv")
curl -fsS "$GO_BASE/actuator/prometheus" > "$RUN_DIR/metrics.pre-soak.prom"
PRE_SOAK_FDS=$(process_fds)
SOAK_PROVIDER_BEFORE=$(provider_stats)
SOAK_CPU_BEFORE=$(metric_value process_cpu_seconds_total)
SOAK_DONE=0
SOAK_INDEX=0
while [ "$SOAK_DONE" -lt "$SOAK_TURNS" ]; do
  SOAK_INDEX=$((SOAK_INDEX + 1))
  CURRENT_BATCH="$SOAK_BATCH"
  if [ $((SOAK_DONE + CURRENT_BATCH)) -gt "$SOAK_TURNS" ]; then
    CURRENT_BATCH=$((SOAK_TURNS - SOAK_DONE))
  fi
  SOAK_FILE=$(printf '%s/soak-%03d.json' "$RUN_DIR" "$SOAK_INDEX")
  if ! python3 "$HERE/workload.py" --base "$GO_BASE" --scenario s10 \
      --gens "$CURRENT_BATCH" --sse-per-gen 1 \
      --key-prefix "$TRIAL_ID-soak-$SOAK_INDEX" \
      --session "$RAW" --csrf "$CSRF" > "$SOAK_FILE"; then
    [ -s "$SOAK_FILE" ] && cat "$SOAK_FILE" >&2
    die "soak batch $SOAK_INDEX failed"
  fi
  python3 - "$SOAK_FILE" "$CURRENT_BATCH" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
want = int(sys.argv[2])
s = r["stats"]
if (r.get("generations") != want or s.get("sse_ok") != want
        or s.get("sse_total") != want or s.get("error_count") != 0):
    raise SystemExit(f"invalid soak batch: {r}")
PY
  SOAK_DONE=$((SOAK_DONE + CURRENT_BATCH))
done
SOAK_PROVIDER_AFTER=$(provider_stats)
SOAK_CPU_AFTER=$(metric_value process_cpu_seconds_total)
echo "  completed $SOAK_DONE turns; waiting ${POST_IDLE_SECONDS}s for recovery"
POST_IDLE_STARTED=$(python3 -c 'import time; print(time.time())')
sleep "$POST_IDLE_SECONDS"
curl -fsS "$GO_BASE/actuator/prometheus" > "$RUN_DIR/metrics.post-idle.prom"
POST_IDLE_RSS_MIB=$(awk -F, -v start="$POST_IDLE_STARTED" \
  'BEGIN{sum=0;n=0} $1>=start {sum+=$2;n++} END{if(n<1) exit 1; printf "%.3f", sum/n/1024}' \
  "$RUN_DIR/sample.csv")
POST_IDLE_FDS=$(process_fds)
if ! python3 - "$RUN_DIR/metrics.pre-soak.prom" "$RUN_DIR/metrics.post-idle.prom" \
    "$SOAK_PROVIDER_BEFORE" "$SOAK_PROVIDER_AFTER" "$SOAK_TURNS" \
    "$SOAK_CPU_BEFORE" "$SOAK_CPU_AFTER" "$PRE_SOAK_RSS_MIB" "$POST_IDLE_RSS_MIB" \
    "$PRE_SOAK_FDS" "$POST_IDLE_FDS" \
    > "$RUN_DIR/soak.summary.json" <<'PY'
import json, sys

(before_path, after_path, provider_before, provider_after, turns, cpu_before,
 cpu_after, pre_rss, post_rss, pre_fds, post_fds) = sys.argv[1:]
turns = int(turns)
def metrics(path):
    out = {}
    with open(path) as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            fields = line.split()
            if len(fields) == 2 and "{" not in fields[0]:
                try:
                    out[fields[0]] = float(fields[1])
                except ValueError:
                    pass
    return out
before, after = metrics(before_path), metrics(after_path)
pb, pa = json.loads(provider_before), json.loads(provider_after)
errors = []
provider_delta = pa["streamRequests"] - pb["streamRequests"]
if provider_delta != turns:
    errors.append(f"provider requests {provider_delta} want {turns}")
for name in ("vc_generation_active", "vc_realtime_subscribers", "vc_db_pool_acquired"):
    if after.get(name) != 0:
        errors.append(f"{name} after idle = {after.get(name)}")
summary = {
    "turns": turns,
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "warm_idle_rss_before_after_mib": [float(pre_rss), float(post_rss)],
    "goroutines_before_after": [before.get("go_goroutines"), after.get("go_goroutines")],
    "fds_before_after": [int(pre_fds), int(post_fds)],
    "db_acquired_before_after": [before.get("vc_db_pool_acquired"), after.get("vc_db_pool_acquired")],
    "errors": errors,
}
print(json.dumps(summary, ensure_ascii=False))
if errors:
    for error in errors:
        print(f"G12 assertion failed: {error}", file=sys.stderr)
    raise SystemExit(1)
PY
then
  die "100-turn recovery assertions failed"
fi

PEAK_RSS_MIB=$(awk -F, 'BEGIN{peak=0} {if($2>peak)peak=$2} END{printf "%.3f", peak/1024}' "$RUN_DIR/sample.csv")
cat > "$RUN_DIR/trial.summary.json" <<EOF
{"trial_id":"$TRIAL_ID","cold_start_ms":$COLD_START_MS,"binary_bytes":$BINARY_BYTES,"idle_rss_mib":$IDLE_RSS_MIB,"peak_rss_mib":$PEAK_RSS_MIB,"s5":$(cat "$RUN_DIR/s5.summary.json"),"s10":$(cat "$RUN_DIR/s10.summary.json"),"soak":$(cat "$RUN_DIR/soak.summary.json")}
EOF
kill "$SAMPLER" 2>/dev/null || true
wait "$SAMPLER" 2>/dev/null || true
echo "== G12 trial PASS (artifacts in $RUN_DIR) =="
cat "$RUN_DIR/trial.summary.json"
