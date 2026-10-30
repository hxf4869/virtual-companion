#!/usr/bin/env bash
# V2-W03-S1 C1 加密备份：ST 开发 dataRoot 的保护清单 → tar → openssl enc(aes-256-cbc,pbkdf2) → vc_aead.py seal（VCBAE1 认证容器）。
# 复用 infra/db/backup/vc_aead.py 的 encrypt-then-MAC 协议，不复制重写密码算法；不改旧每日备份任务。
#
# 用法：bash scripts/backup.sh <dataRoot> <config.yaml|-> <out.vcbae1>
# 口令（二选一，密钥永不进 argv）：
#   VC_ST_BACKUP_PASSPHRASE        环境变量
#   VC_ST_BACKUP_PASSPHRASE_FILE   0600 keyfile（首行）
# 保护清单（相对 dataRoot，存在的才打包）：
#   cookie-secret.txt  default-user/settings.json  default-user/secrets.json
#   default-user/chats  default-user/group chats  default-user/groups  default-user/characters  default-user/worlds
#   default-user/backups（ST 自动聊天备份 / settings 备份 / secrets 迁移备份）
#   default-user/OpenAI Settings（原生 Chat Completion 预设，C03 消费）
#   default-user/user（persona/头像与 CHARX 导入 misc 资源 user/images/**，C06 消费；仅排除确定的自托管
#     mvu-bundle-d03b7dc8.js，该文件由 vendor/upstream 锁 + bootstrap 确定性再生，不泛称 user/ 可再生）
#   _vc_accounts/ 与各用户根下 .vc-f2/（删除/身份状态，不含对话正文）
#   + 传入的 config.yaml（归档内 _config/config.yaml）
# 删除清单不进归档：VC_ST_DATABASE_URL 或 VC_ST_PG_CONTAINER 恰好设置其一时，另写
# VC_ST_DELETION_MANIFEST（默认与归档同目录的 deletion-manifest.json）。恢复读这份最新清单，
# 不把它打进会被回滚的快照，也不写回 PostgreSQL。
# PostgreSQL（可选，恰好其一；口令不进 argv）：
#   VC_BACKUP_PG_DSN         libpq URL。口令写入临时 0600 PGPASSFILE。
#   VC_BACKUP_PG_CONTAINER   在容器内执行 pg_dump -Fc（自定义格式）。
#   VC_BACKUP_PG_USER        容器内用户，默认 postgres
#   VC_BACKUP_PG_DATABASE    容器内库名，默认 vc
# 两者都未设置时不导出数据库，并输出「未含 PostgreSQL」。
# MinIO 不备份：导出对象约 24 小时过期，是对话与记忆的临时下载副本。
# 不打包：明确列出的自托管派生文件与 extensions/（上游锁 + 补丁 + vendor.lock 可重放）；任何 keyfile / .env。
# 守卫：输出不能落在 dataRoot 内；keyfile 不能在 dataRoot 内，也不能与归档同目录。产物 0600。
#       只对本次新建的输出目录设 0700，已存在的父目录权限不动。
# 自校验：unseal→decrypt→与原始 tar 直接 cmp 字节比较（不另引入摘要）。
# 退出码：0 成功 | 1 用法/守卫 | 2 打包 | 3 加密 | 4 认证封装 | 5 自校验不一致 | 6 环境缺依赖
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AEAD="$REPO_ROOT/infra/db/backup/vc_aead.py"

