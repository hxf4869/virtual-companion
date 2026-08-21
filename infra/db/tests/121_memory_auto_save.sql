-- 121_memory_auto_save: MEM-AUTO-SAVE V66 — deterministic low-sensitivity
-- auto-save (§7.4 / §11.10 PROPOSED→ACCEPTED 低敏自动规则).
--
-- Covers: the per-owner kill switch defaults ON and round-trips;
-- create_auto_saved_memory inserts directly ACCEPTED with auto_saved=true and
-- the evidence chain; the ordinary candidate path stays PENDING_CONFIRMATION
-- with auto_saved=false (and confirming it keeps the flag false); an
-- auto-saved row stays individually soft-deletable (可随时撤销);
-- list_memory/get_memory expose out_auto_saved; guard failures (foreign
-- relationship, SESSION without conversation, trusted-owner mismatch,
-- unapproved scope) fail closed; vc_worker cannot execute; the pref table is
-- SD-only for the runtime roles.

\set ON_ERROR_STOP on

TRUNCATE vc.emergency_contact, vc.memory_auto_save_pref, vc.consent_record,
         vc.conversation_summary, vc.memory_embedding, vc.trial_grant,
         vc.entitlement_snapshot, vc.service_class_assignment,
         vc.quota_ledger_entry, vc.invite_code, vc.safety_event, vc.age_appeal,
         vc.report_request, vc.age_verification, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.export_request,
         vc.reminder, vc.generation_feedback, vc.memory_evidence,
         vc.memory_item, vc.generation_candidate, vc.generation_attempt,
         vc.generation_route, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.provider_deployment,
         vc.work_item, vc.outbox_event, vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-mas', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-mas', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-mas', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true), (v_bob, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL);

    CREATE TEMP TABLE mas_owner(a bigint, b bigint) ON COMMIT PRESERVE ROWS;
    DELETE FROM mas_owner;
    INSERT INTO mas_owner VALUES (v_alice, v_bob);
END $$;

-- ---------------------------------------------------------------------------
-- Alice: switch round-trip, auto-saved create, candidate contrast, revoke.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('mas.a', (SELECT a::text FROM mas_owner), true),
       set_config('mas.b', (SELECT b::text FROM mas_owner), true);
SELECT vc.set_owner_context(current_setting('mas.a')::bigint, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('mas.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice  bigint := current_setting('mas.a')::bigint;
    v_auto   bigint;
    v_manual bigint;
    n        int;
BEGIN
    -- Kill switch: default ON (§7.4 Beta baseline), round-trips.
    IF NOT vc.get_memory_auto_save_pref(v_alice) THEN
        RAISE EXCEPTION 'auto-save pref must default to enabled';
    END IF;
    PERFORM vc.set_memory_auto_save_pref(v_alice, false);
    IF vc.get_memory_auto_save_pref(v_alice) THEN
        RAISE EXCEPTION 'auto-save pref must store the OFF state';
    END IF;
    PERFORM vc.set_memory_auto_save_pref(v_alice, true);

    -- Auto-saved: directly ACCEPTED, flagged, evidence chained.
    SELECT vc.create_auto_saved_memory(
        v_alice, 1, 'RELATIONSHIP', '称呼偏好：小雪', NULL,
        ARRAY['message:101']) INTO v_auto;
    IF v_auto IS NULL OR v_auto <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory must return an id';
    END IF;
    SELECT count(*) INTO n FROM vc.get_memory(v_alice, v_auto) g
     WHERE g.out_status = 'ACCEPTED' AND g.out_auto_saved;
    IF n <> 1 THEN
        RAISE EXCEPTION 'auto-saved memory must be ACCEPTED and flagged';
    END IF;
    SELECT count(*) INTO n FROM vc.list_memory_evidence(v_alice, v_auto);
    IF n <> 1 THEN
        RAISE EXCEPTION 'auto-saved memory must keep its evidence chain';
    END IF;

    -- Ordinary candidate: PENDING_CONFIRMATION and unflagged; confirming
    -- keeps the flag false (the auto rule is the only flagged path).
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '今天聊了很多', NULL) INTO v_manual;
    PERFORM vc.confirm_memory_candidate(v_alice, v_manual);
    SELECT count(*) INTO n FROM vc.get_memory(v_alice, v_manual) g
     WHERE g.out_status = 'ACCEPTED' AND NOT g.out_auto_saved;
    IF n <> 1 THEN
        RAISE EXCEPTION 'a confirmed candidate must stay unflagged';
    END IF;

    -- list_memory surfaces both flags.
    SELECT count(*) INTO n FROM vc.list_memory(v_alice, 1, false) m
     WHERE m.out_auto_saved;
    IF n <> 1 THEN
        RAISE EXCEPTION 'exactly one auto-saved row must be flagged in the list';
    END IF;

    -- 可随时撤销: the auto-saved row soft-deletes like any other.
    PERFORM vc.delete_memory(v_alice, v_auto);
    SELECT count(*) INTO n FROM vc.list_memory(v_alice, 1, true) m
     WHERE m.out_id = v_auto AND m.out_deleted_at IS NOT NULL AND m.out_auto_saved;
    IF n <> 1 THEN
        RAISE EXCEPTION 'the deleted auto-saved row must stay flagged for audit';
    END IF;

    -- Guards fail closed.
    BEGIN
        PERFORM vc.create_auto_saved_memory(
            v_alice, 999, 'RELATIONSHIP', 'x', NULL, ARRAY[]::text[]);
        RAISE EXCEPTION 'foreign relationship unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%foreign relationship unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%relationship not found for owner%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_auto_saved_memory(
            v_alice, 1, 'SESSION', 'x', NULL, ARRAY[]::text[]);
        RAISE EXCEPTION 'SESSION without conversation unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%SESSION without conversation unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%SESSION scope requires a conversation_id%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_auto_saved_memory(
            v_alice, 1, 'ACCOUNT_PRIVATE', 'x', NULL, ARRAY[]::text[]);
        RAISE EXCEPTION 'unapproved scope unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved scope unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%not enabled in Alpha%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;

-- Cross-owner trusted-owner assertion + bob's own default pref.
BEGIN;
SELECT set_config('mas.a', (SELECT a::text FROM mas_owner), true),
       set_config('mas.b', (SELECT b::text FROM mas_owner), true);
SELECT vc.set_owner_context(current_setting('mas.b')::bigint, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('mas.b') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_bob bigint := current_setting('mas.b')::bigint;
BEGIN
    BEGIN
        PERFORM vc.create_auto_saved_memory(
            current_setting('mas.a')::bigint, 1, 'RELATIONSHIP', 'x', NULL, ARRAY[]::text[]);
        RAISE EXCEPTION 'owner-mismatched auto-save unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%owner-mismatched auto-save unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN RAISE; END IF;
    END;
    IF NOT vc.get_memory_auto_save_pref(v_bob) THEN
        RAISE EXCEPTION 'each owner starts with the default ON switch';
    END IF;
END $$;
RESET ROLE;

-- vc_worker cannot execute the auto-save paths; the pref table is SD-only.
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.create_auto_saved_memory(1, 1, 'RELATIONSHIP', 'x', NULL, ARRAY[]::text[]);
    RAISE EXCEPTION 'vc_worker unexpectedly executed create_auto_saved_memory';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM 1 FROM vc.memory_auto_save_pref;
    RAISE EXCEPTION 'vc_api unexpectedly read memory_auto_save_pref directly';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
