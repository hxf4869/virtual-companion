#!/usr/bin/env bash
# 测试替身：把 ssh_upload 换成本地复制，不连接服务器。
set -euo pipefail
alias_name="${1:?}"
local_path="${2:?}"
remote_path="${3:?}"
mkdir -p "$(dirname "$remote_path")"
cp "$local_path" "$remote_path"
printf '%s\n' "$alias_name $remote_path" >> "${VC_TEST_UPLOAD_LOG:?}"
