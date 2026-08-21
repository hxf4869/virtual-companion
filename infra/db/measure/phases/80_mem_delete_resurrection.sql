-- MEASURE 80_mem_delete_resurrection: >=100 delete-resurrection regressions
-- (§26.4 删除复活率 0). Each sample: create -> confirm -> delete (tombstone) ->
-- recall probes (structured; semantic-path exclusion is covered by the V62 unit tests). The deleted summary must never
-- reappear — 复活率 0.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_item, vc.memory_evidence, vc.memory_embedding,
         vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    v_rel bigint; v_mem bigint; n int; v_hit int := 0; i int;
BEGIN
    PERFORM vc.set_owner_context(1, 'seed', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'seed', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    v_rel := vc.create_relationship(1, 'persona-alpha');

    FOR i IN 1..100 LOOP
        v_mem := vc.create_memory_candidate(
            1, v_rel, 'RELATIONSHIP',
            'sample fact number ' || i || ': likes quiet mornings',
            NULL, NULL);
        IF v_mem IS NULL OR v_mem <= 0 THEN
            RAISE EXCEPTION 'sample % create failed', i;
        END IF;
        IF vc.confirm_memory_candidate(1, v_mem) IS NOT TRUE THEN
            RAISE EXCEPTION 'sample % confirm failed', i;
        END IF;

        -- Delete it (tombstone).
        PERFORM vc.delete_memory(1, v_mem);

        -- Recall probe: structured recall must never surface the tombstone.
        SELECT count(*) INTO n FROM vc.recall_memory(1, v_rel, NULL, 50)
         WHERE out_summary LIKE '%sample fact number ' || i || '%';
        v_hit := v_hit + n;
    END LOOP;

    RAISE NOTICE 'PHASE 80_mem_delete_resurrection PASS scale=100 resurrection_count=%',
        v_hit;
    IF v_hit <> 0 THEN
        RAISE EXCEPTION 'deleted memories resurrected % times', v_hit;
    END IF;
END $$;
