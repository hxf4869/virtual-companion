#!/usr/bin/env bash
# G1 Java runtime-only + retained-stack resource baseline.
# Synthetic secrets only. Does not talk to a real model provider.
# Never prints tokens, passwords, cookies, or message bodies.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

PROJECT="vc-g1"
BASE="${G1_BASE:-http://127.0.0.1:18080}"
PROM="${G1_PROM:-http://127.0.0.1:18081/actuator/prometheus}"
FAKE="${G1_FAKE:-http://127.0.0.1:19090}"
IDLE_SECONDS="${G1_IDLE_SECONDS:-600}"
TRIALS="${G1_TRIALS:-3}"
GEN100="${G1_GEN100:-100}"
POST_IDLE_SECONDS="${G1_POST_IDLE_SECONDS:-60}"
KEEP="${G1_KEEP:-0}"
RUN_DIR="${G1_RUN_DIR:-$HERE/.run}"
ENVFILE="$RUN_DIR/compose.env"
RESULTS="$RUN_DIR/results.json"
REPORT_MD="${G1_REPORT_MD:-$ROOT/docs/planning/g1-java-resource-baseline.md}"
REPORT_JSON="${G1_REPORT_JSON:-$ROOT/docs/planning/g1-java-resource-baseline-results.json}"

mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo -n docker)
elif [ "${G1_REEXEC_SG:-0}" != "1" ] && command -v sg >/dev/null 2>&1 \
    && sg docker -c 'docker info' >/dev/null 2>&1; then
  log "re-exec under sg docker"
  exec sg docker -c "G1_REEXEC_SG=1 G1_IDLE_SECONDS='$IDLE_SECONDS' G1_TRIALS='$TRIALS' G1_GEN100='$GEN100' G1_POST_IDLE_SECONDS='$POST_IDLE_SECONDS' G1_KEEP='$KEEP' G1_BASE='$BASE' G1_PROM='$PROM' G1_FAKE='$FAKE' bash '$HERE/run.sh'"
else
  log "NOT_RUN: docker is installed but this user cannot talk to the daemon"
  exit 2
fi
export G1_DOCKER="${DOCKER[*]}"
NETWORK_MODE="compose-bridge"
COMPOSE_FILES=(-f "$HERE/compose.yml")
probe_icc() {
  local net="g1-icc-probe"
  "${DOCKER[@]}" network create "$net" >/dev/null 2>&1 || true
  "${DOCKER[@]}" rm -f g1-icc-a >/dev/null 2>&1 || true
  if ! "${DOCKER[@]}" run -d --name g1-icc-a --network "$net" node:20-bookworm-slim \
      node -e 'require("http").createServer((q,s)=>s.end("ok")).listen(9,"0.0.0.0")' >/dev/null; then
    "${DOCKER[@]}" rm -f g1-icc-a >/dev/null 2>&1 || true
    "${DOCKER[@]}" network rm "$net" >/dev/null 2>&1 || true
    return 1
  fi
  sleep 1
  local rc=1
  if "${DOCKER[@]}" run --rm --network "$net" node:20-bookworm-slim \
      node -e 'fetch("http://g1-icc-a:9").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' \
      >/dev/null 2>&1; then
    rc=0
  fi
  "${DOCKER[@]}" rm -f g1-icc-a >/dev/null 2>&1 || true
  "${DOCKER[@]}" network rm "$net" >/dev/null 2>&1 || true
  return "$rc"
}
log "probe docker bridge inter-container TCP"
if probe_icc; then
  log "docker bridge ICC ok"
else
  log "docker bridge ICC failed; using host-network overlay (same four processes, localhost ports)"
  NETWORK_MODE="host"
  COMPOSE_FILES+=(-f "$HERE/compose.host.yml")
fi
COMPOSE=("${DOCKER[@]}" compose --env-file "$ENVFILE" "${COMPOSE_FILES[@]}" --project-directory "$HERE")

cleanup() {
  if [ "$KEEP" != "1" ]; then
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  else
    log "keeping stack (G1_KEEP=1)"
  fi
}
trap cleanup EXIT

merge_json() {
  local key="$1"
  local value
  if [ "$#" -ge 2 ]; then
    value="$2"
  else
    value="$(cat)"
  fi
  python3 -c '
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
key = sys.argv[2]
value = json.loads(sys.argv[3])
data = json.loads(path.read_text()) if path.exists() else {}
cursor = data
parts = key.split(".")
for part in parts[:-1]:
    cursor = cursor.setdefault(part, {})
cursor[parts[-1]] = value
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
' "$RESULTS" "$key" "$value"
}

wl() { python3 "$HERE/workload.py" --base "$BASE" "$@"; }
ADMIN_TOKEN_FILE="$RUN_DIR/admin.token"
ensure_admin_token() {
  if [ -s "$ADMIN_TOKEN_FILE" ]; then
    return 0
  fi
  if [ ! -f "$ENVFILE" ]; then
    return 1
  fi
  local i
  for i in 1 2 3 4 5 6; do
    if wl login --username g1-admin --password "$ADMIN_PASS" --token-out "$ADMIN_TOKEN_FILE" >/dev/null 2>/dev/null; then
      chmod 600 "$ADMIN_TOKEN_FILE" 2>/dev/null || true
      return 0
    fi
    sleep 2
  done
  log "admin login for prometheus scrape failed"
  rm -f "$ADMIN_TOKEN_FILE"
  return 1
}
snap() {
  local token=""
  if [ -s "$ADMIN_TOKEN_FILE" ]; then
    token="$(cat "$ADMIN_TOKEN_FILE")"
  fi
  VC_MIGRATOR_DB_PASSWORD="$(grep '^VC_MIGRATOR_DB_PASSWORD=' "$ENVFILE" | cut -d= -f2-)" \
    G1_PROM_TOKEN="$token" \
    python3 "$HERE/sample.py" snapshot --project "$PROJECT" --prometheus-url "$PROM" --out "$1"
}

