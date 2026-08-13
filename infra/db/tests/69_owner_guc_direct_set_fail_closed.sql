-- 69_owner_guc_direct_set_fail_closed: TASK-0191 P0 remediation -- a runtime
-- role (or any session) can always SET the custom GUC namespace, but after
-- V27 the bare GUC no longer establishes a tenant: vc.current_owner_id()
-- re-validates the full domain-separated binding tuple (owner | nonce |
-- backend pid | transaction id | proof) against the restricted key table and
-- returns NULL when any part is missing. FORCE RLS then matches nothing
-- (INV-TENANT-001 fail-closed). Key assertions run under the REAL runtime
-- role; the superuser is fixture-only.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a'), (2, 20, 'persona-b');

-- Direct SET of the owner GUC as a runtime role must NOT open owner 2's rows.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE
    n     int;
    owner bigint;
BEGIN
    owner := vc.current_owner_id();
    IF owner IS NOT NULL THEN
        RAISE EXCEPTION 'forged direct SET must yield NULL current_owner_id (got %)', owner;
    END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN
        RAISE EXCEPTION 'forged direct SET leaked % rows', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Same denial for vc_worker (worker path, INV-WORKER-001): no context means
-- no tenant reads even though rows exist.
SET ROLE vc_worker;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    n     int;
    owner bigint;
BEGIN
    owner := vc.current_owner_id();
    IF owner IS NOT NULL THEN
        RAISE EXCEPTION 'vc_worker forged SET must yield NULL current_owner_id (got %)', owner;
    END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN
        RAISE EXCEPTION 'vc_worker forged SET leaked % rows', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
