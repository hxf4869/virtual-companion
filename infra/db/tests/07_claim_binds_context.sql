-- 07_claim_binds_context: claim_work_items atomically claims a tenant's pending
-- items, binds the tenant context for the transaction and issues a token.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, decode('aa', 'hex')),
    (1, 2, 'GENERATION', 11, NULL);

SET ROLE vc_worker;
BEGIN;
-- V17: claim_work_items now requires a server-trusted owner context that
-- matches p_owner_user_id (P1-04 fail-closed). The caller establishes it.
SET LOCAL vc.owner_user_id = '1';
SELECT count(*) AS claimed FROM vc.claim_work_items(1, 'FENCE-A', 30, 16);
DO $$
DECLARE o bigint; f text; n int;
BEGIN
    o := NULLIF(current_setting('vc.owner_user_id', true), '')::bigint;
    f := NULLIF(current_setting('vc.job_fence', true), '');
    IF o IS NULL OR o <> 1 THEN
        RAISE EXCEPTION 'owner context not bound to 1 (got %)', o;
    END IF;
    IF f IS NULL OR f <> 'FENCE-A' THEN
        RAISE EXCEPTION 'job fence not bound to FENCE-A (got %)', f;
    END IF;
    SELECT count(*) INTO n FROM vc.work_item WHERE status = 'CLAIMED';
    IF n <> 2 THEN
        RAISE EXCEPTION 'expected 2 CLAIMED items, got %', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
