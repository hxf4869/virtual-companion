-- 05_missing_context_fail_closed: with no tenant context bound at all, a
-- runtime role reads nothing and cannot insert. The owner predicate resolves
-- to NULL, so the equality matches no row and the WITH CHECK rejects writes.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (9, 'nobody');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');

SET ROLE vc_api;
-- Read with no vc.owner_user_id bound: zero rows, never a cross-tenant leak.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN
        RAISE EXCEPTION 'missing-context leak: expected 0 rows, got %', n;
    END IF;
END $$;

-- Write with no context must also fail closed. TASK-0153 V16 revoked direct
-- INSERT on vc.relationship from runtime roles, so a vc_api INSERT now fails
-- with permission denied before the RLS WITH CHECK is consulted. Both failure
-- modes (REVOKE privilege denial and RLS WITH CHECK denial) are valid
-- fail-closed outcomes for "a context-less runtime role cannot write".
DO $$
BEGIN
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
    VALUES (9, 90, 'ghost');
    RAISE EXCEPTION 'missing-context write unexpectedly succeeded';
EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
        -- V16 REVOKE (permission denied) or RLS WITH CHECK (owner=NULL) denied
        -- the write; either is an acceptable fail-closed outcome.
END $$;
RESET ROLE;
