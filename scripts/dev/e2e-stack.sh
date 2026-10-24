#!/usr/bin/env bash
# Isolated HTTP fixture: host companiond/provider/Vite, disposable PG/MinIO.
# Docker lifecycle uses the existing resources.py creation-receipt engine.
# State v4 records actual CIDs and OS process identities; no name-based rm.
# KEEP and synthetic-eval retain their existing public behavior.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
die() { echo "HTTP E2E FAIL: $*" >&2; exit 1; }
E2E_DOCKER_CONTEXT="${E2E_DOCKER_CONTEXT:-orbstack}"
[ "$E2E_DOCKER_CONTEXT" = orbstack ] || die "only the orbstack context is authorized"
E2E_RELEASE_MODE="${E2E_RELEASE_MODE:-full}"
case "$E2E_RELEASE_MODE" in full|synthetic-eval) ;; *) die "unsupported release mode" ;; esac
while IFS= read -r inherited_runtime_name; do
    case "$inherited_runtime_name" in VC_*) unset "$inherited_runtime_name" || die "cannot isolate inherited runtime settings" ;; esac
done < <(compgen -e)
unset inherited_runtime_name
E2E_PG_PORT="${E2E_PG_PORT:-18433}"
E2E_RUNTIME_PORT="${E2E_RUNTIME_PORT:-18080}"
E2E_H5_PORT="${E2E_H5_PORT:-5173}"
E2E_PROVIDER_PORT="${E2E_PROVIDER_PORT:-19090}"
E2E_MIGRATOR_DB_PASSWORD="e2e-only-migrator-password"
E2E_RUNTIME_DB_PASSWORD="e2e-only-runtime-password"
E2E_RELEASE_POLICY_VERSION="e2e-synthetic-v1"
E2E_MINIO_ACCESS_KEY="e2e-minio-access"
E2E_MINIO_SECRET_KEY="e2e-minio-secret-0123456789"
E2E_MINIO_BUCKET="vc-e2e-exports"
PG_IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
E2E_MINIO_TOOLS_DOCKERFILE="scripts/dev/Dockerfile.e2e-minio-tools"
DOCKER=(docker --context "$E2E_DOCKER_CONTEXT")
export DOCKER_CONTEXT="$E2E_DOCKER_CONTEXT"
umask 077
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vc-e2e-http.XXXXXX")" || die "private run directory failed"
NONCE="$(openssl rand -hex 16)" || die "nonce generation failed"
PROJECT="vce2ehttp-$NONCE"
PG_NAME="$PROJECT-pg"
MINIO_NAME="$PROJECT-minio"
MC_NAME="$PROJECT-minio-init"
PG_VOLUME="${PROJECT}_db-data"
TOOLS_TAG="virtual-companion-e2e-minio:$NONCE"
PG_CONTAINER=""
MINIO_CONTAINER=""
MC_CONTAINER=""
E2E_STACK_STATE_FILE="${E2E_STACK_STATE_FILE:-$RUN_DIR/state.json}"
E2E_AUTH_MATERIAL_FILE="${E2E_STACK_STATE_FILE}.auth.json"
E2E_SECRET_DIR="$RUN_DIR/mc-config"
MINIO_MC_CONFIG_FILE="$E2E_SECRET_DIR/config.json"
E2E_MINIO_TOOLS_IIDFILE="$RUN_DIR/minio-tools.iid"
PROVIDER_LOG="$RUN_DIR/provider.log"
PROVIDER_REQUEST_LOG="$RUN_DIR/provider-requests.jsonl"
RUNTIME_LOG="$RUN_DIR/runtime.log"
H5_LOG="$RUN_DIR/h5.log"
GO_BINARY="$RUN_DIR/companiond"
RESOURCES="$ROOT/scripts/measure/g12-go-capacity/resources.py"
CAPTURE="$RUN_DIR/created-resources.json"
BUILT_IMAGES="$RUN_DIR/built-images.json"
LEFTOVERS="$RUN_DIR/cleanup.leftovers.json"
COLLECTORS="$RUN_DIR/collectors.json"
CREATING="$RUN_DIR/.stack-creating"
PROVIDER_PID=""; RUNTIME_PID=""; H5_PID=""
PROVIDER_STARTED_AT=""; RUNTIME_STARTED_AT=""; H5_STARTED_AT=""
process_start() { ps -o lstart= -p "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
SUPERVISOR_STARTED_AT="$(process_start $$)"
[ -n "$SUPERVISOR_STARTED_AT" ] || die "supervisor OS start time unavailable"
STATE_OWNED=0
write_state() {
    E2E_META_STATE_OWNED="$STATE_OWNED" E2E_META_PID="$$" E2E_META_START="$SUPERVISOR_STARTED_AT" E2E_META_RUN="$RUN_DIR" \
    E2E_META_NONCE="$NONCE" E2E_META_PROJECT="$PROJECT" E2E_META_CONTEXT="$E2E_DOCKER_CONTEXT" \
    E2E_META_KEEP="${E2E_STACK_KEEP:-0}" E2E_META_MODE="$E2E_RELEASE_MODE" \
    E2E_META_PG="$PG_CONTAINER" E2E_META_MINIO="$MINIO_CONTAINER" E2E_META_MC="$MC_CONTAINER" \
    E2E_META_PROVIDER="$PROVIDER_PID" E2E_META_PROVIDER_START="$PROVIDER_STARTED_AT" \
    E2E_META_RUNTIME="$RUNTIME_PID" E2E_META_RUNTIME_START="$RUNTIME_STARTED_AT" \
    E2E_META_H5="$H5_PID" E2E_META_H5_START="$H5_STARTED_AT" \
    E2E_META_REQUEST_LOG="$PROVIDER_REQUEST_LOG" E2E_META_RESOURCES="$RESOURCES" \
    python3 - "$E2E_STACK_STATE_FILE" <<'PY_STATE'
import json,os,sys,tempfile
from pathlib import Path
e=os.environ;r=Path(e['E2E_META_RUN'])
def nullable(name):return e[name] or None
def pid(name):return int(e[name]) if e[name] else None
state={'version':4,'stackKind':'http','supervisorPid':int(e['E2E_META_PID']),
 'supervisorStartedAt':e['E2E_META_START'],'runDir':str(r),'nonce':e['E2E_META_NONCE'],
 'project':e['E2E_META_PROJECT'],'dockerContext':e['E2E_META_CONTEXT'],
 'keep':e['E2E_META_KEEP']=='1','creating':(r/'.stack-creating').exists(),
 'container':nullable('E2E_META_PG'),
 'containers':[e[k] for k in ('E2E_META_PG','E2E_META_MINIO','E2E_META_MC') if e[k]],
 'processGroups':{k:pid('E2E_META_'+k.upper()) for k in ('provider','runtime','h5')},
 'processStarts':{k:nullable('E2E_META_'+k.upper()+'_START') for k in ('provider','runtime','h5')},
 'releaseMode':e['E2E_META_MODE'],'releasePolicyVersion':'e2e-synthetic-v1',
 'providerLogPath':e['E2E_META_REQUEST_LOG'],
 'receipts':{'capture':str(r/'created-resources.json'),'built':str(r/'built-images.json'),
 'leftoversOut':str(r/'cleanup.leftovers.json'),'collectors':str(r/'collectors.json'),
 'resourcesPy':e['E2E_META_RESOURCES']}}
p=Path(sys.argv[1]);fd,name=tempfile.mkstemp(prefix='.'+p.name+'.',dir=p.parent)
t=Path(name)
try:
 with os.fdopen(fd,'w') as f:json.dump(state,f,separators=(',',':'))
 if e['E2E_META_STATE_OWNED']=='1':t.replace(p)
 else:os.link(t,p)
finally:
 try:t.unlink()
 except FileNotFoundError:pass
PY_STATE
    local state_rc=$?
    [ "$state_rc" = 0 ] || return "$state_rc"
    STATE_OWNED=1
}
capture_current() {
    python3 "$RESOURCES" capture --project "$PROJECT" --nonce "$NONCE" --out "$CAPTURE" >>"$RUN_DIR/receipt.log" 2>&1 || return 1
    python3 "$RESOURCES" record-built --out "$BUILT_IMAGES" "$TOOLS_TAG" >>"$RUN_DIR/receipt.log" 2>&1
}
create_container() {
    local service="$1" cid rc
    shift
    cid="$("${DOCKER[@]}" create --label "vc.g12.nonce=$NONCE" \
        --label "com.docker.compose.project=$PROJECT" --label "com.docker.compose.service=$service" \
        "$@" 2>"$RUN_DIR/create-$service.log")"
    rc=$?
    capture_current || return 1
    [ "$rc" = 0 ] || return "$rc"
    case "$cid" in ''|*[!a-f0-9]*) return 1 ;; esac
    [ "${#cid}" = 64 ] || return 1
    printf '%s' "$cid"
}
start_owned() {
    local cid="$1" service="$2"
    python3 - "$RESOURCES" "$CAPTURE" "$cid" "$service" "$PG_VOLUME" <<'PY_START'
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('http_receipts',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
c=json.load(open(sys.argv[2]));entries=c['containers']
if not any(e.get('cid')==sys.argv[3] and e.get('service')==sys.argv[4] and e.get('nonce')==c['nonce'] for e in entries):raise SystemExit('container is not in this run creation receipts')
# Components are created sequentially. Reuse the existing validator for
# all components created so far, including every actual mounted volume.
cfg={'services':{e.get('service'):{} for e in entries},'volumes':{'db-data':{'name':sys.argv[5]}},'networks':{}}
problems=m.verify_start_readiness(cfg,c)
if problems:raise SystemExit('; '.join(problems))
PY_START
    [ $? = 0 ] || return 1
    if [ "${3:-}" = attach ]; then "${DOCKER[@]}" start -a "$cid"; else "${DOCKER[@]}" start "$cid" >/dev/null; fi
}
terminate_group() {
    local leader_pid="${1:-}" expected_start="${2:-}" current_start pgid
    [ -n "$leader_pid" ] || return 0
    if ! kill -0 "$leader_pid" 2>/dev/null; then
        if kill -0 -- "-$leader_pid" 2>/dev/null; then
            echo "process group leader absent; preserving unverifiable group" >&2
            return 1
        fi
        return 0
    fi
    current_start="$(process_start "$leader_pid")"
    pgid="$(ps -o pgid= -p "$leader_pid" | tr -d '[:space:]')"
    if [ -z "$expected_start" ] || [ "$current_start" != "$expected_start" ] || [ "$pgid" != "$leader_pid" ]; then
        echo "process identity differs; no signal sent, records preserved" >&2
        return 1
    fi
    kill -TERM -- "-$leader_pid" 2>/dev/null || return 1
    for _ in $(seq 1 50); do
        kill -0 -- "-$leader_pid" 2>/dev/null || break
        sleep 0.1
    done
    if kill -0 -- "-$leader_pid" 2>/dev/null; then
        [ "$(process_start "$leader_pid")" = "$expected_start" ] || return 1
        [ "$(ps -o pgid= -p "$leader_pid" | tr -d '[:space:]')" = "$leader_pid" ] || return 1
        kill -KILL -- "-$leader_pid" 2>/dev/null || return 1
    fi
    wait "$leader_pid" 2>/dev/null || true
    ! kill -0 -- "-$leader_pid" 2>/dev/null
}
cleanup() {
    local rc=$? failed=0
    if [ "${E2E_STACK_KEEP:-0}" = 1 ] || [ -f "$RUN_DIR/.preserve-stack" ]; then
        echo "keeping HTTP stack: project=$PROJECT run_dir=$RUN_DIR" >&2
        return "$rc"
    fi
    terminate_group "$H5_PID" "$H5_STARTED_AT" || failed=1
    terminate_group "$RUNTIME_PID" "$RUNTIME_STARTED_AT" || failed=1
    terminate_group "$PROVIDER_PID" "$PROVIDER_STARTED_AT" || failed=1
    if [ "$failed" = 0 ] && [ -f "$CREATING" ]; then
        if ! capture_current || ! python3 "$RESOURCES" cleanup --capture "$CAPTURE" \
            --built "$BUILT_IMAGES" --collectors "$COLLECTORS" --collectors-required no \
            --leftovers-out "$LEFTOVERS" --project "$PROJECT" --deadline-seconds 90; then failed=1; fi
    fi
    if [ "$STATE_OWNED" = 1 ]; then
        rm -f -- "$E2E_AUTH_MATERIAL_FILE" "${E2E_STACK_STATE_FILE}.shared-chat.json" \
            "${E2E_STACK_STATE_FILE}.shared-memory.json" "${E2E_STACK_STATE_FILE}.shared-admin.json"
    fi
    if [ "$failed" = 0 ]; then
        if [ "$STATE_OWNED" = 1 ]; then rm -f -- "$E2E_STACK_STATE_FILE"; fi
        rm -f -- "$GO_BINARY" "$E2E_MINIO_TOOLS_IIDFILE" "$MINIO_MC_CONFIG_FILE" "$CREATING"
        [ -z "$E2E_SECRET_DIR" ] || rmdir "$E2E_SECRET_DIR" 2>/dev/null || true
    else
        echo "HTTP cleanup failed; state and receipts kept in $RUN_DIR" >&2
        rc=1
    fi
    exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
if [ "${E2E_HTTP_SOURCE_ONLY:-0}" = 1 ]; then return 0 2>/dev/null || exit 0; fi
mkdir -m 700 "$E2E_SECRET_DIR" || die "private mc config directory failed"
write_state || die "state file creation failed"
echo "HTTP_STACK_STATE state_file=$E2E_STACK_STATE_FILE run_dir=$RUN_DIR project=$PROJECT"
"${DOCKER[@]}" info >/dev/null 2>&1 || die "Docker unreachable"
python3 "$RESOURCES" require-absent --project "$PROJECT" --nonce "$NONCE" \
    --name "$PG_NAME" --name "$MINIO_NAME" --name "$MC_NAME" --name "$PG_VOLUME" --tag "$TOOLS_TAG" \
    || die "expected-absent resource exists or absence was not proven"

echo "== build companiond =="
GOPROXY=off GOTOOLCHAIN=local go build -C backend -mod=vendor -o "$GO_BINARY" ./cmd/companiond || {
    echo "companiond build failed" >&2
    exit 2
}

echo "== isolated postgres :$E2E_PG_PORT =="
touch "$CREATING" || die "creation marker failed"
write_state || die "creation state failed"
"${DOCKER[@]}" volume create --label "vc.g12.nonce=$NONCE" \
    --label "com.docker.compose.project=$PROJECT" "$PG_VOLUME" >"$RUN_DIR/volume-create.log" 2>&1
VOLUME_RC=$?
capture_current || die "volume receipt capture failed"
[ "$VOLUME_RC" = 0 ] || die "database volume creation failed"
PG_CONTAINER="$(create_container pg --name "$PG_NAME" \
    -p "127.0.0.1:${E2E_PG_PORT}:5432" -e POSTGRES_PASSWORD=vc-e2e-synthetic -e POSTGRES_DB=vc \
    --mount "type=volume,source=$PG_VOLUME,target=/var/lib/postgresql" "$PG_IMAGE")" \
    || die "database create failed; no existing container was replaced"
write_state || die "database state failed"
start_owned "$PG_CONTAINER" pg || die "database start refused"

PG_READY=0
for _ in $(seq 1 90); do
    if "${DOCKER[@]}" exec "$PG_CONTAINER" pg_isready -h 127.0.0.1 -U postgres -d vc >/dev/null 2>&1; then
        PG_READY=1
        break
    fi
    sleep 1
done
if [ "$PG_READY" != "1" ]; then
    echo "e2e postgres never became ready; container logs:" >&2
    "${DOCKER[@]}" logs "$PG_CONTAINER" 2>&1 | tail -20 >&2
    exit 5
fi

echo "== build e2e minio tools image =="
# The pinned upstream MinIO/mc OCI images became unobtainable (VC-R19).
# Build the E2E-only scratch image from the same official sha256-pinned
# release binaries and share the resulting immutable image id between the
# MinIO server and the mc bootstrap container. Rebuilds hit the
# content-addressed build cache. The empty stdin context keeps this
# repository and the secret dir out of the build.
"${DOCKER[@]}" build --tag "$TOOLS_TAG" --iidfile "$E2E_MINIO_TOOLS_IIDFILE" \
    - <"$E2E_MINIO_TOOLS_DOCKERFILE" >"$RUN_DIR/minio-build.log" 2>&1
TOOLS_BUILD_RC=$?
capture_current || die "built-image receipt capture failed"
[ "$TOOLS_BUILD_RC" = 0 ] || die "MinIO tools build failed; see $RUN_DIR/minio-build.log"
MINIO_IMAGE="$(cat "$E2E_MINIO_TOOLS_IIDFILE" 2>/dev/null || true)"
MC_IMAGE="$MINIO_IMAGE"
if [ -z "$MINIO_IMAGE" ]; then
    echo "e2e minio tools image build produced no image id" >&2
    exit 5
fi

echo "== isolated minio =="
chmod 700 "$E2E_SECRET_DIR"
# Standard mc config (version 10) for the pinned mc release. The scratch
# image has no shell, so mc consumes this read-only bind instead of the old
# `alias set` script; credentials stay out of argv, logs and image layers.
# Only config.json is bind-mounted: mc also creates auxiliary dirs (share/)
# under its config dir, which land in the ephemeral container layer.
printf '%s\n' \
    '{' \
    '  "version": "10",' \
    '  "aliases": {' \
    '    "e2e": {' \
    '      "url": "http://127.0.0.1:9000",' \
    "      \"accessKey\": \"$E2E_MINIO_ACCESS_KEY\"," \
    "      \"secretKey\": \"$E2E_MINIO_SECRET_KEY\"," \
    '      "api": "S3v4",' \
    '      "path": "auto"' \
    '    }' \
    '  }' \
    '}' \
    > "$MINIO_MC_CONFIG_FILE"
chmod 600 "$MINIO_MC_CONFIG_FILE"
MINIO_CONTAINER="$(create_container minio --name "$MINIO_NAME" \
    -p 127.0.0.1::9000 -e MINIO_ROOT_USER="$E2E_MINIO_ACCESS_KEY" \
    -e MINIO_ROOT_PASSWORD="$E2E_MINIO_SECRET_KEY" "$MINIO_IMAGE" server /data)" \
    || die "MinIO create failed; no existing container was replaced"
write_state || die "MinIO state failed"
start_owned "$MINIO_CONTAINER" minio || die "MinIO start refused"
MINIO_PORT="$("${DOCKER[@]}" port "$MINIO_CONTAINER" 9000/tcp | head -1 | sed 's/.*://')"
case "$MINIO_PORT" in
    ''|*[!0-9]*)
        echo "failed to resolve the isolated MinIO port" >&2
        exit 5
        ;;
esac
MINIO_READY=0
for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${MINIO_PORT}/minio/health/live" >/dev/null 2>&1; then
        MINIO_READY=1
        break
    fi
    sleep 1
done
if [ "$MINIO_READY" != "1" ]; then
    echo "e2e minio never became ready; container logs:" >&2
    "${DOCKER[@]}" logs "$MINIO_CONTAINER" 2>&1 | tail -20 >&2
    exit 5
fi
MC_CONTAINER="$(create_container minio-init --name "$MC_NAME" --entrypoint /bin/mc \
    --network "container:$MINIO_CONTAINER" -e MC_UPDATE=off -e MINIO_UPDATE=off \
    -v "$MINIO_MC_CONFIG_FILE:/mc-config/config.json:ro" \
    "$MC_IMAGE" --config-dir /mc-config mb --ignore-existing "e2e/$E2E_MINIO_BUCKET")" \
    || die "MinIO bootstrap container create failed"
write_state || die "MinIO bootstrap state failed"
start_owned "$MC_CONTAINER" minio-init attach >/dev/null || die "MinIO bucket bootstrap failed"
rm -f -- "$MINIO_MC_CONFIG_FILE"
rmdir "$E2E_SECRET_DIR"
E2E_SECRET_DIR=""
MINIO_MC_CONFIG_FILE=""

echo "== isolated migrator/runtime database roles =="
"${DOCKER[@]}" exec -i \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_DB=vc \
    -e VC_MIGRATOR_DB_PASSWORD="$E2E_MIGRATOR_DB_PASSWORD" \
    -e VC_RUNTIME_DB_PASSWORD="$E2E_RUNTIME_DB_PASSWORD" \
    "$PG_CONTAINER" bash -s \
    < ops/deploy/db-init/01-runtime-roles.sh

echo "== migrate + bootstrap =="
VC_MIGRATE_DB_DSN="postgres://vc_migrator:${E2E_MIGRATOR_DB_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/vc?sslmode=disable" \
    "$GO_BINARY" migrate
VC_BOOTSTRAP_DB_DSN="postgres://vc_migrator:${E2E_MIGRATOR_DB_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/vc?sslmode=disable" \
VC_OWNER_BINDING_SECRET="e2e-only-owner-binding-secret-0123456789abcdef" \
VC_ADMIN_SEED_USERNAME=e2e-admin \
VC_ADMIN_SEED_PASSWORD='E2e-Admin-Pass-1234!' \
VC_ADMIN_SEED_DISPLAY_NAME='E2E Platform Admin' \
    "$GO_BINARY" bootstrap

echo "== seed isolated E2E owner accounts =="
# Go v1 intentionally retired the production admin account-management API.
# Browser journeys still need isolated owners, so seed synthetic-only rows
# directly inside this disposable database instead of restoring a retired
# HTTP surface. The fixed BCrypt value belongs only to the password below.
E2E_USER_PASSWORD_HASH='$2a$10$dduHEOO64z/pmmkp1ZMXieLcGnxQ109z2GTeit189y5vvBMGfcmpe'
E2E_ADMIN_ID="$("${DOCKER[@]}" exec -i "$PG_CONTAINER" \
    psql -U postgres -d vc -Atqc \
    "SELECT id FROM vc.identity_account WHERE username = 'e2e-admin' AND role = 'ADMIN' LIMIT 1")"
case "$E2E_ADMIN_ID" in
    ''|*[!0-9]*)
        echo "failed to resolve the isolated E2E administrator" >&2
        exit 7
        ;;
