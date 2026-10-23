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
# --probe-s3 (VC-R61) is the same FUNCTIONAL_ONLY bound for scenario 3 only:
# one generation whose fake-provider completion is held by a bounded holdMs
# (PUT /g12/config, with the original value registered as pending before the
# first PUT and restored after the scenario — plus one bounded EXIT-path
# attempt in cleanup for anything still pending, e.g. a first PUT whose
# response was lost after the server applied it) plus
# 3 established silent SSE subscribers. The product binds SSE to a
# generation, so "idle SSE" is only reachable as subscriptions on one
# in-flight generation — never as zero-generation idle, and no product API
# is changed to fabricate one. The quiet window is proven from real state
# per DEDUPLICATED observer record (the frame sampler's Tailer reuses the
# latest observer record, so frame-ts growth is not a fresh sample): every
# sample must keep vc_realtime_subscribers=3, vc_generation_active=1,
# provider activeStreamRequests=1 and the provider's contentChunkWrites
# counter equal to its pre-send baseline, strictly increasing in observer
# time, and any missing/stale/non-qualifying record BREAKS the window —
# bad samples are never filtered away to stitch two ends together. One
# boundary-exact scrape is taken inside the window. It runs no S4 chain
# and no full profile.
#
# --probe-s6 (VC-R62) is the same FUNCTIONAL_ONLY bound for the two §19.1
# S6 sub-scenarios only (cancel / disconnect-reconnect; the slow-subscriber
# sub-scenario stays open for Caddy/TLS/companiond — the Go handler already
# has a real-TCP backpressure regression with controlled test buffers):
# (A) one generation where the subscriber closes the SSE connection right
# after a received live delta — the disconnect must neither cancel the
# generation nor re-POST it, the snapshot-only re-subscription still ends
# COMPLETED with further live deltas, a subscription after the terminal
# returns the persisted snapshot + terminal, exactly one assistant message
# is committed, and the provider saw exactly one stream request that
# completed normally; (B) an INDEPENDENT generation cancelled only after a
# live delta and a non-terminal snapshot status proved it active — cancel
# responds 200/CANCELLED, the SSE terminal is chat.cancelled, the snapshot
# status is CANCELLED, no assistant message is committed, and the fake
# provider's own stream for it was ABORTED mid-reply by the backend's
# disconnect (fixture counters: exactly one abort and one completion across
# the two generations; a natural finish is counted separately and can
# never pose as an abort). The provider deltaMs is widened for the probe
# window (registered as pending BEFORE the first PUT and restored on every
# exit path, exactly like the scenario-3 holdMs). No ms threshold is
# asserted; it runs no other chain and no full profile.
#
# --probe-s9 (VC-R128) is the same FUNCTIONAL_ONLY bound for §19.1 scenario 9
# only (real login + session-revocation concurrency on the real public auth
# chain): two freshly seeded synthetic accounts (committed e2e-pool BCrypt
# password, env-only, never argv/logs/results) walk the Root-audited
# sequence — full TOTP enrollment with a trusted device (A), trusted-device
# password login, cross-account DELETE owner isolation (404 with the target
# left valid), a barrier-synchronized password login racing an
# explicit-session DELETE (per-client cookie jars; overlap proven from the
# actual request windows, never thread starts), revoke-all (exactly 2
# revoked, no Set-Cookie), and the SAME trusted-device cookie landing back
# at 202/TOTP_REQUIRED. A final read-only probe with the harness's original
# fabricated session proves nothing downstream broke. It makes no
# generation/provider call, never touches provider config, and draws no
# performance conclusion in any mode.
#
# --probe-s8 (VC-R140) is the same FUNCTIONAL_ONLY bound for the §19.1 S8
# worker-crash recovery chain, ONE crash point only: the runtime container
# is killed (docker kill → exit 137) while one generation's unique attempt
# is CREATED and a real live chat.delta has just been received on the wire
# — never the claim-before-intent or SUCCEEDED-before-finalize crash
# points, and no full-profile scenario. A sequential two-phase client
# (workload.py s8-prepare / s8-verify) avoids any long-lived controller:
# prepare sends exactly one generation and returns right after the first
# live chat.delta; run.sh then re-verifies this run's nonce-receipted
# runtime/provider CIDs against the daemon, asserts the DB mid-stream
# state READ-ONLY (work item CLAIMED with an unexpired lease, exactly one
# attempt CREATED, no assistant commit) and the OLD-epoch provider
# counters (streamRequests +1, active 1, content chunks flowing, not
# completed) — any mismatch fails closed before the kill. After the kill
# the old-epoch provider (its own PID namespace) is bounded-polled via
# docker exec until the orphaned request is recorded (abort +1,
# completed +0, active 0), the SAME runtime CID is started again (new
# StartedAt/PID and a changed real network namespace, read as
# /proc/1/ns/net from inside the exact CID — SandboxKey is empty for
# netns-sharing containers) and the provider CID is restarted into the
# new runtime network namespace (its /proc/1/ns/net must change and then
# equal the restarted runtime's; nonce and running state are re-verified
# at every identity capture) with counters back to initial zero and the
# config read back at the original deltaMs — old/new epoch
# counters are recorded separately and never subtracted across epochs.
# run.sh then waits out the DEFAULT claim lease via a read-only DB poll
# (no timeout, lease or DB-clock tampering) and, BEFORE any health
# traffic, fixes the recovered DB state read-only (attempt ABANDONED_LATE,
# work item FAILED with PROVIDER_OUTCOME_UNKNOWN, no requeue, no new
# attempt) plus a further fixed new-epoch zero-request sample — forward
# evidence for the recovery window, never an inference back from the
# post-control count. verify then re-checks the public failure view
# (FAILED_FINAL with the external-failed fault bucket, the chat.failed
# post-terminal view, zero assistant messages for the crashed turn) and
# only then sends ONE independent health-control generation that must
# complete (chat.completed, its own snapshot COMPLETED) while the original
# STILL reads FAILED_FINAL; the new-epoch provider must show exactly the
# health request (1 stream, 1 completed, 0 aborted, 0 active). The
# provider deltaMs is widened before prepare (pending-registered
# before the first PUT, restored on every exit path like the S3/S6 knobs;
# the restarted provider re-reads its initial env, which the restore
# re-affirms). Collectors, sampler, idle windows and warm-up are skipped
# BEFORE any helper would be created (FUNCTIONAL_ONLY: no A/B frames, no
# cross-restart CPU/RSS analysis, no performance conclusion and no §19.2
# gate) and the summary scopes itself to the single covered crash point.
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
# Usage: bash scripts/measure/g12-go-capacity/run.sh [--probe | --probe-s3 | --probe-s6 | --probe-s9 | --probe-s8]
set -euo pipefail
export DOCKER_CONTEXT=orbstack

PROBE=0
PROBE_S3=0
PROBE_S6=0
PROBE_S9=0
PROBE_S8=0
case "${1:-}" in
  --probe) PROBE=1 ;;
  --probe-s3) PROBE=1; PROBE_S3=1 ;;
  --probe-s6) PROBE=1; PROBE_S6=1 ;;
  --probe-s9) PROBE=1; PROBE_S9=1 ;;
  --probe-s8) PROBE=1; PROBE_S8=1 ;;
  "") ;;
  *) echo "usage: run.sh [--probe | --probe-s3 | --probe-s6 | --probe-s9 | --probe-s8]" >&2; exit 2 ;;
esac

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
# §19.1 scenario 3 (VC-R61): bounded fake-provider hold for the waiting
# generation and the quiet-window recording budget. Both windows are
# explicitly bounded and coordinated with the SSE absolute deadline the
# workload passes (--sse-timeout = hold_s + 20).
S3_HOLD_MS="${G12_S3_HOLD_MS:-8000}"
S3_QUIET_MS="${G12_S3_QUIET_MS:-3000}"
# §19.1 scenario 6 (VC-R62): the provider deltaMs is widened for the S6
# window so the reconnect/cancel chain has a stream still in flight after
# the first live delta; the SSE deadline covers the whole widened stream
# (firstTokenMs + chunks*deltaMs) with the same +20 s headroom pattern.
S6_DELTA_MS="${G12_S6_DELTA_MS:-400}"
# §19.1 scenario 9 (VC-R128): one bounded wall-clock budget for the whole
# S9 functional chain — the workload derives a single monotonic deadline
# from it, caps every public call's timeout at the remaining budget, and
# never counts a result returned after expiry as a success.
S9_BUDGET_SECONDS="${G12_S9_BUDGET_SECONDS:-60}"
# §19.1 idle/recovery windows: the spec calls for 10 minutes. Probe shrinks
# these to a bounded functional window and never reports performance numbers.
IDLE_SECONDS="${G12_IDLE_SECONDS:-600}"
WARM_IDLE_SECONDS="${G12_WARM_IDLE_SECONDS:-10}"
POST_IDLE_SECONDS="${G12_POST_IDLE_SECONDS:-600}"
if [ "$PROBE" = "1" ]; then
  IDLE_SECONDS="${G12_PROBE_IDLE_SECONDS:-6}"
  POST_IDLE_SECONDS="${G12_PROBE_POST_IDLE_SECONDS:-6}"
  WARMUP=0
  S3_HOLD_MS="${G12_PROBE_S3_HOLD_MS:-6000}"
  S3_QUIET_MS="${G12_PROBE_S3_QUIET_MS:-2000}"
  S6_DELTA_MS="${G12_PROBE_S6_DELTA_MS:-400}"
  # §19.1 scenario 8 (VC-R140, probe-s8 only): the widened deltaMs keeps
  # the prepared stream in flight well past the serial pre-kill gates
  # (default 8 chunks × 3 s ≈ 21 s of CREATED window after the first live
  # delta); set via the existing bounded PUT /g12/config deltaMs knob — no
  # new fixture knob, no product timeout change. The verify recovery
  # budget waits out the DEFAULT claim lease (270 s) plus the recovery
  # tick — never a shortened lease, timeout or DB clock.
  S8_DELTA_MS="${G12_PROBE_S8_DELTA_MS:-3000}"
  S8_RECOVERY_TIMEOUT="${G12_PROBE_S8_RECOVERY_TIMEOUT:-360}"
