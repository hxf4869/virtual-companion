-- 40_provider_attempt_rls: record_provider_attempt persists a real outbound
-- attempt audit row for the owner only; a cross-tenant session can neither see
-- nor write it (FORCE RLS owner_isolation). The table carries no credential or
-- message-content columns (TASK-0035 audit boundary), and unsupported status
-- values and unknown generations fail closed.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-att-1', 'IN_PROGRESS');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    r  record;
    n  int;
    c  int;
BEGIN
    -- The audit table has exactly the five documented columns and NO
    -- credentials / request body / response text.
    SELECT count(*) INTO c FROM information_schema.columns
     WHERE table_schema = 'vc' AND table_name = 'provider_attempt';
    IF c <> 7 THEN
        RAISE EXCEPTION 'provider_attempt must have exactly 7 columns (got %)', c;
    END IF;
    SELECT count(*) INTO c FROM information_schema.columns
     WHERE table_schema = 'vc' AND table_name = 'provider_attempt'
       AND column_name IN ('credentials','request','response','secret','token','api_key');
    IF c <> 0 THEN
        RAISE EXCEPTION 'provider_attempt must carry no credential/content columns (found %)', c;
    END IF;

    -- Record one audit row.
    SELECT * INTO r FROM vc.record_provider_attempt(1, 5000, 'provider-1', 'openai', 'SUCCEEDED');
    IF r.out_id IS NULL OR r.out_owner_user_id <> 1 THEN
        RAISE EXCEPTION 'record_provider_attempt must return the new id and owner';
    END IF;
    SELECT count(*) INTO n FROM vc.provider_attempt;
    IF n <> 1 THEN
        RAISE EXCEPTION 'exactly one provider_attempt row expected (got %)', n;
    END IF;
    SELECT count(*) INTO n FROM vc.provider_attempt
     WHERE provider_id = 'provider-1' AND supplier_name = 'openai' AND status = 'SUCCEEDED';
    IF n <> 1 THEN
        RAISE EXCEPTION 'audit row must round-trip provider_id/supplier_name/status';
    END IF;

    -- Unsupported status fails closed.
    BEGIN
        PERFORM vc.record_provider_attempt(1, 5000, 'provider-1', 'openai', 'MADE_UP');
        RAISE EXCEPTION 'unsupported status must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- Blank supplier_name fails closed.
    BEGIN
        PERFORM vc.record_provider_attempt(1, 5000, 'provider-1', '  ', 'SUCCEEDED');
        RAISE EXCEPTION 'blank supplier_name must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- Unknown generation fails closed (existence hidden).
    BEGIN
        PERFORM vc.record_provider_attempt(1, 9999, 'provider-1', 'openai', 'SUCCEEDED');
        RAISE EXCEPTION 'unknown generation must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- Cross-tenant: bob cannot see alice's attempt row nor record one on her
-- generation (FORCE RLS WITH CHECK owner_isolation).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.provider_attempt;
    IF n <> 0 THEN
        RAISE EXCEPTION 'cross-tenant read must see zero provider_attempt rows (got %)', n;
    END IF;
    BEGIN
        PERFORM vc.record_provider_attempt(2, 5000, 'provider-1', 'openai', 'SUCCEEDED');
        RAISE EXCEPTION 'cross-tenant write must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected: generation 5000 does not exist for owner 2
    END;
END $$;
COMMIT;
RESET ROLE;

-- Owner 1 can still read her row afterwards.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.provider_attempt;
    IF n <> 1 THEN
        RAISE EXCEPTION 'owner must still see her own provider_attempt row (got %)', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
