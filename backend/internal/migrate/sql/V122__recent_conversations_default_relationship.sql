-- Frontend redo Phase A: reliable recent-conversation ordering and the one
-- product-approved default relationship. These are the two backend facts used
-- by Home / All Conversations and the post-authenticator admission path.

SET search_path TO vc, pg_catalog;

-- The list reads the newest message of each conversation. The original V30
-- query had no matching index, so recent-first ordering would otherwise scan a
-- caller's message history repeatedly.
CREATE INDEX IF NOT EXISTS message_conversation_latest_idx
    ON vc.message (owner_user_id, conversation_id, id DESC);

-- Keep the existing cursor shape (`after` is a conversation id), but resolve
-- that id to the same (last_activity_at, conversation_id) tuple used for
-- ordering. This changes the old id-ascending semantics without adding a
-- second pagination API.
DROP FUNCTION IF EXISTS vc.list_conversations(bigint, bigint, bigint, integer);

CREATE FUNCTION vc.list_conversations(
    p_owner_user_id   bigint,
    p_relationship_id bigint DEFAULT NULL,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(
        out_id bigint,
        out_relationship_id bigint,
        out_created_at timestamptz,
        out_last_message_role text,
        out_last_message_preview text,
        out_title text,
        out_incognito boolean,
        out_last_activity_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_after_activity timestamptz;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 THEN
        p_limit := 50;
    END IF;
    IF p_limit > 100 THEN
        p_limit := 100;
    END IF;
    IF p_after_id IS NULL THEN
        p_after_id := 0;
    END IF;

    IF p_after_id <> 0 THEN
        SELECT COALESCE(lm.created_at, c.created_at)
          INTO v_after_activity
          FROM vc.conversation c
          LEFT JOIN LATERAL (
              SELECT m.created_at
                FROM vc.message m
               WHERE m.owner_user_id = c.owner_user_id
                 AND m.conversation_id = c.id
               ORDER BY m.id DESC
               LIMIT 1
          ) lm ON true
         WHERE c.owner_user_id = p_owner_user_id
           AND c.id = p_after_id
           AND (p_relationship_id IS NULL OR c.relationship_id = p_relationship_id);
        IF NOT FOUND THEN
            RETURN;
        END IF;
    END IF;

    RETURN QUERY
        SELECT c.id,
               c.relationship_id,
               c.created_at,
               lm.role,
               left(lm.content, 200),
               c.title,
               c.incognito,
               COALESCE(lm.created_at, c.created_at)
          FROM vc.conversation c
          LEFT JOIN LATERAL (
              SELECT m.role, m.content, m.created_at
                FROM vc.message m
               WHERE m.owner_user_id = c.owner_user_id
                 AND m.conversation_id = c.id
               ORDER BY m.id DESC
               LIMIT 1
          ) lm ON true
         WHERE c.owner_user_id = p_owner_user_id
           AND (p_relationship_id IS NULL OR c.relationship_id = p_relationship_id)
           AND (p_after_id = 0
                OR (COALESCE(lm.created_at, c.created_at), c.id)
                   < (v_after_activity, p_after_id))
         ORDER BY COALESCE(lm.created_at, c.created_at) DESC, c.id DESC
         LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION vc.list_conversations(bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_conversations(bigint, bigint, bigint, integer) TO vc_api;

-- Idempotently return the account's active relationship. For existing accounts
-- an inactive relationship is reactivated instead of creating a duplicate;
-- accounts with no relationship receive the product's single default persona.
CREATE FUNCTION vc.ensure_default_relationship(
    p_owner_user_id bigint,
    p_persona_ref text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_persona_ref text := btrim(p_persona_ref);
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'ensure_default_relationship: owner is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'ensure_default_relationship: owner must match server-trusted context';
    END IF;
    IF v_persona_ref IS NULL OR v_persona_ref = '' THEN
        RAISE EXCEPTION 'ensure_default_relationship: persona is required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.relationship.active:' || p_owner_user_id::text));

    SELECT r.id INTO v_id
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.active
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
        RETURN v_id;
    END IF;

    SELECT r.id INTO v_id
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner_user_id
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT 1
     FOR UPDATE;
    IF FOUND THEN
        UPDATE vc.relationship
           SET active = true
         WHERE owner_user_id = p_owner_user_id
           AND id = v_id;
        RETURN v_id;
    END IF;

    v_id := nextval('vc.relationship_id_seq');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (p_owner_user_id, v_id, v_persona_ref, true);
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.ensure_default_relationship(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.ensure_default_relationship(bigint, text) TO vc_api;

DO $$
BEGIN
    IF to_regprocedure('vc.list_conversations(bigint,bigint,bigint,integer)') IS NULL
       OR to_regprocedure('vc.ensure_default_relationship(bigint,text)') IS NULL THEN
        RAISE EXCEPTION 'V122: required function is missing';
    END IF;
    IF has_function_privilege('public',
            'vc.list_conversations(bigint,bigint,bigint,integer)', 'EXECUTE')
       OR has_function_privilege('public',
            'vc.ensure_default_relationship(bigint,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V122: public execute must stay revoked';
    END IF;
END;
$$;
