#!/usr/bin/env bash
# DOGFOOD-03 / ADR-0006 §7.4: daily local encrypted backup covering PostgreSQL
# AND MinIO objects, kept 7 days, never synced to any cloud. The account
# deletion tombstone manifest is encrypted to a SEPARATE directory outside the
# backup archive location.
#
# Artifacts (authenticated encryption: encrypt-then-MAC, see vc_aead.py)
#   $VC_BACKUP_DIR/vc-backup-YYYYMMDD-HHMMSS.tar.enc     (0600)
#       VCBAE1 container { magic+header | tar{ db.dump (pg_dump -Fc),
#       objects/ (MinIO mirror, FULL mode only), backup-manifest.txt }
#       encrypted via openssl enc -aes-256-cbc -pbkdf2 -salt | HMAC-SHA256
#       trailer over magic+header+ciphertext }. openssl alone is NOT
#       authenticated; the independent MAC (python3 stdlib hmac/hashlib,
#       domain-separated PBKDF2 key) makes wrong-passphrase / tampered-
#       ciphertext / tampered-MAC fail BEFORE any decryption.
#       Pre-authentication legacy files (openssl-only, "Salted__" magic) are
#       NOT migrated: they keep aging out via the 7-day retention.
#   $VC_BACKUP_MANIFEST_DIR/deletion-manifest-YYYYMMDD-HHMMSS.enc (0600)
#       vc.export_account_deletion_tombstones() rows, separately encrypted in
#       the SAME authenticated container format.  A pre-V104 database has no
#       export function yet, so its upgrade-before backup gets an authenticated
#       empty manifest (a tampered manifest must never be applied to a restored
#       database).
#
# Configuration (environment; no secrets may ever be committed):
#   VC_BACKUP_DIR             default ~/.virtual-companion/backups
#                             (outside the repository)
#   VC_BACKUP_MANIFEST_DIR    default ~/.virtual-companion/deletion-manifests
#                             MUST differ from VC_BACKUP_DIR (checked at start)
#   VC_BACKUP_PASSPHRASE      passphrase via environment; passed to openssl as
#                             `-pass env:` so it never appears in argv/ps.
#   VC_BACKUP_PASSPHRASE_FILE alternative: 0600 keyfile read by openssl via
#                             `-pass file:` (recommended for launchd). Exactly
#                             one of the two is required.
#
#   PostgreSQL access is container-path only (the deploy compose db publishes
#   no host port, and the Mac has no local psql client), two variants:
#   1) VC_BACKUP_PG_CONTAINER set  -> docker exec into that container
#   2) default                      -> docker compose exec into the ops/deploy
#                                      stack (see -p / vars below)
#   VC_BACKUP_PG_CONTAINER       container name for variant 1
#   VC_BACKUP_COMPOSE_DIR        default <repo>/ops/deploy
#   VC_BACKUP_COMPOSE_PROJECT    default deploy (or -p flag)
#   VC_BACKUP_COMPOSE_ENV_FILE   default .env.local (relative to compose dir)
#   VC_BACKUP_COMPOSE_SERVICE    default db
#   VC_BACKUP_PG_USER            default vc_migrator (deploy bootstrap superuser;
#                                the tombstone functions are PUBLIC-revoked)
#   VC_BACKUP_DB_NAME            default vc
#
#   MinIO object export (FULL mode):
#   VC_BACKUP_S3_ENDPOINT       e.g. http://127.0.0.1:9000
#   VC_BACKUP_S3_ACCESS_KEY     / VC_BACKUP_S3_SECRET_KEY / VC_BACKUP_S3_BUCKET
#   VC_BACKUP_S3_DOCKER_NETWORK optional network for the pinned mc container;
#                                use the Compose network with a service-DNS
#                                endpoint when MinIO has no published host port
#   VC_BACKUP_MC_IMAGE          default minio/mc pinned digest
#   SKIP semantics (fail-safe choice): if NONE of the four S3 vars is set the
#   run still produces a DB-only archive, prints an explicit `SKIP: object
#   backup` line, and exits 2 — a launchd LastExitStatus failure is the only
#   reliably visible signal; a WARNING line would be silently lost while the
#   archive looks complete. A PARTIAL S3 configuration is a hard error (exit
#   5): that is a typo, never a deliberate mode. The MinIO endpoint/bucket
#   being unreachable, or the mirror failing mid-run, is a hard error (exit 4)
#   with a SANITIZED message: the endpoint URL, credentials and raw mc output
#   are never echoed.
#
#   Authenticated encryption needs python3 (macOS system python3 or
#   VC_BACKUP_PYTHON override; only the stdlib is used). python3 or the
#   vc_aead.py helper being unavailable is a hard error (exit 8) — the script
#   never falls back to unauthenticated encryption.
#
# Usage: bash infra/db/backup/run-daily-backup.sh [-p compose-project]
# Exit:  0 ok (FULL) | 2 DB-only (S3 config absent, SKIP logged)
#      | 4 MinIO endpoint/bucket unreachable or object mirror failed
#      | 5 partial VC_BACKUP_S3_* config | 6 archive self-check failed
#      | 7 manifest self-check failed   | 8 authenticated-encryption failure
#      | 1 other configuration errors

