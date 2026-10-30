#!/usr/bin/env bash
# deploy.sh 的本机步骤。不打印 compose.env 的值、VC_PUBLIC_HOST、密钥、域名或 IP。

usage() {
  echo "用法: bash ops/deploy/v2/deploy.sh [--dry-run] [--skip-build] <提交>" >&2
}

strip_quotes() {
  local val="$1"
  case "$val" in
    \"*\") val=${val#\"}; val=${val%\"} ;;
    \'*\') val=${val#\'}; val=${val%\'} ;;
  esac
  printf '%s' "$val"
}

assign_if_unset() {
  local key="$1" val="$2"
  case "$key" in
    VC_DEPLOY_SSH_ALIAS)
      if [ -z "${VC_DEPLOY_SSH_ALIAS:-}" ]; then VC_DEPLOY_SSH_ALIAS=$val; export VC_DEPLOY_SSH_ALIAS; fi
      ;;
    VC_DEPLOY_SOURCE_DIR)
      if [ -z "${VC_DEPLOY_SOURCE_DIR:-}" ]; then VC_DEPLOY_SOURCE_DIR=$val; export VC_DEPLOY_SOURCE_DIR; fi
      ;;
    VC_DEPLOY_COMPOSE_ENV)
      if [ -z "${VC_DEPLOY_COMPOSE_ENV:-}" ]; then VC_DEPLOY_COMPOSE_ENV=$val; export VC_DEPLOY_COMPOSE_ENV; fi
      ;;
    VC_DEPLOY_BACKUP_DIR)
      if [ -z "${VC_DEPLOY_BACKUP_DIR:-}" ]; then VC_DEPLOY_BACKUP_DIR=$val; export VC_DEPLOY_BACKUP_DIR; fi
      ;;
    VC_DEPLOY_BACKUP_PASSPHRASE_FILE)
      if [ -z "${VC_DEPLOY_BACKUP_PASSPHRASE_FILE:-}" ]; then VC_DEPLOY_BACKUP_PASSPHRASE_FILE=$val; export VC_DEPLOY_BACKUP_PASSPHRASE_FILE; fi
      ;;
    VC_DEPLOY_ST_CONFIG)
      if [ -z "${VC_DEPLOY_ST_CONFIG:-}" ]; then VC_DEPLOY_ST_CONFIG=$val; export VC_DEPLOY_ST_CONFIG; fi
      ;;
    VC_DEPLOY_PREVIOUS_TAG_FILE)
      if [ -z "${VC_DEPLOY_PREVIOUS_TAG_FILE:-}" ]; then VC_DEPLOY_PREVIOUS_TAG_FILE=$val; export VC_DEPLOY_PREVIOUS_TAG_FILE; fi
      ;;
    VC_PUBLIC_HOST)
      if [ -z "${VC_PUBLIC_HOST:-}" ]; then VC_PUBLIC_HOST=$val; export VC_PUBLIC_HOST; fi
      ;;
  esac
}

load_local_config() {
  local file="${VC_DEPLOY_CONFIG:-$HOME/.config/virtual-companion/deploy.env}"
  local line key val
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key=${line%%=*}
    case "$key" in
      VC_DEPLOY_SSH_ALIAS|VC_DEPLOY_SOURCE_DIR|VC_DEPLOY_COMPOSE_ENV|VC_DEPLOY_BACKUP_DIR|VC_DEPLOY_BACKUP_PASSPHRASE_FILE|VC_DEPLOY_ST_CONFIG|VC_DEPLOY_PREVIOUS_TAG_FILE|VC_PUBLIC_HOST)
        val=${line#*=}
        val=$(strip_quotes "$val")
        assign_if_unset "$key" "$val"
        ;;
    esac
  done < "$file"
}

