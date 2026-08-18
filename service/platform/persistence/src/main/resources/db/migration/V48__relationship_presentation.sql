-- COMP-PRES V48: companion gender presentation and curated avatar
-- (FR-COMP-002).
--
-- Gender presentation is separate from the persona template: FEMALE/MALE/NEUTRAL
-- are visual/name/appellation presentation only and never change the shared
-- behavior, safety or memory rules. Every companion stays an adult role (fixed
-- product invariant, not user-configurable). avatar_ref may only reference the
-- platform-curated companion-presentation avatar catalog; real-person photo
-- upload is not supported in v1. get/list are DROP+CREATE to surface the new
-- OUT columns; updates go through vc.update_relationship_prefs (V17
-- trusted-owner, existence hidden).

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.relationship
    ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'NEUTRAL',
    ADD COLUMN IF NOT EXISTS avatar_ref text NOT NULL DEFAULT 'AVATAR_NEUTRAL_01';

ALTER TABLE vc.relationship
    DROP CONSTRAINT IF EXISTS relationship_gender_chk,
    DROP CONSTRAINT IF EXISTS relationship_avatar_ref_chk;

ALTER TABLE vc.relationship
    ADD CONSTRAINT relationship_gender_chk
        CHECK (gender IN ('FEMALE', 'MALE', 'NEUTRAL')),
    ADD CONSTRAINT relationship_avatar_ref_chk
        CHECK (avatar_ref IN ('AVATAR_FEMALE_01', 'AVATAR_MALE_01', 'AVATAR_NEUTRAL_01'));

-- ---------------------------------------------------------------------------
-- update_relationship_prefs: full replace of structured configuration for one
-- owned relationship (behavioral prefs plus presentation fields). Returns TRUE
-- only when an owned row changed; a foreign or absent id returns FALSE
-- (existence is never disclosed).
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
    p_avoid_topics      text,
    p_gender            text,
    p_avatar_ref        text
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
    IF p_gender IS NULL OR p_gender NOT IN ('FEMALE', 'MALE', 'NEUTRAL') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved gender';
    END IF;
    IF p_avatar_ref IS NULL
       OR p_avatar_ref NOT IN ('AVATAR_FEMALE_01', 'AVATAR_MALE_01', 'AVATAR_NEUTRAL_01') THEN
        RAISE EXCEPTION 'update_relationship_prefs: unapproved avatar_ref';
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
           avoid_topics = v_topics,
           gender = p_gender,
           avatar_ref = p_avatar_ref
     WHERE owner_user_id = p_owner_user_id
       AND id = p_rel_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.update_relationship_prefs(
    bigint, bigint, text, text, text, text, text, text, boolean, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.update_relationship_prefs(
    bigint, bigint, text, text, text, text, text, text, boolean, text, text, text, text) TO vc_api;

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
        out_avoid_topics text,
        out_gender text,
        out_avatar_ref text
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
               r.memory_share_scope, r.avoid_topics, r.gender, r.avatar_ref
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
        out_avoid_topics text,
        out_gender text,
        out_avatar_ref text
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
               r.memory_share_scope, r.avoid_topics, r.gender, r.avatar_ref
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
         ORDER BY r.created_at, r.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.get_relationship(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_relationships(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.get_relationship(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_relationships(bigint) TO vc_api;