set -euo pipefail
umask 077

MC_IMAGE_DEFAULT="minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

COMPOSE_PROJECT="${VC_BACKUP_COMPOSE_PROJECT:-deploy}"
while getopts "p:h" opt; do
    case "$opt" in
        p) COMPOSE_PROJECT="$OPTARG" ;;
        h) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "usage: $0 [-p compose-project]" >&2; exit 64 ;;
    esac
done

BACKUP_DIR="${VC_BACKUP_DIR:-$HOME/.virtual-companion/backups}"
MANIFEST_DIR="${VC_BACKUP_MANIFEST_DIR:-$HOME/.virtual-companion/deletion-manifests}"
COMPOSE_DIR="${VC_BACKUP_COMPOSE_DIR:-$REPO_ROOT/ops/deploy}"
COMPOSE_ENV_FILE="${VC_BACKUP_COMPOSE_ENV_FILE:-.env.local}"
COMPOSE_SERVICE="${VC_BACKUP_COMPOSE_SERVICE:-db}"
PG_CONTAINER="${VC_BACKUP_PG_CONTAINER:-}"
PG_USER="${VC_BACKUP_PG_USER:-vc_migrator}"
DB_NAME="${VC_BACKUP_DB_NAME:-vc}"
S3_ENDPOINT="${VC_BACKUP_S3_ENDPOINT:-}"
S3_ACCESS_KEY="${VC_BACKUP_S3_ACCESS_KEY:-}"
S3_SECRET_KEY="${VC_BACKUP_S3_SECRET_KEY:-}"
S3_BUCKET="${VC_BACKUP_S3_BUCKET:-}"
S3_DOCKER_NETWORK="${VC_BACKUP_S3_DOCKER_NETWORK:-}"
MC_IMAGE="${VC_BACKUP_MC_IMAGE:-$MC_IMAGE_DEFAULT}"

# ---- fail-closed configuration checks -------------------------------
PASS_MODE=""
PASS_SRC=()   # passphrase source flags for vc_aead.py (secret never in argv)
if [ -n "${VC_BACKUP_PASSPHRASE_FILE:-}" ]; then
    [ -f "$VC_BACKUP_PASSPHRASE_FILE" ] || { echo "FAIL: VC_BACKUP_PASSPHRASE_FILE not found" >&2; exit 1; }
    [ "$(find "$VC_BACKUP_PASSPHRASE_FILE" -perm 0600)" = "$VC_BACKUP_PASSPHRASE_FILE" ] || {
        echo "FAIL: VC_BACKUP_PASSPHRASE_FILE must have mode 0600 (chmod 600)" >&2; exit 1; }
    PASS_MODE=file
    PASS_ARGS=(-pass "file:$VC_BACKUP_PASSPHRASE_FILE")
    PASS_SRC=(--pass-file "$VC_BACKUP_PASSPHRASE_FILE")
