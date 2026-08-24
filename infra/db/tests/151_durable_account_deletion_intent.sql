-- 151_durable_account_deletion_intent: S0-16 intent precedes deletion, blocks
-- new outbound work, cancels durable work/generations, survives cascade, and
-- prevents deleted identity reuse without storing the username plaintext.

\set ON_ERROR_STOP on

TRUNCATE vc.account_deletion_intent, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.work_item,
         vc.realtime_event, vc.realtime_stream, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-delete-intent', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'user-delete-intent', '$2a$10$user.hash.placeholder',
        'USER', 'User') INTO v_user;
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user, 1, 1, 'delete intent');
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.user', v_user::text, false);
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'delete-intent-setup',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|delete-intent-setup', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_generation bigint;
    v_work bigint;
BEGIN
    SELECT generation_id INTO v_generation FROM vc.receive_generation(
        current_setting('t.user')::bigint, 1, 'delete-intent-gen', 'user', 'hello');
    v_work := vc.enqueue_work_item(
        current_setting('t.user')::bigint, 'GENERATION', v_generation, NULL);
    PERFORM set_config('t.generation', v_generation::text, false);
    PERFORM set_config('t.work', v_work::text, false);
END $$;
COMMIT;
RESET ROLE;

-- This transaction models the independently committed coordinator preflight.
BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'delete-intent-request',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|delete-intent-request', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_ok boolean;
    v_denied boolean;
BEGIN
    v_ok := vc.request_account_deletion_current();
    IF NOT v_ok OR NOT vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'durable deletion intent was not accepted';
    END IF;
    PERFORM vc.record_account_deletion_cancel_signals_current(3);

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.receive_generation(
            current_setting('t.user')::bigint, 1,
            'delete-intent-blocked', 'user', 'must not start');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%owner deletion is in progress%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'new generation must be blocked by deletion intent';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM vc.enqueue_work_item(
            current_setting('t.user')::bigint, 'GENERATION',
            current_setting('t.generation')::bigint, NULL);
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%owner deletion is in progress%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'new work item must be blocked by deletion intent';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM vc.identity_account_delete(current_setting('t.user')::bigint);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_api must not call caller-supplied account delete';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_status text;
    v_work text;
    v_cancelled_generations integer;
    v_cancelled_work integer;
    v_signals integer;
    v_denied boolean;
BEGIN
    SELECT status INTO v_status FROM vc.generation
     WHERE owner_user_id = current_setting('t.user')::bigint
       AND id = current_setting('t.generation')::bigint;
    IF v_status <> 'CANCELLED' THEN
        RAISE EXCEPTION 'existing generation was not durably cancelled, got %', v_status;
    END IF;
    SELECT status INTO v_work FROM vc.work_item
     WHERE owner_user_id = current_setting('t.user')::bigint
       AND id = current_setting('t.work')::bigint;
    IF v_work <> 'CANCELLED' THEN
        RAISE EXCEPTION 'existing work item was not durably cancelled, got %', v_work;
    END IF;
    SELECT cancelled_generations, cancelled_work_items, local_cancel_signals
      INTO v_cancelled_generations, v_cancelled_work, v_signals
      FROM vc.account_deletion_intent
     WHERE account_id = current_setting('t.user')::bigint;
    IF v_cancelled_generations <> 1 OR v_cancelled_work <> 1 OR v_signals <> 3 THEN
        RAISE EXCEPTION 'deletion cancellation audit is incomplete: % % %',
            v_cancelled_generations, v_cancelled_work, v_signals;
    END IF;

    v_denied := false;
    BEGIN
        UPDATE vc.message SET content = 'late write'
         WHERE owner_user_id = current_setting('t.user')::bigint;
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%owner deletion is in progress%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'late message update must be blocked';
    END IF;

    v_denied := false;
    BEGIN
        INSERT INTO vc.memory_item(
            owner_user_id, id, relationship_id, scope, summary, status)
        VALUES (current_setting('t.user')::bigint, 999999, 1,
                'RELATIONSHIP', 'late memory', 'PENDING_CONFIRMATION');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%owner deletion is in progress%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'late memory insert must be blocked';
    END IF;

    v_denied := false;
    BEGIN
        INSERT INTO vc.export_request(owner_user_id, id, status)
        VALUES (current_setting('t.user')::bigint, 999999, 'PENDING');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%owner deletion is in progress%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'late export insert must be blocked';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'delete-intent-complete',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|delete-intent-complete', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF NOT vc.identity_account_delete_current() THEN
        RAISE EXCEPTION 'owner-bound account deletion must succeed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
    v_status text;
    v_rejected boolean := false;
BEGIN
    SELECT status INTO v_status FROM vc.account_deletion_intent
     WHERE account_id = current_setting('t.user')::bigint;
    IF v_status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'deletion tombstone must survive as COMPLETED';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'vc' AND table_name = 'account_deletion_intent'
          AND column_name = 'username') THEN
        RAISE EXCEPTION 'deletion tombstone must not store username plaintext';
    END IF;
    SELECT count(*) INTO v_count FROM vc.identity_auth_event
     WHERE account_id = current_setting('t.user')::bigint
       AND event_type IN ('ACCOUNT_DELETE_REQUESTED', 'ACCOUNT_DELETE');
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'request/completion audit events missing, got %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM vc.list_account_deletion_cancellation_targets(256)
     WHERE out_account_id = current_setting('t.user')::bigint;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'completed deletion must remain a short-lived cancellation target';
    END IF;

    BEGIN
        PERFORM vc.identity_account_create(
            current_setting('t.admin')::bigint,
            'user-delete-intent', '$2a$10$reuse.hash.placeholder', 'USER', 'Reused');
    EXCEPTION WHEN others THEN
        v_rejected := SQLERRM LIKE '%identity account creation rejected%';
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'deleted username must not be reusable';
    END IF;
END $$;
