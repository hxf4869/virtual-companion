#!/bin/sh
# Dispatches to the bundled MinIO binaries so a single image serves both
# compose services: `minio` (or any minio subcommand) runs the server, `mc`
# runs the client, and `minio-init` runs the bucket bootstrap script.
set -eu

case "${1:-}" in
    minio-init)
        shift
        exec /usr/local/bin/minio-init.sh "$@"
        ;;
    mc)
        shift
        exec /usr/local/bin/mc "$@"
        ;;
    minio)
        shift
        exec /usr/local/bin/minio "$@"
        ;;
    *)
        # Matches the retired upstream image: the entrypoint is minio itself,
        # so `server /data ...` works without an explicit binary token.
        exec /usr/local/bin/minio "$@"
        ;;
esac