fi
MODE=$( { [ "$PROBE_S3" = "1" ] && echo PROBE_S3; } \
       || { [ "$PROBE_S6" = "1" ] && echo PROBE_S6; } \
       || { [ "$PROBE_S9" = "1" ] && echo PROBE_S9; } \
       || { [ "$PROBE_S8" = "1" ] && echo PROBE_S8; } \
       || { [ "$PROBE" = "1" ] && echo PROBE || echo PROFILE; })

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
  # The scenario-3 workload is launched directly (no wrapping subshell), so
  # its recorded PID is the python process itself: TERM → bounded wait →
  # KILL → reap can never strand a python child behind a dead parent shell.
  if [ -n "${S3_WORKLOAD_PID:-}" ]; then
    kill -TERM "$S3_WORKLOAD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$S3_WORKLOAD_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$S3_WORKLOAD_PID" 2>/dev/null || true
    wait "$S3_WORKLOAD_PID" 2>/dev/null || true
  fi
  # The probe-s8 verify workload is also a directly launched python child
  # (recorded PID = the python process itself): same TERM → bounded wait →
  # KILL → reap guarantee on every exit path.
  if [ -n "${S8_VERIFY_PID:-}" ]; then
    kill -TERM "$S8_VERIFY_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$S8_VERIFY_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$S8_VERIFY_PID" 2>/dev/null || true
    wait "$S8_VERIFY_PID" 2>/dev/null || true
  fi
  # Scenario-3 provider config: when a holdMs PUT was applied — or MAY have
  # been applied, because a PUT whose response was lost or timed out cannot
  # be proven skipped by the server — and the normal path never restored the
  # original value, make exactly one bounded restore attempt here while the
  # stack is still up (also under G12_KEEP=1, where the stack survives this
  # run). Success clears the pending state, so a restore is never repeated;
  # failure keeps the exit nonzero and records the attempt — a modified
  # holdMs can never outlive the run silently.
  if [ -n "${S3_PENDING_RESTORE_HOLD:-}" ] && [ -f "$CREATING" ]; then
    if provider_config_put "{\"holdMs\":$S3_PENDING_RESTORE_HOLD}" \
        "$RUN_DIR/s3-hold.exit-restore.json"; then
      S3_PENDING_RESTORE_HOLD=""
      log "cleanup: restored fake-provider holdMs to the original value"
    else
      log "cleanup: fake-provider holdMs restore FAILED; the provider may retain the scenario hold (see $RUN_DIR/s3-hold.exit-restore.json.err)"
      rc=1
    fi
  elif [ -n "${S3_PENDING_RESTORE_HOLD:-}" ]; then
    log "cleanup: fake-provider holdMs restore not attempted (no creating marker)"
    rc=1
  fi
  # Scenario-6 provider config: same pending-restore contract for the
  # widened deltaMs (registered before the first PUT, one bounded EXIT-path
  # attempt for anything still pending — a lost PUT response may still have
  # been applied server-side).
  if [ -n "${S6_PENDING_RESTORE_DELTA:-}" ] && [ -f "$CREATING" ]; then
    if provider_config_put "{\"deltaMs\":$S6_PENDING_RESTORE_DELTA}" \
        "$RUN_DIR/s6-delta.exit-restore.json"; then
      S6_PENDING_RESTORE_DELTA=""
      log "cleanup: restored fake-provider deltaMs to the original value"
    else
      log "cleanup: fake-provider deltaMs restore FAILED; the provider may retain the scenario delta (see $RUN_DIR/s6-delta.exit-restore.json.err)"
      rc=1
    fi
  elif [ -n "${S6_PENDING_RESTORE_DELTA:-}" ]; then
    log "cleanup: fake-provider deltaMs restore not attempted (no creating marker)"
    rc=1
  fi
  # Probe-s8 provider config: same pending-restore contract for the widened
  # deltaMs (registered before the first PUT, one bounded EXIT-path attempt
  # for anything still pending — including under G12_KEEP=1; the restarted
  # provider re-reads its initial env, and the restore re-affirms the
  # original value either way).
  if [ -n "${S8_PENDING_RESTORE_DELTA:-}" ] && [ -f "$CREATING" ]; then
    if provider_config_put "{\"deltaMs\":$S8_PENDING_RESTORE_DELTA}" \
        "$RUN_DIR/s8-delta.exit-restore.json"; then
      S8_PENDING_RESTORE_DELTA=""
      log "cleanup: restored fake-provider deltaMs to the original value (s8)"
    else
      log "cleanup: fake-provider deltaMs restore FAILED (s8); the provider may retain the probe delta (see $RUN_DIR/s8-delta.exit-restore.json.err)"
      rc=1
    fi
  elif [ -n "${S8_PENDING_RESTORE_DELTA:-}" ]; then
    log "cleanup: fake-provider deltaMs restore not attempted (no creating marker)"
    rc=1
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

provider_config_put() {
  # PUT /g12/config by exec'ing node INSIDE the fake-provider service
  # container — the service is part of this trial's nonce-receipted compose
  # project and already shares the runtime network namespace, so no extra
  # helper container (no CID/receipt/EXIT-recovery gap) is created. The
  # request carries a bounded timeout and destroys its socket on expiry;
  # any failure exits nonzero and prints nothing to stdout.
  local body="$1" out="$2"
  "${COMPOSE[@]}" exec -T fake-provider node \
    -e 'const http=require("http");
const port=Number(process.argv[1]);
const body=process.argv[2];
const req=http.request({host:"127.0.0.1",port,path:"/g12/config",method:"PUT",timeout:5000,
  headers:{"content-type":"application/json","content-length":Buffer.byteLength(body)}},
  res=>{let d="";res.on("data",c=>d+=c);
    res.on("end",()=>{process.stdout.write(d);process.exit(res.statusCode===200?0:1);});});
req.on("timeout",()=>{req.destroy(new Error("g12 config PUT timeout"));});
req.on("error",e=>{process.stderr.write(e.message+"\n");process.exit(1);});
req.end(body);' \
    "$FAKE_PORT" "$body" > "$out" 2> "$out.err"
}

provider_stats_exec() {
  # GET /g12/stats by exec'ing node INSIDE the fake-provider container
  # (localhost, same bounded request shape as provider_config_put). Unlike
  # the collector's transient netns scrape this keeps working across the
  # probe-s8 runtime kill/restart — the provider keeps its own PID
  # namespace — and creates no helper container. Old-epoch and new-epoch
  # callers each write their own file; counters are never mixed.
  local out="$1"
  "${COMPOSE[@]}" exec -T fake-provider node \
    -e 'const http=require("http");
const req=http.request({host:"127.0.0.1",port:Number(process.argv[1]),path:"/g12/stats",method:"GET",timeout:5000,
  headers:{}},res=>{let d="";res.on("data",c=>d+=c);
    res.on("end",()=>{process.stdout.write(d);process.exit(res.statusCode===200?0:1);});});
req.on("timeout",()=>{req.destroy(new Error("g12 stats GET timeout"));});
req.on("error",e=>{process.stderr.write(e.message+"\n");process.exit(1);});
req.end();' \
    "$FAKE_PORT" > "$out" 2> "$out.err"
}

analyze_window() {
  python3 "$HERE/collector.py" analyze --frames "$FRAMES" \
    --started "$1" --ended "$2"
}

psql_q() { "${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -tAc "$1"; }

run_workload() {
  # Shared workload invocation: session/CSRF via environment only. Defined
  # with the other helpers so the pre-collector probe-s8 branch can use it.
  python3 "$HERE/workload.py" --base "$GO_BASE" --cacert "$CA_FILE" "$@"
}

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

# §19.1 S9 (VC-R128): two dedicated login-only synthetic accounts with a
# REAL BCrypt password — the same committed synthetic pool credential as
# scripts/dev/e2e-stack.sh / frontend/e2e/helpers.ts (fixed cost-10 hash;
# never a real secret). Seeded only when S9 will actually run. The
# per-trial database is always fresh, so the accounts carry no prior
# TOTP/trusted-device/session or login-rate-limit state. The password
# travels to workload.py by environment only, never argv or logs, and
# never appears in any result file.
if [ "$PROBE_S9" = "1" ] || [ "$PROBE" = "0" ]; then
  echo "== seed: S9 real-login accounts (synthetic pool password) =="
  "${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -q \
      -v s9_hash='$2a$10$dduHEOO64z/pmmkp1ZMXieLcGnxQ109z2GTeit189y5vvBMGfcmpe' <<'SQL'
INSERT INTO vc.vc_user(id, display_name)
VALUES (2000002, 'G12 S9 user A'), (2000003, 'G12 S9 user B')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (2000002, 'g12-s9-a', :'s9_hash', 'USER', 'ACTIVE', 'G12 S9 user A'),
       (2000003, 'g12-s9-b', :'s9_hash', 'USER', 'ACTIVE', 'G12 S9 user B')
ON CONFLICT (id) DO NOTHING;
SQL
  export G12_S9_LOGIN_A="g12-s9-a" G12_S9_LOGIN_B="g12-s9-b" \
         G12_S9_PASSWORD_A='E2e-User-Pass-1234!' \
         G12_S9_PASSWORD_B='E2e-User-Pass-1234!'
  echo "  s9 accounts seeded"
fi

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

# ---------------------------------------------------------------------------
# §19.1 scenario 8 (VC-R140): FUNCTIONAL_ONLY probe for ONE crash point —
# the worker killed mid-stream while its unique attempt is still CREATED.
# Defined and dispatched here, BEFORE the collector launch: collectors,
# sampler, idle windows and warm-up are never started in this mode (their
# launch is skipped, not torn down), so the evidence is the public chain,
# the fake provider's own counters (old and new epoch kept separate) and
# READ-ONLY DB assertions.
# ---------------------------------------------------------------------------
s8_capture_identity() {
  # Identity line: Id StartedAt Pid Running realnetns. SandboxKey is EMPTY
  # for containers that share another container's network namespace
  # (network_mode=container:<cid> — the fake provider always), so the
  # namespace FACT is read from the container's own /proc/1/ns/net via
  # exec on the exact CID (readlink exists in both the Alpine runtime and
  # the Debian provider image). No helper container is created; nonce and
  # running state are re-verified by the callers.
  local cid="$1" line ns
  line="$(docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.State.Pid}} {{.State.Running}}' "$cid")" || return 1
  ns="$(docker exec "$cid" readlink /proc/1/ns/net)" || return 1
  printf '%s %s\n' "$line" "$ns"
}

s8_assert_db() {
  # Read-only DB assertion helper: the probe never issues a DB write.
  [ "$2" = "$1" ] || die "s8 db assertion failed: $3 (got '$2' want '$1')"
}

run_probe_s8() {
  local name="probe-s8"
  local runtime_cid provider_cid
  # CIDs come from THIS run's creation receipt (never from names or the
  # compose project label), then re-verified against the daemon together
  # with the nonce label before anything is killed.
  runtime_cid="$(python3 - "$CAPTURE" <<'PY'
import json, sys
cap = json.load(open(sys.argv[1]))
by_service = {c["service"]: c["cid"] for c in cap["containers"]}
print(by_service["runtime"])
PY
)"
  provider_cid="$(python3 - "$CAPTURE" <<'PY'
import json, sys
cap = json.load(open(sys.argv[1]))
by_service = {c["service"]: c["cid"] for c in cap["containers"]}
print(by_service["fake-provider"])
PY
)"
  [ -n "$runtime_cid" ] || die "s8: runtime CID missing from the creation receipt"
  [ -n "$provider_cid" ] || die "s8: fake-provider CID missing from the creation receipt"
  local cid
  for cid in "$runtime_cid" "$provider_cid"; do
    [ "$(docker inspect -f '{{index .Config.Labels "vc.g12.nonce"}}' "$cid" 2>/dev/null)" = "$NONCE" ] \
      || die "s8: container $cid is not this run's nonce-receipted creation; refusing to kill"
  done

  echo "== probe-s8: old-epoch provider baseline (deltaMs widen, pending-registered) =="
  local baseline_file="$RUN_DIR/$name.provider-oldepoch-baseline.json"
  provider_stats_exec "$baseline_file" \
    || die "s8: provider stats (old epoch) unreachable"
  local baseline_line baseline_delta chunks_cfg baseline_streams \
        baseline_aborted baseline_completed baseline_chunks baseline_active
  baseline_line="$(python3 - "$baseline_file" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
cfg = p.get("config") or {}
print(cfg.get("deltaMs", "NA"), cfg.get("chunks", "NA"),
      p.get("streamRequests", "NA"), p.get("abortedStreamRequests", "NA"),
      p.get("completedStreamRequests", "NA"),
      p.get("contentChunkWrites", "NA"),
      p.get("activeStreamRequests", "NA"))
PY
)"
  read -r baseline_delta chunks_cfg baseline_streams baseline_aborted \
        baseline_completed baseline_chunks baseline_active <<< "$baseline_line"
  local v
  for v in "$baseline_delta" "$chunks_cfg" "$baseline_streams" \
           "$baseline_aborted" "$baseline_completed" "$baseline_chunks" \
           "$baseline_active"; do
    case "$v" in '' | *[!0-9]*) die "s8: provider baseline unparseable ($v)" ;; esac
  done
  [ "$baseline_active" = "0" ] \
    || die "s8: provider already has $baseline_active active stream(s) at baseline"
  # Pending-restore registration BEFORE the first PUT (a PUT whose response
  # was lost may still have been applied server-side — same contract as the
  # S3/S6 knobs; cleanup's EXIT path retries once for anything left).
  S8_PENDING_RESTORE_DELTA=$baseline_delta
  if ! provider_config_put "{\"deltaMs\":$S8_DELTA_MS}" \
      "$RUN_DIR/$name.config-set.json"; then
    if provider_config_put "{\"deltaMs\":$S8_PENDING_RESTORE_DELTA}" \
        "$RUN_DIR/$name.config-restore.json"; then
      S8_PENDING_RESTORE_DELTA=""
      die "s8: provider deltaMs PUT failed (original deltaMs restored)"
    fi
    die "s8: provider deltaMs PUT failed AND restore failed (deltaMs possibly left at $S8_DELTA_MS)"
  fi

  echo "== probe-s8: identities captured; prepare — one generation, first live delta =="
  s8_capture_identity "$runtime_cid" > "$RUN_DIR/s8-runtime-before.txt" \
    || die "s8: runtime identity inspect failed"
  s8_capture_identity "$provider_cid" > "$RUN_DIR/s8-provider-before.txt" \
    || die "s8: provider identity inspect failed"
  if ! run_workload --scenario s8-prepare --key-prefix "$TRIAL_ID-$name" \
      > "$RUN_DIR/$name.prepare.json"; then
    [ -s "$RUN_DIR/$name.prepare.json" ] && cat "$RUN_DIR/$name.prepare.json" >&2
    die "s8 prepare failed (no live delta — the kill gate stays closed)"
  fi
  local gid conv
  read -r gid conv <<< "$(python3 - "$RUN_DIR/$name.prepare.json" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
