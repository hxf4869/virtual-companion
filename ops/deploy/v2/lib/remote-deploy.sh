#!/usr/bin/env bash
# 在服务器上执行：加载镜像、备份、同步到目标提交、只改 VC_IMAGE_TAG、升级并自检。
# 由 deploy.sh 经 ssh-skill 调用。不读取或打印 compose.env 的值、密钥、域名或 IP。
set -euo pipefail
umask 077

: "${VC_NEW_IMAGE_TAG:?}"
: "${VC_COMMIT:?}"
: "${VC_IMAGE_ARCHIVE:?}"
: "${VC_SRC_BUNDLE:?}"
: "${VC_DEPLOY_SOURCE_DIR:?}"
: "${VC_DEPLOY_COMPOSE_ENV:?}"
: "${VC_DEPLOY_BACKUP_DIR:?}"
: "${VC_DEPLOY_BACKUP_PASSPHRASE_FILE:?}"
: "${VC_DEPLOY_ST_CONFIG:?}"
: "${VC_DEPLOY_PREVIOUS_TAG_FILE:?}"

die() {
  echo "FAIL: $*" >&2
  exit 1
}

file_mode() {
  local mode
  mode=$(stat -c '%a' "$1" 2>/dev/null) || mode=$(stat -f '%OLp' "$1")
  printf '%s' "$mode"
}

safe_token() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 128 ]
}

strip_quotes() {
  local val="$1"
  case "$val" in
    \"*\") val=${val#\"}; val=${val%\"} ;;
    \'*\') val=${val#\'}; val=${val%\'} ;;
  esac
  printf '%s' "$val"
}

compose_raw() {
  local key="$1" file="$2" line val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
      "$key"=*)
        val=${line#"$key"=}
        strip_quotes "$val"
        return 0
        ;;
    esac
  done < "$file"
  return 1
}

compose_present() {
  local val
  val=$(compose_raw "$1" "$2") || return 1
  [ -n "$val" ]
}

require_compose() {
  local file="$1" key missing
  missing=""
  for key in VC_IMAGE_TAG VC_PUBLIC_HOST VC_EDGE_SUBNET VC_EDGE_INGRESS_IP VC_EMBEDDING_IMAGE VC_EMBEDDING_MODELS_DIR VC_RERANK_MODELS_DIR; do
    if ! compose_present "$key" "$file"; then
      missing="${missing:+$missing }$key"
    fi
  done
  if [ -n "$missing" ]; then
    echo "FAIL: compose.env 缺少变量: $missing" >&2
    exit 1
  fi
}

print_rollback() {
  echo "FAIL: 未自动回退。" >&2
  echo "回退：把 ${VC_DEPLOY_COMPOSE_ENV} 的 VC_IMAGE_TAG 改回升级前的值（已写入 ${VC_DEPLOY_PREVIOUS_TAG_FILE}），然后在 ${VC_DEPLOY_SOURCE_DIR} 执行：" >&2
  echo "docker compose --env-file ${VC_DEPLOY_COMPOSE_ENV} -f ops/deploy/v2/compose.yaml up -d --force-recreate --wait" >&2
}

rewrite_tag() {
  local file="$1" tag="$2" tmp mode
  tmp=$(mktemp "${file}.XXXXXX")
  if ! awk -v tag="$tag" '
    BEGIN { found = 0 }
    /^VC_IMAGE_TAG=/ { print "VC_IMAGE_TAG=" tag; found = 1; next }
    { print }
    END { if (found == 0) exit 3 }
  ' "$file" > "$tmp"; then
    rm -f "$tmp"
    die "无法更新 VC_IMAGE_TAG"
  fi
  mode=$(file_mode "$file")
  chmod "$mode" "$tmp"
  mv "$tmp" "$file"
}

compose() {
  docker compose --env-file "$VC_DEPLOY_COMPOSE_ENV" -f ops/deploy/v2/compose.yaml "$@"
}