elif [ -n "${VC_BACKUP_PASSPHRASE:-}" ]; then
    PASS_MODE=env
    export VC_BACKUP_PASSPHRASE   # openssl child reads it via -pass env:
    PASS_ARGS=(-pass env:VC_BACKUP_PASSPHRASE)
    PASS_SRC=(--pass-env VC_BACKUP_PASSPHRASE)
else
    echo "FAIL: set VC_BACKUP_PASSPHRASE or VC_BACKUP_PASSPHRASE_FILE (0600)" >&2
    exit 1
fi

# ---- authenticated-encryption helper (python3 stdlib only) -----------
# launchd does not inherit the user PATH, so fall back to the system
# python3 shim explicitly; VC_BACKUP_PYTHON overrides both.
AAEAD_HELPER="$SCRIPT_DIR/vc_aead.py"
if [ -z "${VC_BACKUP_PYTHON:-}" ]; then
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="python3"
    elif [ -x /usr/bin/python3 ]; then
        PYTHON_BIN="/usr/bin/python3"
    else
        echo "FAIL: python3 not found — authenticated encryption requires it" \
             "(install Xcode Command Line Tools or set VC_BACKUP_PYTHON); never falling back to unauthenticated encryption" >&2
        exit 8
    fi
else
    PYTHON_BIN="$VC_BACKUP_PYTHON"
fi
[ -f "$AAEAD_HELPER" ] || {
    echo "FAIL: authenticated-encryption helper missing: vc_aead.py (expected next to run-daily-backup.sh)" >&2; exit 8; }
"$PYTHON_BIN" -c 'import hashlib, hmac, struct' >/dev/null 2>&1 || {
    echo "FAIL: python3 unusable (stdlib hmac/hashlib/struct check failed)" >&2; exit 8; }

BACKUP_DIR_RESOLVED="$(mkdir -p "$BACKUP_DIR" && cd "$BACKUP_DIR" && pwd -P)"
MANIFEST_DIR_RESOLVED="$(mkdir -p "$MANIFEST_DIR" && cd "$MANIFEST_DIR" && pwd -P)"
chmod 700 "$BACKUP_DIR_RESOLVED" "$MANIFEST_DIR_RESOLVED"
if [ "$BACKUP_DIR_RESOLVED" = "$MANIFEST_DIR_RESOLVED" ]; then
    echo "FAIL: VC_BACKUP_MANIFEST_DIR must differ from VC_BACKUP_DIR" \
         "(both resolve to $BACKUP_DIR_RESOLVED)" >&2
    exit 1
fi

S3_SET=0
[ -n "$S3_ENDPOINT" ]   && S3_SET=$((S3_SET + 1))
[ -n "$S3_ACCESS_KEY" ] && S3_SET=$((S3_SET + 1))
[ -n "$S3_SECRET_KEY" ] && S3_SET=$((S3_SET + 1))
[ -n "$S3_BUCKET" ]     && S3_SET=$((S3_SET + 1))
EXIT_CODE=0
OBJECT_MODE="FULL"
if [ "$S3_SET" -eq 0 ]; then
    OBJECT_MODE="DB_ONLY"
    EXIT_CODE=2
elif [ "$S3_SET" -lt 4 ]; then
    echo "FAIL: partial VC_BACKUP_S3_* configuration (${S3_SET}/4 set) — all or none required" >&2
    exit 5
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vc-daily-backup.XXXXXX")"
MC_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vc-daily-backup-mc.XXXXXX")"
chmod 700 "$MC_SECRET_DIR"
cleanup() { rm -rf "$WORK" "$MC_SECRET_DIR"; }
trap cleanup EXIT

STAMP="$(date +%Y%m%d-%H%M%S)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---- PostgreSQL runner (container exec or compose exec) --------------
pg_exec() {
    if [ -n "$PG_CONTAINER" ]; then
        docker exec "$PG_CONTAINER" "$@"
    else
        (cd "$COMPOSE_DIR" && docker compose -p "$COMPOSE_PROJECT" \
            --env-file "$COMPOSE_ENV_FILE" exec -T "$COMPOSE_SERVICE" "$@")
    fi
}
PG_DESC="${PG_CONTAINER:-compose:$COMPOSE_PROJECT/$COMPOSE_SERVICE}"