esac
"${DOCKER[@]}" exec -i "$PG_CONTAINER" \
    psql -U postgres -d vc -v ON_ERROR_STOP=1 -q \
    -v admin_id="$E2E_ADMIN_ID" \
    -v email="e2e-admin@example.test" \
    -f - >/dev/null <<'SQL'
UPDATE vc.identity_account
   SET email = :'email',
       email_verified_at = COALESCE(email_verified_at, now())
 WHERE id = :admin_id;
SQL
for E2E_USER_SUFFIX in \
    login-return auth-trusted-device auth-session-context \
    relationship-chat realtime-recovery \
    provider-faults accessibility navigation-smoke companion-memory; do
    E2E_USERNAME="e2e-user-${E2E_USER_SUFFIX}"
    E2E_EMAIL="${E2E_USERNAME}@example.test"
    "${DOCKER[@]}" exec -i "$PG_CONTAINER" \
        psql -U postgres -d vc -v ON_ERROR_STOP=1 -q \
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
done

echo "== local OpenAI-compatible provider :$E2E_PROVIDER_PORT =="
# Briefly enable job control so this background job becomes a process-group
# leader. Disable it immediately afterward so Ctrl-C still reaches the
# foreground supervisor during readiness checks.
set -m
E2E_PROVIDER_HOST=127.0.0.1 E2E_PROVIDER_REQUEST_LOG="$PROVIDER_REQUEST_LOG" E2E_PROVIDER_PORT="$E2E_PROVIDER_PORT" node scripts/dev/e2e-provider.mjs \
    >"$PROVIDER_LOG" 2>&1 &
