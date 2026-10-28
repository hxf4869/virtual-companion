-- 29_relationship_lifecycle_activate_deactivate: V2 instances have independent
-- active flags. Activating one never disables another; explicit deactivation
-- can still reach zero active, and list returns every owned instance.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_a bigint;
    v_b bigint;
    n   int;
BEGIN
    SELECT vc.create_relationship(1, 'persona-a') INTO v_a;  -- A active
    SELECT vc.create_relationship(1, 'persona-b') INTO v_b;  -- A and B active

    PERFORM 1 FROM vc.relationship WHERE id = v_a AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'A must remain active after second create'; END IF;
    PERFORM 1 FROM vc.relationship WHERE id = v_b AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'B must be active after second create'; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 2 THEN RAISE EXCEPTION 'expected 2 active after creates, got %', n; END IF;

    -- activate A: keeps B active as well.
    PERFORM vc.activate_relationship(1, v_a);
    PERFORM 1 FROM vc.relationship WHERE id = v_a AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'A must be active after activate'; END IF;
    PERFORM 1 FROM vc.relationship WHERE id = v_b AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'B must remain active after activating A'; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 2 THEN RAISE EXCEPTION 'expected 2 active after activate, got %', n; END IF;

    -- Deactivating A leaves B unchanged; explicitly deactivating both reaches zero.
    PERFORM vc.deactivate_relationship(1, v_a);
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected B active after deactivating A, got %', n; END IF;
    PERFORM vc.deactivate_relationship(1, v_b);
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 0 THEN RAISE EXCEPTION 'expected 0 active after deactivating both, got %', n; END IF;

    -- activate B: exactly one active again.
    PERFORM vc.activate_relationship(1, v_b);
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 active after re-activate, got %', n; END IF;
    PERFORM 1 FROM vc.relationship WHERE id = v_b AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'B must be active after re-activate'; END IF;

    -- list_relationships returns every owned relationship (active and dormant).
    SELECT count(*) INTO n FROM vc.list_relationships(1);
    IF n <> 2 THEN RAISE EXCEPTION 'list must return 2 relationships, got %', n; END IF;

    -- Idempotent deactivate on an already-inactive relationship returns false,
    -- and re-activating the still-active B is a no-op that keeps one active.
    PERFORM vc.deactivate_relationship(1, v_a);
    PERFORM vc.activate_relationship(1, v_b);
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 active after idempotent ops, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
