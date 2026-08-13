-- 70_owner_forged_binding_denied: TASK-0191 -- a session that sets ALL THREE
-- context GUCs (owner, nonce, binding) with a garbage or copied-but-wrong
-- proof still fails: current_owner_id() recomputes the expected HMAC for
-- exactly this owner/session/transaction/nonce and any mismatch returns NULL
-- (fail closed). Covers: wrong-proof hex, well-formed-but-wrong proof for a
-- different tuple, and tampered nonce (proof no longer matches the tuple).
-- Key assertions run under the REAL runtime role.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a'), (2, 20, 'persona-b');

-- Case 1: garbage binding proof.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
SET LOCAL vc.owner_nonce = 'deadbeef';
SET LOCAL vc.owner_binding = '0000000000000000000000000000000000000000000000000000000000000000';
DO $$
DECLARE n int;
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'garbage proof must fail closed';
    END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN RAISE EXCEPTION 'garbage proof leaked % rows', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Case 2: the superuser fixture computes a REAL proof for owner 1 in THIS
-- transaction, then the assertion (as vc_api) tampers the owner GUC to 2:
-- the proof was not minted for owner 2, so validation must fail closed.
-- This is the cross-owner forgery shape an attacker would attempt after
-- observing one legitimate context establishment.
BEGIN;
SELECT vc.set_owner_context(1, 'p70', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'p70', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
-- Sanity: the legitimate tuple DOES validate while still superuser.
DO $$
BEGIN
    IF vc.current_owner_id() IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'fixture: legitimate context must validate (got %)', vc.current_owner_id();
    END IF;
END $$;
-- Tamper: flip the owner GUC to 2, keep nonce+binding.
SELECT set_config('vc.owner_user_id', '2', true);
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'tampered owner with foreign proof must fail closed (got %)', vc.current_owner_id();
    END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN RAISE EXCEPTION 'tampered tuple leaked % rows', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Case 3: tamper the nonce after a legitimate establishment: the proof no
-- longer matches the recomputed tuple, fail closed.
BEGIN;
SELECT vc.set_owner_context(1, 'p70b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'p70b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SELECT set_config('vc.owner_nonce', 'tampered-nonce', true);
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'tampered nonce must fail closed';
    END IF;
END $$;
COMMIT;
RESET ROLE;
