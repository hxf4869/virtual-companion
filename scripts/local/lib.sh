# Shared by scripts/local/dev.sh. Do not execute directly.
VC_PROD_SSH_ALIAS_DEFAULT=hxf4869
RERANK_BYTES=635676416
RERANK_SHA=a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3
PROJECT=vc-local-dev

LOCAL_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$LOCAL_DIR/../.." && pwd)

usage() {
    cat >&2 <<'EOF'
用法: bash scripts/local/dev.sh <命令>

  up
  down
  status
  logs <服务>
  rebuild <st|runtime|all>
  reset --confirm WIPE-LOCAL-DATA
  sync-from-prod [--plan | --from-dir 目录]
EOF
}

in_test() {
    [[ "${VC_LOCAL_TEST:-}" == "1" && -n "${VC_LOCAL_DOCKER:-}" ]]
}

common_init() {
    DOCKER=${VC_LOCAL_DOCKER:-docker}
    STATE=${VC_LOCAL_STATE:-$HOME/.virtual-companion-local}
}

compose() {
    "$DOCKER" compose \
        --project-name "$PROJECT" \
        --env-file "$STATE/compose.env" \
        -f "$ROOT/ops/deploy/v2/compose.yaml" \
        -f "$ROOT/ops/local/compose.override.yaml" \
        "$@"
}

mode_of() {
    stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"
}

write_600() {
    local dest="$1" tmp
    tmp=$(mktemp "$STATE/.write.XXXXXX")
    cat > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$dest"
}

env_set() {
    local file="$1" tmp
    tmp=$(mktemp "$STATE/.env.XXXXXX")
    if [[ -f "$file" ]]; then
        KEY="$2" VALUE="$3" awk '
            BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; found = 0 }
            {
                pos = index($0, "=")
                if (pos > 0 && substr($0, 1, pos - 1) == k) {
                    print k "=" v
                    found = 1
                    next
                }
                print
            }
            END { if (!found) print k "=" v }
        ' "$file" > "$tmp"
    else
        KEY="$2" VALUE="$3" awk 'BEGIN { print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }' > "$tmp"
    fi
    chmod 600 "$tmp"
    mv "$tmp" "$file"
}

env_unset() {
    local file="$1" tmp
    [[ -f "$file" ]] || return 0
    tmp=$(mktemp "$STATE/.env.XXXXXX")
    KEY="$2" awk '
        BEGIN { k = ENVIRON["KEY"] }
        {
            pos = index($0, "=")
            if (pos > 0 && substr($0, 1, pos - 1) == k) next
            print
        }
    ' "$file" > "$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$file"
}

aes_key_ok() {
    local n
    n=$(printf '%s' "$1" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' ') || return 1
    [[ "$n" == "32" ]]
}

