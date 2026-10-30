#!/usr/bin/env bash
# Read-only export on the deployment host. Prints only EXPORT_DIR.
# Does not stop services and does not print secret values.
set -euo pipefail
umask 077

OUT=${VC_EXPORT_OUT:-$(mktemp -d /tmp/vc-local-export.XXXXXX)}
chmod 700 "$OUT"
mkdir -p "$OUT/postgres" "$OUT/st" "$OUT/memorycore"
PROJECT=${VC_PROD_COMPOSE_PROJECT:-vc-v2}
ENV_DIR=${VC_PROD_ENV_DIR:-/etc/virtual-companion}

awk -F= '
  $1=="VC_CRYPTO_REST_KEY" || $1=="VC_CRYPTO_REST_KEY_ID" || $1=="VC_CRYPTO_REST_KEY_VERSION" ||
  $1=="VC_CRYPTO_PREVIOUS_REST_KEY" || $1=="VC_CRYPTO_PREVIOUS_REST_KEY_ID" ||
  $1=="VC_CRYPTO_PREVIOUS_REST_KEY_VERSION" || $1=="VC_OWNER_BINDING_SECRET" { print }
' "$ENV_DIR/runtime.env" > "$OUT/secrets.env"
if [[ -f "$ENV_DIR/st.env" ]]; then
    awk -F= '$1=="VC_ST_ACCOUNT_HANDLES" { print }' "$ENV_DIR/st.env" >> "$OUT/secrets.env"
fi
chmod 600 "$OUT/secrets.env"

cid_for() {
    local service="$1" ids first
    ids=$(docker ps -q \
        --filter "label=com.docker.compose.project=${PROJECT}" \
        --filter "label=com.docker.compose.service=${service}")
    first=${ids%%$'\n'*}
    printf '%s\n' "$first"
}

db=$(cid_for db)
[[ -n "$db" ]] || { echo "FAIL: database container is not running" >&2; exit 1; }
docker exec "$db" pg_dump -U vc_migrator -Fc --dbname=vc > "$OUT/postgres/vc.dump"

copy_volume() {
    local service="$1" volume="$2" dest="$3" cid img
    cid=$(cid_for "$service")
    [[ -n "$cid" ]] || { echo "FAIL: ${service} container is not running" >&2; exit 1; }
    img=$(docker inspect -f '{{.Config.Image}}' "$cid")
    docker run --rm --user 0 --entrypoint /usr/bin/tar \
        -v "${volume}:/data:ro" \
        -v "${dest}:/out" \
        "$img" \
        -C /data -cf /out/files.tar .
    tar -C "$dest" -xf "$dest/files.tar"
    rm -f "$dest/files.tar"
}

copy_volume st "${PROJECT}_st-data" "$OUT/st"
copy_volume memorycore "${PROJECT}_memorycore-data" "$OUT/memorycore"

copy_minio() {
    local minio img
    minio=$(cid_for minio)
    [[ -n "$minio" && -f "$ENV_DIR/minio.env" ]] || return 0
    img=$(docker inspect -f '{{.Config.Image}}' "$minio")
    mkdir -p "$OUT/minio"
    docker run --rm --network "container:${minio}" \
        --env-file "$ENV_DIR/minio.env" \
        -v "$OUT/minio:/export" \
        --entrypoint /bin/sh \
        "$img" -s <<'EOS'
set -eu
umask 077
cfg=$(mktemp -d)
trap 'rm -rf "$cfg"' EXIT
access=${VC_EXPORT_S3_ACCESS_KEY:-${MINIO_ROOT_USER:-}}
secret=${VC_EXPORT_S3_SECRET_KEY:-${MINIO_ROOT_PASSWORD:-}}
bucket=${VC_EXPORT_S3_BUCKET:-vc-exports}
[ -n "$access" ] && [ -n "$secret" ] || exit 0
export ACCESS_VALUE="$access" SECRET_VALUE="$secret"
awk 'BEGIN {
  access = ENVIRON["ACCESS_VALUE"]
  secret = ENVIRON["SECRET_VALUE"]
  gsub(/\\/, "\\\\", access)
  gsub(/"/, "\\\"", access)
  gsub(/\\/, "\\\\", secret)
  gsub(/"/, "\\\"", secret)
  printf "{\"version\":\"10\",\"aliases\":{\"local\":{\"url\":\"http://127.0.0.1:9000\",\"accessKey\":\"%s\",\"secretKey\":\"%s\",\"api\":\"S3v4\",\"path\":\"auto\"}}}\n", access, secret
}' > "$cfg/config.json"
chmod 600 "$cfg/config.json"
count=$(mc --config-dir "$cfg" ls --recursive "local/$bucket" 2>/dev/null | wc -l | tr -d " " || true)
[ "${count:-0}" = "0" ] && exit 0
mc --config-dir "$cfg" mirror --overwrite "local/$bucket" /export >/dev/null
EOS
}

if ! copy_minio; then
    rm -rf "$OUT/minio"
    echo "MINIO_SKIP" >&2
fi

printf 'EXPORT_DIR=%s\n' "$OUT"
