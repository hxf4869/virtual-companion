-- 06_authorization_snapshot_isolation: authorization snapshots are tenant scoped
-- under FORCE RLS. A runtime role bound to owner 1 sees only owner 1's snapshots;
-- another owner's snapshots are invisible (INV-AUTH-001, INV-TENANT-001).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.authorization_snapshot
    (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
     purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-a', 'ACTIVE', 'prov-1', 'eu', 'contract-1',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (2, 'snap-b', 'ACTIVE', 'prov-2', 'us', 'contract-2',
     'COMPANION_CHAT', ARRAY['MEMORY_SNIPPET'], false, false);

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.authorization_snapshot;
    IF n <> 1 THEN
        RAISE EXCEPTION 'authorization snapshot leak: expected 1 for owner 1, got %', n;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.authorization_snapshot WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'authorization snapshot leak: owner 2 snapshot visible to owner 1';
    END IF;
END $$;
COMMIT;
RESET ROLE;
