-- UX-36：ST 新对话读取已有账户偏好；幂等重开既有绑定保持原标志。
-- 函数沿用 V141，只替换新建分支的 incognito 参数，不新增存储或接口。

CREATE OR REPLACE FUNCTION vc.resolve_st_binding(
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
        v_conversation_id := vc.create_conversation(p_owner_user_id, v_relationship_id, vc.get_incognito_pref(p_owner_user_id));
        UPDATE vc.conversation SET st_chat_identity = p_chat_identity, st_mode = p_mode
         WHERE owner_user_id = p_owner_user_id AND id = v_conversation_id;
    END IF;

    RETURN QUERY SELECT v_relationship_id, v_conversation_id, p_chat_identity, p_character_ref, p_mode;
END;
$$;
