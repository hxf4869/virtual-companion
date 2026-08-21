-- MEASURE 50_fault_injection: 1,000 turns where odd turns crash mid-flight
-- (§26.3 故障注入). Invariant: the user message is durable in 100% of turns
-- regardless of outcome, and recovery completes every crashed turn.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_cand bigint; v_fin boolean;
    i int;
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
            PERFORM vc.set_owner_context(1, 'f' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'f' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;
            SELECT generation_id INTO v_gen
              FROM vc.receive_generation(1, v_conv, 'idem-fault-' || i,
                                         'user', 'fault turn ' || i);
            PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
            IF i % 2 = 1 THEN
                COMMIT; -- simulated crash: worker dies here, turn stays IN_PROGRESS
                CONTINUE;
            END IF;
            PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
            SELECT out_candidate_id INTO v_cand
              FROM vc.insert_generation_candidate(1, v_gen, 'recovered answer', false);
            SELECT out_finalized INTO v_fin
              FROM vc.finalize_generation(1, v_gen, v_cand, 'recovered answer',
                   '', 0, 0, 0, 'USD', 0, false, NULL);
        END;
        COMMIT;
    END LOOP;
END $$;

-- Recovery pass: finish every crashed turn.
DO $$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_cand bigint; v_fin boolean;
    r record;
BEGIN
    PERFORM vc.set_owner_context(1, 'recover', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'recover', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    FOR r IN SELECT id FROM vc.generation WHERE status = 'IN_PROGRESS' ORDER BY id LOOP
        PERFORM vc.promote_generation(1, r.id, 'FINAL_REVIEW');
        SELECT out_candidate_id INTO v_cand
          FROM vc.insert_generation_candidate(1, r.id, 'recovered answer', false);
        SELECT out_finalized INTO v_fin
          FROM vc.finalize_generation(1, r.id, v_cand, 'recovered answer',
               '', 0, 0, 0, 'USD', 0, false, NULL);
    END LOOP;
END $$;

-- Assertions.
DO $$
DECLARE
    n_msg int; n_completed int; n_open int;
BEGIN
    SELECT count(*) INTO n_msg FROM vc.message WHERE role = 'user';
    IF n_msg <> 1000 THEN
        RAISE EXCEPTION 'user message persistence broken: %/1000', n_msg;
    END IF;
    SELECT count(*) INTO n_completed FROM vc.generation WHERE status = 'COMPLETED';
    SELECT count(*) INTO n_open
      FROM vc.generation WHERE status NOT IN ('COMPLETED','FAILED_FINAL','CANCELLED');
    RAISE NOTICE 'PHASE 50_fault_injection PASS scale=1000 user_messages_persisted=100%% completed=% non_terminal=%',
        n_completed, n_open;
    IF n_completed <> 1000 OR n_open <> 0 THEN
        RAISE EXCEPTION 'fault recovery broken: completed=% open=%', n_completed, n_open;
    END IF;
END $$;
