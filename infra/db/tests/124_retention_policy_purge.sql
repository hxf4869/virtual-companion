-- 124_retention_policy_purge: RETENTION V70 — versioned policy + categorized
-- purges. Covers: seeded policy is explicitly activated only inside this test,
-- active_retention_days then reads it and fails closed on unknown categories;
-- per-category purges remove only aged rows
-- (fresh rows survive); NORMAL_CHAT invalidates summaries covering purged
-- messages in the same pass; DELETED_CHAT is a documented no-op; terminal-only
-- export sweep keeps live PENDING rows.

\set ON_ERROR_STOP on

TRUNCATE vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
    v_rel   bigint;
    v_gen1  bigint;
    v_gen2  bigint;
    v_gen3  bigint;


    v_old_msg bigint;
    v_min_id bigint;
    v_max_id bigint;
    v_total_before int;
    v_valid boolean;
    v_days  int;
    v_n     int;
BEGIN
    SELECT vc.identity_admin_seed('root-rt', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-rt', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_user, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_user || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));

    -- Test-only approval: production v1 remains DRAFT until Owner/legal review.
    UPDATE vc.data_retention_policy SET status = 'ACTIVE' WHERE policy_version = 1;

    -- Policy reads: explicitly activated v1 and fail-closed unknown category.
    v_days := vc.active_retention_days('NORMAL_CHAT');
    IF v_days <> 365 THEN
        RAISE EXCEPTION 'NORMAL_CHAT draft period must be 365, got %', v_days;
    END IF;
    BEGIN
        PERFORM vc.active_retention_days('NOT_A_CATEGORY');
        RAISE EXCEPTION 'unknown category must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unknown category must fail closed%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%no active policy%' THEN
            RAISE;
        END IF;
    END;

    -- Three chat turns. The LATEST message (turn 3) is backdated past the
    -- draft window as the normal-chat purge target — on its own generation,
    -- so the message cascade cannot pre-delete the rows that the safety /
    -- stream / route purges below are supposed to remove themselves.
    SELECT generation_id INTO v_gen1
      FROM vc.receive_generation(v_user, 1, 'rt-key-1', 'user', 'turn one');
    SELECT generation_id INTO v_gen2
      FROM vc.receive_generation(v_user, 1, 'rt-key-2', 'user', 'turn two');
    SELECT generation_id INTO v_gen3
      FROM vc.receive_generation(v_user, 1, 'rt-key-3', 'user', 'turn three');
    SELECT max(id) INTO v_old_msg FROM vc.message;
    UPDATE vc.message
       SET created_at = now() - interval '400 days'
     WHERE id = v_old_msg;
    SELECT count(*) INTO v_total_before FROM vc.message;

    -- A summary covering the whole conversation stays valid for the fresh
    -- messages but must be invalidated once an aged message inside its range
    -- is purged. Range bounds come from the actual message ids.
    SELECT min(id), max(id) INTO v_min_id, v_max_id FROM vc.message;
    INSERT INTO vc.conversation_summary(
        owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence,
        service_class)
    VALUES (v_user, 1, 1, v_min_id, v_max_id, 'draft summary', 'model-x',
            'v1', 'chat-v1', 0.9, 'ECONOMY');

    -- Memory candidates: one aged PENDING + one fresh PENDING + one aged
    -- REJECTED (the REJECTED purge window is 30d).
    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope,
                               summary, status, created_at)
    VALUES (v_user, 1, 1, 'RELATIONSHIP', 'aged pending', 'PENDING_CONFIRMATION',
            now() - interval '120 days'),
           (v_user, 2, 1, 'RELATIONSHIP', 'fresh pending', 'PENDING_CONFIRMATION',
            now()),
           (v_user, 3, 1, 'RELATIONSHIP', 'aged rejected', 'REJECTED',
            now() - interval '40 days');

    -- Safety log: one aged, one fresh.
    INSERT INTO vc.safety_event(owner_user_id, id, generation_id, stage,
                                risk_level, rule_id, created_at)
    VALUES (v_user, 1, v_gen1, 'INPUT', 'R4_IMMINENT', 'rt-aged-rule',
            now() - interval '400 days'),
           (v_user, 2, v_gen2, 'INPUT', 'R2_ELEVATED', 'rt-fresh-rule', now());

    -- Export residue: an aged READY row goes; a live PENDING row stays.
    INSERT INTO vc.export_request(owner_user_id, id, status, payload, requested_at)
    VALUES (v_user, 1, 'READY', NULL, now() - interval '60 days'),
           (v_user, 2, 'PENDING', NULL, now() - interval '60 days');

    -- Stream fragments: one aged, one fresh.
    INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                                  payload, created_at)
    VALUES (v_user, 1, v_gen1, 'chat.accepted', '{}', now() - interval '400 days'),
           (v_user, 2, v_gen2, 'chat.accepted', '{}', now());

    -- Model call detail: route rows attached to both generations.
    INSERT INTO vc.generation_route(owner_user_id, id, generation_id,
                                    decision_no, provider_ref, created_at)
    VALUES (v_user, 1, v_gen1, 1, 'fake-primary', now() - interval '400 days'),
           (v_user, 2, v_gen2, 1, 'fake-primary', now());

    -- --- NORMAL_CHAT: the aged message goes, summary invalidated, rest kept ---
    v_n := vc.retention_purge_normal_chat(now() - interval '365 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'normal-chat purge must remove the one aged message, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.message WHERE id = v_old_msg;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'aged message must be gone, found %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.message;
    IF v_n <> v_total_before - 1 THEN
        RAISE EXCEPTION 'fresh messages must survive (% vs %)', v_n, v_total_before - 1;
    END IF;
    SELECT valid INTO v_valid FROM vc.conversation_summary
     WHERE owner_user_id = v_user AND id = 1;
    IF v_valid IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'summary covering a purged message must be invalidated';
    END IF;
    -- Idempotent: a repeat run removes nothing.
    v_n := vc.retention_purge_normal_chat(now() - interval '365 days');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'repeat normal-chat purge must remove 0, got %', v_n;
    END IF;

    -- --- DELETED_CHAT: documented no-op today. ---
    v_n := vc.retention_purge_deleted_chat(now());
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'deleted-chat purge is a no-op, got %', v_n;
    END IF;

    -- --- MEMORY_CANDIDATE / REJECTED_CANDIDATE ---
    v_n := vc.retention_purge_memory_candidate(now() - interval '90 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'candidate purge must remove the aged pending row, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.memory_item
     WHERE id = 2 AND status = 'PENDING_CONFIRMATION';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'fresh pending candidate must survive';
    END IF;
    v_n := vc.retention_purge_rejected_candidate(now() - interval '30 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'rejected purge must remove the aged rejected row, got %', v_n;
    END IF;

    -- --- SAFETY_LOG ---
    v_n := vc.retention_purge_safety_log(now() - interval '365 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'safety purge must remove the aged row, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.safety_event WHERE rule_id = 'rt-fresh-rule';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'fresh safety row must survive';
    END IF;

    -- --- EXPORT_RESIDUE: terminal only, live PENDING survives. ---
    v_n := vc.retention_purge_export_residue(now() - interval '30 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'export purge must remove only the terminal row, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.export_request WHERE status = 'PENDING';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'live PENDING export must survive retention';
    END IF;

    -- --- STREAM_FRAGMENT ---
    v_n := vc.retention_purge_stream_fragment(now() - interval '30 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'stream purge must remove the aged fragment, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.realtime_event
     WHERE generation_id = v_gen2;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'fresh stream event must survive';
    END IF;

    -- --- MODEL_CALL_DETAIL ---
    v_n := vc.retention_purge_model_call_detail(now() - interval '180 days');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'model-detail purge must remove the aged route, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.generation_route
     WHERE generation_id = v_gen2;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'fresh route must survive';
    END IF;

    -- --- NULL cutoff fails closed everywhere it matters. ---
    BEGIN
        PERFORM vc.retention_purge_normal_chat(NULL);
        RAISE EXCEPTION 'NULL cutoff must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%NULL cutoff must fail closed%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%cutoff is required%' THEN
            RAISE;
        END IF;
    END;
END $$;