apply_defaults() {
  : "${VC_DEPLOY_SSH_ALIAS:=hxf4869}"
  : "${VC_DEPLOY_SOURCE_DIR:=/opt/virtual-companion/source}"
  : "${VC_DEPLOY_COMPOSE_ENV:=/etc/virtual-companion/compose.env}"
  : "${VC_DEPLOY_BACKUP_DIR:=/var/backups/virtual-companion}"
  : "${VC_DEPLOY_BACKUP_PASSPHRASE_FILE:=/etc/virtual-companion/st-backup.pass}"
  : "${VC_DEPLOY_ST_CONFIG:=/srv/virtual-companion/config.yaml}"
  : "${VC_DEPLOY_PREVIOUS_TAG_FILE:=/etc/virtual-companion/vc-image-tag.previous}"
  : "${VC_DEPLOY_DOCKER:=docker}"
  : "${VC_DEPLOY_SSH_PYTHON:=/Users/hxf/.codex/skills/ssh-skill/.venv/bin/python}"
  : "${VC_DEPLOY_SSH_UPLOAD_PY:=/Users/hxf/.codex/skills/ssh-skill/scripts/ssh_upload.py}"
  : "${VC_DEPLOY_SSH_EXECUTE_PY:=/Users/hxf/.codex/skills/ssh-skill/scripts/ssh_execute.py}"
  export VC_DEPLOY_SSH_ALIAS VC_DEPLOY_SOURCE_DIR VC_DEPLOY_COMPOSE_ENV \
    VC_DEPLOY_BACKUP_DIR VC_DEPLOY_BACKUP_PASSPHRASE_FILE VC_DEPLOY_ST_CONFIG \
    VC_DEPLOY_PREVIOUS_TAG_FILE VC_DEPLOY_DOCKER VC_DEPLOY_SSH_PYTHON \
    VC_DEPLOY_SSH_UPLOAD_PY VC_DEPLOY_SSH_EXECUTE_PY
}

parse_args() {
  DRY=0
  SKIP=0
  COMMIT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY=1 ;;
      --skip-build) SKIP=1 ;;
      --)
        shift
        break
        ;;
      -*)
        echo "FAIL: 未知参数 $1" >&2
        usage
        exit 2
        ;;
      *)
        if [ -n "$COMMIT" ]; then
          echo "FAIL: 只能指定一个提交" >&2
          exit 2
        fi
        COMMIT=$1
        ;;
    esac
    shift
  done
  while [ $# -gt 0 ]; do
    if [ -n "$COMMIT" ]; then
      echo "FAIL: 只能指定一个提交" >&2
      exit 2
    fi
    COMMIT=$1
    shift
  done
  if [ -z "$COMMIT" ]; then
    usage
    exit 2
  fi
}

safe_token() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 128 ]
}

resolve_commit() {
  local commit="$1"
  if ! FULL=$(git -C "$REPO_ROOT" rev-parse --verify "${commit}^{commit}" 2>/dev/null); then
    echo "FAIL: 无法解析提交" >&2
    exit 1
  fi
  TAG=$(git -C "$REPO_ROOT" rev-parse --short=8 "$FULL")
  safe_token "$TAG" || { echo "FAIL: 标签无效" >&2; exit 1; }
}

image_exists() {
  "$VC_DEPLOY_DOCKER" image inspect "$1" >/dev/null 2>&1
}

run_upload() {
  local local_path="$1" remote_path="$2"
  if [ -n "${VC_DEPLOY_UPLOAD_RUNNER:-}" ]; then
    "$VC_DEPLOY_UPLOAD_RUNNER" "$VC_DEPLOY_SSH_ALIAS" "$local_path" "$remote_path"
    return
  fi
  "$VC_DEPLOY_SSH_PYTHON" "$VC_DEPLOY_SSH_UPLOAD_PY" "$VC_DEPLOY_SSH_ALIAS" "$local_path" "$remote_path" --resume
}

emit_ssh_result() {
  python3 -c '
import json, re, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except Exception:
    sys.stderr.write("FAIL: 远端执行结果无法解析\n")
    sys.exit(1)
def redact(text):
    return re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "<ip>", text or "")
sys.stdout.write(redact(data.get("stdout") or ""))
err = redact(data.get("stderr") or "")
if err:
    if not err.endswith("\n"):
        err += "\n"
    sys.stderr.write(err)
sys.exit(0 if data.get("success") else 1)
'
}

run_remote() {
  local cmd="$1" json rc err_file
  if [ -n "${VC_DEPLOY_REMOTE_RUNNER:-}" ]; then
    "$VC_DEPLOY_REMOTE_RUNNER" "$VC_DEPLOY_SSH_ALIAS" "$cmd"
    return
  fi
  err_file=$(mktemp "${TMPDIR:-/tmp}/vc-deploy-ssh.XXXXXX")
  rc=0
  json=$("$VC_DEPLOY_SSH_PYTHON" "$VC_DEPLOY_SSH_EXECUTE_PY" "$VC_DEPLOY_SSH_ALIAS" "$cmd" --timeout 3600 2>"$err_file") || rc=$?
  if [ -z "$json" ]; then
    rm -f "$err_file"
    echo "FAIL: 远端执行失败" >&2
    exit 1
  fi
  rc=0
  printf '%s' "$json" | emit_ssh_result || rc=$?
  rm -f "$err_file"
  [ "$rc" -eq 0 ]
}