# ---- ① logical database dump ----------------------------------------
echo "== [1/6] pg_dump -Fc ($PG_DESC, db=$DB_NAME, user=$PG_USER) =="
pg_exec pg_dump -U "$PG_USER" -d "$DB_NAME" -Fc > "$WORK/db.dump"
DUMP_BYTES="$(wc -c < "$WORK/db.dump" | tr -d ' ')"
echo "  db.dump: $DUMP_BYTES bytes"

# ---- ② MinIO object export ------------------------------------------
OBJECT_COUNT=0
if [ "$OBJECT_MODE" = "FULL" ]; then
    echo "== [2/6] MinIO object export (bucket=$S3_BUCKET) =="
    # mc mirror may leave the destination absent for a legitimately empty
    # bucket.  Materialize it so the archive and object count still represent
    # an explicit, restorable zero-object snapshot.
    mkdir -p "$WORK/objects"
    MC_ENDPOINT="$S3_ENDPOINT"
    MC_BIN=""
    if command -v mc >/dev/null 2>&1; then MC_BIN="mc"; fi
    if [ -n "$MC_BIN" ]; then
        MC_SCHEME="http://"
        MC_HOSTPART="${MC_ENDPOINT#http://}"
        MC_SCHEME_BARE="${MC_ENDPOINT%%://*}"
        if [ "$MC_SCHEME_BARE" = "https" ]; then MC_SCHEME="https://"; MC_HOSTPART="${MC_ENDPOINT#https://}"; fi
        MC_HOST_URL="${MC_SCHEME}${S3_ACCESS_KEY}:${S3_SECRET_KEY}@${MC_HOSTPART}"
        OBJECTS_TARGET="$WORK/objects"              # local mc reaches 127.0.0.1 directly
        mc_run() { env MC_HOST_local="$MC_HOST_URL" "$MC_BIN" "$@"; }
    else
        # dockerized mc: an explicit Compose network reaches an unpublished
        # MinIO service by DNS.  Otherwise preserve the loopback-to-host
        # behavior used by standalone drills.
        MC_DOCKER_ARGS=(--rm)
        if [ -n "$S3_DOCKER_NETWORK" ]; then
            MC_DOCKER_ARGS+=(--network "$S3_DOCKER_NETWORK")
        else
            MC_ENDPOINT="$(sed -E 's#://(127\.0\.0\.1|localhost)([:/])#://host.docker.internal\2#' <<<"$MC_ENDPOINT")"
        fi
        case "$MC_ENDPOINT$S3_ACCESS_KEY$S3_SECRET_KEY" in
            *$'\n'*|*$'\r'*)
                echo "FAIL: MinIO endpoint and credentials must be single-line values" >&2
                exit 5
                ;;
        esac
        MC_SECRET_FILE="$MC_SECRET_DIR/credentials"
        printf '%s\n%s\n%s\n' "$MC_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > "$MC_SECRET_FILE"
        chmod 600 "$MC_SECRET_FILE"
        OBJECTS_TARGET="/work/objects"
        MC_ENTRYPOINT='set -eu
{
    IFS= read -r mc_endpoint
    IFS= read -r mc_access_key
    IFS= read -r mc_secret_key
} < /run/secrets/vc-mc
mc alias set local "$mc_endpoint" "$mc_access_key" "$mc_secret_key" >/dev/null
exec mc "$@"'
        mc_run() {
            docker run "${MC_DOCKER_ARGS[@]}" --entrypoint /bin/sh \
                -v "$MC_SECRET_FILE:/run/secrets/vc-mc:ro" \
                -v "$WORK:/work" "$MC_IMAGE" \
                -c "$MC_ENTRYPOINT" vc-backup-mc "$@"
        }
    fi
    # bucket must exist — an explicit hard error, never a silent empty export.
    # The message is deliberately STABLE and SANITIZED: no endpoint URL, no
    # credentials, no raw mc output (mc stderr stays in $WORK and is deleted).
    mc_run ls "local/$S3_BUCKET" >/dev/null 2>"$WORK/mc.err" || {
        echo "FAIL: MinIO endpoint/bucket '$S3_BUCKET' unreachable or credentials rejected — check the VC_BACKUP_S3_* configuration (exit 4)" >&2
        exit 4
    }
    mc_run mirror --overwrite "local/$S3_BUCKET" "$OBJECTS_TARGET" >>"$WORK/mc.log" 2>&1 || {
        echo "FAIL: object mirror failed for bucket '$S3_BUCKET' (endpoint/credentials/network; sanitized, exit 4)" >&2
        exit 4
    }
    OBJECT_COUNT="$(find "$WORK/objects" -type f 2>/dev/null | wc -l | tr -d ' ')"
    echo "  objects: $OBJECT_COUNT files mirrored"
