#!/usr/bin/env bash
# S0-23 E2E local stack: one isolated PostgreSQL + a local OpenAI-compatible
# provider + the runtime jar + the H5 vite dev server. Synthetic data only; no
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
PG_IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
PG_CONTAINER="vc-e2e-pg-$$"
E2E_DOCKER_CONTEXT="${E2E_DOCKER_CONTEXT:-orbstack}"
DOCKER=(docker --context "$E2E_DOCKER_CONTEXT")
E2E_STACK_STATE_FILE="${E2E_STACK_STATE_FILE:-/tmp/vc-e2e-stack-$$.json}"
PROVIDER_LOG="/tmp/vc-e2e-provider-$$.log"
RUNTIME_LOG="/tmp/vc-e2e-runtime-$$.log"
H5_LOG="/tmp/vc-e2e-h5-$$.log"

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
        "{\"version\":2,\"supervisorPid\":$$,\"processGroups\":{\"provider\":${provider_pgid},\"runtime\":${runtime_pgid},\"h5\":${h5_pgid}},\"container\":\"${PG_CONTAINER}\",\"dockerContext\":\"${E2E_DOCKER_CONTEXT}\",\"keep\":${keep},\"releaseMode\":\"${E2E_RELEASE_MODE}\",\"releasePolicyVersion\":\"${E2E_RELEASE_POLICY_VERSION}\"}" \
        >"$state_tmp"; then
        return 1
    fi
    mv -f -- "$state_tmp" "$E2E_STACK_STATE_FILE"
}

JAR="$(ls -t service/apps/runtime/target/virtual-companion-runtime-*.jar 2>/dev/null | grep -v '\.original' | head -1)"
if [ -z "$JAR" ]; then
    echo "runtime jar missing; run ./mvnw --batch-mode verify first" >&2
    exit 2
fi

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
        "${DOCKER[@]}" rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
        rm -f -- "$E2E_STACK_STATE_FILE" "${E2E_STACK_STATE_FILE}.tmp.$$"
    else
        echo "keeping stack: pg($PG_CONTAINER) provider(:$E2E_PROVIDER_PORT) runtime(:$E2E_RUNTIME_PORT) h5(:$E2E_H5_PORT)" >&2
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if ! write_state; then
    echo "failed to create the E2E stack state file" >&2
    exit 9
fi

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

echo "== isolated migrator/runtime database roles =="
"${DOCKER[@]}" exec -i \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_DB=vc \
    -e VC_MIGRATOR_DB_PASSWORD="$E2E_MIGRATOR_DB_PASSWORD" \
    -e VC_RUNTIME_DB_PASSWORD="$E2E_RUNTIME_DB_PASSWORD" \
    "$PG_CONTAINER" bash -s \
    < ops/deploy/db-init/01-runtime-roles.sh

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

echo "== runtime :$E2E_RUNTIME_PORT (jar $([ -n "$JAR" ] && basename "$JAR")) =="
# The runtime is built for class-file 69 (Java 25); pick that JVM when present.
JAVA_BIN="${E2E_JAVA:-java}"
for candidate in \
    /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home/bin/java \
    /usr/lib/jvm/java-25-openjdk/bin/java; do
    [ -x "$candidate" ] && JAVA_BIN="$candidate" && break
