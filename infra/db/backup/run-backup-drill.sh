#!/usr/bin/env bash
# BACKUP (§22.13 / R47): full-backup + WAL/PITR restore drill.
#
# Proves — not assumes — that a restored database is usable:
#   Phase A  logical: pg_dump -Fc -> drop db -> pg_restore -> assert seeded
#            business rows survive (message content, memory status, encrypted
#            conversation summary, export residue), the delete-tombstone still blocks a deleted account,
#            and the restored schema passes the cross-tenant RLS tests
#            (01/02/70 re-run against the RESTORED cluster).
#   Phase B  physical: pg_basebackup + forced WAL switches with a
#            post-backup marker row; restore the base backup into a fresh
#            container, replay archived WAL, and assert the marker row only
#            exists after replay (PITR actually replays).
#
# Everything runs in anonymous containers (--rm, no host ports, no bind
# mounts — artifacts move via stdout/docker cp), mirroring the TEMPORARY_*
# rules of ../run-rls-tests.sh. Logs land in $VC_DB_LOG_DIR (default fresh
# /tmp/vc-db-logs.*).
#
# Usage: bash infra/db/backup/run-backup-drill.sh

set -euo pipefail

IMAGE="pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
DB_NAME="vc"
DB_USER="postgres"
DB_PASSWORD="vc"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MIG_DIR="$REPO_ROOT/backend/internal/migrate/sql"
RLS_TESTS="$REPO_ROOT/infra/db/tests"
LOG_DIR="${VC_DB_LOG_DIR:-$(mktemp -d /tmp/vc-db-logs.XXXXXX)}"
mkdir -p "$LOG_DIR"
echo "log dir: $LOG_DIR"

