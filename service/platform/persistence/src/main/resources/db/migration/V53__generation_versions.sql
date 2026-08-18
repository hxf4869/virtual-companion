-- GEN-VER V53: generation versions for one user message (FR-CHAT-003).
-- Save every generation; the UI default is the selected version. A regenerate
-- reuses the original user message (no second user row) and does not rewrite
-- the first reception's mode / idempotency key. Only CONTINUED-style: the
-- selected flag is a system fact. Memory extract of a regenerate is skipped
-- in the worker when a completed sibling already exists.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS source_user_message_id bigint;
ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'generation_source_user_message_fk'
           AND conrelid = 'vc.generation'::regclass
    ) THEN
        ALTER TABLE vc.generation
            ADD CONSTRAINT generation_source_user_message_fk
            FOREIGN KEY (owner_user_id, source_user_message_id)
            REFERENCES vc.message(owner_user_id, id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS generation_one_selected_per_source
    ON vc.generation (owner_user_id, source_user_message_id)
    WHERE selected AND source_user_message_id IS NOT NULL;

-- First-send path: same 6-arg contract, but stamp source_user_message_id so
-- later regenerates can group versions. Existing SQL tests keep calling this.
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
             status, idempotency_key, mode, selected)
        VALUES
            (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
             'CREATED', p_idempotency_key, v_mode, true)
        ON CONFLICT (owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
        DO NOTHING;

        IF FOUND THEN
            v_msg_id := nextval('vc.message_id_seq');
            INSERT INTO vc.message
                (owner_user_id, id, conversation_id, role, content)
            VALUES
                (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
            UPDATE vc.generation
               SET source_user_message_id = v_msg_id
             WHERE owner_user_id = p_owner_user_id AND id = v_gen_id;
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
         status, idempotency_key, mode, selected)
    VALUES
        (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
         'CREATED', NULL, v_mode, true);
    INSERT INTO vc.message
        (owner_user_id, id, conversation_id, role, content)
    VALUES
        (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
    UPDATE vc.generation
       SET source_user_message_id = v_msg_id
     WHERE owner_user_id = p_owner_user_id AND id = v_gen_id;
    RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
END;
$$;

-- Regenerate: reuse an existing user message, do not insert a second user row.
CREATE OR REPLACE FUNCTION vc.receive_generation(
    p_owner_user_id          bigint,
    p_conversation_id        bigint,
    p_idempotency_key        text,
    p_user_role              text,
    p_user_content           text,
    p_mode                   text,
    p_source_user_message_id bigint
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
    v_mode    text;
    v_conv    bigint;
    v_role    text;
BEGIN
    IF p_source_user_message_id IS NULL THEN
        RETURN QUERY
            SELECT * FROM vc.receive_generation(
                p_owner_user_id, p_conversation_id, p_idempotency_key,
                p_user_role, p_user_content, p_mode);
        RETURN;
    END IF;

    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_id is required to receive a generation';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'receive_generation: idempotency_key is required to regenerate';
    END IF;

    v_mode := CASE
        WHEN p_mode IN ('AUTO', 'LISTEN', 'DISCUSS', 'CASUAL') THEN p_mode
        ELSE 'AUTO'
    END;

    SELECT m.conversation_id, m.role
      INTO v_conv, v_role
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.id = p_source_user_message_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'receive_generation: source user message not found';
    END IF;
    IF v_conv IS DISTINCT FROM p_conversation_id OR v_role IS DISTINCT FROM 'user' THEN
        RAISE EXCEPTION 'receive_generation: source user message not found';
    END IF;

    v_logical := 'gen_' || gen_random_uuid()::text;
    v_gen_id  := nextval('vc.generation_id_seq');
    INSERT INTO vc.generation
        (owner_user_id, id, conversation_id, logical_generation_id,
         status, idempotency_key, mode, source_user_message_id, selected)
    VALUES
        (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
         'CREATED', p_idempotency_key, v_mode, p_source_user_message_id, false)
    ON CONFLICT (owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT g.logical_generation_id, g.id INTO v_logical, v_gen_id
          FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT v_logical, v_gen_id, NULL::bigint, false;
        RETURN;
    END IF;

    UPDATE vc.generation
       SET selected = false
     WHERE owner_user_id = p_owner_user_id
       AND source_user_message_id = p_source_user_message_id
       AND id IS DISTINCT FROM v_gen_id
       AND selected;
    UPDATE vc.generation
       SET selected = true
     WHERE owner_user_id = p_owner_user_id AND id = v_gen_id;

    RETURN QUERY SELECT v_logical, v_gen_id, p_source_user_message_id, true;
END;
$$;

CREATE OR REPLACE FUNCTION vc.list_generation_versions(
    p_owner_user_id          bigint,
    p_source_user_message_id bigint
)
    RETURNS TABLE(
        out_generation_id        bigint,
        out_selected             boolean,
        out_status               text,
        out_created_at           timestamptz,
        out_assistant_message_id bigint
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_generation_versions: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_generation_versions: owner_user_id must match server-trusted context';
    END IF;
    IF p_source_user_message_id IS NULL OR p_source_user_message_id <= 0 THEN
        RAISE EXCEPTION 'list_generation_versions: source_user_message_id is required';
    END IF;

    RETURN QUERY
        SELECT g.id,
               g.selected,
               g.status,
               g.created_at,
               (
                   SELECT m.id
                     FROM vc.message m
                    WHERE m.owner_user_id = g.owner_user_id
                      AND m.generation_id = g.id
                      AND m.role = 'assistant'
                    ORDER BY m.id
                    LIMIT 1
               )
          FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.source_user_message_id = p_source_user_message_id
         ORDER BY g.id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.select_generation_version(
    p_owner_user_id bigint,
    p_generation_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_source bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'select_generation_version: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'select_generation_version: owner_user_id must match server-trusted context';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'select_generation_version: generation_id is required';
    END IF;

    SELECT source_user_message_id INTO v_source
      FROM vc.generation
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
    IF NOT FOUND OR v_source IS NULL THEN
        RETURN FALSE;
    END IF;

    UPDATE vc.generation
       SET selected = false
     WHERE owner_user_id = p_owner_user_id
       AND source_user_message_id = v_source
       AND selected
       AND id IS DISTINCT FROM p_generation_id;
    UPDATE vc.generation
       SET selected = true
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.list_messages(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_role text,
                  out_content text, out_created_at timestamptz,
                  out_no_memory boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'list_messages: owner_user_id and conversation_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_messages: owner_user_id must match server-trusted context';
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

    -- FR-CHAT-003: default history shows only the selected assistant version.
    RETURN QUERY
        SELECT m.id, m.role, m.content, m.created_at, m.no_memory
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.conversation_id = p_conversation_id
           AND m.id > p_after_id
           AND (
                m.role IS DISTINCT FROM 'assistant'
                OR m.generation_id IS NULL
                OR EXISTS (
                    SELECT 1
                      FROM vc.generation g
                     WHERE g.owner_user_id = m.owner_user_id
                       AND g.id = m.generation_id
                       AND g.selected
                )
           )
         ORDER BY m.id
         LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_generation_versions(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.select_generation_version(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_messages(bigint, bigint, bigint, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text),
    vc.receive_generation(bigint, bigint, text, text, text, text, bigint),
    vc.list_generation_versions(bigint, bigint),
    vc.select_generation_version(bigint, bigint),
    vc.list_messages(bigint, bigint, bigint, integer)
    TO vc_api;
