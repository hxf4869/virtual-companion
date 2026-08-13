-- 24_resume_not_found_or_forbidden: a resume on a generation invisible to the
-- caller (another owner's generation, or a non-existent id) returns
-- NOT_FOUND_OR_FORBIDDEN. FORCE RLS fails closed: owner 2 cannot see owner 1's
-- generation, so the resume never reveals cross-tenant existence (INV-TENANT-001).

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-nf-1', 'IN_PROGRESS');

-- A cross-owner resume must fail closed as NOT_FOUND_OR_FORBIDDEN.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_disp text;
BEGIN
    SELECT out_disposition INTO v_disp FROM vc.resume_stream(2, 5000, 1, 0);
    IF v_disp <> 'NOT_FOUND_OR_FORBIDDEN' THEN
        RAISE EXCEPTION 'cross-owner resume must be NOT_FOUND_OR_FORBIDDEN (got %)', v_disp;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A resume on an id that was never created also returns NOT_FOUND_OR_FORBIDDEN.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_disp text;
BEGIN
    SELECT out_disposition INTO v_disp FROM vc.resume_stream(1, 9999, 1, 0);
    IF v_disp <> 'NOT_FOUND_OR_FORBIDDEN' THEN
        RAISE EXCEPTION 'non-existent generation must be NOT_FOUND_OR_FORBIDDEN (got %)', v_disp;
    END IF;

    -- The snapshot endpoint raises (fail closed) instead of leaking existence.
    BEGIN
        PERFORM * FROM vc.read_generation_snapshot(1, 9999);
        RAISE EXCEPTION 'snapshot on non-existent generation must raise';
    EXCEPTION WHEN OTHERS THEN
        -- expected: not found for owner
    END;
END $$;
COMMIT;
RESET ROLE;
