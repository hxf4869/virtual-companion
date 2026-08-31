-- AGE-MIN V45: adult-verification state persistence (FR-AUTH-002).
--
-- The Beta gate requires ADULT_VERIFIED (product-scope ageStateRequired)
-- before generative chat opens to real users. This migration is the
-- persistence half of the age-verification PORT: the runtime keeps only the
-- verification RESULT, the age band, the verification time and a provider
-- reference — never the full identity document (需求：不保存完整身份证号码).
-- The result history is append-only per owner; the latest row is the
-- effective state (age-states catalog, 9 codes). Transitions are validated
-- by the runtime against the catalog transition table (AgeStateTransitions);
-- the SQL CHECK pins the 9-code set as defense in depth.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.age_verification_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.age_verification_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.age_verification (
    owner_user_id bigint      NOT NULL,
    id            bigint      NOT NULL,
    age_state     text        NOT NULL,
    provider_ref  text        NOT NULL,
    verified_at   timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT age_verification_state_check CHECK (age_state IN
        ('AGE_UNKNOWN', 'ADULT_SELF_DECLARED', 'ADULT_VERIFICATION_REQUIRED',
         'ADULT_VERIFIED', 'MINOR_SUSPECTED', 'MINOR_VERIFIED',
         'AGE_APPEAL_PENDING', 'AGE_REVERIFY_REQUIRED', 'AGE_ACCESS_SUSPENDED'))
);

ALTER TABLE vc.age_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.age_verification FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.age_verification;
CREATE POLICY owner_isolation ON vc.age_verification FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- ---------------------------------------------------------------------------
-- record_age_verification: append one verification-result row (the history is
-- never rewritten; the latest row per owner is the effective state). Returns
-- the new row id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_age_verification(
    p_owner_user_id bigint,
    p_age_state     text,
    p_provider_ref  text
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
        RAISE EXCEPTION 'record_age_verification: owner_user_id is required';
    END IF;
    IF p_age_state NOT IN ('AGE_UNKNOWN', 'ADULT_SELF_DECLARED',
            'ADULT_VERIFICATION_REQUIRED', 'ADULT_VERIFIED', 'MINOR_SUSPECTED',
            'MINOR_VERIFIED', 'AGE_APPEAL_PENDING', 'AGE_REVERIFY_REQUIRED',
            'AGE_ACCESS_SUSPENDED') THEN
        RAISE EXCEPTION 'record_age_verification: unapproved age state';
    END IF;
    IF p_provider_ref IS NULL OR btrim(p_provider_ref) = '' THEN
        RAISE EXCEPTION 'record_age_verification: provider_ref is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_age_verification: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.age_verification_id_seq');
    INSERT INTO vc.age_verification(owner_user_id, id, age_state, provider_ref)
    VALUES (p_owner_user_id, v_id, p_age_state, btrim(p_provider_ref));
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_age_state: the LATEST verification row (the effective age state).
-- A foreign or absent owner yields zero rows (existence is never disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_age_state(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_age_state text, out_provider_ref text,
                  out_verified_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_age_state: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_age_state: owner_user_id must match server-trusted context';
    END IF;
    RETURN QUERY
        SELECT a.id, a.age_state, a.provider_ref, a.verified_at
          FROM vc.age_verification a
         WHERE a.owner_user_id = p_owner_user_id
         ORDER BY a.id DESC
         LIMIT 1;
END;
$$;

-- Closed by default: only the API ingestion role reaches age records.
REVOKE EXECUTE ON FUNCTION vc.record_age_verification(bigint, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_age_state(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_age_verification(bigint, text, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.get_age_state(bigint) TO vc_api;
