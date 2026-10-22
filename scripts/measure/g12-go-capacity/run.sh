#!/usr/bin/env bash
# G12 Go capacity profile on the production-derived resident stack (VC-R58).
#
# Same-window A/B collection against the §19.1 B boundary: the stack is
# rendered privately from ops/deploy (production Go/MinIO/Caddy Dockerfiles,
# PG18+pgvector digest-pinned, per-trial project/image tags), traffic enters
# through Caddy's loopback TLS port, so A — the companiond process the traffic
# actually hits (runtime PID 1) — and B — each component's whole container
# cgroup (db/runtime/minio/caddy) — are measured over the same windows.
#
# Default mode keeps the full profile and every pre-existing assertion
# (warm-up with disjoint idempotency keys, measured idle, scenario 5
# 4 gen + 8 SSE, scenario 10 16 gen + 64 SSE, 100-turn soak, post-idle
# recovery, provider/worker peak proofs), now with the §19.1 600 s
# idle/recovery windows as defaults, B-side per-component frames recorded
# next to the A-side process numbers, and §19.1 scenario 4 (exactly
# 1 generation + 1 SSE) first: its incremental SSE parser records the
# first live chat.delta against explicit send/accept/subscribe baselines
# and subtracts the fake provider's known hold+firstToken window into a
# qualified adjusted value (never presented as pure service time; no ms
# threshold is asserted — §19.2 gates stay Owner-frozen).
#
# --probe is FUNCTIONAL_ONLY: a short, bounded run proving the stack boots
# (migrate/bootstrap/minio-init exit 0), Caddy TLS readiness via the private
# CA, collector field completeness/attribution/observer exclusion/aggregation,
# and at most one real 1-gen + 1-SSE chain (scenario 4 branch) with
# fake-provider counting and first-delta timing wiring. It draws no
# performance or capacity conclusions and satisfies no §19.2 gate.
#
# Secrets are synthetic and fabricated locally; never a real provider, never
# real user data. Each invocation is one independent trial with its own
# project, images, output directory, and data. Ownership is receipt-based
# (VC-R59): a fresh per-invocation nonce is stamped onto every rendered
# service/volume/network label, the stack is created with `compose create`
# (nothing started), the exact created identities are recorded, and only
# then is the stack started — so cleanup removes only what this run's own
# create action provably produced, and a failed cleanup keeps the records
# for recovery instead of discarding them.
#
# Usage: bash scripts/measure/g12-go-capacity/run.sh [--probe]
set -euo pipefail
export DOCKER_CONTEXT=orbstack

PROBE=0
if [ "${1:-}" = "--probe" ]; then
  PROBE=1
