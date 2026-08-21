-- 88_generation_retry_reconcile: V33 idempotent promote + stale-intent
-- closure + event existence probe + stale-generation enumeration.
--
-- Covers: promote_generation accepts IN_PROGRESS → IN_PROGRESS as a no-op
-- (RETRY-A re-run of the prepare segment no longer aborts) while the forward
-- edges and the terminal-state rejection stay intact; close_stale_attempt_intents
-- closes exactly the still-CREATED intents of one work item and returns the
-- count; generation_has_event probes a durable event without disclosing to a
-- foreign owner; list_stale_in_progress_generations returns exactly the
-- IN_PROGRESS generations whose GENERATION work item is terminal. The owner
-- context follows test 85's transaction-bound set_owner_context pattern.

\set ON_ERROR_STOP on

TRUNCATE vc.attempt_intent, vc.work_item, vc.outbox_event, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');

-- ===========================================================================
-- 1. promote_generation idempotence (owner 1).
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n88a', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen bigint;
    v_status text;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel) INTO v_conv;
    SELECT generation_id INTO v_gen FROM vc.receive_generation(1, v_conv, 'idem-88a', 'user', 'hello');

    SELECT vc.promote_generation(1, v_gen, 'IN_PROGRESS') INTO v_status;
    IF v_status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'first promote must return IN_PROGRESS, got %', v_status;
    END IF;

    -- Idempotent no-op edge: the RETRY-A re-run of the prepare segment must
    -- not raise and must not change the status.
    SELECT vc.promote_generation(1, v_gen, 'IN_PROGRESS') INTO v_status;
    IF v_status <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'idempotent promote must return IN_PROGRESS, got %', v_status;
    END IF;

    -- Forward edge still works after the no-op.
    SELECT vc.promote_generation(1, v_gen, 'FINAL_REVIEW') INTO v_status;
    IF v_status <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'forward promote must return FINAL_REVIEW, got %', v_status;
    END IF;

    -- No backward edge from FINAL_REVIEW.
    BEGIN
        PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
        RAISE EXCEPTION 'FINAL_REVIEW -> IN_PROGRESS must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%FINAL_REVIEW -> IN_PROGRESS must fail closed%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
END $$;
COMMIT;

-- ===========================================================================
-- 2. close_stale_attempt_intents (owner 1): closes exactly the CREATED
--    intents of one work item; trusted-owner mismatch fails closed.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n88b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen bigint;
    v_wi bigint;
    v_n int;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel) INTO v_conv;
    SELECT generation_id INTO v_gen FROM vc.receive_generation(1, v_conv, 'idem-88b', 'user', 'hello');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (1, nextval('vc.work_item_id_seq'), 'GENERATION', v_gen, 'PENDING')
    RETURNING id INTO v_wi;
    -- The intent row carries FKs to the dual authorization snapshots (V26).
    INSERT INTO vc.authorization_snapshot(
        owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
        purpose, data_categories)
    VALUES (1, 'snap-88-req', 'ACTIVE', 'prov', 'cn-north', 'contract-88',
            'COMPANION_CHAT', ARRAY['TEXT']::text[]),
           (1, 'snap-88-exec', 'ACTIVE', 'prov', 'cn-north', 'contract-88',
            'COMPANION_CHAT', ARRAY['TEXT']::text[]);

    -- Two still-CREATED intents of the same work item (crash-recovered run).
    INSERT INTO vc.attempt_intent(
        owner_user_id, id, work_item_id, generation_id, provider_attempt_id,
        provider_id, supplier_name, status, claim_token_hash, claim_fence_hash,
        requested_authorization_snapshot, execution_authorization_snapshot)
    VALUES (1, nextval('vc.attempt_intent_id_seq'), v_wi, v_gen,
            'pa-88-1', 'prov', 'supplier', 'CREATED', 'h-tok', 'h-fen', 'snap-88-req', 'snap-88-exec'),
           (1, nextval('vc.attempt_intent_id_seq'), v_wi, v_gen,
            'pa-88-2', 'prov', 'supplier', 'CREATED', 'h-tok', 'h-fen', 'snap-88-req', 'snap-88-exec');

    SELECT vc.close_stale_attempt_intents(1, v_wi) INTO v_n;
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'close must report 2 closed intents, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.attempt_intent
     WHERE work_item_id = v_wi AND status = 'ABANDONED_LATE';
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'both intents must be ABANDONED_LATE, got %', v_n;
    END IF;

    -- Second call closes nothing.
    SELECT vc.close_stale_attempt_intents(1, v_wi) INTO v_n;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'second close must report 0, got %', v_n;
    END IF;
END $$;
COMMIT;

