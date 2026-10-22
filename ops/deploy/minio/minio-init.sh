#!/bin/sh
# Bucket bootstrap for the export MinIO (VC-R54). Credentials are read from
# the environment and written to a private mc config v10 config.json under
# MC_CONFIG_DIR (a tmpfs mounted by the compose service), so unlike the retired
# `mc alias set` entrypoint they never appear in argv, image layers, or logs.
set -eu
export LC_ALL=C
export MC_UPDATE=off
export MINIO_UPDATE=off

: "${VC_EXPORT_S3_ACCESS_KEY:?VC_EXPORT_S3_ACCESS_KEY is required}"
: "${VC_EXPORT_S3_SECRET_KEY:?VC_EXPORT_S3_SECRET_KEY is required}"
bucket="${VC_EXPORT_S3_BUCKET:-vc-exports}"
config_dir="${MC_CONFIG_DIR:?MC_CONFIG_DIR is required}"

mkdir -p "$config_dir"
chmod 0700 "$config_dir"

# json_escape VAR prints the value of environment variable VAR as a JSON
# string body. The value is read through awk's ENVIRON, so every byte an env
# var can carry (embedded newlines included) round-trips without shell word
# splitting; quotes, backslashes, and all C0 control characters are escaped
# so the resulting config.json is valid JSON and the secret is preserved
# verbatim. Values that are not valid UTF-8 cannot survive Go's JSON decoder
# and are out of scope for env-provided credentials.
json_escape() {
    awk -v var="$1" 'BEGIN {
        for (i = 0; i < 256; i++) ord[sprintf("%c", i)] = i
        value = ENVIRON[var]
        out = ""
        for (i = 1; i <= length(value); i++) {
            c = substr(value, i, 1)
            if (c == "\"") out = out "\\\""
            else if (c == "\\") out = out "\\\\"
            else if (c == "\b") out = out "\\b"
            else if (c == "\f") out = out "\\f"
            else if (c == "\n") out = out "\\n"
            else if (c == "\r") out = out "\\r"
            else if (c == "\t") out = out "\\t"
            else if (ord[c] < 32) out = out sprintf("\\u00%02x", ord[c])
            else out = out c
        }
        printf "%s", out
    }'
}

umask 077
{
    printf '%s\n' \
        '{' \
        '  "version": "10",' \
        '  "aliases": {' \
        '    "local": {'
    printf '      "url": "http://minio:9000",\n'
    printf '      "accessKey": "%s",\n' "$(json_escape VC_EXPORT_S3_ACCESS_KEY)"
    printf '      "secretKey": "%s",\n' "$(json_escape VC_EXPORT_S3_SECRET_KEY)"
    printf '%s\n' \
        '      "api": "S3v4",' \
        '      "path": "auto"' \
        '    }' \
        '  }' \
        '}'
} > "$config_dir/config.json"
chmod 0600 "$config_dir/config.json"

# mb authenticates with the written config, so a mismatched credential pair
# fails this job instead of being silently ignored.
mc --config-dir "$config_dir" mb --ignore-existing "local/$bucket"
perm="$(mc --config-dir "$config_dir" anonymous get "local/$bucket")"
case "$perm" in
    *none*|*private*) ;;
    *) echo 'export bucket must not allow anonymous access' >&2; exit 1 ;;
esac
