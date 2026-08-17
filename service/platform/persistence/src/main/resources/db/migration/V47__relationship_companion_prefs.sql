-- COMP-CFG V47: structured Companion preferences (FR-COMP-003).
--
-- Role settings must be structured fields mapped to approved prompt fragments,
-- never a free-form user Prompt. Columns live on vc.relationship (1:1 with the
-- Companion) with catalog CHECKs and Alpha defaults matching gentle-listener.
-- get/list are DROP+CREATE to surface the new OUT columns; updates go through
-- vc.update_relationship_prefs (V17 trusted-owner, existence hidden).

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.relationship
    ADD COLUMN IF NOT EXISTS companion_name text,
    ADD COLUMN IF NOT EXISTS user_address_as text,
    ADD COLUMN IF NOT EXISTS reply_length text NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN IF NOT EXISTS initiative text NOT NULL DEFAULT 'LOW',
    ADD COLUMN IF NOT EXISTS humor text NOT NULL DEFAULT 'LIGHT',
    ADD COLUMN IF NOT EXISTS advice_pref text NOT NULL DEFAULT 'ASK_FIRST',
    ADD COLUMN IF NOT EXISTS reminders_allowed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS memory_share_scope text NOT NULL DEFAULT 'RELATIONSHIP',
    ADD COLUMN IF NOT EXISTS avoid_topics text NOT NULL DEFAULT '';

ALTER TABLE vc.relationship
    DROP CONSTRAINT IF EXISTS relationship_companion_name_len,
    DROP CONSTRAINT IF EXISTS relationship_user_address_as_len,
    DROP CONSTRAINT IF EXISTS relationship_reply_length_chk,
    DROP CONSTRAINT IF EXISTS relationship_initiative_chk,
    DROP CONSTRAINT IF EXISTS relationship_humor_chk,
    DROP CONSTRAINT IF EXISTS relationship_advice_pref_chk,
    DROP CONSTRAINT IF EXISTS relationship_memory_share_scope_chk;

ALTER TABLE vc.relationship
    ADD CONSTRAINT relationship_companion_name_len
        CHECK (companion_name IS NULL OR char_length(companion_name) BETWEEN 1 AND 32),
    ADD CONSTRAINT relationship_user_address_as_len
        CHECK (user_address_as IS NULL OR char_length(user_address_as) BETWEEN 1 AND 32),
    ADD CONSTRAINT relationship_reply_length_chk
        CHECK (reply_length IN ('SHORT', 'MEDIUM', 'LONG')),
    ADD CONSTRAINT relationship_initiative_chk
        CHECK (initiative IN ('LOW', 'MEDIUM', 'HIGH')),
    ADD CONSTRAINT relationship_humor_chk
        CHECK (humor IN ('NONE', 'LIGHT', 'WARM')),
    ADD CONSTRAINT relationship_advice_pref_chk
        CHECK (advice_pref IN ('ASK_FIRST', 'DIRECT', 'RARE')),
    ADD CONSTRAINT relationship_memory_share_scope_chk
        CHECK (memory_share_scope IN ('SESSION', 'RELATIONSHIP'));

