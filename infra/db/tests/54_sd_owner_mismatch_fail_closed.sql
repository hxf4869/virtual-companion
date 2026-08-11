-- 54_sd_owner_mismatch_fail_closed: V17 owner consistency assertion rejects a
-- p_owner_user_id that does not match the server-trusted vc.current_owner_id()
-- context (P1-04 fail-closed). Covers representative SECURITY DEFINER functions
-- spanning V5-V15: claim_work_items, receive_generation, finalize_generation,
-- append_realtime_event, create_relationship, cancel_generation,
-- create_memory_candidate, record_provider_attempt.
--
-- Setup: a trusted path establishes vc.owner_user_id = 1. Each function is then
-- invoked with p_owner_user_id = 2 (mismatch). V17 must RAISE before any
-- business logic executes.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

-- claim_work_items is granted to vc_worker (V5). Trusted context = 1, caller
-- passes p_owner_user_id = 2; the stale-fence guard passes (FENCE-A is valid),
-- then the V17 owner assertion must RAISE before any row is claimed.
SET ROLE vc_worker;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
BEGIN
    BEGIN
        PERFORM * FROM vc.claim_work_items(2, 'FENCE-A', 30, 16);
        RAISE EXCEPTION 'claim_work_items should reject owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF position('does not match server-trusted' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'claim_work_items: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- The remaining functions are granted to vc_api. Trusted context = 1, each
-- caller passes p_owner_user_id = 2; V17 must RAISE on every call.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    expected text := 'does not match server-trusted';
    procedure text;
BEGIN
    procedure := 'receive_generation';
    BEGIN
        PERFORM * FROM vc.receive_generation(2, 100, 'req-mismatch', 'user', 'x');
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'finalize_generation';
    BEGIN
        PERFORM * FROM vc.finalize_generation(2, 5000, 999, 'late', 'provider-a',
                                              10, 5, 0.001, 'USD', 1, true, NULL);
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'append_realtime_event';
    BEGIN
        PERFORM * FROM vc.append_realtime_event(2, 5000, 1, 'chat.accepted',
                                                '{"s":"x"}'::jsonb);
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'create_relationship';
    BEGIN
        PERFORM vc.create_relationship(2, 'persona-a');
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'cancel_generation';
    BEGIN
        PERFORM * FROM vc.cancel_generation(2, 5000);
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'create_memory_candidate';
    BEGIN
        PERFORM vc.create_memory_candidate(2, 10, 'RELATIONSHIP', 'summary',
                                           NULL, ARRAY['gen-1']);
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;

    procedure := 'record_provider_attempt';
    BEGIN
        PERFORM * FROM vc.record_provider_attempt(2, 5000, 'prov-a', 'OpenAI',
                                                  'ATTEMPTED');
        RAISE EXCEPTION '% should reject owner mismatch', procedure;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected in SQLERRM) = 0 THEN
            RAISE EXCEPTION '%: unexpected error: %', procedure, SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- Sanity: no work was claimed, no relationship/generation/memory created.
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.work_item WHERE status = 'CLAIMED';
    IF n <> 0 THEN RAISE EXCEPTION 'owner mismatch must not claim any work item (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 2;
    IF n <> 0 THEN RAISE EXCEPTION 'owner mismatch must not create a relationship (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.generation WHERE owner_user_id = 2;
    IF n <> 0 THEN RAISE EXCEPTION 'owner mismatch must not create a generation (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.memory_item WHERE owner_user_id = 2;
    IF n <> 0 THEN RAISE EXCEPTION 'owner mismatch must not create a memory (got %)', n; END IF;
END $$;