else
    echo "== [2/6] SKIP: object backup — VC_BACKUP_S3_* not configured (DB-only archive, exit will be 2) =="
fi

# ---- ③ tar + authenticated encrypt + self-check ----------------------
echo "== [3/6] encrypting archive (openssl + HMAC-SHA256 seal) =="
TAR_MEMBERS=(db.dump backup-manifest.txt)
[ "$OBJECT_MODE" = "FULL" ] && TAR_MEMBERS+=(objects)
{
    echo "created=$NOW_ISO"
    echo "mode=$OBJECT_MODE"
    echo "pg=$PG_DESC"
    echo "database=$DB_NAME"
    echo "dump_bytes=$DUMP_BYTES"
    echo "object_count=$OBJECT_COUNT"
} > "$WORK/backup-manifest.txt"

ARCHIVE="$BACKUP_DIR_RESOLVED/vc-backup-$STAMP.tar.enc"
ARCHIVE_TMP="$BACKUP_DIR_RESOLVED/.vc-backup-$STAMP.tar.enc.tmp"
archive_fail() { # $1 exit code  $2 message
    rm -f "$ARCHIVE_TMP"
    echo "FAIL: $2" >&2
    exit "$1"
}
tar -cf - -C "$WORK" "${TAR_MEMBERS[@]}" \
    | openssl enc -aes-256-cbc -pbkdf2 -salt "${PASS_ARGS[@]}" -out "$WORK/archive.body" \
    || archive_fail 8 "archive encryption failed"
"$PYTHON_BIN" "$AAEAD_HELPER" seal "$WORK/archive.body" "$ARCHIVE_TMP" "${PASS_SRC[@]}" \
    || archive_fail 8 "authenticated seal failed (vc_aead.py)"
chmod 600 "$ARCHIVE_TMP"
# self-check: (1) MAC verify over the WHOLE container — wrong passphrase or a
# single flipped bit anywhere must fail here, before any decryption attempt;
# (2) full decrypt + tar header read. A corrupt artifact must never look like
# a good backup, so it is deleted on failure.
"$PYTHON_BIN" "$AAEAD_HELPER" unseal "$ARCHIVE_TMP" "$WORK/verify.body" "${PASS_SRC[@]}" \
    || archive_fail 6 "archive self-check (MAC verify)"
openssl enc -d -aes-256-cbc -pbkdf2 "${PASS_ARGS[@]}" -in "$WORK/verify.body" \
    | tar -tf - >/dev/null || archive_fail 6 "archive self-check (decrypt+tar)"
mv "$ARCHIVE_TMP" "$ARCHIVE"
echo "  $(basename "$ARCHIVE"): $(wc -c < "$ARCHIVE" | tr -d ' ') bytes (0600, authenticated)"

# ---- ④ 7-day retention (backup archives) -----------------------------
echo "== [4/6] retention: backups older than 7 days =="
retention_prune() { # $1 dir  $2 pattern
    local dir="$1" pattern="$2" victims=""
    victims="$(find "$dir" -maxdepth 1 -name "$pattern" -mtime +6 2>/dev/null || true)"
    if [ -n "$victims" ]; then
        sed 's/^/  delete: /' <<<"$victims"
        find "$dir" -maxdepth 1 -name "$pattern" -mtime +6 -delete
    else
        echo "  nothing to prune ($pattern)"
    fi
}
retention_prune "$BACKUP_DIR_RESOLVED" 'vc-backup-*.tar.enc'

