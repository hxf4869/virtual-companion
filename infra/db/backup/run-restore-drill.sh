#!/usr/bin/env bash
# DOGFOOD-03 / ADR-0006 §7.4 restore drill: prove the DAILY backup artifact
# chain end-to-end, with the mandated order — restore, RECONCILE the external
# deletion manifest, verify the object restore, and only THEN open the data
# for reading (business assertions + RLS re-run).
#
# Black-box chain (everything synthetic, run-rls-tests.sh TEMPORARY_* rules):
#   1. ephemeral PostgreSQL 18 + pgvector: full migrations + drill seed
#      (alice with business rows; dave with the FULL five-class footprint:
#       account / message / memory / vector / export record),
#   2. ephemeral MinIO (loopback, random port) with synthetic export objects
#      under the REAL backend key layout
#      exports/{ownerUserId}/{exportId}-{16-lowercase-hex}.json
#      (alice 3, dave 2, carol 2),
#   3. pre-backup deletion of carol: account tombstoned AND her object prefix
#      purged from the source bucket (what the production delete flow does),
#      so backup #1 never captures her objects (anti-resurrection case a),
#   4. run-daily-backup.sh run #1 (FULL, env passphrase)  -> AUTHENTICATED
#      encrypted archive + separately authenticated tombstone manifest,
#   5. post-backup deletion of dave (the deletion the dump will not see;
#      anti-resurrection case b), run #2 (0600 keyfile) records his tombstone,
#   6. tamper negatives on copies of archive #1: flipped CIPHERTEXT byte,
#      flipped MAC byte, WRONG PASSPHRASE — every one must fail the MAC gate
#      BEFORE any decryption, with no partial output,
#   7. DISASTER: drop + recreate the database,
#   8. decrypt archive #1 (MAC first) -> gate A: dave is RESURRECTED by the
#      restore in ALL FIVE row classes (proves the reconcile below is the
#      thing that re-deletes him); archived object set == alice 3 + dave 2,
#      carol nowhere (case a),
#   9. reconcile FIRST: decrypt manifest #2, per row dry-run -> apply,
#      gate B: dave's five classes all gone again, COMPLETED tombstone
#      reapplied,
#  10. object restore SECOND: mirror archived objects into a fresh MinIO
#      bucket, gate C: names + count identical, gate C2: per-object sha256
#      byte-compare against the pre-disaster source, then apply the
#      tombstone-driven owner-prefix filter (mc rm exports/{accountId}/),
#      gate D: carol objects nowhere, gate E: dave objects excluded while
#      alice's 3 stay byte-identical (case b, object layer),
#  11. run-daily-backup.sh against an UNREACHABLE MinIO endpoint must exit 4
#      with the sanitized message and leave the backup dir untouched,
#  12. only now open for read: business row assertions + RLS tests re-run
#      against the restored schema.
#
# The existing run-backup-drill.sh stays untouched: it proves the plain
# pg_dump/pg_basebackup/PITR mechanics; this drill proves the daily encrypted
# artifact path and the reconcile-before-read order.
#
# Usage: bash infra/db/backup/run-restore-drill.sh

set -euo pipefail

PG_IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
MINIO_IMAGE="minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
MC_IMAGE="minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727"

DB_NAME="vc"
DB_USER="postgres"
DB_PASSWORD="vc"
MINIO_USER="drillminio"
MINIO_PASS="drill-miniopass"          # synthetic, guards an ephemeral container only
DRILL_PASSPHRASE="restore-drill-passphrase-0123456789"   # synthetic drill constant
BUCKET="vc-exports"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIG_DIR="$REPO_ROOT/backend/internal/migrate/sql"
RLS_TESTS="$REPO_ROOT/infra/db/tests"
BACKUP_SCRIPT="$SCRIPT_DIR/run-daily-backup.sh"
AAEAD_HELPER="$SCRIPT_DIR/vc_aead.py"
LOG_DIR="${VC_DB_LOG_DIR:-$(mktemp -d /tmp/vc-db-logs.XXXXXX)}"
DRILL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/vc-restore-drill.XXXXXX")"   # lives outside the repo, removed on exit
BACKUP_DIR="$DRILL_ROOT/backups"
MANIFEST_DIR="$DRILL_ROOT/manifests"   # != BACKUP_DIR by construction
MC_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vc-restore-drill-mc.XXXXXX")"
export DRILL_PASSPHRASE
mkdir -p "$LOG_DIR" "$BACKUP_DIR" "$MANIFEST_DIR" "$MC_SECRET_DIR"
chmod 700 "$MC_SECRET_DIR"
echo "log dir: $LOG_DIR"

command -v python3 >/dev/null 2>&1 || command -v /usr/bin/python3 >/dev/null 2>&1 \
    || { echo "FAIL: python3 required by the authenticated backup path" >&2; exit 32; }