service_ok() {
  local svc="$1" state="$2" health="$3" code="$4"
  case "$svc" in
    ingress)
      [ "$state" = "running" ]
      ;;
    migrate|bootstrap|minio-init)
      [ "$state" = "exited" ] && [ "$code" = "0" ]
      ;;
    db|minio|runtime|embedding|rerank|memorycore|st)
      [ "$state" = "running" ] && [ "$health" = "healthy" ]
      ;;
    *)
      return 1
      ;;
  esac
}

safe_token "$VC_NEW_IMAGE_TAG" || die "目标标签无效"
case "$VC_COMMIT" in
  ''|*[!0-9a-f]*) die "目标提交无效" ;;
esac

if [ "$VC_IMAGE_ARCHIVE" != none ]; then
  [ -f "$VC_IMAGE_ARCHIVE" ] || die "找不到镜像包"
  gzip -dc "$VC_IMAGE_ARCHIVE" | docker load
  rm -f "$VC_IMAGE_ARCHIVE"
fi
docker image inspect \
  "virtual-companion-st:${VC_NEW_IMAGE_TAG}" \
  "virtual-companion-runtime:${VC_NEW_IMAGE_TAG}" >/dev/null || die "服务器缺少目标镜像"

cd "$VC_DEPLOY_SOURCE_DIR"

[ -f "$VC_DEPLOY_BACKUP_PASSPHRASE_FILE" ] || die "缺少 VC_DEPLOY_BACKUP_PASSPHRASE_FILE"
[ "$(file_mode "$VC_DEPLOY_BACKUP_PASSPHRASE_FILE")" = "600" ] || die "VC_DEPLOY_BACKUP_PASSPHRASE_FILE 必须是 0600"
[ -f "$VC_DEPLOY_ST_CONFIG" ] || die "缺少 VC_DEPLOY_ST_CONFIG"

# 按 Compose 标签找卷；手动建过的卷没有标签，再按 Compose 默认卷名 <project>_<volume> 找。
find_volume() {
  local found
  found=$(docker volume ls -q --filter label=com.docker.compose.project=vc-v2 --filter "label=com.docker.compose.volume=$1")
  if [ -z "$found" ] && docker volume inspect "vc-v2_$1" >/dev/null 2>&1; then
    found="vc-v2_$1"
  fi
  printf '%s' "$found"
}
st_vol=$(find_volume st-data)
mc_vol=$(find_volume memorycore-data)
[ -n "$st_vol" ] && [ -n "$mc_vol" ] || die "找不到数据卷"
st_root=$(docker volume inspect --format '{{.Mountpoint}}' "$st_vol")
mc_root=$(docker volume inspect --format '{{.Mountpoint}}' "$mc_vol")
[ -d "$st_root" ] && [ -d "$mc_root" ] || die "数据卷未挂载"

