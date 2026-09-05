#!/usr/bin/env bash
# S0-23 E2E local stack: one isolated PostgreSQL + a local OpenAI-compatible
# provider + companiond + the H5 vite dev server. Synthetic data only; no
# production credentials exist anywhere in this path. All children are cleaned
# up on exit. NOT part of scripts/check.sh (checks-principles R1: browser E2E
# is an opt-in long check, never the seconds-level daily entry).
#
# Usage:  bash scripts/dev/e2e-stack.sh          # foreground supervisor
#         E2E_STACK_KEEP=1 bash ...              # keep containers for debugging
#         E2E_RELEASE_MODE=synthetic-eval bash ... # exercise isolated BETA, then restore
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

E2E_PG_PORT="${E2E_PG_PORT:-18433}"
E2E_RUNTIME_PORT="${E2E_RUNTIME_PORT:-18080}"
E2E_H5_PORT="${E2E_H5_PORT:-5173}"
E2E_PROVIDER_PORT="${E2E_PROVIDER_PORT:-19090}"
E2E_RELEASE_MODE="${E2E_RELEASE_MODE:-full}"
E2E_MIGRATOR_DB_PASSWORD="e2e-only-migrator-password"
E2E_RUNTIME_DB_PASSWORD="e2e-only-runtime-password"
E2E_RELEASE_POLICY_VERSION="e2e-synthetic-v1"
E2E_MINIO_ACCESS_KEY="e2e-minio-access"
E2E_MINIO_SECRET_KEY="e2e-minio-secret-0123456789"
E2E_MINIO_BUCKET="vc-e2e-exports"
PG_IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
MINIO_IMAGE="minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
MC_IMAGE="minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727"
PG_CONTAINER="vc-e2e-pg-$$"
MINIO_CONTAINER="vc-e2e-minio-$$"
E2E_DOCKER_CONTEXT="${E2E_DOCKER_CONTEXT:-orbstack}"
DOCKER=(docker --context "$E2E_DOCKER_CONTEXT")
E2E_STACK_STATE_FILE="${E2E_STACK_STATE_FILE:-/tmp/vc-e2e-stack-$$.json}"
E2E_AUTH_MATERIAL_FILE="${E2E_STACK_STATE_FILE}.auth.json"
E2E_SECRET_DIR=""
MINIO_MC_SECRET_FILE=""
PROVIDER_LOG="/tmp/vc-e2e-provider-$$.log"
RUNTIME_LOG="/tmp/vc-e2e-runtime-$$.log"
H5_LOG="/tmp/vc-e2e-h5-$$.log"
GO_BINARY="/tmp/vc-e2e-companiond-$$"

case "$E2E_DOCKER_CONTEXT" in
    ""|*[!A-Za-z0-9_.-]*)
        echo "E2E_DOCKER_CONTEXT contains unsupported characters" >&2
        exit 9
        ;;
esac

case "$E2E_RELEASE_MODE" in
    full|synthetic-eval) ;;
    *)
        echo "E2E_RELEASE_MODE must be full or synthetic-eval" >&2
        exit 9
        ;;
esac

write_state() {
    local state_tmp="${E2E_STACK_STATE_FILE}.tmp.$$"
    local provider_pgid="${PROVIDER_PID:-null}"
    local runtime_pgid="${RUNTIME_PID:-null}"
    local h5_pgid="${H5_PID:-null}"
    local keep=false
    [ "${E2E_STACK_KEEP:-0}" = "1" ] && keep=true

    umask 077
    if ! printf '%s\n' \
        "{\"version\":2,\"supervisorPid\":$$,\"processGroups\":{\"provider\":${provider_pgid},\"runtime\":${runtime_pgid},\"h5\":${h5_pgid}},\"container\":\"${PG_CONTAINER}\",\"containers\":[\"${PG_CONTAINER}\",\"${MINIO_CONTAINER}\"],\"dockerContext\":\"${E2E_DOCKER_CONTEXT}\",\"keep\":${keep},\"releaseMode\":\"${E2E_RELEASE_MODE}\",\"releasePolicyVersion\":\"${E2E_RELEASE_POLICY_VERSION}\"}" \
        >"$state_tmp"; then
        return 1
    fi
    mv -f -- "$state_tmp" "$E2E_STACK_STATE_FILE"
}

terminate_group() {
    local leader_pid="${1:-}"
    if [ -n "$leader_pid" ] \
        && { kill -0 -- "-$leader_pid" 2>/dev/null || kill -0 "$leader_pid" 2>/dev/null; }; then
        kill -TERM -- "-$leader_pid" 2>/dev/null || kill -TERM "$leader_pid" 2>/dev/null || true
        for _ in $(seq 1 50); do
            kill -0 -- "-$leader_pid" 2>/dev/null || break
            sleep 0.1
        done
        kill -KILL -- "-$leader_pid" 2>/dev/null || true
        wait "$leader_pid" 2>/dev/null || true
    fi
}