command -v shasum >/dev/null 2>&1 || { echo "FAIL: shasum required for object byte-compare" >&2; exit 33; }
[ -f "$AAEAD_HELPER" ] || { echo "FAIL: vc_aead.py helper missing" >&2; exit 32; }

# decrypt an authenticated container: MAC verify FIRST (vc_aead.py never
# invokes openssl), only then does openssl see a single ciphertext byte
aead_decrypt() { # $1 container  $2 plaintext-out  $3 pass-env-var
    local body="$DRILL_ROOT/.aead-body.$$"
    python3 "$AAEAD_HELPER" unseal "$1" "$body" --pass-env "$3" \
        || { rm -f "$body"; echo "FAIL: MAC/integrity gate rejected $1" >&2; return 1; }
    openssl enc -d -aes-256-cbc -pbkdf2 -pass "env:$3" -in "$body" -out "$2"
    local rc=$?
    rm -f "$body"
    return "$rc"
}

CID_PG=""
CID_MINIO_SRC=""
CID_MINIO_DST=""
cleanup() {
    for c in "$CID_PG" "$CID_MINIO_SRC" "$CID_MINIO_DST"; do
        [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true
    done
    rm -rf "$DRILL_ROOT" "$MC_SECRET_DIR"
}
trap cleanup EXIT

wait_ready() { # $1 = container
    local stable=0
    for _ in $(seq 1 200); do
        if docker exec "$1" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
            stable=$((stable + 1))
            [ "$stable" -ge 3 ] && return 0
        else
            stable=0
        fi
        sleep 0.5
    done
    echo "postgres did not become ready" >&2
    exit 3
}

# dockerized mc helper: credentials stay in a 0600 read-only file, never in
# docker argv or Config.Env. Alias $1 points at host port $2.
mc_with() { # $1 alias  $2 host port  $3.. mc args
    local alias="$1" port="$2" secret_file="$MC_SECRET_DIR/$1-$2"; shift 2
    printf '%s\n%s\n%s\n' \
        "http://host.docker.internal:${port}" "$MINIO_USER" "$MINIO_PASS" > "$secret_file"
    chmod 600 "$secret_file"
    docker run --rm --entrypoint /bin/sh \
        -v "$secret_file:/run/secrets/vc-mc:ro" \
        -v "$DRILL_ROOT:/drill" \
        "$MC_IMAGE" -c '
set -eu
{
    IFS= read -r mc_endpoint
    IFS= read -r mc_access_key
    IFS= read -r mc_secret_key
} < /run/secrets/vc-mc
mc alias set "$1" "$mc_endpoint" "$mc_access_key" "$mc_secret_key" >/dev/null
shift
exec mc "$@"
' vc-restore-mc "$alias" "$@"
}

wait_minio() { # $1 alias  $2 host port
    for _ in $(seq 1 60); do
        if mc_with "$1" "$2" ready "$1" >/dev/null 2>&1; then return 0; fi
        sleep 1
    done
    echo "minio ($1, port $2) did not become ready" >&2
    exit 8
}

bucket_keys() { # $1 alias  $2 port -> sorted object keys (relative to bucket)
    mc_with "$1" "$2" ls --recursive "$1/$BUCKET" | awk '{print $NF}' | sed "s#^$BUCKET/##" | sort
}

echo "== [1/14] launching ephemeral PostgreSQL + MinIO =="
CID_PG=$(docker run -d --rm --name "vc-restore-pg-$$" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" -e POSTGRES_DB="$DB_NAME" "$PG_IMAGE")
CID_MINIO_SRC=$(docker run -d --rm --name "vc-restore-minio-$$" \
    -p 127.0.0.1::9000 \
    -e MINIO_ROOT_USER="$MINIO_USER" -e MINIO_ROOT_PASSWORD="$MINIO_PASS" \
    "$MINIO_IMAGE" server /data)
wait_ready "$CID_PG"
SRC_PORT="$(docker port "$CID_MINIO_SRC" 9000/tcp | head -1 | sed 's/.*://')"
echo "  postgres: $CID_PG; minio(src): 127.0.0.1:$SRC_PORT"
wait_minio src "$SRC_PORT"

echo "== [2/14] applying migrations =="
for f in $(ls "$MIG_DIR"/V*.sql | sort -V); do
    echo "  -> $(basename "$f")"
    docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -q < "$f" >>"$LOG_DIR/migration.log" 2>&1
done
docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
    < "$RLS_TESTS/00_owner_binding_secret_seed.sql" >>"$LOG_DIR/migration.log" 2>&1

echo "== seeding drill data (alice full rows; dave FIVE-CLASS rows) =="
docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<'SQL' >>"$LOG_DIR/seed.log" 2>&1
TRUNCATE vc.conversation_summary, vc.safety_event, vc.export_request, vc.memory_item, vc.message,
         vc.conversation, vc.relationship, vc.generation,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;
DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
    v_carol bigint;
    v_dave  bigint;
    v_from_message bigint;
    v_to_message bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-bk', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(v_admin, 'alice-bk', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(v_admin, 'bob-bk',   '$2a$10$bob.hash.placeholder',   'USER', 'Bob')   INTO v_bob;
    SELECT vc.identity_account_create(v_admin, 'carol-bk', '$2a$10$carol.hash.placeholder', 'USER', 'Carol') INTO v_carol;
    SELECT vc.identity_account_create(v_admin, 'dave-bk',  '$2a$10$dave.hash.placeholder',  'USER', 'Dave')  INTO v_dave;

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_alice, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_alice || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.receive_generation(v_alice, 1, 'bk-key-1', 'user', 'drill-message-plaintext');
    SELECT min(id), max(id) INTO v_from_message, v_to_message
      FROM vc.message WHERE owner_user_id = v_alice AND conversation_id = 1;
    INSERT INTO vc.conversation_summary(
        owner_user_id, id, conversation_id, from_message_id, to_message_id, summary,
        model_id, model_version, prompt_version, confidence, validated, service_class)
    VALUES (
        v_alice, nextval('vc.conversation_summary_id_seq'), 1, v_from_message, v_to_message,
        'enc2:default:1:QUJDRA==', 'backup-drill', '1', '1', 1.0, true, 'ECONOMY');
    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
    VALUES (v_alice, 1, 1, 'RELATIONSHIP', 'drill-memory-summary', 'ACCEPTED');
    INSERT INTO vc.export_request(owner_user_id, id, status, requested_at)
    VALUES (v_alice, 1, 'READY', now() - interval '2 days');

    -- dave carries ALL FIVE classes the anti-resurrection gates must prove
    -- stay deleted: account, message, memory, vector, export record.
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_dave, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_dave, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_dave, 'n3', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_dave || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.receive_generation(v_dave, 1, 'bk-key-2', 'user', 'drill-message-dave');
    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
    VALUES (v_dave, 1, 1, 'RELATIONSHIP', 'drill-memory-dave', 'ACCEPTED');
    INSERT INTO vc.memory_embedding(
        owner_user_id, memory_item_id, embedding,
        embedding_model_id, embedding_model_version, dimension, embedding_space_id)
    VALUES (v_dave, 1,
        ('[' || array_to_string(array(SELECT 0.5 FROM generate_series(1, 64)), ',') || ']')::public.vector,
        'drill-embed', '1', 64, 'drill-space');
    INSERT INTO vc.export_request(owner_user_id, id, status, requested_at)
    VALUES (v_dave, nextval('vc.export_request_id_seq'), 'READY', now() - interval '1 day');
END $$;
SQL
ALICE_ID="$(docker exec "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT id FROM vc.identity_account WHERE username = 'alice-bk'")"
CAROL_ID="$(docker exec "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT id FROM vc.identity_account WHERE username = 'carol-bk'")"
DAVE_ID="$(docker exec "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT id FROM vc.identity_account WHERE username = 'dave-bk'")"
echo "  seeded: alice=$ALICE_ID carol=$CAROL_ID dave=$DAVE_ID (see $LOG_DIR/seed.log)"

echo "== [3/14] synthetic export objects (exports/{ownerUserId}/{exportId}-{attempt}.json) =="
ALICE_EXPORTS=("11111111-1111-4111-8111-111111111111"
               "11111111-1111-4111-8111-111111111112"
               "11111111-1111-4111-8111-111111111113")
DAVE_EXPORTS=("22222222-2222-4222-8222-222222222221"
              "22222222-2222-4222-8222-222222222222")
CAROL_EXPORTS=("33333333-3333-4333-8333-333333333331"
               "33333333-3333-4333-8333-333333333332")
for eid in "${ALICE_EXPORTS[@]}"; do
    mkdir -p "$DRILL_ROOT/objects-src/exports/$ALICE_ID"
    printf 'synthetic export owner=%s export=%s\n' "$ALICE_ID" "$eid" \
        > "$DRILL_ROOT/objects-src/exports/$ALICE_ID/$eid-1111111111111111.json"
done
for eid in "${DAVE_EXPORTS[@]}"; do
    mkdir -p "$DRILL_ROOT/objects-src/exports/$DAVE_ID"
    printf 'synthetic export owner=%s export=%s\n' "$DAVE_ID" "$eid" \
        > "$DRILL_ROOT/objects-src/exports/$DAVE_ID/$eid-2222222222222222.json"
done
for eid in "${CAROL_EXPORTS[@]}"; do
    mkdir -p "$DRILL_ROOT/objects-src/exports/$CAROL_ID"
    printf 'synthetic export owner=%s export=%s\n' "$CAROL_ID" "$eid" \
        > "$DRILL_ROOT/objects-src/exports/$CAROL_ID/$eid-3333333333333333.json"
done
mc_with src "$SRC_PORT" mb "src/$BUCKET" >>"$LOG_DIR/minio.log" 2>&1
mc_with src "$SRC_PORT" mirror --overwrite /drill/objects-src "src/$BUCKET" >>"$LOG_DIR/minio.log" 2>&1
SRC_KEYS="$(bucket_keys src "$SRC_PORT")"
[ "$(wc -l <<<"$SRC_KEYS")" -eq 7 ] || { echo "FAIL: expected 7 src objects" >&2; exit 9; }
echo "  7 objects uploaded (alice 3 / dave 2 / carol 2)"

echo "== [4/14] PRE-BACKUP deletion of carol: account + object prefix purge =="
docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<SQL >>"$LOG_DIR/seed.log" 2>&1
DO \$\$
DECLARE v_carol bigint := ${CAROL_ID};
BEGIN
    PERFORM vc.set_owner_context(v_carol, 'n2', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_carol || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.identity_account_delete(v_carol);
END \$\$;
SQL
# the production delete flow purges the owner prefix from object storage;
# the backup mirrors live state, so purged objects can never be backed up
mc_with src "$SRC_PORT" rm --recursive --force "src/$BUCKET/exports/$CAROL_ID/" >>"$LOG_DIR/minio.log" 2>&1
SRC_KEYS="$(bucket_keys src "$SRC_PORT")"
if grep -q "^exports/$CAROL_ID/" <<<"$SRC_KEYS"; then
    echo "FAIL: carol object prefix still present in source bucket" >&2; exit 9
fi
[ "$(wc -l <<<"$SRC_KEYS")" -eq 5 ] || { echo "FAIL: expected 5 src objects after carol purge" >&2; exit 9; }
echo "  carol account deleted + objects purged (5 objects remain: alice 3 / dave 2)"

run_daily_backup() { # $@ extra env assignments (KEY=VAL ...)
    local ep="${VC_DRILL_S3_ENDPOINT:-http://127.0.0.1:$SRC_PORT}"
    (
        export VC_BACKUP_DIR="$BACKUP_DIR" VC_BACKUP_MANIFEST_DIR="$MANIFEST_DIR"
        export VC_BACKUP_PG_CONTAINER="$CID_PG" VC_BACKUP_PG_USER="$DB_USER"
        export VC_BACKUP_S3_ENDPOINT="$ep"
        export VC_BACKUP_S3_ACCESS_KEY="$MINIO_USER" VC_BACKUP_S3_SECRET_KEY="$MINIO_PASS"
        export VC_BACKUP_S3_BUCKET="$BUCKET"
        for assignment in "$@"; do
            export "$assignment"
        done
        exec bash "$BACKUP_SCRIPT"
    )
}

echo "== [5/14] daily backup run #1 (FULL, env passphrase) =="
run_daily_backup VC_BACKUP_PASSPHRASE="$DRILL_PASSPHRASE" >"$LOG_DIR/daily-run1.log" 2>&1
echo "  $(grep -E '^  (backup|manifest)' "$LOG_DIR/daily-run1.log" | tr '\n' ' ')"

echo "== [6/14] post-backup account deletion (dave) — the dump will not see it =="
docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<SQL >>"$LOG_DIR/seed.log" 2>&1
DO \$\$
DECLARE v_dave bigint := ${DAVE_ID};
BEGIN
    IF NOT vc.identity_account_delete(v_dave) THEN
        RAISE EXCEPTION 'post-backup dave deletion failed';
    END IF;
END \$\$;
SQL
echo "  dave deleted after backup #1"

sleep 1   # distinct archive stamp for run #2
echo "== [7/14] daily backup run #2 (FULL, 0600 keyfile passphrase) =="
printf '%s' "$DRILL_PASSPHRASE" > "$DRILL_ROOT/passfile"
chmod 600 "$DRILL_ROOT/passfile"
run_daily_backup VC_BACKUP_PASSPHRASE_FILE="$DRILL_ROOT/passfile" >"$LOG_DIR/daily-run2.log" 2>&1
echo "  $(grep -E '^  (backup|manifest)' "$LOG_DIR/daily-run2.log" | tr '\n' ' ')"

ARCHIVE_1="$(ls "$BACKUP_DIR"/vc-backup-*.tar.enc | sort | head -1)"
ARCHIVE_2="$(ls "$BACKUP_DIR"/vc-backup-*.tar.enc | sort | tail -1)"
MANIFEST_2="$(ls "$MANIFEST_DIR"/deletion-manifest-*.enc | sort | tail -1)"
[ "$ARCHIVE_1" != "$ARCHIVE_2" ] || { echo "FAIL: two runs produced one archive" >&2; exit 10; }
# the tombstone manifest must live outside the backup dir and outside the archive
if ls "$BACKUP_DIR"/deletion-manifest-* >/dev/null 2>&1; then
    echo "FAIL: deletion manifest leaked into VC_BACKUP_DIR" >&2; exit 11
fi
echo "  archive#1=$(basename "$ARCHIVE_1") archive#2=$(basename "$ARCHIVE_2") manifest#2=$(basename "$MANIFEST_2")"

echo "== [8/14] tamper negatives: MAC gate must fire BEFORE any decryption =="
mkdir -p "$DRILL_ROOT/tamper"
tamper_expect_fail() { # $1 label  $2 container  $3 pass-env-var
    local label="$1" container="$2" passvar="$3" rc=0
    rm -f "$DRILL_ROOT/tamper/out.bin"
    python3 "$AAEAD_HELPER" unseal "$container" "$DRILL_ROOT/tamper/out.bin" \
        --pass-env "$passvar" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
        echo "FAIL: tamper case '$label' was ACCEPTED" >&2; exit 21
    fi
    if [ -e "$DRILL_ROOT/tamper/out.bin" ]; then
        echo "FAIL: tamper case '$label' wrote output before failing" >&2; exit 21
    fi
    echo "  PASS $label -> rejected before decryption (rc=$rc, no output)"
}
# case 1: flipped byte inside the CIPHERTEXT region
cp "$ARCHIVE_1" "$DRILL_ROOT/tamper/ct.vcb"
python3 - "$DRILL_ROOT/tamper/ct.vcb" <<'PY'
import struct, sys
p = sys.argv[1]
with open(p, "r+b") as f:
    head = f.read(11)
    hlen = struct.unpack(">I", head[7:11])[0]
    off = 11 + hlen + 5
    f.seek(off); b = f.read(1)
    f.seek(off); f.write(bytes([b[0] ^ 0x01]))
PY
tamper_expect_fail "tampered-ciphertext" "$DRILL_ROOT/tamper/ct.vcb" DRILL_PASSPHRASE
# case 2: flipped byte in the MAC trailer
cp "$ARCHIVE_1" "$DRILL_ROOT/tamper/mac.vcb"
python3 - "$DRILL_ROOT/tamper/mac.vcb" <<'PY'
import sys
p = sys.argv[1]
with open(p, "r+b") as f:
    f.seek(-1, 2); b = f.read(1)
    f.seek(-1, 2); f.write(bytes([b[0] ^ 0x01]))
PY
tamper_expect_fail "tampered-mac-trailer" "$DRILL_ROOT/tamper/mac.vcb" DRILL_PASSPHRASE
# case 3: WRONG passphrase (wrong MAC key)
DRILL_WRONG_PASS="definitely-not-the-drill-passphrase"
export DRILL_WRONG_PASS
tamper_expect_fail "wrong-passphrase" "$ARCHIVE_1" DRILL_WRONG_PASS
unset DRILL_WRONG_PASS

echo "== [9/14] DISASTER: drop database; decrypt archive #1 (MAC first) =="
docker exec "$CID_PG" psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$DB_NAME\"" >/dev/null
docker exec "$CID_PG" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null
mkdir -p "$DRILL_ROOT/restore"
aead_decrypt "$ARCHIVE_1" "$DRILL_ROOT/backup1.tar" DRILL_PASSPHRASE \
    || { echo "FAIL: archive #1 failed the MAC gate" >&2; exit 32; }
tar -xf "$DRILL_ROOT/backup1.tar" -C "$DRILL_ROOT/restore"
ls "$DRILL_ROOT/restore" | grep -qx 'db.dump' || { echo "FAIL: archive has no db.dump" >&2; exit 12; }
[ -d "$DRILL_ROOT/restore/objects" ] || { echo "FAIL: archive has no objects/ (FULL mode expected)" >&2; exit 13; }
if find "$DRILL_ROOT/restore" -name 'deletion-tombstone*' | grep -q .; then
    echo "FAIL: tombstone data leaked into the backup archive" >&2; exit 14
fi
# gate D (part 1, scenario a): the archived object set is EXACTLY alice 3 +
# dave 2 — carol's pre-backup-deleted objects are NOT in the backup at all
EXPECTED_KEYS="$({
    printf 'exports/%s/%s-1111111111111111.json\n' \
        "$ALICE_ID" "${ALICE_EXPORTS[0]}" "$ALICE_ID" "${ALICE_EXPORTS[1]}" "$ALICE_ID" "${ALICE_EXPORTS[2]}"
    printf 'exports/%s/%s-2222222222222222.json\n' \
        "$DAVE_ID" "${DAVE_EXPORTS[0]}" "$DAVE_ID" "${DAVE_EXPORTS[1]}"
} | sort)"
ARCHIVED_KEYS="$(cd "$DRILL_ROOT/restore/objects" && find . -type f | sed 's#^\./##' | sort)"
if [ "$ARCHIVED_KEYS" != "$EXPECTED_KEYS" ]; then
    echo "FAIL: archived object set differs from expected (scenario a broken?)" >&2
    diff <(echo "$EXPECTED_KEYS") <(echo "$ARCHIVED_KEYS") >&2 || true
    exit 23
fi
echo "  gate D (archive side) OK: 5/5 objects = alice 3 + dave 2, no carol (scenario a)"

echo "== [10/14] restore DB; gate A: dave RESURRECTED in all five classes =="
docker exec -i "$CID_PG" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner \
    < "$DRILL_ROOT/restore/db.dump" >>"$LOG_DIR/restore.log" 2>&1 \
    || { echo "pg_restore failed (see $LOG_DIR/restore.log)" >&2; exit 4; }
RESURRECTED="$(docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -v ON_ERROR_STOP=1 -F ' ' -v "dave=$DAVE_ID" <<'SQL'
SELECT (SELECT count(*) FROM vc.identity_account WHERE id = :dave),
       (SELECT count(*) FROM vc.message WHERE owner_user_id = :dave AND content LIKE 'drill-message-dave%'),
       (SELECT count(*) FROM vc.memory_item WHERE owner_user_id = :dave),
       (SELECT count(*) FROM vc.memory_embedding WHERE owner_user_id = :dave),
       (SELECT count(*) FROM vc.export_request WHERE owner_user_id = :dave);
SQL
)"
read -r RA_ACCOUNT RA_MSG RA_MEM RA_VEC RA_EXP <<<"$RESURRECTED"
if [ "$RA_ACCOUNT" != 1 ] || [ "$RA_MSG" -lt 1 ] || [ "$RA_MEM" -lt 1 ] \
   || [ "$RA_VEC" -lt 1 ] || [ "$RA_EXP" -lt 1 ]; then
    echo "FAIL: gate A — dave not fully resurrected (account=$RA_ACCOUNT msg=$RA_MSG mem=$RA_MEM vec=$RA_VEC exp=$RA_EXP)" >&2
    exit 24
