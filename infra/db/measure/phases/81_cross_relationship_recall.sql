-- MEASURE 81_cross_relationship_recall: ≥1,000 cross-relationship recall
-- probes (§26.4 跨关系错误召回 0). Owner has two relationships with disjoint
-- facts; every probe queries relationship B for relationship A's fact — the
-- answer must never come back. Structured (recall_memory) and semantic
-- (semantic_recall) paths alternate 500/500; leaks are asserted by known
-- memory ID (not summary text), and a same-relationship positive control
-- proves the vector path and the embedding fixtures are actually live.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_item, vc.memory_evidence, vc.memory_embedding,
         vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel_a bigint; v_rel_b bigint; v_mem bigint;
    v_a_ids bigint[]; v_b_ids bigint[];
    i int; d int; slot int; n int;
    v_vec text;
    v_top bigint;
    v_leak_struct int := 0;
    v_leak_sem int := 0;
    v_probe_struct int := 0;
    v_probe_sem int := 0;
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
        v_a_ids := v_a_ids || v_mem;
        v_mem := vc.create_memory_candidate(
            1, v_rel_b, 'RELATIONSHIP',
            'hobby fact ' || i || ': likes hiking trail ' || i,
            NULL, NULL);
        PERFORM vc.confirm_memory_candidate(1, v_mem);
        v_b_ids := v_b_ids || v_mem;
    END LOOP;

    -- Synthetic embeddings in the deterministic test space (same fixtures as
    -- tests/117): A's fact j sits at unit vector e_j, B's hobby j at
    -- e_(10+j). The two halves are orthogonal, so an A-vector probe against
    -- relationship B is a clean nearest-neighbor leak probe.
    FOR i IN 1..20 LOOP
        v_vec := '[';
        FOR d IN 1..64 LOOP
            v_vec := v_vec || (CASE WHEN d = i THEN '1' ELSE '0' END)
                   || (CASE WHEN d < 64 THEN ',' ELSE '' END);
        END LOOP;
        v_vec := v_vec || ']';
        IF i <= 10 THEN
            PERFORM vc.upsert_memory_embedding(
                1, v_a_ids[i], 'deterministic-hash', '1', 64,
                'alpha-hash-64', v_vec);
        ELSE
            PERFORM vc.upsert_memory_embedding(
                1, v_b_ids[i - 10], 'deterministic-hash', '1', 64,
                'alpha-hash-64', v_vec);
        END IF;
    END LOOP;
    COMMIT;

    -- Positive control: querying relationship B with B's own fact vector must
    -- surface that exact fact — proves the semantic path and fixtures work.
    BEGIN
        PERFORM vc.set_owner_context(1, 'control', encode(vc.hmac(
            convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                       || '|' || pg_current_xact_id() || '|' || 'control', 'UTF8'),
            convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
            'sha256'), 'hex'));
        SET LOCAL ROLE vc_api;
        v_vec := '[';
        FOR d IN 1..64 LOOP
            v_vec := v_vec || (CASE WHEN d = 11 THEN '1' ELSE '0' END)
                   || (CASE WHEN d < 64 THEN ',' ELSE '' END);
        END LOOP;
        v_vec := v_vec || ']';
        SELECT out_memory_id INTO v_top
          FROM vc.semantic_recall(1, v_rel_b, 'alpha-hash-64', v_vec, 10)
         LIMIT 1;
        IF v_top IS DISTINCT FROM v_b_ids[1] THEN
            RAISE EXCEPTION 'semantic positive control failed: top hit %, want %',
                v_top, v_b_ids[1];
        END IF;
    END;
    COMMIT;

    -- 1,000 probes: query relationship B for A's facts, structured and
    -- semantic alternating. Any hit is a cross-relationship leak.
    FOR i IN 1..1000 LOOP
        slot := (i % 10) + 1;
        v_vec := '[';
        FOR d IN 1..64 LOOP
            v_vec := v_vec || (CASE WHEN d = slot THEN '1' ELSE '0' END)
                   || (CASE WHEN d < 64 THEN ',' ELSE '' END);
        END LOOP;
        v_vec := v_vec || ']';
        BEGIN
            PERFORM vc.set_owner_context(1, 'q' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'q' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;
            IF i % 2 = 0 THEN
                SELECT count(*) INTO n FROM vc.recall_memory(1, v_rel_b, NULL, 50)
                 WHERE out_id = ANY (v_a_ids);
                v_probe_struct := v_probe_struct + 1;
                v_leak_struct := v_leak_struct + n;
            ELSE
                SELECT count(*) INTO n
                  FROM vc.semantic_recall(1, v_rel_b, 'alpha-hash-64', v_vec, 50)
                 WHERE out_memory_id = ANY (v_a_ids);
                v_probe_sem := v_probe_sem + 1;
                v_leak_sem := v_leak_sem + n;
            END IF;
        END;
        COMMIT;
    END LOOP;

    -- Both recall paths must actually have executed; neither may leak.
    IF v_probe_struct < 400 OR v_probe_sem < 400 THEN
        RAISE EXCEPTION 'probe coverage too low: structured=% semantic=% (want ≥400 each)',
            v_probe_struct, v_probe_sem;
    END IF;
    IF v_leak_struct <> 0 OR v_leak_sem <> 0 THEN
        RAISE EXCEPTION 'cross-relationship leaks detected: structured=% semantic=%',
            v_leak_struct, v_leak_sem;
    END IF;

    RAISE NOTICE 'PHASE 81_cross_relationship_recall PASS scale=1000 probes_structured=% probes_semantic=% leaks_structured=% leaks_semantic=%',
        v_probe_struct, v_probe_sem, v_leak_struct, v_leak_sem;
END $$;