load_local() {
    local file="$STATE/local.env" line key val
    [[ -f "$file" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        case "$line" in
            ''|\#*) continue ;;
        esac
        key=${line%%=*}
        val=${line#*=}
        case "$key" in
            VC_LOCAL_HTTP_PORT|VC_PROD_SSH_ALIAS|VC_EMBEDDING_VOLUME|VC_EMBEDDING_SUBPATH|VC_RERANK_MODELS_DIR|VC_RERANK_THREADS)
                if [[ -z "${!key:-}" ]]; then
                    printf -v "$key" '%s' "$val"
                fi
                ;;
        esac
    done < "$file"
}

apply_defaults() {
    load_local
    VC_LOCAL_HTTP_PORT=${VC_LOCAL_HTTP_PORT:-11080}
    VC_PROD_SSH_ALIAS=${VC_PROD_SSH_ALIAS:-$VC_PROD_SSH_ALIAS_DEFAULT}
    VC_EMBEDDING_SUBPATH=${VC_EMBEDDING_SUBPATH:-models}
    VC_RERANK_THREADS=${VC_RERANK_THREADS:-4}
}

check_port_collision() {
    local line val
    [[ "$VC_LOCAL_HTTP_PORT" =~ ^[0-9]+$ ]] || { echo "端口无效" >&2; exit 1; }
    [[ -f "$ROOT/.vc-wt.env" ]] || return 0
    while IFS= read -r line; do
        case "$line" in
            VC_*PORT=*)
                val=${line#*=}
                val=${val%%#*}
                val=${val//[[:space:]]/}
                if [[ "$val" == "$VC_LOCAL_HTTP_PORT" ]]; then
                    echo "端口与受管环境冲突" >&2
                    exit 1
                fi
                ;;
        esac
    done < "$ROOT/.vc-wt.env"
}

discover_models() {
    local cand mounts line
    if [[ -z "${VC_RERANK_MODELS_DIR:-}" ]]; then
        for cand in \
            "$HOME/.local/share/virtual-companion/rerank" \
            "$HOME/.local/share/virtual-companion" \
            "$HOME/models"
        do
            if [[ -f "$cand/bge-reranker-v2-m3-Q8_0.gguf" ]]; then
                VC_RERANK_MODELS_DIR=$cand
                break
            fi
        done
    fi
    if [[ -z "${VC_RERANK_MODELS_DIR:-}" ]]; then
        mounts=$("$DOCKER" inspect vc-rerank --format '{{range .Mounts}}{{.Destination}}={{.Source}}{{"\n"}}{{end}}' 2>/dev/null || true)
        while IFS= read -r line; do
            case "$line" in
                /models=*) VC_RERANK_MODELS_DIR=${line#/models=} ;;
            esac
        done <<< "$mounts"
    fi
    if [[ -z "${VC_EMBEDDING_VOLUME:-}" ]]; then
        if "$DOCKER" run --rm -v vc-w08-ollama-models:/data:ro alpine:3.23.3 \
            test -f /data/models/manifests/registry.ollama.ai/library/qwen3-embedding/0.6b
        then
            VC_EMBEDDING_VOLUME=vc-w08-ollama-models
            VC_EMBEDDING_SUBPATH=models
        elif [[ -f "$HOME/.ollama/models/manifests/registry.ollama.ai/library/qwen3-embedding/0.6b" ]]; then
            VC_EMBEDDING_VOLUME=vc-local-dev-embedding-models
            VC_EMBEDDING_SUBPATH=.
            "$DOCKER" volume create --driver local \
                --opt type=none --opt o=bind \
                --opt device="$HOME/.ollama/models" \
                vc-local-dev-embedding-models >/dev/null
        fi
    fi
}

validate_models() {
    local gguf size got dir
    dir=${VC_RERANK_MODELS_DIR:-$HOME/.local/share/virtual-companion/rerank}
    gguf="$dir/bge-reranker-v2-m3-Q8_0.gguf"
    if [[ ! -f "$gguf" ]]; then
        echo "缺少重排模型 bge-reranker-v2-m3-Q8_0.gguf" >&2
        echo "curl -fL --output \"${dir}/bge-reranker-v2-m3-Q8_0.gguf\" https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q8_0.gguf" >&2
        exit 1
    fi
    VC_RERANK_MODELS_DIR=$dir
    size=$(stat -f '%z' "$gguf" 2>/dev/null || stat -c '%s' "$gguf")
    if [[ "$size" != "$RERANK_BYTES" ]]; then
        echo "重排模型大小不符" >&2
        exit 1
    fi
    if [[ -f "${gguf}.sha256" ]]; then
        got=$(awk 'NR==1 { print $1 }' "${gguf}.sha256")
        if [[ "$got" != "$RERANK_SHA" ]]; then
            echo "重排模型校验不符" >&2
            exit 1
        fi
    fi
    if [[ -z "${VC_EMBEDDING_VOLUME:-}" ]]; then
        echo "缺少嵌入模型 qwen3-embedding:0.6b" >&2
        echo "docker run --rm -v vc-local-dev-embedding-models:/root/.ollama ollama/ollama:0.33.2 pull qwen3-embedding:0.6b" >&2
        exit 1
    fi
    if ! "$DOCKER" volume inspect "$VC_EMBEDDING_VOLUME" >/dev/null 2>&1; then
        echo "嵌入模型卷不存在" >&2
        echo "docker run --rm -v ${VC_EMBEDDING_VOLUME}:/root/.ollama ollama/ollama:0.33.2 pull qwen3-embedding:0.6b" >&2
        exit 1
    fi
}

init_secrets() {
    [[ -f "$STATE/runtime.env" ]] && return 0
    local pg_pass runtime_pass minio_pass minio_user admin_pass binding crypto token mc_token cb_token
    pg_pass=$(openssl rand -hex 24 | tr -d '\n')
    runtime_pass=$(openssl rand -hex 24 | tr -d '\n')
    minio_pass=$(openssl rand -hex 24 | tr -d '\n')
    minio_user="vc$(openssl rand -hex 6 | tr -d '\n')"
    admin_pass=$(openssl rand -hex 24 | tr -d '\n')
    binding=$(openssl rand -hex 32 | tr -d '\n')
    crypto=$(openssl rand -base64 32 | tr -d '\n')
    token=$(openssl rand -hex 32 | tr -d '\n')
    mc_token=$(openssl rand -hex 32 | tr -d '\n')
    cb_token=$(openssl rand -hex 32 | tr -d '\n')
    write_600 "$STATE/admin.password" <<EOF
${admin_pass}
EOF
    write_600 "$STATE/admin.username" <<EOF
owner
EOF
    write_600 "$STATE/db.env" <<EOF
POSTGRES_USER=vc_migrator
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=vc
VC_RUNTIME_DB_PASSWORD=${runtime_pass}
EOF
    write_600 "$STATE/migrate.env" <<EOF
VC_MIGRATE_DB_DSN=postgres://vc_migrator:${pg_pass}@db:5432/vc?sslmode=disable
EOF
    write_600 "$STATE/bootstrap.env" <<EOF
VC_BOOTSTRAP_DB_DSN=postgres://vc_migrator:${pg_pass}@db:5432/vc?sslmode=disable
VC_OWNER_BINDING_SECRET=${binding}
VC_ADMIN_SEED_USERNAME=owner
VC_ADMIN_SEED_PASSWORD=${admin_pass}
VC_ADMIN_SEED_DISPLAY_NAME=管理员
EOF
    write_600 "$STATE/runtime.env" <<EOF
VC_MODE=full
VC_HTTP_ADDR=127.0.0.1:8095
VC_HTTP_ORIGINS=http://127.0.0.1:${VC_LOCAL_HTTP_PORT}
VC_LOG_LEVEL=info
VC_DB_DSN=postgres://vc_runtime_login:${runtime_pass}@db:5432/vc?sslmode=disable
VC_OWNER_BINDING_SECRET=${binding}
VC_CRYPTO_REST_KEY=${crypto}
VC_CRYPTO_REST_KEY_ID=default
VC_CRYPTO_REST_KEY_VERSION=1
VC_EXPORT_S3_ENDPOINT=http://minio:9000
VC_EXPORT_S3_ACCESS_KEY=${minio_user}
VC_EXPORT_S3_SECRET_KEY=${minio_pass}
VC_EXPORT_S3_BUCKET=vc-exports
VC_ST_PLUGIN_SERVICE_TOKEN=${token}
VC_ST_HOST_BASE_URL=http://127.0.0.1:8752
VC_MEMORYCORE_BASE_URL=http://127.0.0.1:8754
VC_MEMORYCORE_SERVICE_TOKEN=${mc_token}
VC_MEMORYCORE_CALLBACK_TOKEN=${cb_token}
VC_RESTORE_GATE_FILE=/vc-data/restore-gate.json
VC_SESSION_COOKIE_SECURE=false
EOF
    write_600 "$STATE/st.env" <<EOF
VC_ST_GO_BASE_URL=http://127.0.0.1:8095
VC_ST_PLUGIN_SERVICE_TOKEN=${token}
VC_ST_ACCOUNT_HANDLES={"1":"owner"}
EOF
    write_600 "$STATE/memorycore.env" <<EOF
VC_MEMORYCORE_SERVICE_TOKEN=${mc_token}
VC_MEMORYCORE_CALLBACK_TOKEN=${cb_token}
VC_MEMORYCORE_CALLBACK_BASE_URL=http://127.0.0.1:8095
EOF
    write_600 "$STATE/minio.env" <<EOF
MINIO_ROOT_USER=${minio_user}
MINIO_ROOT_PASSWORD=${minio_pass}
EOF
    write_600 "$STATE/minio-init.env" <<EOF
VC_EXPORT_S3_ACCESS_KEY=${minio_user}
VC_EXPORT_S3_SECRET_KEY=${minio_pass}
VC_EXPORT_S3_BUCKET=vc-exports
MC_CONFIG_DIR=/mc-config
EOF
}

write_local_env() {
    write_600 "$STATE/local.env" <<EOF
VC_LOCAL_HTTP_PORT=${VC_LOCAL_HTTP_PORT}
VC_PROD_SSH_ALIAS=${VC_PROD_SSH_ALIAS}
VC_EMBEDDING_VOLUME=${VC_EMBEDDING_VOLUME}
VC_EMBEDDING_SUBPATH=${VC_EMBEDDING_SUBPATH}
VC_RERANK_MODELS_DIR=${VC_RERANK_MODELS_DIR}
VC_RERANK_THREADS=${VC_RERANK_THREADS}
EOF
}

write_compose_env() {
    write_600 "$STATE/compose.env" <<EOF
VC_IMAGE_TAG=local
VC_PUBLIC_HOST=127.0.0.1
VC_EDGE_SUBNET=172.31.218.0/24
VC_EDGE_INGRESS_IP=172.31.218.10
VC_EMBEDDING_IMAGE=ollama/ollama:0.33.2
VC_EMBEDDING_MODELS_DIR=/var/empty
VC_EMBEDDING_VOLUME=${VC_EMBEDDING_VOLUME}
VC_EMBEDDING_SUBPATH=${VC_EMBEDDING_SUBPATH}
VC_RERANK_MODELS_DIR=${VC_RERANK_MODELS_DIR}
VC_RERANK_THREADS=${VC_RERANK_THREADS}
VC_LOCAL_HTTP_PORT=${VC_LOCAL_HTTP_PORT}
VC_LOCAL_BIND=127.0.0.1:${VC_LOCAL_HTTP_PORT}:8080
VC_LOCAL_STATE=${STATE}
VC_REPO_ROOT=${ROOT}
VC_ST_BUILD_CONTEXT=${VC_ST_BUILD_CONTEXT:-$ROOT}
EOF
}

write_ingress() {
    sed 's|proxy_set_header X-Forwarded-Proto https;|proxy_set_header X-Forwarded-Proto $scheme;|' \
        "$ROOT/ops/deploy/v2/ingress.conf" > "$STATE/ingress.conf"
    chmod 644 "$STATE/ingress.conf"
    grep -q 'proxy_set_header X-Forwarded-Proto $scheme;' "$STATE/ingress.conf"
}

write_config() {
    local port="$VC_LOCAL_HTTP_PORT"
    cat > "$STATE/config.yaml" <<EOF
{
  "dataRoot": "/srv/vc-managed/data",
  "listen": false,
  "port": 8752,
  "protocol": { "ipv4": true, "ipv6": false },
  "browserLaunch": { "enabled": false },
  "whitelistMode": true,
  "enableForwardedWhitelist": true,
  "whitelist": ["127.0.0.1", "::1"],
  "whitelistDockerHosts": false,
  "basicAuthMode": false,
  "enableCorsProxy": false,
  "enableUserAccounts": true,
  "disableCsrfProtection": false,
  "securityOverride": false,
  "allowKeysExposure": false,
  "hostWhitelist": { "enabled": true, "scan": false, "hosts": ["127.0.0.1", "localhost", "127.0.0.1:${port}", "localhost:${port}"] },
  "enableServerPlugins": true,
  "enableServerPluginsAutoUpdate": false,
  "extensions": { "enabled": true, "autoUpdate": false, "models": { "autoDownload": false } },
  "enableDownloadableTokenizers": false,
  "backups": { "allowFullDataBackup": true, "chat": { "enabled": true, "checkIntegrity": true } },
  "logging": { "enableAccessLog": false, "minLogLevel": 1 },
  "heartbeatInterval": 0,
  "sso": { "autheliaAuth": false, "authentikAuth": false, "trustedProxies": [] }
}
EOF
    chmod 666 "$STATE/config.yaml"
}

prepare_st_context() {
    VC_ST_BUILD_CONTEXT=$ROOT
    if in_test; then
        return 0
    fi
    if [[ ! -L "$ROOT/integrations/sillytavern/upstream" ]]; then
        return 0
    fi
    local dest target
    dest="$STATE/st-build-context"
    target=$(readlink "$ROOT/integrations/sillytavern/upstream")
    mkdir -p "$dest"
    rsync -a --delete \
        --exclude '/integrations/sillytavern/upstream' \
        "$ROOT/" "$dest/"
    mkdir -p "$dest/integrations/sillytavern/upstream"
    rsync -a --delete \
        "${target}/" "$dest/integrations/sillytavern/upstream/"
    VC_ST_BUILD_CONTEXT=$dest
}

prepare_minio_volume() {
    "$DOCKER" volume create "${PROJECT}_minio-data" >/dev/null
    "$DOCKER" run --rm -v "${PROJECT}_minio-data:/data" alpine:3.23.3 chown 1000:1000 /data >/dev/null
}

ensure_images() {
    in_test && return 0
    local missing=0 spec
    for spec in virtual-companion-runtime:local virtual-companion-st:local virtual-companion-minio:local; do
        if ! "$DOCKER" image inspect "$spec" >/dev/null 2>&1; then
            missing=1
        fi
    done
    if [[ "$missing" == 1 ]]; then
        compose build
    fi
}

probe() {
    in_test && return 0
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${VC_LOCAL_HTTP_PORT}/auth/")
    if [[ "$code" != "200" ]]; then
        echo "登录页返回 ${code}" >&2
        return 1
    fi
    printf '%s\n' \
        "本机栈已就绪" \
        "访问地址: http://127.0.0.1:${VC_LOCAL_HTTP_PORT}/auth/" \
        "管理员用户名文件: ${STATE}/admin.username" \
        "口令文件: ${STATE}/admin.password"
}

cmd_up() {
    common_init
    apply_defaults
    check_port_collision
    discover_models
    validate_models
    if ! in_test && lsof -nP -iTCP:"$VC_LOCAL_HTTP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        if ! "$DOCKER" ps -q --filter name="^/${PROJECT}-ingress$" --filter status=running | grep -q .; then
            echo "端口已占用" >&2
            exit 1
        fi
    fi
    mkdir -p "$STATE"
    chmod 700 "$STATE"
    init_secrets
    if in_test || "$DOCKER" image inspect virtual-companion-st:local >/dev/null 2>&1; then
        VC_ST_BUILD_CONTEXT=$ROOT
    else
        prepare_st_context
    fi
    write_local_env
    write_compose_env
    write_ingress
    write_config
    prepare_minio_volume
    ensure_images
    compose config -q
    compose up -d --wait --wait-timeout 300
    probe
}

cmd_down() {
    common_init
    compose down
}

cmd_status() {
    common_init
    compose ps
}

cmd_logs() {
    [[ $# -eq 1 ]] || { usage; exit 2; }
    case "$1" in
        ingress|db|minio|minio-init|migrate|bootstrap|runtime|embedding|rerank|memorycore|st) ;;
        *) echo "未知服务" >&2; exit 2 ;;
    esac
    common_init
    compose logs --tail 200 "$1"
}

cmd_rebuild() {
    [[ $# -eq 1 ]] || { usage; exit 2; }
    common_init
    case "$1" in
        runtime)
            compose build runtime
            compose up -d --force-recreate --no-deps migrate
            compose wait migrate
            compose up -d --no-deps --force-recreate --wait runtime
            ;;
        st)
            prepare_st_context
            env_set "$STATE/compose.env" VC_ST_BUILD_CONTEXT "$VC_ST_BUILD_CONTEXT"
            compose build st
            compose up -d --no-deps --force-recreate --wait memorycore
            compose up -d --no-deps --force-recreate --wait st
            ;;
        all)
            prepare_st_context
            env_set "$STATE/compose.env" VC_ST_BUILD_CONTEXT "$VC_ST_BUILD_CONTEXT"
            compose build
            compose up -d --force-recreate --wait --wait-timeout 300
            ;;
        *) usage; exit 2 ;;
    esac
}

cmd_reset() {
    if [[ "${1:-}" != "--confirm" || "${2:-}" != "WIPE-LOCAL-DATA" || "${VC_LOCAL_RESET_CONFIRM:-}" != "WIPE-LOCAL-DATA" ]]; then
        echo "reset 需要 --confirm WIPE-LOCAL-DATA 以及 VC_LOCAL_RESET_CONFIRM=WIPE-LOCAL-DATA" >&2
        exit 2
    fi
    common_init
    compose down -v
}

secret_text_rejected() {
    case "$1" in
        *VC_CRYPTO_REST_KEY=*|*VC_OWNER_BINDING_SECRET=*|*VC_CRYPTO_PREVIOUS_REST_KEY=*|*VC_SMTP_PASSWORD=*|*VC_ST_PLUGIN_SERVICE_TOKEN=*|*POSTGRES_PASSWORD=*|*VC_EXPORT_S3_SECRET_KEY=*)
            echo "远程输出含有秘密，已拒绝显示" >&2
            return 0
            ;;
    esac
    return 1
}

parse_ssh_json() {
    local raw
    raw=$(cat)
    if secret_text_rejected "$raw"; then
        exit 1
    fi
}

apply_secret_file() {
    local file="$1" line key val
    local crypto="" binding="" key_id="" key_ver="" prev="" prev_id="" prev_ver="" handles=""
    local -a names=()
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        key=${line%%=*}
        val=${line#*=}
        case "$key" in
            VC_CRYPTO_REST_KEY) crypto=$val ;;
            VC_OWNER_BINDING_SECRET) binding=$val ;;
            VC_CRYPTO_REST_KEY_ID) key_id=$val ;;
            VC_CRYPTO_REST_KEY_VERSION) key_ver=$val ;;
            VC_CRYPTO_PREVIOUS_REST_KEY) prev=$val ;;
            VC_CRYPTO_PREVIOUS_REST_KEY_ID) prev_id=$val ;;
            VC_CRYPTO_PREVIOUS_REST_KEY_VERSION) prev_ver=$val ;;
            VC_ST_ACCOUNT_HANDLES) handles=$val ;;
        esac
    done < "$file"
    [[ -n "$crypto" && -n "$binding" ]] || { echo "secrets.env 缺少解密所需的键" >&2; exit 1; }
    aes_key_ok "$crypto" || { echo "VC_CRYPTO_REST_KEY 无效" >&2; exit 1; }
    [[ ${#binding} -ge 32 ]] || { echo "VC_OWNER_BINDING_SECRET 无效" >&2; exit 1; }
    if [[ -n "$prev" ]]; then
        aes_key_ok "$prev" || { echo "VC_CRYPTO_PREVIOUS_REST_KEY 无效" >&2; exit 1; }
    fi
    if [[ -n "$key_ver" && ! "$key_ver" =~ ^[1-9][0-9]*$ ]]; then
        echo "VC_CRYPTO_REST_KEY_VERSION 无效" >&2
        exit 1
    fi
    if [[ -n "$handles" && ! "$handles" =~ ^\{.*\}$ ]]; then
        echo "VC_ST_ACCOUNT_HANDLES 无效" >&2
        exit 1
    fi
    env_set "$STATE/runtime.env" VC_CRYPTO_REST_KEY "$crypto"
    names+=(VC_CRYPTO_REST_KEY)
    env_set "$STATE/runtime.env" VC_OWNER_BINDING_SECRET "$binding"
    env_set "$STATE/bootstrap.env" VC_OWNER_BINDING_SECRET "$binding"
    names+=(VC_OWNER_BINDING_SECRET)
    if [[ -n "$key_id" ]]; then
        env_set "$STATE/runtime.env" VC_CRYPTO_REST_KEY_ID "$key_id"
        names+=(VC_CRYPTO_REST_KEY_ID)
    fi
    if [[ -n "$key_ver" ]]; then
        env_set "$STATE/runtime.env" VC_CRYPTO_REST_KEY_VERSION "$key_ver"
        names+=(VC_CRYPTO_REST_KEY_VERSION)
    fi
    if [[ -n "$prev" ]]; then
        env_set "$STATE/runtime.env" VC_CRYPTO_PREVIOUS_REST_KEY "$prev"
        names+=(VC_CRYPTO_PREVIOUS_REST_KEY)
    else
        env_unset "$STATE/runtime.env" VC_CRYPTO_PREVIOUS_REST_KEY
    fi
    if [[ -n "$prev_id" ]]; then
        env_set "$STATE/runtime.env" VC_CRYPTO_PREVIOUS_REST_KEY_ID "$prev_id"
        names+=(VC_CRYPTO_PREVIOUS_REST_KEY_ID)
    fi
    if [[ -n "$prev_ver" ]]; then
        env_set "$STATE/runtime.env" VC_CRYPTO_PREVIOUS_REST_KEY_VERSION "$prev_ver"
        names+=(VC_CRYPTO_PREVIOUS_REST_KEY_VERSION)
    fi
    if [[ -n "$handles" ]]; then
        env_set "$STATE/st.env" VC_ST_ACCOUNT_HANDLES "$handles"
        names+=(VC_ST_ACCOUNT_HANDLES)
    fi
    chmod 600 "$STATE/runtime.env" "$STATE/bootstrap.env" "$STATE/st.env"
    printf 'synced secret names: %s\n' "${names[*]}"
}

has_files() {
    local dir="$1" path
    [[ -d "$dir" ]] || return 1
    while IFS= read -r -d '' path; do
        [[ -n "$path" ]] && return 0
    done < <(find "$dir" -type f -print0)
    return 1
}

cmd_sync_dir() {
    local src="$1" status
    [[ -d "$src" ]] || { echo "备份目录不存在" >&2; exit 1; }
    [[ -f "$src/postgres/vc.dump" ]] || { echo "缺少 postgres/vc.dump" >&2; exit 1; }
    [[ -d "$src/st" ]] || { echo "缺少 st/" >&2; exit 1; }
    [[ -d "$src/memorycore" ]] || { echo "缺少 memorycore/" >&2; exit 1; }
    [[ -f "$src/secrets.env" ]] || { echo "缺少 secrets.env" >&2; exit 1; }
    [[ "$(mode_of "$src/secrets.env")" == "600" ]] || { echo "secrets.env 必须是 0600" >&2; exit 1; }
    [[ -f "$STATE/runtime.env" ]] || { echo "先运行 up 生成本机配置" >&2; exit 1; }
    compose stop runtime st memorycore || true
    compose up -d --wait db
    compose cp "$src/postgres/vc.dump" db:/tmp/vc-restore.dump
    set +e
    compose exec -T -u 0 db sh -c 'pg_restore -U vc_migrator -d vc --clean --if-exists --no-owner /tmp/vc-restore.dump; status=$?; rm -f /tmp/vc-restore.dump; exit $status'
    status=$?
    set -e
    if [[ "$status" -gt 1 ]]; then
        echo "pg_restore 失败" >&2
        exit "$status"
    fi
    "$DOCKER" run --rm -v "${PROJECT}_st-data:/dest" -v "$src/st:/src:ro" alpine:3.23.3 \
        sh -c 'find /dest -mindepth 1 -maxdepth 1 -exec rm -rf {} +; cp -a /src/. /dest/; chown -R 1000:1000 /dest'
    "$DOCKER" run --rm -v "${PROJECT}_memorycore-data:/dest" -v "$src/memorycore:/src:ro" alpine:3.23.3 \
        sh -c 'find /dest -mindepth 1 -maxdepth 1 -exec rm -rf {} +; cp -a /src/. /dest/; rm -f /dest/runtime.lock; chown -R 1000:1000 /dest'
    if has_files "$src/minio"; then
        compose run --rm --no-deps \
            -v "$src/minio:/import:ro" \
            -v "$ROOT/scripts/local/minio-import.sh:/minio-import.sh:ro" \
            --entrypoint /bin/sh minio /minio-import.sh
    fi
    apply_secret_file "$src/secrets.env"
    compose exec -T db psql -U vc_migrator -d vc -v ON_ERROR_STOP=1 -f - < "$ROOT/scripts/local/quiesce.sql"
    compose up -d --wait --wait-timeout 300
}

ssh_execute() {
    if [[ "${VC_LOCAL_TEST:-}" == "1" ]]; then
        "${VC_LOCAL_SSH_EXECUTE:?}" "$@"
        return
    fi
    /Users/hxf/.codex/skills/ssh-skill/.venv/bin/python \
        /Users/hxf/.codex/skills/ssh-skill/scripts/ssh_execute.py "$@"
}

ssh_download() {
    if [[ "${VC_LOCAL_TEST:-}" == "1" ]]; then
        "${VC_LOCAL_SSH_DOWNLOAD:?}" "$@"
        return
    fi
    /Users/hxf/.codex/skills/ssh-skill/.venv/bin/python \
        /Users/hxf/.codex/skills/ssh-skill/scripts/ssh_download.py "$@"
}

cmd_sync_plan() {
    common_init
    apply_defaults
    printf '%s\n' \
        "alias: ${VC_PROD_SSH_ALIAS}" \
        "execute: ssh_execute.py" \
        "download: ssh_download.py"
}

cmd_sync_remote() {
    common_init
    apply_defaults
    local b64 json remote_dir dest
    b64=$(base64 < "$ROOT/scripts/local/remote-export.sh" | tr -d '\n')
    json=$(ssh_execute "$VC_PROD_SSH_ALIAS" "printf '%s' '${b64}' | base64 -d | bash" --timeout 1800)
    if secret_text_rejected "$json"; then
        exit 1
    fi
    remote_dir=$(printf '%s\n' "$json" | awk '
        match($0, /EXPORT_DIR=\/tmp\/vc-local-export\.[A-Za-z0-9]+/) {
            print substr($0, RSTART + 11, RLENGTH - 11)
            exit
        }
    ')
    [[ "$remote_dir" =~ ^/tmp/vc-local-export\.[A-Za-z0-9]+$ ]] || {
        echo "远程导出没有返回目录" >&2
        exit 1
    }
    dest=$(mktemp -d "${TMPDIR:-/tmp}/vc-local-import.XXXXXX")
    chmod 700 "$dest"
    ssh_download "$VC_PROD_SSH_ALIAS" "$remote_dir" "$dest" --recursive --no-progress
    if [[ -f "$dest/secrets.env" ]]; then
        chmod 600 "$dest/secrets.env"
    fi
    cmd_sync_dir "$dest"
    ssh_execute "$VC_PROD_SSH_ALIAS" "rm -rf ${remote_dir}" >/dev/null
}

cmd_sync() {
    local from="" plan=0 parse=0
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --from-dir)
                [[ $# -ge 2 ]] || { echo "缺少备份目录" >&2; exit 2; }
                from=$2
                shift 2
                ;;
            --plan) plan=1; shift ;;
            --parse-ssh-json)
                [[ "${VC_LOCAL_TEST:-}" == "1" ]] || { usage; exit 2; }
                parse=1
                shift
                ;;
            *) usage; exit 2 ;;
        esac
    done
    if [[ "$parse" == 1 ]]; then
        parse_ssh_json
        return
    fi
    if [[ "$plan" == 1 ]]; then
        cmd_sync_plan
        return
    fi
    common_init
    if [[ -n "$from" ]]; then
        cmd_sync_dir "$from"
        return
    fi
    cmd_sync_remote
}

main() {
    local cmd="${1:-}"
    if [[ $# -gt 0 ]]; then
        shift
    fi
    case "$cmd" in
        up) cmd_up ;;
        down) cmd_down ;;
        status) cmd_status ;;
        logs) cmd_logs "$@" ;;
        rebuild) cmd_rebuild "$@" ;;
        reset) cmd_reset "$@" ;;
        sync-from-prod) cmd_sync "$@" ;;
        *) usage; exit 2 ;;
    esac
}
