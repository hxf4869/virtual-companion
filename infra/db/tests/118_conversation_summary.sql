-- 118_conversation_summary: CONV-SUMMARY V63 — L2 summaries + FR-CHAT-004.
--
-- Covers: record_conversation_summary builds the version chain (prev_id) and
-- enforces the quality floor (an ECONOMY write after a validated PREMIUM row
-- is skipped, returning 0); record_turn_summary resolves the snapshot's
-- actual class and the covered message range, producing a deterministic
-- summary; latest_conversation_summary surfaces only VALID rows; deleting a
-- message inside a covered range invalidates the summary (FR-CHAT-004) while
-- the row stays in the chain; cross-owner isolation and vc_api-only grants.

\set ON_ERROR_STOP on

TRUNCATE vc.conversation_summary, vc.memory_embedding, vc.trial_grant,
         vc.entitlement_snapshot, vc.service_class_assignment,
         vc.quota_ledger_entry, vc.invite_code, vc.safety_event, vc.age_appeal,
         vc.report_request, vc.age_verification, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.export_request,
         vc.consent_record, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-sum', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-sum', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-sum', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;
    -- PREMIUM for alice up front (ADMIN acting).
    PERFORM vc.assign_service_class(v_admin, v_alice, 'PREMIUM');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true), (v_bob, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL), (v_bob, 1, 1, NULL);
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (v_alice, 10, 1, 'user', '第一轮'), (v_alice, 11, 1, 'assistant', '回应一'),
           (v_alice, 12, 1, 'user', '第二轮'), (v_alice, 13, 1, 'assistant', '回应二'),
           (v_bob, 10, 1, 'user', 'bob 的消息');
    INSERT INTO vc.generation(owner_user_id, id, conversation_id,
                              logical_generation_id, status)
    VALUES (v_alice, 100, 1, 'sum-gen-1', 'IN_PROGRESS'),
           (v_alice, 101, 1, 'sum-gen-2', 'IN_PROGRESS');
    UPDATE vc.message SET generation_id = 100 WHERE owner_user_id = v_alice AND id = 11;
    UPDATE vc.message SET generation_id = 101 WHERE owner_user_id = v_alice AND id = 13;
    CREATE TEMP TABLE sum_owner(a bigint, b bigint) ON COMMIT PRESERVE ROWS;
    DELETE FROM sum_owner;
    INSERT INTO sum_owner VALUES (v_alice, v_bob);
END $$;


BEGIN;
SELECT set_config('sum.a', (SELECT a::text FROM sum_owner), true),
       set_config('sum.b', (SELECT b::text FROM sum_owner), true);
