#!/usr/bin/env bash
# 测试替身：记录参数并模拟本机/远端 docker，不访问守护进程。
set -euo pipefail
LOG=${VC_TEST_DOCKER_LOG:?}
ORDER=${VC_TEST_ORDER_LOG:-}
printf '%s\n' "$*" >> "$LOG"

note() {
  [ -n "$ORDER" ] || return 0
  printf '%s\n' "$1" >> "$ORDER"
}

if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  if [ -n "${VC_TEST_IMAGES_MISSING:-}" ]; then
    exit 1
  fi
  # 远端在 load 之前没有目标镜像。
  if [ -n "${VC_TEST_REMOTE:-}" ] && [ ! -f "${LOG}.loaded" ]; then
    exit 1
  fi
  exit 0
fi

if [ "${1:-}" = "image" ] && [ "${2:-}" = "ls" ]; then
  printf '%s' "${VC_TEST_IMAGE_LIST:-}"
  exit 0
fi

if [ "${1:-}" = "image" ] && [ "${2:-}" = "rm" ]; then
  note image-cleanup
  exit 0
fi

if [ "${1:-}" = "ps" ]; then
  printf '%s' "${VC_TEST_CONTAINER_IDS:-}"
  exit 0
fi

if [ "${1:-}" = "buildx" ]; then
  exit 0
fi

if [ "${1:-}" = "run" ]; then
  if [ -n "${VC_TEST_REMOTE:-}" ]; then note remote-run; else note smoke; fi
  exit 0
fi

if [ "${1:-}" = "save" ]; then
  printf 'FAKEIMAGE'
  exit 0
fi

if [ "${1:-}" = "load" ]; then
  cat >/dev/null
  : > "${LOG}.loaded"
  note load
  exit 0
fi

if [ "${1:-}" = "volume" ] && [ "${2:-}" = "ls" ]; then
  joined="$*"
  case "$joined" in
    *st-data*) printf '%s\n' "vc-v2_st-data" ;;
    *memorycore-data*) printf '%s\n' "vc-v2_memorycore-data" ;;
    *) echo "unexpected volume ls $*" >&2; exit 1 ;;
  esac
  exit 0
fi

if [ "${1:-}" = "volume" ] && [ "${2:-}" = "inspect" ]; then
  name="${@: -1}"
  case "$name" in
    *st-data*) printf '%s\n' "${VC_TEST_ST_MOUNT:?}" ;;
    *memorycore-data*) printf '%s\n' "${VC_TEST_MC_MOUNT:?}" ;;
    *) echo "unexpected volume $name" >&2; exit 1 ;;
  esac
  exit 0
fi

if [ "${1:-}" = "inspect" ]; then
  if [ "${3:-}" = '{{.Image}}' ]; then
    printf '%s' "${VC_TEST_PROTECTED_IMAGES:-}"
    exit 0
  fi
  printf '%s\n' "/vc-v2-db-1"
  exit 0
fi

if [ "${1:-}" = "compose" ]; then
  sub=""
  prev=""
  extras=()
  for a in "$@"; do
    [ "$a" = "compose" ] && continue
    if [ "$prev" = "--env-file" ] || [ "$prev" = "-f" ] || [ "$prev" = "--format" ]; then
      prev=""
      continue
    fi
    case "$a" in
      --env-file=*|--format=*) continue ;;
      --env-file|-f|--format) prev=$a; continue ;;
      -*) continue ;;
    esac
    if [ -z "$sub" ]; then
      sub=$a
    else
      extras+=("$a")
    fi
  done
  case "$sub" in
    config) exit 0 ;;
    stop|start)
      note "$sub-${extras[0]:-}"
      exit 0
      ;;
    up)
      note up
      exit 0
      ;;
    ps)
      if [ "${#extras[@]}" -gt 0 ] && [ "${extras[0]}" = "db" ]; then
        printf '%s\n' "dbcid123"
        exit 0
      fi
      cat <<'EOF'
ingress|running||0
db|running|healthy|0
migrate|exited||0
bootstrap|exited||0
minio|running|healthy|0
minio-init|exited||0
runtime|running|healthy|0
embedding|running|healthy|0
rerank|running|healthy|0
memorycore|running|healthy|0
st|running|healthy|0
EOF
      exit 0
      ;;
    exec)
      svc="${extras[0]:-}"
      case "$svc" in
        db)
          printf '%s\n' "${VC_TEST_SCHEMA_LINE:-2 2}"
          exit 0
          ;;
        runtime)
          if [ "${VC_TEST_FAIL_CHECK:-}" = "runtime" ]; then
            exit 1
          fi
          printf '%s\n' '{"status":"UP"}'
          exit 0
          ;;
        memorycore)
          joined="$*"
          case "$joined" in
            *local-models*) printf '%s\n' "healthy" ;;
            *) printf '%s\n' "ready" ;;
          esac
          exit 0
          ;;
        st|embedding|rerank) exit 0 ;;
        *) echo "unexpected exec $*" >&2; exit 1 ;;
      esac
      ;;
    *)
      echo "unexpected compose $*" >&2
      exit 1
      ;;
  esac
fi

echo "unexpected docker $*" >&2
exit 1
