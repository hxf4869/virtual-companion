-- TASK-0015 V3: authorization snapshot persistence skeleton (tenant-scoped).
--
-- Persists requested/execution AuthorizationSnapshot value objects (see
-- service/modules/modelruntime/.../authorization). Snapshots are tenant
-- scoped: each belongs to one owner and is protected by FORCE RLS so a
-- withdrawn or narrowed snapshot cannot be read across tenants. INV-AUTH-001.

SET search_path TO vc, public;

CREATE TABLE IF NOT EXISTS vc.authorization_snapshot (
    owner_user_id      bigint NOT NULL,
    snapshot_id        text NOT NULL,
    status             text NOT NULL,
    provider_id        text NOT NULL,
    region             text NOT NULL,
    contract_ref       text NOT NULL,
    purpose            text NOT NULL,
    data_categories    text[] NOT NULL,
    task_cancelled     boolean NOT NULL DEFAULT false,
    source_data_deleted boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, snapshot_id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    UNIQUE (snapshot_id)
);

ALTER TABLE vc.authorization_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.authorization_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.authorization_snapshot;
CREATE POLICY owner_isolation ON vc.authorization_snapshot FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON vc.authorization_snapshot
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
