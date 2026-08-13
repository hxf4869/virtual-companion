-- 08_expired_lease_zero_write: completing a claim whose lease already expired
-- writes zero rows; the item stays CLAIMED.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status,
                         claim_token, claim_fence, claimed_at, lease_expires_at)
VALUES (1, 1, 'GENERATION', 10, 'CLAIMED', 'TOK', 'F', now(), now() - interval '1 minute');

-- SET ROLE vc_worker;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
SET LOCAL vc.job_fence = 'F';
DO $$
DECLARE r int;
BEGIN
    SELECT vc.complete_work_item('TOK') INTO r;
    IF r <> 0 THEN
        RAISE EXCEPTION 'expired lease wrote % rows (expected 0)', r;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE s text;
BEGIN
    SELECT status INTO s FROM vc.work_item WHERE id = 1;
    IF s <> 'CLAIMED' THEN
        RAISE EXCEPTION 'expired lease changed status to % (expected CLAIMED)', s;
    END IF;
END $$;
