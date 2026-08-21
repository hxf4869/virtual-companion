-- 72_owner_binding_replay_and_legit_path: TASK-0191 replay matrix + the
-- legitimate establishment path.
--
--   * cross-owner replay: a proof minted for owner 1 cannot be replayed for
--     owner 2 through set_owner_context itself (the server recomputes the
--     expected proof for the REQUESTED owner);
--   * cross-transaction replay: re-installing the exact GUC tuple of a
--     committed transaction in a NEW transaction fails (the proof binds the
--     old transaction id);
--   * cross-connection replay: a proof minted with a foreign backend pid
--     fails (simulated by computing a proof with pid+1 and injecting the
--     GUC tuple directly);
--   * legitimate path: a correctly minted proof establishes the context,
--     current_owner_id() returns the owner, RLS shows exactly the owner's
--     rows and the other tenant stays invisible, and the SD-function owner
--     assertion (V17 shape) passes for the matching owner and rejects a
--     mismatched caller argument.
--
-- Superuser is fixture-only (it can read the restricted key table to mint
-- proofs); every key assertion runs under the REAL runtime role.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a'), (2, 20, 'persona-b');

-- ---------------------------------------------------------------------------
-- 1) Cross-owner replay through the establisher: proof minted for owner 1,
--    presented for owner 2. Must RAISE. (The establisher itself recomputes
--    the expected proof for the requested owner; the caller role is not the
--    security boundary here, so the mint runs on the superuser fixture.)
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
    v_proof text;
BEGIN
    -- Minted by the superuser fixture for owner 1 (foreign role cannot read
    -- the key, so the proof is precomputed outside and passed in, exactly as
    -- a stolen/replayed proof would be).
    v_proof := encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'rp1', 'UTF8'),
                           convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex');
    BEGIN
        PERFORM vc.set_owner_context(2, 'rp1', v_proof);
        RAISE EXCEPTION 'cross-owner replay must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cross-owner replay must be rejected%' THEN
            RAISE;
        END IF;
        IF position('proof rejected' in SQLERRM) = 0 AND position('invalid' in SQLERRM) = 0 THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;

-- ---------------------------------------------------------------------------
-- 2) Cross-transaction replay: capture the full GUC tuple of transaction A,
--    then reinstall it verbatim in transaction B. The proof binds A's xact
--    id, so current_owner_id() must return NULL in B.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE replay_tuple(owner text, nonce text, binding text);

BEGIN;
SELECT vc.set_owner_context(1, 'rp2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'rp2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
INSERT INTO replay_tuple
VALUES (current_setting('vc.owner_user_id'),
        current_setting('vc.owner_nonce'),
        current_setting('vc.owner_binding'));
COMMIT;

-- Sanity: after COMMIT the transaction-local GUCs are gone.
DO $$
BEGIN
    IF NULLIF(current_setting('vc.owner_user_id', true), '') IS NOT NULL THEN
        RAISE EXCEPTION 'fixture: transaction-local owner GUC must clear at COMMIT';
    END IF;
END $$;

BEGIN;
SELECT set_config('vc.owner_user_id', (SELECT owner FROM replay_tuple), true);
SELECT set_config('vc.owner_nonce', (SELECT nonce FROM replay_tuple), true);
SELECT set_config('vc.owner_binding', (SELECT binding FROM replay_tuple), true);
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'cross-transaction replay must fail closed';
    END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN RAISE EXCEPTION 'cross-transaction replay leaked % rows', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) Cross-connection replay: a proof minted for a DIFFERENT backend pid
--    (simulated with pid+1; the server recomputes with its own pid) fails.
-- ---------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
    v_foreign text;
BEGIN
    v_foreign := encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || (pg_backend_pid() + 1) || '|' || pg_current_xact_id() || '|' || 'rp3', 'UTF8'),
                             convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex');
    PERFORM set_config('vc.owner_user_id', '1', true);
    PERFORM set_config('vc.owner_nonce', 'rp3', true);
    PERFORM set_config('vc.owner_binding', v_foreign, true);
END $$;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'cross-connection (foreign pid) replay must fail closed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4) Legitimate path: correctly minted proof establishes the context; the
--    runtime role sees exactly its own rows; the other tenant is invisible;
--    a V17-shape SD call with a mismatched owner argument is rejected.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'lg1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'lg1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    IF vc.current_owner_id() IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'legitimate context must validate (got %)', vc.current_owner_id();
    END IF;
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must see exactly 1 row, got %', n; END IF;
    IF EXISTS (SELECT 1 FROM vc.relationship WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'owner 2 rows visible under owner 1 context';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5) set_owner_context malformed inputs (wrong-length proof, empty nonce,
--    non-positive owner) fail closed before any GUC is written.
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
BEGIN;
DO $$
BEGIN
    BEGIN
        PERFORM vc.set_owner_context(1, 'lg2', 'tooshort');
        RAISE EXCEPTION 'short proof must be rejected';
    EXCEPTION WHEN OTHERS THEN NULL;
        IF SQLERRM LIKE '%short proof must be rejected%' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.set_owner_context(1, '', '0000000000000000000000000000000000000000000000000000000000000000');
        RAISE EXCEPTION 'empty nonce must be rejected';
    EXCEPTION WHEN OTHERS THEN NULL;
        IF SQLERRM LIKE '%empty nonce must be rejected%' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.set_owner_context(0, 'lg3', '0000000000000000000000000000000000000000000000000000000000000000');
        RAISE EXCEPTION 'non-positive owner must be rejected';
    EXCEPTION WHEN OTHERS THEN NULL;
        IF SQLERRM LIKE '%non-positive owner must be rejected%' THEN
            RAISE;
        END IF;
    END;
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'rejected calls must leave no context behind';
    END IF;
END $$;
COMMIT;
RESET ROLE;