print(r.get("generation_id") or "", r.get("conversation_id") or "")
PY
)"
  case "$gid" in '' | *[!0-9]*) die "s8: prepare produced no usable generation id ($gid)" ;; esac
  case "$conv" in '' | *[!0-9]*) die "s8: prepare produced no usable conversation id ($conv)" ;; esac

  echo "== probe-s8: pre-kill assertions (DB read-only + old-epoch provider) =="
  local owner="$G12_ACCOUNT_ID"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.generation WHERE id=$gid AND owner_user_id=$owner")" \
    "generation belongs to the seeded owner"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.work_item wi JOIN vc.generation g ON g.owner_user_id=wi.owner_user_id AND wi.kind='GENERATION' AND wi.ref_id=g.id WHERE g.id=$gid AND wi.status='CLAIMED' AND wi.lease_expires_at > clock_timestamp()")" \
    "work item CLAIMED with an unexpired lease"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.attempt_intent WHERE owner_user_id=$owner AND generation_id=$gid")" \
    "exactly one attempt intent"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.attempt_intent WHERE owner_user_id=$owner AND generation_id=$gid AND status='CREATED'")" \
    "attempt intent CREATED"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.generation WHERE id=$gid AND owner_user_id=$owner AND assistant_message_id IS NULL")" \
    "no assistant commit for the generation"
  local prekill="$RUN_DIR/$name.provider-prekill.json"
  provider_stats_exec "$prekill" || die "s8: provider stats unreachable pre-kill"
  python3 - "$prekill" "$baseline_streams" "$baseline_aborted" \
    "$baseline_completed" "$baseline_chunks" <<'PY' \
    || die "s8: provider state does not prove one live mid-stream request; refusing to kill"
import json, sys
p = json.load(open(sys.argv[1]))
bs, ba, bc, bch = (int(x) for x in sys.argv[2:6])
ok = (int(p["streamRequests"]) == bs + 1
      and int(p["activeStreamRequests"]) == 1
      and int(p["abortedStreamRequests"]) == ba
      and int(p["completedStreamRequests"]) == bc
      and int(p["contentChunkWrites"]) > bch)
raise SystemExit(0 if ok else 1)
PY
  # Final identity gate: the exact container captured above must still be
  # the running one — anything else fails closed and nothing is killed.
  local atkill
  atkill="$(s8_capture_identity "$runtime_cid")" \
    || die "s8: runtime identity re-inspect failed"
  [ "$atkill" = "$(cat "$RUN_DIR/s8-runtime-before.txt")" ] \
    || die "s8: runtime identity changed between capture and the kill gate; refusing"

  echo "== probe-s8: docker kill runtime ($runtime_cid) =="
  docker kill "$runtime_cid" > /dev/null || die "s8: docker kill failed"
  local killed
  killed="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}} {{.State.Pid}}' "$runtime_cid")" \
    || die "s8: post-kill inspect failed"
  printf '%s\n' "$killed" > "$RUN_DIR/s8-runtime-killed.txt"
  case "$killed" in
    "exited 137 0") : ;;
    *) die "s8: runtime post-kill state '$killed' (want 'exited 137 0')" ;;
  esac

  echo "== probe-s8: old-epoch abort evidence (bounded wait) =="
  local oldefinal="$RUN_DIR/$name.provider-oldepoch-final.json"
  local settled=0 n
  for n in $(seq 1 30); do
    if provider_stats_exec "$oldefinal" \
        && python3 - "$oldefinal" "$baseline_aborted" "$baseline_completed" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
ba, bc = int(sys.argv[2]), int(sys.argv[3])
ok = (int(p["abortedStreamRequests"]) == ba + 1
      and int(p["completedStreamRequests"]) == bc
      and int(p["activeStreamRequests"]) == 0)
raise SystemExit(0 if ok else 1)
PY
    then
      settled=1
      break
    fi
    sleep 0.5
  done
  [ "$settled" = "1" ] \
    || die "s8: old-epoch provider never recorded the orphaned abort within the bounded window"

  echo "== probe-s8: restart runtime (same CID, new epoch) =="
  docker start "$runtime_cid" > /dev/null || die "s8: runtime start failed"
  local restarted=0
  for n in $(seq 1 60); do
    if s8_capture_identity "$runtime_cid" > "$RUN_DIR/s8-runtime-restarted.txt" 2>/dev/null \
        && python3 - "$RUN_DIR/s8-runtime-before.txt" "$RUN_DIR/s8-runtime-restarted.txt" <<'PY'
import sys
old = open(sys.argv[1]).read().split()
new = open(sys.argv[2]).read().split()
ok = (len(old) == 5 and len(new) == 5 and new[0] == old[0]  # same CID
      and new[3] == "true"                                  # running
      and new[1] != old[1] and new[2] != old[2]
      and new[4] != old[4])              # new StartedAt/PID/netns
raise SystemExit(0 if ok else 1)
PY
    then
      restarted=1
      break
    fi
    sleep 1
  done
  [ "$restarted" = "1" ] \
    || die "s8: runtime did not come back as the same CID with a new StartedAt/PID/netns"
  local tls_back=0
  for n in $(seq 1 120); do
    if curl -fsS --cacert "$CA_FILE" --max-time 2 \
        "$GO_BASE/actuator/health/readiness" 2>/dev/null | grep -q '"UP"'; then
      tls_back=1
      break
    fi
    sleep 0.5
  done
  [ "$tls_back" = "1" ] \
    || die "s8: caddy TLS readiness did not come back after the runtime restart"

  echo "== probe-s8: restart fake-provider into the new runtime netns =="
  docker restart "$provider_cid" > /dev/null || die "s8: provider restart failed"
  local rejoined=0
  for n in $(seq 1 30); do
    if s8_capture_identity "$provider_cid" > "$RUN_DIR/s8-provider-restarted.txt" 2>/dev/null \
        && python3 - "$RUN_DIR/s8-runtime-restarted.txt" "$RUN_DIR/s8-provider-before.txt" "$RUN_DIR/s8-provider-restarted.txt" <<'PY'
import sys
rt = open(sys.argv[1]).read().split()
old = open(sys.argv[2]).read().split()
new = open(sys.argv[3]).read().split()
ok = (len(old) == 5 and len(new) == 5 and new[0] == old[0]  # same CID
      and new[3] == "true"                                  # running
      and new[1] != old[1] and new[2] != old[2]
      and new[4] != old[4]               # left the dead old netns
      and new[4] == rt[4])               # joined the runtime's NEW netns
raise SystemExit(0 if ok else 1)
PY
    then
      rejoined=1
      break
    fi
    sleep 0.5
  done
  [ "$rejoined" = "1" ] \
    || die "s8: provider did not rejoin the restarted runtime's network namespace"
  # Fixed zero-sample BEFORE any new traffic: the new epoch starts at
  # initial counters — the restart proof, and the pre-health-control fact
  # that the recovery window itself issues no provider request. The same
  # read-back confirms the restarted provider re-derived its config from
  # the initial env (deltaMs back at the original value) BEFORE the probe
  # continues; a mismatch dies here and leaves the pending restore for
  # cleanup's EXIT attempt.
  local newinit="$RUN_DIR/$name.provider-newepoch-initial.json"
  local initzero=0
  for n in $(seq 1 30); do
    if provider_stats_exec "$newinit" \
        && python3 - "$newinit" "$baseline_delta" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
ok = (int(p["streamRequests"]) == 0
      and int(p["activeStreamRequests"]) == 0
      and int(p["contentChunkWrites"]) == 0
      and int(p["abortedStreamRequests"]) == 0
      and int(p["completedStreamRequests"]) == 0
      and (p.get("config") or {}).get("deltaMs") == int(sys.argv[2]))
raise SystemExit(0 if ok else 1)
PY
    then
      initzero=1
      break
    fi
    sleep 0.5
  done
  [ "$initzero" = "1" ] \
    || die "s8: restarted provider counters/config not at the initial state (counters must be zero, config.deltaMs must equal the pre-probe value)"

  echo "== probe-s8: wait out the DEFAULT claim lease (read-only DB poll) =="
  # The recovery wait itself: only the default lease and the runtime's own
  # recovery tick, observed via read-only SELECTs — never a shortened
  # lease, a tampered clock, or a DB write.
  local recovered=0
  local dbdeadline=$(( $(date +%s) + S8_RECOVERY_TIMEOUT ))
  local dbstatus
  while [ "$(date +%s)" -lt "$dbdeadline" ]; do
    dbstatus="$(psql_q "SELECT status FROM vc.generation WHERE id=$gid AND owner_user_id=$owner")" \
      || die "s8: recovery DB poll query failed (read-only)"
    # A result returned past the budget is never adopted — even a late
    # FAILED_FINAL — and only the known non-terminal states may keep the
    # loop going: an empty or unknown status fails instead of posing as
    # success.
    [ "$(date +%s)" -lt "$dbdeadline" ] \
      || die "s8: recovery DB poll result arrived after the budget"
    case "$dbstatus" in
      FAILED_FINAL)
        recovered=1
        break
        ;;
      CREATED | QUEUED | IN_PROGRESS | INPUT_REVIEW | FINAL_REVIEW | COMMITTING)
        sleep 2
        ;;
      *)
        die "s8: recovery DB poll returned unexpected generation status '$dbstatus'"
        ;;
    esac
  done
  [ "$recovered" = "1" ] \
    || die "s8: generation did not reach FAILED_FINAL within the recovery budget (${S8_RECOVERY_TIMEOUT}s read-only DB poll)"

  echo "== probe-s8: recovered-state DB assertions (read-only, BEFORE any health traffic) =="
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.attempt_intent WHERE owner_user_id=$owner AND generation_id=$gid")" \
    "still exactly one attempt (no new attempt)"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.attempt_intent WHERE owner_user_id=$owner AND generation_id=$gid AND status='ABANDONED_LATE'")" \
    "attempt ABANDONED_LATE"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.generation WHERE id=$gid AND owner_user_id=$owner AND status='FAILED_FINAL' AND assistant_message_id IS NULL")" \
    "generation FAILED_FINAL with no assistant message"
  s8_assert_db 1 \
    "$(psql_q "SELECT COUNT(*) FROM vc.work_item wi JOIN vc.generation g ON g.owner_user_id=wi.owner_user_id AND wi.kind='GENERATION' AND wi.ref_id=g.id WHERE g.id=$gid AND wi.status='FAILED' AND wi.last_error_code='PROVIDER_OUTCOME_UNKNOWN'")" \
    "work item FAILED with PROVIDER_OUTCOME_UNKNOWN"
  s8_assert_db 0 \
    "$(psql_q "SELECT COUNT(*) FROM vc.work_item wi JOIN vc.generation g ON g.owner_user_id=wi.owner_user_id AND wi.kind='GENERATION' AND wi.ref_id=g.id WHERE g.id=$gid AND wi.status IN ('PENDING','CLAIMED')")" \
    "work item never requeued"

  echo "== probe-s8: fixed new-epoch zero-sample BEFORE the health control =="
  # Forward evidence, not an inference: the recovery window (crash -> this
  # point) issued no provider request, sampled after the DB state above is
  # fixed and before verify sends the one health-control generation.
  local newzero="$RUN_DIR/$name.provider-newepoch-before-health.json"
  local prezero=0
  for n in $(seq 1 30); do
    if provider_stats_exec "$newzero" \
        && python3 - "$newzero" <<'PY'
import json, sys
p = json.load(open(sys.argv[1]))
ok = (int(p["streamRequests"]) == 0
      and int(p["activeStreamRequests"]) == 0
      and int(p["contentChunkWrites"]) == 0
      and int(p["abortedStreamRequests"]) == 0
      and int(p["completedStreamRequests"]) == 0)