PROVIDER_PID=$!
set +m
PROVIDER_STARTED_AT="$(process_start "$PROVIDER_PID")"
[ -n "$PROVIDER_STARTED_AT" ] || die "provider OS start time unavailable"
if ! write_state; then
    echo "failed to update the E2E stack state for provider" >&2
    exit 9
fi
PROVIDER_READY=0
for _ in $(seq 1 30); do
    if ! kill -0 "$PROVIDER_PID" 2>/dev/null; then
        echo "e2e provider exited before readiness; tail of $PROVIDER_LOG:" >&2
        tail -20 "$PROVIDER_LOG" >&2
        exit 6
    fi
    if curl -fsS "http://127.0.0.1:${E2E_PROVIDER_PORT}/health" >/dev/null 2>&1; then
        PROVIDER_READY=1
        break
    fi
    sleep 1
done
if [ "$PROVIDER_READY" != "1" ]; then
    echo "e2e provider never became ready; tail of $PROVIDER_LOG:" >&2
    tail -20 "$PROVIDER_LOG" >&2
    exit 6
fi

echo "== companiond runtime :$E2E_RUNTIME_PORT =="
# Dev-only synthetic secrets and a loopback provider; no credential leaves this host.
export VC_MODE=full
export VC_HTTP_ADDR="127.0.0.1:${E2E_RUNTIME_PORT}"
export VC_HTTP_ORIGINS="http://127.0.0.1:${E2E_H5_PORT}"
export VC_DB_DSN="postgres://vc_runtime_login:${E2E_RUNTIME_DB_PASSWORD}@127.0.0.1:${E2E_PG_PORT}/vc?sslmode=disable"
export VC_OWNER_BINDING_SECRET="e2e-only-owner-binding-secret-0123456789abcdef"
export VC_CRYPTO_REST_KEY="ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="
export VC_EXPORT_S3_ENDPOINT="http://127.0.0.1:${MINIO_PORT}"
export VC_EXPORT_S3_ACCESS_KEY="$E2E_MINIO_ACCESS_KEY"
export VC_EXPORT_S3_SECRET_KEY="$E2E_MINIO_SECRET_KEY"
export VC_EXPORT_S3_BUCKET="$E2E_MINIO_BUCKET"
export VC_HTTP_TRUST_PROXY_HEADERS=false
export VC_SESSION_COOKIE_SECURE=false
export VC_PROVIDER_ENABLED=true
export VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true
export VC_PROVIDER_ID=e2e-openai
export VC_PROVIDER_SUPPLIER_NAME=e2e-local-provider
export VC_PROVIDER_ENDPOINT="http://127.0.0.1:${E2E_PROVIDER_PORT}/v1/chat/completions"
export VC_PROVIDER_TOKEN=e2e-loopback-dummy-token
export VC_PROVIDER_MODEL=e2e-model
export VC_PROVIDER_CONNECT_TIMEOUT=1s
export VC_PROVIDER_FIRST_TOKEN_TIMEOUT=2s
export VC_PROVIDER_TOTAL_TIMEOUT=3s
# 预算超时必须落在供应商超时内；E2E 使用同一组短窗口，既保留超时
# journey 的速度，也满足 Go 运行时的启动不变量。
export VC_BUDGET_CONNECT_TIMEOUT=1s
export VC_BUDGET_FIRST_TOKEN_TIMEOUT=2s
export VC_BUDGET_TOTAL_TIMEOUT=3s
export VC_JOB_RECOVER_INTERVAL=1s
set -m
"$GO_BINARY" >"$RUNTIME_LOG" 2>&1 &
RUNTIME_PID=$!
set +m
RUNTIME_STARTED_AT="$(process_start "$RUNTIME_PID")"
[ -n "$RUNTIME_STARTED_AT" ] || die "runtime OS start time unavailable"
if ! write_state; then
    echo "failed to update the E2E stack state for runtime" >&2
    exit 9
