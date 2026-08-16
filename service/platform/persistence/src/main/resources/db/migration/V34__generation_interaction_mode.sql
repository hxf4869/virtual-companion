-- CHAT-MODE V34: turn-level interaction mode on vc.generation.
--
-- Adds vc.generation.mode ('AUTO' | 'LISTEN' | 'DISCUSS', default 'AUTO') and
-- extends vc.receive_generation with p_mode (default 'AUTO'). The first
-- reception freezes the mode on the row; a duplicate reception with the same
-- idempotency key resolves to the existing row and NEVER rewrites the mode
-- (rejoin keeps the first reception's mode, INV-GEN-001).
--
-- The SD function normalizes unknown modes to 'AUTO' as defense in depth for
-- direct callers; the API layer rejects invalid modes eagerly with a 400
-- (fail-closed toward the persona default stance, never toward an unapproved
-- mode). AUTO means the persona's default mode rules (gentle-listener: LISTEN).

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'AUTO';

-- Idempotent CHECK constraint (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'generation_mode_check'
           AND conrelid = 'vc.generation'::regclass
    ) THEN
        ALTER TABLE vc.generation ADD CONSTRAINT generation_mode_check
            CHECK (mode IN ('AUTO', 'LISTEN', 'DISCUSS'));
    END IF;
END
$$;

-- Drop the 5-arg V17 signature; the 6-arg replacement keeps a DEFAULT on the
-- new parameter so legacy positional callers (5 args, e.g. SQL tests) keep
-- working unchanged.
DROP FUNCTION IF EXISTS vc.receive_generation(bigint, bigint, text, text, text);

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

    -- CHAT-MODE: normalize to the three approved codes; anything else falls
    -- back to AUTO (the persona default stance) rather than an unapproved mode.
    v_mode := CASE
        WHEN p_mode IN ('AUTO', 'LISTEN', 'DISCUSS') THEN p_mode
        ELSE 'AUTO'
    END;

    IF p_idempotency_key IS NOT NULL THEN
        -- Pre-compute the stable logical id + primary key so the INSERT needs no
        -- RETURNING (the RETURNS TABLE output column names would otherwise
        -- shadow the table columns inside the function body). First reception
        -- races to insert; ON CONFLICT DO NOTHING turns a concurrent or duplicate
        -- first-reception into a no-op, detected via FOUND.
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
            -- Won the race: this is the first reception. Create the user message.
            v_msg_id := nextval('vc.message_id_seq');
            INSERT INTO vc.message
                (owner_user_id, id, conversation_id, role, content)
            VALUES
                (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
            RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
            RETURN;
        END IF;

        -- Duplicate reception (same owner + key): resolve the existing stable
        -- logical_generation_id and create NO new message; the first
        -- reception's mode stays frozen on the row. Columns are alias-qualified
        -- to avoid any output-column name shadowing.
        SELECT g.logical_generation_id, g.id INTO v_logical, v_gen_id
          FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT v_logical, v_gen_id, NULL::bigint, false;
        RETURN;
    END IF;

    -- No idempotency key: always create a fresh generation and user message.
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

-- The replacement drops the old signature's grants with it. Re-apply the same
-- closed-by-default posture as V6/V17: only vc_api may execute.
REVOKE EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text, text)
    TO vc_api;