-- Trusted-owner assertion: caller context owner 2 with param owner 1 fails.
BEGIN;
SELECT vc.set_owner_context(2, 'n88c', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88c', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    PERFORM vc.close_stale_attempt_intents(1, 1);
    RAISE EXCEPTION 'trusted-owner mismatch must fail closed';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%trusted-owner mismatch must fail closed%' THEN
        RAISE;
    END IF;
    NULL; -- expected
END $$;
COMMIT;

-- ===========================================================================
-- 3. generation_has_event (owner 1): true only for the appended durable
--    event; a foreign owner fails closed.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n88d', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88d', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen bigint;
    v_epoch bigint;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel) INTO v_conv;
    SELECT generation_id INTO v_gen FROM vc.receive_generation(1, v_conv, 'idem-88d', 'user', 'hello');
    SELECT out_stream_epoch INTO v_epoch FROM vc.ensure_realtime_stream(1, v_gen);

    PERFORM vc.append_realtime_event(1, v_gen, v_epoch, 'chat.accepted',
        ('{"generation_id":' || v_gen || '}')::jsonb);

    IF NOT vc.generation_has_event(1, v_gen, 'chat.accepted') THEN
        RAISE EXCEPTION 'generation_has_event must find the appended chat.accepted';
    END IF;
    IF vc.generation_has_event(1, v_gen, 'chat.completed') THEN
        RAISE EXCEPTION 'generation_has_event must not find an unappended event';
    END IF;
END $$;
COMMIT;

-- Foreign owner fails closed.
BEGIN;
SELECT vc.set_owner_context(2, 'n88e', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88e', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    -- Fail-closed by design: a foreign generation is simply "no event" —
    -- generation_has_event is owner-scoped in the WHERE clause (V33) and
    -- returns false instead of raising so existence is never disclosed.
    IF vc.generation_has_event(2, 1, 'chat.accepted') THEN
        RAISE EXCEPTION 'foreign generation_has_event must fail closed (return false)';
    END IF;
END $$;
COMMIT;

-- ===========================================================================
-- 4. list_stale_in_progress_generations: only terminal-work-item orphans.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n88f', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88f', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen_stale bigint;
    v_gen_live bigint;
    v_wi_failed bigint;
    v_wi_pending bigint;
    v_n int;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel) INTO v_conv;

    -- Orphan: IN_PROGRESS generation + FAILED work item (independent-fail path).
    SELECT generation_id INTO v_gen_stale FROM vc.receive_generation(1, v_conv, 'idem-88f1', 'user', 'hello');
    PERFORM vc.promote_generation(1, v_gen_stale, 'IN_PROGRESS');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (1, nextval('vc.work_item_id_seq'), 'GENERATION', v_gen_stale, 'FAILED')
    RETURNING id INTO v_wi_failed;

    -- Healthy: IN_PROGRESS generation + still-PENDING work item.
    SELECT generation_id INTO v_gen_live FROM vc.receive_generation(1, v_conv, 'idem-88f2', 'user', 'hello');
    PERFORM vc.promote_generation(1, v_gen_live, 'IN_PROGRESS');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (1, nextval('vc.work_item_id_seq'), 'GENERATION', v_gen_live, 'PENDING')
    RETURNING id INTO v_wi_pending;

    SELECT count(*) INTO v_n FROM vc.list_stale_in_progress_generations()
     WHERE out_generation_id = v_gen_stale;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'stale generation must be enumerated, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.list_stale_in_progress_generations()
     WHERE out_generation_id = v_gen_live;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'live generation must not be enumerated, got %', v_n;
    END IF;
END $$;
COMMIT;

-- 对账终态化闭环：孤儿被 terminalize_generation 终态化为 FAILED_FINAL 后
-- 不再出现在枚举中，且 chat.failed durable 事件已落库。
BEGIN;
SELECT vc.set_owner_context(1, 'n88g', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n88g', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_gen bigint;
    v_epoch bigint;
    v_n int;
BEGIN
    SELECT g.id INTO v_gen
      FROM vc.generation g
      JOIN vc.work_item wi ON wi.owner_user_id = g.owner_user_id
                          AND wi.kind = 'GENERATION' AND wi.ref_id = g.id
                          AND wi.status = 'FAILED'
     WHERE g.owner_user_id = 1 AND g.status = 'IN_PROGRESS'
     ORDER BY g.id LIMIT 1;
    IF v_gen IS NULL THEN
        RAISE EXCEPTION 'fixture generation missing';
    END IF;

    PERFORM vc.terminalize_generation(1, v_gen, 'FAILED_FINAL', 'chat.failed',
        ('{"fault":"reconcile-stale-in-progress"}')::jsonb);

    SELECT count(*) INTO v_n FROM vc.list_stale_in_progress_generations()
     WHERE out_generation_id = v_gen;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'terminalized generation must leave the enumeration, got %', v_n;
    END IF;
END $$;
COMMIT;
