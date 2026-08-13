-- 04_stale_worker_fence_denied: the worker-side job-context entry point is no
-- longer executable by runtime roles at all (TASK-0191 V27: begin_job_context
-- lost EXECUTE for PUBLIC and every runtime role -- no ordinary-runtime
-- arbitrary-owner entry remains). Without a server-established context every
-- read fails closed even though owned rows exist. Full lease/fence lifecycle
-- is TASK-0016; this proves the FORCE RLS fail-closed baseline the worker
-- layer will depend on.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a');

SET ROLE vc_worker;
DO $$
BEGIN
    -- TASK-0191: the call itself must be denied before any fence logic runs
    -- (permission denied, SQLSTATE 42501). Previously this asserted the stale
    -- fence raise; V27 revokes EXECUTE so the arbitrary-owner entry point is
    -- unreachable for runtime roles entirely.
    PERFORM vc.begin_job_context(1, 'STALE');
    RAISE EXCEPTION 'begin_job_context unexpectedly executable by vc_worker';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;  -- expected: permission denied for function begin_job_context
    WHEN others THEN
        IF sqlerrm NOT LIKE '%stale%' THEN
            RAISE;
        END IF;
END $$;

-- No owner context is established: reads return nothing (fail closed).
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN
        RAISE EXCEPTION 'stale fence leak: expected 0 rows without context, got %', n;
    END IF;
END $$;
RESET ROLE;