raise SystemExit(0 if ok else 1)
PY
    then
      prezero=1
      break
    fi
    sleep 0.5
  done
  [ "$prezero" = "1" ] \
    || die "s8: new-epoch provider did not stay at zero requests through the recovery window"

  echo "== probe-s8: verify — public recovered-failure view + health control =="
  local verify_rc=0
  local watchdog=$((S8_RECOVERY_TIMEOUT + 120))
  python3 "$HERE/workload.py" --base "$GO_BASE" --cacert "$CA_FILE" \
    --scenario s8-verify --key-prefix "$TRIAL_ID-$name" \
    --s8-generation-id "$gid" --s8-conversation-id "$conv" \
    --s8-recovery-timeout "$S8_RECOVERY_TIMEOUT" --sse-timeout 30 \
    > "$RUN_DIR/$name.verify.json" 2> "$RUN_DIR/$name.verify.err" &
  S8_VERIFY_PID=$!
  local wdeadline=$(( $(date +%s) + watchdog ))
  while kill -0 "$S8_VERIFY_PID" 2>/dev/null && [ "$(date +%s)" -lt "$wdeadline" ]; do
    sleep 1
  done
  if kill -0 "$S8_VERIFY_PID" 2>/dev/null; then
    kill -TERM "$S8_VERIFY_PID" 2>/dev/null || true
    for n in $(seq 1 20); do
      kill -0 "$S8_VERIFY_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$S8_VERIFY_PID" 2>/dev/null || true
    wait "$S8_VERIFY_PID" 2>/dev/null || true
    S8_VERIFY_PID=""
    die "s8 verify exceeded its bounded budget (${watchdog}s)"
  fi
  wait "$S8_VERIFY_PID" || verify_rc=$?
  S8_VERIFY_PID=""
  if [ "$verify_rc" -ne 0 ]; then
    [ -s "$RUN_DIR/$name.verify.json" ] && cat "$RUN_DIR/$name.verify.json" >&2
    die "s8 verify failed (rc=$verify_rc)"
  fi

  echo "== probe-s8: new-epoch provider accounting (exactly the health request) =="
  local newfinal="$RUN_DIR/$name.provider-newepoch-final.json"
  provider_stats_exec "$newfinal" \
    || die "s8: provider stats unreachable (new epoch)"
  python3 - "$newfinal" <<'PY' \
    || die "s8: new-epoch provider accounting wrong (want 1 stream / 1 completed / 0 aborted / 0 active)"
import json, sys
p = json.load(open(sys.argv[1]))
ok = (int(p["streamRequests"]) == 1
      and int(p["completedStreamRequests"]) == 1
      and int(p["abortedStreamRequests"]) == 0
      and int(p["activeStreamRequests"]) == 0)
raise SystemExit(0 if ok else 1)
PY

  if provider_config_put "{\"deltaMs\":$S8_PENDING_RESTORE_DELTA}" \
      "$RUN_DIR/$name.config-restore.json"; then
    S8_PENDING_RESTORE_DELTA=""
  else
    die "s8: provider deltaMs restore failed (one bounded EXIT retry follows)"
  fi

  python3 - "$RUN_DIR" "$name" "$gid" "$S8_DELTA_MS" "$baseline_delta" \
    "$S8_RECOVERY_TIMEOUT" > "$RUN_DIR/$name.summary.json" <<'PY'
import json, os, sys
run_dir, name, gid, delta_ms, baseline_delta, recovery_s = sys.argv[1:7]

def load(fn):
    try:
        return json.load(open(os.path.join(run_dir, fn)))
    except Exception:
        return None

def text(fn):
    try:
        return open(os.path.join(run_dir, fn)).read().strip()
    except Exception:
        return None

# Reaching this summary means every shell gate above passed (any mismatch
# died before this point); the summary assembles the recorded evidence.
prepare = load(f"{name}.prepare.json")
verify = load(f"{name}.verify.json")
summary = {
    "scenario": name,
    "mode": "FUNCTIONAL_ONLY",
    "performance_conclusions": "NONE",
    "scope": {
        "crash_point_covered": "runtime worker killed mid-stream while the "
                               "unique attempt is CREATED (docker kill, "
                               "exit 137)",
        "crash_points_not_covered": ["claim_before_intent",
                                     "SUCCEEDED_before_finalize"],
        "note": "single crash-point functional proof on the production-"
                "derived TLS stack; not the complete S8 matrix, not a "
                "capacity/perf conclusion and not any §19.2/G12 gate",
    },
    "method": {
        "phases": "sequential two-phase client (s8-prepare returns after "
                  "the first live chat.delta; s8-verify polls only the "
                  "original generation id), no long-lived controller",
        "recovery": "default claim lease + recovery tick only; run.sh waits "
                    "via a read-only DB poll and fixes the recovered DB "
                    "state plus a zero-request provider sample BEFORE the "
                    "health control; verify re-checks the public view; no "
                    "timeout, lease or DB-clock tampering, no DB writes",
        "provider_epochs": "old/new epoch counters recorded separately, "
                           "never subtracted across the restart",
        "delta_ms_set": int(delta_ms),
        "delta_ms_restored_to": int(baseline_delta),
        "recovery_budget_s": float(recovery_s),
    },
    "generation_id": gid,
    "prepare": prepare,
    "verify": verify,
    "provider_epochs": {
        "old_baseline": load(f"{name}.provider-oldepoch-baseline.json"),
        "prekill": load(f"{name}.provider-prekill.json"),
        "old_epoch_final": load(f"{name}.provider-oldepoch-final.json"),
        "new_epoch_initial": load(f"{name}.provider-newepoch-initial.json"),
        "new_epoch_before_health": load(
            f"{name}.provider-newepoch-before-health.json"),
        "new_epoch_final": load(f"{name}.provider-newepoch-final.json"),
    },
    "identities": {
        "runtime_before": text("s8-runtime-before.txt"),
        "runtime_killed": text("s8-runtime-killed.txt"),
        "runtime_restarted": text("s8-runtime-restarted.txt"),
        "provider_before": text("s8-provider-before.txt"),
        "provider_restarted": text("s8-provider-restarted.txt"),
    },
    "errors": [], "error_count": 0,
}
print(json.dumps(summary, ensure_ascii=False))
PY
}

if [ "$PROBE_S8" = "1" ]; then
  echo "== probe-s8 functional chain: worker-crash mid-stream recovery =="
  run_probe_s8
  echo "== G12 probe-s8 PASS (FUNCTIONAL_ONLY; artifacts in $RUN_DIR) =="
  cat "$RUN_DIR/probe-s8.summary.json"
  exit 0
fi

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

run_scenario_s3() {
  # §19.1 场景 3 (VC-R61): ONE generation held by a bounded fake-provider
  # holdMs + 3 established silent SSE subscribers. The product binds SSE to
  # a generation, so silent subscriptions are only reachable on one
  # in-flight generation — this is NOT a zero-generation idle scenario and
  # no product API is changed. The silent window is proven from real state:
  # deduplicated observer records (the frame sampler reuses the last
  # observer record, so frame-ts growth is not a fresh sample) must each
  # show vc_realtime_subscribers=3, vc_generation_active=1, provider
  # activeStreamRequests=1 and contentChunkWrites equal to the pre-send
  # baseline; any missing/stale/non-qualifying record BREAKS the window
  # (bad samples are never filtered away to stitch two ends together), and
  # one boundary-exact scrape is taken inside the window. The original
  # provider holdMs is registered as pending BEFORE the first PUT (a PUT
  # whose response was lost may still have been applied server-side) and is
  # restored right after the workload on success and failure paths alike;
  # a successful restore clears the pending state, and cleanup()'s EXIT
  # path makes exactly one further bounded attempt for anything still
  # pending, keeping the exit nonzero and recorded when that fails. No ms
  # threshold is asserted (§19.2 stays Owner-frozen).
  local name="$1" hold_ms="$2" quiet_ms="$3"
  local result="$RUN_DIR/$name.json" quiet="$RUN_DIR/$name.quiet.json"
  local summary="$RUN_DIR/$name.summary.json"
  local hold_s sse_timeout watchdog_s
  hold_s=$((hold_ms / 1000))
  sse_timeout=$((hold_s + 20))
  watchdog_s=$((sse_timeout + 60))
  echo "== scenario $name: 1 held generation (${hold_ms} ms provider hold) + 3 silent SSE =="
  local provider_before provider_after cpu_before cpu_after
  local worker_active worker_peak subscribers_after
  provider_before=$(provider_stats) || die "provider stats unreachable"
  cpu_before=$(metric_value process_cpu_seconds_total)
  local baseline_line baseline_chunks baseline_hold chunks_cfg baseline_streams
  baseline_line=$(python3 - "$provider_before" <<'PY'
import json, sys
p = json.loads(sys.argv[1])
cfg = p.get("config") or {}
print(p.get("contentChunkWrites", "NA"), cfg.get("holdMs", "NA"),
      cfg.get("chunks", "NA"), p.get("streamRequests", "NA"))
PY
)
  read -r baseline_chunks baseline_hold chunks_cfg baseline_streams \
    <<< "$baseline_line"
  local v
  for v in "$baseline_chunks" "$baseline_hold" "$chunks_cfg" "$baseline_streams"; do
    case "$v" in '' | *[!0-9]*) die "provider baseline unparseable ($v)" ;; esac
  done
  # Pending-restore registration BEFORE the first PUT: a PUT whose response
  # is lost or times out may still have been applied server-side, so the
  # original value stays pending until a successful restore clears it (the
  # normal path below, or the one bounded EXIT attempt in cleanup()).
  S3_PENDING_RESTORE_HOLD=$baseline_hold
  if ! provider_config_put "{\"holdMs\":$hold_ms}" "$RUN_DIR/$name.config-set.json"; then
    if provider_config_put "{\"holdMs\":$S3_PENDING_RESTORE_HOLD}" \
        "$RUN_DIR/$name.config-restore.json"; then
      S3_PENDING_RESTORE_HOLD=""
      die "provider holdMs PUT failed (original holdMs restored)"
    fi
    die "provider holdMs PUT failed AND restore failed (holdMs possibly left at $hold_ms)"
  fi

  local started ended
  started=$(python3 -c 'import time; print(time.time())')
  # Direct python3 background launch (NOT via a wrapper function): $! is the
  # python process itself, so cleanup's TERM/KILL/reap can never strand it
  # behind a subshell.
  python3 "$HERE/workload.py" --base "$GO_BASE" --cacert "$CA_FILE" \
    --scenario s3 --gens 1 --sse-per-gen 3 --sse-timeout "$sse_timeout" \
    --key-prefix "$TRIAL_ID-$name" > "$result" 2> "$result.err" &
  S3_WORKLOAD_PID=$!

  # Quiet-window watcher: tail frames.jsonl, dedupe observer records via
  # workload.observer_quiet_runs, boundary-scrape once inside the chosen
  # window, and close on window break / quiet-budget cap / workload exit.
  # Bounded by its own absolute deadline.
  local watch_rc=0
  python3 - "$FRAMES" "$MANIFEST" "$MINIO_IMAGE" "$baseline_chunks" \
    "$quiet_ms" "$((hold_s + 45))" "$S3_WORKLOAD_PID" "$HERE" "$quiet" \
    <<'PY' || watch_rc=$?
import json, os, subprocess, sys, time

frames_path, manifest, image = sys.argv[1:4]
baseline_chunks = int(sys.argv[4])
quiet_ms = int(sys.argv[5])
deadline_s = float(sys.argv[6])
workload_pid = int(sys.argv[7])
here, out_path = sys.argv[8:10]
sys.path.insert(0, here)
import workload  # noqa: E402

def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True

def scrape():
    cmd = [sys.executable, os.path.join(here, "collector.py"), "scrape",
           "--manifest", manifest, "--image", image,
           "--metrics", "vc_realtime_subscribers,vc_generation_active"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=40)
    except Exception as exc:
        return {"error": f"scrape failed: {exc}"}
    if proc.returncode != 0:
        return {"error": f"scrape rc={proc.returncode}: "
                         f"{proc.stderr.strip()[-300:]}"}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"error": "scrape output unparseable"}

frames = []
buf = ""
fh = open(frames_path)
chosen_start = None
endpoint = None
end_reason = None
cap_deadline = None
settle_until = None
deadline = time.time() + deadline_s

def consume_frames():
    global buf
    chunk = fh.read()
    if not chunk:
        return
    buf += chunk
    parts = buf.split("\n")
    buf = parts[-1]
    for line in parts[:-1]:
        line = line.strip()
        if not line:
            continue
        try:
            frames.append(json.loads(line))
        except json.JSONDecodeError:
            pass