print_plan() {
  local st_image="$1" rt_image="$2" need_st="$3" need_rt="$4"
  local image_cache remote_archive remote_script
  image_cache="$(dirname "$VC_DEPLOY_SOURCE_DIR")/image-cache"
  remote_archive="${image_cache}/vc-images-${TAG}.tar.gz"
  remote_script="${image_cache}/remote-deploy.sh"
  echo "== 提交 =="
  echo "$FULL"
  echo "标签 $TAG"
  echo "== 本地镜像 =="
  if [ "$need_st" -eq 1 ]; then
    echo "构建 ${st_image}"
    echo "docker buildx build --platform linux/amd64 --load -t ${st_image} --build-arg VC_PUBLIC_HOST=<redacted> -f <目标提交>/ops/deploy/v2/Dockerfile.st <目标提交>"
  fi
  if [ "$need_rt" -eq 1 ]; then
    echo "构建 ${rt_image}"
    echo "docker buildx build --platform linux/amd64 --load -t ${rt_image} -f <目标提交>/backend/Dockerfile <目标提交>/backend"
  fi
  echo "== 传输 =="
  echo "docker save ${st_image} ${rt_image} | gzip"
  echo "上传: ${VC_DEPLOY_SSH_PYTHON} ${VC_DEPLOY_SSH_UPLOAD_PY} ${VC_DEPLOY_SSH_ALIAS} <本地归档> ${remote_archive} --resume"
  echo "远端: mkdir -p ${image_cache} && chmod 700 ${image_cache}"
  echo "远端: ${VC_DEPLOY_SSH_PYTHON} ${VC_DEPLOY_SSH_EXECUTE_PY} ${VC_DEPLOY_SSH_ALIAS} bash ${remote_script} --timeout 3600"
  echo "== 远端脚本 =="
  cat "$REMOTE_BODY"
}