[ $# -eq 3 ] || { echo "用法: bash scripts/backup.sh <dataRoot> <config.yaml|-> <out.vcbae1>" >&2; exit 1; }
DATA="$1"; CONFIG="$2"; OUT="$3"
if [ -n "${VC_BACKUP_PG_DSN:-}" ] && [ -n "${VC_BACKUP_PG_CONTAINER:-}" ]; then
    echo "FAIL: VC_BACKUP_PG_DSN 与 VC_BACKUP_PG_CONTAINER 只能设一个" >&2
    exit 1
fi

command -v openssl >/dev/null || { echo "FAIL: 需要 openssl" >&2; exit 6; }
command -v python3 >/dev/null || { echo "FAIL: 需要 python3（vc_aead.py）" >&2; exit 6; }
command -v tar >/dev/null || { echo "FAIL: 需要 tar" >&2; exit 6; }
[ -f "$AEAD" ] || { echo "FAIL: 缺少 $AEAD" >&2; exit 6; }
[ -d "$DATA" ] || { echo "FAIL: dataRoot 不存在: $DATA" >&2; exit 1; }
DATA_REAL="$(cd "$DATA" && pwd -P)"

# 口令来源（与 run-daily-backup.sh 同约定）
PASS_ARGS=(); PASS_SRC=()
if [ -n "${VC_ST_BACKUP_PASSPHRASE_FILE:-}" ] && [ -n "${VC_ST_BACKUP_PASSPHRASE:-}" ]; then
    echo "FAIL: VC_ST_BACKUP_PASSPHRASE 与 VC_ST_BACKUP_PASSPHRASE_FILE 只能设一个" >&2; exit 1
elif [ -n "${VC_ST_BACKUP_PASSPHRASE_FILE:-}" ]; then
    KF="$VC_ST_BACKUP_PASSPHRASE_FILE"
    [ -f "$KF" ] || { echo "FAIL: keyfile 不存在" >&2; exit 1; }
    KF_REAL="$(cd "$(dirname "$KF")" && pwd -P)/$(basename "$KF")"
    case "$KF_REAL" in "$DATA_REAL"/*) echo "FAIL: keyfile 位于 dataRoot 内（密钥必须在备份对象外）" >&2; exit 1;; esac
    [ "$(stat -c '%a' "$KF" 2>/dev/null || stat -f '%Lp' "$KF")" = "600" ] || { echo "FAIL: keyfile 必须是 0600" >&2; exit 1; }
    PASS_ARGS=(-pass "file:$KF"); PASS_SRC=(--pass-file "$KF")
elif [ -n "${VC_ST_BACKUP_PASSPHRASE:-}" ]; then
    export VC_ST_BACKUP_PASSPHRASE
    PASS_ARGS=(-pass env:VC_ST_BACKUP_PASSPHRASE); PASS_SRC=(--pass-env VC_ST_BACKUP_PASSPHRASE)
else
    echo "FAIL: 设置 VC_ST_BACKUP_PASSPHRASE 或 VC_ST_BACKUP_PASSPHRASE_FILE(0600)" >&2; exit 1
fi

# 输出守卫：只对本次新建的目录设 0700；已存在的父目录保持用户原权限不动
OUT_DIR="$(dirname "$OUT")"
if [ ! -d "$OUT_DIR" ]; then
    mkdir -p "$OUT_DIR"
    chmod 700 "$OUT_DIR"
fi
OUT_DIR_REAL="$(cd "$OUT_DIR" && pwd -P)"
case "$OUT_DIR_REAL" in "$DATA_REAL"|"$DATA_REAL"/*) echo "FAIL: 输出不能落在 dataRoot 内: $OUT" >&2; exit 1;; esac
if [ -n "${KF_REAL:-}" ] && [ "$(dirname "$KF_REAL")" = "$OUT_DIR_REAL" ]; then
    echo "FAIL: keyfile 与归档同目录（密钥与备份须分开保管）" >&2; exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vc-st-backup.XXXXXX")"; chmod 700 "$WORK"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# 保护清单：只打包存在的条目
PROTECTED=(
    "cookie-secret.txt"
    "default-user/settings.json"
    "default-user/secrets.json"
    "default-user/chats"
    "default-user/group chats"
    "default-user/groups"
    "default-user/characters"
    "default-user/worlds"
    "default-user/backups"
    "default-user/OpenAI Settings"
    "default-user/user"
    "_vc_accounts"
)
INCLUDE=(); MISSING=()
for rel in "${PROTECTED[@]}"; do
    if [ -e "$DATA/$rel" ]; then INCLUDE+=("$rel"); else MISSING+=("$rel"); fi
done
if [ -L "$DATA/_vc_accounts" ]; then
    echo "FAIL: _vc_accounts 不能是符号链接" >&2
    exit 1
fi
for dir in "$DATA"/*/.vc-f2; do
    if [ -L "$dir" ]; then
        echo "FAIL: .vc-f2 不能是符号链接" >&2
        exit 1
    fi
    if [ -d "$dir" ]; then
        INCLUDE+=("${dir#"$DATA/"}")
    fi
done
[ ${#INCLUDE[@]} -gt 0 ] || { echo "FAIL: dataRoot 内没有任何保护清单条目" >&2; exit 2; }

# 确定的自托管派生文件：由 upstream.lock/vendor.lock + bootstrap 确定性再生，不入备份（不泛称 user/ 可再生）
SELF_HOSTED_EXCLUDES=(--exclude "default-user/user/files/mvu-bundle-d03b7dc8.js")
TAR_ARGS=("${SELF_HOSTED_EXCLUDES[@]}" -C "$DATA" "${INCLUDE[@]}")
if [ "$CONFIG" != "-" ]; then
    [ -f "$CONFIG" ] || { echo "FAIL: config 不存在: $CONFIG" >&2; exit 1; }
    mkdir -p "$WORK/stage/_config"; chmod 700 "$WORK/stage" "$WORK/stage/_config"
    cp "$CONFIG" "$WORK/stage/_config/config.yaml"; chmod 600 "$WORK/stage/_config/config.yaml"
    TAR_ARGS+=(-C "$WORK/stage" "_config")
fi

# W08: an engine snapshot is mandatory when the managed data root exists.
MEMORYCORE_DATA="${VC_MEMORYCORE_DATA_ROOT:-$SCRIPT_DIR/../dev-managed/memorycore-data}"
if [ -d "$MEMORYCORE_DATA/owners" ]; then
    mkdir -p "$WORK/stage"
    python3 "$SCRIPT_DIR/lib/memorycore-backup.py" snapshot "$MEMORYCORE_DATA" "$WORK/stage/_memorycore" || exit 2
    TAR_ARGS+=(-C "$WORK/stage" "_memorycore")
fi

# 最新删除清单放在归档外。快照回滚 PostgreSQL 时，恢复仍与这份清单取并集。
if [ -n "${VC_ST_DATABASE_URL:-}" ] || [ -n "${VC_ST_PG_CONTAINER:-}" ]; then
    if [ -n "${VC_ST_DATABASE_URL:-}" ] && [ -n "${VC_ST_PG_CONTAINER:-}" ]; then
        echo "FAIL: VC_ST_DATABASE_URL 与 VC_ST_PG_CONTAINER 只能设一个" >&2
        exit 1
    fi
    MANIFEST="${VC_ST_DELETION_MANIFEST:-$OUT_DIR_REAL/deletion-manifest.json}"
    MANIFEST_PARENT="$(dirname "$MANIFEST")"
    if [ ! -d "$MANIFEST_PARENT" ]; then
        mkdir -p "$MANIFEST_PARENT"
        chmod 700 "$MANIFEST_PARENT"
    fi
    MANIFEST_REAL="$(cd "$MANIFEST_PARENT" && pwd -P)/$(basename "$MANIFEST")"
    case "$MANIFEST_REAL" in
        "$DATA_REAL"|"$DATA_REAL"/*) echo "FAIL: 删除清单不能落在 dataRoot 内" >&2; exit 1;;
    esac
    OUT_REAL="$OUT_DIR_REAL/$(basename "$OUT")"
    if [ "$MANIFEST_REAL" = "$OUT_REAL" ]; then
        echo "FAIL: 删除清单不能覆盖归档" >&2
        exit 1
    fi
    if [ -f "$WORK/stage/_memorycore/go-rights.json" ]; then
        python3 "$SCRIPT_DIR/lib/deletion-state.py" export "$MANIFEST_REAL" "$DATA_REAL" "$WORK/stage/_memorycore/go-rights.json" || exit 2
    else
        python3 "$SCRIPT_DIR/lib/deletion-state.py" export "$MANIFEST_REAL" "$DATA_REAL" || exit 2
    fi
fi

PG_INCLUDED=0
if [ -n "${VC_BACKUP_PG_DSN:-}" ] || [ -n "${VC_BACKUP_PG_CONTAINER:-}" ]; then
    mkdir -p "$WORK/stage/_postgres"
    chmod 700 "$WORK/stage" "$WORK/stage/_postgres"
    python3 "$SCRIPT_DIR/lib/postgres-backup.py" dump "$WORK/stage/_postgres" || exit 2
    TAR_ARGS+=(-C "$WORK/stage" "_postgres")
    PG_INCLUDED=1
fi

PACKED="$(printf '%s, ' "${INCLUDE[@]}" | sed 's/, $//')"
if [ "$CONFIG" != "-" ]; then PACKED="${PACKED}, _config/config.yaml"; fi
if [ "$PG_INCLUDED" -eq 1 ]; then PACKED="${PACKED}, _postgres/db.dump"; fi
echo "== [1/4] 打包保护清单（${PACKED}）"
[ ${#MISSING[@]} -eq 0 ] || echo "      未出现（跳过）：${MISSING[*]}"
tar -cf "$WORK/plain.tar" "${TAR_ARGS[@]}" || { echo "FAIL: tar 打包失败" >&2; exit 2; }
ENTRIES=$(tar -tf "$WORK/plain.tar" | wc -l | tr -d ' ')
BYTES=$(stat -c '%s' "$WORK/plain.tar" 2>/dev/null || stat -f '%z' "$WORK/plain.tar")

echo "== [2/4] 加密 openssl enc -aes-256-cbc -pbkdf2 -salt"
openssl enc -aes-256-cbc -pbkdf2 -salt "${PASS_ARGS[@]}" -in "$WORK/plain.tar" -out "$WORK/body" || { echo "FAIL: openssl enc 失败" >&2; exit 3; }

echo "== [3/4] 认证封装 vc_aead.py seal（VCBAE1）"
python3 "$AEAD" seal "$WORK/body" "$WORK/out.vcbae1" "${PASS_SRC[@]}" || { echo "FAIL: vc_aead seal 失败" >&2; exit 4; }
chmod 600 "$WORK/out.vcbae1"

echo "== [4/4] 自校验：unseal → decrypt → 与原始 tar 字节比较"
python3 "$AEAD" unseal "$WORK/out.vcbae1" "$WORK/verify.body" "${PASS_SRC[@]}" || { echo "FAIL: 自校验 unseal 失败" >&2; exit 5; }
openssl enc -d -aes-256-cbc -pbkdf2 "${PASS_ARGS[@]}" -in "$WORK/verify.body" -out "$WORK/verify.tar" || { echo "FAIL: 自校验解密失败" >&2; exit 5; }
cmp -s "$WORK/plain.tar" "$WORK/verify.tar" || { echo "FAIL: 自校验字节不一致" >&2; exit 5; }

mv "$WORK/out.vcbae1" "$OUT"; chmod 600 "$OUT"
OUT_BYTES=$(stat -c '%s' "$OUT" 2>/dev/null || stat -f '%z' "$OUT")
if [ "$PG_INCLUDED" -eq 0 ]; then
    echo "POSTGRESQL 未含 PostgreSQL"
fi
echo "MinIO 未备份：导出对象约 24 小时过期，是对话与记忆的临时下载副本，不纳入归档"
echo "OK    备份完成：${OUT}（0600，${OUT_BYTES}B；明文 tar ${BYTES}B / ${ENTRIES} 条目；密钥来源：${KF_REAL:-环境变量}）"