while True:
    consume_frames()
    rec = workload.observer_quiet_runs(frames, baseline_chunks)
    if chosen_start is None and rec["chosen"] is not None:
        chosen_start = rec["chosen"]["start_ts"]
        # Boundary-exact sample inside the window, taken immediately.
        endpoint = scrape()
        cap_deadline = time.time() + quiet_ms / 1000.0
    wl_alive = alive(workload_pid)
    if not wl_alive and settle_until is None:
        settle_until = time.time() + 3  # let the last observer records land
    if chosen_start is not None:
        run_now = next((r for r in rec["runs"]
                        if r["start_ts"] == chosen_start), None)
        if run_now is not None and run_now.get("break_reason") is not None:
            end_reason = f"break:{run_now['break_reason']}"
            break
        if cap_deadline is not None and time.time() >= cap_deadline:
            end_reason = "quiet_budget_cap"
            break
        if settle_until is not None and time.time() >= settle_until:
            end_reason = "workload_exited"
            break
    else:
        if settle_until is not None and time.time() >= settle_until:
            end_reason = "workload_exited_no_window"
            break
        if time.time() >= deadline:
            end_reason = "deadline_no_window"
            break
    if time.time() >= deadline:
        end_reason = end_reason or "deadline"
        break
    time.sleep(0.25)

consume_frames()
final = workload.observer_quiet_runs(frames, baseline_chunks)
chosen = next((r for r in final["runs"] if r["start_ts"] == chosen_start),
              None) if chosen_start is not None else None
record = {
    "frames_seen": len(frames),
    "baseline_content_chunks": baseline_chunks,
    "quiet_budget_ms": quiet_ms,
    "end_reason": end_reason,
    "endpoint_start": endpoint,
    "observations_total": final["observations_total"],
    "runs": final["runs"],
    "chosen": chosen,
}
with open(out_path, "w") as out:
    json.dump(record, out, indent=1)
sys.exit(0 if chosen is not None else 3)
PY

  # Bounded workload wait: the SSE absolute deadline already bounds the
  # workload; this watchdog only guarantees run.sh never hangs past it.
  local wdeadline=$(( $(date +%s) + watchdog_s )) wrc=0
  while kill -0 "$S3_WORKLOAD_PID" 2>/dev/null \
        && [ "$(date +%s)" -lt "$wdeadline" ]; do
    sleep 0.5
  done
  if kill -0 "$S3_WORKLOAD_PID" 2>/dev/null; then
    kill -TERM "$S3_WORKLOAD_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$S3_WORKLOAD_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$S3_WORKLOAD_PID" 2>/dev/null || true
    wait "$S3_WORKLOAD_PID" 2>/dev/null || true
    S3_WORKLOAD_PID=""
    if provider_config_put "{\"holdMs\":$baseline_hold}" \
        "$RUN_DIR/$name.config-restore.json"; then
      S3_PENDING_RESTORE_HOLD=""
    fi
    die "$name workload exceeded its bounded budget (${watchdog_s}s)"
  fi
  wait "$S3_WORKLOAD_PID" || wrc=$?
  S3_WORKLOAD_PID=""
  ended=$(python3 -c 'import time; print(time.time())')
  # Original provider config restored right after the scenario, whatever the
  # workload outcome; a failed restore leaves the pending state for the one
  # bounded EXIT retry in cleanup().
  if provider_config_put "{\"holdMs\":$baseline_hold}" \
      "$RUN_DIR/$name.config-restore.json"; then
    S3_PENDING_RESTORE_HOLD=""
  else
    die "provider holdMs restore failed (one bounded EXIT retry follows)"
  fi
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  subscribers_after=$(metric_value vc_realtime_subscribers)
  provider_after=$(provider_stats)
  if [ "$wrc" -ne 0 ]; then
    [ -s "$result" ] && cat "$result" >&2
    die "$name workload failed (rc=$wrc)"
  fi
  if [ "$watch_rc" -ne 0 ]; then
    [ -s "$quiet" ] && cat "$quiet" >&2
    die "$name quiet window not observed"
  fi
  local qstart qend
  read -r qstart qend <<< "$(python3 - "$quiet" <<'PY'
import json, sys
chosen = (json.load(open(sys.argv[1])).get("chosen") or {})
print(chosen.get("start_ts", "NA"), chosen.get("end_ts", "NA"))
PY
)"
  python3 -c 'import sys; float(sys.argv[1]); float(sys.argv[2])' \
    "$qstart" "$qend" 2>/dev/null || die "$name quiet window bounds missing"
  analysis=$(analyze_window "$qstart" "$qend")
  echo "$analysis" > "$RUN_DIR/$name.quiet.analysis.json"
  if ! python3 - "$result" "$quiet" "$provider_before" "$provider_after" \
    "$cpu_before" "$cpu_after" "$worker_active" "$worker_peak" \
    "$subscribers_after" "$analysis" "$name" "$hold_ms" "$quiet_ms" \
    "$sse_timeout" "$READER_INTERVAL" "$baseline_chunks" "$baseline_hold" \
    "$chunks_cfg" "$baseline_streams" > "$summary" <<'PY'
import json, sys

(result_path, quiet_path, provider_before, provider_after, cpu_before,
 cpu_after, worker_active, worker_peak, subscribers_after, analysis_s,
 name, hold_ms, quiet_ms, sse_timeout, reader_interval, baseline_chunks,
 baseline_hold, chunks_cfg, baseline_streams) = sys.argv[1:20]
hold_ms, quiet_ms = int(hold_ms), int(quiet_ms)
sse_timeout, reader_interval = float(sse_timeout), float(reader_interval)
baseline_chunks, baseline_hold = int(baseline_chunks), int(baseline_hold)
chunks_cfg, baseline_streams = int(chunks_cfg), int(baseline_streams)
analysis = json.loads(analysis_s)
r = json.load(open(result_path))
q = json.load(open(quiet_path))
before, after = json.loads(provider_before), json.loads(provider_after)
s = r["stats"]
fd = s["first_delta"]
chosen = q.get("chosen") or {}
endpoint = q.get("endpoint_start") or {}
errors = []
functional = name == "probe-s3"

# Workload lifecycle: exactly one generation, all three subscribers closed
# with a non-failed terminal.
if r.get("generations") != 1 or r.get("expected_sse") != 3:
    errors.append(f"accepted {r.get('generations')} gen / "
                  f"{r.get('expected_sse')} expected SSE want 1/3")
if s.get("sse_total") != 3 or s.get("sse_ok") != 3:
    errors.append(f"SSE {s.get('sse_ok')}/{s.get('sse_total')} want 3/3")
if s.get("error_count") != 0:
    errors.append(f"workload errors: {s.get('errors')}")
if fd.get("observed") != 3:
    errors.append(f"first delta observed {fd.get('observed')} want 3 "
                  f"({fd.get('absent_reasons')})")

# Quiet window: distinct deduplicated observer samples, all with the
# content counter frozen at the pre-send baseline; span is the observer-ts
# span (reused Tailer records never lengthen it).
if not chosen:
    errors.append("quiet window missing from watcher record")
else:
    if chosen.get("sample_count", 0) < 2:
        errors.append(f"quiet window has {chosen.get('sample_count')} "
                      "distinct observer samples, want >= 2")
    if chosen.get("max_content_chunks") != baseline_chunks:
        errors.append(f"quiet window max content chunks "
                      f"{chosen.get('max_content_chunks')} != baseline "
                      f"{baseline_chunks}")

# Boundary-exact sample inside the window: same real-state shape.
if endpoint.get("error"):
    errors.append(f"window-start scrape failed: {endpoint.get('error')}")
else:
    ep_provider = endpoint.get("provider") or {}
    ep_metrics = endpoint.get("metrics") or {}
    if ep_provider.get("contentChunkWrites") != baseline_chunks:
        errors.append(f"window-start content chunks "
                      f"{ep_provider.get('contentChunkWrites')} != baseline "
                      f"{baseline_chunks}")
    if ep_provider.get("activeStreamRequests") != 1:
        errors.append(f"window-start provider active "
                      f"{ep_provider.get('activeStreamRequests')} want 1")
    try:
        ep_subs = int(float(ep_metrics["vc_realtime_subscribers"]))
        ep_gen = int(float(ep_metrics["vc_generation_active"]))
    except (KeyError, TypeError, ValueError):
        errors.append("window-start gauges missing/unparseable")
    else:
        if ep_subs != 3:
            errors.append(f"window-start subscribers {ep_subs} want 3")
        if ep_gen != 1:
            errors.append(f"window-start generation_active {ep_gen} want 1")

# Provider deltas: exactly one held completion, its content actually
# written once the hold expired, and the provider back to idle.
stream_delta = after["streamRequests"] - baseline_streams
chunk_delta = after["contentChunkWrites"] - baseline_chunks
if stream_delta != 1:
    errors.append(f"provider requests {stream_delta} want 1")
if chunk_delta != chunks_cfg:
    errors.append(f"provider content chunks {chunk_delta} want {chunks_cfg}")
if after["activeStreamRequests"] != 0:
    errors.append(f"provider active after scenario "
                  f"{after['activeStreamRequests']}")
if int(float(worker_active)) != 0:
    errors.append(f"worker active after scenario {worker_active}")
if int(float(worker_peak)) < 1:
    errors.append(f"worker peak {worker_peak} want >= 1")
if int(float(subscribers_after)) != 0:
    errors.append(f"subscribers after scenario {subscribers_after}")

# Same-window A/B collection over the quiet window bounds.
a = analysis["a"]
if a["frames_with_pid1"] < 1:
    errors.append("no A frames with runtime PID 1 in the quiet window")
peak = analysis["b"]["same_frame_peak"]
if peak is None or peak["complete_frames"] < 1:
    errors.append("no complete same-frame B sum in the quiet window")
for comp, cpu in analysis["b"]["components"].items():
    if cpu["status"] == "INVALID":
        errors.append(f"{comp} CPU window invalid ({cpu.get('reason')}); "
                      "not a valid measurement")

summary = {
    "scenario": name,
    "mode": "FUNCTIONAL_ONLY" if functional else "PROFILE",
    "semantics": (
        "one generation waiting on the fake provider (bounded holdMs) with 3 "
        "established silent SSE subscriptions: the product binds SSE to a "
        "generation, so silent subscriptions exist only on an in-flight "
        "generation — NOT a zero-generation idle scenario and no product API "
        "was changed to fabricate one"),
    "method": {
        "provider_hold_ms": hold_ms,
        "provider_hold_restored_to_ms": baseline_hold,
        "quiet_budget_ms": quiet_ms,
        "sse_deadline_s": sse_timeout,
        "observer_interval_s": reader_interval,
        "sampling": (
            "observer.sh order per record: ts first, then "
            "/actuator/prometheus, then /g12/stats (sequential wgets), so "
            "cross-source instants align at observer-cadence resolution, "
            "not ns-exact; the frame sampler reuses the latest observer "
            "record between observer polls"),
        "quiet_sample": (
            "one deduplicated observer record (integrity.observer."
            "observer_ts), strictly increasing; each must keep "
            "vc_realtime_subscribers=3, vc_generation_active=1, provider "
            "activeStreamRequests=1 and contentChunkWrites equal to the "
            "pre-send baseline; any missing/stale/non-qualifying record "
            "breaks the window — bad samples are never filtered away to "
            "stitch two ends; span_s is the observer-ts span"),
    },
    "quiet_window": {
        "start_ts": chosen.get("start_ts"),
        "end_ts": chosen.get("end_ts"),
        "span_s": chosen.get("span_s"),
        "distinct_observer_samples": chosen.get("sample_count"),
        "sample_ts": chosen.get("sample_ts"),
        "break_reason": chosen.get("break_reason"),
        "end_reason": q.get("end_reason"),
        "max_content_chunks": chosen.get("max_content_chunks"),
        "runs_total": len(q.get("runs") or []),
        "observations_total": q.get("observations_total"),
    },
    "endpoint_start": endpoint,
    "workload": {
        "generations": r.get("generations"), "sse_ok": s.get("sse_ok"),
        "stream_ms": s["stream_ms"],
        "first_delta": {
            "observed": fd.get("observed"),
            "from_subscribe_ms": fd.get("from_subscribe_ms"),
            "coverage": fd.get("coverage"),
        },
    },
    "provider": {
        "stream_requests_delta": stream_delta,
        "content_chunk_writes_delta": chunk_delta,
        "chunks_config": chunks_cfg,
        "active_after": after["activeStreamRequests"],
        "baseline_hold_ms": baseline_hold,
    },
    "worker_active_after": int(float(worker_active)),
    "worker_peak": int(float(worker_peak)),
    "subscribers_after": int(float(subscribers_after)),
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "quiet_ab": {
        "a_rss_peak_kb": a["a_rss_peak_kb"],
        "a_pss_peak_kb": a["a_pss_peak_kb"],
        "b_peak_rss_mib": round(peak["b_rss_peak_kb"] / 1024, 3) if peak else None,
        "b_peak_pss_mib": round(peak["b_pss_peak_kb"] / 1024, 3) if peak else None,
        "b_complete_frames": peak["complete_frames"] if peak else 0,
        "b_cpu_status": {c: {"status": cpu["status"], "reason": cpu.get("reason")}
                         for c, cpu in analysis["b"]["components"].items()},
        "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                               for c, cpu in analysis["b"]["components"].items()},
    },
    "errors": errors,
}
if functional:
    summary["performance_conclusions"] = "NONE"
    summary["note"] = ("functional wiring proof only: one held generation, "
                       "3 silent subscribers, quiet-window real-state proof "
                       "and cleanup wiring; no capacity/perf conclusion and "
                       "no §19.2 gate")
