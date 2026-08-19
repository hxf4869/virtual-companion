-- DRILL-FIX V67: two set-returning plpgsql SD functions never emitted their
-- row (found live by the B0-05 supplier-failure drill, 2026-08-19).
--
-- A plpgsql function declared RETURNS TABLE only emits rows through
-- RETURN NEXT / RETURN QUERY; assigning the out_* columns and falling off
-- the end yields ZERO rows (empirically confirmed against PostgreSQL 18).
-- Both functions below had exactly that shape, so:
--   * vc.admin_quota_reconciliation (V61) always returned no row — the admin
--     reconciliation endpoint 404'd (EmptyResultDataAccessException folded
--     into the generic error) and DB test 116's assertions were vacuously
--     satisfied (SELECT INTO left the variables NULL and `IF v <> 2` is not
--     true for NULL);
--   * vc.preview_chat_wipe (V57) always returned no row — the CHAT-WIPE
--     preview showed empty counts and DB test 112's preview assertions were
--     equally vacuous.
-- The fix appends an explicit RETURN QUERY of the computed columns; the
-- SQL-language set-returning functions (list_pending_owner_ids, usage_*)
-- execute a single SELECT and were never affected.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- preview_chat_wipe (re-pinned from V57 + explicit row emission).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.preview_chat_wipe(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_conversation_count bigint, out_message_count bigint,
                  out_in_flight_count bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'preview_chat_wipe: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'preview_chat_wipe: owner_user_id must match server-trusted context';
    END IF;

    SELECT count(*)::bigint INTO out_conversation_count
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id;

    SELECT count(*)::bigint INTO out_message_count
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id;

    SELECT count(*)::bigint INTO out_in_flight_count
      FROM vc.work_item w
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
       );

    RETURN QUERY SELECT out_conversation_count, out_message_count,
                        out_in_flight_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_quota_reconciliation (re-pinned from V61 + explicit row emission).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_quota_reconciliation(
    p_admin_account_id bigint,
    p_since            timestamptz DEFAULT now() - interval '14 days'
)
    RETURNS TABLE(out_settled_count bigint, out_settled_amount bigint,
                  out_released_count bigint, out_released_amount bigint,
                  out_settled_not_completed bigint,
                  out_completed_not_settled bigint,
                  out_failed_without_release bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_quota_reconciliation: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_quota_reconciliation: caller is not an active ADMIN';
    END IF;

    SELECT count(*), COALESCE(sum(l.quota_amount), 0)
      INTO out_settled_count, out_settled_amount
      FROM vc.quota_ledger_entry l
     WHERE l.kind = 'SETTLE' AND l.created_at >= p_since;

    SELECT count(*), COALESCE(sum(l.quota_amount), 0)
      INTO out_released_count, out_released_amount
      FROM vc.quota_ledger_entry l
     WHERE l.kind = 'RELEASE' AND l.created_at >= p_since;

    -- A settle whose generation is not a success terminal is an anomaly.
    SELECT count(*) INTO out_settled_not_completed
      FROM vc.quota_ledger_entry l
      JOIN vc.generation g
        ON g.owner_user_id = l.owner_user_id AND g.id = l.generation_id
     WHERE l.kind = 'SETTLE' AND l.created_at >= p_since
       AND g.status NOT IN ('COMPLETED', 'COMPLETED_FALLBACK');

    -- A success terminal without a settle never billed the turn.
    SELECT count(*) INTO out_completed_not_settled
      FROM vc.generation g
     WHERE g.created_at >= p_since
       AND g.status IN ('COMPLETED', 'COMPLETED_FALLBACK')
       AND EXISTS (SELECT 1 FROM vc.generation_attempt a
                    WHERE a.owner_user_id = g.owner_user_id AND a.generation_id = g.id)
       AND NOT EXISTS (SELECT 1 FROM vc.quota_ledger_entry l
                        WHERE l.owner_user_id = g.owner_user_id
                          AND l.generation_id = g.id AND l.kind = 'SETTLE');

    -- A failed terminal without a release never reversed its reservation.
    SELECT count(*) INTO out_failed_without_release
      FROM vc.generation g
     WHERE g.created_at >= p_since
       AND g.status IN ('FAILED_FINAL', 'OUTPUT_BLOCKED', 'INPUT_BLOCKED')
       AND EXISTS (SELECT 1 FROM vc.generation_attempt a
                    WHERE a.owner_user_id = g.owner_user_id AND a.generation_id = g.id)
       AND NOT EXISTS (SELECT 1 FROM vc.quota_ledger_entry l
                        WHERE l.owner_user_id = g.owner_user_id
                          AND l.generation_id = g.id AND l.kind = 'RELEASE');

    RETURN QUERY SELECT out_settled_count, out_settled_amount,
                        out_released_count, out_released_amount,
                        out_settled_not_completed, out_completed_not_settled,
                        out_failed_without_release;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.preview_chat_wipe(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_quota_reconciliation(bigint, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.preview_chat_wipe(bigint),
                      vc.admin_quota_reconciliation(bigint, timestamptz)
    TO vc_api;
