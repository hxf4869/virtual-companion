-- 11_missing_context_zero_write: completing with no tenant context bound writes
-- zero rows; the item stays CLAIMED.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status,
                         claim_token, claim_fence, claimed_at, lease_expires_at)
VALUES (1, 1, 'GENERATION', 10, 'CLAIMED', 'TOK', 'F', now(), now() + interval '5 minutes');

-- vc_worker with NO tenant context bound.
SET ROLE vc_worker;
DO $$
DECLARE r int;
BEGIN
    SELECT vc.complete_work_item('TOK') INTO r;
    IF r <> 0 THEN
        RAISE EXCEPTION 'missing context wrote % rows (expected 0)', r;
    END IF;
END $$;
RESET ROLE;

DO $$
DECLARE s text;
BEGIN
    SELECT status INTO s FROM vc.work_item WHERE id = 1;
    IF s <> 'CLAIMED' THEN
        RAISE EXCEPTION 'missing context changed status to % (expected CLAIMED)', s;
    END IF;
END $$;
