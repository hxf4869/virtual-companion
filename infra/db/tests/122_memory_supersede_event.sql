-- 122_memory_supersede_event: R44 MEM-SUPERSEDE / MEM-EVENT V68 — explicit
-- supersede chain (§7.3.3, §11.11) and the minimal event lifecycle with lazy
-- EXPIRED (§11.12).
--
-- Covers: event-triple validation on create (any event field requires
-- event_at; catalog status; expiry strictly after start); the explicit
-- supersede path — old row keeps status ACCEPTED but gains superseded_at /
-- superseded_by_memory_id and drops out of recall_memory AND semantic_recall
-- (stale embedding never resurfaces it); supersede guards (self, PENDING
-- target, cross-relationship, foreign owner); update_memory event edits
-- (COMPLETED marking; event fields on a non-event row rejected); lazy expiry
-- (a confirmed event whose event_expires_at passed flips to EXPIRED on the
-- first list/get/recall read and never feeds the generation context); vc_worker
-- cannot execute the new paths.

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
    SELECT vc.identity_admin_seed('root-mse', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-mse', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-mse', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;
    -- Two relationships for Alice: the cross-relationship supersede guard
    -- needs a same-owner, different-relationship target.
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true),
           (v_alice, 2, 'gentle-listener', false),
           (v_bob, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL);

    CREATE TEMP TABLE mse_owner(a bigint, b bigint) ON COMMIT PRESERVE ROWS;
    DELETE FROM mse_owner;
    INSERT INTO mse_owner VALUES (v_alice, v_bob);
END $$;

-- ---------------------------------------------------------------------------
-- Alice: event validation, supersede chain + recall exclusion, guards,
-- lifecycle (lazy EXPIRED, COMPLETED marking) and semantic exclusion.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('mse.a', (SELECT a::text FROM mse_owner), true),
       set_config('mse.b', (SELECT b::text FROM mse_owner), true);