db_id=$(compose ps -q db)
[ -n "$db_id" ] || die "找不到数据库容器"
db_name=$(docker inspect --format '{{.Name}}' "$db_id")
db_name=${db_name#/}
safe_token "$db_name" || die "数据库容器名无效"

# 先切到目标提交再备份：备份用目标提交里的 backup.sh。运行中的服务到 compose up 才换。
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: 工作区不干净，已停止" >&2
  exit 1
fi
[ -f "$VC_SRC_BUNDLE" ] || die "找不到源码包"
git fetch -q "$VC_SRC_BUNDLE" "refs/vc-deploy/${VC_NEW_IMAGE_TAG}"
rm -f "$VC_SRC_BUNDLE"
prev_head=$(git rev-parse HEAD)
git checkout --detach "$VC_COMMIT"

mkdir -p "$VC_DEPLOY_BACKUP_DIR"
chmod 700 "$VC_DEPLOY_BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
export VC_ST_BACKUP_PASSPHRASE_FILE="$VC_DEPLOY_BACKUP_PASSPHRASE_FILE"
export VC_BACKUP_PG_CONTAINER="$db_name"
export VC_BACKUP_PG_DATABASE=vc
export VC_MEMORYCORE_DATA_ROOT="$mc_root"
export VC_MEMORYCORE_PG_CONTAINER="$db_name"
export VC_MEMORYCORE_PG_USER=vc_migrator
export VC_BACKUP_PG_USER=vc_migrator
# MemoryCore 运行时持有 runtime.lock（容器内 pid），备份前先停服务再清锁；部署随后整体重建。
compose stop memorycore >/dev/null
rm -f "$mc_root/runtime.lock"
if ! bash integrations/sillytavern/scripts/backup.sh \
  "$st_root" \
  "$VC_DEPLOY_ST_CONFIG" \
  "$VC_DEPLOY_BACKUP_DIR/vc-${stamp}.vcbae1"; then
  git checkout -q --detach "$prev_head"
  compose start memorycore >/dev/null || true
  die "备份失败，已停止（源码已切回原版本，MemoryCore 已重新启动）"
fi


[ -f "$VC_DEPLOY_COMPOSE_ENV" ] || die "缺少 compose.env"
require_compose "$VC_DEPLOY_COMPOSE_ENV"
old_tag=$(compose_raw VC_IMAGE_TAG "$VC_DEPLOY_COMPOSE_ENV") || die "缺少变量: VC_IMAGE_TAG"
safe_token "$old_tag" || die "VC_IMAGE_TAG 格式无效"
printf '%s\n' "$old_tag" > "$VC_DEPLOY_PREVIOUS_TAG_FILE"
chmod 600 "$VC_DEPLOY_PREVIOUS_TAG_FILE"
rewrite_tag "$VC_DEPLOY_COMPOSE_ENV" "$VC_NEW_IMAGE_TAG"

# st-data 卷挂在镜像的数据目录上，镜像里的新扩展只在卷首次创建时复制一次。
# 每次部署把镜像自带的三个扩展同步进卷（旧版先打包备份），否则前端代码不会更新。
ext_img="virtual-companion-st:${VC_NEW_IMAGE_TAG}"
docker run --rm -v "${st_vol}:/data:ro" --entrypoint tar "$ext_img" -C /data/default-user -czf - extensions \
  > "$VC_DEPLOY_BACKUP_DIR/extensions-before-${VC_NEW_IMAGE_TAG}.tgz" || die "扩展备份失败"
chmod 600 "$VC_DEPLOY_BACKUP_DIR/extensions-before-${VC_NEW_IMAGE_TAG}.tgz"
docker run --rm --entrypoint tar "$ext_img" -C /srv/vc-managed/data/default-user/extensions -cf - . \
  | docker run --rm -i --user 1000:1000 -v "${st_vol}:/data" --entrypoint sh "$ext_img" -c \
    'set -e; d=/data/default-user/extensions; mkdir -p "$d"; for n in vc-model-settings JS-Slash-Runner ST-Prompt-Template; do rm -rf "$d/$n"; done; tar -xf - -C "$d"' \
  || die "扩展同步失败"

if ! compose config -q >/dev/null; then
  echo "FAIL: compose config 未通过" >&2
  print_rollback
  exit 1
fi
if ! compose up -d --force-recreate --no-build --pull=never --wait --wait-timeout=600; then
  echo "FAIL: compose up 失败" >&2
  print_rollback
  exit 1
fi

echo "== 部署摘要 =="
health_fail=0
ps_out=$(compose ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}') || {
  echo "FAIL: 无法读取容器状态" >&2
  print_rollback
  exit 1
}
seen=" "
bad=0
while IFS='|' read -r svc state health code; do
  [ -n "$svc" ] || continue
  seen="${seen}${svc} "
  if ! service_ok "$svc" "$state" "$health" "$code"; then
    echo "FAIL: 容器不健康: $svc" >&2
    bad=1
  fi
done <<EOF
$ps_out
EOF
for svc in ingress db migrate bootstrap minio minio-init runtime embedding rerank memorycore st; do
  case "$seen" in
    *" ${svc} "*) ;;
    *) echo "FAIL: 容器不健康: $svc" >&2; bad=1 ;;
  esac