SELECT vc.set_owner_context(current_setting('sum.a')::bigint, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('sum.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint := current_setting('sum.a')::bigint;
    v_sum1 bigint;
    v_sum2 bigint;
    n       int;
    v_prev  bigint;
    v_valid boolean;
BEGIN
    -- Direct record: PREMIUM first, chain link follows.
    SELECT vc.record_conversation_summary(
        v_alice, 1, 10, 11, '第一段摘要（PREMIUM）', 'model-a', '2', '2026-08',
        0.95, true, 'PREMIUM') INTO v_sum1;
    IF v_sum1 IS NULL OR v_sum1 <= 0 THEN
        RAISE EXCEPTION 'first PREMIUM summary must be recorded';
    END IF;

    -- Quality floor: ECONOMY after validated PREMIUM is skipped (returns 0).
    SELECT vc.record_conversation_summary(
        v_alice, 1, 10, 13, '降级摘要（ECONOMY）', 'model-b', '1', '2026-08',
        0.9, true, 'ECONOMY') INTO v_sum2;
    IF v_sum2 <> 0 THEN
        RAISE EXCEPTION 'ECONOMY write after validated PREMIUM must be skipped, got %', v_sum2;
    END IF;

    -- A PREMIUM follow-up extends the chain with prev_id = the first row.
    SELECT vc.record_conversation_summary(
        v_alice, 1, 10, 13, '第二段摘要（PREMIUM）', 'model-a', '2', '2026-08',
        0.95, true, 'PREMIUM') INTO v_sum2;
    IF v_sum2 IS NULL OR v_sum2 <= 0 THEN
        RAISE EXCEPTION 'PREMIUM follow-up must be recorded';
    END IF;
    SELECT out_prev_id INTO v_prev FROM vc.latest_conversation_summary(v_alice, 1);
    IF v_prev <> v_sum1 THEN
        RAISE EXCEPTION 'chain must link to the previous row, got %', v_prev;
    END IF;

    -- Range/confidence validation fails closed.
    BEGIN
        PERFORM vc.record_conversation_summary(
            1, 1, 13, 10, 'x', 'm', '1', '1', 1.0, true, 'PREMIUM');
        RAISE EXCEPTION 'inverted range unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%range%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.record_conversation_summary(
            1, 1, 10, 11, 'x', 'm', '1', '1', 1.5, true, 'PREMIUM');
        RAISE EXCEPTION 'confidence > 1 unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%confidence%' THEN RAISE; END IF;
    END;

    -- record_turn_summary: snapshot actual class drives the quality tier.
    -- Snapshot PREMIUM (not degraded) → summary recorded. The snapshot is
    -- minted through the SD (entitlement_snapshot is SD-only); assign
    -- PREMIUM FIRST so the mint resolves PREMIUM, not the ECONOMY default.
    PERFORM vc.mint_entitlement_snapshot(v_alice, 100, false);
    SELECT vc.record_turn_summary(v_alice, 100) INTO n;
    IF n IS NULL OR n <= 0 THEN
        RAISE EXCEPTION 'turn summary must be recorded for PREMIUM turn';
    END IF;

    -- Degraded snapshot (entitled PREMIUM, actual ECONOMY):
    -- mint with degraded=true; the floor then skips the turn summary.
    PERFORM vc.mint_entitlement_snapshot(v_alice, 101, true);
        SELECT vc.record_turn_summary(v_alice, 101) INTO n;
    IF n <> 0 THEN
        RAISE EXCEPTION 'degraded turn summary must be skipped by the floor, got %', n;
    END IF;

    -- FR-CHAT-004: deleting a message inside the covered range invalidates
    -- the summary; the row stays, latest stops surfacing it.
    SELECT count(*) INTO n FROM vc.latest_conversation_summary(v_alice, 1);
    IF n <> 1 THEN
        RAISE EXCEPTION 'latest must surface one summary before deletion';
    END IF;
    PERFORM vc.delete_message(v_alice, 1, 11);
    SELECT count(*) INTO n FROM vc.latest_conversation_summary(v_alice, 1);
    IF n <> 0 THEN
        RAISE EXCEPTION 'covering summary must be invalidated by message delete';
    END IF;
    -- The chain row still exists (audit), flagged invalid (checked as the
    -- test role after RESET ROLE below).

    -- A message outside every covered range invalidates nothing (row 12 is
    -- covered; use bob's message to prove isolation instead).
    PERFORM vc.delete_message(v_alice, 1, 12);
END $$;
RESET ROLE;

-- The invalid row stays in the chain for audit (direct read as test role).
DO $$
DECLARE n int; v_valid boolean;
BEGIN
    SELECT count(*), bool_and(valid) INTO n, v_valid
      FROM vc.conversation_summary WHERE owner_user_id = (SELECT a FROM sum_owner);
    IF n <> 3 THEN
        RAISE EXCEPTION 'three chain rows must remain (two direct + one turn; the degraded turn was skipped), got %', n;
    END IF;
    IF v_valid IS NOT FALSE THEN
        RAISE EXCEPTION 'covering rows must be invalid after deletes';
    END IF;
END $$;

BEGIN;
SELECT set_config('sum.a', (SELECT a::text FROM sum_owner), true),
       set_config('sum.b', (SELECT b::text FROM sum_owner), true);
SELECT vc.set_owner_context(current_setting('sum.b')::bigint, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('sum.b') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_bob bigint := current_setting('sum.b')::bigint;
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.latest_conversation_summary(v_bob, 1);
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner must not see alice summaries';
    END IF;
    BEGIN
        -- Under bob's context, an owner-mismatched write (alice's owner id)
        -- must fail the trusted-owner assertion.
        PERFORM vc.record_conversation_summary(
            current_setting('sum.a')::bigint, 1, 10, 10, 'x', 'm', '1', '1',
            1.0, true, 'PREMIUM');
        RAISE EXCEPTION 'owner-mismatched summary write unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;

BEGIN;
SELECT set_config('sum.a', (SELECT a::text FROM sum_owner), true);
SELECT vc.set_owner_context(current_setting('sum.a')::bigint, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('sum.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.latest_conversation_summary(current_setting('sum.a')::bigint, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed latest_conversation_summary';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
