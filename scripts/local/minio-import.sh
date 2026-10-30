#!/bin/sh
# Import objects already mounted at /import. Credentials come from the
# container environment and are written only to a 0700 mc config.
set -eu
umask 077
if [ -z "${VC_EXPORT_S3_ACCESS_KEY:-}" ]; then
    VC_EXPORT_S3_ACCESS_KEY=${MINIO_ROOT_USER:-}
    VC_EXPORT_S3_SECRET_KEY=${MINIO_ROOT_PASSWORD:-}
    export VC_EXPORT_S3_ACCESS_KEY VC_EXPORT_S3_SECRET_KEY
fi
: "${VC_EXPORT_S3_ACCESS_KEY:?VC_EXPORT_S3_ACCESS_KEY is required}"
: "${VC_EXPORT_S3_SECRET_KEY:?VC_EXPORT_S3_SECRET_KEY is required}"
bucket="${VC_EXPORT_S3_BUCKET:-vc-exports}"
cfg=$(mktemp -d)
chmod 700 "$cfg"
trap 'rm -rf "$cfg"' EXIT

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

{
    printf '%s\n' '{' '  "version": "10",' '  "aliases": {' '    "local": {'
    printf '      "url": "http://minio:9000",\n'
    printf '      "accessKey": "%s",\n' "$(json_escape VC_EXPORT_S3_ACCESS_KEY)"
    printf '      "secretKey": "%s",\n' "$(json_escape VC_EXPORT_S3_SECRET_KEY)"
    printf '%s\n' '      "api": "S3v4",' '      "path": "auto"' '    }' '  }' '}'
} > "$cfg/config.json"
chmod 600 "$cfg/config.json"
mc --config-dir "$cfg" mb --ignore-existing "local/$bucket" >/dev/null
mc --config-dir "$cfg" cp --recursive /import/ "local/$bucket/" >/dev/null
