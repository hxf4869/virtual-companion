-- Auto-saved memory summaries join the store-wide encrypt-at-rest convention:
-- the Go store now encrypts the summary with the stored-field cipher before
-- calling vc.create_auto_saved_memory, exactly like the manual candidate path
-- (vc.create_memory_candidate_keyed stores cipher output through
-- vc.create_memory_candidate, which only requires a non-blank summary).
-- The 1..2000-rune ceiling stays enforced by the Go store on the PLAINTEXT
-- before encryption; the SQL-side character ceiling cannot apply to the
-- ciphertext envelope (enc prefix + base64 is longer than the plaintext), so
-- it is replaced with the same non-null/non-blank check the manual candidate
-- path uses. Signature, ownership assertions, idempotency semantics and the
-- vc_api-only grants are unchanged from V125.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.create_auto_saved_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_scope           text,
    p_summary         text,
    p_conversation_id bigint DEFAULT NULL,
    p_evidence        text[] DEFAULT ARRAY[]::text[],
    p_idempotency_key text DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_key text;
    v_evidence text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship_id is required';
    END IF;
    -- p_summary carries the app-layer ciphertext envelope (or legacy
    -- plaintext): non-blank only; length is a Go-store plaintext concern.
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'create_auto_saved_memory: summary is required';
    END IF;
    IF p_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'create_auto_saved_memory: scope % is not enabled in Alpha', p_scope;
    END IF;
    IF p_scope = 'SESSION' AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'create_auto_saved_memory: SESSION scope requires a conversation_id';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id must match server-trusted context';
    END IF;

    v_key := NULL;
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_key := btrim(p_idempotency_key);
        IF v_key !~ '^[A-Za-z0-9._~-]{1,64}$' THEN
            RAISE EXCEPTION 'create_auto_saved_memory: idempotency_key is invalid';
        END IF;
        SELECT m.id INTO v_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.idempotency_key = v_key;
        IF FOUND THEN
            RETURN v_id;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM vc.relationship r
                    WHERE r.owner_user_id = p_owner_user_id
                      AND r.id = p_relationship_id) THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship not found for owner';
    END IF;
    IF p_scope = 'SESSION' THEN
        IF NOT EXISTS (SELECT 1 FROM vc.conversation c
                        WHERE c.owner_user_id = p_owner_user_id
                          AND c.id = p_conversation_id
                          AND c.relationship_id = p_relationship_id) THEN
            RAISE EXCEPTION 'create_auto_saved_memory: conversation not found for owner/relationship';
        END IF;
    END IF;

    v_id := nextval('vc.memory_id_seq');
    INSERT INTO vc.memory_item(
        owner_user_id, id, relationship_id, scope, summary, status,
        conversation_id, auto_saved)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'ACCEPTED', p_conversation_id, true);

    IF p_evidence IS NOT NULL THEN
        FOREACH v_evidence IN ARRAY p_evidence LOOP
            IF v_evidence IS NOT NULL AND btrim(v_evidence) <> '' THEN
                INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref)
                VALUES (p_owner_user_id, nextval('vc.memory_id_seq'), v_id, v_evidence);
            END IF;
        END LOOP;
    END IF;

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

REVOKE EXECUTE ON FUNCTION
    vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[], text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[], text)
    TO vc_api;
