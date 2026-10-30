#!/usr/bin/env bash
# 一条命令部署 V2。本机构建 linux/amd64 的 ST 与 runtime 镜像，经 ssh-skill 上传，
# 服务器加载后备份、同步到目标提交、只改 VC_IMAGE_TAG 并自检。
# 用法: bash ops/deploy/v2/deploy.sh [--dry-run] [--skip-build] <提交>
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
REMOTE_BODY="$SCRIPT_DIR/lib/remote-deploy.sh"

# shellcheck source=lib/deploy-lib.sh
. "$SCRIPT_DIR/lib/deploy-lib.sh"
deploy_main "$@"
