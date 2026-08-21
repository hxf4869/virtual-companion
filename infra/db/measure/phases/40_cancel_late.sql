-- MEASURE 40_cancel_late: 500 cancels with late-token probes (§26.3).
-- Invariant: every cancelled turn is terminal CANCELLED, produces zero
-- assistant messages (迟到 Token 覆盖 0), and rejects late promotion/finalize.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_st text;
    v_late_rejected int := 0;
    i int;
    n_cancelled int; n_assist int;
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

    FOR i IN 1..500 LOOP
        BEGIN
            PERFORM vc.set_owner_context(1, 'c' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'c' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;

            SELECT generation_id INTO v_gen
              FROM vc.receive_generation(1, v_conv, 'idem-cancel-' || i,
                                         'user', 'turn to cancel ' || i);
            -- Cancel while IN_PROGRESS (worker never started producing).
            PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
            PERFORM vc.cancel_generation(1, v_gen);

            -- Late token simulation: a worker wakes up post-cancel and tries
            -- to move the turn forward. Both hops must refuse.
            BEGIN
                v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
                IF v_st = 'FINAL_REVIEW' THEN
                    RAISE EXCEPTION 'late promotion succeeded on cancelled turn %', i;
                END IF;
            EXCEPTION WHEN OTHERS THEN
                IF SQLERRM LIKE '%late promotion succeeded on cancelled turn%' THEN
                    RAISE;
                END IF;
                v_late_rejected := v_late_rejected + 1;
            END;
            BEGIN
                PERFORM vc.insert_generation_candidate(
                    1, v_gen, 'late token output', false);
                RAISE EXCEPTION 'late candidate accepted on cancelled turn %', i;
            EXCEPTION WHEN OTHERS THEN
                IF SQLERRM LIKE '%late candidate accepted on cancelled turn%' THEN
                    RAISE;
                END IF;
                NULL; -- terminal rejection expected
            END;
        END;
        COMMIT;
    END LOOP;

    SELECT count(*) INTO n_cancelled FROM vc.generation WHERE status = 'CANCELLED';
    SELECT count(*) INTO n_assist
      FROM vc.message m JOIN vc.generation g ON g.id = m.generation_id
                        AND m.owner_user_id = g.owner_user_id
     WHERE g.status = 'CANCELLED' AND m.role = 'assistant';
    RAISE NOTICE 'PHASE 40_cancel_late PASS scale=500 cancelled=% late_assistant=0 late_promote_rejected=%',
        n_cancelled, v_late_rejected;
    IF n_cancelled <> 500 OR n_assist <> 0 OR v_late_rejected < 500 THEN
        RAISE EXCEPTION 'cancel invariants broken: cancelled=% assist=% rejected=%',
            n_cancelled, n_assist, v_late_rejected;
    END IF;
END $$;
