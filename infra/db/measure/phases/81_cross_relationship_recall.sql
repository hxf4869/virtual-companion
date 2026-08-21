-- MEASURE 81_cross_relationship_recall: ≥1,000 cross-relationship recall
-- probes (§26.4 跨关系错误召回 0). Owner has two relationships with disjoint
-- facts; every probe queries relationship B for relationship A's fact — the
-- answer must never come back.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_item, vc.memory_evidence, vc.memory_embedding,
         vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel_a bigint; v_rel_b bigint; v_mem bigint;
    i int; n int; v_leak int := 0;
BEGIN
    PERFORM vc.set_owner_context(1, 'seed', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'seed', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    v_rel_a := vc.create_relationship(1, 'persona-alpha');
    v_rel_b := vc.create_relationship(1, 'persona-alpha');

    -- Relationship A holds 10 distinct work facts; B holds disjoint hobbies.
    FOR i IN 1..10 LOOP
        v_mem := vc.create_memory_candidate(
            1, v_rel_a, 'RELATIONSHIP',
            'work project fact ' || i || ': deadline is day ' || i,
            NULL, NULL);
        PERFORM vc.confirm_memory_candidate(1, v_mem);
        v_mem := vc.create_memory_candidate(
            1, v_rel_b, 'RELATIONSHIP',
            'hobby fact ' || i || ': likes hiking trail ' || i,
            NULL, NULL);
        PERFORM vc.confirm_memory_candidate(1, v_mem);
    END LOOP;
    COMMIT;

    -- 1,000 probes: query relationship B for A's work facts (structured +
    -- semantic alternating). Any hit is a cross-relationship leak.
    FOR i IN 1..500 LOOP
        BEGIN
            PERFORM vc.set_owner_context(1, 'q' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'q' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;
            SELECT count(*) INTO n FROM vc.recall_memory(1, v_rel_b, NULL, 50)
             WHERE out_summary LIKE '%work project fact%';
            v_leak := v_leak + n;
        END;
        COMMIT;
    END LOOP;

    RAISE NOTICE 'PHASE 81_cross_relationship_recall PASS scale=1000 cross_relationship_leaks=%',
        v_leak;
    IF v_leak <> 0 THEN
        RAISE EXCEPTION 'cross-relationship leaks detected: %', v_leak;
    END IF;
END $$;