print(json.dumps(summary, ensure_ascii=False))
if errors:
    for error in errors:
        print(f"G12 assertion failed: {error}", file=sys.stderr)
    raise SystemExit(1)
PY
  then
    die "$name quiet-window assertions failed"
  fi
  python3 - "$summary" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
q = r["quiet_window"]
print(f"  quiet window: {q['distinct_observer_samples']} distinct observer "
      f"samples over {q['span_s']} s "
      f"(end: {q['end_reason']}; break: {q['break_reason']}); "
      f"max content chunks {q['max_content_chunks']} == baseline")
fd = r["workload"]["first_delta"]
print(f"  SSE 3/3 closed, first delta observed {fd['observed']}; "
      f"provider delta {r['provider']['stream_requests_delta']} / "
      f"content chunks {r['provider']['content_chunk_writes_delta']}; "
      f"workers/subscribers after = {r['worker_active_after']}/"
      f"{r['subscribers_after']}")
ab = r["quiet_ab"]
print(f"  quiet-window A peak RSS/PSS = {ab['a_rss_peak_kb']}/"
      f"{ab['a_pss_peak_kb']} kB; B same-frame peak RSS/PSS = "
      f"{ab['b_peak_rss_mib']}/{ab['b_peak_pss_mib']} MiB "
      f"({ab['b_complete_frames']} frames)")
cpu = ab["b_cpu_status"]
nonvalid = {c: s for c, s in cpu.items() if s["status"] != "VALID"}
print(f"  B CPU windows = {'all VALID' if not nonvalid else nonvalid}; "
      f"errors = 0")
PY
}

wait_s6_baseline() {
  # Bounded REAL-STATE wait (VC-R62 closeout): the fake provider's own
  # sleeps make the post-cancel/post-completion return to baseline
  # reachable but DELAYED — a single scrape right after the workload can
  # catch the transition (worker still 1 / provider stream still active /
  # abort counter not yet landed), and Docker-command latency must never
  # be the reason a one-shot read happened to pass. The three values are
  # re-scraped — from ONE scrape call (its output carries both the
  # metrics and the provider block) — until they are genuinely zero or
  # the budget expires as an explicit failure; never a fixed sleep
  # masquerading as a recovery proof. The budget is a single monotonic
  # deadline shared with every scrape call: each call is capped at
  # EXACTLY the remaining time (never more), a slow scrape is killed
  # together with its whole process group (the collector itself spawns
  # docker CLI children — the parent's death alone never clears the
  # group) and reaped within a bounded window, and a sample is accepted
  # only AFTER it is checked against the deadline — an expired success is
  # never a success.
  local timeout_s="$1"
  python3 - "$HERE" "$MANIFEST" "$MINIO_IMAGE" "$timeout_s" <<'PY'
import json, os, signal, subprocess, sys, time

here, manifest, image, timeout_s = sys.argv[1:5]
deadline = time.monotonic() + float(timeout_s)
last = {}


def scrape(remaining):
    cmd = [sys.executable, f"{here}/collector.py", "scrape",
           "--manifest", manifest, "--image", image]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL,
                                start_new_session=True)
    except OSError:
        return None
    try:
        out, _ = proc.communicate(timeout=remaining)
    except subprocess.TimeoutExpired:
        # The scrape (and any docker CLI it spawned) outlived its share of
        # the budget: kill the WHOLE process group THIS Popen created and
        # reap it within a bounded window — recorded, never silent.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            print(f"s6 scrape process group {proc.pid} not reaped "
                  "within 5s", file=sys.stderr)
        return None
    if proc.returncode != 0:
        return None
    try:
        d = json.loads(out)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return d.get("metrics") or {}, d.get("provider") or {}


while True:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        break
    sample = scrape(remaining)
    # Expiry is judged AFTER the sample returns: values read past the
    # shared budget are never accepted as a settle, even all-zero ones.
    if sample is not None and time.monotonic() < deadline:
        metrics, provider = sample
        try:
            values = (int(float(metrics["vc_generation_active"])),
                      int(float(metrics["vc_realtime_subscribers"])),
                      int(provider["activeStreamRequests"]))
        except (KeyError, TypeError, ValueError):
            values = None
        if values is not None:
            last = dict(zip(("worker", "subscribers", "provider_active"),
                            values))
            if values == (0, 0, 0):
                print("SETTLED")
                sys.exit(0)
    time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))
print("s6 baseline NOT reached within %ss (worker=%s subscribers=%s "
      "provider_active=%s)" % (timeout_s, last.get("worker", "?"),
                               last.get("subscribers", "?"),
                               last.get("provider_active", "?")),
      file=sys.stderr)
sys.exit(1)
PY
}

run_scenario_s6() {
  # §19.1 场景 6 (VC-R62): cancel + disconnect-reconnect on the real public
  # HTTP chain — TWO independent generations, each gated on a live delta
  # actually received (never a sleep). (A) the subscriber closes its SSE
  # connection right after the first live delta: the disconnect must not
  # cancel the generation nor re-POST it (snapshot-only re-subscription
  # still ends COMPLETED with further live deltas; a subscription after
  # the terminal returns the persisted snapshot + terminal whose full text
  # equals the single committed assistant message, compared in-process,
  # only booleans/lengths reported). (B) the SSE response carrying the
  # first live delta stays OPEN while the cancel POST fires, and the proof
  # is the ORIGINAL stream receiving the chat.cancelled broadcast and
  # being closed by the server; no assistant message is committed. The
  # fake provider's deltaMs is widened for the window (pending-registered
  # before the first PUT, restored on every exit path like the scenario-3
  # holdMs) so a stream is still in flight after the first delta. The
  # fixture counters prove the provider-side truth of the cancel: exactly
  # one ABORTED stream (the backend disconnected mid-reply — chunks stop
  # being written) and one COMPLETED stream (A's natural finish can never
  # pose as an abort). No ms threshold is asserted (§19.2 stays
  # Owner-frozen).
  local name="$1" delta_ms="$2"
  local result="$RUN_DIR/$name.json" summary="$RUN_DIR/$name.summary.json"
  local sse_timeout=20
  echo "== scenario $name: disconnect/reconnect + cancel (deltaMs=${delta_ms} ms) =="
  local provider_before provider_after cpu_before cpu_after
  local worker_active worker_peak subscribers_after
  provider_before=$(provider_stats) || die "provider stats unreachable"
  cpu_before=$(metric_value process_cpu_seconds_total)
  local baseline_line baseline_delta chunks_cfg baseline_streams \
        baseline_aborted baseline_completed baseline_chunks
  # /g12/stats carries the stream counters at the top level and the
  # timing knobs only under config — deltaMs exists solely as
  # config.deltaMs (verified against the producer's stats shape).
  baseline_line=$(python3 - "$provider_before" <<'PY'
import json, sys
p = json.loads(sys.argv[1])
cfg = p.get("config") or {}
print(cfg.get("deltaMs", "NA"), cfg.get("chunks", "NA"),
      p.get("streamRequests", "NA"), p.get("abortedStreamRequests", "NA"),
      p.get("completedStreamRequests", "NA"),
      p.get("contentChunkWrites", "NA"))
PY
)
  read -r baseline_delta chunks_cfg baseline_streams baseline_aborted \
        baseline_completed baseline_chunks <<< "$baseline_line"
  local v
  for v in "$baseline_delta" "$chunks_cfg" "$baseline_streams" \
           "$baseline_aborted" "$baseline_completed" "$baseline_chunks"; do
    case "$v" in '' | *[!0-9]*) die "provider baseline unparseable ($v)" ;; esac
  done
  # Pending-restore registration BEFORE the first PUT: a PUT whose response
  # is lost or times out may still have been applied server-side (same
  # contract as the scenario-3 holdMs).
  S6_PENDING_RESTORE_DELTA=$baseline_delta
  if ! provider_config_put "{\"deltaMs\":$delta_ms}" \
      "$RUN_DIR/$name.config-set.json"; then
    if provider_config_put "{\"deltaMs\":$S6_PENDING_RESTORE_DELTA}" \
        "$RUN_DIR/$name.config-restore.json"; then
      S6_PENDING_RESTORE_DELTA=""
      die "provider deltaMs PUT failed (original deltaMs restored)"
    fi
    die "provider deltaMs PUT failed AND restore failed (deltaMs possibly left at $delta_ms)"
  fi

  local started ended analysis
  started=$(python3 -c 'import time; print(time.time())')
  if ! run_workload --scenario s6 --sse-timeout "$sse_timeout" \
      --key-prefix "$TRIAL_ID-$name" > "$result"; then
    [ -s "$result" ] && cat "$result" >&2
    provider_config_put "{\"deltaMs\":$baseline_delta}" \
      "$RUN_DIR/$name.config-restore.json" \
      && S6_PENDING_RESTORE_DELTA="" || true
    die "$name workload failed"
  fi
  # Original provider config restored right after the scenario, whatever
  # the workload outcome; a failed restore leaves the pending state for the
  # one bounded EXIT retry in cleanup().
  if provider_config_put "{\"deltaMs\":$baseline_delta}" \
      "$RUN_DIR/$name.config-restore.json"; then
    S6_PENDING_RESTORE_DELTA=""
  else
    die "provider deltaMs restore failed (one bounded EXIT retry follows)"
  fi
  # Bounded real-state settle BEFORE the scenario window ends: only a
  # confirmed baseline (worker/subscribers/provider-active all zero from
  # fresh scrapes) closes the window — ended is recorded here, not at
  # workload exit, so a never-settling run fails on real state.
  if ! wait_s6_baseline 30; then
    die "$name did not return to baseline within the bounded budget"
  fi
  ended=$(python3 -c 'import time; print(time.time())')
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  subscribers_after=$(metric_value vc_realtime_subscribers)
  provider_after=$(provider_stats)
  analysis=$(analyze_window "$started" "$ended")
  echo "$analysis" > "$RUN_DIR/$name.analysis.json"
  if ! python3 - "$result" "$provider_before" "$provider_after" \
    "$cpu_before" "$cpu_after" "$worker_active" "$worker_peak" \
    "$subscribers_after" "$analysis" "$name" "$delta_ms" "$sse_timeout" \
    "$chunks_cfg" "$baseline_delta" "$baseline_chunks" > "$summary" <<'PY'
import json, sys

(result_path, provider_before, provider_after, cpu_before, cpu_after,
 worker_active, worker_peak, subscribers_after, analysis_s, name, delta_ms,
 sse_timeout, chunks_cfg, baseline_delta, baseline_chunks) = sys.argv[1:16]
delta_ms = int(delta_ms)
chunks_cfg = int(chunks_cfg)
baseline_delta, baseline_chunks = int(baseline_delta), int(baseline_chunks)
analysis = json.loads(analysis_s)
r = json.load(open(result_path))
before, after = json.loads(provider_before), json.loads(provider_after)
reconnect = r.get("reconnect") or {}
cancel = r.get("cancel") or {}
errors = []
functional = name == "probe-s6"

