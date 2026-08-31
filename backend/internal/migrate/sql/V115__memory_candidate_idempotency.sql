-- G8 / redesign §9.4: Owner-explicit memory candidate create is idempotent
-- when the caller supplies a key. Additive only; legacy runtime still calls the 9-arg
-- vc.create_memory_candidate and leaves the column NULL.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.memory_item
    ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_idempotency_key_check;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_idempotency_key_check
        CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._~-]{1,64}$');

CREATE UNIQUE INDEX IF NOT EXISTS memory_item_idempotency_uidx
    ON vc.memory_item (owner_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION vc.create_memory_candidate_keyed(
    p_owner_user_id    bigint,
    p_relationship_id  bigint,
    p_scope            text,
    p_summary          text,
    p_conversation_id  bigint DEFAULT NULL,
    p_evidence         text[] DEFAULT ARRAY[]::text[],
    p_event_at         timestamptz DEFAULT NULL,
    p_event_status     text DEFAULT NULL,
    p_event_expires_at timestamptz DEFAULT NULL,
    p_idempotency_key  text DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id  bigint;
    v_key text;
BEGIN
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_memory_candidate_keyed: owner_user_id does not match server-trusted current_owner_id';
    END IF;
    v_key := NULL;
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_key := btrim(p_idempotency_key);
        IF v_key !~ '^[A-Za-z0-9._~-]{1,64}$' THEN
            RAISE EXCEPTION 'create_memory_candidate_keyed: idempotency_key is invalid';
        END IF;
        SELECT m.id INTO v_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.idempotency_key = v_key;
        IF FOUND THEN
            RETURN v_id;
        END IF;
    END IF;

    v_id := vc.create_memory_candidate(
        p_owner_user_id, p_relationship_id, p_scope, p_summary,
        p_conversation_id, p_evidence, p_event_at, p_event_status, p_event_expires_at);

    IF v_key IS NOT NULL THEN
        UPDATE vc.memory_item
           SET idempotency_key = v_key
         WHERE owner_user_id = p_owner_user_id AND id = v_id;
    END IF;
    RETURN v_id;
EXCEPTION
    WHEN unique_violation THEN
        SELECT m.id INTO v_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.idempotency_key = v_key;
        IF v_id IS NULL THEN
            RAISE;
        END IF;
        RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.create_memory_candidate_keyed(
    bigint, bigint, text, text, bigint, text[], timestamptz, text, timestamptz, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.create_memory_candidate_keyed(
    bigint, bigint, text, text, bigint, text[], timestamptz, text, timestamptz, text)
    TO vc_api;
