-- GEN-RECONC V33: generation retry/recovery reconciliation.
--
-- Gap: RETRY-A (V29) returns a retryable-failed work item to PENDING with
-- deterministic backoff, but the generation row stays IN_PROGRESS (that is the
-- contract — the turn is not over). When the item is re-claimed the worker's
-- prepare segment re-runs `promote_generation(IN_PROGRESS)`, and V25 only
-- allows CREATED→IN_PROGRESS and IN_PROGRESS→FINAL_REVIEW, so the re-run
-- RAISEs, the worker applies its independent per-item fail, the work item is
-- terminalized FAILED and the generation is stuck IN_PROGRESS forever (the
-- client's SSE stream never closes on a durable terminal event). The same
-- happens after a worker crash + lease recovery, and the crashed attempt's
-- CREATED intent row is never closed (vc.abandon_late_attempt has no caller).
--
-- This migration:
--   1. redefines promote_generation idempotently: IN_PROGRESS → IN_PROGRESS is
--      a no-op returning the current status (re-run of the prepare segment is
--      safe; the CREATED→IN_PROGRESS / IN_PROGRESS→FINAL_REVIEW edges and the
--      FOR UPDATE serialization are unchanged);
--   2. adds vc.close_stale_attempt_intents(owner, work_item_id): closes every
--      still-CREATED intent of a re-processed work item as ABANDONED_LATE
--      (audit closure only, V28 semantics — the abandoned intent writes no
--      business results and creates no attempt);
--   3. adds vc.generation_has_event(owner, generation_id, event_type): the
--      prepare re-run can skip re-appending the durable chat.accepted event
--      (append_realtime_event is not idempotent);
--   4. adds vc.list_stale_in_progress_generations(): enumerates generations
--      stuck IN_PROGRESS whose work item is already terminal (FAILED /
--      DEAD_LETTERED / CANCELLED — the independent-fail path). The runtime
--      reconciliation scheduler terminalizes each as FAILED_FINAL with a
--      chat.failed event via the existing terminalize_generation (V15).
--
-- No table/constraint/privilege change to any existing object. V1-V32 frozen
-- (Flyway checksum safe). Every new/redefined function follows the V17
-- trusted-owner assertion where owner-bound and the V7-V32 REVOKE/GRANT
-- baseline.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. promote_generation: idempotent redefinition (V25 + no-op edge).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.promote_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_to_status      text
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_current text;
    v_valid_map boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'promote_generation: owner_user_id and generation_id are required';
    END IF;
    IF p_to_status NOT IN ('IN_PROGRESS', 'FINAL_REVIEW') THEN
        RAISE EXCEPTION 'promote_generation: unsupported target status %', p_to_status;
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'promote_generation: owner_user_id must match server-trusted context';
    END IF;

    SELECT g.status INTO v_current
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- 合法前进边（V25）+ 幂等 no-op 边（GEN-RECONC：重试/崩溃恢复后重跑
    -- prepare-tx 时 status 已推进过，返回现状而不是抛异常）。
    v_valid_map :=
        (v_current = 'CREATED'      AND p_to_status = 'IN_PROGRESS')
     OR (v_current = 'IN_PROGRESS'  AND p_to_status = 'FINAL_REVIEW')
     OR (v_current = 'IN_PROGRESS'  AND p_to_status = 'IN_PROGRESS');
    IF NOT v_valid_map THEN
        RAISE EXCEPTION 'promote_generation: illegal transition % -> %', v_current, p_to_status;
    END IF;

    IF v_current = p_to_status THEN
        RETURN v_current;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id
       AND status = v_current;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_generation: generation % lost the transition race (status no longer %)',
            p_generation_id, v_current;
    END IF;

    RETURN p_to_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. close_stale_attempt_intents: close still-CREATED intents of a re-run
--    work item as ABANDONED_LATE (audit closure, V28 semantics).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.close_stale_attempt_intents(
    p_owner_user_id bigint,
    p_work_item_id  bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_closed integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_work_item_id IS NULL THEN
        RAISE EXCEPTION 'close_stale_attempt_intents: owner_user_id and work_item_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'close_stale_attempt_intents: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.attempt_intent
       SET status = 'ABANDONED_LATE'
     WHERE owner_user_id = p_owner_user_id
       AND work_item_id = p_work_item_id
       AND status = 'CREATED';
    GET DIAGNOSTICS v_closed = ROW_COUNT;
    RETURN v_closed;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. generation_has_event: existence probe for one durable event of a
--    generation. Lets the prepare re-run skip re-appending chat.accepted
--    (append_realtime_event allocates a fresh seq on every call and is not
--    idempotent). Existence is never disclosed to foreign owners: the
--    trusted-owner assertion fails closed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.generation_has_event(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_event_type    text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'generation_has_event: owner_user_id and generation_id are required';
    END IF;
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'generation_has_event: event_type is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'generation_has_event: owner_user_id must match server-trusted context';
    END IF;

    RETURN EXISTS (
        SELECT 1
          FROM vc.realtime_event e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.generation_id = p_generation_id
           AND e.event_type = p_event_type
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. list_stale_in_progress_generations: coordinator-side enumeration of
--    generations stuck IN_PROGRESS whose work item is already terminal.
--    No owner parameter and no trusted-owner assertion (same shape as V24
--    list_pending_owner_ids): it only returns id pairs for the runtime
--    reconciliation scheduler, never business content.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_stale_in_progress_generations()
    RETURNS TABLE(out_owner_user_id bigint, out_generation_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT DISTINCT g.owner_user_id, g.id
          FROM vc.generation g
          JOIN vc.work_item wi
            ON wi.owner_user_id = g.owner_user_id
           AND wi.kind = 'GENERATION'
           AND wi.ref_id = g.id
         WHERE g.status = 'IN_PROGRESS'
           AND wi.status IN ('FAILED', 'DEAD_LETTERED', 'CANCELLED');
END;
$$;

-- New/redefined SECURITY DEFINER functions default to PUBLIC EXECUTE. Enforce
-- the V7-V32 baseline: revoke PUBLIC, grant only vc_api (promote_generation
-- keeps its V25 grant explicitly).
REVOKE EXECUTE ON FUNCTION
    vc.promote_generation(bigint, bigint, text),
    vc.close_stale_attempt_intents(bigint, bigint),
    vc.generation_has_event(bigint, bigint, text),
    vc.list_stale_in_progress_generations()
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.promote_generation(bigint, bigint, text),
    vc.close_stale_attempt_intents(bigint, bigint),
    vc.generation_has_event(bigint, bigint, text),
    vc.list_stale_in_progress_generations()
    TO vc_api;

-- ---------------------------------------------------------------------------
-- Migration-end fail-closed DO block: assert the critical invariants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_bad boolean := false;
BEGIN
    IF to_regprocedure('vc.promote_generation(bigint,bigint,text)') IS NULL THEN
        RAISE EXCEPTION 'V33: promote_generation missing';
    END IF;
    IF to_regprocedure('vc.close_stale_attempt_intents(bigint,bigint)') IS NULL THEN
        RAISE EXCEPTION 'V33: close_stale_attempt_intents missing';
    END IF;
    IF to_regprocedure('vc.generation_has_event(bigint,bigint,text)') IS NULL THEN
        RAISE EXCEPTION 'V33: generation_has_event missing';
    END IF;
    IF to_regprocedure('vc.list_stale_in_progress_generations()') IS NULL THEN
        RAISE EXCEPTION 'V33: list_stale_in_progress_generations missing';
    END IF;
    IF NOT has_function_privilege('vc_api',
            'vc.close_stale_attempt_intents(bigint,bigint)', 'EXECUTE') THEN
        v_bad := true;
    END IF;
    IF has_function_privilege('public',
            'vc.close_stale_attempt_intents(bigint,bigint)', 'EXECUTE') THEN
        v_bad := true;
    END IF;
    IF v_bad THEN
        RAISE EXCEPTION 'V33: close_stale_attempt_intents privileges are not as expected';
    END IF;
END;
$$;