# (A) disconnect ≠ cancel / re-POST: re-subscription per the snapshot-only
# contract ends COMPLETED with further live deltas, the terminal-time
# subscription returns the persisted snapshot + terminal with the full text
# equal to the single committed assistant message, and exactly one
# assistant message exists.
if reconnect.get("precondition_live_delta") is not True:
    errors.append(f"A precondition: live delta before disconnect "
                  f"{reconnect.get('precondition_live_delta')} "
                  f"({reconnect.get('precondition_reason')})")
if reconnect.get("reconnect_terminal") != "chat.completed":
    errors.append(f"A reconnect terminal "
                  f"{reconnect.get('reconnect_terminal')} want chat.completed")
if reconnect.get("reconnect_live_deltas", 0) < 1:
    errors.append(f"A live deltas after reconnect "
                  f"{reconnect.get('reconnect_live_deltas')} want >= 1")
if reconnect.get("reconnect_catchup_nonempty") is not True:
    errors.append("A reconnect catch-up snapshot empty (disconnect landed "
                  "before any content?)")
if reconnect.get("post_terminal_terminal") != "chat.completed":
    errors.append(f"A post-terminal event "
                  f"{reconnect.get('post_terminal_terminal')}")
if reconnect.get("post_terminal_snapshot_matches_assistant") is not True:
    errors.append("A post-terminal persisted snapshot differs from the "
                  "committed assistant message")
if reconnect.get("assistant_messages") != 1:
    errors.append(f"A assistant messages "
                  f"{reconnect.get('assistant_messages')} want exactly 1")

# (B) cancel on the original, still-open stream: 200/CANCELLED response,
# chat.cancelled broadcast reaches THAT consumer, the server closes the
# connection, no assistant message committed, snapshot CANCELLED.
if cancel.get("precondition_live_delta") is not True:
    errors.append(f"B precondition: live delta on original stream "
                  f"{cancel.get('precondition_live_delta')} "
                  f"({cancel.get('precondition_reason')})")
if cancel.get("callback_called") is not True:
    errors.append("B cancel never fired on the open stream")
if cancel.get("callback_error") is not None:
    errors.append(f"B cancel callback raised "
                  f"{cancel.get('callback_error')} (e.g. CSRF/403 — the "
                  "cancel POST must be a content write)")
if cancel.get("callback_budget_exhausted") is True:
    errors.append("B callback budget exhausted before the cancel POST")
if cancel.get("status_before_nonterminal") is not True:
    errors.append(f"B status before cancel "
                  f"{cancel.get('status_before_cancel')} (terminal?)")
if cancel.get("cancel_http_status") != 200:
    errors.append(f"B cancel http {cancel.get('cancel_http_status')} want 200")
if cancel.get("cancel_status_field") != "CANCELLED":
    errors.append(f"B cancel status field "
                  f"{cancel.get('cancel_status_field')} want CANCELLED")
if cancel.get("original_stream_cancelled") is not True:
    errors.append(f"B original stream: terminal "
                  f"{cancel.get('original_stream_terminal')}, ended by "
                  f"{cancel.get('original_stream_ended_by')} "
                  "(want chat.cancelled + server eof)")
if cancel.get("status_after_cancel") != "CANCELLED":
    errors.append(f"B status after cancel "
                  f"{cancel.get('status_after_cancel')}")
if cancel.get("assistant_messages") != 0:
    errors.append(f"B assistant messages "
                  f"{cancel.get('assistant_messages')} want 0")

if r.get("error_count") != 0:
    errors.append(f"workload errors: {r.get('errors')}")

# Provider truth (fixture counters): exactly TWO stream requests (one per
# generation), exactly one ABORTED mid-reply by the backend's disconnect
# (the cancel) and one COMPLETED naturally (the reconnect generation), and
# the aborted one stopped before writing all its content chunks (A wrote
# all chunks, so the total stays strictly between chunks and 2*chunks).
stream_delta = after["streamRequests"] - before["streamRequests"]
aborted_delta = after["abortedStreamRequests"] - before["abortedStreamRequests"]
completed_delta = (after["completedStreamRequests"]
                   - before["completedStreamRequests"])
chunk_delta = after["contentChunkWrites"] - before["contentChunkWrites"]
if stream_delta != 2:
    errors.append(f"provider requests {stream_delta} want 2")
if aborted_delta != 1:
    errors.append(f"provider aborted streams {aborted_delta} want 1 "
                  "(the cancel must abort the backend's provider stream "
                  "mid-reply; a natural finish cannot pose as an abort)")
if completed_delta != 1:
    errors.append(f"provider completed streams {completed_delta} want 1 "
                  "(the disconnect generation must finish naturally)")
if not (chunks_cfg < chunk_delta < 2 * chunks_cfg):
    errors.append(f"provider content chunks {chunk_delta} want strictly "
                  f"between {chunks_cfg} (reconnect gen wrote all) and "
                  f"{2 * chunks_cfg} (cancelled gen stopped early)")

# Bounded return to baseline: worker, provider active, subscribers.
if after["activeStreamRequests"] != 0:
    errors.append(f"provider active after scenario "
                  f"{after['activeStreamRequests']}")
if int(float(worker_active)) != 0:
    errors.append(f"worker active after scenario {worker_active}")
if int(float(worker_peak)) < 1:
    errors.append(f"worker peak {worker_peak} want >= 1")
if int(float(subscribers_after)) != 0:
    errors.append(f"subscribers after scenario {subscribers_after}")

# Same-window A/B collection over the scenario bounds.
a = analysis["a"]
if a.get("frames_with_pid1", 0) < 1:
    errors.append("no A frames with runtime PID 1 in the scenario window")
peak = analysis["b"]["same_frame_peak"]
if peak is None or peak["complete_frames"] < 1:
    errors.append("no complete same-frame B sum in the scenario window")
for comp, cpu in analysis["b"]["components"].items():
    if cpu["status"] == "INVALID":
        errors.append(f"{comp} CPU window invalid ({cpu.get('reason')}); "
                      "not a valid measurement")

summary = {
    "scenario": name,
    "mode": "FUNCTIONAL_ONLY" if functional else "PROFILE",
    "semantics": (
        "two independent generations on the real public chain: (A) the "
        "subscriber deliberately closes its SSE connection right after a "
        "received live delta — disconnect must not cancel or re-POST the "
        "generation; (B) the SSE response carrying the first live delta "
        "stays open while cancel fires, proving the chat.cancelled "
        "broadcast and server-side connection close on the ORIGINAL "
        "stream. The slow-subscriber sub-scenario of §19.1 S6 remains "
        "open for the Caddy/TLS/companiond deployment chain (the Go "
        "handler already has real-TCP backpressure regression coverage "
        "with controlled test buffers and a test write timeout)"),
    "method": {
        "provider_delta_ms": delta_ms,
        "provider_delta_restored_to_ms": baseline_delta,
        "sse_deadline_s": sse_timeout,
        "preconditions": (
            "each sub-scenario proceeds only after a live chat.delta was "
            "actually received on the wire (B additionally checks a "
            "non-terminal snapshot status while its stream is open) — "
            "never a fixed sleep or a thread-start inference"),
        "snapshot_comparison": (
            "the terminal-time persisted snapshot's full text is compared "
            "in memory against the single committed assistant message; "
            "only the boolean and lengths are reported"),
    },
    "reconnect": reconnect,
    "cancel": cancel,
    "provider": {
        "stream_requests_delta": stream_delta,
        "aborted_streams_delta": aborted_delta,
        "completed_streams_delta": completed_delta,
        "content_chunk_writes_delta": chunk_delta,
        "chunks_config": chunks_cfg,
        "active_after": after["activeStreamRequests"],
        "baseline_delta_ms": baseline_delta,
    },
    "worker_active_after": int(float(worker_active)),
    "worker_peak": int(float(worker_peak)),
    "subscribers_after": int(float(subscribers_after)),
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "window_ab": {
        "a_rss_peak_kb": a["a_rss_peak_kb"],
        "a_pss_peak_kb": a["a_pss_peak_kb"],
        "b_peak_rss_mib": round(peak["b_rss_peak_kb"] / 1024, 3) if peak else None,
        "b_peak_pss_mib": round(peak["b_pss_peak_kb"] / 1024, 3) if peak else None,
        "b_complete_frames": peak["complete_frames"] if peak else 0,
        "b_cpu_status": {c: {"status": cpu["status"], "reason": cpu.get("reason")}
                         for c, cpu in analysis["b"]["components"].items()},
        "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                               for c, cpu in analysis["b"]["components"].items()},
    },
    "errors": errors,
}
if functional:
    summary["performance_conclusions"] = "NONE"
    summary["note"] = ("functional wiring proof only: cancel + "
                       "disconnect-reconnect chains with fixture-side "
                       "abort/completion accounting; no capacity/perf "
                       "conclusion and no §19.2 gate")
print(json.dumps(summary, ensure_ascii=False))
if errors:
    for error in errors:
        print(f"G12 assertion failed: {error}", file=sys.stderr)
    raise SystemExit(1)
PY
  then
    die "$name cancel/reconnect assertions failed"
  fi
  python3 - "$summary" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
a = r["reconnect"]
b = r["cancel"]
p = r["provider"]
print(f"  A: reconnect -> {a.get('reconnect_terminal')} with "
      f"{a.get('reconnect_live_deltas')} live deltas; post-terminal "
      f"snapshot == assistant message "
      f"({a.get('post_terminal_snapshot_matches_assistant')}, "
      f"{a.get('post_terminal_snapshot_chars')} chars); assistant "
      f"messages {a.get('assistant_messages')}")
print(f"  B: original stream {b.get('original_stream_terminal')} ended by "
      f"{b.get('original_stream_ended_by')}; cancel "
      f"{b.get('cancel_http_status')}/{b.get('cancel_status_field')}; "
      f"assistant messages {b.get('assistant_messages')}")
print(f"  provider: requests {p['stream_requests_delta']} "
      f"(aborted {p['aborted_streams_delta']} / completed "
      f"{p['completed_streams_delta']}), content chunks "
      f"{p['content_chunk_writes_delta']} in ({p['chunks_config']}, "
      f"{2 * p['chunks_config']}); worker/subscribers after = "
      f"{r['worker_active_after']}/{r['subscribers_after']}")
ab = r["window_ab"]
nonvalid = {c: s for c, s in
            ((k, v["status"]) for k, v in ab["b_cpu_status"].items())
            if s != "VALID"}
print(f"  A peak RSS/PSS = {ab['a_rss_peak_kb']}/{ab['a_pss_peak_kb']} kB; "
      f"B same-frame peak RSS/PSS = {ab['b_peak_rss_mib']}/"
      f"{ab['b_peak_pss_mib']} MiB ({ab['b_complete_frames']} frames); "
      f"B CPU windows = {'all VALID' if not nonvalid else nonvalid}; "
      f"errors = 0")
PY
}

