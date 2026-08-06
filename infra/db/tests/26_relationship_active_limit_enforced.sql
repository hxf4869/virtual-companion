-- 26_relationship_active_limit_enforced: create_relationship always leaves an
-- owner with exactly one active Companion (activeCompanionLimit=1). A second
-- create atomically deactivates the previous active relationship and activates
-- the new one; a different owner is fully independent and never disturbs the
-- first owner's single-active count.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');

-- Owner 1 creates two Companions; exactly one stays active throughout.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    v_a bigint;
    v_b bigint;
    n   int;
BEGIN
    SELECT vc.create_relationship(1, 'persona-a') INTO v_a;
    IF v_a IS NULL THEN RAISE EXCEPTION 'create must return an id'; END IF;

    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 active after first create, got %', n; END IF;

    -- Second create deactivates the first and activates the new one.
    SELECT vc.create_relationship(1, 'persona-b') INTO v_b;
    IF v_b IS NULL THEN RAISE EXCEPTION 'second create must return an id'; END IF;

    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 active after second create, got %', n; END IF;

    PERFORM 1 FROM vc.relationship WHERE id = v_a AND active = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'first relationship must be dormant after second create'; END IF;

    PERFORM 1 FROM vc.relationship WHERE id = v_b AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'second relationship must be active'; END IF;

    PERFORM set_config('app.va', v_a::text, false);
    PERFORM set_config('app.vb', v_b::text, false);
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 creates an independent active Companion; owner 1 is unaffected.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE
    v_c bigint;
    n   int;
BEGIN
    SELECT vc.create_relationship(2, 'persona-bob') INTO v_c;
    IF v_c IS NULL THEN RAISE EXCEPTION 'owner 2 create must return an id'; END IF;

    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 must have exactly 1 active, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 1 still has exactly one active Companion after owner 2 acted.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must still have 1 active, got %', n; END IF;

    -- The relationship created first stays dormant; the second stays active.
    PERFORM 1 FROM vc.relationship
     WHERE id = current_setting('app.va')::bigint AND active = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner 1 first relationship must remain dormant'; END IF;
    PERFORM 1 FROM vc.relationship
     WHERE id = current_setting('app.vb')::bigint AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner 1 second relationship must remain active'; END IF;
END $$;
COMMIT;
RESET ROLE;