fi
echo "  gate A OK: dave resurrected (account=1, msg=$RA_MSG, mem=$RA_MEM, vec=$RA_VEC, exp=$RA_EXP) — reads stay closed until reconcile"

echo "== [11/14] RECONCILE FIRST: manifest #2 (MAC first), dry-run -> apply =="
aead_decrypt "$MANIFEST_2" "$DRILL_ROOT/deletion-tombstone.tsv" DRILL_PASSPHRASE \
    || { echo "FAIL: manifest #2 failed the MAC gate" >&2; exit 32; }
TOMBSTONE_ACCOUNTS=""
while IFS='|' read -r acc digest status req completed; do
    [ -n "$acc" ] || continue
    TOMBSTONE_ACCOUNTS="$TOMBSTONE_ACCOUNTS$acc
"
    # psql :var substitution only works on stdin/-f input, never inside -c
    DRY=$(docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
        -v "account=$acc" -v "digest=$digest" -v "requested=$req" -v "completed=$completed" \
        <<'SQL'
SELECT vc.reconcile_account_deletion_tombstone(
  :account::bigint, :'digest', :'requested'::timestamptz, :'completed'::timestamptz, false);
SQL
    )
    APPLY=$(docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
        -v "account=$acc" -v "digest=$digest" -v "requested=$req" -v "completed=$completed" \
        <<'SQL'
SELECT vc.reconcile_account_deletion_tombstone(
  :account::bigint, :'digest', :'requested'::timestamptz, :'completed'::timestamptz, true);
SQL
    )
    echo "  reconcile account=$acc status=$status dry-run=$DRY apply=$APPLY"
    [ "$DRY" = "$APPLY" ] || { echo "FAIL: dry-run/apply mismatch for account $acc" >&2; exit 16; }
    [ "$(docker exec "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
        "SELECT count(*) FROM vc.account_deletion_intent WHERE account_id = ${acc} AND status = 'COMPLETED'")" = "1" ] \
        || { echo "FAIL: COMPLETED tombstone missing for account $acc" >&2; exit 17; }