run_scenario_s9() {
  # §19.1 场景 9 (VC-R128): real login + session-revocation concurrency on
  # the real public auth chain — no generation, no provider call, and no
  # provider config is ever set or restored. Two freshly seeded synthetic
  # accounts walk the Root-audited contract: (1) full TOTP enrollment with
  # trustDevice (S_a0), a trusted-device password login (S_target), and B's
  # independent enrollment (S_b); (2) cross-account owner isolation — B's
  # DELETE of A's target sid must 404 and leave the target valid; (3) a
  # barrier-synchronized pair — A's trusted-device password login racing
  # S_a0's explicit DELETE of the target sid, per-client cookie jars, the
  # overlap proven from the ACTUAL request windows (boolean + margin ms,
  # never thread starts): DELETE 200, target next GET 401, and the new
  # session, S_a0, S_b all still 200; (4) revoke-all from the new session:
  # exactly 2 revoked (a0 + new; the target is already gone), a0/new next
  # GET 401, B untouched, no Set-Cookie on any revoke response; (5) the
  # SAME trusted-device cookie on a correct-password login must land at
  # 202/TOTP_REQUIRED with no session cookie — the device itself was
  # revoked by the all-revoke; (6) one read-only probe with the harness's
  # original fabricated session must stay 200. All assertions are status
  # codes / booleans / exact counts; no ms threshold is asserted (§19.2
  # gates stay Owner-frozen).
  local name="$1"
  local result="$RUN_DIR/$name.json" summary="$RUN_DIR/$name.summary.json"
  echo "== scenario $name: real login + session revoke concurrency (budget ${S9_BUDGET_SECONDS}s) =="
  local provider_before provider_after cpu_before cpu_after
  local worker_active worker_peak subscribers_after
  local started ended analysis
  provider_before=$(provider_stats) || die "provider stats unreachable"
  cpu_before=$(metric_value process_cpu_seconds_total)
  started=$(python3 -c 'import time; print(time.time())')
  export G12_S9_BUDGET_SECONDS="$S9_BUDGET_SECONDS"
  if ! run_workload --scenario s9 > "$result"; then
    [ -s "$result" ] && cat "$result" >&2
    die "$name workload failed"
  fi
  # S9 makes no generation/provider call, so the baseline must already be
  # zero — proven from fresh re-scraped real state with the same bounded
  # wait as S6, never a single scrape or a fixed sleep.
  if ! wait_s6_baseline 30; then
    die "$name did not return to baseline within the bounded budget"
  fi
  ended=$(python3 -c 'import time; print(time.time())')
  cpu_after=$(metric_value process_cpu_seconds_total)
  worker_active=$(metric_value vc_generation_active)
  worker_peak=$(metric_value vc_generation_peak)
  subscribers_after=$(metric_value vc_realtime_subscribers)
  provider_after=$(provider_stats)
  analysis=$(analyze_window "$started" "$ended")
  echo "$analysis" > "$RUN_DIR/$name.analysis.json"
  if ! python3 - "$result" "$provider_before" "$provider_after" \
    "$cpu_before" "$cpu_after" "$worker_active" "$worker_peak" \
    "$subscribers_after" "$analysis" "$name" > "$summary" <<'PY'
import json, sys

(result_path, provider_before, provider_after, cpu_before, cpu_after,
 worker_active, worker_peak, subscribers_after, analysis_s, name) = sys.argv[1:11]
analysis = json.loads(analysis_s)
r = json.load(open(result_path))
before, after = json.loads(provider_before), json.loads(provider_after)
errors = []
checks = []

# Strict consumption: a missing field is itself a failure — an absent
# check can never produce a vacuous green.
s9 = r.get("s9")
if not isinstance(s9, dict):
    s9 = {}
    errors.append("s9 result object missing from workload result")
for field in ("deadline_seconds", "budget_expired", "public_calls"):
    if field not in s9:
        errors.append(f"s9.{field} missing from workload result")

STEP_FIELDS = {
    "a_enroll": ("login_status", "setup_status", "totp_status",
                 "totp_trusted", "session_active"),
    "a_login2": ("status", "trusted_cookie_present", "session_active"),
    "b_enroll": ("login_status", "setup_status", "totp_status",
                 "session_active"),
    "owner_isolation": ("b_delete_status", "target_get_status"),
    "concurrent": ("overlap", "overlap_margin_ms", "login_status",
                   "delete_status", "target_after_status", "new_active",
                   "a0_active", "b_active", "delete_no_set_cookie"),
    "revoke_all": ("status", "revoked", "a0_after_status",
                   "new_after_status", "b_active", "no_set_cookie"),
    "trusted_revoked": ("login_status", "next_step",
                        "session_cookie_absent"),
    "g12_probe": ("status",),
}
steps = {}
for step_name, fields in STEP_FIELDS.items():
    step = s9.get(step_name)
    if not isinstance(step, dict):
        errors.append(f"s9.{step_name} missing from workload result")
        step = {}
    steps[step_name] = step
    for field in fields:
        if field not in step:
            errors.append(f"s9.{step_name}.{field} missing from workload "
                          "result")

def get(step_name, field):
    return steps[step_name].get(field)

def want(step_name, field, expected):
    value = get(step_name, field)
    if value != expected:
        errors.append(f"{step_name}.{field} = {value!r} want {expected!r}")

# 1) full enroll chains on the real public login surface
want("a_enroll", "login_status", 202)
want("a_enroll", "setup_status", 200)
want("a_enroll", "totp_status", 200)
want("a_enroll", "totp_trusted", True)
want("a_enroll", "session_active", True)
want("a_login2", "status", 200)
want("a_login2", "trusted_cookie_present", True)
want("a_login2", "session_active", True)
want("b_enroll", "login_status", 202)
want("b_enroll", "setup_status", 200)
want("b_enroll", "totp_status", 200)
want("b_enroll", "session_active", True)
# 2) owner isolation: exactly 404, and the target still valid afterwards
want("owner_isolation", "b_delete_status", 404)
want("owner_isolation", "target_get_status", 200)
# 3) the concurrent pair: overlap proven on the real request windows
want("concurrent", "overlap", True)
want("concurrent", "login_status", 200)
want("concurrent", "delete_status", 200)
want("concurrent", "target_after_status", 401)
want("concurrent", "new_active", True)
want("concurrent", "a0_active", True)
want("concurrent", "b_active", True)
want("concurrent", "delete_no_set_cookie", True)
margin = get("concurrent", "overlap_margin_ms")
if not isinstance(margin, (int, float)) or isinstance(margin, bool):
    errors.append(f"concurrent.overlap_margin_ms = {margin!r} want a number")
else:
    checks.append(f"concurrent request-window overlap margin {margin} ms")
# 4) revoke-all causality
want("revoke_all", "status", 200)
want("revoke_all", "revoked", 2)
want("revoke_all", "a0_after_status", 401)
want("revoke_all", "new_after_status", 401)
want("revoke_all", "b_active", True)
want("revoke_all", "no_set_cookie", True)
# 5) the trusted device itself was revoked
want("trusted_revoked", "login_status", 202)
want("trusted_revoked", "next_step", "TOTP_REQUIRED")
want("trusted_revoked", "session_cookie_absent", True)
# 6) the harness's own fabricated session survives S9 untouched
want("g12_probe", "status", 200)

budget_expired = s9.get("budget_expired")
if budget_expired is True:
    errors.append("S9 deadline expired — no result may count as a success")
elif budget_expired is not False:
    errors.append(f"s9.budget_expired = {budget_expired!r} want a boolean")
public_calls = s9.get("public_calls")
if not isinstance(public_calls, int) or isinstance(public_calls, bool):
    errors.append(f"s9.public_calls = {public_calls!r} want an integer")
else:
    checks.append(f"public calls {public_calls} (budget 25)")
    if public_calls > 25:
        errors.append(f"public calls {public_calls} exceed the 25 budget")

provider_delta = after["streamRequests"] - before["streamRequests"]
checks.append(f"provider stream requests delta {provider_delta}")
if provider_delta != 0:
    errors.append(f"S9 must make no provider stream request (delta "
                  f"{provider_delta})")
if after["activeStreamRequests"] != 0:
    errors.append(f"provider active after S9 {after['activeStreamRequests']}")
if int(float(worker_active)) != 0:
    errors.append(f"worker active after S9 {worker_active}")
if int(float(subscribers_after)) != 0:
    errors.append(f"subscribers after S9 {subscribers_after}")

a, peak = analysis["a"], analysis["b"]["same_frame_peak"]
summary = {
    "scenario": name,
    "mode": "FUNCTIONAL_ONLY",
    "performance_conclusions": "NONE",
    "semantics": (
        "real login + session-revocation concurrency on the real public "
        "auth chain: trusted-device login, cross-account owner isolation, "
        "barrier-synchronized login-vs-explicit-revoke (overlap proven on "
        "the actual request windows), revoke-all causality, and the "
        "revoked trusted device returning to TOTP_REQUIRED — status codes, "
        "booleans and exact counts only; no ms threshold and no §19.2 gate"),
    "method": {
        "budget_seconds": s9.get("deadline_seconds"),
        "accounts": "two fresh per-trial synthetic accounts; password "
                    "env-only (committed synthetic pool credential)",
        "overlap_proof": "max(start) < min(end) over the two concurrent "
                         "clients' actual request windows, never thread "
                         "starts",
    },
    "steps": steps,
    "public_calls": public_calls,
    "budget_expired": budget_expired,
    "provider": {"stream_requests_delta": provider_delta,
                 "active_after": after["activeStreamRequests"]},
    "worker_active_after": int(float(worker_active)),
    "worker_peak": int(float(worker_peak)),
    "subscribers_after": int(float(subscribers_after)),
    "cpu_seconds": round(float(cpu_after) - float(cpu_before), 6),
    "window_ab": {
        "a_rss_peak_kb": a["a_rss_peak_kb"],
        "a_pss_peak_kb": a["a_pss_peak_kb"],
        "b_peak_rss_mib": round(peak["b_rss_peak_kb"] / 1024, 3) if peak else None,
        "b_peak_pss_mib": round(peak["b_pss_peak_kb"] / 1024, 3) if peak else None,
        "b_complete_frames": peak["complete_frames"] if peak else 0,
        "b_cpu_status": {c: {"status": cpu["status"], "reason": cpu.get("reason")}
                         for c, cpu in analysis["b"]["components"].items()},
        "b_cpu_component_ns": {c: cpu["cpu_delta_ns"]
                               for c, cpu in analysis["b"]["components"].items()},
    },
    "checks": checks,
    "errors": errors,
}
print(json.dumps(summary, ensure_ascii=False))
if errors:
    for error in errors:
        print(f"G12 assertion failed: {error}", file=sys.stderr)
    raise SystemExit(1)
PY
  then
    die "$name login/revoke assertions failed"
  fi
  python3 - "$summary" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
c, rv = r["steps"]["concurrent"], r["steps"]["revoke_all"]
print(f"  concurrent: overlap {c.get('overlap')} "
      f"(margin {c.get('overlap_margin_ms')} ms); DELETE "
      f"{c.get('delete_status')} then target GET "
      f"{c.get('target_after_status')}; new/a0/b active = "
      f"{c.get('new_active')}/{c.get('a0_active')}/{c.get('b_active')}")
print(f"  revoke-all: {rv.get('status')} revoked={rv.get('revoked')}; "
      f"a0/new next GET {rv.get('a0_after_status')}/"
      f"{rv.get('new_after_status')}; B active {rv.get('b_active')}")
tr = r["steps"]["trusted_revoked"]
print(f"  trusted device: login {tr.get('login_status')} "
      f"{tr.get('next_step')} (session cookie absent: "
      f"{tr.get('session_cookie_absent')}); g12 probe "
      f"{r['steps']['g12_probe'].get('status')}; public calls "
      f"{r.get('public_calls')}")
PY
}

if [ "$PROBE" = "1" ]; then
  if [ "$PROBE_S3" = "1" ]; then
    echo "== probe-s3 functional chain: 1 held generation + 3 silent SSE =="
    run_scenario_s3 probe-s3 "$S3_HOLD_MS" "$S3_QUIET_MS"
    echo "== G12 probe-s3 PASS (FUNCTIONAL_ONLY; artifacts in $RUN_DIR) =="
    cat "$RUN_DIR/probe-s3.summary.json"
    exit 0
  fi
  if [ "$PROBE_S6" = "1" ]; then
    echo "== probe-s6 functional chain: disconnect/reconnect + cancel =="
    run_scenario_s6 probe-s6 "$S6_DELTA_MS"
    echo "== G12 probe-s6 PASS (FUNCTIONAL_ONLY; artifacts in $RUN_DIR) =="
    cat "$RUN_DIR/probe-s6.summary.json"
    exit 0
  fi
  if [ "$PROBE_S9" = "1" ]; then
    echo "== probe-s9 functional chain: real login + session revoke concurrency =="
    run_scenario_s9 probe-s9
    echo "== G12 probe-s9 PASS (FUNCTIONAL_ONLY; artifacts in $RUN_DIR) =="
    cat "$RUN_DIR/probe-s9.summary.json"
    exit 0
  fi
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
run_scenario_s3 s3 "$S3_HOLD_MS" "$S3_QUIET_MS"
run_scenario_s6 s6 "$S6_DELTA_MS"
run_scenario_s9 s9
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
  "$RUN_DIR/s3.summary.json" \
  "$RUN_DIR/s6.summary.json" \
  "$RUN_DIR/s9.summary.json" \
  "$RUN_DIR/s5.summary.json" \
  "$RUN_DIR/s10.summary.json" "$RUN_DIR/soak.summary.json" \
  > "$RUN_DIR/trial.summary.json" <<'PY'
import json, sys
(trial_id, mode, project, cold_ms, idle_cpu, idle_analysis_s, image_bytes_s,
 s4_path, s3_path, s6_path, s9_path, s5_path, s10_path, soak_path) = sys.argv[1:15]
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
    "s3": json.load(open(s3_path)),
    "s6": json.load(open(s6_path)),
    "s9": json.load(open(s9_path)),
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