done
echo "using java: $JAVA_BIN"
# Dev-only synthetic secrets; the production profile would reject these.
export VC_JWT_SECRET="e2e-only-jwt-secret-0123456789abcdef0123456789abcdef"
export VC_OWNER_BINDING_SECRET="e2e-only-owner-binding-secret-0123456789abcdef"
export VC_CRYPTO_REST_KEY="ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="
export VC_AUTH_ENABLED=true
export VC_AUTH_DATASOURCE_ENABLED=true
export VC_ENFORCE_DB_LEAST_PRIVILEGE=true
export VC_SHARED_RATE_LIMIT_ENABLED=true
export VC_SHARED_RATE_LIMIT_SECRET="e2e-only-shared-rate-secret-0123456789abcdef"
export VC_FLYWAY_ENABLED=true
export VC_MIGRATOR_DB_URL="jdbc:postgresql://127.0.0.1:${E2E_PG_PORT}/vc"
export VC_MIGRATOR_DB_USERNAME=vc_migrator
export VC_MIGRATOR_DB_PASSWORD="$E2E_MIGRATOR_DB_PASSWORD"
export VC_DB_URL="$VC_MIGRATOR_DB_URL"
export VC_DB_USERNAME=vc_runtime_login
export VC_DB_PASSWORD="$E2E_RUNTIME_DB_PASSWORD"
export VC_AUTH_COOKIE_SECURE=false
export VC_CORS_ALLOWED_ORIGINS="http://127.0.0.1:${E2E_H5_PORT}"
export VC_ADMIN_USERNAME=e2e-admin
export VC_ADMIN_PASSWORD='E2e-Admin-Pass-1234!'
export VC_ADMIN_DISPLAY_NAME='E2E Platform Admin'
# Both modes exercise the authoritative BETA admission seam. Synthetic eval
# advances only its isolated gate after proving the fail-closed starting state;
# teardown restores SYNTHETIC/eval=false before the database is destroyed.
export VC_BETA_GENERATION_ENABLED=true
export VC_ADMISSION_ENFORCE=true
export VC_ADMISSION_REQUIRED_CONSENTS='SERVICE_TERMS,PRIVACY_POLICY,AI_CONTENT_NOTICE'
# Local HTTP/SSE provider: the dummy token never leaves loopback.
export VC_MODEL_PROVIDERS_ENABLED=true
export VC_MODEL_BUDGET_MONTHLY_USD=100
export VC_MODEL_SECRET_E2E_CRED=e2e-loopback-dummy-token
export VC_EXTERNAL_PROTOCOL=OPENAI_CHAT_COMPLETIONS
export VC_EXTERNAL_TIMEOUT_CONNECT=1s
export VC_EXTERNAL_TIMEOUT_FIRST_TOKEN=2s
export VC_EXTERNAL_TIMEOUT_TOTAL=3s
set -m
"$JAVA_BIN" -jar "$JAR" --server.port="$E2E_RUNTIME_PORT" \
    --virtual-companion.worker.coordinator-poll-delay-ms=250 \
    --virtual-companion.model-providers.deployments[0].provider-id=e2e-openai \
    --virtual-companion.model-providers.deployments[0].protocol=OPENAI_CHAT_COMPLETIONS \
    --virtual-companion.model-providers.deployments[0].supplier-name=e2e-local-provider \
    --virtual-companion.model-providers.deployments[0].model=e2e-model \
    --virtual-companion.model-providers.deployments[0].model-revision=e2e-model-revision-v1 \
    --virtual-companion.model-providers.deployments[0].config-version=e2e-loopback-config-v1 \
    --virtual-companion.model-providers.deployments[0].endpoint="http://127.0.0.1:${E2E_PROVIDER_PORT}/v1/chat/completions" \
    --virtual-companion.model-providers.deployments[0].credential-secret=e2e-cred \
    --virtual-companion.model-providers.deployments[0].enabled=true \
    >"$RUNTIME_LOG" 2>&1 &
RUNTIME_PID=$!
set +m
if ! write_state; then
    echo "failed to update the E2E stack state for runtime" >&2
    exit 9
fi

echo "== waiting for migrations + health =="
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
    # round11（P1-1）：代理断开传播的固定脱敏事件只在 E2E trace 开关下输出。
    export E2E_PROXY_TRACE=1
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

echo "STACK_READY port_pg=$E2E_PG_PORT port_provider=$E2E_PROVIDER_PORT port_runtime=$E2E_RUNTIME_PORT port_h5=$E2E_H5_PORT pid_provider=$PROVIDER_PID pid_runtime=$RUNTIME_PID pid_h5=$H5_PID"
while kill -0 "$PROVIDER_PID" 2>/dev/null \
    && kill -0 "$RUNTIME_PID" 2>/dev/null \
    && kill -0 "$H5_PID" 2>/dev/null; do
    sleep 1
done
echo "an e2e stack process exited unexpectedly" >&2
exit 7