fi

echo "== waiting for health =="
READY=0
for _ in $(seq 1 90); do
    if ! kill -0 "$RUNTIME_PID" 2>/dev/null; then
        echo "runtime exited before readiness; tail of $RUNTIME_LOG:" >&2
        tail -40 "$RUNTIME_LOG" >&2
        exit 3
    fi
    if curl -fsS "http://127.0.0.1:${E2E_RUNTIME_PORT}/actuator/health" >/dev/null 2>&1 \
        || curl -fsS "http://127.0.0.1:${E2E_RUNTIME_PORT}/api/v1/version" >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 2
done
if [ "$READY" != "1" ]; then
    echo "runtime did not become healthy; tail of $RUNTIME_LOG:" >&2
    tail -40 "$RUNTIME_LOG" >&2
    exit 3
fi

echo "== configuring $E2E_RELEASE_MODE release gate + local provider =="
if [ "$E2E_RELEASE_MODE" = "synthetic-eval" ]; then
    : > "$RUN_DIR/.preserve-stack" || die "cannot record pending synthetic-eval restoration"
    "${DOCKER[@]}" exec -i "$PG_CONTAINER" psql -U postgres -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('SYNTHETIC', false, 'e2e-synthetic-v1');
SQL
    DB_GATE_STATUS=$?
    if [ "$DB_GATE_STATUS" -ne 0 ]; then
        echo "failed to establish the synthetic-eval starting release gate" >&2
        exit 8
    fi
    GATE_SNAPSHOT=$("${DOCKER[@]}" exec -i "$PG_CONTAINER" \
        psql -U postgres -d vc -tAc \
        "SELECT out_stage || '|' || CASE WHEN out_eval_passed THEN 'true' ELSE 'false' END || '|' || out_policy_version FROM vc.release_gate_snapshot()")
    if [ "$GATE_SNAPSHOT" != "SYNTHETIC|false|$E2E_RELEASE_POLICY_VERSION" ]; then
        echo "synthetic eval did not start with SYNTHETIC/eval=false" >&2
        exit 8
    fi
    "${DOCKER[@]}" exec -i "$PG_CONTAINER" psql -U postgres -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'e2e-synthetic-v1');
