-- 09_wrong_token_zero_write: completing with a token that does not match the
-- claim writes zero rows; the item stays CLAIMED.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status,
                         claim_token, claim_fence, claimed_at, lease_expires_at)
VALUES (1, 1, 'GENERATION', 10, 'CLAIMED', 'GOOD', 'F', now(), now() + interval '5 minutes');

SET ROLE vc_worker;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
SET LOCAL vc.job_fence = 'F';
DO $$
DECLARE r int;
BEGIN
    SELECT vc.complete_work_item('BAD') INTO r;
    IF r <> 0 THEN
        RAISE EXCEPTION 'wrong token wrote % rows (expected 0)', r;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE s text;
BEGIN
    SELECT status INTO s FROM vc.work_item WHERE id = 1;
    IF s <> 'CLAIMED' THEN
        RAISE EXCEPTION 'wrong token changed status to % (expected CLAIMED)', s;
    END IF;
END $$;
