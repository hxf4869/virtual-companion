-- INC-PREF V54: account-level default for the next new conversation's
-- incognito flag (FR-CHAT-005). Creation still freezes the flag on the
-- conversation row; this pref only seeds the "下次新会话" toggle.

SET search_path TO vc, pg_catalog;

CREATE TABLE IF NOT EXISTS vc.incognito_pref (
    owner_user_id      bigint   PRIMARY KEY,
    default_incognito  boolean  NOT NULL DEFAULT false,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

ALTER TABLE vc.incognito_pref ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.incognito_pref FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.incognito_pref;
CREATE POLICY owner_isolation ON vc.incognito_pref FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

CREATE OR REPLACE FUNCTION vc.get_incognito_pref(p_owner_user_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_default boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_incognito_pref: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_incognito_pref: owner_user_id must match server-trusted context';
    END IF;

    SELECT default_incognito INTO v_default
      FROM vc.incognito_pref
     WHERE owner_user_id = p_owner_user_id;
    RETURN COALESCE(v_default, false);
END;
$$;

CREATE OR REPLACE FUNCTION vc.update_incognito_pref(
    p_owner_user_id     bigint,
    p_default_incognito boolean
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'update_incognito_pref: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'update_incognito_pref: owner_user_id must match server-trusted context';
    END IF;
    IF p_default_incognito IS NULL THEN
        RAISE EXCEPTION 'update_incognito_pref: default_incognito is required';
    END IF;

    INSERT INTO vc.incognito_pref(owner_user_id, default_incognito, updated_at)
    VALUES (p_owner_user_id, p_default_incognito, now())
    ON CONFLICT (owner_user_id) DO UPDATE
        SET default_incognito = EXCLUDED.default_incognito,
            updated_at = now();
    RETURN p_default_incognito;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.get_incognito_pref(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.update_incognito_pref(bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.get_incognito_pref(bigint),
    vc.update_incognito_pref(bigint, boolean)
    TO vc_api;