SQL
else
    "${DOCKER[@]}" exec -i "$PG_CONTAINER" psql -U postgres -d vc -v ON_ERROR_STOP=1 -q <<'SQL'
SELECT vc.advance_release_gate('BETA', true, 'e2e-synthetic-v1');
SQL
fi
DB_GATE_STATUS=$?

"${DOCKER[@]}" exec -i "$PG_CONTAINER" psql -U postgres -d vc -v ON_ERROR_STOP=1 -q <<'SQL'

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
DB_PROVIDER_STATUS=$?
if [ "$DB_GATE_STATUS" -ne 0 ] || [ "$DB_PROVIDER_STATUS" -ne 0 ]; then
    echo "failed to configure the isolated release gate/provider registry" >&2
    exit 8
fi
if [ "$E2E_RELEASE_MODE" = "synthetic-eval" ]; then
    GATE_SNAPSHOT=$("${DOCKER[@]}" exec -i "$PG_CONTAINER" \
        psql -U postgres -d vc -tAc \
        "SELECT out_stage || '|' || CASE WHEN out_eval_passed THEN 'true' ELSE 'false' END || '|' || out_policy_version FROM vc.release_gate_snapshot()")
    if [ "$GATE_SNAPSHOT" != "BETA|true|$E2E_RELEASE_POLICY_VERSION" ]; then
        echo "synthetic eval did not enter isolated BETA/eval=true" >&2
        exit 8
    fi
