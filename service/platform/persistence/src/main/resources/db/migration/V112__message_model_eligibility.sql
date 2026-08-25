-- DOGFOOD-STABILIZATION-03 V112: model-egress eligibility of stored messages.
--
-- Audit defect A: a message whose turn was INPUT_BLOCKED / OUTPUT_BLOCKED
-- (hard-rule or crisis block) or CANCELLED stays persisted for data rights,
-- but its text must never enter any later generation/moderation provider
-- request. The old assembler loaded conversation history with no notion of
-- eligibility, so a blocked turn's user message silently rode along in every
-- later outbound payload.
--
-- Fix at the persistence layer (never by re-classifying the text):
--   vc.message.model_eligible  boolean NOT NULL DEFAULT true
--   terminalize_generation     marks the turn's messages ineligible when the
--                              terminal status is INPUT_BLOCKED/OUTPUT_BLOCKED
--   cancel_generation          marks the turn's messages ineligible
-- "The turn's messages" = rows linked to the generation either directly
-- (message.generation_id, the assistant final) or through
-- generation.source_user_message_id (the turn's user message, including the
-- reused source message of a blocked regenerate).
--
-- The column only gates MODEL-FACING reads (the assembler's history query).
-- Data-rights reads — the export document, conversation listing — are
-- unchanged and still see every row.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.message
    ADD COLUMN IF NOT EXISTS model_eligible boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- DOGFOOD-STABILIZATION-04 (audit defect A): upgrade-path backfill. Turns
-- that were ALREADY terminal-blocked or cancelled BEFORE this migration
-- (blocked by the 03-round text flow or cancelled by users/deletion flows)
-- must not keep default-true eligibility — the migration column default only
-- covers rows created after V112. Every message linked to such a generation
-- (message.generation_id or generation.source_user_message_id) flips to
-- model_eligible=false here, so a fresh V111→latest upgrade closes the same
-- door the runtime path closes.
-- ---------------------------------------------------------------------------
UPDATE vc.message m
   SET model_eligible = false
  FROM vc.generation g
 WHERE m.owner_user_id = g.owner_user_id
   AND (m.generation_id = g.id OR g.source_user_message_id = m.id)
   AND g.status IN ('INPUT_BLOCKED', 'OUTPUT_BLOCKED', 'CANCELLED');

-- Internal helper: flip eligibility for every message of one turn. Called
-- only from the two terminal SD functions below (definer path), so it is
-- deliberately NOT granted to any runtime role.
CREATE FUNCTION vc.mark_turn_messages_model_ineligible(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'mark_turn_messages_model_ineligible: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'mark_turn_messages_model_ineligible: generation_id is required';
    END IF;
    -- The account-deletion flow CANCELS in-flight generations right after
    -- persisting the intent, and V103's message guard rejects every message
    -- UPDATE while the intent is active. Skipping the eligibility mark for
    -- a deleting account is safe and correct: the account's rows (and any
    -- outbound eligibility with them) are about to cascade away, and no new
    -- outbound can start for this owner anyway.
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.account_id = p_owner_user_id) THEN
        RETURN 0;
    END IF;
    UPDATE vc.message m
       SET model_eligible = false
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
       AND m.owner_user_id = p_owner_user_id
       AND (m.generation_id = g.id OR g.source_user_message_id = m.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- DOGFOOD-STABILIZATION-04 (audit defect C): mark SPECIFIC persisted messages
-- model-ineligible by id — the egress gate's rejection path. When the
-- generation-side sensitive-data gate refuses an outbound, the exact history
-- rows that carried the sensitive text (which may belong to OLDER turns, not
-- the current generation) lose eligibility atomically with the turn's
-- terminal state, in the caller's transaction. Terms verification flipping
-- true later can never re-release them: eligibility is the persisted fact.
-- Same account-deletion short-circuit as the turn-level helper above (V103's
-- message UPDATE guard would otherwise reject the mark mid-deletion; the
-- rows are about to cascade away and no new outbound can start).
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.mark_messages_model_ineligible(
    p_owner_user_id bigint,
    p_message_ids   bigint[]
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'mark_messages_model_ineligible: owner_user_id is required';
    END IF;
    IF p_message_ids IS NULL OR array_length(p_message_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'mark_messages_model_ineligible: message_ids must be a non-empty array';
    END IF;
    -- Granted to vc_api, so the owner argument must be the server-trusted
    -- binding (V17 pattern): a caller bound to owner 1 can never mark
    -- another owner's rows.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'mark_messages_model_ineligible: owner_user_id must match server-trusted context';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.account_id = p_owner_user_id) THEN
        RETURN 0;
    END IF;
    UPDATE vc.message m
       SET model_eligible = false
     WHERE m.owner_user_id = p_owner_user_id
       AND m.id = ANY (p_message_ids)
       AND m.model_eligible;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- terminalize_generation (V58 shape + eligibility marking): INPUT_BLOCKED and
-- OUTPUT_BLOCKED also mark the turn's messages model-ineligible in the SAME
-- transaction as the terminal state — there is no window where a blocked turn
-- is durably terminal but its text is still model-eligible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.terminalize_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_to_status      text,
    p_event_type     text,
    p_payload        jsonb DEFAULT '{}'::jsonb
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'terminalize_generation: owner_user_id and generation_id are required';
    END IF;
    IF p_to_status NOT IN ('FAILED_FINAL','OUTPUT_BLOCKED','COMPLETED_FALLBACK','INPUT_BLOCKED') THEN
        RAISE EXCEPTION 'terminalize_generation: unsupported terminal status % (CANCELLED must use cancel_generation)',
            p_to_status;
    END IF;
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'terminalize_generation: event_type is required';
    END IF;
    -- INV-GEN-003: the terminal event type must match the terminal state.
    IF NOT (
        (p_to_status = 'FAILED_FINAL' AND p_event_type = 'chat.failed')
        OR (p_to_status = 'OUTPUT_BLOCKED' AND p_event_type = 'chat.blocked')
        OR (p_to_status = 'INPUT_BLOCKED' AND p_event_type = 'chat.blocked')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND p_event_type = 'chat.completed')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: event type % does not match terminal status %',
            p_event_type, p_to_status;
    END IF;

    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'terminalize_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- generation-states.yaml legal edges for these four terminal states:
    --   FAILED_FINAL        <- IN_PROGRESS, WAITING_FOR_CAPACITY, COMMITTING
    --   OUTPUT_BLOCKED      <- FINAL_REVIEW
    --   INPUT_BLOCKED       <- INPUT_REVIEW
    --   COMPLETED_FALLBACK  <- COMMITTING
    IF NOT (
        (p_to_status = 'FAILED_FINAL'
            AND v_status IN ('IN_PROGRESS','WAITING_FOR_CAPACITY','COMMITTING'))
        OR (p_to_status = 'OUTPUT_BLOCKED' AND v_status = 'FINAL_REVIEW')
        OR (p_to_status = 'INPUT_BLOCKED' AND v_status = 'INPUT_REVIEW')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND v_status = 'COMMITTING')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: illegal transition % -> %',
            v_status, p_to_status;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

    -- DOGFOOD-STABILIZATION-03 (audit defect A): a blocked turn's persisted
    -- messages lose model-egress eligibility atomically with the terminal
    -- state; FAILED_FINAL / COMPLETED_FALLBACK turns keep eligibility (their
    -- inputs were admitted and their outputs were either never produced or
    -- already delivered).
    IF p_to_status IN ('INPUT_BLOCKED', 'OUTPUT_BLOCKED') THEN
        PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, p_generation_id);
    END IF;

    -- Durable terminal event, PENDING only (published post-commit), matching
    -- finalize_generation's chat.completed (V7).
    PERFORM vc.append_terminal_event(
        p_owner_user_id, p_generation_id, p_event_type,
        COALESCE(p_payload, '{}'::jsonb));

    RETURN p_to_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- cancel_generation (V17 shape + eligibility marking): a cancelled turn's
-- associated user message must not ride along in later provider requests.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.cancel_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'cancel_generation: owner_user_id and generation_id are required';
    END IF;

    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cancel_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- Cancellable states per the catalog transition graph. COMMITTING and every
    -- terminal state (INPUT_BLOCKED, COMPLETED, COMPLETED_FALLBACK, CANCELLED,
    -- OUTPUT_BLOCKED, FAILED_FINAL) have no CANCEL_REQUESTED edge.
    IF v_status NOT IN (
        'CREATED', 'INPUT_REVIEW', 'QUEUED', 'IN_PROGRESS',
        'WAITING_FOR_CAPACITY', 'FINAL_REVIEW'
    ) THEN
        RAISE EXCEPTION 'cancel_generation: generation in state % is not cancellable',
            v_status;
    END IF;

    -- Catalog double-hop: both edges are valid, so the transition is observable
    -- only as the terminal CANCELLED state to the caller.
    UPDATE vc.generation
       SET status = 'CANCEL_REQUESTED'
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;
    UPDATE vc.generation
       SET status = 'CANCELLED'
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

    -- DOGFOOD-STABILIZATION-03 (audit defect A): the cancelled turn's
    -- associated messages lose model-egress eligibility in the same
    -- transaction as the terminal state.
    PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, p_generation_id);

    -- TASK-0100 P2-11: durable chat.cancelled written atomically in the same
    -- transaction (allocated from the shared stream allocator, PENDING until
    -- commit), so a client resumes into TERMINAL_SNAPSHOT containing the
    -- terminal cancel event instead of relying on status alone.
    PERFORM vc.append_terminal_event(
        p_owner_user_id, p_generation_id, 'chat.cancelled',
        jsonb_build_object('generation_id', p_generation_id));

    RETURN 'CANCELLED';
END;
$$;

-- The turn-level helper above stays internal (definer path only); the
-- id-array marker is the runtime egress-block path and needs vc_api access.
REVOKE ALL ON FUNCTION vc.mark_turn_messages_model_ineligible(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.mark_messages_model_ineligible(bigint, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.mark_messages_model_ineligible(bigint, bigint[]) TO vc_api;
