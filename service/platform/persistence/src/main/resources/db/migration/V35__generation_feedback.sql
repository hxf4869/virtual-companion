-- FEEDBACK V35: user feedback on a completed generation (FR-CHAT-003).
--
-- Adds vc.generation_feedback: one owner-scoped row per (generation, kind),
-- with kind restricted to the message-feedback-kinds catalog codes. The id is
-- allocated from a monotonic per-table sequence in the V6 pattern. The
-- SECURITY DEFINER record_generation_feedback follows the V17 trusted-owner
-- pattern (p_owner_user_id must match vc.current_owner_id()) and returns TRUE
-- only when an owned generation matched; a foreign or absent generation
-- returns FALSE so existence is never disclosed at the API layer.
--
-- Linkage for the A4 acceptance ("every negative feedback joins to the
-- generation, model, prompt, memory snapshot and safety decision"): the row
-- references the generation, which joins to generation_route (provider/model),
-- generation_attempt and the requested/execution authorization snapshots via
-- the existing FKs; no denormalized copies are stored.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.generation_feedback_id_seq AS bigint;

CREATE TABLE IF NOT EXISTS vc.generation_feedback (
    owner_user_id   bigint      NOT NULL,
    id              bigint      NOT NULL,
    generation_id   bigint      NOT NULL,
    kind            text        NOT NULL,
    note            text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, generation_id, kind),
    CONSTRAINT generation_feedback_kind_check CHECK (
        kind IN ('TOO_MECHANICAL', 'FORGOT_CONTEXT', 'CROSSED_BOUNDARY',
                 'FACTUAL_ERROR', 'UNSAFE')
    ),
    CONSTRAINT generation_feedback_note_len CHECK (
        note IS NULL OR length(note) <= 500
    )
);

GRANT USAGE, SELECT ON SEQUENCE vc.generation_feedback_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- record_generation_feedback: owner-scoped, idempotent per (generation, kind).
-- Returns the feedback row (existing on a repeat of the same kind, so the
-- first note wins); zero rows mean the generation is absent or foreign.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_generation_feedback(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_kind          text,
    p_note          text DEFAULT NULL
)
    RETURNS TABLE(o_generation_id bigint, o_kind text, o_note text,
                  o_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_generation_exists boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_generation_feedback: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'record_generation_feedback: generation id is required';
    END IF;
    -- V17 trusted-owner assertion: caller identity is server-trusted only.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_generation_feedback: owner_user_id must match server-trusted context';
    END IF;
    -- Defense in depth for direct callers; the API layer validates eagerly.
    IF p_kind IS NULL OR p_kind NOT IN ('TOO_MECHANICAL', 'FORGOT_CONTEXT',
            'CROSSED_BOUNDARY', 'FACTUAL_ERROR', 'UNSAFE') THEN
        RAISE EXCEPTION 'record_generation_feedback: unapproved feedback kind';
    END IF;
    IF p_note IS NOT NULL AND length(p_note) > 500 THEN
        RAISE EXCEPTION 'record_generation_feedback: note exceeds 500 characters';
    END IF;

    -- Existence check scoped to the trusted owner; absent → no rows (no disclosure).
    SELECT EXISTS (
        SELECT 1 FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.id = p_generation_id
    ) INTO v_generation_exists;

    IF NOT v_generation_exists THEN
        RETURN;
    END IF;

    INSERT INTO vc.generation_feedback
        (owner_user_id, id, generation_id, kind, note)
    VALUES
        (p_owner_user_id, nextval('vc.generation_feedback_id_seq'),
         p_generation_id, p_kind, p_note)
    ON CONFLICT (owner_user_id, generation_id, kind) DO NOTHING;

    RETURN QUERY
    SELECT f.generation_id, f.kind, f.note, f.created_at
      FROM vc.generation_feedback f
     WHERE f.owner_user_id = p_owner_user_id
       AND f.generation_id = p_generation_id
       AND f.kind = p_kind;
END;
$$;

-- Closed by default: only the API ingestion role may record feedback.
REVOKE EXECUTE ON FUNCTION
    vc.record_generation_feedback(bigint, bigint, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.record_generation_feedback(bigint, bigint, text, text)
    TO vc_api;