done < "$DRILL_ROOT/deletion-tombstone.tsv"
TOMBSTONE_ACCOUNTS="$(sort -u <<<"$TOMBSTONE_ACCOUNTS" | sed '/^$/d')"
DAVE_DIGEST=$(docker exec "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT i.username_digest FROM vc.account_deletion_intent i
       WHERE i.account_id = (SELECT account_id FROM vc.identity_auth_event
                              WHERE username = 'dave-bk' ORDER BY id DESC LIMIT 1)
         AND i.status = 'COMPLETED'")
[ "${#DAVE_DIGEST}" -eq 64 ] || { echo "FAIL: gate B — dave COMPLETED tombstone digest invalid" >&2; exit 19; }
# gate B (scenario b, DB layer): ALL FIVE classes stay deleted after reconcile
PURGED="$(docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -v ON_ERROR_STOP=1 -F ' ' -v "dave=$DAVE_ID" <<'SQL'
SELECT (SELECT count(*) FROM vc.identity_account WHERE id = :dave),
       (SELECT count(*) FROM vc.message WHERE owner_user_id = :dave AND content LIKE 'drill-message-dave%'),
       (SELECT count(*) FROM vc.memory_item WHERE owner_user_id = :dave),
       (SELECT count(*) FROM vc.memory_embedding WHERE owner_user_id = :dave),
       (SELECT count(*) FROM vc.export_request WHERE owner_user_id = :dave);
SQL
)"
read -r RB_ACCOUNT RB_MSG RB_MEM RB_VEC RB_EXP <<<"$PURGED"
if [ "$RB_ACCOUNT$RB_MSG$RB_MEM$RB_VEC$RB_EXP" != "00000" ]; then
    echo "FAIL: gate B — dave rows survived reconcile (account=$RB_ACCOUNT msg=$RB_MSG mem=$RB_MEM vec=$RB_VEC exp=$RB_EXP)" >&2
    exit 25
