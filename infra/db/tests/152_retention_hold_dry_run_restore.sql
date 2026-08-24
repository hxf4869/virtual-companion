-- 152_retention_hold_dry_run_restore: S0-17 policy stays DRAFT by default,
-- legal holds protect owners, dry-run is non-destructive, runtime cannot bypass
-- the active-policy wrapper, and PITR tombstone reconciliation is dry-run first.

\set ON_ERROR_STOP on

TRUNCATE vc.retention_legal_hold, vc.account_deletion_intent,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.message, vc.conversation, vc.relationship, vc.vc_user CASCADE;
UPDATE vc.data_retention_policy SET status = 'DRAFT';

DO $$
DECLARE
    v_admin bigint;
    v_held bigint;
    v_other bigint;
    v_denied boolean := false;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-retention-hold', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'held-retention-user', '$2a$10$held.hash.placeholder',
        'USER', 'Held') INTO v_held;
    SELECT vc.identity_account_create(
        v_admin, 'other-retention-user', '$2a$10$other.hash.placeholder',
        'USER', 'Other') INTO v_other;
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_held, 1, 'gentle-listener', true),
           (v_other, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_held, 1, 1, NULL), (v_other, 1, 1, NULL);
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, created_at)
    VALUES (v_held, 1001, 1, 'user', 'held', now() - interval '400 days'),
           (v_other, 1002, 1, 'user', 'other', now() - interval '400 days');
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.held', v_held::text, false);
    PERFORM set_config('t.other', v_other::text, false);

    BEGIN
        PERFORM vc.active_retention_days('NORMAL_CHAT');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%no active policy%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'DRAFT policy must fail closed';
    END IF;
    -- Test-only approval. Repository defaults remain DRAFT.
    UPDATE vc.data_retention_policy SET status = 'ACTIVE' WHERE policy_version = 1;
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.admin')::bigint,
    'retention-hold-admin',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.admin') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|retention-hold-admin', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_hold bigint;
    v_count integer;
BEGIN
    v_hold := vc.set_retention_legal_hold_current(
        current_setting('t.held')::bigint, 'NORMAL_CHAT', 'LEGAL');
    PERFORM set_config('t.hold', v_hold::text, false);
    v_count := vc.retention_dry_run('NORMAL_CHAT', now() - interval '365 days');
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'dry-run must exclude the held owner, got %', v_count;
    END IF;
    v_count := vc.run_retention_category('NORMAL_CHAT', true);
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'active-policy dry-run wrapper expected 1, got %', v_count;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count FROM vc.message;
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'dry-run must not delete rows';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.admin')::bigint,
    'retention-purge-admin',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.admin') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|retention-purge-admin', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_count integer;
BEGIN
    v_count := vc.run_retention_category('NORMAL_CHAT', false);
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'purge must remove only the unheld owner row, got %', v_count;
    END IF;
    IF NOT vc.release_retention_legal_hold_current(current_setting('t.hold')::bigint) THEN
        RAISE EXCEPTION 'legal hold release failed';
    END IF;
    v_count := vc.run_retention_category('NORMAL_CHAT', false);
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'released owner row must purge, got %', v_count;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_digest text := vc.username_tombstone_digest('other-retention-user');
    v_matches integer;
    v_count integer;
BEGIN
    IF has_function_privilege(
        'vc_api', 'vc.retention_purge_normal_chat(timestamptz)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api must not bypass active policy with a raw purge cutoff';
    END IF;
    IF NOT has_function_privilege(
        'vc_api', 'vc.run_retention_category(text, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api lacks policy-bound retention wrapper';
    END IF;

    v_matches := vc.reconcile_account_deletion_tombstone(
        current_setting('t.other')::bigint, v_digest,
        now() - interval '2 hours', now() - interval '1 hour', false);
    IF v_matches <> 1 OR NOT EXISTS (
        SELECT 1 FROM vc.identity_account WHERE id = current_setting('t.other')::bigint) THEN
        RAISE EXCEPTION 'restore reconciliation dry-run must be non-destructive';
    END IF;
    v_matches := vc.reconcile_account_deletion_tombstone(
        current_setting('t.other')::bigint, v_digest,
        now() - interval '2 hours', now() - interval '1 hour', true);
    IF v_matches <> 1 OR EXISTS (
        SELECT 1 FROM vc.identity_account WHERE id = current_setting('t.other')::bigint) THEN
        RAISE EXCEPTION 'restore reconciliation apply did not remove resurrected identity';
    END IF;
    SELECT count(*) INTO v_count FROM vc.export_account_deletion_tombstones()
     WHERE out_account_id = current_setting('t.other')::bigint
       AND out_status = 'COMPLETED';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'completed tombstone missing from external manifest';
    END IF;
    IF has_function_privilege(
        'vc_api',
        'vc.reconcile_account_deletion_tombstone(bigint, text, timestamptz, timestamptz, boolean)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'runtime must not apply restore tombstone manifests';
    END IF;
END $$;