# ---- ⑤ deletion tombstone manifest -> separate encrypted location ----
echo "== [5/6] deletion tombstone manifest (separate encrypted location) =="
TOMBSTONE_EXPORT_AVAILABLE="$(pg_exec psql -U "$PG_USER" -d "$DB_NAME" -t -A -c \
  "SELECT to_regprocedure('vc.export_account_deletion_tombstones()') IS NOT NULL")"
case "$TOMBSTONE_EXPORT_AVAILABLE" in
    t)
        pg_exec psql -U "$PG_USER" -d "$DB_NAME" -t -A -F '|' -c \
          "SELECT out_account_id, out_username_digest, out_status, out_requested_at, out_completed_at
             FROM vc.export_account_deletion_tombstones()" > "$WORK/deletion-tombstone.tsv"
        ;;
    f)
        # V104 creates the tombstone table and export function atomically.  If
        # the function is absent there cannot be pre-existing tombstone rows;
        # retain a separately authenticated empty manifest for restore parity.
        : > "$WORK/deletion-tombstone.tsv"
        echo "  pre-V104 schema: export function absent; sealing empty manifest"
        ;;
    *)
        echo "FAIL: unexpected tombstone export availability result" >&2
        exit 1
        ;;
esac
TOMBSTONE_ROWS="$(wc -l < "$WORK/deletion-tombstone.tsv" | tr -d ' ')"
MANIFEST_FILE="$MANIFEST_DIR_RESOLVED/deletion-manifest-$STAMP.enc"
MANIFEST_TMP="$MANIFEST_DIR_RESOLVED/.deletion-manifest-$STAMP.enc.tmp"
manifest_fail() { # $1 exit code  $2 message
    rm -f "$MANIFEST_TMP"
    echo "FAIL: $2" >&2
    exit "$1"
}
openssl enc -aes-256-cbc -pbkdf2 -salt "${PASS_ARGS[@]}" \
    -in "$WORK/deletion-tombstone.tsv" -out "$WORK/manifest.body" \
    || manifest_fail 8 "manifest encryption failed"
"$PYTHON_BIN" "$AAEAD_HELPER" seal "$WORK/manifest.body" "$MANIFEST_TMP" "${PASS_SRC[@]}" \
    || manifest_fail 8 "authenticated manifest seal failed (vc_aead.py)"
chmod 600 "$MANIFEST_TMP"
"$PYTHON_BIN" "$AAEAD_HELPER" unseal "$MANIFEST_TMP" "$WORK/manifest-verify.body" "${PASS_SRC[@]}" \
    || manifest_fail 7 "manifest self-check (MAC verify)"
openssl enc -d -aes-256-cbc -pbkdf2 "${PASS_ARGS[@]}" \
    -in "$WORK/manifest-verify.body" -out /dev/null \
    || manifest_fail 7 "manifest self-check (decrypt)"
mv "$MANIFEST_TMP" "$MANIFEST_FILE"
echo "  $(basename "$MANIFEST_FILE"): $(wc -c < "$MANIFEST_FILE" | tr -d ' ') bytes, $TOMBSTONE_ROWS tombstone row(s) (0600)"
retention_prune "$MANIFEST_DIR_RESOLVED" 'deletion-manifest-*.enc'

# ---- ⑥ summary (paths/sizes/counts only — never content or secrets) --
echo "== [6/6] summary =="
echo "  backup   : $ARCHIVE ($(wc -c < "$ARCHIVE" | tr -d ' ') bytes, mode=$OBJECT_MODE, dump=$DUMP_BYTES bytes, objects=$OBJECT_COUNT)"
echo "  manifest : $MANIFEST_FILE ($TOMBSTONE_ROWS rows)"
echo "  pg       : $PG_DESC (user=$PG_USER db=$DB_NAME)"
echo "  passphrase mode: $PASS_MODE (never logged)"
if [ "$EXIT_CODE" -ne 0 ]; then
    echo "RESULT: DB_ONLY backup completed, object backup SKIPPED (VC_BACKUP_S3_* unset) — exiting $EXIT_CODE to surface the gap"
fi
exit "$EXIT_CODE"
