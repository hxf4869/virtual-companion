-- DOGFOOD-STABILIZATION-03 V113: atomic account-deletion barrier for exports.
--
-- Audit defect D: the 02-round refusals were application-level CHECK-then-ACT
-- (ExportController reads the intent before creating, the export handler
-- reads it before sealing). Between the read and the INSERT/UPDATE the
-- deletion intent can commit, so a stale worker could still insert an
-- object pointer AFTER the pre-cascade cleanup loop finished and re-checked
-- — exactly the check-then-insert window the cleanup cannot close from the
-- application side.
--
-- This migration closes the window IN THE DATABASE: once
-- vc.account_deletion_intent_active_current() is true for the bound owner,
-- every pointer-writing export SD function refuses atomically:
--   create_export_request    — no new export request (no new work item)
--   complete_export          — no READY seal, no object pointer
--   fail_export_with_object  — no FAILED-with-pointer fallback either
-- fail_export (plain FAILED, no pointer) stays allowed — it writes no
-- pointer and cannot re-open the window. A refusal RAISEs inside the same
-- statement evaluation, so there is no READ COMMITTED snapshot in which the
-- intent is committed but a pointer still lands.
--
-- With the barrier in place the 02-round ordering holds unconditionally:
-- intent committed → cleanup loop empties the pointers → the final re-check
-- cannot race a fresh pointer, because none can be written anymore.
--
-- DOGFOOD-STABILIZATION-04 (audit defect D): the intent check alone still
-- leaves a real-time race — a pointer-writing transaction that passed the
-- check BEFORE the intent committed can still land its pointer afterwards
-- (READ COMMITTED snapshots never see the concurrent intent, and the cleanup
-- loop cannot wait for transactions it does not know about). Every
-- pointer-writing export function AND vc.request_account_deletion_current
-- therefore take the SAME owner-scoped transactional advisory lock BEFORE
-- the intent check, so:
--   * deletion WAITS for every in-flight pointer-writing transaction to
--     commit or roll back before it inserts the intent;
--   * a pointer writer that arrives after the intent committed acquires the
--     lock only once the deletion transaction ended, and then REFUSES on
--     the intent check.
--
-- DOGFOOD-STABILIZATION-05 (audit defect: bigint owner ids): the 04-round
-- key pg_advisory_xact_lock(2147483001, owner::int) CAST the bigint
-- owner_user_id to int — owner ids at or above 2^31 errored out and no
-- lossless mapping exists for a fixed class tag plus a 63-bit id. The lock
-- key is now the LOSSLESS two-int split of the full bigint owner id:
-- (owner >> 32, low 32 bits folded into int's signed range). The mapping is
-- a bijection, so two different owners NEVER share a lock and never
-- serialize against each other, and every legal bigint owner id (including
-- 2147483648 and above) locks correctly. This is the repository's ONLY use
-- of the two-int advisory-lock key space — every other migration uses the
-- single-int hashtext(...) form — so the split needs no extra class tag;
-- future two-int users must pick a disjoint scheme.

SET search_path TO vc, pg_catalog;

-- Owner-scoped transactional advisory lock shared by every pointer-writing
-- export SD function and the account-deletion request (see above). It only
-- touches advisory locks, so it is a plain (non-definer) function closed to
-- PUBLIC; the SD functions below call it as the first statement.
CREATE FUNCTION vc.export_pointer_barrier(p_owner_user_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
DECLARE
    v_hi bigint;
    v_lo bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'export_pointer_barrier: owner_user_id is required';
    END IF;
    -- DOGFOOD-STABILIZATION-05: lossless split of the full bigint owner id
    -- across the two-int advisory-lock key space (bijective — see the file
    -- header). The high word of a positive bigint is 0..2^31-1 (fits int);
    -- the low word is 0..2^32-1, folded into the signed int range so the
    -- cast can never overflow. Example: owner 2147483648 → key (0, -2147483648).
    v_hi := p_owner_user_id >> 32;
    v_lo := p_owner_user_id & 4294967295;
    PERFORM pg_advisory_xact_lock(
        v_hi::int,
        (v_lo - CASE WHEN v_lo >= 2147483648 THEN 4294967296 ELSE 0 END)::int);
END;
$$;

REVOKE ALL ON FUNCTION vc.export_pointer_barrier(bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION vc.create_export_request(
    p_owner_user_id bigint,
    p_token         text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id   bigint;
    v_pend integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_export_request: owner_user_id is required';
    END IF;
    IF p_token IS NULL OR btrim(p_token) = '' THEN
        RAISE EXCEPTION 'create_export_request: one-time download token is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_export_request: owner_user_id must match server-trusted context';
    END IF;

    -- DOGFOOD-STABILIZATION-04 (audit defect D): take the owner-scoped
    -- pointer barrier BEFORE any check — the account-deletion request takes
    -- the same lock, so the two serialize and the intent check below can no
    -- longer race a concurrent deletion commit.
    PERFORM vc.export_pointer_barrier(p_owner_user_id);

    -- DOGFOOD-STABILIZATION-03 (audit defect D): atomic deletion barrier —
    -- an active deletion intent refuses new export requests in the same
    -- statement that would insert them.
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'create_export_request: account deletion is in progress; export requests are closed';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.create_export_request.inflight'));
    SELECT count(*) INTO v_pend
      FROM vc.export_request e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.status = 'PENDING';
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'create_export_request: an export is already in flight for this account';
    END IF;

    v_id := nextval('vc.export_request_id_seq');
    -- Only the digest is persisted; the plaintext leaves the process exactly
    -- once, in the create response (V8 ticket pattern).
    INSERT INTO vc.export_request(owner_user_id, id, status, download_token_hash)
    VALUES (p_owner_user_id, v_id, 'PENDING',
            encode(vc.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'));

    -- The work item carries the export id as ref_id; the worker never reads
    -- the export row directly (only the SD functions reach the payload).
    PERFORM vc.enqueue_work_item(p_owner_user_id, 'DATA_EXPORT', v_id, NULL);
    RETURN v_id;
END;
$$;

-- Same signatures as V76/V109/V110 — CREATE OR REPLACE swaps the bodies
-- in place and keeps the existing vc_api grants.
CREATE OR REPLACE FUNCTION vc.complete_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_payload       text,
    p_expires_at    timestamptz,
    p_object_key    text DEFAULT NULL,
    p_object_bytes  bigint DEFAULT NULL
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
        RAISE EXCEPTION 'complete_export: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'complete_export: export id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'complete_export: owner_user_id must match server-trusted context';
    END IF;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    -- DOGFOOD-STABILIZATION-03 (audit defect D): atomic deletion barrier —
    -- after the deletion intent commits, no READY seal (inline or object)
    -- may ever write a pointer again.
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'complete_export: account deletion is in progress; export sealing is closed';
    END IF;
    -- Exactly one storage mode: inline payload XOR object pointer.
    IF p_payload IS NULL AND p_object_key IS NULL THEN
        RAISE EXCEPTION 'complete_export: payload or object_key is required';
    END IF;
    IF p_payload IS NOT NULL AND p_object_key IS NOT NULL THEN
        RAISE EXCEPTION 'complete_export: payload and object_key are mutually exclusive';
    END IF;
    IF p_object_key IS NOT NULL AND (p_object_bytes IS NULL OR p_object_bytes < 0) THEN
        RAISE EXCEPTION 'complete_export: object_bytes is required with object_key';
    END IF;
    IF p_expires_at IS NULL THEN
        RAISE EXCEPTION 'complete_export: expires_at is required';
    END IF;

    UPDATE vc.export_request
       SET status = 'READY',
           completed_at = now(),
           expires_at = p_expires_at,
           payload = p_payload,
           object_key = p_object_key,
           object_bytes = p_object_bytes,
           error_message = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.fail_export_with_object(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_object_key    text,
    p_object_bytes  bigint,
    p_error         text
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
        RAISE EXCEPTION 'fail_export_with_object: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'fail_export_with_object: export id is required';
    END IF;
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'fail_export_with_object: object_key is required';
    END IF;
    IF p_object_bytes IS NULL OR p_object_bytes < 0 THEN
        RAISE EXCEPTION 'fail_export_with_object: object_bytes must be non-negative';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'fail_export_with_object: owner_user_id must match server-trusted context';
    END IF;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    -- DOGFOOD-STABILIZATION-03 (audit defect D): the durable-pointer fallback
    -- is also refused once the deletion intent is active — a stale worker
    -- then compensates its just-uploaded object away (delete) instead of
    -- re-opening the pointer window the pre-cascade cleanup already closed.
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'fail_export_with_object: account deletion is in progress; pointer fallback is closed';
    END IF;

    UPDATE vc.export_request
       SET status = 'FAILED',
           error_message = COALESCE(NULLIF(btrim(p_error), ''), 'export failed'),
           object_key = p_object_key,
           object_bytes = p_object_bytes
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Closed by default; the drop above removed the old grants on
-- complete_export, restore them for vc_api (V109 pattern).
REVOKE EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.create_export_request(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.fail_export_with_object(bigint, bigint, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz, text, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.create_export_request(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.fail_export_with_object(bigint, bigint, text, bigint, text) TO vc_api;

-- ---------------------------------------------------------------------------
-- DOGFOOD-STABILIZATION-04 (audit defect D): the deletion side of the shared
-- barrier. V103's request_account_deletion_current, plus the same
-- owner-scoped advisory lock the export pointer writers take BEFORE they
-- check the intent — the deletion therefore WAITS until every in-flight
-- pointer-writing transaction has committed or rolled back, and only then
-- inserts the intent; every pointer writer arriving afterwards refuses on
-- the intent checks above. Signature unchanged (CREATE OR REPLACE keeps the
-- V103 grants).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.request_account_deletion_current()
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_username text;
    v_inserted boolean := false;
    v_generation record;
    v_generations integer := 0;
    v_work_items integer := 0;
BEGIN
    PERFORM vc.export_pointer_barrier(v_owner);

    SELECT a.username INTO v_username FROM vc.identity_account a
     WHERE a.id = v_owner AND a.status = 'ACTIVE' FOR UPDATE;
    IF v_username IS NULL THEN
        RETURN FALSE;
    END IF;

    INSERT INTO vc.account_deletion_intent(
        account_id, username_digest, status, requested_at, completed_at, poll_until)
    VALUES (v_owner, vc.username_tombstone_digest(v_username),
            'REQUESTED', now(), NULL, now() + interval '5 minutes')
    ON CONFLICT (account_id) DO UPDATE
       SET poll_until = greatest(vc.account_deletion_intent.poll_until,
                                now() + interval '5 minutes')
     WHERE vc.account_deletion_intent.status = 'REQUESTED'
    RETURNING (xmax = 0) INTO v_inserted;

    IF v_inserted THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        VALUES ('ACCOUNT_DELETE_REQUESTED', v_owner, v_username);
    END IF;

    FOR v_generation IN
        SELECT g.id FROM vc.generation g
         WHERE g.owner_user_id = v_owner
           AND g.status IN ('CREATED', 'INPUT_REVIEW', 'QUEUED', 'IN_PROGRESS',
                            'WAITING_FOR_CAPACITY', 'FINAL_REVIEW')
         ORDER BY g.id
         FOR UPDATE
    LOOP
        PERFORM vc.cancel_generation(v_owner, v_generation.id);
        v_generations := v_generations + 1;
    END LOOP;

    UPDATE vc.work_item
       SET status = 'CANCELLED', claim_token = NULL, claim_fence = NULL,
           claimed_at = NULL, lease_expires_at = NULL, finished_at = now()
     WHERE owner_user_id = v_owner AND status IN ('PENDING', 'CLAIMED');
    GET DIAGNOSTICS v_work_items = ROW_COUNT;

    UPDATE vc.account_deletion_intent
       SET cancelled_generations = cancelled_generations + v_generations,
           cancelled_work_items = cancelled_work_items + v_work_items
     WHERE account_id = v_owner AND status = 'REQUESTED';
    RETURN TRUE;
END;
$$;
