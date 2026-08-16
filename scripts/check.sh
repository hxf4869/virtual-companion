#!/usr/bin/env bash
# 唯一日常检查入口：秒级仓库检查 + 前端测试与类型检查。
# 用法：bash scripts/check.sh          全量（约 1 分钟内）
#       bash scripts/check.sh --quick  仅秒级仓库检查（CI checks job 使用）
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0
if [ "${1:-}" = "--quick" ]; then
  QUICK=1
elif [ $# -gt 0 ]; then
  echo "用法: bash scripts/check.sh [--quick]" >&2
  exit 2
fi

# Python 解释器：优先系统 python3（需自带 PyYAML），否则用 uv 临时环境
if python3 -c "import yaml" >/dev/null 2>&1; then
  PY=(python3)
elif command -v uv >/dev/null 2>&1; then
  PY=(uv run --quiet --with PyYAML==6.0.3 python)
else
  echo "FAIL  环境：需要 python3+PyYAML，或安装 uv" >&2
  exit 1
fi

fail=0
run() {
  local name="$1"
  shift
  local start=$SECONDS
  if "$@" >/dev/null 2>"/tmp/check_${name//[^a-z-]/_}.err"; then
    echo "PASS  ${name} ($((SECONDS - start))s)"
  else
    echo "FAIL  ${name} ($((SECONDS - start))s)"
    sed 's/^/      /' "/tmp/check_${name//[^a-z-]/_}.err" >&2
    fail=1
  fi
}

total_start=$SECONDS

run catalog-validate "${PY[@]}" scripts/checks/catalog_tool.py validate
run catalog-drift    "${PY[@]}" scripts/checks/catalog_tool.py diff --fail-on-drift
run openapi-validate "${PY[@]}" scripts/dev/openapi_tool.py validate
run openapi-drift    "${PY[@]}" scripts/dev/openapi_tool.py diff --fail-on-drift
run paid-features    "${PY[@]}" scripts/checks/check_paid_features.py
run licenses         "${PY[@]}" scripts/checks/check_licenses.py

if [ "$QUICK" -eq 0 ]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "FAIL  环境：全量检查需要 pnpm（或用 --quick 跳过前端）" >&2
    exit 1
  fi
  run frontend-test       pnpm --dir frontend test:run
  run frontend-type-check pnpm --dir frontend type-check
fi

if [ "$fail" -eq 0 ]; then
  echo "OK    scripts/check.sh 全部通过（$((SECONDS - total_start))s）"
else
  echo "FAILED scripts/check.sh 存在失败项（$((SECONDS - total_start))s）" >&2
fi
exit "$fail"