# Dockerfile.st 需要按 upstream.lock.json 的干净上游克隆（gitignore，不在提交里）。
# 从本机已核验的检出各取当前 HEAD 做 depth 1 克隆，不带 node_modules；镜像内 bootstrap 再核对锁定 commit。
prepare_upstream_clones() {
  local wt="$1" src_root="${VC_DEPLOY_UPSTREAM_DIR:-$REPO_ROOT/integrations/sillytavern/upstream}" src dest
  [ -d "$src_root" ] || { echo "FAIL: 缺少上游检出目录" >&2; exit 1; }
  rm -rf "$wt/integrations/sillytavern/upstream"
  mkdir -p "$wt/integrations/sillytavern/upstream"
  for src in "$src_root"/*/; do
    src=${src%/}
    [ -d "$src/.git" ] || [ -f "$src/.git" ] || continue
    dest="$wt/integrations/sillytavern/upstream/$(basename "$src")"
    git init -q "$dest"
    git -C "$dest" fetch -q --depth 1 "file://$src" HEAD
    git -C "$dest" checkout -q --detach FETCH_HEAD
  done
}

build_images() {
  local st_image="$1" rt_image="$2" need_st="$3" need_rt="$4"
  if [ "$need_st" -eq 0 ] && [ "$need_rt" -eq 0 ]; then
    return 0
  fi
  WT=$(mktemp -d "${TMPDIR:-/tmp}/vc-deploy-src.XXXXXX")
  chmod 700 "$WT"
  git -C "$REPO_ROOT" worktree add --detach "$WT" "$FULL"
  if [ "$need_st" -eq 1 ]; then
    prepare_upstream_clones "$WT"
    echo "构建 ${st_image}"
    "$VC_DEPLOY_DOCKER" buildx build --platform linux/amd64 --load \
      -t "$st_image" \
      --build-arg "VC_PUBLIC_HOST=${VC_PUBLIC_HOST}" \
      -f "$WT/ops/deploy/v2/Dockerfile.st" \
      "$WT"
  fi
  if [ "$need_rt" -eq 1 ]; then
    echo "构建 ${rt_image}"
    "$VC_DEPLOY_DOCKER" buildx build --platform linux/amd64 --load \
      -t "$rt_image" \
      -f "$WT/backend/Dockerfile" \
      "$WT/backend"
  fi
}

deploy_main() {
  local st_image rt_image need_st need_rt miss image_cache remote_archive remote_script local_archive remote_cmd
  parse_args "$@"
  load_local_config
  apply_defaults
  resolve_commit "$COMMIT"
  st_image="virtual-companion-st:${TAG}"
  rt_image="virtual-companion-runtime:${TAG}"
  need_st=0
  need_rt=0
  if image_exists "$st_image"; then
    echo "跳过构建 ${st_image}"
  else
    need_st=1
  fi
  if image_exists "$rt_image"; then
    echo "跳过构建 ${rt_image}"
  else
    need_rt=1
  fi
  if [ "$SKIP" -eq 1 ]; then
    miss=""
    if [ "$need_st" -eq 1 ]; then
      miss="$st_image"
    fi
    if [ "$need_rt" -eq 1 ]; then
      miss="${miss:+$miss }$rt_image"
    fi
    if [ -n "$miss" ]; then
      echo "FAIL: 缺少镜像 $miss" >&2
      exit 1
    fi
  fi
  if [ "$need_st" -eq 1 ] && [ -z "${VC_PUBLIC_HOST:-}" ]; then
    echo "FAIL: 缺少 VC_PUBLIC_HOST" >&2
    exit 1
  fi
  if [ "$DRY" -eq 1 ]; then
    print_plan "$st_image" "$rt_image" "$need_st" "$need_rt"
    exit 0
  fi

  WORK=$(mktemp -d "${TMPDIR:-/tmp}/vc-deploy.XXXXXX")
  chmod 700 "$WORK"
  image_cache="$(dirname "$VC_DEPLOY_SOURCE_DIR")/image-cache"
  remote_archive="${image_cache}/vc-images-${TAG}.tar.gz"
  remote_script="${image_cache}/remote-deploy.sh"
  remote_bundle="${image_cache}/vc-src-${TAG}.bundle"
  run_remote "mkdir -p $(printf '%q' "$image_cache") && chmod 700 $(printf '%q' "$image_cache")"
  # 服务器已有同标签镜像（上次中途失败）时不再构建和上传。
  remote_has=$(run_remote "docker image inspect $(printf '%q' "$st_image") $(printf '%q' "$rt_image") >/dev/null 2>&1 && echo present || echo missing") || remote_has=missing
  if [ "$remote_has" = present ]; then
    echo "服务器已有镜像 ${TAG}，跳过构建与上传"
    remote_archive=""
  else
    build_images "$st_image" "$rt_image" "$need_st" "$need_rt"
    "$VC_DEPLOY_DOCKER" image inspect "$st_image" "$rt_image" >/dev/null
    local_archive="${WORK}/vc-images-${TAG}.tar.gz"
    "$VC_DEPLOY_DOCKER" save "$st_image" "$rt_image" | gzip > "$local_archive"
    run_upload "$local_archive" "$remote_archive"
  fi
  # 服务器访问 GitHub 不稳定：源码以 git bundle 随部署上传。
  local_bundle="${WORK}/vc-src-${TAG}.bundle"
  git -C "$REPO_ROOT" update-ref "refs/vc-deploy/${TAG}" "$FULL"
  git -C "$REPO_ROOT" bundle create -q "$local_bundle" "refs/vc-deploy/${TAG}"
  git -C "$REPO_ROOT" update-ref -d "refs/vc-deploy/${TAG}"
  run_upload "$local_bundle" "$remote_bundle"
  run_upload "$REMOTE_BODY" "$remote_script"
  remote_cmd=$(printf 'chmod 700 %q && VC_NEW_IMAGE_TAG=%q VC_COMMIT=%q VC_IMAGE_ARCHIVE=%q VC_SRC_BUNDLE=%q VC_DEPLOY_SOURCE_DIR=%q VC_DEPLOY_COMPOSE_ENV=%q VC_DEPLOY_BACKUP_DIR=%q VC_DEPLOY_BACKUP_PASSPHRASE_FILE=%q VC_DEPLOY_ST_CONFIG=%q VC_DEPLOY_PREVIOUS_TAG_FILE=%q bash %q' \
    "$remote_script" "$TAG" "$FULL" "$remote_archive" "$remote_bundle" \
    "$VC_DEPLOY_SOURCE_DIR" "$VC_DEPLOY_COMPOSE_ENV" "$VC_DEPLOY_BACKUP_DIR" \
    "$VC_DEPLOY_BACKUP_PASSPHRASE_FILE" "$VC_DEPLOY_ST_CONFIG" "$VC_DEPLOY_PREVIOUS_TAG_FILE" \
    "$remote_script")
  run_remote "$remote_cmd"
}

WORK=""
WT=""
cleanup() {
  if [ -n "$WORK" ]; then
    rm -rf "$WORK"
  fi
  if [ -n "$WT" ]; then
    git -C "$REPO_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