cleanup() {
    if [ "${E2E_STACK_KEEP:-0}" != "1" ]; then
        terminate_group "${H5_PID:-}"
        terminate_group "${RUNTIME_PID:-}"
        terminate_group "${PROVIDER_PID:-}"
        "${DOCKER[@]}" rm -f "$PG_CONTAINER" "$MINIO_CONTAINER" >/dev/null 2>&1 || true
        rm -f -- "$E2E_STACK_STATE_FILE" "${E2E_STACK_STATE_FILE}.tmp.$$" \
            "$E2E_AUTH_MATERIAL_FILE" "$GO_BINARY"
        [ -z "$E2E_SECRET_DIR" ] || rm -rf -- "$E2E_SECRET_DIR"
    else
        echo "keeping stack: pg($PG_CONTAINER) minio($MINIO_CONTAINER) provider(:$E2E_PROVIDER_PORT) runtime(:$E2E_RUNTIME_PORT) h5(:$E2E_H5_PORT)" >&2
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

E2E_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vc-e2e-secrets.XXXXXX")"
MINIO_MC_SECRET_FILE="$E2E_SECRET_DIR/minio-mc"

if ! write_state; then
    echo "failed to create the E2E stack state file" >&2
    exit 9
fi

echo "== build companiond =="
export PATH="/Users/hxf/.local/go/bin:$PATH"
go build -C backend -o "$GO_BINARY" ./cmd/companiond || {
    echo "companiond build failed" >&2
    exit 2
}

echo "== isolated postgres :$E2E_PG_PORT =="
"${DOCKER[@]}" rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
"${DOCKER[@]}" run -d --name "$PG_CONTAINER" \
    -p "127.0.0.1:${E2E_PG_PORT}:5432" \
    -e POSTGRES_PASSWORD=vc-e2e-synthetic \
    -e POSTGRES_DB=vc \
    "$PG_IMAGE" >/dev/null

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

echo "== isolated minio =="
chmod 700 "$E2E_SECRET_DIR"
printf '%s\n%s\n%s\n' \
    "http://127.0.0.1:9000" "$E2E_MINIO_ACCESS_KEY" "$E2E_MINIO_SECRET_KEY" \
    > "$MINIO_MC_SECRET_FILE"
chmod 600 "$MINIO_MC_SECRET_FILE"
"${DOCKER[@]}" rm -f "$MINIO_CONTAINER" >/dev/null 2>&1 || true
"${DOCKER[@]}" run -d --name "$MINIO_CONTAINER" \
    -p 127.0.0.1::9000 \
    -e MINIO_ROOT_USER="$E2E_MINIO_ACCESS_KEY" \
    -e MINIO_ROOT_PASSWORD="$E2E_MINIO_SECRET_KEY" \
    "$MINIO_IMAGE" server /data >/dev/null
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
"${DOCKER[@]}" run --rm --entrypoint /bin/sh \
    --network "container:$MINIO_CONTAINER" \
    -v "$MINIO_MC_SECRET_FILE:/run/secrets/vc-mc:ro" \
    "$MC_IMAGE" -c '
set -eu
{
    IFS= read -r mc_endpoint
    IFS= read -r mc_access_key
    IFS= read -r mc_secret_key
} < /run/secrets/vc-mc
mc alias set local "$mc_endpoint" "$mc_access_key" "$mc_secret_key" >/dev/null
mc mb --ignore-existing "local/$1" >/dev/null
' vc-e2e-mc "$E2E_MINIO_BUCKET"
rm -f -- "$MINIO_MC_SECRET_FILE"
rmdir "$E2E_SECRET_DIR"
E2E_SECRET_DIR=""
MINIO_MC_SECRET_FILE=""

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
    login-return auth-trusted-device relationship-chat realtime-recovery \
    provider-faults accessibility navigation-smoke; do
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
E2E_PROVIDER_PORT="$E2E_PROVIDER_PORT" node scripts/dev/e2e-provider.mjs \
    >"$PROVIDER_LOG" 2>&1 &
PROVIDER_PID=$!
set +m
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

echo "STACK_READY port_pg=$E2E_PG_PORT port_minio=$MINIO_PORT port_provider=$E2E_PROVIDER_PORT port_runtime=$E2E_RUNTIME_PORT port_h5=$E2E_H5_PORT pid_provider=$PROVIDER_PID pid_runtime=$RUNTIME_PID pid_h5=$H5_PID"
while kill -0 "$PROVIDER_PID" 2>/dev/null \
    && kill -0 "$RUNTIME_PID" 2>/dev/null \
    && kill -0 "$H5_PID" 2>/dev/null; do
    sleep 1
done
echo "an e2e stack process exited unexpectedly" >&2
exit 7
