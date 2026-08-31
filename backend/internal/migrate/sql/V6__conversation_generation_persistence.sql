-- TASK-0017 V6: idempotent generation reception.
--
-- Extends vc.generation with a per-owner idempotency key and monotonic id
-- sequences, and adds the SECURITY DEFINER vc.receive_generation entry point.
-- A retried logical request (same owner + idempotency_key) always resolves to
-- the SAME logical_generation_id and never creates a second user message; the
-- first reception atomically creates the generation row and the user message.
-- INV-GEN-001 (one logical request -> one stable generation id).
--
-- Composite ownership is unchanged: vc.generation.(owner_user_id, conversation_id)
-- still references vc.conversation(owner_user_id, id), so a generation can never
-- point at another owner's conversation (proven by SQL test 15). receive_generation
-- runs DEFINER-style and binds vc.owner_user_id for the transaction so FORCE RLS
-- keeps binding; it also enforces the owner explicitly as defense in depth.

SET search_path TO vc, public;

-- Client-supplied per-owner stable key for idempotent reception. NULL means
-- "no dedup handle": every such call creates a fresh generation and the partial
-- unique index below intentionally ignores NULL keys.
ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS idempotency_key text;

-- At most one generation per (owner, idempotency_key) when a key is supplied.
-- This is the structural backstop for receive_generation's idempotent ON
-- CONFLICT path; it also makes concurrent first-receptions for one key collide
-- safely instead of producing two logical generations.
CREATE UNIQUE INDEX IF NOT EXISTS generation_idempotency_key_uniq
    ON vc.generation (owner_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Monotonic bigint sequences back the composite (owner_user_id, id) primary
-- keys of vc.generation and vc.message so receive_generation allocates ids
-- atomically without an application round-trip. A single global sequence per
-- table is safe under a composite key and keeps ids monotonic per table.
CREATE SEQUENCE IF NOT EXISTS vc.generation_id_seq AS bigint;
CREATE SEQUENCE IF NOT EXISTS vc.message_id_seq AS bigint;

-- Idempotent generation reception. SECURITY DEFINER so the definer performs the
-- vc.generation / vc.message inserts; the caller stays isolated by FORCE RLS via
-- the owner_user_id predicate. Returns one row:
--   logical_generation_id : stable id for this logical request (reused on retry)
--   generation_id         : bigint primary key of the generation row
--   message_id            : bigint primary key of the user message (NULL on retry)
--   created               : true on first reception, false on a duplicate
CREATE OR REPLACE FUNCTION vc.receive_generation(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_idempotency_key text,
    p_user_role       text DEFAULT 'user',
    p_user_content    text DEFAULT ''
)
    RETURNS TABLE(logical_generation_id text, generation_id bigint,
                  message_id bigint, created boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_logical text;
    v_gen_id  bigint;
    v_msg_id  bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'owner_user_id is required to receive a generation';
    END IF;
    IF p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_id is required to receive a generation';
    END IF;
    -- Bind tenant context so the FORCE RLS WITH CHECK predicate
    -- (owner_user_id = vc.current_owner_id()) passes for the definer, and so
    -- reads in the same transaction stay scoped to this owner.
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

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
             status, idempotency_key)
        VALUES
            (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
             'CREATED', p_idempotency_key)
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
        -- logical_generation_id and create NO new message. Columns are
        -- alias-qualified to avoid any output-column name shadowing.
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
         status, idempotency_key)
    VALUES
        (p_owner_user_id, v_gen_id, p_conversation_id, v_logical, 'CREATED', NULL);
    INSERT INTO vc.message
        (owner_user_id, id, conversation_id, role, content)
    VALUES
        (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
    RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
END;
$$;

-- Runtime roles may use the sequences for any direct allocation path (the
-- SECURITY DEFINER function needs no grant; it runs as the definer).
GRANT USAGE, SELECT ON SEQUENCE vc.generation_id_seq, vc.message_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- The function defaults to PUBLIC EXECUTE. Revoke it so only the API ingestion
-- role may call receive_generation; this closes the function-bypass of the
-- table-level path exactly as the TASK-0016 V5 claim functions do.
REVOKE EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.receive_generation(bigint, bigint, text, text, text)
    TO vc_api;
