-- CHAT-MODE V51: add CASUAL to the approved turn-level interaction modes
-- (FR-CHAT-002). The V34 CHECK and receive_generation normalizer only knew
-- AUTO/LISTEN/DISCUSS; CASUAL is the product "轻松日常" stance. Unapproved
-- codes still fall back to AUTO for direct callers; the HTTP layer keeps
-- rejecting unknown values with 400.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.generation DROP CONSTRAINT IF EXISTS generation_mode_check;
ALTER TABLE vc.generation
    ADD CONSTRAINT generation_mode_check
        CHECK (mode IN ('AUTO', 'LISTEN', 'DISCUSS', 'CASUAL'));

CREATE OR REPLACE FUNCTION vc.receive_generation(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_idempotency_key text,
    p_user_role       text DEFAULT 'user',
    p_user_content    text DEFAULT '',
    p_mode            text DEFAULT 'AUTO'
)
    RETURNS TABLE(logical_generation_id text, generation_id bigint,
                  message_id bigint, created boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_logical text;
    v_gen_id  bigint;
    v_msg_id  bigint;
    v_mode    text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_id is required to receive a generation';
    END IF;

    v_mode := CASE
        WHEN p_mode IN ('AUTO', 'LISTEN', 'DISCUSS', 'CASUAL') THEN p_mode
        ELSE 'AUTO'
    END;

    IF p_idempotency_key IS NOT NULL THEN
        v_logical := 'gen_' || gen_random_uuid()::text;
        v_gen_id  := nextval('vc.generation_id_seq');
        INSERT INTO vc.generation
            (owner_user_id, id, conversation_id, logical_generation_id,
             status, idempotency_key, mode)
        VALUES
            (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
             'CREATED', p_idempotency_key, v_mode)
        ON CONFLICT (owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
        DO NOTHING;

        IF FOUND THEN
            v_msg_id := nextval('vc.message_id_seq');
            INSERT INTO vc.message
                (owner_user_id, id, conversation_id, role, content)
            VALUES
                (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
            RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
            RETURN;
        END IF;

        SELECT g.logical_generation_id, g.id INTO v_logical, v_gen_id
          FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT v_logical, v_gen_id, NULL::bigint, false;
        RETURN;
    END IF;

    v_gen_id  := nextval('vc.generation_id_seq');
    v_logical := 'gen_' || gen_random_uuid()::text;
    v_msg_id  := nextval('vc.message_id_seq');
    INSERT INTO vc.generation
        (owner_user_id, id, conversation_id, logical_generation_id,
         status, idempotency_key, mode)
    VALUES
        (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
         'CREATED', NULL, v_mode);
    INSERT INTO vc.message
        (owner_user_id, id, conversation_id, role, content)
    VALUES
        (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
    RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text)
    TO vc_api;