SELECT vc.set_owner_context(current_setting('mse.a')::bigint, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('mse.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint := current_setting('mse.a')::bigint;
    v_c1    bigint;
    v_c2    bigint;
    v_c3    bigint;
    v_c4    bigint;
    v_e1    bigint;
    v_e2    bigint;
    v_m1    bigint;
    v_m2    bigint;
    v_rel   bigint;
    v_sum   text;
    v_es    text;
    v_at    timestamptz;
    n       int;
BEGIN
    -- -----------------------------------------------------------------
    -- Event-triple validation (§11.12): anchor required, catalog status,
    -- expiry strictly after the start.
    -- -----------------------------------------------------------------
    BEGIN
        PERFORM vc.create_memory_candidate(
            v_alice, 1, 'RELATIONSHIP', '周五汇报', NULL, ARRAY[]::text[],
            NULL, 'PLANNED', NULL);
        RAISE EXCEPTION 'event_status without event_at unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%event_status without event_at unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%require event_at%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_memory_candidate(
            v_alice, 1, 'RELATIONSHIP', '周五汇报', NULL, ARRAY[]::text[],
            now() + interval '2 days', 'SOMEDAY', NULL);
        RAISE EXCEPTION 'unknown event_status unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unknown event_status unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%unknown event_status%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_memory_candidate(
            v_alice, 1, 'RELATIONSHIP', '周五汇报', NULL, ARRAY[]::text[],
            now() + interval '2 days', 'PLANNED', now() + interval '1 day');
        RAISE EXCEPTION 'expiry before start unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%expiry before start unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%must be after event_at%' THEN RAISE; END IF;
    END;

    -- -----------------------------------------------------------------
    -- Explicit supersede (§11.11): confirm a newer fact over an older one.
    -- -----------------------------------------------------------------
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '用户在 A 公司工作', NULL, ARRAY[]::text[])
      INTO v_c1;
    PERFORM vc.confirm_memory_candidate(v_alice, v_c1);
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '用户换到 B 公司工作', NULL, ARRAY[]::text[])
      INTO v_c2;
    PERFORM vc.confirm_memory_candidate(v_alice, v_c2, v_c1);

    -- Old row: status stays ACCEPTED (tombstone columns carry SUPERSEDED),
    -- the chain points at the replacing memory.
    SELECT out_superseded_at, out_superseded_by_memory_id
      INTO v_at, v_rel
      FROM vc.list_memory(v_alice, 1, false)
     WHERE out_id = v_c1;
    IF v_at IS NULL OR v_rel IS DISTINCT FROM v_c2 THEN
        RAISE EXCEPTION 'supersede chain wrong: % / %', v_at, v_rel;
    END IF;
    SELECT count(*) INTO n FROM vc.list_memory(v_alice, 1, false)
     WHERE out_id = v_c2 AND out_superseded_at IS NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'the replacing memory must stay unsuperseded';
    END IF;

    -- Recall keeps only the surviving fact.
    SELECT count(*) INTO n FROM vc.recall_memory(v_alice, 1, NULL, 50);
    IF n <> 1 THEN
        RAISE EXCEPTION 'recall must exclude the superseded memory (got % rows)', n;
    END IF;
    SELECT count(*) INTO n FROM vc.recall_memory(v_alice, 1, NULL, 50)
     WHERE out_summary = '用户换到 B 公司工作';
    IF n <> 1 THEN
        RAISE EXCEPTION 'the replacing memory must be recalled';
    END IF;

    -- -----------------------------------------------------------------
    -- Supersede guards: self, PENDING target, cross-relationship.
    -- -----------------------------------------------------------------
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '又一次自我替代', NULL, ARRAY[]::text[])
      INTO v_c3;
    BEGIN
        PERFORM vc.confirm_memory_candidate(v_alice, v_c3, v_c3);
        RAISE EXCEPTION 'self-supersede unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%self-supersede unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%cannot supersede itself%' THEN RAISE; END IF;
    END;
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '待确认的新事实', NULL, ARRAY[]::text[])
      INTO v_c4;
    BEGIN
        PERFORM vc.confirm_memory_candidate(v_alice, v_c3, v_c4);
        RAISE EXCEPTION 'PENDING supersede target unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%PENDING supersede target unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%not an active canonical memory%' THEN RAISE; END IF;
    END;
    SELECT vc.create_memory_candidate(
        v_alice, 2, 'RELATIONSHIP', '另一段关系的记忆', NULL, ARRAY[]::text[])
      INTO v_rel;
    PERFORM vc.confirm_memory_candidate(v_alice, v_rel);
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '替代失败案例', NULL, ARRAY[]::text[])
      INTO v_rel;
    BEGIN
        -- v_rel is a fresh PENDING candidate of relationship 1; the target is
        -- the ACCEPTED relationship-2 memory.
        PERFORM vc.confirm_memory_candidate(
            v_alice, v_rel,
            (SELECT out_id FROM vc.list_memory(v_alice, 2, false) LIMIT 1));
        RAISE EXCEPTION 'cross-relationship supersede unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cross-relationship supersede unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%another relationship%' THEN RAISE; END IF;
    END;

    -- -----------------------------------------------------------------
    -- Event lifecycle: lazy EXPIRED on read; live events ride recall with
    -- their §11.12 pair; COMPLETED marking via update_memory.
    -- -----------------------------------------------------------------
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '上个月的体检', NULL, ARRAY[]::text[],
        now() - interval '2 days', 'PLANNED', now() - interval '1 day')
      INTO v_e1;
    PERFORM vc.confirm_memory_candidate(v_alice, v_e1);
    -- The first read (list) lazily flips the overdue event to EXPIRED.
    SELECT count(*) INTO n FROM vc.list_memory(v_alice, 1, false)
     WHERE out_id = v_e1 AND out_status = 'EXPIRED';
    IF n <> 1 THEN
        RAISE EXCEPTION 'overdue event must be lazily EXPIRED on read';
    END IF;
    SELECT count(*) INTO n FROM vc.recall_memory(v_alice, 1, NULL, 50)
     WHERE out_id = v_e1;
    IF n <> 0 THEN
        RAISE EXCEPTION 'an EXPIRED event must never feed the generation context';
    END IF;

    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '周五有项目汇报', NULL, ARRAY[]::text[],
        now() + interval '1 day', 'PLANNED', now() + interval '30 days')
      INTO v_e2;
    PERFORM vc.confirm_memory_candidate(v_alice, v_e2);
    SELECT count(*) INTO n FROM vc.recall_memory(v_alice, 1, NULL, 50)
     WHERE out_id = v_e2 AND out_event_status = 'PLANNED'
       AND out_event_at IS NOT NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'a live event must ride recall with its §11.12 pair';
    END IF;
    -- The user reports the outcome: mark COMPLETED (summary resent, event
    -- status edited; absent event params keep stored values).
    PERFORM vc.update_memory(
        v_alice, v_e2, '周五的项目汇报已完成', NULL, 'COMPLETED', NULL);
    SELECT out_status, out_event_status INTO v_sum, v_es
      FROM vc.get_memory(v_alice, v_e2);
    IF v_sum <> 'ACCEPTED' OR v_es <> 'COMPLETED' THEN
        RAISE EXCEPTION 'event marking wrong: % / %', v_sum, v_es;
    END IF;
    -- Event fields on a non-event row are rejected (shape guard).
    BEGIN
        PERFORM vc.update_memory(
            v_alice, v_c2, '用户换到 B 公司工作', NULL, 'COMPLETED', NULL);
        RAISE EXCEPTION 'event edit on a non-event row unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%event edit on a non-event row unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%require event_at%' THEN RAISE; END IF;
    END;

    -- -----------------------------------------------------------------
    -- semantic_recall: a superseded memory never resurfaces through its
    -- (stale) embedding.
    -- -----------------------------------------------------------------
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '喜欢安静的晚上', NULL, ARRAY[]::text[])
      INTO v_m1;
    PERFORM vc.confirm_memory_candidate(v_alice, v_m1);
    PERFORM vc.upsert_memory_embedding(
        v_alice, v_m1, 'deterministic-hash', '1', 64, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]');
    SELECT count(*) INTO n FROM vc.semantic_recall(v_alice, 1, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10);
    IF n <> 1 THEN
        RAISE EXCEPTION 'embedded live memory must surface semantically (got %)', n;
    END IF;
    SELECT vc.create_memory_candidate(
        v_alice, 1, 'RELATIONSHIP', '更喜欢热闹的晚上', NULL, ARRAY[]::text[])
      INTO v_m2;
    PERFORM vc.confirm_memory_candidate(v_alice, v_m2, v_m1);
    SELECT count(*) INTO n FROM vc.semantic_recall(v_alice, 1, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10);
    IF n <> 0 THEN
        RAISE EXCEPTION 'a superseded memory must never resurface semantically (got %)', n;
    END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Bob: a foreign supersede target is an owner-scoped not-found; existence is
-- never disclosed.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(current_setting('mse.b')::bigint, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('mse.b') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_bob   bigint := current_setting('mse.b')::bigint;
    v_alice bigint := current_setting('mse.a')::bigint;
    v_c     bigint;
BEGIN
    SELECT vc.create_memory_candidate(
        v_bob, 1, 'RELATIONSHIP', 'bob 的新事实', NULL, ARRAY[]::text[]) INTO v_c;
    BEGIN
        PERFORM vc.confirm_memory_candidate(v_bob, v_c, v_alice + 1000000);
        RAISE EXCEPTION 'foreign supersede target unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%foreign supersede target unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%not found for owner%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;

-- vc_worker cannot execute the new paths (grant check fires first).
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.confirm_memory_candidate(1, 1, 2);
    RAISE EXCEPTION 'vc_worker unexpectedly executed the supersede confirm';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