fi
echo "  gate B OK: reconcile re-deleted dave in all five classes (account/msg/mem/vec/exp = 0), COMPLETED tombstone reapplied (digest 64 hex)"

echo "== [12/14] OBJECT RESTORE SECOND: content compare + tombstone prefix filter =="
CID_MINIO_DST=$(docker run -d --rm --name "vc-restore-minio2-$$" \
    -p 127.0.0.1::9000 \
    -e MINIO_ROOT_USER="$MINIO_USER" -e MINIO_ROOT_PASSWORD="$MINIO_PASS" \
    "$MINIO_IMAGE" server /data)
DST_PORT="$(docker port "$CID_MINIO_DST" 9000/tcp | head -1 | sed 's/.*://')"
wait_minio dst "$DST_PORT"
echo "  minio(dst): 127.0.0.1:$DST_PORT"
mc_with dst "$DST_PORT" mb "dst/$BUCKET" >>"$LOG_DIR/minio.log" 2>&1
mc_with dst "$DST_PORT" mirror --overwrite "/drill/restore/objects" "dst/$BUCKET" >>"$LOG_DIR/minio.log" 2>&1
RESTORED_KEYS="$(bucket_keys dst "$DST_PORT")"
# gate C: names + count identical to the archived set (5 = alice 3 + dave 2;
# dave IS present here on purpose — the filter below is what removes him)
if [ "$(wc -l <<<"$RESTORED_KEYS")" -ne 5 ] || [ "$RESTORED_KEYS" != "$ARCHIVED_KEYS" ]; then
    echo "FAIL: gate C — restored object set differs" >&2
    diff <(echo "$ARCHIVED_KEYS") <(echo "$RESTORED_KEYS") >&2 || true
    exit 26
