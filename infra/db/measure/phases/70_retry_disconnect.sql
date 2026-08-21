-- MEASURE 70_retry_disconnect: 1,000 retry/disconnect cycles (§26.3).
-- Invariant: a turn that fails once and completes on retry has exactly ONE
-- usage settlement (无重复扣减) and exactly one assistant message.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_cand bigint; v_fin boolean;
    i int; n_usage int; n_assist int;
BEGIN
    PERFORM vc.set_owner_context(1, 'seed', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'seed', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    COMMIT;

    FOR i IN 1..1000 LOOP
        BEGIN
            PERFORM vc.set_owner_context(1, 'r' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'r' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;

            -- Attempt 1: disconnect after IN_PROGRESS (no finalize).
            SELECT generation_id INTO v_gen
              FROM vc.receive_generation(1, v_conv, 'idem-retry-' || i,
                                         'user', 'retry turn ' || i);
            PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
        END;
        COMMIT; -- connection drops here

        BEGIN
            PERFORM vc.set_owner_context(1, 'r2-' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'r2-' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;

            -- Retry: idempotent re-receive collapses to the same generation.
            SELECT generation_id INTO v_gen
              FROM vc.receive_generation(1, v_conv, 'idem-retry-' || i,
                                         'user', 'retry turn ' || i);
            PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
            SELECT out_candidate_id INTO v_cand
              FROM vc.insert_generation_candidate(1, v_gen, 'retry answer', false);
            SELECT out_finalized INTO v_fin
              FROM vc.finalize_generation(1, v_gen, v_cand, 'retry answer',
                   '', 7, 13, 0, 'USD', 0, false, NULL);
            IF v_fin IS NOT TRUE THEN
                RAISE EXCEPTION 'retry % did not finalize', i;
            END IF;
        END;
        COMMIT;
    END LOOP;

    SELECT count(*) INTO n_usage FROM vc.generation_usage;
    SELECT count(*) INTO n_assist FROM vc.message WHERE role = 'assistant';
    RAISE NOTICE 'PHASE 70_retry_disconnect PASS scale=1000 usage_rows=% assistant_msgs=% (no double settlement)',
        n_usage, n_assist;
    IF n_usage <> 1000 OR n_assist <> 1000 THEN
        RAISE EXCEPTION 'settlement invariant broken: usage=% assist=%', n_usage, n_assist;
    END IF;
END $$;
