-- V2-W05: existing relationships are CharacterInstances; conversations carry
-- the stable ST chat binding. ST remains the revision/content authority.
SET search_path TO vc, pg_catalog;

ALTER TABLE vc.relationship
    ADD COLUMN st_character_ref text,
    ADD CONSTRAINT relationship_st_character_ref_nonempty
        CHECK (st_character_ref IS NULL OR btrim(st_character_ref) <> '');

ALTER TABLE vc.conversation
    ADD COLUMN st_chat_identity text,
    ADD COLUMN st_mode text,
    ADD CONSTRAINT conversation_st_binding_complete CHECK (
        (st_chat_identity IS NULL AND st_mode IS NULL)
        OR (st_chat_identity IS NOT NULL AND btrim(st_chat_identity) <> ''
            AND st_mode IS NOT NULL AND st_mode IN ('COMPANION', 'STORY')));

CREATE UNIQUE INDEX conversation_st_chat_identity_per_owner
    ON vc.conversation(owner_user_id, st_chat_identity)
    WHERE st_chat_identity IS NOT NULL;

DROP INDEX vc.relationship_one_active_per_owner;

-- Creating/activating one instance no longer disables any other instance.
CREATE OR REPLACE FUNCTION vc.create_relationship(p_owner_user_id bigint, p_persona_ref text)
    RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_persona_ref IS NULL OR btrim(p_persona_ref) = '' THEN
        RAISE EXCEPTION 'create_relationship: persona_ref is required';
    END IF;
    v_id := nextval('vc.relationship_id_seq');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (p_owner_user_id, v_id, p_persona_ref, true);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.activate_relationship(p_owner_user_id bigint, p_rel_id bigint)
    RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    UPDATE vc.relationship SET active = true
     WHERE owner_user_id = p_owner_user_id AND id = p_rel_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'activate_relationship: relationship not found';
    END IF;
    RETURN true;
END;
$$;

CREATE FUNCTION vc.resolve_st_binding(
    p_owner_user_id bigint,
    p_chat_identity text,
    p_character_ref text,
    p_mode text,
    p_relationship_id bigint,
    p_display_name text
)
    RETURNS TABLE(out_relationship_id bigint, out_conversation_id bigint,
                  out_chat_identity text, out_character_ref text, out_mode text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_relationship_id bigint;
    v_conversation_id bigint;
    v_character_ref text;
    v_mode text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'resolve_st_binding: owner must match server-trusted context';
    END IF;
    IF p_chat_identity IS NULL OR btrim(p_chat_identity) = ''
       OR p_character_ref IS NULL OR btrim(p_character_ref) = ''
       OR p_mode IS NULL OR p_mode NOT IN ('COMPANION', 'STORY')
       OR (p_relationship_id IS NOT NULL AND p_relationship_id <= 0) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'resolve_st_binding: invalid input';
    END IF;

    -- Serialize first resolution using the existing Owner row. A concurrent
    -- retry sees the committed binding before allocating another instance.
    PERFORM 1 FROM vc.vc_user WHERE id = p_owner_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'resolve_st_binding: owner not found';
    END IF;

    SELECT c.relationship_id, c.id, r.st_character_ref, c.st_mode
      INTO v_relationship_id, v_conversation_id, v_character_ref, v_mode
      FROM vc.conversation c
      JOIN vc.relationship r ON (r.owner_user_id, r.id) = (c.owner_user_id, c.relationship_id)
     WHERE c.owner_user_id = p_owner_user_id AND c.st_chat_identity = p_chat_identity
     FOR UPDATE OF c, r;
    IF FOUND THEN
        IF v_character_ref IS DISTINCT FROM p_character_ref
           OR v_mode IS DISTINCT FROM p_mode
           OR (p_relationship_id IS NOT NULL AND p_relationship_id <> v_relationship_id) THEN
            RAISE EXCEPTION 'resolve_st_binding: conflict';
        END IF;
    ELSE
        IF p_relationship_id IS NULL THEN
            v_relationship_id := vc.create_relationship(p_owner_user_id, 'st-character');
            UPDATE vc.relationship
               SET st_character_ref = p_character_ref,
                   companion_name = NULLIF(btrim(p_display_name), '')
             WHERE owner_user_id = p_owner_user_id AND id = v_relationship_id;
        ELSE
            SELECT r.st_character_ref INTO v_character_ref
              FROM vc.relationship r
             WHERE r.owner_user_id = p_owner_user_id AND r.id = p_relationship_id
             FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'resolve_st_binding: relationship not found';
            END IF;
            IF v_character_ref IS DISTINCT FROM p_character_ref THEN
                RAISE EXCEPTION 'resolve_st_binding: conflict';
            END IF;
            v_relationship_id := p_relationship_id;
        END IF;
        v_conversation_id := vc.create_conversation(p_owner_user_id, v_relationship_id, false);
        UPDATE vc.conversation SET st_chat_identity = p_chat_identity, st_mode = p_mode
         WHERE owner_user_id = p_owner_user_id AND id = v_conversation_id;
    END IF;

    RETURN QUERY SELECT v_relationship_id, v_conversation_id, p_chat_identity, p_character_ref, p_mode;
END;
$$;

REVOKE ALL ON FUNCTION vc.resolve_st_binding(bigint, text, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.resolve_st_binding(bigint, text, text, text, bigint, text) TO vc_api;
REVOKE ALL ON FUNCTION vc.create_relationship(bigint, text), vc.activate_relationship(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.create_relationship(bigint, text), vc.activate_relationship(bigint, bigint) TO vc_api;