done
if [ "$bad" -eq 0 ]; then
  echo "容器健康: ok"
else
  health_fail=1
fi

sql_dir="backend/internal/migrate/sql"
count=0
latest=0
for f in "$sql_dir"/V*.sql; do
  [ -e "$f" ] || continue
  base=$(basename "$f")
  ver=${base#V}
  ver=${ver%%__*}
  case "$ver" in
    ''|*[!0-9]*)
      echo "FAIL: 迁移文件名无效" >&2
      health_fail=1
      continue
      ;;
  esac
  count=$((count + 1))
  if [ "$ver" -gt "$latest" ]; then
    latest=$ver
  fi
done
if [ "$count" -eq 0 ]; then
  echo "FAIL: 没有迁移文件" >&2
  health_fail=1
fi
rc=0
schema_line=$(compose exec -T db psql -U vc_migrator -d vc -Atc "SELECT count(*)::text || ' ' || coalesce(max(version),0)::text FROM public.vc_schema_history") || rc=$?
got_count=${schema_line%% *}
got_latest=${schema_line##* }
if [ "$count" -eq 0 ] || [ "$rc" -ne 0 ]; then
  if [ "$rc" -ne 0 ]; then
    echo "FAIL: 无法读取迁移" >&2
    health_fail=1
  fi
elif [ "$got_count" != "$count" ] || [ "$got_latest" != "$latest" ]; then
  echo "FAIL: 迁移不一致（目录 ${count} 个、最新 V${latest}）" >&2
  health_fail=1
else
  echo "迁移: ${count} 个，最新 V${latest}"
fi

rc=0
health_body=$(compose exec -T runtime wget -q -O - http://127.0.0.1:8095/actuator/health) || rc=$?
if [ "$rc" -ne 0 ] || ! printf '%s' "$health_body" | grep -q 'UP'; then
  echo "FAIL: Go health" >&2
  health_fail=1
else
  echo "Go health: UP"
fi

rc=0
ready_body=$(compose exec -T memorycore node -e 'fetch("http://127.0.0.1:8754/readyz",{headers:{authorization:"Bearer "+process.env.VC_MEMORYCORE_SERVICE_TOKEN}}).then(async r=>{const b=await r.json(); if(!(r.ok&&b.foundation&&b.storageReady&&b.businessReady)) process.exit(1); process.stdout.write("ready")}).catch(()=>process.exit(1))') || rc=$?
if [ "$rc" -ne 0 ] || [ "$ready_body" != "ready" ]; then
  echo "FAIL: MemoryCore readyz" >&2
  health_fail=1
else
  echo "MemoryCore readyz: ready"
fi

if ! compose exec -T st node -e 'fetch("http://127.0.0.1:8752/auth/").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null; then
  echo "FAIL: ST 登录页" >&2
  health_fail=1
else
  echo "ST 登录页: ok"
fi

rc=0
model_body=$(compose exec -T memorycore node -e 'fetch("http://127.0.0.1:8754/internal/local-models",{headers:{authorization:"Bearer "+process.env.VC_MEMORYCORE_SERVICE_TOKEN}}).then(async r=>{const b=await r.json(); if(!(r.ok&&b.embedding&&b.embedding.healthy===true&&b.rerank&&b.rerank.healthy===true)) process.exit(1); process.stdout.write("healthy")}).catch(()=>process.exit(1))') || rc=$?
if [ "$rc" -ne 0 ] || [ "$model_body" != "healthy" ]; then
  echo "FAIL: 重排或向量不健康" >&2
  health_fail=1
else
  echo "重排: ok"
  echo "向量: ok"
fi

if [ "$health_fail" -ne 0 ]; then
  print_rollback
  exit 1
fi
echo "部署完成: ${VC_COMMIT} 标签 ${VC_NEW_IMAGE_TAG}"