fi

echo "== H5 dev server :$E2E_H5_PORT =="
set -m
(
    cd frontend
    export VITE_PROXY_TARGET="http://127.0.0.1:${E2E_RUNTIME_PORT}"
    exec pnpm exec uni --host 127.0.0.1 --port "$E2E_H5_PORT" --strictPort
) >"$H5_LOG" 2>&1 &
H5_PID=$!
set +m
H5_STARTED_AT="$(process_start "$H5_PID")"
[ -n "$H5_STARTED_AT" ] || die "h5 OS start time unavailable"
if ! write_state; then
    echo "failed to update the E2E stack state for H5" >&2
    exit 9
fi
for _ in $(seq 1 60); do
    if ! kill -0 "$H5_PID" 2>/dev/null; then
        echo "h5 dev server exited before readiness; tail of $H5_LOG:" >&2
        tail -30 "$H5_LOG" >&2
        exit 4
    fi
    if curl -fsS "http://127.0.0.1:${E2E_H5_PORT}/" >/dev/null 2>&1; then
        break
    fi
    sleep 2
done
curl -fsS "http://127.0.0.1:${E2E_H5_PORT}/" >/dev/null || {
    echo "h5 dev server did not start; tail of $H5_LOG:" >&2
    tail -30 "$H5_LOG" >&2
    exit 4
}

echo "STACK_READY port_pg=$E2E_PG_PORT port_minio=$MINIO_PORT port_provider=$E2E_PROVIDER_PORT port_runtime=$E2E_RUNTIME_PORT port_h5=$E2E_H5_PORT pid_provider=$PROVIDER_PID pid_runtime=$RUNTIME_PID pid_h5=$H5_PID state_file=$E2E_STACK_STATE_FILE run_dir=$RUN_DIR project=$PROJECT"
while kill -0 "$PROVIDER_PID" 2>/dev/null \
    && kill -0 "$RUNTIME_PID" 2>/dev/null \
    && kill -0 "$H5_PID" 2>/dev/null; do
    sleep 1
done
echo "an e2e stack process exited unexpectedly" >&2
exit 7