elif [ $# -gt 0 ]; then
  echo "usage: run.sh [--probe]" >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TRIAL_ID="$(printf '%s' "${G12_TRIAL_ID:-$(date -u +%Y%m%dT%H%M%SZ)}" | tr 'A-Z' 'a-z')"
# Per-trial output directory (default): every run starts from an empty
# ownership state, so a later run can never adopt a previous run's records.
RUN_DIR="${G12_OUTPUT_DIR:-$HERE/.run/$TRIAL_ID}"
# Per-invocation creation receipt (VC-R59): render_stack.py stamps it onto
# every service/volume/network label and resources.py requires it — only
# this invocation ever generates the value, so an object carrying it is
# provably this run's own creation. The shared compose project label and
# resource names are never used as creator proofs.
NONCE="$(openssl rand -hex 16)"
PROJECT="${G12_PROJECT:-vcg12c-$TRIAL_ID}"
# Image tags are scoped per invocation (project + nonce prefix): two callers
# explicitly sharing one project can never build or overwrite each other's
# trial tags.
TRIAL_TAG="$PROJECT-${NONCE:0:8}"
HTTPS_PORT="${G12_HTTPS_PORT:-18447}"
FAKE_PORT="${G12_FAKE_PROVIDER_PORT:-19091}"
MINIO_IMAGE="virtual-companion-minio:$TRIAL_TAG"
RUNTIME_IMAGE="virtual-companion-runtime:$TRIAL_TAG"
CADDY_IMAGE="virtual-companion-caddy:$TRIAL_TAG"
STACK_COMPOSE="$RUN_DIR/stack.compose.json"
ENVFILE="$RUN_DIR/compose.env"
RUNTIME_ENVFILE="$RUN_DIR/runtime.env"
CA_FILE="$RUN_DIR/caddy-local-ca.crt"
FRAMES_DIR="$RUN_DIR/frames"
MANIFEST="$RUN_DIR/manifest.json"
CAPTURE="$RUN_DIR/created-resources.json"
COLLECTORS="$RUN_DIR/collectors.json"
FRAMES="$RUN_DIR/frames.jsonl"
STOP_FILE="$RUN_DIR/collector.stop"
# Written right before the one `up`. Cleanup performs docker writes only
# while it exists; because the per-trial RUN_DIR was proven free of
# prior-run ownership state before cleanup was registered, its presence can
# only mean THIS run attempted creation.
CREATING="$RUN_DIR/.stack-creating"
BUILT_IMAGES="$RUN_DIR/built-images.json"
# Marks that THIS run attempted the collector launch: cleanup then REQUIRES
# the collectors receipt — after helpers may have been created, a missing
# record is unverified, never "not launched". Touched before the launch
# call and only removed by a cleanup that proved everything gone.
COLLECTORS_LAUNCHED="$RUN_DIR/.collectors-launched"
GO_BASE="https://localhost:$HTTPS_PORT"
GENS_S5="${G12_GENS_S5:-4}"
SSE_S5="${G12_SSE_S5:-2}"
GENS_S10="${G12_GENS_S10:-16}"
SSE_S10="${G12_SSE_S10:-4}"
CONCURRENCY="${G12_CONCURRENCY:-16}"
OUTSTANDING="${G12_OUTSTANDING:-16}"
WARMUP="${G12_WARMUP:-1}"
SOAK_TURNS="${G12_SOAK_TURNS:-100}"
SOAK_BATCH="${G12_SOAK_BATCH:-10}"
SAMPLE_INTERVAL="${G12_SAMPLE_INTERVAL:-0.5}"
READER_INTERVAL="${G12_READER_INTERVAL:-1}"
# §19.1 idle/recovery windows: the spec calls for 10 minutes. Probe shrinks
# these to a bounded functional window and never reports performance numbers.
IDLE_SECONDS="${G12_IDLE_SECONDS:-600}"
WARM_IDLE_SECONDS="${G12_WARM_IDLE_SECONDS:-10}"
POST_IDLE_SECONDS="${G12_POST_IDLE_SECONDS:-600}"
if [ "$PROBE" = "1" ]; then
  IDLE_SECONDS="${G12_PROBE_IDLE_SECONDS:-6}"
  POST_IDLE_SECONDS="${G12_PROBE_POST_IDLE_SECONDS:-6}"
  WARMUP=0
fi
MODE=$([ "$PROBE" = "1" ] && echo PROBE || echo PROFILE)

COMPOSE=(docker compose --env-file "$ENVFILE" -f "$STACK_COMPOSE" -p "$PROJECT")

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { printf 'G12 FAIL: %s\n' "$*" >&2; exit 1; }

# Everything below runs under a private umask: the rendered compose and env
# files interpolate synthetic secrets and must stay 0600, and the output
# directory is private from the moment it is created.
umask 077

# Exclusive output ownership, atomically. The default per-trial directory is
# created by THIS invocation (plain mkdir fails if anything exists); an
# explicit G12_OUTPUT_DIR must be absent or an empty directory, claimed with
# an atomic marker mkdir. Neither a previous run's directory nor a
# concurrent invocation can be taken over — and refusal happens before
# cleanup is registered, so it performs zero docker writes.
RUN_PARENT="$(dirname "$RUN_DIR")"
mkdir -p "$RUN_PARENT" || die "cannot create output parent $RUN_PARENT"
if [ -e "$RUN_DIR" ]; then
  if [ -z "${G12_OUTPUT_DIR:-}" ] || [ ! -d "$RUN_DIR" ] \
     || [ -n "$(ls -A "$RUN_DIR" 2>/dev/null)" ]; then
    die "refusing to reuse existing output directory $RUN_DIR (prior-run state or concurrent invocation); use a fresh directory"
  fi
else
  mkdir "$RUN_DIR" 2>/dev/null \
    || die "output directory $RUN_DIR was taken by a concurrent invocation"
fi
mkdir "$RUN_DIR/.g12-owner" 2>/dev/null \
  || die "output directory $RUN_DIR is already claimed by another invocation"
mkdir -p "$FRAMES_DIR"
chmod 700 "$RUN_DIR" "$FRAMES_DIR"

cleanup() {
  local rc=$?
  if [ -n "${SAMPLER_PID:-}" ]; then
    kill -TERM "$SAMPLER_PID" 2>/dev/null || true
    touch "$STOP_FILE" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$SAMPLER_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
  fi
  if [ "${G12_KEEP:-0}" != "1" ] && [ -f "$CREATING" ]; then
    local keep_records=0
    # One actual exit path for everything this run created: collector CIDs,
    # the nonce-receipted stack inventory, and this run's trial image tags —
    # each identity-checked before removal, absence proven only by rc0/count0
    # daemon queries, leftovers persisted to cleanup.leftovers.json. The
    # collectors record is required exactly when this run attempted the
    # collector launch (marker file); an EXIT-trap `return` would NOT
    # override a successful main flow, so a cleanup failure must be
    # propagated with an explicit exit.
    if ! python3 "$HERE/resources.py" cleanup \
        --capture "$CAPTURE" --built "$BUILT_IMAGES" \
        --collectors "$COLLECTORS" --leftovers-out "$RUN_DIR/cleanup.leftovers.json" \
        --project "$PROJECT" \
        --collectors-required "$([ -f "$COLLECTORS_LAUNCHED" ] && echo yes || echo no)"; then
      log "cleanup: leftover or unverified resources (see $RUN_DIR/cleanup.leftovers.json)"
      rc=1
      keep_records=1
    fi
    if [ "$keep_records" = "0" ]; then
      rm -f "$ENVFILE" "$RUNTIME_ENVFILE" "$CA_FILE" "$STACK_COMPOSE" \
        "$CREATING" "$BUILT_IMAGES" "$COLLECTORS_LAUNCHED"
    else
      # The ownership records stay for manual recovery — deleting them on a
      # failed cleanup would lose the only evidence of what to recover.
      # Everything remains inside this private (0700) run directory.
      log "cleanup: kept ownership records for recovery: $CAPTURE $BUILT_IMAGES $COLLECTORS $RUN_DIR/cleanup.leftovers.json"
    fi
  fi
  exit "$rc"
}

# Test seam AFTER cleanup() is defined: unit tests source this script and
# drive the real cleanup() with a stubbed docker (asserting the function
# exists, so a missing-command 127 can never pose as a negative pass);
# nothing below runs in that mode.
if [ "${G12_SOURCE_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi
trap cleanup EXIT

metric_value() {
  local name="$1" out
  out=$(python3 "$HERE/collector.py" scrape --manifest "$MANIFEST" \
    --image "$MINIO_IMAGE" --metrics "$name") || return 1
  python3 - "$out" "$name" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
v = d["metrics"].get(sys.argv[2])
if v is None:
    raise SystemExit(f"metric {sys.argv[2]} missing from scrape")
print(v)
PY
}

provider_stats() {
  python3 "$HERE/collector.py" scrape --manifest "$MANIFEST" \
    --image "$MINIO_IMAGE" | python3 -c '
import json, sys
d = json.load(sys.stdin)
p = d.get("provider")
if p is None:
    raise SystemExit("fake provider stats unreachable")
print(json.dumps(p))
'
}

analyze_window() {
  python3 "$HERE/collector.py" analyze --frames "$FRAMES" \
    --started "$1" --ended "$2"
}

psql_q() { "${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -tAc "$1"; }

echo "== G12 preflight ($MODE) =="
docker info >/dev/null 2>&1 || die "docker unreachable"
[ "$(docker context show)" = "orbstack" ] || die "docker context must be orbstack"

# Resource-safety pre-check, all proofs rc0-based (a failed query is not
# "absent"): this invocation's nonce must not exist anywhere yet, the three
# project-label queries must succeed and come back empty, each
# expected-absent name must be absent from successful listings, and no trial
# image tag may pre-exist — the build must never overwrite an existing tag
# (VC-R59).
if ! python3 "$HERE/resources.py" require-absent --project "$PROJECT" \
    --nonce "$NONCE" \
    --name "${PROJECT}_db-data" --name "${PROJECT}_minio-data" \
    --name "${PROJECT}_caddy-data" --name "${PROJECT}_caddy-config" \
    --name "${PROJECT}_default" --name "$PROJECT-reader-db" \
    --name "$PROJECT-reader-runtime" --name "$PROJECT-reader-minio" \
    --name "$PROJECT-reader-caddy" --name "$PROJECT-observer" \
    --tag "$MINIO_IMAGE" --tag "$RUNTIME_IMAGE" --tag "$CADDY_IMAGE"; then
  die "expected-absent resources exist (or absence could not be proven); refusing"
fi
echo "  frontend bundle for the production Caddy image"
pnpm --dir "$ROOT/frontend" build >/dev/null || die "frontend build failed"

VC_MIGRATOR_DB_PASSWORD=$(openssl rand -hex 32)
VC_RUNTIME_DB_PASSWORD=$(openssl rand -hex 32)
VC_CRYPTO_REST_KEY=$(openssl rand -base64 32 | tr -d '\n')
VC_OWNER_BINDING_SECRET=$(openssl rand -hex 32)
MINIO_ACCESS_KEY=$(openssl rand -hex 8)
MINIO_SECRET_KEY=$(openssl rand -hex 24)
cat > "$ENVFILE" <<EOF
VC_MIGRATOR_DB_PASSWORD=$VC_MIGRATOR_DB_PASSWORD
VC_RUNTIME_DB_PASSWORD=$VC_RUNTIME_DB_PASSWORD
VC_OWNER_BINDING_SECRET=$VC_OWNER_BINDING_SECRET
VC_CRYPTO_REST_KEY=$VC_CRYPTO_REST_KEY
VC_DOMAIN=localhost
VC_EXPORT_S3_ACCESS_KEY=$MINIO_ACCESS_KEY
VC_EXPORT_S3_SECRET_KEY=$MINIO_SECRET_KEY
VC_EXPORT_S3_BUCKET=g12-exports
EOF
cat > "$RUNTIME_ENVFILE" <<EOF
VC_PROVIDER_ENABLED=true
VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true
VC_PROVIDER_ID=g12-openai
VC_PROVIDER_SUPPLIER_NAME=g12-local-fake
VC_PROVIDER_ENDPOINT=http://127.0.0.1:$FAKE_PORT/v1/chat/completions
VC_PROVIDER_TOKEN=g12-fake-token
VC_PROVIDER_MODEL=g12-model
VC_MAX_OUTSTANDING_TURNS=$OUTSTANDING
VC_MAX_CONCURRENT_TURNS=$CONCURRENCY
EOF
chmod 600 "$ENVFILE" "$RUNTIME_ENVFILE"

echo "== render trial stack from ops/deploy =="
python3 "$HERE/render_stack.py" --project "$PROJECT" --env-file "$ENVFILE" \
  --out "$STACK_COMPOSE" --repo-root "$ROOT" --tag "$TRIAL_TAG" \
  --https-port "$HTTPS_PORT" --fake-provider-port "$FAKE_PORT" \
  --runtime-env "$RUNTIME_ENVFILE" --nonce "$NONCE" \
  > "$RUN_DIR/render.summary.json" \
  || die "stack render/validation failed"
cat "$RUN_DIR/render.summary.json"
chmod 600 "$RUN_DIR/render.summary.json"

# Every preflight and render check has passed. Mark the run as creating —
# cleanup() only performs docker writes while this marker exists.
touch "$CREATING"

echo "== build + create resident stack (db, migrate, bootstrap, minio, runtime, caddy; nothing started) =="
CREATE_STATUS=0
# --no-recreate: create must never touch (replace/stop) a pre-existing
# container — foreign objects are refused later at the start gate, not
# silently adopted or replaced before receipts exist.
"${COMPOSE[@]}" create --build --no-recreate > "$RUN_DIR/create.log" 2>&1 || CREATE_STATUS=1
# Creation receipts BEFORE anything starts: record the exact identities this
# run's create action produced — every object carrying this invocation's
# nonce (CIDs/mounts/networks, volume driver/CreatedAt, network immutable
# id) plus the actual identities of any trial tags the build produced —
# partial creates included. Cleanup consumes only these records; another
# creator on the same project label cannot appear in them.
python3 "$HERE/resources.py" capture --project "$PROJECT" --nonce "$NONCE" \
  --out "$CAPTURE" || die "created-inventory capture failed"
python3 "$HERE/resources.py" record-built --out "$BUILT_IMAGES" \
  "$MINIO_IMAGE" "$RUNTIME_IMAGE" "$CADDY_IMAGE" \
  || die "built-image identity recording failed"
if [ "$CREATE_STATUS" -ne 0 ]; then
  tail -40 "$RUN_DIR/create.log" >&2 || true
  die "stack create/build failed"
fi

# Pre-start completeness gate against the final rendered config: every
# service (one-shots and fake-provider included), every declared volume and
# network, and every volume a receipted container actually mounts must
# carry this run's nonce receipt. A foreign object holding an expected name
# leaves that service unreceipted -> start is forbidden; cleanup (via the
# EXIT trap) then removes only what this run provably created.
if ! python3 "$HERE/resources.py" verify-start \
    --compose "$STACK_COMPOSE" --capture "$CAPTURE"; then
  die "start refused: rendered resources are not all proven created by this run"
fi

echo "== start resident stack (verified existing containers only) =="
# --no-build/--no-recreate: the start path may only start the verified,
# already-created containers — never rebuild, re-create, or create anything
# new after the receipts were taken (compose still applies the production
# dependency/health ordering when starting them).
if ! "${COMPOSE[@]}" up -d --no-build --no-recreate > "$RUN_DIR/up.log" 2>&1; then
  tail -40 "$RUN_DIR/up.log" >&2 || true
  die "stack start failed"
fi
DB_READY=0
for _ in $(seq 1 90); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' \
      "$("${COMPOSE[@]}" ps -aq db)" 2>/dev/null || true)" = "healthy" ]; then
    DB_READY=1
    break
  fi
  sleep 2
done
[ "$DB_READY" = "1" ] || die "database did not become healthy"
for svc in migrate bootstrap minio-init; do
  SVC_CID="$("${COMPOSE[@]}" ps -aq "$svc")"
  SVC_STATE="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$SVC_CID")"
  [ "$SVC_STATE" = "exited 0" ] || die "$svc state: $SVC_STATE (want exited 0)"
done
echo "  db healthy; migrate/bootstrap/minio-init exited 0"

# Measurement manifest for the collector (measured components only); the
# created inventory in $CAPTURE was recorded immediately after the up.
python3 - "$PROJECT" "$CAPTURE" "$MANIFEST" "$FRAMES_DIR" <<'PY'
import json, sys
project, capture_path, manifest_path, frames_dir = sys.argv[1:5]
capture = json.load(open(capture_path))
# Map by the authoritative compose service label, not by name heuristics.
by_service = {}
for c in capture["containers"]:
    by_service[c["service"]] = c
containers = {}
for comp in ("db", "runtime", "minio", "caddy"):
    if comp not in by_service:
        raise SystemExit(f"missing measured container for service {comp}")
    containers[comp] = {"cid": by_service[comp]["cid"]}
json.dump({"project": project, "frames_dir": frames_dir,
           "containers": containers}, open(manifest_path, "w"), indent=1)
PY

RUNTIME_STARTED_AT=$(docker inspect -f '{{.State.StartedAt}}' \
  "$("${COMPOSE[@]}" ps -aq runtime)")
RUNTIME_START_EPOCH=$(python3 - "$RUNTIME_STARTED_AT" <<'PY'
import datetime, sys
print(datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")).timestamp())
PY
)

# Caddy local CA: fetched from the caddy-data volume through the container,
# used only as an explicit --cacert (never installed into OS trust).
CA_READY=0
for _ in $(seq 1 30); do
  if docker exec "$("${COMPOSE[@]}" ps -aq caddy)" \
      cat /data/caddy/pki/authorities/local/root.crt > "$CA_FILE" 2>/dev/null \
      && [ -s "$CA_FILE" ]; then
    CA_READY=1
    break
  fi
  sleep 1
done
[ "$CA_READY" = "1" ] || die "could not read the Caddy local CA"
chmod 600 "$CA_FILE"
TLS_READY=0
for _ in $(seq 1 120); do
  if curl -fsS --cacert "$CA_FILE" --max-time 2 \
      "$GO_BASE/actuator/health/readiness" 2>/dev/null | grep -q '"UP"'; then
    TLS_READY=1
    break
  fi
  sleep 0.5
done
[ "$TLS_READY" = "1" ] || die "caddy TLS readiness did not come up"
READY_EPOCH=$(python3 -c 'import time; print(time.time())')
COLD_START_MS=$(python3 - "$RUNTIME_START_EPOCH" "$READY_EPOCH" <<'PY'
import sys
print(round((float(sys.argv[2]) - float(sys.argv[1])) * 1000, 1))
PY
)
curl -fsS --cacert "$CA_FILE" "$GO_BASE/actuator/health" | grep -q '"UP"' \
  || die "health endpoint not UP through caddy"
echo "  stack ready via caddy TLS on 127.0.0.1:$HTTPS_PORT (readiness ${COLD_START_MS} ms)"

echo "== seed: release gate / provider / user / session =="
"${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'g12-capacity-v1');
INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
VALUES ('g12-openai', 'OPENAI_CHAT_COMPLETIONS', '{}', 'ADMITTED')
ON CONFLICT (provider_id) DO UPDATE
   SET admission_state = 'ADMITTED', protocol = 'OPENAI_CHAT_COMPLETIONS';
INSERT INTO vc.model_unit_price(
    provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k,
    effective_from, active)
VALUES ('g12-openai', 'g12-model', 1, 0.001, 0.002, now(), true)
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
G12_ACCOUNT_ID=2000001
psql_q "SELECT vc.identity_opaque_session_issue(2000001, '$HASH', now() + interval '12 hours')" >/dev/null
# The session/CSRF travel by named environment variables only (workload.py),
# never through argv or logs.
export G12_SESSION="$RAW" G12_CSRF="$CSRF" G12_ACCOUNT="$G12_ACCOUNT_ID"
echo "  session fabricated"

echo "== fixture: Technical Alpha simulated adult verification =="
# Generation intake fails closed with AGE_VERIFICATION_REQUIRED until the owner
# is ADULT_VERIFIED; the synthetic owner takes the same POST path the H5 flow
# uses, through Caddy TLS with the private CA.
G12_BASE="$GO_BASE" G12_CA="$CA_FILE" python3 - <<'PY' \
  || die "adult verification fixture failed"
import json, os, ssl, urllib.request
base = os.environ["G12_BASE"]
ctx = ssl.create_default_context(cafile=os.environ["G12_CA"])
req = urllib.request.Request(base + "/api/v1/age/verification", method="POST", headers={
    "Origin": "https://localhost",
    "Cookie": f"vc_session={os.environ['G12_SESSION']}; vc_csrf={os.environ['G12_CSRF']}",
    "X-CSRF-Token": os.environ["G12_CSRF"],
    "X-VC-Expected-Account-ID": os.environ["G12_ACCOUNT"],
})
with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
    state = json.loads(resp.read()).get("ageState")
if state != "ADULT_VERIFIED":
    raise SystemExit(f"ageState={state}")
print(f"  ageState={state}")
PY

echo "== start collectors (readers + observer + same-window frame loop) =="
# Mark launch-attempted BEFORE the launch call: once helpers may exist, the
# collectors receipt is required evidence for cleanup (missing/unreadable
# => unverified), never an optional "not launched".
touch "$COLLECTORS_LAUNCHED"
python3 "$HERE/collector.py" launch --manifest "$MANIFEST" --image "$MINIO_IMAGE" \
  --harness-dir "$HERE" --interval "$READER_INTERVAL" --out "$COLLECTORS" \
  || die "collector launch failed"
rm -f "$STOP_FILE"
python3 "$HERE/collector.py" sample --manifest "$MANIFEST" \
  --interval "$SAMPLE_INTERVAL" --out "$FRAMES" --stop-file "$STOP_FILE" \
  > "$RUN_DIR/sample.out" 2>&1 &
SAMPLER_PID=$!
COLLECTOR_READY=0
for _ in $(seq 1 30); do
  if [ -s "$FRAMES" ]; then COLLECTOR_READY=1; break; fi
  sleep 1
done
[ "$COLLECTOR_READY" = "1" ] || die "frame sampler produced no frames"

# Warm-up keys stay disjoint from measured keys, so idempotent replay cannot
# make a sample look faster.
if [ "$WARMUP" -gt 0 ]; then
  echo "== warm-up =="
  for i in $(seq 1 "$WARMUP"); do
    python3 "$HERE/workload.py" --base "$GO_BASE" --scenario s5 \
      --gens 1 --sse-per-gen 1 --key-prefix "$TRIAL_ID-warmup-$i" \
      --cacert "$CA_FILE" >/dev/null || die "warm-up workload failed"
  done
fi

echo "== measured idle (${IDLE_SECONDS}s) =="
IDLE_CPU_BEFORE=$(metric_value process_cpu_seconds_total)
IDLE_STARTED=$(python3 -c 'import time; print(time.time())')
sleep "$IDLE_SECONDS"
IDLE_ENDED=$(python3 -c 'import time; print(time.time())')
IDLE_CPU_AFTER=$(metric_value process_cpu_seconds_total)
IDLE_ANALYSIS=$(analyze_window "$IDLE_STARTED" "$IDLE_ENDED")
IDLE_CPU_SECONDS=$(python3 - "$IDLE_CPU_BEFORE" "$IDLE_CPU_AFTER" <<'PY'
import sys
print(round(float(sys.argv[2]) - float(sys.argv[1]), 6))
PY
)
echo "$IDLE_ANALYSIS" > "$RUN_DIR/idle.analysis.json"
python3 - "$IDLE_ANALYSIS" "$IDLE_CPU_SECONDS" <<'PY'
import json, sys
a = json.loads(sys.argv[1])
idle = a["a"]
print(f"  idle A RSS/PSS mean = {idle['a_rss_mean_kb']}/{idle['a_pss_mean_kb']} kB; "
      f"A CPU = {sys.argv[2]} s")
peak = a["b"]["same_frame_peak"]
if peak:
    print(f"  idle B same-frame RSS/PSS mean = {peak['b_rss_mean_kb']}/"
          f"{peak['b_pss_mean_kb']} kB over {peak['complete_frames']} complete frames")
else:
    print("  idle B same-frame: NO complete frames (all partial)")
cpu_status = {c: k["status"] for c, k in a["b"]["components"].items()}
nonvalid = {c: s for c, s in cpu_status.items() if s != "VALID"}
print(f"  idle B CPU windows = {'all VALID' if not nonvalid else nonvalid}")
PY

run_workload() {
  # Shared workload invocation: session/CSRF via environment only.
  python3 "$HERE/workload.py" --base "$GO_BASE" --cacert "$CA_FILE" "$@"
}

run_scenario() {
  local name="$1" gens="$2" sse="$3"
  local result="$RUN_DIR/$name.json" summary="$RUN_DIR/$name.summary.json"
  local provider_before provider_after cpu_before cpu_after worker_active worker_peak
  local started ended analysis
  echo "== scenario $name: $gens generation + $((gens * sse)) SSE =="
  provider_before=$(provider_stats)
  cpu_before=$(metric_value process_cpu_seconds_total)
  started=$(python3 -c 'import time; print(time.time())')
  if ! run_workload --scenario "$name" \
      --gens "$gens" --sse-per-gen "$sse" --key-prefix "$TRIAL_ID-$name" \
      > "$result"; then
    [ -s "$result" ] && cat "$result" >&2
    die "$name workload failed"
  fi
  ended=$(python3 -c 'import time; print(time.time())')
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  provider_after=$(provider_stats)
  analysis=$(analyze_window "$started" "$ended")
  echo "$analysis" > "$RUN_DIR/$name.analysis.json"
  if ! python3 - "$result" "$gens" "$sse" "$CONCURRENCY" \
      "$provider_before" "$provider_after" "$cpu_before" "$cpu_after" \
      "$worker_active" "$worker_peak" "$analysis" \
      > "$summary" <<'PY'
import json, sys

(path, gens, sse, concurrency, provider_before, provider_after, cpu_before,
 cpu_after, worker_active, worker_peak, analysis_s) = sys.argv[1:]
gens, sse, concurrency = int(gens), int(sse), int(concurrency)
analysis = json.loads(analysis_s)
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
# A-side frames must cover the scenario window (RSS peak from the same
# companiond process the traffic hit). A B-side CPU window is only a valid
# measurement when the engine-counter analysis says VALID; PARTIAL keeps a
# qualified delta (surfaced, never treated as unconditional), INVALID fails.
a = analysis["a"]
if not a["frames_with_pid1"]:
    errors.append("no A frames with runtime PID 1 in the scenario window")
peak = analysis["b"]["same_frame_peak"]
if peak is None or peak["complete_frames"] < 1:
    errors.append("no complete same-frame B sum in the scenario window")
for comp, cpu in analysis["b"]["components"].items():
    if cpu["status"] == "INVALID":
        errors.append(f"{comp} CPU window invalid ({cpu.get('reason')}); "
                      "not a valid measurement")
summary = {
    "scenario": r["scenario"],
    "generations": gens,
    "sse": expected_sse,
    "intake_ms": s["intake_ms"],
    "terminal_ms": s["terminal_ms"],
    "stream_ms": s["stream_ms"],
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "peak_rss_mib": round(a["a_rss_peak_kb"] / 1024, 3) if a["a_rss_peak_kb"] else None,
    "peak_pss_mib": round(a["a_pss_peak_kb"] / 1024, 3) if a["a_pss_peak_kb"] else None,
    "b_peak_rss_mib": round(peak["b_rss_peak_kb"] / 1024, 3) if peak else None,
    "b_peak_pss_mib": round(peak["b_pss_peak_kb"] / 1024, 3) if peak else None,
    "b_complete_frames": peak["complete_frames"] if peak else 0,
    "b_component_status_frames": analysis["component_status_frames"],
    "b_cpu_status": {c: {"status": cpu["status"], "reason": cpu.get("reason"),
                         "stats_missing_frames": cpu["stats_missing_frames"],
                         "epoch_changed": cpu["epoch_changed"]}
                     for c, cpu in analysis["b"]["components"].items()},
    "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                           for c, cpu in analysis["b"]["components"].items()},
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
print(f"  A CPU = {r['cpu_seconds']} s; A peak RSS/PSS = {r['peak_rss_mib']}/{r['peak_pss_mib']} MiB")
print(f"  B same-frame peak RSS/PSS = {r['b_peak_rss_mib']}/{r['b_peak_pss_mib']} MiB "
      f"({r['b_complete_frames']} complete frames)")
cpu = r["b_cpu_status"]
nonvalid = {c: s for c, s in cpu.items() if s["status"] != "VALID"}
print(f"  B CPU windows = {'all VALID' if not nonvalid else nonvalid}")
print(f"  provider/worker peak = {r['provider_peak']}/{r['worker_peak']}; errors = 0")
PY
}

run_scenario_s4() {
  # §19.1 场景 4: exactly 1 generation + 1 SSE, first-delta timing against
  # the fixture's known provider delay. Assertions stay wiring-level (counts,
  # peaks, frames, one live delta observed); no ms threshold is asserted —
  # §19.2 gates stay Owner-frozen. The adjusted values subtract the fake
  # provider's own holdMs+firstTokenMs window (measured from when THAT
  # process received the request, not observable from outside), so they still
  # contain backend intake/claim/provider-HTTP/SSE-subscribe time and are
  # never presented as pure service processing time.
  local name="s4" gens=1 sse=1
  local result="$RUN_DIR/$name.json" summary="$RUN_DIR/$name.summary.json"
  local provider_before provider_after cpu_before cpu_after worker_active worker_peak
  local started ended analysis
  echo "== scenario s4: 1 generation + 1 SSE, first-delta timing =="
  provider_before=$(provider_stats)
  cpu_before=$(metric_value process_cpu_seconds_total)
  started=$(python3 -c 'import time; print(time.time())')
  if ! run_workload --scenario "$name" --gens "$gens" --sse-per-gen "$sse" \
      --key-prefix "$TRIAL_ID-$name" > "$result"; then
    [ -s "$result" ] && cat "$result" >&2
    die "$name workload failed"
  fi
  ended=$(python3 -c 'import time; print(time.time())')
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  provider_after=$(provider_stats)
  analysis=$(analyze_window "$started" "$ended")
  echo "$analysis" > "$RUN_DIR/$name.analysis.json"
  if ! python3 - "$result" "$provider_before" "$provider_after" \
      "$cpu_before" "$cpu_after" "$worker_active" "$worker_peak" "$analysis" \
      > "$summary" <<'PY'
import json, sys

(path, provider_before, provider_after, cpu_before, cpu_after,
 worker_active, worker_peak, analysis_s) = sys.argv[1:]
analysis = json.loads(analysis_s)
r = json.load(open(path))
before, after = json.loads(provider_before), json.loads(provider_after)
s = r["stats"]
fd = s["first_delta"]
errors = []
if r.get("generations") != 1 or r.get("expected_sse") != 1:
    errors.append(f"accepted {r.get('generations')} gen / "
                  f"{r.get('expected_sse')} expected SSE want 1/1")
if s.get("sse_total") != 1 or s.get("sse_ok") != 1:
    errors.append(f"SSE {s.get('sse_ok')}/{s.get('sse_total')} want 1/1")
if s.get("error_count") != 0:
    errors.append(f"workload errors: {s.get('errors')}")
provider_delta = after["streamRequests"] - before["streamRequests"]
if provider_delta != 1:
    errors.append(f"provider requests {provider_delta} want 1")
if after["activeStreamRequests"] != 0:
    errors.append(f"provider active after scenario {after['activeStreamRequests']}")
if int(float(worker_active)) != 0:
    errors.append(f"worker active after scenario {worker_active}")
if int(float(worker_peak)) < 1:
    errors.append(f"worker peak {worker_peak} want >= 1")
# One live delta must have been observed; a missing one is an explicit
# failure carrying its reason (never a fabricated zero).
if fd.get("observed") != 1:
    errors.append(f"first delta not observed: {fd.get('absent_reasons')}")
a = analysis["a"]
if not a["frames_with_pid1"]:
    errors.append("no A frames with runtime PID 1 in the scenario window")
peak = analysis["b"]["same_frame_peak"]
if peak is None or peak["complete_frames"] < 1:
    errors.append("no complete same-frame B sum in the scenario window")
for comp, cpu in analysis["b"]["components"].items():
    if cpu["status"] == "INVALID":
        errors.append(f"{comp} CPU window invalid ({cpu.get('reason')}); "
                      "not a valid measurement")

# Known provider delay (fixture-side): holdMs + firstTokenMs measured from
# when the fake provider received the completion request — not observable
# from outside, so the subtraction stays qualified, never "pure service".
config = after.get("config") or {}
hold = config.get("holdMs")
first_token = config.get("firstTokenMs")
chunks = config.get("chunks")
known_ms = (hold + first_token) if isinstance(hold, (int, float)) \
    and isinstance(first_token, (int, float)) else None
from_send = fd.get("from_send_ms", {}).get("p50")
from_accept = fd.get("from_accept_ms", {}).get("p50")
adjusted_send = from_send - known_ms \
    if known_ms is not None and from_send is not None else None
adjusted_accept = from_accept - known_ms \
    if known_ms is not None and from_accept is not None else None
live = fd.get("live_deltas_max")
cov = fd.get("coverage") or {}
# Catch-up-snapshot evidence is exact: 0 chars at subscribe means the
# subscriber predates every delta, so the received first delta IS the
# generation's first delta. A provider-chunk mismatch would only be
# reachable when a >16 KiB catch-up/replay burst mixes splits into the
# live count — surfaced, never clamped.
if live is not None and isinstance(chunks, (int, float)) and live > chunks:
    coverage = f"unexpected_delta_count:{live}vs{int(chunks)}"
elif cov.get("joined_before_first_delta", 0) >= 1:
    coverage = "complete_stream"
elif cov.get("joined_mid_stream", 0) >= 1:
    coverage = "joined_mid_stream"
else:
    coverage = "unknown"

summary = {
    "scenario": "s4",
    "generations": 1,
    "sse": 1,
    "intake_ms": s["intake_ms"],
    "terminal_ms": s["terminal_ms"],
    "stream_ms": s["stream_ms"],
    "first_delta": {
        **fd,
        "provider_known_delay_ms": {"holdMs": hold, "firstTokenMs": first_token,
                                    "sum": known_ms, "chunks": chunks},
        "adjusted_from_send_ms": adjusted_send,
        "adjusted_from_accept_ms": adjusted_accept,
        "coverage_evidence": cov,
        "coverage": coverage,
        "definition": (
            "first_delta_at = receipt time of the socket chunk carrying the "
            "first live chat.delta. Live rule: a chat.delta is live unless "
            "it arrives after the last chat.snapshot preceding the terminal "
            "event (the committed-text replay burst); every live "
            "subscription starts with a catch-up chat.snapshot, and deltas "
            "before the final snapshot are live tokens. Bases: from_send = "
            "POST /generations issue time; from_accept = 202 receipt time; "
            "from_subscribe = SSE attempt start. adjusted = from_* minus "
            "the fake provider's own holdMs+firstTokenMs window, which the "
            "provider measures from receiving ITS request — externally "
            "unobservable — so adjusted still contains backend "
            "intake/claim, provider HTTP round-trip and SSE subscribe "
            "offset; it is not pure service processing time. coverage: "
            "empty catch-up text = subscribed before the first delta, so "
            "the received first delta is the generation's first delta; "
            "non-empty = joined mid-stream, so from_send/from_accept are "
            "upper bounds. No threshold is asserted (Owner-frozen §19.2)."),
    },
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "peak_rss_mib": round(a["a_rss_peak_kb"] / 1024, 3) if a["a_rss_peak_kb"] else None,
    "peak_pss_mib": round(a["a_pss_peak_kb"] / 1024, 3) if a["a_pss_peak_kb"] else None,
    "b_peak_rss_mib": round(peak["b_rss_peak_kb"] / 1024, 3) if peak else None,
    "b_peak_pss_mib": round(peak["b_pss_peak_kb"] / 1024, 3) if peak else None,
    "b_complete_frames": peak["complete_frames"] if peak else 0,
    "b_component_status_frames": analysis["component_status_frames"],
    "b_cpu_status": {c: {"status": cpu["status"], "reason": cpu.get("reason"),
                         "stats_missing_frames": cpu["stats_missing_frames"],
                         "epoch_changed": cpu["epoch_changed"]}
                     for c, cpu in analysis["b"]["components"].items()},
    "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                           for c, cpu in analysis["b"]["components"].items()},
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
fd = r["first_delta"]
print(f"  intake p50 = {r['intake_ms']['p50']} ms; "
      f"terminal p50 = {r['terminal_ms']['p50']} ms; "
      f"stream p50 = {r['stream_ms']['p50']} ms")
print(f"  first delta from send/accept/subscribe = "
      f"{fd['from_send_ms']['p50']}/{fd['from_accept_ms']['p50']}/"
      f"{fd['from_subscribe_ms']['p50']} ms "
      f"(adjusted send/accept = {fd['adjusted_from_send_ms']}/"
      f"{fd['adjusted_from_accept_ms']} ms, provider known "
      f"{fd['provider_known_delay_ms']['sum']} ms, coverage {fd['coverage']})")
print(f"  A CPU = {r['cpu_seconds']} s; A peak RSS/PSS = "
      f"{r['peak_rss_mib']}/{r['peak_pss_mib']} MiB; "
      f"B same-frame peak RSS/PSS = {r['b_peak_rss_mib']}/"
      f"{r['b_peak_pss_mib']} MiB ({r['b_complete_frames']} frames)")
cpu = r["b_cpu_status"]
nonvalid = {c: s for c, s in cpu.items() if s["status"] != "VALID"}
print(f"  B CPU windows = {'all VALID' if not nonvalid else nonvalid}; errors = 0")
PY
}

if [ "$PROBE" = "1" ]; then
  echo "== probe functional chain: 1 generation + 1 SSE through caddy TLS =="
  PROBE_RESULT="$RUN_DIR/probe.workload.json"
  provider_before=$(provider_stats)
  cpu_before=$(metric_value process_cpu_seconds_total)
  worker_peak_before=$(metric_value vc_generation_peak)
  if ! run_workload --scenario s4 --gens 1 --sse-per-gen 1 \
      --key-prefix "$TRIAL_ID-probe" > "$PROBE_RESULT"; then
    [ -s "$PROBE_RESULT" ] && cat "$PROBE_RESULT" >&2
    die "probe workload failed"
  fi
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  provider_after=$(provider_stats)
  PROBE_STARTED_AT=$(python3 -c 'import time; print(time.time())')
  sleep 3   # bounded settle window so post-chain frames exist
  PROBE_ENDED_AT=$(python3 -c 'import time; print(time.time())')
  echo "== probe window analysis =="
  ANALYSIS=$(analyze_window "$IDLE_STARTED" "$PROBE_ENDED_AT")
  echo "$ANALYSIS" > "$RUN_DIR/probe.analysis.json"
  if ! python3 - "$PROBE_RESULT" "$provider_before" "$provider_after" \
      "$cpu_before" "$cpu_after" "$worker_active" "$worker_peak" \
      "$worker_peak_before" "$ANALYSIS" "$FRAMES" \
      > "$RUN_DIR/probe.summary.json" <<'PY'
import json, sys

(workload_path, provider_before, provider_after, cpu_before, cpu_after,
 worker_active, worker_peak, worker_peak_before, analysis_s, frames_path) = sys.argv[1:]
analysis = json.loads(analysis_s)
r = json.load(open(workload_path))
before, after = json.loads(provider_before), json.loads(provider_after)
frames = [json.loads(line) for line in open(frames_path) if line.strip()]
s = r["stats"]
errors = []
checks = []
if r.get("generations") != 1 or s.get("sse_ok") != 1 or s.get("error_count") != 0:
    errors.append(f"functional chain: {r.get('generations')} gen, "
                  f"{s.get('sse_ok')}/1 SSE, errors {s.get('errors')}")
# First-delta timing wiring (FUNCTIONAL_ONLY: the incremental parser and
# its baselines produced a live measurement; no number here is a perf
# conclusion or any §19.2 gate).
fd = s.get("first_delta") or {}
if fd.get("observed") != 1:
    errors.append(f"first-delta wiring: observed {fd.get('observed')} want 1 "
                  f"({fd.get('absent_reasons')})")
fd_send = (fd.get("from_send_ms") or {}).get("p50")
fd_accept = (fd.get("from_accept_ms") or {}).get("p50")
fd_sub = (fd.get("from_subscribe_ms") or {}).get("p50")
provider_delta = after["streamRequests"] - before["streamRequests"]
checks.append(f"provider delta {provider_delta}")
if provider_delta != 1:
    errors.append(f"provider requests {provider_delta} want 1")
if after["activeStreamRequests"] != 0:
    errors.append(f"provider active after chain {after['activeStreamRequests']}")
if int(float(worker_peak)) < 1:
    errors.append(f"worker peak {worker_peak} want >= 1")
if int(float(worker_active)) != 0:
    errors.append(f"worker active after chain {worker_active}")
checks.append(f"A CPU during probe {round(float(cpu_after) - float(cpu_before), 6)} s")

# Frame completeness: schema, measured components, A attribution, reader
# self-exclusion, honest PARTIAL handling, CPU counter lifecycle.
structural_ok = 0
runtime_pid1_uid100 = 0
reader_self_leak = 0
partial_db_frames = 0
for f in frames:
    if not all(k in f for k in ("ts", "platform", "source", "integrity",
                                "components", "cpu", "a")):
        continue
    if set(f["components"]) == {"db", "runtime", "minio", "caddy"}:
        structural_ok += 1
    rt = f["components"].get("runtime", {})
    pid1 = next((p for p in rt.get("pids", []) if p.get("pid") == 1), None)
    if pid1 and pid1.get("uid") == 100 and pid1.get("comm") == "companiond":
        runtime_pid1_uid100 += 1
    for comp, c in f["components"].items():
        if c.get("reader_self_pid") is not None and any(
                p.get("pid") == c["reader_self_pid"] for p in c.get("pids", [])):
            reader_self_leak += 1
    if f["components"].get("db", {}).get("status") == "PARTIAL":
        partial_db_frames += 1
        if not f["components"]["db"].get("missing"):
            errors.append("db PARTIAL frame without missing-process list")
if structural_ok < 5:
    errors.append(f"only {structural_ok} structurally complete frames")
if runtime_pid1_uid100 < 5:
    errors.append(f"A attribution: only {runtime_pid1_uid100} frames carry "
                  "runtime PID 1 (uid 100, companiond)")
if reader_self_leak:
    errors.append(f"reader self PID appeared in target pid lists {reader_self_leak} times")
for comp, cpu in analysis["b"]["components"].items():
    if cpu["status"] == "INVALID":
        errors.append(f"{comp} CPU window invalid during probe "
                      f"({cpu.get('reason')}); deltas not usable")
peak = analysis["b"]["same_frame_peak"]
if peak is None or peak["complete_frames"] < 1:
    errors.append("no complete same-frame B sum during probe")
if analysis["a"].get("frames_with_pid1", 0) < 5:
    errors.append("A-side frames missing PID 1")

summary = {
    "mode": "FUNCTIONAL_ONLY",
    "performance_conclusions": "NONE",
    "note": "functional wiring proof only: stack boot, TLS readiness, collector "
            "fields/attribution/exclusion/aggregation, one 1-gen+1-SSE chain, "
            "fake-provider counting; not a capacity/perf trial and not any §19.2 gate",
    "oneshots": "migrate/bootstrap/minio-init exited 0",
    "functional_chain": {
        "generations": r.get("generations"), "sse_ok": s.get("sse_ok"),
        "provider_delta": provider_delta, "worker_peak": int(float(worker_peak)),
        "first_delta": {
            "from_send_ms": fd_send, "from_accept_ms": fd_accept,
            "from_subscribe_ms": fd_sub,
            "live_deltas_max": fd.get("live_deltas_max"),
            "coverage": fd.get("coverage"),
            "note": "timing wiring proof only, not a performance number",
        },
        "checks": checks,
    },
    "frames": {
        "total": len(frames), "structural_ok": structural_ok,
        "runtime_pid1_uid100": runtime_pid1_uid100,
        "db_partial_frames": partial_db_frames,
        "component_status_frames": analysis["component_status_frames"],
        "b_same_frame": peak,
        "b_cpu_status": {c: {"status": cpu["status"],
                             "reason": cpu.get("reason"),
                             "stats_missing_frames": cpu["stats_missing_frames"],
                             "epoch_changed": cpu["epoch_changed"]}
                         for c, cpu in analysis["b"]["components"].items()},
        "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                               for c, cpu in analysis["b"]["components"].items()},
        "a": analysis["a"],
    },
    "errors": errors,
}
print(json.dumps(summary, ensure_ascii=False))
if errors:
    for e in errors:
        print(f"G12 probe assertion failed: {e}", file=sys.stderr)
    raise SystemExit(1)
PY
  then
    die "probe assertions failed"
  fi
  echo "== G12 probe PASS (FUNCTIONAL_ONLY; artifacts in $RUN_DIR) =="
  cat "$RUN_DIR/probe.summary.json"
  exit 0
fi

run_scenario_s4
run_scenario s5 "$GENS_S5" "$SSE_S5"
run_scenario s10 "$GENS_S10" "$SSE_S10"

echo "== 100-turn soak and post-idle recovery =="
PRE_SOAK_IDLE_STARTED=$(python3 -c 'import time; print(time.time())')
sleep "$WARM_IDLE_SECONDS"
PRE_SOAK_WINDOW=$(analyze_window "$PRE_SOAK_IDLE_STARTED" \
  "$(python3 -c 'import time; print(time.time())')")
SOAK_PROVIDER_BEFORE=$(provider_stats)
SOAK_CPU_BEFORE=$(metric_value process_cpu_seconds_total)
python3 "$HERE/collector.py" scrape --manifest "$MANIFEST" --image "$MINIO_IMAGE" \
  > "$RUN_DIR/metrics.pre-soak.json"
SOAK_DONE=0
SOAK_INDEX=0
while [ "$SOAK_DONE" -lt "$SOAK_TURNS" ]; do
  SOAK_INDEX=$((SOAK_INDEX + 1))
  CURRENT_BATCH="$SOAK_BATCH"
  if [ $((SOAK_DONE + CURRENT_BATCH)) -gt "$SOAK_TURNS" ]; then
    CURRENT_BATCH=$((SOAK_TURNS - SOAK_DONE))
  fi
  SOAK_FILE=$(printf '%s/soak-%03d.json' "$RUN_DIR" "$SOAK_INDEX")
  if ! run_workload --scenario s10 \
      --gens "$CURRENT_BATCH" --sse-per-gen 1 \
      --key-prefix "$TRIAL_ID-soak-$SOAK_INDEX" > "$SOAK_FILE"; then
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
POST_IDLE_ENDED=$(python3 -c 'import time; print(time.time())')
python3 "$HERE/collector.py" scrape --manifest "$MANIFEST" --image "$MINIO_IMAGE" \
  > "$RUN_DIR/metrics.post-idle.json"
POST_SOAK_WINDOW=$(analyze_window "$POST_IDLE_STARTED" "$POST_IDLE_ENDED")
if ! python3 - "$RUN_DIR/metrics.pre-soak.json" "$RUN_DIR/metrics.post-idle.json" \
      "$SOAK_PROVIDER_BEFORE" "$SOAK_PROVIDER_AFTER" "$SOAK_TURNS" \
      "$SOAK_CPU_BEFORE" "$SOAK_CPU_AFTER" \
      "$PRE_SOAK_WINDOW" "$POST_SOAK_WINDOW" \
      > "$RUN_DIR/soak.summary.json" <<'PY'
import json, sys

(before_path, after_path, provider_before, provider_after, turns, cpu_before,
 cpu_after, pre_window_s, post_window_s) = sys.argv[1:]
turns = int(turns)
def num(v):
    return float(v) if v is not None else None
before = {k: num(v) for k, v in json.load(open(before_path))["metrics"].items()}
after = {k: num(v) for k, v in json.load(open(after_path))["metrics"].items()}
pre_w = json.loads(pre_window_s)
post_w = json.loads(post_window_s)
pb, pa = json.loads(provider_before), json.loads(provider_after)
errors = []
provider_delta = pa["streamRequests"] - pb["streamRequests"]
if provider_delta != turns:
    errors.append(f"provider requests {provider_delta} want {turns}")
for name in ("vc_generation_active", "vc_realtime_subscribers", "vc_db_pool_acquired"):
    if after.get(name) != 0:
        errors.append(f"{name} after idle = {after.get(name)}")
for comp, cpu in post_w["b"]["components"].items():
    if cpu["status"] == "INVALID":
        errors.append(f"{comp} recovery CPU window invalid "
                      f"({cpu.get('reason')})")

def idle_summary(w):
    a, peak = w["a"], (w["b"]["same_frame_peak"] or {})
    return {
        "a_rss_mean_kb": a["a_rss_mean_kb"], "a_pss_mean_kb": a["a_pss_mean_kb"],
        "b_rss_mean_kb": peak.get("b_rss_mean_kb"), "b_pss_mean_kb": peak.get("b_pss_mean_kb"),
        "b_complete_frames": peak.get("complete_frames", 0),
    }

summary = {
    "turns": turns,
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    # Recovery-window CPU (§19.1): from cpu_after, scraped right after the
    # last soak batch, to the post-idle scrape.
    "recovery_cpu_seconds": round(float(after["process_cpu_seconds_total"]) - float(cpu_after), 6),
    "warm_idle_rss_before_after_mib": [
        round(pre_w["a"]["a_rss_mean_kb"] / 1024, 3) if pre_w["a"]["a_rss_mean_kb"] else None,
        round(post_w["a"]["a_rss_mean_kb"] / 1024, 3) if post_w["a"]["a_rss_mean_kb"] else None],
    "b_idle_rss_before_after_mib": [
        round(pre_w["b"]["same_frame_peak"]["b_rss_mean_kb"] / 1024, 3)
        if pre_w["b"]["same_frame_peak"] else None,
        round(post_w["b"]["same_frame_peak"]["b_rss_mean_kb"] / 1024, 3)
        if post_w["b"]["same_frame_peak"] else None],
    "goroutines_before_after": [before.get("go_goroutines"), after.get("go_goroutines")],
    "fds_before_after": [pre_w["a"]["a_fds_first_last"][0] if pre_w["a"]["a_fds_first_last"] else None,
                         post_w["a"]["a_fds_first_last"][-1] if post_w["a"]["a_fds_first_last"] else None],
    "db_acquired_before_after": [before.get("vc_db_pool_acquired"), after.get("vc_db_pool_acquired")],
    "b_cpu_status": {c: {"status": cpu["status"], "reason": cpu.get("reason"),
                         "stats_missing_frames": cpu["stats_missing_frames"],
                         "epoch_changed": cpu["epoch_changed"]}
                     for c, cpu in post_w["b"]["components"].items()},
    "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                           for c, cpu in post_w["b"]["components"].items()},
    "idle_windows": {"pre": idle_summary(pre_w), "post": idle_summary(post_w)},
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

IMAGE_BYTES=$(python3 - "$RUNTIME_IMAGE" "$MINIO_IMAGE" "$CADDY_IMAGE" <<'PY'
import json, subprocess, sys
out = {}
for ref in sys.argv[1:]:
    info = json.loads(subprocess.run(["docker", "image", "inspect", ref],
                                     capture_output=True, text=True,
                                     check=True).stdout)[0]
    out[ref.split(":")[0].removeprefix("virtual-companion-")] = info["Size"]
print(json.dumps(out))
PY
)
python3 - "$TRIAL_ID" "$MODE" "$PROJECT" "$COLD_START_MS" "$IDLE_CPU_SECONDS" \
  "$IDLE_ANALYSIS" "$IMAGE_BYTES" "$RUN_DIR/s4.summary.json" \
  "$RUN_DIR/s5.summary.json" \
  "$RUN_DIR/s10.summary.json" "$RUN_DIR/soak.summary.json" \
  > "$RUN_DIR/trial.summary.json" <<'PY'
import json, sys
(trial_id, mode, project, cold_ms, idle_cpu, idle_analysis_s, image_bytes_s,
 s4_path, s5_path, s10_path, soak_path) = sys.argv[1:12]
idle = json.loads(idle_analysis_s)
summary = {
    "trial_id": trial_id, "mode": mode,
    "stack": {"project": project, "derived_from": "ops/deploy",
              "components": ["db", "runtime", "minio", "caddy"],
              "images_bytes": json.loads(image_bytes_s)},
    "cold_start_ms": float(cold_ms),
    "idle_cpu_seconds": float(idle_cpu),
    "idle_a": idle["a"],
    "idle_b_same_frame": idle["b"]["same_frame_peak"],
    "s4": json.load(open(s4_path)),
    "s5": json.load(open(s5_path)),
    "s10": json.load(open(s10_path)),
    "soak": json.load(open(soak_path)),
}
print(json.dumps(summary, ensure_ascii=False))
PY

kill -TERM "$SAMPLER_PID" 2>/dev/null || true
touch "$STOP_FILE"
wait "$SAMPLER_PID" 2>/dev/null || true
SAMPLER_PID=""
echo "== G12 trial PASS (artifacts in $RUN_DIR) =="
cat "$RUN_DIR/trial.summary.json"
