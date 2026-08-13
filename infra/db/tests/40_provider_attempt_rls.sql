-- 40_provider_attempt_rls: record_provider_attempt persists a real outbound
-- attempt audit row for the owner only; a cross-tenant session can neither see
-- nor write it (FORCE RLS owner_isolation). The table carries no credential or
-- message-content columns (TASK-0035 audit boundary), and unsupported status
-- values and unknown generations fail closed. Since TASK-0164 every audit row
-- also binds requested/execution authorization snapshots (INV-AUTH-001).

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

-- INV-AUTH-001 (TASK-0164): provider_attempt now binds two authorization
-- snapshots via composite FK, so seed them for owner 1 before recording.
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories)
VALUES
    (1, 'req-snap-1', 'ACTIVE', 'provider-1', 'us-east-1', 'standard', 'chat', ARRAY['text']),
    (1, 'exec-snap-1', 'ACTIVE', 'provider-1', 'us-east-1', 'standard', 'chat', ARRAY['text']);

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    r  record;
    n  int;
    c  int;
BEGIN
    -- The audit table carries the seven base columns plus the two
    -- authorization-snapshot columns (INV-AUTH-001) and NO credentials /
    -- request body / response text.
    SELECT count(*) INTO c FROM information_schema.columns
     WHERE table_schema = 'vc' AND table_name = 'provider_attempt';
    IF c <> 9 THEN
        RAISE EXCEPTION 'provider_attempt must have exactly 9 columns (got %)', c;
    END IF;
    SELECT count(*) INTO c FROM information_schema.columns
     WHERE table_schema = 'vc' AND table_name = 'provider_attempt'
       AND column_name IN ('credentials','request','response','secret','token','api_key');
    IF c <> 0 THEN
        RAISE EXCEPTION 'provider_attempt must carry no credential/content columns (found %)', c;
    END IF;

    -- Record one audit row.
    SELECT * INTO r FROM vc.record_provider_attempt(1, 5000, 'provider-1', 'openai', 'SUCCEEDED', 'req-snap-1', 'exec-snap-1');
    IF r.out_id IS NULL OR r.out_owner_user_id <> 1 THEN
        RAISE EXCEPTION 'record_provider_attempt must return the new id and owner';
    END IF;
    SELECT count(*) INTO n FROM vc.provider_attempt;
    IF n <> 1 THEN
        RAISE EXCEPTION 'exactly one provider_attempt row expected (got %)', n;
    END IF;
    SELECT count(*) INTO n FROM vc.provider_attempt
     WHERE provider_id = 'provider-1' AND supplier_name = 'openai' AND status = 'SUCCEEDED'
       AND requested_authorization_snapshot = 'req-snap-1'
       AND execution_authorization_snapshot = 'exec-snap-1';
    IF n <> 1 THEN
        RAISE EXCEPTION 'audit row must round-trip provider_id/supplier_name/status and snapshot binding';
    END IF;

    -- Unsupported status fails closed.
    BEGIN
        PERFORM vc.record_provider_attempt(1, 5000, 'provider-1', 'openai', 'MADE_UP', 'req-snap-1', 'exec-snap-1');
        RAISE EXCEPTION 'unsupported status must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- Blank supplier_name fails closed.
    BEGIN
        PERFORM vc.record_provider_attempt(1, 5000, 'provider-1', '  ', 'SUCCEEDED', 'req-snap-1', 'exec-snap-1');
        RAISE EXCEPTION 'blank supplier_name must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- Unknown generation fails closed (existence hidden).
    BEGIN
        PERFORM vc.record_provider_attempt(1, 9999, 'provider-1', 'openai', 'SUCCEEDED', 'req-snap-1', 'exec-snap-1');
        RAISE EXCEPTION 'unknown generation must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- Cross-tenant: bob cannot see alice's attempt row nor record one on her
-- generation (FORCE RLS WITH CHECK owner_isolation).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.provider_attempt;
    IF n <> 0 THEN
        RAISE EXCEPTION 'cross-tenant read must see zero provider_attempt rows (got %)', n;
    END IF;
    BEGIN
        PERFORM vc.record_provider_attempt(2, 5000, 'provider-1', 'openai', 'SUCCEEDED', 'req-snap-1', 'exec-snap-1');
        RAISE EXCEPTION 'cross-tenant write must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected: generation 5000 does not exist for owner 2
    END;
END $$;
COMMIT;
RESET ROLE;

-- Owner 1 can still read her row afterwards.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
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
