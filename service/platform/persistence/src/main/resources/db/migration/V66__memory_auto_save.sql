-- MEM-AUTO-SAVE V66: deterministic low-sensitivity memory auto-save (§7.4
-- 记忆自动保存仅限低敏、高置信且可随时撤销的类别; §11.10 PROPOSED --> ACCEPTED
-- 仅 Beta 后允许的低敏自动规则).
--
-- Three pieces:
--   * memory_item.auto_saved — every auto-saved row is MARKED so the UI can
--     明示哪些条目是自动保存 (and every marked row stays individually
--     deletable / editable — 可随时撤销);
--   * vc.create_auto_saved_memory — the second (and only other) path to
--     canonical ACCEPTED memory. It carries the same guards as
--     create_memory_candidate (owner/relationship/conversation binding,
--     evidence chain) but inserts ACCEPTED + auto_saved=true. WHICH rows may
--     take this path is decided by the deterministic whitelist rule in the
--     Java worker (fixed low-sensitivity categories + a sensitive-lexicon
--     screen; no model judgement — §11.8 模型不能直接写正式记忆 is kept:
--     the caller is the deterministic extraction handler, never the model);
--   * vc.memory_auto_save_pref + get/set — the per-owner kill switch
--     (default ON: §7.4 lists auto-save as the Beta baseline; the owner can
--     turn it off at any time).
--
-- list_memory/get_memory gain out_auto_saved (DROP + CREATE: the OUT shape
-- changes), pinned to search_path vc, pg_catalog (test 57 gate).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- Marking + preference table.
-- ---------------------------------------------------------------------------
ALTER TABLE vc.memory_item
    ADD COLUMN IF NOT EXISTS auto_saved boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS vc.memory_auto_save_pref (
    owner_user_id bigint   PRIMARY KEY,
    enabled       boolean  NOT NULL DEFAULT true,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

ALTER TABLE vc.memory_auto_save_pref ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memory_auto_save_pref FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.memory_auto_save_pref;
CREATE POLICY owner_isolation ON vc.memory_auto_save_pref FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.memory_auto_save_pref
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- create_auto_saved_memory: deterministic-rule path to ACCEPTED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_auto_saved_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_scope           text,
    p_summary         text,
    p_conversation_id bigint DEFAULT NULL,
    p_evidence        text[] DEFAULT ARRAY[]::text[]
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_evidence text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship_id is required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' OR length(p_summary) > 2000 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: summary must be 1..2000 characters';
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

    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Auto-save kill switch (default ON; §7.4 Beta baseline, 可随时撤销).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_memory_auto_save_pref(p_owner_user_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_enabled boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_memory_auto_save_pref: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_memory_auto_save_pref: owner_user_id must match server-trusted context';
    END IF;

    SELECT enabled INTO v_enabled
      FROM vc.memory_auto_save_pref
     WHERE owner_user_id = p_owner_user_id;
    RETURN COALESCE(v_enabled, true);
END;
$$;

CREATE OR REPLACE FUNCTION vc.set_memory_auto_save_pref(
    p_owner_user_id bigint,
    p_enabled       boolean
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'set_memory_auto_save_pref: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'set_memory_auto_save_pref: owner_user_id must match server-trusted context';
    END IF;
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'set_memory_auto_save_pref: enabled is required';
    END IF;

    INSERT INTO vc.memory_auto_save_pref(owner_user_id, enabled, updated_at)
    VALUES (p_owner_user_id, p_enabled, now())
    ON CONFLICT (owner_user_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            updated_at = now();
    RETURN p_enabled;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_memory / get_memory gain out_auto_saved (DROP + CREATE: the OUT shape
-- changes). Bodies otherwise identical to the V17 re-pins.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.list_memory(bigint, bigint, boolean);
CREATE FUNCTION vc.list_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_include_deleted boolean DEFAULT false
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_status text, out_conversation_id bigint,
                  out_deleted_at timestamptz, out_created_at timestamptz,
                  out_auto_saved boolean)
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
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'list_memory: owner_user_id and relationship_id are required';
    END IF;

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.status, m.conversation_id,
               m.deleted_at, m.created_at, m.auto_saved
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND (p_include_deleted OR m.deleted_at IS NULL)
         ORDER BY m.created_at, m.id;
END;
$$;

DROP FUNCTION IF EXISTS vc.get_memory(bigint, bigint);
CREATE FUNCTION vc.get_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_scope text,
                  out_summary text, out_status text, out_conversation_id bigint,
                  out_created_at timestamptz, out_auto_saved boolean)
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
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'get_memory: owner_user_id and memory_id are required';
    END IF;

    RETURN QUERY
        SELECT m.id, m.relationship_id, m.scope, m.summary, m.status,
               m.conversation_id, m.created_at, m.auto_saved
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_memory_id
           AND m.deleted_at IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[]),
    vc.get_memory_auto_save_pref(bigint),
    vc.set_memory_auto_save_pref(bigint, boolean),
    vc.list_memory(bigint, bigint, boolean),
    vc.get_memory(bigint, bigint)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[]),
    vc.get_memory_auto_save_pref(bigint),
    vc.set_memory_auto_save_pref(bigint, boolean),
    vc.list_memory(bigint, bigint, boolean),
    vc.get_memory(bigint, bigint)
    TO vc_api;
