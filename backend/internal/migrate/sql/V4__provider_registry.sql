-- TASK-0015 V4: Provider Registry persistence skeleton (platform reference data).
--
-- Persists durable ProviderDeployment metadata (provider id, protocol,
-- capabilities, admission state). Provider deployments are governance-level
-- reference data shared across tenants, so this table is NOT tenant scoped and
-- carries no owner_user_id / RLS: every runtime role reads the same admitted
-- deployments. The live adapter objects are runtime-only and stay in memory;
-- this table is the durable admission-state skeleton behind ProviderRegistry.
--
-- Capability values are stored as a sorted text[] so the registry can match a
-- requested ModelProtocolCapabilities against every admitted deployment.

SET search_path TO vc, public;

CREATE TABLE IF NOT EXISTS vc.provider_deployment (
    provider_id     text PRIMARY KEY,
    protocol        text NOT NULL,
    capabilities    text[] NOT NULL,
    admission_state text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT provider_admission_state CHECK (
        admission_state IN ('ADMITTED', 'DISABLED', 'REJECTED')
    )
);

-- Platform reference data: all runtime roles read deployments; admission
-- transitions are owned by the coordinator role. No BYPASSRLS concern applies
-- because this table is intentionally not row-security isolated.
GRANT SELECT ON vc.provider_deployment
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT INSERT, UPDATE ON vc.provider_deployment TO vc_job_coordinator;
