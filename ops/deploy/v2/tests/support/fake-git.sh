#!/usr/bin/env bash
# 测试替身：模拟服务器上的 git fetch / checkout，不访问网络。
set -euo pipefail
printf '%s\n' "$*" >> "${VC_TEST_GIT_LOG:?}"
case "${1:-}" in
  status)
    if [ -n "${VC_TEST_GIT_DIRTY:-}" ]; then
      printf '%s\n' " M dirty"
    fi
    exit 0
    ;;
  fetch) exit 0 ;;
  checkout)
    if [ "${2:-}" != "--detach" ] || [ -z "${3:-}" ]; then
      echo "bad checkout $*" >&2
      exit 1
    fi
    printf '%s\n' "$3" >> "${VC_TEST_ORDER_LOG:?}"
    printf '%s\n' "$3" > "${VC_TEST_CHECKOUT_FILE:?}"
    exit 0
    ;;
  *)
    echo "unexpected git $*" >&2
    exit 1
    ;;
esac
