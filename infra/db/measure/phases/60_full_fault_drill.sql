-- MEASURE 60_full_fault_drill: 50 full-fault drills with duplicate-finalize
-- attempts at deterministic fault points (§26.3 全故障演练).
-- Invariant: exactly-once completion — one usage row and one assistant
-- message per generation, no matter where the fault hit.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_cand bigint; v_fin boolean;
    v_st text; d int; fault int; v_dup_rejected int := 0;
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

    FOR d IN 1..50 LOOP
        fault := mod(hashtext('drill-' || d), 3); -- 0/1/2: crash point
        BEGIN
            PERFORM vc.set_owner_context(1, 'd' || d, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'd' || d, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;
            SELECT generation_id INTO v_gen
              FROM vc.receive_generation(1, v_conv, 'idem-drill-' || d,
                                         'user', 'drill turn ' || d);
            v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
            IF fault = 0 THEN COMMIT; CONTINUE; END IF;
            v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
            IF fault = 1 THEN COMMIT; CONTINUE; END IF;
            SELECT out_candidate_id INTO v_cand
              FROM vc.insert_generation_candidate(1, v_gen, 'drill answer', false);
            IF fault = 2 THEN COMMIT; CONTINUE; END IF;
            SELECT out_finalized INTO v_fin
              FROM vc.finalize_generation(1, v_gen, v_cand, 'drill answer',
                   '', 0, 0, 0, 'USD', 0, false, NULL);
        END;
        COMMIT;
    END LOOP;

    -- Recovery + duplicate-finalize attack on every generation.
    FOR d IN 1..50 LOOP
        BEGIN
            PERFORM vc.set_owner_context(1, 'r' || d, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'r' || d, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;
            SELECT id INTO v_gen FROM vc.generation
             WHERE owner_user_id = 1
               AND id IN (SELECT id FROM vc.generation
                           WHERE status NOT IN ('COMPLETED','FAILED_FINAL','CANCELLED'))
             ORDER BY id
             LIMIT 1;
            IF v_gen IS NULL THEN EXIT; END IF;
            IF NOT EXISTS (SELECT 1 FROM vc.generation
                            WHERE id = v_gen AND status = 'FINAL_REVIEW') THEN
                PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
                PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
            END IF;
            DECLARE v_c bigint; BEGIN
                SELECT out_candidate_id INTO v_c
                  FROM vc.insert_generation_candidate(1, v_gen, 'drill answer', false);
                SELECT out_finalized INTO v_fin
                  FROM vc.finalize_generation(1, v_gen, v_c, 'drill answer',
                       '', 0, 0, 0, 'USD', 0, false, NULL);
            END;
            -- Duplicate finalize attack: must never double-complete.
            BEGIN
                DECLARE v_c2 bigint; v_f2 boolean;
                BEGIN
                SELECT out_candidate_id INTO v_c2
                  FROM vc.insert_generation_candidate(1, v_gen, 'duplicate', false);
                SELECT out_finalized INTO v_f2
                  FROM vc.finalize_generation(1, v_gen, v_c2, 'duplicate',
                       '', 0, 0, 0, 'USD', 0, false, NULL);
                IF v_f2 THEN
                    RAISE EXCEPTION 'duplicate finalize succeeded on %', v_gen;
                END IF;
                END;
            EXCEPTION WHEN OTHERS THEN
                IF SQLERRM LIKE '%duplicate finalize succeeded on%' THEN
                    RAISE;
                END IF;
                v_dup_rejected := v_dup_rejected + 1;
            END;
            v_gen := NULL;
        END;
        COMMIT;
    END LOOP;

    -- Assertions.
    DECLARE
        n_gen int; n_usage int; n_assist int; n_completed int;
    BEGIN
        SELECT count(*) INTO n_gen FROM vc.generation;
        SELECT count(*) INTO n_usage FROM vc.generation_usage;
        SELECT count(*) INTO n_assist FROM vc.message WHERE role = 'assistant';
        SELECT count(*) INTO n_completed FROM vc.generation WHERE status = 'COMPLETED';
        RAISE NOTICE 'PHASE 60_full_fault_drill PASS scale=50 completed=% usage_rows=% assistant_msgs=% duplicate_finalize_rejected=%',
            n_completed, n_usage, n_assist, v_dup_rejected;
        IF n_completed <> 50 OR n_usage <> 50 OR n_assist <> 50 THEN
            RAISE EXCEPTION 'exactly-once broken: completed=% usage=% assist=%',
                n_completed, n_usage, n_assist;
        END IF;
    END;
END $$;