fi
echo "  gate C OK: 5/5 objects restored with identical names"
# gate C2: byte-level content compare (sha256, content never printed)
while IFS= read -r key; do
    [ -n "$key" ] || continue
    SRC_HASH="$(shasum -a 256 < "$DRILL_ROOT/objects-src/$key" | awk '{print $1}')"
    DST_HASH="$(mc_with dst "$DST_PORT" cat "dst/$BUCKET/$key" | shasum -a 256 | awk '{print $1}')"
    if [ "$SRC_HASH" != "$DST_HASH" ]; then
        echo "FAIL: gate C2 — content hash differs for $key" >&2; exit 27
    fi
done <<<"$RESTORED_KEYS"
echo "  gate C2 OK: 5/5 objects byte-identical to pre-disaster source (sha256)"
# scenario b premise: dave's objects DID come back with the old backup
grep -q "^exports/$DAVE_ID/" <<<"$RESTORED_KEYS" \
    || { echo "FAIL: premise broken — dave objects not in restored set" >&2; exit 28; }
# object-layer anti-resurrection: drop every tombstoned owner's prefix
while IFS= read -r acc; do
    [ -n "$acc" ] || continue
    mc_with dst "$DST_PORT" rm --recursive --force "dst/$BUCKET/exports/$acc/" >>"$LOG_DIR/minio.log" 2>&1 \
        || echo "  note: prefix exports/$acc/ already absent (account=$acc)"
