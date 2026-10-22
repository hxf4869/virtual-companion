#!/usr/bin/env bash
# VC-R79 TLS E2E stack: the production-derived Go-only topology from
# ops/deploy (Caddy TLS edge + companiond + PostgreSQL + MinIO + the journey
# dialect fake provider), rendered privately per run and driven end to end by
# the existing Playwright journeys over real TLS on https://localhost:<port>.
#
# Every run is receipt-owned exactly like the G12 harness (resources.py):
# a fresh nonce is stamped onto every rendered service/volume/network,
# creation is `compose create` (nothing started) followed by an identity
# capture, and cleanup removes only what this run's own create action
# provably produced — no name/time/prefix heuristics, no touching older
# stacks or run directories. Synthetic secrets only; the real ops/deploy
# .env is never read.
#
# The stack itself is the production compose file as-is (docker-compose.yml,
# Dockerfile.web, Caddyfile, backend Dockerfile): no production code,
# compose, or Caddyfile edits. TLS is proven before STACK_READY is printed —
# chain + hostname against this run's own Caddy local CA (public root.crt
# only, fetched from this run's caddy CID), verify result 0, and the real
# negotiated ALPN h2; nothing is downgraded or skipped.
#
# Launched by the Playwright webServer (E2E_STACK_KIND=tls) as
# `exec bash scripts/dev/e2e-tls-stack.sh`, so this process is the group
# leader Playwright signals on gracefulShutdown. SIGTERM runs the receipt
# cleanup synchronously; the Playwright global teardown additionally runs the
# same resources.py cleanup as an idempotent receipt fallback.
#
# NOT part of scripts/check.sh (checks-principles R1/R3: browser E2E is an
# opt-in long check). NO_PERF: no G12 collector, workload, or capacity load
# runs here.
#
# Env: E2E_STACK_STATE_FILE (required), E2E_STACK_KIND=tls (required),
#      E2E_TLS_PORT (default 18457), E2E_DOCKER_CONTEXT (default orbstack),
#      E2E_RELEASE_MODE (must be full), E2E_STACK_KEEP=1 to keep the stack.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

die() { echo "TLS E2E FAIL: $*" >&2; exit 1; }

# Compose gives inherited variables precedence over --env-file. Discard
# production VC_* settings before rendering this synthetic-only stack.
while IFS= read -r inherited_runtime_name; do
    case "$inherited_runtime_name" in
        VC_*) unset "$inherited_runtime_name" || die "cannot isolate inherited runtime settings" ;;
    esac
done < <(compgen -e)
unset inherited_runtime_name

E2E_TLS_PORT="${E2E_TLS_PORT:-18457}"
E2E_DOCKER_CONTEXT="${E2E_DOCKER_CONTEXT:-orbstack}"
PROVIDER_PORT=19090
PROVIDER_LOG_PATH="/tmp/vc-e2e-provider-requests-${PROVIDER_PORT}.log"
E2E_RELEASE_POLICY_VERSION="e2e-synthetic-v1"

case "${E2E_STACK_KIND:-}" in
    tls) ;;
    *) die "E2E_STACK_KIND must be tls for this launcher (got '${E2E_STACK_KIND:-}')" ;;
esac
[ "${E2E_RELEASE_MODE:-full}" = "full" ] \
    || die "the TLS stack only serves full mode (synthetic-eval stays HTTP)"
case "$E2E_DOCKER_CONTEXT" in
    orbstack) ;;
    *) die "only the orbstack docker context is authorized for the TLS E2E stack (got '$E2E_DOCKER_CONTEXT'); this is checked before any daemon request" ;;
esac
case "$E2E_TLS_PORT" in
    ''|*[!0-9]*) die "E2E_TLS_PORT must be an integer" ;;
esac
[ "$E2E_TLS_PORT" -ge 1 ] && [ "$E2E_TLS_PORT" -le 65535 ] \
    || die "E2E_TLS_PORT out of range"
# Keep JSON port metadata and the browser's canonical HTTPS Origin aligned.
E2E_TLS_PORT="$((10#$E2E_TLS_PORT))"
E2E_TLS_ORIGIN="https://localhost"
if [ "$E2E_TLS_PORT" != "443" ]; then
    E2E_TLS_ORIGIN="$E2E_TLS_ORIGIN:$E2E_TLS_PORT"
