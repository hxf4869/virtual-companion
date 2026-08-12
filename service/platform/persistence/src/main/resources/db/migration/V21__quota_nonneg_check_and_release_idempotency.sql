-- TASK-0165 V21: quota non-negative CHECK + release idempotency (§5.1.4).
--
-- §5.1.4 (TASK-0109 audit §5.1 item 4 "Quota 数值与 release 幂等"): the usage/token/cost/quota
-- numeric columns carried only DEFAULT 0 at the table level (V7), with no CHECK(>=0), and
-- finalize_generation (V7) validated no input sign before INSERT — so a negative usage or
-- SETTLE row could persist. record_quota_release (V17) already guarded its own RELEASE path
-- against negative amounts (V17:1927), but had no per-generation single-conversion guard:
-- repeated calls for the same (owner, generation) inserted duplicate RELEASE rows (no
-- reservation id / idempotency key / single-conversion semantics).
--
-- This migration lands the two DB-layer enforcements:
--   * CHECK(>=0) on generation_usage.{input_tokens, output_tokens, actual_cost} and on
--     quota_ledger_entry.quota_amount (defense-in-depth; catches the finalize write path
--     AND any direct DML, not only the function-guarded RELEASE path).
--   * per-generation single RELEASE: a partial unique index on
--     quota_ledger_entry(owner_user_id, generation_id) WHERE kind='RELEASE' plus an
--     idempotency branch inside record_quota_release (a duplicate RELEASE returns the
--     existing entry id; the partial unique index is the concurrency backstop that turns
--     a race into a unique_violation instead of a duplicate row).
--
-- Forward-only (new V21); V1-V20 are frozen (Flyway checksum safety). record_quota_release's
-- signature (bigint, bigint, integer, text) is unchanged, so CREATE OR REPLACE preserves the
-- V15 EXECUTE grant (no GRANT/REVOKE needed). The V17 trusted-context assertion and all prior
-- validation are preserved verbatim; only the idempotency branch is added. The non-negative
-- guard deliberately stays BEFORE the idempotency check, so a negative-amount call still
-- raises regardless of whether a RELEASE already exists (preserving the test 43 negative
-- assertion). search_path is vc, pg_catalog — the V18 (TASK-0158 RISK-09) baseline for every
-- vc SECURITY DEFINER function; CREATE OR REPLACE must re-stamp that exact clause (re-stamping
-- the V17-era `vc, public` would regress test 57 G1). The body is fully schema-qualified, so
-- this is runtime-neutral.

SET search_path TO vc, pg_catalog;

-- 1. Non-negative CHECK constraints. ADD CONSTRAINT has no IF NOT EXISTS form, so each is
--    guarded by a pg_constraint existence check (mirrors V7's FK constraint pattern). fresh
--    migration leaves DEFAULT 0 rows, so the new CHECK is satisfiable with no backfill.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'generation_usage_input_tokens_nonneg'
           AND conparentid = 0
    ) THEN
        ALTER TABLE vc.generation_usage
            ADD CONSTRAINT generation_usage_input_tokens_nonneg
            CHECK (input_tokens >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'generation_usage_output_tokens_nonneg'
           AND conparentid = 0
    ) THEN
        ALTER TABLE vc.generation_usage
            ADD CONSTRAINT generation_usage_output_tokens_nonneg
            CHECK (output_tokens >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'generation_usage_actual_cost_nonneg'
           AND conparentid = 0
    ) THEN
        ALTER TABLE vc.generation_usage
            ADD CONSTRAINT generation_usage_actual_cost_nonneg
            CHECK (actual_cost >= 0);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'quota_ledger_entry_quota_amount_nonneg'
           AND conparentid = 0
    ) THEN
        ALTER TABLE vc.quota_ledger_entry
            ADD CONSTRAINT quota_ledger_entry_quota_amount_nonneg
            CHECK (quota_amount >= 0);
    END IF;
END $$;

-- 2. Per-generation single RELEASE: partial unique index. A generation may carry at most
--    one RELEASE ledger row (release is a single settlement->refund conversion); a second
--    concurrent writer raises unique_violation. SETTLE rows are excluded by the partial
--    predicate, so the one-SETTLE-per-finalize invariant (finalize runs once per generation)
--    is unaffected even if a future path wrote a second SETTLE.
CREATE UNIQUE INDEX IF NOT EXISTS quota_ledger_release_one_per_generation
    ON vc.quota_ledger_entry (owner_user_id, generation_id)
    WHERE kind = 'RELEASE';

-- 3. record_quota_release: idempotency guard. Signature (bigint, bigint, integer, text) is
--    unchanged -> CREATE OR REPLACE preserves the V15 EXECUTE grant; no GRANT/REVOKE. The
--    V17 trusted-context assertion and all prior validation are preserved verbatim; only
--    the idempotency branch (return the existing RELEASE entry id) is added before INSERT.
CREATE OR REPLACE FUNCTION vc.record_quota_release(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_quota_amount   integer,
    p_reason         text
)
    RETURNS TABLE(out_entry_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id       bigint;
    v_existing bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'record_quota_release: owner_user_id and generation_id are required';
    END IF;
    -- Non-negative guard stays BEFORE the idempotency check: a negative-amount call must
    -- still raise regardless of whether a RELEASE already exists, so validation stays
    -- ordered and fail-closed (preserves the test 43 negative assertion).
    IF p_quota_amount IS NULL OR p_quota_amount < 0 THEN
        RAISE EXCEPTION 'record_quota_release: quota_amount must be non-negative';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'record_quota_release: reason is required';
    END IF;

    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_quota_release: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- Idempotency: at most one RELEASE per generation. A duplicate call returns the existing
    -- entry id and inserts no second row. The partial unique index
    -- quota_ledger_release_one_per_generation is the concurrency backstop: if two sessions
    -- both pass this existence check, both attempt INSERT and the second raises
    -- unique_violation (fail-closed) rather than producing a duplicate RELEASE row.
    SELECT qle.id INTO v_existing
      FROM vc.quota_ledger_entry qle
     WHERE qle.owner_user_id = p_owner_user_id
       AND qle.generation_id = p_generation_id
       AND qle.kind = 'RELEASE';
    IF FOUND THEN
        RETURN QUERY SELECT v_existing;
        RETURN;
    END IF;

    v_id := nextval('vc.finalize_row_id_seq');
    INSERT INTO vc.quota_ledger_entry(
        owner_user_id, id, generation_id, kind, quota_amount, reason)
    VALUES (
        p_owner_user_id, v_id, p_generation_id, 'RELEASE', p_quota_amount, p_reason);

    RETURN QUERY SELECT v_id;
END;
$$;