done <<<"$TOMBSTONE_ACCOUNTS"
FINAL_KEYS="$(bucket_keys dst "$DST_PORT")"
EXPECTED_FINAL="$(printf 'exports/%s/%s-1111111111111111.json\n' \
    "$ALICE_ID" "${ALICE_EXPORTS[0]}" "$ALICE_ID" "${ALICE_EXPORTS[1]}" "$ALICE_ID" "${ALICE_EXPORTS[2]}" | sort)"
# gate D (part 2, scenario a) + gate E (scenario b): carol AND dave prefixes
# gone, alice's 3 exactly remain
if grep -q "^exports/\($CAROL_ID\|$DAVE_ID\)/" <<<"$FINAL_KEYS"; then
    echo "FAIL: gate D/E — tombstoned owner objects still present after filter" >&2; exit 29
fi
if [ "$FINAL_KEYS" != "$EXPECTED_FINAL" ]; then
    echo "FAIL: gate E — final object set is not exactly alice's 3 exports" >&2
    diff <(echo "$EXPECTED_FINAL") <(echo "$FINAL_KEYS") >&2 || true
    exit 29
fi
echo "  gate D OK: carol (pre-backup delete) objects absent end-to-end (scenario a)"
echo "  gate E OK: dave (post-backup delete) objects excluded by tombstone filter; alice 3 intact (scenario b)"