-- ---------------------------------------------------------------------------
-- update_relationship_prefs: full replace of structured preferences for one
-- owned relationship. Returns TRUE only when an owned row changed; a foreign
-- or absent id returns FALSE (existence is never disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.update_relationship_prefs(
    p_owner_user_id     bigint,
    p_rel_id            bigint,
    p_companion_name    text,
    p_user_address_as   text,
    p_reply_length      text,
    p_initiative        text,
    p_humor             text,
    p_advice_pref       text,
    p_reminders_allowed boolean,
    p_memory_share_scope text,
    p_avoid_topics      text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_name text;
    v_addr text;
    v_topics text := '';
    v_code text;
    v_rows int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'update_relationship_prefs: owner_user_id is required';
    END IF;
    IF p_rel_id IS NULL OR p_rel_id <= 0 THEN
        RAISE EXCEPTION 'update_relationship_prefs: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'update_relationship_prefs: owner_user_id must match server-trusted context';
    END IF;
    IF p_reply_length IS NULL OR p_reply_length NOT IN ('SHORT', 'MEDIUM', 'LONG') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved reply_length';
    END IF;
    IF p_initiative IS NULL OR p_initiative NOT IN ('LOW', 'MEDIUM', 'HIGH') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved initiative';
    END IF;
    IF p_humor IS NULL OR p_humor NOT IN ('NONE', 'LIGHT', 'WARM') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved humor';
    END IF;
    IF p_advice_pref IS NULL OR p_advice_pref NOT IN ('ASK_FIRST', 'DIRECT', 'RARE') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved advice_pref';
    END IF;
    IF p_reminders_allowed IS NULL THEN
        RAISE EXCEPTION 'update_relationship_prefs: reminders_allowed is required';
    END IF;
    IF p_memory_share_scope IS NULL
       OR p_memory_share_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved memory_share_scope';
    END IF;

    v_name := NULLIF(btrim(COALESCE(p_companion_name, '')), '');
    v_addr := NULLIF(btrim(COALESCE(p_user_address_as, '')), '');
    IF v_name IS NOT NULL THEN
        IF char_length(v_name) > 32 OR v_name ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'update_relationship_prefs: invalid companion_name';
        END IF;
    END IF;
    IF v_addr IS NOT NULL THEN
        IF char_length(v_addr) > 32 OR v_addr ~ '[[:cntrl:]]' THEN
            RAISE EXCEPTION 'update_relationship_prefs: invalid user_address_as';
        END IF;
    END IF;

    IF p_avoid_topics IS NOT NULL AND btrim(p_avoid_topics) <> '' THEN
        SELECT string_agg(DISTINCT btrim(t), ',' ORDER BY btrim(t))
          INTO v_topics
          FROM unnest(string_to_array(p_avoid_topics, ',')) AS t
         WHERE btrim(t) <> '';
        IF v_topics IS NULL THEN
            v_topics := '';
        END IF;
        FOREACH v_code IN ARRAY string_to_array(v_topics, ',')
        LOOP
            IF v_code NOT IN (
                'WORK', 'FAMILY', 'HEALTH', 'ROMANCE',
                'MONEY', 'POLITICS', 'SUBSTANCE', 'RELIGION'
            ) THEN
                RAISE EXCEPTION 'update_relationship_prefs: unapproved avoid topic';
            END IF;
        END LOOP;
    END IF;

    UPDATE vc.relationship
       SET companion_name = v_name,
           user_address_as = v_addr,
           reply_length = p_reply_length,
           initiative = p_initiative,
           humor = p_humor,
           advice_pref = p_advice_pref,
           reminders_allowed = p_reminders_allowed,
           memory_share_scope = p_memory_share_scope,
           avoid_topics = v_topics
     WHERE owner_user_id = p_owner_user_id
       AND id = p_rel_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.update_relationship_prefs(
    bigint, bigint, text, text, text, text, text, text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.update_relationship_prefs(
    bigint, bigint, text, text, text, text, text, text, boolean, text, text) TO vc_api;

-- PostgreSQL forbids CREATE OR REPLACE across a changed OUT row type.
DROP FUNCTION IF EXISTS vc.get_relationship(bigint, bigint);
DROP FUNCTION IF EXISTS vc.list_relationships(bigint);

CREATE OR REPLACE FUNCTION vc.get_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS TABLE(
        out_id bigint,
        out_persona_ref text,
        out_active boolean,
        out_created_at timestamptz,
        out_companion_name text,
        out_user_address_as text,
        out_reply_length text,
        out_initiative text,
        out_humor text,
        out_advice_pref text,
        out_reminders_allowed boolean,
        out_memory_share_scope text,
        out_avoid_topics text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_rel_id IS NULL THEN
        RAISE EXCEPTION 'get_relationship: owner_user_id and relationship id are required';
    END IF;
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at,
               r.companion_name, r.user_address_as, r.reply_length,
               r.initiative, r.humor, r.advice_pref, r.reminders_allowed,
               r.memory_share_scope, r.avoid_topics
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
           AND r.id = p_rel_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.list_relationships(
    p_owner_user_id bigint
)
    RETURNS TABLE(
        out_id bigint,
        out_persona_ref text,
        out_active boolean,
        out_created_at timestamptz,
        out_companion_name text,
        out_user_address_as text,
        out_reply_length text,
        out_initiative text,
        out_humor text,
        out_advice_pref text,
        out_reminders_allowed boolean,
        out_memory_share_scope text,
        out_avoid_topics text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at,
               r.companion_name, r.user_address_as, r.reply_length,
               r.initiative, r.humor, r.advice_pref, r.reminders_allowed,
               r.memory_share_scope, r.avoid_topics
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
         ORDER BY r.created_at, r.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.get_relationship(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_relationships(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.get_relationship(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_relationships(bigint) TO vc_api;
