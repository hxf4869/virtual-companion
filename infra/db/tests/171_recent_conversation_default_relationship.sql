-- Frontend redo Phase A: default relationship provisioning is idempotent,
-- preserves an existing relationship, and remains owner-bound.

\set ON_ERROR_STOP on

TRUNCATE vc.message, vc.conversation, vc.relationship, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active, created_at)
VALUES (1, 10, 'existing-persona', false, '2026-01-01T00:00:00Z');

BEGIN;
SELECT vc.set_owner_context(1, 'default-rel-1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'default-rel-1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    first_id bigint;
    second_id bigint;
    n integer;
BEGIN
    first_id := vc.ensure_default_relationship(1, 'gentle-listener');
    second_id := vc.ensure_default_relationship(1, 'gentle-listener');
    IF first_id <> 10 OR second_id <> 10 THEN
        RAISE EXCEPTION 'existing relationship was not reused: %, %', first_id, second_id;
    END IF;
    SELECT count(*) INTO n FROM vc.relationship
     WHERE owner_user_id = 1 AND active;
    IF n <> 1 THEN
        RAISE EXCEPTION 'owner 1 must have one active relationship, got %', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'default-rel-2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'default-rel-2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    first_id bigint;
    second_id bigint;
    n integer;
    persona text;
BEGIN
    first_id := vc.ensure_default_relationship(2, 'gentle-listener');
    second_id := vc.ensure_default_relationship(2, 'gentle-listener');
    IF first_id IS NULL OR second_id <> first_id THEN
        RAISE EXCEPTION 'default relationship is not idempotent: %, %', first_id, second_id;
    END IF;
    SELECT count(*), max(persona_ref) INTO n, persona
      FROM vc.relationship
     WHERE owner_user_id = 2 AND active;
    IF n <> 1 OR persona IS DISTINCT FROM 'gentle-listener' THEN
        RAISE EXCEPTION 'owner 2 default mismatch: count %, persona %', n, persona;
    END IF;

    BEGIN
        PERFORM vc.ensure_default_relationship(1, 'gentle-listener');
        RAISE EXCEPTION 'cross-owner ensure unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cross-owner ensure unexpectedly succeeded%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%owner must match server-trusted context%' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF has_function_privilege('public',
            'vc.ensure_default_relationship(bigint,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC unexpectedly executes ensure_default_relationship';
    END IF;
END $$;
