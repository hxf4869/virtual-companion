#!/usr/bin/env bash
# 测试替身：在本机执行原本要发给 ssh_execute 的远端命令。
set -euo pipefail
alias_name="${1:?}"
cmd="${2:?}"
export PATH="${VC_TEST_BIN:?}:$PATH"
printf '%s\n' "$alias_name $cmd" >> "${VC_TEST_REMOTE_LOG:?}"
bash -c "$cmd"