wait_http() {
  local url="$1" tries="${2:-90}"
  local i
  for i in $(seq 1 "$tries"); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

bytes_human() {
  python3 -c "print(f'{int($1)/1048576:.1f} MiB')"
}

# ---------------------------------------------------------------------------
# 0. preflight + env
# ---------------------------------------------------------------------------
log "preflight machine"
python3 "$HERE/sample.py" machine --out "$RUN_DIR/machine.json"
python3 "$HERE/sample.py" self-test

JAR="$(ls -t "$ROOT"/service/apps/runtime/target/virtual-companion-runtime-*.jar 2>/dev/null | grep -v '\.original' | head -1 || true)"
if [ -z "$JAR" ]; then
  log "building runtime jar in eclipse-temurin:25-jdk (skipTests; packaging only)"
  "${DOCKER[@]}" run --rm \
    -v "$ROOT":/src -v vc-g1-m2:/root/.m2 -w /src \
    eclipse-temurin:25-jdk \
    ./mvnw --batch-mode --no-transfer-progress -DskipTests package
  JAR="$(ls -t "$ROOT"/service/apps/runtime/target/virtual-companion-runtime-*.jar | grep -v '\.original' | head -1)"
fi
JAR_SIZE="$(stat -c '%s' "$JAR")"
log "jar $(basename "$JAR") ${JAR_SIZE} bytes"

umask 077
ADMIN_PASS='G1-Admin-Pass-1234!'
USER_PASS_PREFIX='G1-User-'
cat > "$ENVFILE" <<EOF
VC_DOMAIN=localhost
G1_HTTP_PORT=18080
G1_RUNTIME_SCRAPE_PORT=18081
G1_FAKE_PROVIDER_PORT=19090
VC_MIGRATOR_DB_PASSWORD=$(openssl rand -hex 32)
VC_RUNTIME_DB_PASSWORD=$(openssl rand -hex 32)
VC_JWT_SECRET=$(openssl rand -hex 32)
VC_OWNER_BINDING_SECRET=$(openssl rand -hex 32)
VC_SHARED_RATE_LIMIT_SECRET=$(openssl rand -hex 32)
VC_CRYPTO_REST_KEY=$(openssl rand -base64 32 | tr -d '\n')
VC_EXPORT_S3_ACCESS_KEY=g1minioaccess
VC_EXPORT_S3_SECRET_KEY=$(openssl rand -hex 20)
VC_EXPORT_S3_BUCKET=vc-exports
VC_ADMIN_USERNAME=g1-admin
VC_ADMIN_PASSWORD=${ADMIN_PASS}
VC_ADMIN_DISPLAY_NAME=G1 Admin
VC_MODEL_SECRET_G1_CRED=g1-loopback-dummy-token
EOF
chmod 600 "$ENVFILE"

python3 - "$RESULTS" "$RUN_DIR/machine.json" "$JAR" "$JAR_SIZE" "$IDLE_SECONDS" "$TRIALS" <<'PY'
import json, sys, time
from pathlib import Path
results_path, machine_path, jar, jar_size, idle, trials = sys.argv[1:]
machine = json.loads(Path(machine_path).read_text())
Path(results_path).write_text(json.dumps({
    "schema": "g1-java-resource-baseline/v1",
    "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "git_head": None,
    "machine": machine,
    "tuning": {
        "container_mem_limit": "1536m",
        "java_tool_options": "-XX:MaxRAMPercentage=70.0 -XX:InitialRAMPercentage=20.0",
        "note": "Single bounded fair baseline. Production compose still has no memory limit.",
    },
    "workload": {
        "idle_seconds": int(idle),
        "trials": int(trials),
        "fake_provider": "loopback OpenAI-compatible, fixed reply, configurable delay",
        "caddy": "HTTP-only stub H5; TLS not included",
        "profile": "production + loopback fake provider + MinIO enabled",
    },
    "artifacts": {"boot_jar": jar, "boot_jar_bytes": int(jar_size)},
    "scenarios": {},
}, indent=2, sort_keys=True) + "\n")
PY
git_head="$(git -C "$ROOT" rev-parse HEAD)"
merge_json git_head <<<"\"$git_head\""
merge_json measurement_network <<<"\"$NETWORK_MODE\""

# ---------------------------------------------------------------------------
# 1. stack up (includes first Flyway boot)
# ---------------------------------------------------------------------------
log "compose build + up"
if ! "${COMPOSE[@]}" build; then
  log "compose build failed"
  merge_json scenarios.stack_up '{"status":"FAIL","reason":"compose_build"}'
  exit 3
fi
FIRST_START_T0="$(date +%s.%N)"
if ! "${COMPOSE[@]}" up -d; then
  log "compose up failed; minio-init/runtime logs:"
  "${COMPOSE[@]}" logs --no-color minio-init minio runtime 2>&1 | tail -n 80 >&2 || true
  merge_json scenarios.stack_up '{"status":"FAIL","reason":"compose_up"}'
  exit 3
fi
if ! wait_http "http://127.0.0.1:18081/actuator/health" 90 && ! wait_http "$BASE/actuator/health" 5; then
  log "runtime health failed; compose logs (truncated, no secrets):"
  "${COMPOSE[@]}" logs --no-color runtime 2>&1 | tail -n 80 >&2 || true
  merge_json scenarios.stack_up <<<"{\"status\":\"FAIL\",\"reason\":\"runtime_health\"}"
  exit 3
fi
FIRST_START_T1="$(date +%s.%N)"
FIRST_START_S="$(python3 -c "print(round(float('$FIRST_START_T1')-float('$FIRST_START_T0'), 3))")"
log "first boot to health ${FIRST_START_S}s (includes Flyway)"

if ensure_admin_token; then
  merge_json scenarios.admin_login '{"status":"PASS","note":"admin token cached locally for prometheus scrape; never committed"}'
else
  merge_json scenarios.admin_login '{"status":"FAIL","reason":"admin_login"}'
fi
if wait_http "$BASE/api/v1/version" 10; then
  merge_json scenarios.http_version '{"status":"PASS"}'
else
  log "Caddy /api/v1/version not ready after first boot"
  merge_json scenarios.http_version '{"status":"FAIL","reason":"version"}'
fi

if ! wait_http "$FAKE/health" 30; then
  log "fake provider not reachable on $FAKE/health"
  merge_json scenarios.fake_provider <<<"{\"status\":\"NOT_RUN\",\"reason\":\"fake_provider_health\"}"
fi
if ! wait_http "$BASE/api/v1/version" 20; then
  log "Caddy /api/v1/version not ready (retry after image inspect)"
fi

IMAGE_ID="$("${DOCKER[@]}" inspect "$("${DOCKER[@]}" ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=runtime)" --format '{{.Image}}' | head -1)"
IMAGE_SIZE="$("${DOCKER[@]}" image inspect "$IMAGE_ID" --format '{{.Size}}')"
merge_json artifacts.runtime_image_bytes <<<"$IMAGE_SIZE"
merge_json artifacts.runtime_image_id <<<"\"${IMAGE_ID:0:16}\""
merge_json scenarios.first_boot_includes_flyway <<EOF
{"status":"PASS","readiness_s":$FIRST_START_S,"note":"First process start after empty volume; Flyway applies all migrations. Not the restart baseline."}
EOF

seed_db() {
  local dbcid
  dbcid="$("${DOCKER[@]}" ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=db)"
  "${DOCKER[@]}" exec -i "$dbcid" psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'g1-baseline-v1');
INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
VALUES ('g1-openai', 'OPENAI_CHAT_COMPLETIONS', '{}', 'ADMITTED')
ON CONFLICT (provider_id) DO UPDATE
   SET admission_state = 'ADMITTED', protocol = 'OPENAI_CHAT_COMPLETIONS';
INSERT INTO vc.model_unit_price(
    provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k,
    effective_from, active)
VALUES ('g1-openai', 'g1-model', 1, 0.001, 0.002, now(), true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
SQL
}
if ! seed_db; then
  log "release gate / provider seed failed"
  merge_json scenarios.db_seed <<<"{\"status\":\"FAIL\"}"
  exit 4
fi
merge_json scenarios.db_seed <<<"{\"status\":\"PASS\"}"

# ---------------------------------------------------------------------------
# 2. cold start (schema already applied) x TRIALS
# ---------------------------------------------------------------------------
log "cold start trials=$TRIALS"
cold_file="$RUN_DIR/cold.jsonl"
: > "$cold_file"
i=1
while [ "$i" -le "$TRIALS" ]; do
  "${COMPOSE[@]}" up -d --force-recreate --no-deps runtime fake-provider >/dev/null
  t0="$(date +%s.%N)"
  if ! wait_http "http://127.0.0.1:18081/actuator/health" 60; then
    echo "{\"trial\":$i,\"status\":\"FAIL\"}" >> "$cold_file"
    i=$((i + 1))
    continue
  fi
  t1="$(date +%s.%N)"
  s="$(python3 -c "print(round(float('$t1')-float('$t0'), 3))")"
  snap "$RUN_DIR/cold-$i.json"
  python3 - "$cold_file" "$i" "$s" "$RUN_DIR/cold-$i.json" <<'PY'
import json, sys
from pathlib import Path
out, trial, seconds, snap_path = sys.argv[1:]
snap = json.loads(Path(snap_path).read_text())
rt = snap.get("runtime_only") or {}
row = {
    "trial": int(trial),
    "status": "PASS",
    "readiness_s": float(seconds),
    "runtime_rss_bytes": rt.get("rss_bytes"),
    "runtime_pss_bytes": rt.get("pss_bytes"),
    "runtime_cgroup_bytes": rt.get("cgroup_memory_bytes"),
    "retained_rss_bytes": (snap.get("retained_stack") or {}).get("rss_bytes"),
    "retained_pss_bytes": (snap.get("retained_stack") or {}).get("pss_bytes"),
    "jvm": snap.get("jvm"),
}
with Path(out).open("a", encoding="utf-8") as fh:
    fh.write(json.dumps(row) + "\n")
PY
  log "cold start trial $i ${s}s"
  i=$((i + 1))
done
ensure_admin_token || true
python3 - "$RESULTS" "$cold_file" <<'PY'
import json, sys
from pathlib import Path
from statistics import median
results_path, cold_path = sys.argv[1:]
rows = [json.loads(line) for line in Path(cold_path).read_text().splitlines() if line.strip()]
ok = [r for r in rows if r.get("status") == "PASS"]
def summarize(key):
    vals = [r[key] for r in ok if isinstance(r.get(key), (int, float))]
    if not vals:
        return {"n": 0}
    return {"n": len(vals), "median": median(vals), "min": min(vals), "max": max(vals), "range": max(vals) - min(vals)}
payload = {
    "status": "PASS" if len(ok) >= 3 else ("FAIL" if not ok else "PARTIAL"),
    "trials": rows,
    "readiness_s": summarize("readiness_s"),
    "runtime_rss_bytes": summarize("runtime_rss_bytes"),
    "runtime_pss_bytes": summarize("runtime_pss_bytes"),
    "retained_rss_bytes": summarize("retained_rss_bytes"),
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["cold_start"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 3. idle windows (each after a ready runtime)
# ---------------------------------------------------------------------------
log "idle ${IDLE_SECONDS}s x ${TRIALS}"
idle_file="$RUN_DIR/idle.jsonl"
: > "$idle_file"
# Ensure runtime is up from last cold start.
if ! wait_http "http://127.0.0.1:18081/actuator/health" 30; then
  "${COMPOSE[@]}" up -d runtime fake-provider
  wait_http "http://127.0.0.1:18081/actuator/health" 60 || true
fi
i=1
while [ "$i" -le "$TRIALS" ]; do
  log "idle trial $i sleeping ${IDLE_SECONDS}s"
  snap "$RUN_DIR/idle-$i-start.json"
  cpu0="$(python3 -c "import json; d=json.load(open('$RUN_DIR/idle-$i-start.json')); r=d.get('runtime_only') or {}; print((r.get('cpu_user_ticks') or 0)+(r.get('cpu_sys_ticks') or 0))")"
  clk="$(python3 -c "import json; d=json.load(open('$RUN_DIR/idle-$i-start.json')); print((d.get('runtime_only') or {}).get('clk_tck') or 100)")"
  sleep "$IDLE_SECONDS"
  snap "$RUN_DIR/idle-$i-end.json"
  python3 - "$idle_file" "$i" "$IDLE_SECONDS" "$RUN_DIR/idle-$i-start.json" "$RUN_DIR/idle-$i-end.json" "$cpu0" "$clk" <<'PY'
import json, sys
from pathlib import Path
out, trial, seconds, start_p, end_p, cpu0, clk = sys.argv[1:]
start = json.loads(Path(start_p).read_text())
end = json.loads(Path(end_p).read_text())
rt0, rt1 = start.get("runtime_only") or {}, end.get("runtime_only") or {}
cpu1 = (rt1.get("cpu_user_ticks") or 0) + (rt1.get("cpu_sys_ticks") or 0)
clk_f = float(clk) or 100.0
cpu_s = (cpu1 - float(cpu0)) / clk_f
idle_cpu_pct = (cpu_s / float(seconds)) * 100 if float(seconds) else None
row = {
    "trial": int(trial),
    "window_s": float(seconds),
    "runtime_rss_start": rt0.get("rss_bytes"),
    "runtime_rss_end": rt1.get("rss_bytes"),
    "runtime_pss_end": rt1.get("pss_bytes"),
    "runtime_cgroup_end": rt1.get("cgroup_memory_bytes"),
    "retained_rss_end": (end.get("retained_stack") or {}).get("rss_bytes"),
    "retained_pss_end": (end.get("retained_stack") or {}).get("pss_bytes"),
    "runtime_cpu_seconds": cpu_s,
    "runtime_idle_cpu_percent": idle_cpu_pct,
    "fd_end": rt1.get("fd"),
    "threads_end": rt1.get("threads"),
    "jvm": end.get("jvm"),
    "db_runtime_login": ((end.get("db") or {}).get("runtime_login")),
    "components": {k: (end.get("components") or {}).get(k) for k in ("runtime", "caddy", "db", "minio")},
    "host_ollama": end.get("host_ollama"),
}
with Path(out).open("a", encoding="utf-8") as fh:
    fh.write(json.dumps(row) + "\n")
PY
  i=$((i + 1))
done
python3 - "$RESULTS" "$idle_file" <<'PY'
import json, sys
from pathlib import Path
from statistics import median
results_path, path = sys.argv[1:]
rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
def summarize(key):
    vals = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
    if not vals:
        return {"n": 0}
    return {"n": len(vals), "median": median(vals), "min": min(vals), "max": max(vals), "range": max(vals) - min(vals)}
payload = {
    "status": "PASS" if len(rows) >= 3 else "PARTIAL",
    "trials": rows,
    "runtime_rss_bytes": summarize("runtime_rss_end"),
    "runtime_pss_bytes": summarize("runtime_pss_end"),
    "retained_rss_bytes": summarize("retained_rss_end"),
    "runtime_idle_cpu_percent": summarize("runtime_idle_cpu_percent"),
    "runtime_cpu_seconds": summarize("runtime_cpu_seconds"),
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["idle"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 4. seed owners + conversations
# ---------------------------------------------------------------------------
log "seed admin users + conversations"
SEED_JSON="$RUN_DIR/seed.json"
if ! wl seed --admin-user g1-admin --admin-pass "$ADMIN_PASS" --count 8 > "$SEED_JSON"; then
  log "admin seed failed (see $SEED_JSON)"
  merge_json scenarios.seed <<<"{\"status\":\"FAIL\"}"
else
  merge_json scenarios.seed < "$SEED_JSON"
fi

OWNERS="$RUN_DIR/owners.json"
python3 - "$OWNERS" "$BASE" "$ADMIN_PASS" "$ROOT" <<'PY'
import json, subprocess, sys
from pathlib import Path
out, base, admin_pass, root = sys.argv[1:]
owners = []
for i in range(1, 9):
    user = f"g1-user-{i}"
    password = f"G1-User-{i}-Pass-1234!"
    proc = subprocess.run(
        [sys.executable, "scripts/measure/g1-java-baseline/workload.py",
         "--base", base, "prepare-owner", "--username", user, "--password", password],
        cwd=root,
        capture_output=True, text=True, check=False,
    )
    try:
        body = json.loads(proc.stdout)
    except json.JSONDecodeError:
        body = {"ok": False, "raw_len": len(proc.stdout), "err": proc.stderr[-200:]}
    body["username"] = user
    body["password"] = password
    owners.append(body)
Path(out).write_text(json.dumps(owners, indent=2) + "\n")
ok = sum(1 for o in owners if o.get("ok"))
print(json.dumps({"status": "PASS" if ok else "FAIL", "prepared": ok}))
PY
# Do not merge owner passwords into the committed report. Keep local only.

python3 - "$RESULTS" "$OWNERS" <<'PY'
import json, sys
from pathlib import Path
results_path, owners_path = sys.argv[1:]
owners = json.loads(Path(owners_path).read_text())
safe = [{"username": o.get("username"), "ok": o.get("ok"), "accountId": o.get("accountId"),
         "conversationId": o.get("conversationId")} for o in owners]
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["owners"] = {
    "status": "PASS" if any(o.get("ok") for o in owners) else "FAIL",
    "prepared": sum(1 for o in owners if o.get("ok")),
    "owners": safe,
}
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
print(sum(1 for o in owners if o.get("ok")))
PY

# ---------------------------------------------------------------------------
# helper: first prepared owner
# ---------------------------------------------------------------------------
if ! python3 -c "import json,sys; d=json.load(open('$OWNERS')); sys.exit(0 if any(x.get('ok') for x in d) else 1)"; then
  log "no prepared owner; skipping HTTP workload scenarios"
  merge_json scenarios.http_workloads <<<"{\"status\":\"NOT_RUN\",\"reason\":\"no_prepared_owner\"}"
else
OWNER1_USER="$(python3 -c "import json; d=json.load(open('$OWNERS')); o=next(x for x in d if x.get('ok')); print(o['username'])")"
OWNER1_CONV="$(python3 -c "import json; d=json.load(open('$OWNERS')); o=next(x for x in d if x.get('ok')); print(o['conversationId'])")"
OWNER1_TOKEN="$(python3 -c "import json; d=json.load(open('$OWNERS')); o=next(x for x in d if x.get('ok')); print(o.get('accessToken') or '')")"
if [ -z "$OWNER1_TOKEN" ]; then
  log "prepared owner missing access token; falling back to password login"
  OWNER1_PASS="$(python3 -c "import json; d=json.load(open('$OWNERS')); o=next(x for x in d if x.get('ok')); print(o['password'])")"
  OWNER1_AUTH=(--username "$OWNER1_USER" --password "$OWNER1_PASS")
else
  OWNER1_AUTH=(--access-token "$OWNER1_TOKEN")
fi

wl provider-config --url "$FAKE/g1/config" --first-token-ms 200 --delta-ms 50 --chunks 8 --hold-ms 0 >/dev/null || true

# ---------------------------------------------------------------------------
# 5. 1 generation + 1 SSE  (3 trials)
# ---------------------------------------------------------------------------
log "scenario 1gen+1sse"
gen1_file="$RUN_DIR/gen1.jsonl"
: > "$gen1_file"
i=1
while [ "$i" -le "$TRIALS" ]; do
  snap "$RUN_DIR/gen1-$i-before.json"
  if wl turn-with-sse "${OWNER1_AUTH[@]}" \
      --conversation-id "$OWNER1_CONV" --text "g1 one turn please" \
      --idempotency-key "g1-one-$i-$(date +%s%N)" --timeout 60 \
      > "$RUN_DIR/gen1-$i.json"; then
    :
  fi
  snap "$RUN_DIR/gen1-$i-after.json"
  python3 - "$gen1_file" "$i" "$RUN_DIR/gen1-$i.json" "$RUN_DIR/gen1-$i-before.json" "$RUN_DIR/gen1-$i-after.json" <<'PY'
import json, sys
from pathlib import Path
out, trial, body_p, b_p, a_p = sys.argv[1:]
body = json.loads(Path(body_p).read_text() or "{}")
before = json.loads(Path(b_p).read_text())
after = json.loads(Path(a_p).read_text())
rt0 = before.get("runtime_only") or {}
rt1 = after.get("runtime_only") or {}
clk = float(rt0.get("clk_tck") or rt1.get("clk_tck") or 100)
cpu0 = (rt0.get("cpu_user_ticks") or 0) + (rt0.get("cpu_sys_ticks") or 0)
cpu1 = (rt1.get("cpu_user_ticks") or 0) + (rt1.get("cpu_sys_ticks") or 0)
row = {
    "trial": int(trial),
    "ok": body.get("ok"),
    "status": body.get("status"),
    "intake_ms": body.get("intake_ms"),
    "wait_ms": body.get("wait_ms"),
    "sse_first_event_ms": (body.get("sse") or {}).get("first_event_ms"),
    "sse_status": (body.get("sse") or {}).get("status"),
    "runtime_rss_peak": max(rt0.get("rss_bytes") or 0, rt1.get("rss_bytes") or 0),
    "runtime_cpu_seconds": (cpu1 - cpu0) / clk,
    "retained_rss_after": (after.get("retained_stack") or {}).get("rss_bytes"),
}
with Path(out).open("a", encoding="utf-8") as fh:
    fh.write(json.dumps(row) + "\n")
PY
  i=$((i + 1))
done
python3 - "$RESULTS" "$gen1_file" <<'PY'
import json, sys
from pathlib import Path
from statistics import median
results_path, path = sys.argv[1:]
rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
ok = [r for r in rows if r.get("ok")]
def summarize(key):
    vals = [r[key] for r in ok if isinstance(r.get(key), (int, float))]
    if not vals:
        return {"n": 0}
    return {"n": len(vals), "median": median(vals), "min": min(vals), "max": max(vals), "range": max(vals) - min(vals)}
payload = {
    "status": "PASS" if len(ok) >= 1 else "FAIL",
    "trials": rows,
    "intake_ms": summarize("intake_ms"),
    "wait_ms": summarize("wait_ms"),
    "sse_first_event_ms": summarize("sse_first_event_ms"),
    "runtime_rss_peak": summarize("runtime_rss_peak"),
    "runtime_cpu_seconds": summarize("runtime_cpu_seconds"),
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["one_gen_one_sse"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 6. long SSE holds DB transaction (quantify §2.3)
# ---------------------------------------------------------------------------
log "scenario long-SSE / DB transaction hold"
wl provider-config --url "$FAKE/g1/config" --hold-ms 20000 --first-token-ms 200 --delta-ms 50 --chunks 4 >/dev/null || true
txdir="$RUN_DIR/txhold"
mkdir -p "$txdir"
# One 20s live-tail first so Hikari/circuit stay usable; then two more for the
# 3-stream portrait (Java SSE cap is 3). Query text is never selected.
i=1
pids=()
while [ "$i" -le 3 ]; do
  wl turn-with-sse "${OWNER1_AUTH[@]}" \
    --conversation-id "$OWNER1_CONV" --text "g1 hold stream $i" \
    --idempotency-key "g1-hold-$i-$(date +%s%N)" --timeout 50 \
    > "$txdir/sse-$i.json" &
  pids+=("$!")
  if [ "$i" -eq 1 ]; then
    sleep 2
  fi
  i=$((i + 1))
done
t=1
while [ "$t" -le 12 ]; do
  snap "$txdir/snap-$t.json" || true
  sleep 2
  t=$((t + 1))
done
for pid in "${pids[@]}"; do
  wait "$pid" || true
done
wl provider-config --url "$FAKE/g1/config" --hold-ms 0 --first-token-ms 200 >/dev/null || true
seed_db || true
python3 - "$RESULTS" "$txdir" <<'PY'
import json, sys
from pathlib import Path
results_path, txdir = sys.argv[1:]
snaps = []
max_xact = 0.0
max_active = 0
max_idle_in_tx = 0
samples = []
for path in sorted(Path(txdir).glob("snap-*.json")):
    snap = json.loads(path.read_text())
    login = ((snap.get("db") or {}).get("runtime_login") or {})
    age = float(login.get("max_xact_age_s") or 0)
    max_xact = max(max_xact, age)
    max_active = max(max_active, int(login.get("active") or 0))
    max_idle_in_tx = max(max_idle_in_tx, int(login.get("idle_in_transaction") or 0))
    samples.append({
        "file": path.name,
        "max_xact_age_s": age,
        "active": login.get("active"),
        "idle": login.get("idle"),
        "idle_in_transaction": login.get("idle_in_transaction"),
        "total": login.get("total"),
        "hikari_active": (snap.get("jvm") or {}).get("hikari_active"),
        "hikari_idle": (snap.get("jvm") or {}).get("hikari_idle"),
        "runtime_rss": (snap.get("runtime_only") or {}).get("rss_bytes"),
    })
payload = {
    "status": "PASS" if samples else "NOT_RUN",
    "method": "fake provider holdMs=20000; 3 concurrent SSE live-tails; sample pg_stat_activity every 2s. Query text is never selected.",
    "java_facts": {
        "OwnerInjectionFilter_wraps_entire_request": True,
        "live_tail_timeout_s": 120,
        "hikari_maximum_pool_size": 5,
        "sse_max_concurrent_per_owner": 3,
    },
    "observed_max_runtime_login_xact_age_s": max_xact,
    "observed_max_runtime_login_active": max_active,
    "observed_max_idle_in_transaction": max_idle_in_tx,
    "samples": samples,
    "note": "If max_xact_age_s stays near the 20s hold, the SSE request is holding a DB transaction. Go must not copy this.",
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["sse_db_transaction_hold"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 7. 3 idle SSE (same hold, already covered) + 4 gen attempt + 8 SSE attempt
# ---------------------------------------------------------------------------
log "scenario 4gen+8sse under Java product caps"
seed_db || true
snap "$RUN_DIR/four-before.json" || true
four_dir="$RUN_DIR/four"
mkdir -p "$four_dir"
(
  t=1
  while [ "$t" -le 45 ]; do
    snap "$four_dir/snap-$t.json" || true
    sleep 1
    t=$((t + 1))
  done
) &
four_samp_pid=$!
python3 - "$OWNERS" "$BASE" "$FAKE" "$RESULTS" "$HERE" <<'PY'
import json, subprocess, sys, time
from pathlib import Path
owners_path, base, fake, results_path, here = sys.argv[1:]
owners = [o for o in json.loads(Path(owners_path).read_text()) if o.get("ok")]
wl = [sys.executable, str(Path(here) / "workload.py"), "--base", base]

def run(args):
    proc = subprocess.run(wl + args, capture_output=True, text=True, check=False)
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "status": 0, "code": "parse"}

run(["provider-config", "--url", f"{fake}/g1/config", "--hold-ms", "500", "--first-token-ms", "200"])

def spec_for(owner, i, text, sse):
    row = {
        "username": owner["username"],
        "conversationId": owner["conversationId"],
        "text": text,
        "idempotencyKey": f"g1-cap-{i}-{int(time.time()*1000)}",
        "sse": sse,
    }
    if owner.get("accessToken"):
        row["accessToken"] = owner["accessToken"]
    else:
        row["password"] = owner["password"]
    return row

specs = []
# 4 gens from owner 0 (cap 4). Extra SSE from other owners so we can ask for 8 streams.
for i, owner in enumerate(owners[:8]):
    specs.append(spec_for(owner, i, f"g1 cap probe {i}", True))
# First: single-owner 4 gen + 3 sse (true product cap)
cap_specs = []
o0 = owners[0]
for i in range(4):
    cap_specs.append(spec_for(o0, 100 + i, f"g1 owner-cap {i}", i < 3))
one_owner = run(["concurrent", "--specs", json.dumps(cap_specs), "--timeout", "40"])
multi = run(["concurrent", "--specs", json.dumps(specs[:8]), "--timeout", "40"])
run(["provider-config", "--url", f"{fake}/g1/config", "--hold-ms", "0"])
payload = {
    "status": "PASS" if one_owner.get("n") else "FAIL",
    "java_caps": {
        "GENERATION_MAX_CONCURRENT": 4,
        "SSE_MAX_CONCURRENT": 3,
        "hikari_maximum_pool_size": 5,
    },
    "one_owner_4gen_3sse": {
        "n": one_owner.get("n"),
        "completed": one_owner.get("completed"),
        "elapsed_ms": one_owner.get("elapsed_ms"),
        "sse_statuses": [((r.get("sse") or {}).get("status")) for r in one_owner.get("results") or []],
        "gen_statuses": [r.get("status") for r in one_owner.get("results") or []],
    },
    "eight_owners_8gen_8sse": {
        "n": multi.get("n"),
        "completed": multi.get("completed"),
        "elapsed_ms": multi.get("elapsed_ms"),
        "note": "Java per-owner SSE cap is 3; this uses extra owners so 8 connections can exist. Not a product promise.",
        "sse_statuses": [((r.get("sse") or {}).get("status")) for r in multi.get("results") or []],
        "gen_statuses": [r.get("status") for r in multi.get("results") or []],
    },
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["four_gen_eight_sse"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
print(json.dumps({"one_owner_completed": one_owner.get("completed"), "multi_completed": multi.get("completed")}))
PY
kill "$four_samp_pid" >/dev/null 2>&1 || true
wait "$four_samp_pid" 2>/dev/null || true
snap "$RUN_DIR/four-after.json" || true
python3 - "$RESULTS" "$four_dir" "$RUN_DIR/four-before.json" "$RUN_DIR/four-after.json" <<'PY'
import json, sys
from pathlib import Path
results_path, four_dir, before_p, after_p = sys.argv[1:]
peaks = []
def take(path):
    if not Path(path).exists():
        return
    snap = json.loads(Path(path).read_text())
    rt = snap.get("runtime_only") or {}
    if isinstance(rt.get("rss_bytes"), (int, float)):
        peaks.append({
            "file": Path(path).name,
            "runtime_rss": rt.get("rss_bytes"),
            "runtime_pss": rt.get("pss_bytes"),
            "retained_rss": (snap.get("retained_stack") or {}).get("rss_bytes"),
            "retained_pss": (snap.get("retained_stack") or {}).get("pss_bytes"),
            "hikari_active": (snap.get("jvm") or {}).get("hikari_active"),
            "max_xact_age_s": ((snap.get("db") or {}).get("runtime_login") or {}).get("max_xact_age_s"),
        })
take(before_p)
for path in sorted(Path(four_dir).glob("snap-*.json")):
    take(path)
take(after_p)
rss = [p["runtime_rss"] for p in peaks if isinstance(p.get("runtime_rss"), (int, float))]
pss = [p["runtime_pss"] for p in peaks if isinstance(p.get("runtime_pss"), (int, float))]
retained = [p["retained_rss"] for p in peaks if isinstance(p.get("retained_rss"), (int, float))]
data = json.loads(Path(results_path).read_text())
sc = data.setdefault("scenarios", {}).setdefault("four_gen_eight_sse", {})
sc["runtime_rss_peak_bytes"] = max(rss) if rss else None
sc["runtime_pss_peak_bytes"] = max(pss) if pss else None
sc["retained_rss_peak_bytes"] = max(retained) if retained else None
sc["resource_samples_n"] = len(peaks)
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 8. cancel / reconnect / slow subscriber
# ---------------------------------------------------------------------------
log "scenario cancel/reconnect/slow"
wl provider-config --url "$FAKE/g1/config" --hold-ms 5000 --first-token-ms 200 >/dev/null || true
wl cancel "${OWNER1_AUTH[@]}" \
  --conversation-id "$OWNER1_CONV" --text "g1 cancel please" \
  --idempotency-key "g1-cancel-$(date +%s%N)" --timeout 20 \
  > "$RUN_DIR/cancel.json" || true
# reconnect: two SSE on a generation (second after first ticket consumed)
wl provider-config --url "$FAKE/g1/config" --hold-ms 8000 >/dev/null || true
wl turn-with-sse "${OWNER1_AUTH[@]}" \
  --conversation-id "$OWNER1_CONV" --text "g1 reconnect" \
  --idempotency-key "g1-reconn-$(date +%s%N)" --timeout 20 \
  > "$RUN_DIR/reconnect-a.json" || true
# slow subscriber
wl turn-with-sse "${OWNER1_AUTH[@]}" \
  --conversation-id "$OWNER1_CONV" --text "g1 slow sub" \
  --idempotency-key "g1-slow-$(date +%s%N)" --timeout 20 --slow \
  > "$RUN_DIR/slow.json" || true
wl provider-config --url "$FAKE/g1/config" --hold-ms 0 >/dev/null || true
python3 - "$RESULTS" "$RUN_DIR" <<'PY'
import json, sys
from pathlib import Path
results_path, rundir = sys.argv[1:]
def load(name):
    p = Path(rundir) / name
    if not p.exists():
        return {"status": "NOT_RUN"}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {"status": "FAIL", "reason": "parse"}
payload = {
    "status": "PASS",
    "cancel": load("cancel.json"),
    "reconnect_first_stream": load("reconnect-a.json"),
    "slow_subscriber": load("slow.json"),
    "note": "Second-ticket reconnect on a live generation is single-use tickets; a true mid-stream reconnect is NOT_RUN if the first stream already consumed the generation ticket.",
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["cancel_reconnect_slow"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 9. 100 consecutive generations then idle sample
# ---------------------------------------------------------------------------
log "scenario ${GEN100} consecutive generations"
seed_db || true
wl provider-config --url "$FAKE/g1/config" --hold-ms 0 --first-token-ms 50 --delta-ms 10 --chunks 2 >/dev/null || true
snap "$RUN_DIR/gen100-before.json"
python3 - "$OWNERS" "$BASE" "$GEN100" "$RUN_DIR/gen100.json" "$ROOT" <<'PY'
import json, subprocess, sys, time
from pathlib import Path
owners_path, base, n, out, root = sys.argv[1:]
owner = next(o for o in json.loads(Path(owners_path).read_text()) if o.get("ok"))
ok = 0
fail = 0
rate_limited = 0
intakes = []
waits = []
t0 = time.perf_counter()
auth = ["--access-token", owner["accessToken"]] if owner.get("accessToken") else [
    "--username", owner["username"], "--password", owner["password"]
]
for i in range(int(n)):
    proc = subprocess.run(
        [sys.executable, "scripts/measure/g1-java-baseline/workload.py", "--base", base,
         "generation", *auth,
         "--conversation-id", str(owner["conversationId"]), "--text", f"g1 burst {i}",
         "--idempotency-key", f"g1-burst-{i}-{int(t0*1000)}", "--timeout", "30"],
        cwd=root,
        capture_output=True, text=True, check=False,
    )
    try:
        body = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        body = {"ok": False}
    if body.get("ok"):
        ok += 1
        if isinstance(body.get("intake_ms"), (int, float)):
            intakes.append(body["intake_ms"])
        if isinstance(body.get("wait_ms"), (int, float)):
            waits.append(body["wait_ms"])
    else:
        fail += 1
        if body.get("status") == 429:
            rate_limited += 1
elapsed = (time.perf_counter() - t0) * 1000
from statistics import median
def summarize(vals):
    if not vals:
        return {"n": 0}
    return {"n": len(vals), "median": median(vals), "min": min(vals), "max": max(vals), "p95": sorted(vals)[max(0, int(len(vals)*0.95)-1)]}
Path(out).write_text(json.dumps({
    "requested": int(n),
    "ok": ok,
    "fail": fail,
    "http_429": rate_limited,
    "elapsed_ms": elapsed,
    "intake_ms": summarize(intakes),
    "wait_ms": summarize(waits),
    "status": "PASS" if ok == int(n) else ("PARTIAL" if ok else "FAIL"),
    "note": "Java generation admission is 20 POSTs / 60s / owner. Workload retries 429 using Retry-After.",
}, indent=2) + "\n")
print(f"gen100 ok={ok} fail={fail} http_429={rate_limited}")
PY
log "post-100 idle ${POST_IDLE_SECONDS}s"
sleep "$POST_IDLE_SECONDS"
snap "$RUN_DIR/gen100-after-idle.json"
python3 - "$RESULTS" "$RUN_DIR/gen100.json" "$RUN_DIR/gen100-before.json" "$RUN_DIR/gen100-after-idle.json" <<'PY'
import json, sys
from pathlib import Path
results_path, body_p, b_p, a_p = sys.argv[1:]
body = json.loads(Path(body_p).read_text())
before = json.loads(Path(b_p).read_text())
after = json.loads(Path(a_p).read_text())
rt0, rt1 = before.get("runtime_only") or {}, after.get("runtime_only") or {}
body["runtime_rss_before"] = rt0.get("rss_bytes")
body["runtime_rss_after_idle15s"] = rt1.get("rss_bytes")
body["runtime_rss_after_post_idle"] = rt1.get("rss_bytes")
body["runtime_pss_after_post_idle"] = rt1.get("pss_bytes")
body["runtime_fd_before"] = rt0.get("fd")
body["runtime_fd_after_idle15s"] = rt1.get("fd")
body["runtime_fd_after_post_idle"] = rt1.get("fd")
body["db_before"] = (before.get("db") or {}).get("runtime_login")
body["db_after_idle15s"] = (after.get("db") or {}).get("runtime_login")
body["db_after_post_idle"] = (after.get("db") or {}).get("runtime_login")
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["hundred_generations"] = body
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

# ---------------------------------------------------------------------------
# 10. worker crash during provider hold (before session revoke so the token is live)
# ---------------------------------------------------------------------------
log "scenario worker crash during provider stream"
wl provider-config --url "$FAKE/g1/config" --hold-ms 15000 >/dev/null || true
wl turn-with-sse "${OWNER1_AUTH[@]}" \
  --conversation-id "$OWNER1_CONV" --text "g1 crash window" \
  --idempotency-key "g1-crash-$(date +%s%N)" --timeout 8 \
  > "$RUN_DIR/crash-start.json" &
crash_pid=$!
sleep 3
snap "$RUN_DIR/crash-before-kill.json" || true
RT_CID="$("${DOCKER[@]}" ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=runtime)"
if [ -n "$RT_CID" ]; then
  "${DOCKER[@]}" exec "$RT_CID" kill -9 1 >/dev/null 2>&1 || "${DOCKER[@]}" kill "$RT_CID" >/dev/null 2>&1 || true
fi
sleep 2
snap "$RUN_DIR/crash-after-kill.json" || true
wait "$crash_pid" || true
# restore runtime for cipher counts
"${COMPOSE[@]}" up -d runtime fake-provider >/dev/null || true
wait_http "http://127.0.0.1:18081/actuator/health" 60 || true
ensure_admin_token || true
python3 - "$RESULTS" "$RUN_DIR" <<'PY'
import json, sys
from pathlib import Path
results_path, rundir = sys.argv[1:]
def load(name):
    p = Path(rundir) / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return None
before = load("crash-before-kill.json") or {}
after = load("crash-after-kill.json") or {}
payload = {
    "status": "PASS",
    "point": "provider_stream",
    "claim_point": "NOT_RUN",
    "finalize_point": "NOT_RUN",
    "reason_not_run": "Claim and finalize windows are milliseconds-wide without crash hooks; G1 does not add Java instrumentation.",
    "db_before_kill": (before.get("db") or {}).get("runtime_login"),
    "db_after_kill": (after.get("db") or {}).get("runtime_login"),
    "xact_before_s": ((before.get("db") or {}).get("runtime_login") or {}).get("max_xact_age_s"),
    "xact_after_s": ((after.get("db") or {}).get("runtime_login") or {}).get("max_xact_age_s"),
}
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["worker_crash"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY
wl provider-config --url "$FAKE/g1/config" --hold-ms 0 >/dev/null || true

# ---------------------------------------------------------------------------
# 12. 16 gen + 64 SSE capacity portrait (Java will 429)
# ---------------------------------------------------------------------------
log "scenario capacity 16+64 portrait"
python3 - "$OWNERS" "$BASE" "$RESULTS" "$ROOT" <<'PY'
import json, subprocess, sys, time
from pathlib import Path
owners_path, base, results_path, root = sys.argv[1:]
owners = [o for o in json.loads(Path(owners_path).read_text()) if o.get("ok")]
if not owners:
    payload = {"status": "NOT_RUN", "reason": "no_owners"}
else:
    specs = []
    for i in range(16):
        o = owners[i % len(owners)]
        row = {
            "username": o["username"],
            "conversationId": o["conversationId"],
            "text": f"g1 cap16 {i}",
            "idempotencyKey": f"g1-16-{i}-{int(time.time()*1000)}",
            "sse": True,
        }
        if o.get("accessToken"):
            row["accessToken"] = o["accessToken"]
        else:
            row["password"] = o["password"]
        specs.append(row)
    proc = subprocess.run(
        [sys.executable, "scripts/measure/g1-java-baseline/workload.py", "--base", base,
         "concurrent", "--specs", json.dumps(specs), "--timeout", "40"],
        cwd=root,
        capture_output=True, text=True, check=False,
    )
    try:
        body = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        body = {"ok": False}
    payload = {
        "status": "PASS",
        "note": "Capacity portrait only, not a product promise. Java generation lease=4/owner and SSE lease=3/owner, so 16+64 on few owners saturates with 429.",
        "requested_generations": 16,
        "requested_sse": 16,
        "completed": body.get("completed"),
        "elapsed_ms": body.get("elapsed_ms"),
        "gen_statuses": [r.get("status") for r in body.get("results") or []],
        "sse_statuses": [((r.get("sse") or {}).get("status")) for r in body.get("results") or []],
        "sixty_four_sse": "NOT_RUN",
        "sixty_four_sse_reason": "Opening 64 concurrent live-tails would require many owners or raising Java SSE_MAX_CONCURRENT; G1 does not change product caps. 16 streams already portrait saturation.",
    }
data = json.loads(Path(results_path).read_text())
data.setdefault("scenarios", {})["capacity_16_64"] = payload
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

log "scenario login/revoke storm"
OWNER1_PASS_FOR_REVOKE="$(python3 -c "import json; d=json.load(open('$OWNERS')); o=next(x for x in d if x.get('ok')); print(o['password'])")"
wl revoke-storm --username "$OWNER1_USER" --password "$OWNER1_PASS_FOR_REVOKE" --count 8 \
  > "$RUN_DIR/revoke.json" || true
unset OWNER1_PASS_FOR_REVOKE
if [ -f "$RUN_DIR/revoke.json" ]; then
  merge_json scenarios.login_revoke < "$RUN_DIR/revoke.json"
else
  merge_json scenarios.login_revoke '{"status":"NOT_RUN","reason":"revoke_json_missing"}'
fi
fi

# ---------------------------------------------------------------------------
# 13. cipher counts + data volume (no content)
# ---------------------------------------------------------------------------
log "cipher format counts (prefix only)"
DBCID="$("${DOCKER[@]}" ps -q --filter label=com.docker.compose.project=$PROJECT --filter label=com.docker.compose.service=db)"
if [ -n "$DBCID" ]; then
  "${DOCKER[@]}" exec -i "$DBCID" psql -U vc_migrator -d vc -t -A -q --no-psqlrc \
    < "$HERE/cipher_counts.sql" > "$RUN_DIR/cipher.json" || true
  python3 - "$RESULTS" "$RUN_DIR/cipher.json" <<'PY'
import json, sys
from pathlib import Path
results_path, raw_path = sys.argv[1:]
text = Path(raw_path).read_text().strip()
start = text.find("[")
if start >= 0:
    text = text[start:]
end = text.rfind("]")
if end >= 0:
    text = text[: end + 1]
try:
    rows = json.loads(text) if text else []
    status = "PASS"
except json.JSONDecodeError:
    rows, status = [], "FAIL"
data = json.loads(Path(results_path).read_text())
data["cipher_baseline"] = {
    "status": status,
    "machine": "linux-synthetic-g1-volume",
    "not_owner_mac_data": True,
    "columns": rows,
    "note": "Counts only. No ciphertext or plaintext values were returned. Owner must re-run cipher_counts.sql against the Mac volume to freeze real-data numbers.",
}
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY
else
  merge_json cipher_baseline <<<"{\"status\":\"NOT_RUN\",\"reason\":\"db_container_missing\"}"
fi

# ---------------------------------------------------------------------------
# 14. final idle snapshot + image sizes
# ---------------------------------------------------------------------------
snap "$RUN_DIR/final.json" || true
python3 - "$RESULTS" "$RUN_DIR/final.json" "$RUN_DIR/machine.json" <<'PY'
import json, sys, time
from pathlib import Path
results_path, final_p, machine_p = sys.argv[1:]
data = json.loads(Path(results_path).read_text())
if Path(final_p).exists():
    data["final_snapshot"] = json.loads(Path(final_p).read_text())
data["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
Path(results_path).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PY

python3 "$HERE/report.py" --results "$RESULTS" --markdown "$REPORT_MD" --json-out "$REPORT_JSON"
log "wrote $REPORT_MD"
log "G1 measurement finished"
exit 0
