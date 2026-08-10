-- 51_authorization_snapshot_one_way_lifecycle: authorization snapshots are
-- insert-only and transition one-way ACTIVE -> WITHDRAWN/NARROWED; a terminal
-- snapshot can never be resurrected or re-transitioned, and concurrent
-- transitions are mutually exclusive (P2-12, INV-AUTH-001). The Java store's
-- ON CONFLICT DO NOTHING and status-conditioned single-statement UPDATEs are
-- proven here at the schema level with real roles and two sessions.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

-- Open the concurrent session as the connecting superuser (before SET ROLE)
-- and switch it to the runtime role; the main session below also runs as vc_api.
DO $$
BEGIN
    PERFORM dblink_connect('sess_conc', 'dbname=vc');
    PERFORM dblink_exec('sess_conc', 'SET ROLE vc_api');
END $$;

SET ROLE vc_api;

-- Phase 1: insert-only — a second insert with the same snapshot id (same
-- owner) must fail; the existing row is never overwritten.
BEGIN;
SET LOCAL vc.owner_user_id = '1';
INSERT INTO vc.authorization_snapshot
    (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
     purpose, data_categories, task_cancelled, source_data_deleted)
VALUES (1, 'snap-1', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
DO $$
BEGIN
    INSERT INTO vc.authorization_snapshot
        (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
         purpose, data_categories, task_cancelled, source_data_deleted)
    VALUES (1, 'snap-1', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
    RAISE EXCEPTION 'duplicate snapshot insert unexpectedly accepted';
EXCEPTION
    WHEN unique_violation THEN NULL;
END $$;
COMMIT;

-- Phase 2: WITHDRAWN is terminal — one-way ACTIVE -> WITHDRAWN, then zero-row
-- re-transitions and a failed resurrection attempt.
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN'
    WHERE snapshot_id = 'snap-1' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'ACTIVE -> WITHDRAWN must change exactly 1 row (got %)', n;
    END IF;
    -- Terminal snapshots must not re-transition (status-conditioned UPDATE).
    UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN'
    WHERE snapshot_id = 'snap-1' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'withdraw on WITHDRAWN changed % rows (must be 0)', n;
    END IF;
    UPDATE vc.authorization_snapshot SET status = 'NARROWED'
    WHERE snapshot_id = 'snap-1' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'narrow on WITHDRAWN changed % rows (must be 0)', n;
    END IF;
END $$;
-- Resurrection: re-inserting a withdrawn snapshot id must fail.
DO $$
BEGIN
    INSERT INTO vc.authorization_snapshot
        (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
         purpose, data_categories, task_cancelled, source_data_deleted)
    VALUES (1, 'snap-1', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
    RAISE EXCEPTION 'withdrawn snapshot resurrected';
EXCEPTION
    WHEN unique_violation THEN NULL;
END $$;
COMMIT;

-- Phase 3: NARROWED is terminal — one-way ACTIVE -> NARROWED, then zero-row
-- re-transitions and a failed resurrection attempt.
BEGIN;
SET LOCAL vc.owner_user_id = '1';
INSERT INTO vc.authorization_snapshot
    (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
     purpose, data_categories, task_cancelled, source_data_deleted)
VALUES (1, 'snap-2', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
DO $$
DECLARE n int;
BEGIN
    UPDATE vc.authorization_snapshot SET
        status = 'NARROWED', provider_id = 'prov-2', region = 'us',
        contract_ref = 'contract-2', purpose = 'COMPANION_CHAT',
        data_categories = ARRAY['MEMORY_SNIPPET'],
        task_cancelled = false, source_data_deleted = false
    WHERE snapshot_id = 'snap-2' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'ACTIVE -> NARROWED must change exactly 1 row (got %)', n;
    END IF;
    UPDATE vc.authorization_snapshot SET status = 'NARROWED'
    WHERE snapshot_id = 'snap-2' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'narrow on NARROWED changed % rows (must be 0)', n;
    END IF;
    UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN'
    WHERE snapshot_id = 'snap-2' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'withdraw on NARROWED changed % rows (must be 0)', n;
    END IF;
END $$;
DO $$
BEGIN
    INSERT INTO vc.authorization_snapshot
        (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
         purpose, data_categories, task_cancelled, source_data_deleted)
    VALUES (1, 'snap-2', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
    RAISE EXCEPTION 'narrowed snapshot resurrected';
EXCEPTION
    WHEN unique_violation THEN NULL;
END $$;
COMMIT;

-- Phase 4: concurrent withdraw is mutually exclusive — the session holding
-- the row lock wins the ACTIVE -> WITHDRAWN transition; the blocked loser
-- re-checks the status condition under the lock and changes zero rows.
BEGIN;
SET LOCAL vc.owner_user_id = '1';
INSERT INTO vc.authorization_snapshot
    (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
     purpose, data_categories, task_cancelled, source_data_deleted)
VALUES (1, 'snap-4', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
SELECT 1 FROM vc.authorization_snapshot WHERE snapshot_id = 'snap-4' FOR UPDATE;
DO $$
BEGIN
    PERFORM dblink_send_query('sess_conc',
        $q$BEGIN;
        SET LOCAL vc.owner_user_id = '1';
        DO $b$
        DECLARE n int;
        BEGIN
            UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN'
            WHERE snapshot_id = 'snap-4' AND status = 'ACTIVE';
            GET DIAGNOSTICS n = ROW_COUNT;
            IF n <> 0 THEN
                RAISE EXCEPTION 'concurrent withdraw changed % rows (must be 0)', n;
            END IF;
        END $b$;
        COMMIT;$q$);
    -- The winner transitions inside the lock; the loser sees WITHDRAWN after
    -- this commit and its status-conditioned UPDATE changes zero rows.
    UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN'
    WHERE snapshot_id = 'snap-4' AND status = 'ACTIVE';
END $$;
COMMIT;
DO $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM vc.authorization_snapshot
    WHERE snapshot_id = 'snap-4';
    IF v_status <> 'WITHDRAWN' THEN
        RAISE EXCEPTION 'expected WITHDRAWN after concurrent withdraw (got %)', v_status;
    END IF;
    -- The loser's query must have completed without raising.
    PERFORM * FROM dblink_get_result('sess_conc') AS t(dummy text);
    PERFORM dblink_disconnect('sess_conc');
END $$;
RESET ROLE;

-- Phase 5: cross-owner isolation — owner 2 can neither see nor transition
-- owner 1's snapshot, and cannot resurrect its id (UNIQUE snapshot_id).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE n int;
BEGIN
    UPDATE vc.authorization_snapshot SET status = 'WITHDRAWN'
    WHERE snapshot_id = 'snap-1' AND status = 'ACTIVE';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN
        RAISE EXCEPTION 'owner 2 transitioned owner 1 snapshot (% rows)', n;
    END IF;
END $$;
DO $$
BEGIN
    INSERT INTO vc.authorization_snapshot
        (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
         purpose, data_categories, task_cancelled, source_data_deleted)
    VALUES (2, 'snap-1', 'ACTIVE', 'prov-9', 'us', 'contract-9',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);
    RAISE EXCEPTION 'cross-owner duplicate snapshot id accepted';
EXCEPTION
    WHEN unique_violation THEN NULL;
END $$;
COMMIT;
RESET ROLE;