echo "== [13/14] run-daily-backup.sh vs UNREACHABLE MinIO endpoint must exit 4 =="
ARCHIVES_BEFORE="$(ls "$BACKUP_DIR" | wc -l | tr -d ' ')"
set +e
VC_DRILL_S3_ENDPOINT="http://127.0.0.1:9" \
    run_daily_backup VC_BACKUP_PASSPHRASE="$DRILL_PASSPHRASE" >"$LOG_DIR/daily-unreachable.log" 2>&1
UNREACH_RC=$?
set -e
[ "$UNREACH_RC" -eq 4 ] || { echo "FAIL: unreachable MinIO exit=$UNREACH_RC, expected 4" >&2; exit 30; }
grep -q "unreachable or credentials rejected" "$LOG_DIR/daily-unreachable.log" \
    || { echo "FAIL: sanitized unreachable message missing" >&2; exit 30; }
[ "$(ls "$BACKUP_DIR" | wc -l | tr -d ' ')" -eq "$ARCHIVES_BEFORE" ] \
    || { echo "FAIL: failed run left artifacts in backup dir" >&2; exit 30; }
echo "  PASS unreachable-endpoint -> exit 4, sanitized message, backup dir unchanged ($ARCHIVES_BEFORE archives)"

echo "== [14/14] READ-OPEN GATE: business assertions + RLS on the restored schema =="
VERIFY=$(docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -t -A -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    v_msg text;
    v_mem text;
    v_summary text;
    v_exp int;
    v_tombstone int;
    v_audit int;
    v_external_tombstone int;
BEGIN
    SELECT content INTO v_msg FROM vc.message WHERE content LIKE 'drill-message-%';
    IF v_msg IS NULL THEN RAISE EXCEPTION 'restored message content missing'; END IF;
    SELECT summary INTO v_mem FROM vc.memory_item WHERE status = 'ACCEPTED';
    IF v_mem IS DISTINCT FROM 'drill-memory-summary' THEN RAISE EXCEPTION 'restored memory status/summary wrong'; END IF;
    SELECT summary INTO v_summary FROM vc.conversation_summary WHERE valid;
    IF v_summary IS NULL OR v_summary NOT LIKE 'enc2:%' OR v_summary LIKE '%drill-message-plaintext%' THEN
        RAISE EXCEPTION 'restored conversation summary is not opaque ciphertext';
    END IF;
    SELECT count(*) INTO v_exp FROM vc.export_request WHERE status = 'READY';
    IF v_exp <> 1 THEN RAISE EXCEPTION 'restored export residue wrong'; END IF;
    SELECT count(*) INTO v_tombstone FROM vc.identity_account WHERE username = 'carol-bk';
    SELECT count(*) INTO v_audit FROM vc.identity_auth_event
     WHERE username = 'carol-bk' AND event_type IN ('ACCOUNT_DELETE', 'ACCOUNT_CREATE');
    IF v_tombstone <> 0 OR v_audit < 2 THEN
        RAISE EXCEPTION 'delete tombstone broken (account=%, audit=%)', v_tombstone, v_audit;
    END IF;
    SELECT count(*) INTO v_tombstone FROM vc.identity_account WHERE username = 'dave-bk';
    SELECT count(*) INTO v_external_tombstone FROM vc.account_deletion_intent
     WHERE account_id = (SELECT account_id FROM vc.identity_auth_event
                          WHERE username = 'dave-bk' ORDER BY id DESC LIMIT 1)
       AND status = 'COMPLETED';
    IF v_tombstone <> 0 OR v_external_tombstone <> 1 THEN
        RAISE EXCEPTION 'external delete manifest reconciliation broken (account=%, tombstone=%)',
            v_tombstone, v_external_tombstone;
    END IF;
END $$;
SELECT 'RESTORE-DATA-OK';
SQL
)
grep -q 'RESTORE-DATA-OK' <<<"$VERIFY" || { echo "$VERIFY" >&2; exit 5; }
echo "  data assertions OK (content/memory/summary-cipher/export/carol+dave tombstones)"
for t in 01_cross_user_read_denied 02_cross_relationship_reference_denied 70_owner_forged_binding_denied; do
    if docker exec -i "$CID_PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
        < "$RLS_TESTS/$t.sql" >"$LOG_DIR/rls-$t.log" 2>&1; then
        echo "  PASS $t (against restored cluster)"
    else
        echo "FAIL $t (see $LOG_DIR/rls-$t.log)" >&2
        exit 6
    fi
done

echo "== RESTORE DRILL PASS: reconcile -> object restore+filter -> read-open (ADR-0006 §7.4 order enforced) =="