CID=""
CID_PITR=""
cleanup() {
    if [ -n "$CID" ]; then docker rm -f "$CID" >/dev/null 2>&1 || true; fi
    if [ -n "$CID_PITR" ]; then docker rm -f "$CID_PITR" >/dev/null 2>&1 || true; fi
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

apply_migrations() {
    for f in $(ls "$MIG_DIR"/V*.sql | sort -V); do
        echo "  -> $(basename "$f")"
        docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" \
            -v ON_ERROR_STOP=1 -q < "$f" >>"$LOG_DIR/migration.log" 2>&1
    done
}

echo "== launching ephemeral PostgreSQL 18 + pgvector (archive_mode=on) =="
CID=$(docker run -d --rm --name "vc-backup-drill-$$" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    "$IMAGE" \
    -c archive_mode=on -c wal_level=replica \
    -c "archive_command=test ! -f /wal/%f && cp %p /wal/%f")
wait_ready "$CID"
# archive_command writes into /wal; create it (entrypoint does not).
docker exec "$CID" sh -c 'mkdir -p /wal && chown postgres:postgres /wal'

echo "== applying migrations =="
apply_migrations
# The owner-binding secret row is test-harness seed data (00), not a migration;
# the drill needs it for set_owner_context proofs.
docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
    < "$RLS_TESTS/00_owner_binding_secret_seed.sql" >>"$LOG_DIR/migration.log" 2>&1

echo "== seeding drill data =="
docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<'SQL' >>"$LOG_DIR/seed.log" 2>&1
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

    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope,
                               summary, status)
    VALUES (v_alice, 1, 1, 'RELATIONSHIP', 'drill-memory-summary', 'ACCEPTED');

    INSERT INTO vc.export_request(owner_user_id, id, status, requested_at)
    VALUES (v_alice, 1, 'READY', now() - interval '2 days');

    -- Delete-tombstone seed: carol deletes her own account; the audit row
    -- survives without the account, so login must stay impossible.
    PERFORM vc.set_owner_context(v_carol, 'n2', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_carol || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.identity_account_delete(v_carol);
END $$;
SQL
echo "  seeded (see $LOG_DIR/seed.log)"

echo "== Phase A: logical backup (pg_dump -Fc) =="
docker exec "$CID" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$LOG_DIR/drill.dump"
echo "  dump size: $(wc -c < "$LOG_DIR/drill.dump") bytes"

echo "== external deletion manifest: delete after logical backup =="
docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q <<'SQL' >>"$LOG_DIR/seed.log" 2>&1
DO $$
DECLARE v_dave bigint;
BEGIN
    SELECT id INTO v_dave FROM vc.identity_account WHERE username = 'dave-bk';
    IF NOT vc.identity_account_delete(v_dave) THEN
        RAISE EXCEPTION 'post-backup dave deletion failed';
    END IF;
END $$;
SQL
docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F '|' -c \
  "SELECT out_account_id, out_username_digest, out_status, out_requested_at, out_completed_at
     FROM vc.export_account_deletion_tombstones()
    WHERE out_account_id = (SELECT account_id FROM vc.identity_auth_event
                             WHERE username = 'dave-bk' ORDER BY id DESC LIMIT 1)" \
  > "$LOG_DIR/deletion-tombstone.manifest"
IFS='|' read -r T_ACCOUNT T_DIGEST T_STATUS T_REQUESTED T_COMPLETED \
  < "$LOG_DIR/deletion-tombstone.manifest"
[ -n "$T_ACCOUNT" ] && [ "$T_STATUS" = "COMPLETED" ] && [ "${#T_DIGEST}" -eq 64 ] || {
  echo "FAIL: external deletion tombstone manifest invalid" >&2; exit 14;
}
echo "  tombstone manifest exported outside the backup/PITR boundary (digest only)"

echo "== Phase B prep: physical base backup + WAL with post-backup marker =="
docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT pg_switch_wal()" >/dev/null
docker exec "$CID" pg_basebackup -U "$DB_USER" -D - -Ft -X fetch > "$LOG_DIR/base.tar"
docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -q -c \
    "CREATE TABLE IF NOT EXISTS vc.pitr_marker(t text); INSERT INTO vc.pitr_marker VALUES ('post-basebackup-row');"
docker exec "$CID" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT pg_switch_wal()" >/dev/null
sleep 1
mkdir -p "$LOG_DIR/wal"
docker exec "$CID" tar -cf - -C /wal . | tar -xf - -C "$LOG_DIR/wal"
echo "  base backup: $(wc -c < "$LOG_DIR/base.tar") bytes; wal files: $(ls "$LOG_DIR/wal" | wc -l | tr -d ' ')"

echo "== disaster: drop and recreate the database =="
docker exec "$CID" psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$DB_NAME\"" >/dev/null
docker exec "$CID" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\"" >/dev/null

echo "== Phase A restore: pg_restore =="
docker exec -i "$CID" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner < "$LOG_DIR/drill.dump" >>"$LOG_DIR/restore.log" 2>&1 \
    || { echo "pg_restore failed (see $LOG_DIR/restore.log)" >&2; exit 4; }

echo "== Phase A restore: reconcile external deletion tombstone (dry-run -> apply) =="
RECONCILE_ARGS=(-v "account=$T_ACCOUNT" -v "digest=$T_DIGEST" \
  -v "requested=$T_REQUESTED" -v "completed=$T_COMPLETED")
DRY_MATCH=$(docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  "${RECONCILE_ARGS[@]}" <<'SQL'
SELECT vc.reconcile_account_deletion_tombstone(
  :account::bigint, :'digest', :'requested'::timestamptz, :'completed'::timestamptz, false);
SQL
)
[ "$DRY_MATCH" = "1" ] || { echo "FAIL: tombstone dry-run expected 1, got $DRY_MATCH" >&2; exit 15; }
APPLY_MATCH=$(docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  "${RECONCILE_ARGS[@]}" <<'SQL'
SELECT vc.reconcile_account_deletion_tombstone(
  :account::bigint, :'digest', :'requested'::timestamptz, :'completed'::timestamptz, true);
SQL
)
[ "$APPLY_MATCH" = "1" ] || { echo "FAIL: tombstone apply expected 1, got $APPLY_MATCH" >&2; exit 16; }
echo "  external tombstone dry-run and apply OK"

echo "== Phase A verification: business rows survive =="
VERIFY=$(docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -t -A -v ON_ERROR_STOP=1 <<'SQL'
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
    IF v_msg IS NULL THEN
        RAISE EXCEPTION 'restored message content missing';
    END IF;
    SELECT summary INTO v_mem FROM vc.memory_item WHERE status = 'ACCEPTED';
    IF v_mem IS DISTINCT FROM 'drill-memory-summary' THEN
        RAISE EXCEPTION 'restored memory status/summary wrong';
    END IF;
    SELECT summary INTO v_summary FROM vc.conversation_summary WHERE valid;
    IF v_summary IS NULL OR v_summary NOT LIKE 'enc2:%'
       OR v_summary LIKE '%drill-message-plaintext%' THEN
        RAISE EXCEPTION 'restored conversation summary is not opaque ciphertext';
    END IF;
    SELECT count(*) INTO v_exp FROM vc.export_request WHERE status = 'READY';
    IF v_exp <> 1 THEN
        RAISE EXCEPTION 'restored export residue wrong';
    END IF;
    -- Delete-tombstone: the account is gone but its audit trail remains.
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
SELECT 'PHASE-A-DATA-OK';
SQL
)
grep -q 'PHASE-A-DATA-OK' <<<"$VERIFY" || { echo "$VERIFY" >&2; exit 5; }
echo "  data assertions OK (content/memory/summary-cipher/export/tombstone)"

echo "== Phase A verification: RLS holds on the restored schema =="
for t in 01_cross_user_read_denied 02_cross_relationship_reference_denied 70_owner_forged_binding_denied; do
    if docker exec -i "$CID" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
        < "$RLS_TESTS/$t.sql" >"$LOG_DIR/rls-$t.log" 2>&1; then
        echo "  PASS $t (against restored cluster)"
    else
        echo "FAIL $t (see $LOG_DIR/rls-$t.log)" >&2
        exit 6
    fi
done

echo "== Phase B: PITR — base backup + WAL replay into a fresh container =="
# Sleep-entrypoint container: prepare the restored data dir with exec/cp while
# it runs, then a normal start boots postgres straight into recovery.
CID_PITR=$(docker run -d --rm --name "vc-backup-pitr-$$" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    --entrypoint sh "$IMAGE" -c 'sleep infinity')
DATA=/var/lib/postgresql/18/docker
docker exec "$CID_PITR" sh -c "rm -rf $DATA && mkdir -p $DATA/pg_wal $DATA/archive"
cat "$LOG_DIR/base.tar" | docker exec -i "$CID_PITR" sh -c "tar -xf - -C $DATA"
docker cp "$LOG_DIR/wal/." "$CID_PITR:$DATA/archive/"
docker exec "$CID_PITR" sh -c "rm -f $DATA/standby.signal $DATA/postmaster.pid && \
    touch $DATA/recovery.signal && \
    echo \"restore_command = 'cp $DATA/archive/%f %p'\" >> $DATA/postgresql.auto.conf && \
    chmod 700 $DATA && chown -R postgres:postgres $DATA"
# The overridden entrypoint only sleeps: launch postgres directly; it sees
# recovery.signal and replays the archived WAL before accepting connections.
docker exec -d "$CID_PITR" su postgres -c \
    "/usr/lib/postgresql/18/bin/postgres -D $DATA"
wait_ready "$CID_PITR"

MARKER=$(docker exec "$CID_PITR" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT count(*) FROM vc.pitr_marker" 2>/dev/null || echo 0)
if [ "$MARKER" != "1" ]; then
    echo "FAIL: PITR marker row missing after WAL replay (got $MARKER)" >&2
    exit 7
fi
echo "  PITR OK: post-basebackup marker row exists only after WAL replay"

echo "== ALL BACKUP DRILL PHASES PASS =="
