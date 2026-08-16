-- CONSENT V41: versioned user consent records (FR-AUTH-003 / FR-AUTH-005).
--
-- Every consent record is APPEND-ONLY and versioned: granting or revoking
-- inserts a new row (the history stays auditable; the latest row per type
-- wins). consent_type covers the FR-AUTH-003 catalogue:
--   SERVICE_TERMS, PRIVACY_POLICY, AI_CONTENT_NOTICE,
--   THIRD_PARTY_MODEL_PROCESSING, SENSITIVE_DATA_PROCESSING,
--   EMERGENCY_CONTACT, MODEL_TRAINING, PUSH_NOTIFICATION.
-- Withdrawing MODEL_TRAINING must never affect basic chat: the runtime derives
-- its authorization snapshots independently and the consent rows here are the
-- user-facing record layer (FR-AUTH-005's execution-time re-check stays in the
-- authorization snapshot machinery).
--
-- All access flows through the V17 trusted-owner SECURITY DEFINER functions;
-- runtime roles hold no table grants and the table is FORCE RLS
-- owner_isolation.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.consent_record_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.consent_record_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE TABLE IF NOT EXISTS vc.consent_record (
    owner_user_id  bigint      NOT NULL,
    id             bigint      NOT NULL,
    consent_type   text        NOT NULL,
    version        text        NOT NULL,
    granted        boolean     NOT NULL,
    granted_at     timestamptz NOT NULL DEFAULT now(),
    revoked_at     timestamptz,
    PRIMARY KEY (owner_user_id, id),
    CONSTRAINT consent_record_type_check CHECK (consent_type IN
        ('SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE',
         'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING',
         'EMERGENCY_CONTACT', 'MODEL_TRAINING', 'PUSH_NOTIFICATION')),
    CONSTRAINT consent_record_version_len CHECK (length(version) BETWEEN 1 AND 64)
);

ALTER TABLE vc.consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.consent_record FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.consent_record;
CREATE POLICY owner_isolation ON vc.consent_record FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- ---------------------------------------------------------------------------
-- record_consent: append a versioned grant/revoke row; returns the new id.
-- A grant records granted=true with granted_at; a revoke records
-- granted=false with revoked_at. The history is never rewritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_consent(
    p_owner_user_id bigint,
    p_consent_type  text,
    p_version       text,
    p_granted       boolean
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_consent: owner_user_id is required';
    END IF;
    IF p_consent_type NOT IN ('SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE',
            'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING',
            'EMERGENCY_CONTACT', 'MODEL_TRAINING', 'PUSH_NOTIFICATION') THEN
        RAISE EXCEPTION 'record_consent: unapproved consent type';
    END IF;
    IF p_version IS NULL OR btrim(p_version) = '' OR length(p_version) > 64 THEN
        RAISE EXCEPTION 'record_consent: version must be 1..64 characters';
    END IF;
    IF p_granted IS NULL THEN
        RAISE EXCEPTION 'record_consent: granted is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_consent: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.consent_record_id_seq');
    INSERT INTO vc.consent_record
        (owner_user_id, id, consent_type, version, granted, granted_at, revoked_at)
    VALUES
        (p_owner_user_id, v_id, p_consent_type, btrim(p_version), p_granted,
         now(), CASE WHEN p_granted THEN NULL ELSE now() END);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_consents: the LATEST row per consent type (the effective state).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_consents(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_consent_type text, out_version text,
                  out_granted boolean, out_granted_at timestamptz,
                  out_revoked_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_consents: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_consents: owner_user_id must match server-trusted context';
    END IF;
    RETURN QUERY
        SELECT DISTINCT ON (c.consent_type)
               c.id, c.consent_type, c.version, c.granted,
               c.granted_at, c.revoked_at
          FROM vc.consent_record c
         WHERE c.owner_user_id = p_owner_user_id
         ORDER BY c.consent_type, c.id DESC;
END;
$$;

-- Closed by default: only the API ingestion role may record/read consents.
REVOKE EXECUTE ON FUNCTION vc.record_consent(bigint, text, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_consents(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_consent(bigint, text, text, boolean) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_consents(bigint) TO vc_api;
