-- V139: explicit recovery of the owner's most recent UNCLAIMED export copy.
--
-- A lost create response (network drop, closed tab) leaves the owner with a
-- PENDING or READY export whose one-time download token can never be shown
-- again — only its sha256 digest is at rest (V76) — while create keeps
-- refusing new requests behind the PENDING row. This function SELECTS the
-- owner's most recent still-unclaimed export row and re-arms that selected
-- row in place with a fresh token the caller presents (the handler generates
-- it and echoes it exactly once in the recover response): the stored digest
-- is replaced, so the previously issued link is dead the moment this commits.
-- Nothing is copied, re-built or re-queued and no plaintext is persisted. The
-- database cannot tell whether the selected row is the one whose response was
-- lost — it is simply the most recent unclaimed one (an earlier READY copy
-- qualifies when no PENDING row exists); the returned requested_at lets the
-- caller recognise it. The status function stays token-less regardless.
--
-- Eligibility mirrors consume_export and is deliberately narrow: a non-NULL
-- digest (never consumed, failed or expired) on a PENDING row or on a READY
-- row that has not expired. A consumed row (digest NULL) can never be
-- re-armed, terminal rows carry no payload, and the account-deletion barrier
-- (V113 owner lock + intent check here, V137 row trigger underneath) refuses
-- the write while the account is being deleted.
--
-- Concurrency shape:
--   * vc.export_pointer_barrier is taken FIRST, before any export_request
--     read, exactly like complete_export / fail_export / the deletion request
--     (lock order owner-barrier → row everywhere). consume_export and the
--     maintenance sweeps take only the row lock and never the barrier, so no
--     reverse order exists and a waiting recovery can never deadlock them.
--   * The candidate id is pinned by a plain snapshot read, then the UPDATE
--     targets THAT primary key and re-checks eligibility on the locked row
--     version. If a concurrent consume_export already nulled the digest, the
--     UPDATE matches zero rows and the call returns nothing — it never slides
--     to an older copy. (ORDER BY … LIMIT 1 FOR UPDATE would fetch the next
--     row after a failed recheck under READ COMMITTED; that shape is avoided.)
--   * Zero rows means nothing claimable — the same "existence undisclosed"
--     contract as consume_export; the caller maps it to NOT_FOUND_OR_FORBIDDEN.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.recover_export_request(
    p_owner_user_id bigint,
    p_new_token     text
)
    RETURNS TABLE(out_id bigint, out_status text, out_requested_at timestamptz,
                  out_completed_at timestamptz, out_expires_at timestamptz,
                  out_error_message text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id   bigint;
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'recover_export_request: owner_user_id is required';
    END IF;
    IF p_new_token IS NULL OR btrim(p_new_token) = '' THEN
        RAISE EXCEPTION 'recover_export_request: one-time download token is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'recover_export_request: owner_user_id must match server-trusted context';
    END IF;

    -- Owner barrier before any export read or write; the deletion request
    -- takes the same lock, so an active intent is refused atomically.
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'recover_export_request: account deletion is in progress; export recovery is closed';
    END IF;

    -- Pin the most recent claimable row with a plain snapshot read (no lock).
    SELECT e.id INTO v_id
      FROM vc.export_request e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.download_token_hash IS NOT NULL
       AND (e.status = 'PENDING'
            OR (e.status = 'READY' AND e.expires_at > now()))
     ORDER BY e.id DESC
     LIMIT 1;
    IF v_id IS NULL THEN
        RETURN;
    END IF;

    -- Rotate ONLY the pinned row; eligibility is re-checked on its locked
    -- version, so a consume that won the race leaves zero rows here.
    UPDATE vc.export_request e
       SET download_token_hash = encode(
               vc.digest(convert_to(p_new_token, 'UTF8'), 'sha256'), 'hex')
     WHERE e.owner_user_id = p_owner_user_id
       AND e.id = v_id
       AND e.download_token_hash IS NOT NULL
       AND (e.status = 'PENDING'
            OR (e.status = 'READY' AND e.expires_at > now()))
    RETURNING e.id, e.status, e.requested_at, e.completed_at, e.expires_at,
              e.error_message
        INTO out_id, out_status, out_requested_at, out_completed_at,
             out_expires_at, out_error_message;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN;
    END IF;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION vc.recover_export_request(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.recover_export_request(bigint, text) TO vc_api;
