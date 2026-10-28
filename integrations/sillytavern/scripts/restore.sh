#!/usr/bin/env bash
# V2-W03-S1 C1 恢复：VCBAE1 认证容器 → MAC 校验（vc_aead.py unseal，失败即拒绝，不解密任何字节）→ openssl 解密 → 解包到隔离空目录。
# 只恢复到独立目录，不覆盖原 dataRoot（恢复试验不覆盖原数据）。字节一致性由调用方对原目录与恢复目录做 diff -r。
#
# 用法：bash scripts/restore.sh <archive.vcbae1> <target-dir（不存在或为空）>
# 口令：VC_ST_BACKUP_PASSPHRASE 或 VC_ST_BACKUP_PASSPHRASE_FILE（0600），与 backup.sh 相同。
# 退出码：0 成功 | 1 用法/守卫 | 3 认证失败（MAC 不匹配/口令错误/被篡改/截断） | 4 解密失败 | 5 解包失败 | 6 环境缺依赖
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
AEAD="$REPO_ROOT/infra/db/backup/vc_aead.py"

[ $# -eq 2 ] || { echo "用法: bash scripts/restore.sh <archive.vcbae1> <target-dir>" >&2; exit 1; }
ARCHIVE="$1"; TARGET="$2"
command -v openssl >/dev/null || { echo "FAIL: 需要 openssl" >&2; exit 6; }
command -v python3 >/dev/null || { echo "FAIL: 需要 python3" >&2; exit 6; }
[ -f "$AEAD" ] || { echo "FAIL: 缺少 $AEAD" >&2; exit 6; }
[ -f "$ARCHIVE" ] || { echo "FAIL: 归档不存在: $ARCHIVE" >&2; exit 1; }

if [ -e "$TARGET" ]; then
    [ -d "$TARGET" ] || { echo "FAIL: 目标不是目录: $TARGET" >&2; exit 1; }
    [ -z "$(ls -A "$TARGET")" ] || { echo "FAIL: 目标目录非空，拒绝覆盖: $TARGET" >&2; exit 1; }
else
    mkdir -p "$TARGET"
fi
chmod 700 "$TARGET"

PASS_ARGS=(); PASS_SRC=()
if [ -n "${VC_ST_BACKUP_PASSPHRASE_FILE:-}" ] && [ -n "${VC_ST_BACKUP_PASSPHRASE:-}" ]; then
    echo "FAIL: 口令来源只能设一个" >&2; exit 1
elif [ -n "${VC_ST_BACKUP_PASSPHRASE_FILE:-}" ]; then
    KF="$VC_ST_BACKUP_PASSPHRASE_FILE"; [ -f "$KF" ] || { echo "FAIL: keyfile 不存在" >&2; exit 1; }
    PASS_ARGS=(-pass "file:$KF"); PASS_SRC=(--pass-file "$KF")
elif [ -n "${VC_ST_BACKUP_PASSPHRASE:-}" ]; then
    export VC_ST_BACKUP_PASSPHRASE
    PASS_ARGS=(-pass env:VC_ST_BACKUP_PASSPHRASE); PASS_SRC=(--pass-env VC_ST_BACKUP_PASSPHRASE)
else
    echo "FAIL: 设置 VC_ST_BACKUP_PASSPHRASE 或 VC_ST_BACKUP_PASSPHRASE_FILE" >&2; exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vc-st-restore.XXXXXX")"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "== [1/3] 认证校验 vc_aead.py unseal（MAC 先于任何解密）"
if ! python3 "$AEAD" unseal "$ARCHIVE" "$WORK/body" "${PASS_SRC[@]}"; then
    echo "FAIL: 认证失败——MAC 不匹配 / 口令错误 / 内容被篡改或截断；未输出任何明文" >&2; exit 3
fi
echo "== [2/3] 解密 openssl enc -d"
openssl enc -d -aes-256-cbc -pbkdf2 "${PASS_ARGS[@]}" -in "$WORK/body" -out "$WORK/plain.tar" || { echo "FAIL: 解密失败" >&2; exit 4; }
echo "== [3/3] 解包到 $TARGET 并收紧权限（目录 0700 / 文件 0600）"
tar -xpf "$WORK/plain.tar" -C "$TARGET" || { echo "FAIL: 解包失败" >&2; exit 5; }
if [ -d "$TARGET/_memorycore" ]; then
    # The service remains blocked if current Go deletion/suppression state cannot
    # be obtained. Never trust the rights snapshot contained in the old archive.
    printf '{"blocked":true}\n' > "$TARGET/_memorycore/restore-pending.json"
    python3 "$SCRIPT_DIR/lib/memorycore-backup.py" restore "$TARGET/_memorycore" || exit 5
fi
find "$TARGET" -type d -exec chmod 700 {} + || { echo "FAIL: 收紧目录权限失败" >&2; exit 5; }
find "$TARGET" -type f -exec chmod 600 {} + || { echo "FAIL: 收紧文件权限失败" >&2; exit 5; }
ENTRIES=$(tar -tf "$WORK/plain.tar" | wc -l | tr -d ' ')
echo "OK    恢复完成：${TARGET}（${ENTRIES} 条目，目录 0700/文件 0600；未触碰原 dataRoot）"