fi
[ -n "${E2E_STACK_STATE_FILE:-}" ] \
    || die "E2E_STACK_STATE_FILE is required (set by the Playwright config)"
case "$E2E_STACK_STATE_FILE" in
    */*) [ -d "$(dirname "$E2E_STACK_STATE_FILE")" ] \
            || die "E2E_STACK_STATE_FILE directory does not exist" ;;
esac

# Process-scoped docker context for this run and every child (resources.py,
# docker compose): never a global settings change.
export DOCKER_CONTEXT="$E2E_DOCKER_CONTEXT"

# Everything below runs under a private umask: the rendered compose and env
# files interpolate synthetic secrets and must stay 0600, and the run
# directory is private from the moment it is created.
umask 077

G12CAP="$ROOT/scripts/measure/g12-go-capacity"
RESOURCES="$G12CAP/resources.py"
RENDER="$G12CAP/render_stack.py"

# Per-run ownership state: private mktemp directory (never reusing an older
# run's directory), fresh nonce, unique compose project and image tags.
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vc-e2e-tls.XXXXXX")"
chmod 700 "$RUN_DIR"
NONCE="$(openssl rand -hex 16)"
TRIAL_ID="$(printf '%s-%s' "$(date -u +%Y%m%dT%H%M%SZ)" "$$" | tr 'A-Z' 'a-z')"
PROJECT="vce2etls-${TRIAL_ID}"
TRIAL_TAG="$PROJECT-${NONCE:0:8}"
STACK_COMPOSE="$RUN_DIR/stack.compose.json"
ENVFILE="$RUN_DIR/compose.env"
RUNTIME_ENVFILE="$RUN_DIR/runtime.env"
PROVIDER_ENVFILE="$RUN_DIR/provider.env"
CAPTURE="$RUN_DIR/created-resources.json"
BUILT_IMAGES="$RUN_DIR/built-images.json"
CA_FILE="$RUN_DIR/caddy-local-ca.crt"
LEFTOVERS="$RUN_DIR/cleanup.leftovers.json"
COLLECTORS="$RUN_DIR/collectors.json"
# Written right before the one `compose create`; cleanup performs docker
# writes only while it exists, so its presence can only mean THIS run
# attempted creation (the private RUN_DIR was empty at start).
CREATING="$RUN_DIR/.stack-creating"

DB_CID=""
RUNTIME_CID=""
CADDY_CID=""
PROVIDER_CID=""

# OS-level process identity of THIS supervisor (pid + kernel start time).
# The teardown compares it against the live process before signaling, so a
# stale state file or a reused PID can never aim a SIGTERM at a different
# process. Ownership here is the OS answer, not a file or a name.
SUPERVISOR_STARTED_AT="$(ps -o lstart= -p $$ | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
[ -n "$SUPERVISOR_STARTED_AT" ] || die "failed to read this supervisor's OS start time"

# State contract version 3 (consumed by frontend/e2e/global-teardown.ts and
# journeys/12): atomic writes, 0600, updated at every ownership transition —
# startup failures still leave the receipts received so far.
json_or_null() { if [ -n "$1" ]; then printf '"%s"' "$1"; else printf 'null'; fi; }
write_state() {
    local state_tmp="${E2E_STACK_STATE_FILE}.tmp.$$"
    local keep=false creating=false started=false
    [ "${E2E_STACK_KEEP:-0}" = "1" ] && keep=true
    [ -f "$CREATING" ] && creating=true
    [ "$STACK_STARTED" = "1" ] && started=true
    umask 077
    printf '%s\n' \
        "{\"version\":3,\"stackKind\":\"tls\",\"supervisorPid\":$$,\"supervisorStartedAt\":\"${SUPERVISOR_STARTED_AT}\",\"runDir\":\"${RUN_DIR}\",\"nonce\":\"${NONCE}\",\"project\":\"${PROJECT}\",\"httpsPort\":${E2E_TLS_PORT},\"domain\":\"localhost\",\"dockerContext\":\"${E2E_DOCKER_CONTEXT}\",\"keep\":${keep},\"creating\":${creating},\"started\":${started},\"releaseMode\":\"full\",\"releasePolicyVersion\":\"${E2E_RELEASE_POLICY_VERSION}\",\"containers\":{\"db\":$(json_or_null "$DB_CID"),\"runtime\":$(json_or_null "$RUNTIME_CID"),\"caddy\":$(json_or_null "$CADDY_CID"),\"provider\":$(json_or_null "$PROVIDER_CID")},\"providerLogPath\":\"${PROVIDER_LOG_PATH}\",\"receipts\":{\"capture\":\"${CAPTURE}\",\"built\":\"${BUILT_IMAGES}\",\"compose\":\"${STACK_COMPOSE}\",\"leftoversOut\":\"${LEFTOVERS}\",\"collectors\":\"${COLLECTORS}\",\"resourcesPy\":\"${RESOURCES}\"},\"caCert\":\"${CA_FILE}\"}" \
        >"$state_tmp" || return 1
    mv -f -- "$state_tmp" "$E2E_STACK_STATE_FILE"
}
STACK_STARTED=0

cleanup() {
    local rc=$?
    if [ "${E2E_STACK_KEEP:-0}" = "1" ]; then
        echo "keeping TLS stack: project=$PROJECT run_dir=$RUN_DIR (receipts preserved for manual cleanup)" >&2
        exit "$rc"
    fi
    local cleanup_failed=0
    if [ -f "$CREATING" ]; then
        # One actual exit path for everything this run created, under a
        # visible wall-clock bound (90s; the frontend teardown waits 110s
        # before its own fallback, Playwright's gracefulShutdown allows
        # 120s, so this engine call always settles first). The ownership
        # receipts (capture/built/leftovers) are KEPT on every path: the
        # teardown runs the same engine again as an idempotent receipt
        # fallback, and a failed cleanup needs them for recovery.
        if python3 "$RESOURCES" cleanup \
            --capture "$CAPTURE" --built "$BUILT_IMAGES" \
            --collectors "$COLLECTORS" --collectors-required no \
            --leftovers-out "$LEFTOVERS" --project "$PROJECT" \
            --deadline-seconds 90; then
            # Secrets and the interpolated compose file have no consumer
            # after the stack is gone; the receipts above stay.
            rm -f "$ENVFILE" "$RUNTIME_ENVFILE" "$PROVIDER_ENVFILE" \
                "$CA_FILE" "$STACK_COMPOSE" "$CREATING"
        else
            echo "TLS stack cleanup left unproven/unremoved resources (see $LEFTOVERS); records kept in $RUN_DIR" >&2
            cleanup_failed=1
        fi
    fi
    # Session material never outlives the run — removed even when cleanup
    # failed (the state/receipt records themselves stay for recovery).
    rm -f -- "${E2E_STACK_STATE_FILE}.auth.json" \
        "${E2E_STACK_STATE_FILE}.shared-chat.json" \
        "${E2E_STACK_STATE_FILE}.shared-memory.json" \
        "${E2E_STACK_STATE_FILE}.shared-admin.json"
    if [ "$cleanup_failed" = "0" ]; then
        rm -f -- "$E2E_STACK_STATE_FILE" "$E2E_STACK_STATE_FILE.tmp.$$"
    else
        rc=1
    fi
    exit "$rc"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Test seam AFTER cleanup() is defined: lifecycle unit tests source this
# script with E2E_TLS_SOURCE_ONLY=1 and drive the real cleanup() with a
# stubbed engine (the same seam pattern run.sh's G12_SOURCE_ONLY gives the
# G12 tests); nothing below runs in that mode.
if [ "${E2E_TLS_SOURCE_ONLY:-0}" = "1" ]; then
    return 0 2>/dev/null || exit 0
fi

if ! write_state; then
    die "failed to create the TLS stack state file"
fi

echo "== TLS E2E preflight =="
docker info >/dev/null 2>&1 || die "docker unreachable"
[ "$(docker context show)" = "$E2E_DOCKER_CONTEXT" ] \
    || die "docker context must be $E2E_DOCKER_CONTEXT (got $(docker context show))"

# Resource-safety pre-check, all proofs rc0-based (a failed query is not
# "absent"): this run's nonce must not exist anywhere yet, the project label
# must be free, every declared volume/network name must be absent, and no
# trial image tag may pre-exist.
if ! python3 "$RESOURCES" require-absent --project "$PROJECT" --nonce "$NONCE" \
    --name "${PROJECT}_db-data" --name "${PROJECT}_minio-data" \
    --name "${PROJECT}_caddy-data" --name "${PROJECT}_caddy-config" \
    --name "${PROJECT}_default" \
    --tag "virtual-companion-runtime:$TRIAL_TAG" \
    --tag "virtual-companion-minio:$TRIAL_TAG" \
    --tag "virtual-companion-caddy:$TRIAL_TAG"; then
    die "expected-absent resources exist (or absence could not be proven); refusing"
fi

echo "== frontend H5 build (fresh bundle for the production Caddy image) =="
# A stale frontend/dist from an earlier source state must never become this
# run's build evidence: the bundle is rebuilt every run, before the web
# image is built from it. The real rc is captured before any log tail.
pnpm --dir "$ROOT/frontend" build >"$RUN_DIR/frontend-build.log" 2>&1
FRONTEND_BUILD_RC=$?
if [ "$FRONTEND_BUILD_RC" -ne 0 ]; then
    tail -30 "$RUN_DIR/frontend-build.log" >&2 || true
    die "frontend build failed (rc=$FRONTEND_BUILD_RC)"
fi

echo "== synthetic per-run secrets =="
VC_MIGRATOR_DB_PASSWORD="$(openssl rand -hex 32)"
VC_RUNTIME_DB_PASSWORD="$(openssl rand -hex 32)"
VC_CRYPTO_REST_KEY="$(openssl rand -base64 32 | tr -d '\n')"
VC_OWNER_BINDING_SECRET="$(openssl rand -hex 32)"
E2E_MINIO_ACCESS_KEY="$(openssl rand -hex 8)"
E2E_MINIO_SECRET_KEY="$(openssl rand -hex 24)"
cat > "$ENVFILE" <<EOF
VC_MIGRATOR_DB_PASSWORD=$VC_MIGRATOR_DB_PASSWORD
VC_RUNTIME_DB_PASSWORD=$VC_RUNTIME_DB_PASSWORD
VC_OWNER_BINDING_SECRET=$VC_OWNER_BINDING_SECRET
VC_CRYPTO_REST_KEY=$VC_CRYPTO_REST_KEY
VC_DOMAIN=localhost
VC_EXPORT_S3_ACCESS_KEY=$E2E_MINIO_ACCESS_KEY
VC_EXPORT_S3_SECRET_KEY=$E2E_MINIO_SECRET_KEY
VC_EXPORT_S3_BUCKET=vc-e2e-exports
VC_ADMIN_SEED_USERNAME=e2e-admin
VC_ADMIN_SEED_PASSWORD=E2e-Admin-Pass-1234!
VC_ADMIN_SEED_DISPLAY_NAME=E2E Platform Admin
EOF
[ $? -eq 0 ] || die "failed to write the compose env file"
# Journey dialect: the same short provider/budget timeouts and loopback
# endpoint semantics as scripts/dev/e2e-stack.sh. VC_HTTP_ORIGINS carries the
# actual published TLS port (the port is never part of VC_DOMAIN, which
# stays the bare hostname Caddy serves); VC_SESSION_COOKIE_SECURE keeps its
# production compose value "true".
cat > "$RUNTIME_ENVFILE" <<EOF
VC_HTTP_ORIGINS=$E2E_TLS_ORIGIN
VC_PROVIDER_ENABLED=true
VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true
VC_PROVIDER_ID=e2e-openai
VC_PROVIDER_SUPPLIER_NAME=e2e-local-provider
VC_PROVIDER_ENDPOINT=http://127.0.0.1:$PROVIDER_PORT/v1/chat/completions
VC_PROVIDER_TOKEN=e2e-loopback-dummy-token
VC_PROVIDER_MODEL=e2e-model
VC_PROVIDER_CONNECT_TIMEOUT=1s
VC_PROVIDER_FIRST_TOKEN_TIMEOUT=2s
VC_PROVIDER_TOTAL_TIMEOUT=3s
VC_BUDGET_CONNECT_TIMEOUT=1s
VC_BUDGET_FIRST_TOKEN_TIMEOUT=2s
VC_BUDGET_TOTAL_TIMEOUT=3s
VC_JOB_RECOVER_INTERVAL=1s
EOF
[ $? -eq 0 ] || die "failed to write the runtime env file"
# The journey provider keeps its own dialect (request log at a fixed
# container path, no G12 timing knobs) inside the runtime network
# namespace; the log path is part of the state contract for journey 12.
cat > "$PROVIDER_ENVFILE" <<EOF
E2E_PROVIDER_REQUEST_LOG=$PROVIDER_LOG_PATH
EOF
[ $? -eq 0 ] || die "failed to write the provider env file"

echo "== render trial stack from ops/deploy =="
python3 "$RENDER" --project "$PROJECT" --env-file "$ENVFILE" \
    --out "$STACK_COMPOSE" --repo-root "$ROOT" --tag "$TRIAL_TAG" \
    --https-port "$E2E_TLS_PORT" --fake-provider-port "$PROVIDER_PORT" \
    --runtime-env "$RUNTIME_ENVFILE" \
    --provider-script "scripts/dev/e2e-provider.mjs" \
    --provider-env "$PROVIDER_ENVFILE" \
    --nonce "$NONCE" > "$RUN_DIR/render.summary.json" \
    || die "stack render/validation failed"
cat "$RUN_DIR/render.summary.json"

COMPOSE=(docker compose --env-file "$ENVFILE" -f "$STACK_COMPOSE" -p "$PROJECT")

# Every preflight and render check has passed: mark the run as creating —
# cleanup() only performs docker writes while this marker exists.
touch "$CREATING" || die "failed to mark the run as creating"
if ! write_state; then
    die "failed to update the TLS stack state file for creation"
fi

echo "== build + create stack (nothing started) =="
# --no-recreate: create must never touch a pre-existing container — foreign
# objects are refused at the start gate, not silently adopted or replaced.
# The real rc is captured before any log tail.
"${COMPOSE[@]}" create --build --no-recreate > "$RUN_DIR/create.log" 2>&1
CREATE_STATUS=$?
# Creation receipts BEFORE anything starts: the exact identities this run's
# create action produced (containers with real mounts, volumes, networks) —
# partial creates included, so a mid-creation failure still leaves receipts.
python3 "$RESOURCES" capture --project "$PROJECT" --nonce "$NONCE" \
    --out "$CAPTURE" || die "created-inventory capture failed"
python3 "$RESOURCES" record-built --out "$BUILT_IMAGES" \
    "virtual-companion-runtime:$TRIAL_TAG" \
    "virtual-companion-minio:$TRIAL_TAG" \
    "virtual-companion-caddy:$TRIAL_TAG" \
    || die "built-image identity recording failed"
if [ "$CREATE_STATUS" -ne 0 ]; then
    tail -40 "$RUN_DIR/create.log" >&2 || true
    die "stack create/build failed (rc=$CREATE_STATUS)"
fi

# Pre-start completeness gate: every rendered service (one-shots and the
# fake provider included), declared volume/network, and every volume a
# receipted container actually mounts must carry this run's nonce receipt.
if ! python3 "$RESOURCES" verify-start --compose "$STACK_COMPOSE" \
    --capture "$CAPTURE"; then
    die "start refused: rendered resources are not all proven created by this run"
fi

echo "== start stack (verified existing containers only) =="
"${COMPOSE[@]}" up -d --no-build --no-recreate > "$RUN_DIR/up.log" 2>&1
UP_RC=$?
if [ "$UP_RC" -ne 0 ]; then
    tail -40 "$RUN_DIR/up.log" >&2 || true
    die "stack start failed (rc=$UP_RC)"
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
for E2E_SVC in migrate bootstrap minio-init; do
    E2E_SVC_STATE="$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' \
        "$("${COMPOSE[@]}" ps -aq "$E2E_SVC")" 2>/dev/null || true)"
    [ "$E2E_SVC_STATE" = "exited 0" ] \
        || die "$E2E_SVC state: ${E2E_SVC_STATE:-unresolvable} (want exited 0)"
done
echo "  db healthy; migrate/bootstrap/minio-init exited 0"

# Resolve the service CIDs from THIS run's creation receipts (the compose
# service label on the captured containers), never by name or time.
cid_of() {
    python3 - "$CAPTURE" "$1" <<'PY'
import json, sys
capture = json.load(open(sys.argv[1]))
wanted = sys.argv[2]
hits = [c["cid"] for c in capture.get("containers", [])
        if c.get("service") == wanted and c.get("cid")]
if len(hits) != 1:
    raise SystemExit(f"expected exactly one receipted container for service "
                     f"{wanted}, found {len(hits)}")
print(hits[0])
PY
}
DB_CID="$(cid_of db)" || die "db container receipt missing from this run's capture"
RUNTIME_CID="$(cid_of runtime)" || die "runtime container receipt missing"
CADDY_CID="$(cid_of caddy)" || die "caddy container receipt missing"
PROVIDER_CID="$(cid_of fake-provider)" || die "fake-provider container receipt missing"
if ! write_state; then
    die "failed to update the TLS stack state file with container receipts"
fi

echo "== seed: release gate / provider / E2E accounts (vc_migrator) =="
psql_exec() { "${COMPOSE[@]}" exec -T db psql -U vc_migrator -d vc "$@"; }
psql_exec -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'e2e-synthetic-v1');
INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
VALUES ('e2e-openai', 'OPENAI_CHAT_COMPLETIONS', '{}', 'ADMITTED')
ON CONFLICT (provider_id) DO UPDATE
   SET admission_state = 'ADMITTED', protocol = 'OPENAI_CHAT_COMPLETIONS';
INSERT INTO vc.model_unit_price(
    provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k,
    effective_from, active)
VALUES ('e2e-openai', 'e2e-model', 1, 0.001, 0.002, now(), true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
SQL
[ $? -eq 0 ] || die "failed to configure the isolated release gate/provider registry"

# Go v1 retired the production admin account-management API, so the isolated
# E2E accounts are seeded directly in this disposable database, exactly like
# scripts/dev/e2e-stack.sh — same synthetic accounts, same fixed BCrypt hash
# (belongs only to the pool password below), executed as the cluster's
# vc_migrator role instead of a dev postgres superuser.
E2E_USER_PASSWORD_HASH='$2a$10$dduHEOO64z/pmmkp1ZMXieLcGnxQ109z2GTeit189y5vvBMGfcmpe'
E2E_ADMIN_ID="$(psql_exec -Atqc \
    "SELECT id FROM vc.identity_account WHERE username = 'e2e-admin' AND role = 'ADMIN' LIMIT 1")"
case "$E2E_ADMIN_ID" in
    ''|*[!0-9]*) die "failed to resolve the isolated E2E administrator" ;;
esac
psql_exec -v ON_ERROR_STOP=1 -q \
    -v admin_id="$E2E_ADMIN_ID" \
    -v email="e2e-admin@example.test" \
    -f - >/dev/null <<'SQL'
UPDATE vc.identity_account
   SET email = :'email',
       email_verified_at = COALESCE(email_verified_at, now())
 WHERE id = :admin_id;
SQL
[ $? -eq 0 ] || die "failed to set the isolated E2E admin email"
for E2E_USER_SUFFIX in \
    login-return auth-trusted-device relationship-chat realtime-recovery \
    provider-faults accessibility navigation-smoke companion-memory; do
    E2E_USERNAME="e2e-user-${E2E_USER_SUFFIX}"
    E2E_EMAIL="${E2E_USERNAME}@example.test"
    psql_exec -v ON_ERROR_STOP=1 -q \
        -v admin_id="$E2E_ADMIN_ID" \
        -v username="$E2E_USERNAME" \
        -v email="$E2E_EMAIL" \
        -v password_hash="$E2E_USER_PASSWORD_HASH" \
        -v display_name="E2E 用户 ${E2E_USER_SUFFIX}" \
        -f - >/dev/null <<'SQL'
SELECT vc.identity_account_create(
    :admin_id,
    :'username',
    :'password_hash',
    'USER',
    :'display_name'
)
WHERE NOT EXISTS (
    SELECT 1 FROM vc.identity_account WHERE username = :'username'
);
UPDATE vc.identity_account
   SET email = :'email',
       email_verified_at = COALESCE(email_verified_at, now()),
       status = 'ACTIVE'
 WHERE username = :'username';
SQL
    [ $? -eq 0 ] || die "failed to seed the isolated E2E account $E2E_USERNAME"
done

echo "== TLS proof before STACK_READY =="
# Fetch the public root certificate of THIS run's Caddy local CA from this
# run's caddy container (public material only; the private key is never
# read, copied, or printed). It is used strictly as an explicit --cacert.
CA_READY=0
for _ in $(seq 1 60); do
    if docker exec "$CADDY_CID" \
        cat /data/caddy/pki/authorities/local/root.crt > "$CA_FILE" 2>/dev/null \
        && [ -s "$CA_FILE" ]; then
        CA_READY=1
        break
    fi
    sleep 1
done
[ "$CA_READY" = "1" ] || die "could not read this run's Caddy local root CA"
chmod 600 "$CA_FILE"

E2E_TLS_BASE="$E2E_TLS_ORIGIN"
# Chain + hostname: curl verifies the leaf against --cacert and the URL host
# (localhost); rc!=0 or a non-UP body fails the run.
TLS_READY=0
for _ in $(seq 1 120); do
    if curl -fsS --cacert "$CA_FILE" --max-time 5 \
        "$E2E_TLS_BASE/actuator/health" 2>/dev/null | grep -q '"UP"'; then
        TLS_READY=1
        break
    fi
    sleep 0.5
done
[ "$TLS_READY" = "1" ] || die "caddy TLS health did not come up verified"
# Explicit certificate verification evidence (0 = verified) on the real SPA
# origin, plus the SPA shell itself answering 200 through TLS.
TLS_VERIFY="$(curl -sS -o /dev/null -w '%{ssl_verify_result}' \
    --cacert "$CA_FILE" --max-time 5 "$E2E_TLS_BASE/" || echo failed)"
[ "$TLS_VERIFY" = "0" ] \
    || die "TLS certificate verification result was '$TLS_VERIFY' (want 0)"
curl -fsS --cacert "$CA_FILE" --max-time 5 "$E2E_TLS_BASE/" >/dev/null \
    || die "the SPA shell did not answer through TLS"
# Real ALPN h2: the request itself must travel HTTP/2. Anything else (1.1)
# is a silent downgrade and fails the run.
TLS_HTTP_VERSION="$(curl -fsS -o /dev/null -w '%{http_version}' \
    --cacert "$CA_FILE" --max-time 5 "$E2E_TLS_BASE/actuator/health" || echo failed)"
[ "$TLS_HTTP_VERSION" = "2" ] \
    || die "negotiated HTTP version was '$TLS_HTTP_VERSION' (want 2 / ALPN h2; no downgrade)"
echo "  verified TLS: chain+hostname ok (result 0), ALPN h2, health UP, SPA 200"

STACK_STARTED=1
if ! write_state; then
    die "failed to update the TLS stack state file for readiness"
fi

echo "STACK_READY kind=tls url=$E2E_TLS_BASE project=$PROJECT run_dir=$RUN_DIR db=$DB_CID runtime=$RUNTIME_CID caddy=$CADDY_CID provider=$PROVIDER_CID provider_log=$PROVIDER_LOG_PATH"

# Supervise: an unexpected stack exit fails the run (Playwright then reports
# the webServer exiting early). Anchors are this run's receipted CIDs.
while :; do
    sleep 2
    for E2E_ANCHOR in "$RUNTIME_CID" "$CADDY_CID"; do
        if [ "$(docker inspect -f '{{.State.Running}}' "$E2E_ANCHOR" 2>/dev/null \
            || echo false)" != "true" ]; then
            die "stack container $E2E_ANCHOR exited unexpectedly"
        fi
    done
done
