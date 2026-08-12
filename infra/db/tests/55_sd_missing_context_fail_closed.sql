-- 55_sd_missing_context_fail_closed: V17 requires a server-trusted owner context
-- to be established before invoking any SECURITY DEFINER function. When
-- vc.owner_user_id is unset (current_owner_id() returns NULL), every function
-- must RAISE immediately regardless of the p_owner_user_id argument (P1-04
-- fail-closed). Covers the same representative functions as test 54.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- Verify the baseline: no context means current_owner_id() is NULL.
RESET ROLE;
DO $$
DECLARE o bigint;
BEGIN
    o := vc.current_owner_id();
    IF o IS NOT NULL THEN
        RAISE EXCEPTION 'baseline: current_owner_id() must be NULL without context (got %)', o;
    END IF;
END $$;

-- claim_work_items (granted to vc_worker). No context established; caller passes
-- p_owner_user_id = 1 with a valid fence. The stale-fence guard passes, then the
-- V17 owner assertion must RAISE (NULL IS DISTINCT FROM 1).
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    BEGIN
        PERFORM * FROM vc.claim_work_items(1, 'FENCE-A', 30, 16);
        RAISE EXCEPTION 'claim_work_items should reject missing context';
    EXCEPTION WHEN OTHERS THEN
        IF position('does not match server-trusted' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'claim_work_items: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- The remaining functions (granted to vc_api). No context; caller passes
-- p_owner_user_id = 1. V17 must RAISE on every call.
SET ROLE vc_api;
BEGIN;
DO $$
DECLARE
    expected text := 'does not match server-trusted';
    procedure text;
BEGIN
    procedure := 'receive_generation';
    BEGIN
        PERFORM * FROM vc.receive_generation(1, 100, 'req-noctx', 'user', 'x');
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'finalize_generation';
    BEGIN
        PERFORM * FROM vc.finalize_generation(1, 5000, 999, 'late', 'provider-a',
                                              10, 5, 0.001, 'USD', 1, true, NULL);
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'append_realtime_event';
    BEGIN
        PERFORM * FROM vc.append_realtime_event(1, 5000, 1, 'chat.accepted',
                                                '{"s":"x"}'::jsonb);
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'create_relationship';
    BEGIN
        PERFORM vc.create_relationship(1, 'persona-a');
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'cancel_generation';
    BEGIN
        PERFORM * FROM vc.cancel_generation(1, 5000);
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'create_memory_candidate';
    BEGIN
        PERFORM vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'summary',
                                           NULL, ARRAY['gen-1']);
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'record_provider_attempt';
    BEGIN
        PERFORM * FROM vc.record_provider_attempt(1, 5000, 'prov-a', 'OpenAI',
                                                  'ATTEMPTED', 'snap-x', 'snap-y');
        RAISE EXCEPTION '% should reject missing context', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- Sanity: nothing was created despite valid-looking p_owner_user_id values.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.work_item WHERE status = 'CLAIMED';
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must not claim work (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must not create a relationship (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.generation;
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must not create a generation (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.memory_item;
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must not create a memory (got %)', n; END IF;
END $$;
