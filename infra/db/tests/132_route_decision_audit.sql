-- 132_route_decision_audit: S0-11-B V81 — immutable route-decision write.
-- Covers: vc_api records via SECURITY DEFINER; same payload is idempotent;
-- different payload for the same decision_ref fail-closed; owner mismatch
-- fail-closed; reconstructable audit columns; direct INSERT/UPDATE denied.

\set ON_ERROR_STOP on

TRUNCATE vc.generation_route, vc.generation_candidate, vc.generation_attempt,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen bigint;
    v_id bigint;
    v_again bigint;
BEGIN
    v_rel := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-132', 'user', 'hello');

    SELECT out_id INTO v_id
      FROM vc.record_route_decision(
        1, v_gen, 'rd-alpha-1', 'SELECTED', 'deterministic-router-v1',
        'SIMULATED', 'SIMULATED', 'SELECTED_EXTERNAL', 'alpha-loopback',
        ARRAY['alpha-loopback']::text[]);
    IF v_id IS NULL OR v_id <= 0 THEN
        RAISE EXCEPTION 'first record_route_decision must return an id';
    END IF;

    SELECT out_id INTO v_again
      FROM vc.record_route_decision(
        1, v_gen, 'rd-alpha-1', 'SELECTED', 'deterministic-router-v1',
        'SIMULATED', 'SIMULATED', 'SELECTED_EXTERNAL', 'alpha-loopback',
        ARRAY['alpha-loopback']::text[]);
    IF v_again IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'idempotent rewrite must return the same id (% vs %)', v_id, v_again;
    END IF;

    BEGIN
        PERFORM vc.record_route_decision(
            1, v_gen, 'rd-alpha-1', 'SELECTED', 'deterministic-router-v1',
            'SIMULATED', 'ZERO_LLM_ONLY', 'NO_ADMITTED_CANDIDATE', NULL,
            ARRAY[]::text[]);
        RAISE EXCEPTION 'payload mismatch must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%immutable payload mismatch%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        PERFORM vc.record_route_decision(
            2, v_gen, 'rd-bob', 'SELECTED', 'deterministic-router-v1',
            'SIMULATED', 'SIMULATED', 'SELECTED_EXTERNAL', 'alpha-loopback',
            ARRAY['alpha-loopback']::text[]);
        RAISE EXCEPTION 'owner mismatch must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        INSERT INTO vc.generation_route(
            owner_user_id, id, generation_id, decision_no, provider_ref)
        VALUES (1, 999, v_gen, 1, 'direct');
        RAISE EXCEPTION 'direct INSERT into generation_route must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        UPDATE vc.generation_route SET outcome_reason = 'tampered' WHERE id = v_id;
        RAISE EXCEPTION 'direct UPDATE on generation_route must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_n int;
    r vc.generation_route%ROWTYPE;
BEGIN
    SELECT count(*) INTO v_n FROM vc.generation_route WHERE owner_user_id = 1;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'exactly one route decision row expected, got %', v_n;
    END IF;
    SELECT * INTO r FROM vc.generation_route WHERE owner_user_id = 1;
    IF r.decision_ref IS DISTINCT FROM 'rd-alpha-1'
       OR r.status IS DISTINCT FROM 'SELECTED'
       OR r.policy_version IS DISTINCT FROM 'deterministic-router-v1'
       OR r.entitled_service_class IS DISTINCT FROM 'SIMULATED'
       OR r.actual_service_class IS DISTINCT FROM 'SIMULATED'
       OR r.outcome_reason IS DISTINCT FROM 'SELECTED_EXTERNAL'
       OR r.selected_provider_id IS DISTINCT FROM 'alpha-loopback'
       OR r.considered_candidates IS DISTINCT FROM ARRAY['alpha-loopback']::text[] THEN
        RAISE EXCEPTION 'route decision audit columns are not reconstructable: %', r;
    END IF;
END $$;
