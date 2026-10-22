# Production MinIO + mc packaging (VC-R54). The pinned upstream OCI images
# minio/minio:RELEASE.2025-09-07T16-13-09Z and minio/mc:RELEASE.2025-08-13T08-35-41Z
# became unobtainable from their registries (VC-R19), so this image carries the
# same official release binaries fetched from the GitHub release assets and
# fixed by sha256 — the identical checksums already used by the E2E-only
# scripts/dev/Dockerfile.e2e-minio-tools. Unlike that scratch image, this one
# is based on the Alpine image the backend production image already uses, so
# a shell and BusyBox are available for the healthcheck and the bucket-init
# script. Same binaries in a new packaging: this is NOT a reproduction of the
# retired OCI image digests.
ARG TARGETARCH

FROM alpine:3.23.3@sha256:25109184c71bdad752c8312a8623239686a9a2071e8825f20acb8f2198c3f659 AS tools-arm64
ADD --checksum=sha256:5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d --chmod=0755 \
    https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-arm64.RELEASE.2025-09-07T16-13-09Z \
    /usr/local/bin/minio
ADD --checksum=sha256:14c8c9616cfce4636add161304353244e8de383b2e2752c0e9dad01d4c27c12c --chmod=0755 \
    https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z/mc.linux-arm64.RELEASE.2025-08-13T08-35-41Z \
    /usr/local/bin/mc

FROM alpine:3.23.3@sha256:25109184c71bdad752c8312a8623239686a9a2071e8825f20acb8f2198c3f659 AS tools-amd64
ADD --checksum=sha256:7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f --chmod=0755 \
    https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z \
    /usr/local/bin/minio
ADD --checksum=sha256:01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891 --chmod=0755 \
    https://github.com/minio/mc/releases/download/RELEASE.2025-08-13T08-35-41Z/mc.linux-amd64.RELEASE.2025-08-13T08-35-41Z \
    /usr/local/bin/mc

FROM tools-${TARGETARCH}
# The retired upstream minio/minio and minio/mc images also ran as root by
# default; keep that default so an existing minio-data volume written by the
# old image stays writable without a UID migration. The compose file mounts
# the named data volume explicitly, so no VOLUME is declared here.
COPY --chmod=0755 minio-entrypoint.sh minio-init.sh /usr/local/bin/
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio-entrypoint.sh"]
