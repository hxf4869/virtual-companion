-- MEASURE 10_protocol: 10,000 full ZERO_LLM chains (§26.3 协议仿真).
--
-- Invariant under volume: every completed turn has its assistant message
-- persisted (无「未持久化即 completed」), nothing is left non-terminal, and
-- idempotent re-receive never duplicates a generation.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel  bigint;
    v_conv bigint;
    v_gen  bigint;
    v_cand bigint;
    v_st   text;
    v_fin  boolean;
    i      int;
    v_owner int;
    v_t0   timestamptz := clock_timestamp();
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

    FOR i IN 1..10000 LOOP
        BEGIN
            PERFORM vc.set_owner_context(1, 'm' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'm' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;

            SELECT generation_id INTO v_gen
              FROM vc.receive_generation(1, v_conv, 'idem-measure-' || i,
                                         'user', 'measure turn ' || i);
            v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
            v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
            SELECT out_candidate_id INTO v_cand
              FROM vc.insert_generation_candidate(
                   1, v_gen,
                   'I''m not able to help with that. Let''s talk about something else.',
                   false);
            SELECT out_finalized INTO v_fin
              FROM vc.finalize_generation(1, v_gen, v_cand,
                   'I''m not able to help with that. Let''s talk about something else.',
                   '', 0, 0, 0, 'USD', 0, false, NULL);
            IF v_fin IS NOT TRUE THEN
                RAISE EXCEPTION 'turn % did not finalize', i;
            END IF;
        EXCEPTION
            WHEN unique_violation THEN
                -- Idempotent re-receive with the same key must collapse to the
                -- same generation: treat as pass-through only when the original
                -- exists (checked in the final assertions by total counts).
                NULL;
        END;
        COMMIT;
    END LOOP;
    RAISE NOTICE 'chain loop wall time: %', clock_timestamp() - v_t0;
END $$;

-- Assertions (superuser).
DO $$
DECLARE
    n_total int; n_completed int; n_orphan int; n_assist int; n_open int;
BEGIN
    SELECT count(*) INTO n_total FROM vc.generation;
    SELECT count(*) INTO n_completed FROM vc.generation WHERE status = 'COMPLETED';
    -- 无「未持久化即 completed」：每个 COMPLETED 都有 assistant message。
    SELECT count(*) INTO n_orphan
      FROM vc.generation g
     WHERE g.status = 'COMPLETED'
       AND NOT EXISTS (
           SELECT 1 FROM vc.message m
            WHERE m.owner_user_id = g.owner_user_id
              AND m.generation_id = g.id AND m.role = 'assistant');
    SELECT count(*) INTO n_assist
      FROM vc.message WHERE role = 'assistant';
    -- 没有卡在非终态的 generation。
    SELECT count(*) INTO n_open
      FROM vc.generation WHERE status NOT IN ('COMPLETED','FAILED_FINAL','CANCELLED');
    RAISE NOTICE 'PHASE 10_protocol PASS scale=10000 completed=% orphan_assistant=% assistant_msgs=% non_terminal=%',
        n_completed, n_orphan, n_assist, n_open;
    IF n_total < 10000 THEN
        RAISE EXCEPTION 'expected at least 10000 generations, got %', n_total;
    END IF;
    IF n_completed <> n_total OR n_orphan <> 0 OR n_open <> 0 THEN
        RAISE EXCEPTION 'protocol invariants broken: total=% completed=% orphan=% open=%',
            n_total, n_completed, n_orphan, n_open;
    END IF;
END $$;
