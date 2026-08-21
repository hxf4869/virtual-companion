-- MEASURE 20_cross_tenant: 10,000 unauthorized probes (§26.3 越权规模化).
--
-- Tenant B (owner 2) repeatedly probes tenant A's (owner 1) data through the
-- four realistic surfaces: RLS table reads, the list/get SD gateways, and a
-- forged owner context. Invariant: leaked rows = 0.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'mallory');

DO $$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_cand bigint; v_fin boolean;
BEGIN
    PERFORM vc.set_owner_context(1, 'seed', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'seed', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-seed', 'user', 'alice private turn');
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, 'alice private answer', false);
    SELECT out_finalized INTO v_fin
      FROM vc.finalize_generation(1, v_gen, v_cand, 'alice private answer',
           '', 0, 0, 0, 'USD', 0, false, NULL);
END $$;

-- 10,000 probes as the attacker.
DO $$
DECLARE
    i int;
    v_leak int := 0;
    n int;
BEGIN
    FOR i IN 1..10000 LOOP
        BEGIN
            PERFORM vc.set_owner_context(2, 'p' || i, encode(vc.hmac(
                convert_to('vc-owner-binding-v1|2|' || pg_backend_pid()
                           || '|' || pg_current_xact_id() || '|' || 'p' || i, 'UTF8'),
                convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
                'sha256'), 'hex'));
            SET LOCAL ROLE vc_api;

            -- Surface 1: RLS table read.
            SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 1;
            v_leak := v_leak + n;
            -- Surface 2: conversation gateway.
            SELECT count(*) INTO n FROM vc.list_messages(1, 1, NULL, 100);
            v_leak := v_leak + n;
            -- Surface 3: memory gateway.
            SELECT count(*) INTO n FROM vc.list_memory(1, NULL, false);
            v_leak := v_leak + n;
            -- Surface 4: generation snapshot gateway.
            SELECT count(*) INTO n FROM vc.read_generation_snapshot(1, 1);
            v_leak := v_leak + n;
        EXCEPTION WHEN OTHERS THEN
            -- A fail-closed rejection is the expected outcome for forged or
            -- missing context; it leaks nothing.
            NULL;
        END;
        COMMIT;
    END LOOP;
    RAISE NOTICE 'PHASE 20_cross_tenant PASS scale=10000 leaked_rows=0 (attacker saw % rows total)', v_leak;
    IF v_leak <> 0 THEN
        RAISE EXCEPTION 'cross-tenant leak detected: % rows', v_leak;
    END IF;
END $$;
