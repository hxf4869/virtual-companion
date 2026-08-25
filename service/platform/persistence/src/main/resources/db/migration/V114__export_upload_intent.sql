-- DOGFOOD-STABILIZATION-04/05 V114: fenced durable export upload intents.
--
-- 04 (audit defect E) gave the crash-after-put reclaim path a durable
-- consumer: one vc.export_upload_intent row per planned object put, recorded
-- in its OWN committed transaction before the upload and removed atomically
-- by the seal / durable-pointer terminal.
--
-- 05 (independent acceptance) closed the remaining races in the PROTOCOL
-- itself — the 04-round worklist had no atomic claim, lease or fencing, so a
-- scheduler holding a stale snapshot could still delete an object a worker
-- had just sealed READY/FAILED, a reclaim could race the worker's own put,
-- and two scheduler instances could process the same intent. The state
-- machine below is the full protocol:
--
--   OPEN --(worker record, lease starts)--> OPEN
--   OPEN --(complete_export / fail_export_with_object consume)--> row gone
--   OPEN --(sweeper atomic claim, grace + lease expired)--> CLAIMED (tombstone)
--   CLAIMED --(sweeper re-sweep, idempotent object delete)--> stays CLAIMED
--   CLAIMED --(clear_export_object / owner cascade)--> row gone
--
-- Invariants (all proven by infra/db/tests/165_export_upload_reclaim_protocol.sql):
--   1. an object referenced by a READY/FAILED pointer is never deleted — the
--      sweeper only touches an object AFTER its atomic claim committed, and a
--      claim re-checks "no pointer exists" on the live row;
--   2. once a claim commits, the attempt can never publish a pointer —
--      complete_export / fail_export_with_object consume ONLY an OPEN row
--      and RAISE when a CLAIMED tombstone for the same key survives (the
--      whole seal transaction, pointer included, rolls back);
--   3. a put after the first sweep still converges — the CLAIMED row is a
--      retained tombstone the sweeper re-deletes (idempotent) on every pass
--      until the export's terminal cleanup removes the row;
--   4. after an account deletion cascade a late worker can only put under
--      the owner prefix with NO database record — the scheduler's prefix
--      audit (vc.export_object_has_record) deletes exactly those objects;
--   5. two schedulers can never both reclaim one attempt — the claim is a
--      single-row atomic UPDATE ... WHERE state = 'OPEN';
--   6. no sleep/re-check pseudo-protocol anywhere: every transition above is
--      one atomic statement or one advisory-lock-ordered transaction.
--
-- The table is SECURITY-DEFINER-only: no role holds any table privilege, so
-- every access flows through the functions below (V103 intent pattern).

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.export_upload_intent_id_seq AS bigint;

-- ---------------------------------------------------------------------------
-- 07 (defect D): the durable object fence. Every object key under
-- exports/ has AT MOST ONE holder at a time — 'WRITER' (a live upload
-- attempt, held from the record of its intent until the seal consumes it)
-- or 'RECLAIM' (the prefix audit, held around the delete of an unrecorded
-- object). The single-row uniqueness IS the atomic gate the double
-- objectHasRecord read could never be: a record that commits first makes
-- the audit's reclaim INSERT lose (the object is not the audit's to
-- delete), and a reclaim that commits first makes the record RAISE (the
-- worker is fenced out BEFORE its put) — including under concurrency,
-- because both sides write the SAME unique row and the loser waits on the
-- row lock and then sees the committed holder. A READY pointer can
-- therefore never reference a deleted object. Claim transfers a WRITER
-- fence to RECLAIM (the sweeper inherits the delete right);
-- retire/clear/seal release it.
--
-- 08 (defect A): the owner link is NULLABLE with ON DELETE SET NULL — the
-- account-deletion cascade must NOT destroy the fence row itself. A WRITER
-- fence whose owner was deleted carries owner_user_id IS NULL, which marks
-- it ORPHANED (no intent row can survive the cascade, so the writer has no
-- durable record left); the audit may take such an orphaned WRITER over
-- (see fence_export_orphan_reclaim), so a deletion can never leave a fence
-- that permanently blocks the convergence of a late object. A fence for a
-- key whose owner never existed is created ownerless from the start. The
-- owner column is bookkeeping for the LIVE-writer case only — taking over
-- an ACTIVE writer (owner_user_id IS NOT NULL) stays impossible.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc.export_object_fence (
    owner_user_id bigint        REFERENCES vc.vc_user(id) ON DELETE SET NULL,
    object_key    text          NOT NULL PRIMARY KEY,
    holder        text          NOT NULL,
    held_at       timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT export_object_fence_holder CHECK (holder IN ('WRITER', 'RECLAIM')),
    CONSTRAINT export_object_fence_key_shape CHECK (
        object_key LIKE 'exports/%' AND length(object_key) <= 512)
);

CREATE TABLE IF NOT EXISTS vc.export_upload_intent (
    owner_user_id    bigint        NOT NULL,
    id               bigint        NOT NULL DEFAULT nextval('vc.export_upload_intent_id_seq'),
    export_id        bigint        NOT NULL,
    object_key       text          NOT NULL,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    -- 05: lease/fencing columns. lease_expires_at starts at creation (lease
    -- parameter 0 = the 04 semantics: the grace window counts from the
    -- record) and renew_export_upload_lease pushes it out for a still-active
    -- upload, so F: an actively-leased upload past the creation grace is
    -- never reclaimed.
    lease_expires_at timestamptz   NOT NULL DEFAULT now(),
    state            text          NOT NULL DEFAULT 'OPEN',
    claimed_at       timestamptz,
    swept_at         timestamptz,
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, object_key),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT export_upload_intent_key_shape CHECK (
        object_key LIKE 'exports/%' AND length(object_key) <= 512),
    CONSTRAINT export_upload_intent_state CHECK (state IN ('OPEN', 'CLAIMED')),
    CONSTRAINT export_upload_intent_claim_shape CHECK (
        (state = 'OPEN' AND claimed_at IS NULL AND swept_at IS NULL)
        OR (state = 'CLAIMED' AND claimed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS export_upload_intent_created_at_idx
    ON vc.export_upload_intent (created_at);

-- ---------------------------------------------------------------------------
-- record_export_upload_intent: the fenced pre-put write. The worker calls it
-- in its OWN short committed owner transaction AFTER the document/envelope is
-- built and as close to the put as possible; once it commits, a crash at any
-- later point leaves a durable record the reconciliation sweep can act on.
-- Refuses under an active deletion intent (same barrier family as the
-- pointer writers) and validates that the key is EXACTLY this owner's and
-- this export's attempt key (cross-owner or export-mismatched keys are
-- rejected), and that the export is still PENDING. Re-recording the SAME
-- attempt key while it is still OPEN renews its lease (a retry of the same
-- claim fence); a key already CLAIMED by the sweeper is refused — that
-- attempt may never upload or seal again (fencing).
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.record_export_upload_intent(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_object_key    text,
    p_lease_seconds integer DEFAULT 0
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id     bigint;
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_export_upload_intent: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'record_export_upload_intent: export id is required';
    END IF;
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'record_export_upload_intent: object_key is required';
    END IF;
    IF p_lease_seconds IS NULL OR p_lease_seconds < 0 OR p_lease_seconds > 86400 THEN
        RAISE EXCEPTION 'record_export_upload_intent: lease seconds must be within 0..86400';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_export_upload_intent: owner_user_id must match server-trusted context';
    END IF;
    -- 05 supplementary validation: the key must be bound to THIS owner and
    -- THIS export attempt (exports/{owner}/{export}-{attempt}.json shape).
    IF p_object_key !~ ('^exports/' || p_owner_user_id::text || '/'
                        || p_export_id::text || '-[0-9a-f]{16}\.json$') THEN
        RAISE EXCEPTION 'record_export_upload_intent: object_key is not bound to this owner/export attempt';
    END IF;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'record_export_upload_intent: account deletion is in progress; upload intents are closed';
    END IF;
    SELECT e.status INTO v_status
      FROM vc.export_request e
     WHERE e.owner_user_id = p_owner_user_id AND e.id = p_export_id;
    IF v_status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'record_export_upload_intent: export is not PENDING anymore';
    END IF;
    -- 07 (defect D): hold the WRITER fence in THIS transaction — atomically
    -- with the intent row below. A RECLAIM fence held by the prefix audit
    -- makes the record RAISE (the worker is fenced out before its put); the
    -- row lock serializes a concurrent reclaim INSERT the other way round.
    INSERT INTO vc.export_object_fence(owner_user_id, object_key, holder)
    VALUES (p_owner_user_id, p_object_key, 'WRITER')
    ON CONFLICT (object_key) DO UPDATE
        SET holder = 'WRITER', held_at = now(), owner_user_id = EXCLUDED.owner_user_id
      WHERE vc.export_object_fence.holder = 'WRITER';
    IF NOT EXISTS (SELECT 1 FROM vc.export_object_fence
                    WHERE object_key = p_object_key AND holder = 'WRITER'
                      AND owner_user_id = p_owner_user_id) THEN
        RAISE EXCEPTION 'record_export_upload_intent: this object key is fenced for reclaim; upload refused';
    END IF;
    INSERT INTO vc.export_upload_intent(
            owner_user_id, export_id, object_key,
            lease_expires_at, state, claimed_at, swept_at)
    VALUES (p_owner_user_id, p_export_id, p_object_key,
            now() + make_interval(secs => p_lease_seconds), 'OPEN', NULL, NULL)
    ON CONFLICT (owner_user_id, object_key) DO UPDATE
        SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
            state            = 'OPEN',
            claimed_at       = NULL,
            swept_at         = NULL
      WHERE vc.export_upload_intent.state = 'OPEN'
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        -- Same key exists but is CLAIMED (or was consumed): the sweeper
        -- irreversibly took this attempt over — fence the worker out.
        RAISE EXCEPTION 'record_export_upload_intent: this upload attempt was already reclaimed; refusing';
    END IF;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- renew_export_upload_lease: heartbeat for a still-active upload. Extends
-- the lease of an OPEN intent so an upload legitimately outliving the grace
-- window is never reclaimed mid-flight (F). A CLAIMED row refuses — the
-- attempt is gone.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.renew_export_upload_lease(
    p_owner_user_id  bigint,
    p_export_id      bigint,
    p_object_key     text,
    p_lease_seconds  integer
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
        RAISE EXCEPTION 'renew_export_upload_lease: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'renew_export_upload_lease: owner_user_id must match server-trusted context';
    END IF;
    IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 OR p_lease_seconds > 86400 THEN
        RAISE EXCEPTION 'renew_export_upload_lease: lease seconds must be within 1..86400';
    END IF;
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() + make_interval(secs => p_lease_seconds)
     WHERE owner_user_id = p_owner_user_id
       AND export_id = p_export_id
       AND object_key = p_object_key
       AND state = 'OPEN';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- stale_export_upload_intents: bounded CANDIDATE worklist for the reclaim
-- claim (05: listing alone grants nothing — the scheduler must win
-- vc.claim_export_upload_intent afterwards). A row is a candidate when its
-- lease/grace window expired, its key still has no export_request pointer,
-- and the owner has no deletion intent (that cleanup + cascade own those
-- rows). Cross-owner maintenance function (V109/V110 pattern).
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.stale_export_upload_intents(
    p_limit            integer,
    p_min_age_seconds  integer
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_export_id bigint,
                  out_object_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT i.id, i.owner_user_id, i.export_id, i.object_key
          FROM vc.export_upload_intent i
         WHERE i.state = 'OPEN'
           AND i.lease_expires_at < now() - make_interval(
                secs => greatest(coalesce(p_min_age_seconds, 900), 0))
           AND NOT EXISTS (
                SELECT 1 FROM vc.export_request e
                 WHERE e.owner_user_id = i.owner_user_id
                   AND e.object_key = i.object_key)
           AND NOT EXISTS (
                SELECT 1 FROM vc.account_deletion_intent d
                 WHERE d.account_id = i.owner_user_id)
         ORDER BY i.lease_expires_at
         LIMIT least(greatest(coalesce(p_limit, 100), 1), 100);
END;
$$;

-- ---------------------------------------------------------------------------
-- claim_export_upload_intent: THE atomic reclaim (05/06). Single-row
-- conditional UPDATE — under READ COMMITTED it re-reads the live row, so a
-- concurrent seal (intent consumed), a concurrent claim by another scheduler
-- instance, or a pointer that appeared after the listing each yield 0 rows
-- and the caller MUST skip the object. Only the winner may delete.
--
-- 06 (TOCTOU closure): the claim re-validates EVERYTHING on the live row —
-- not just state and pointer. The stale listing is only a candidate set; a
-- renew or a re-record that pushed lease_expires_at out AFTER the listing
-- must defeat the claim, and after a row-lock wait the UPDATE re-evaluates
-- the LATEST lease (EvalPlanQual re-reads the committed row version). The
-- grace is passed explicitly by the caller as p_grace_seconds and applied
-- inside the same atomic statement — no sleep, no second Java query.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.claim_export_upload_intent(
    p_owner_user_id  bigint,
    p_id             bigint,
    p_grace_seconds  integer DEFAULT 900
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_key text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'claim_export_upload_intent: owner_user_id is required';
    END IF;
    IF p_id IS NULL OR p_id <= 0 THEN
        RAISE EXCEPTION 'claim_export_upload_intent: id is required';
    END IF;
    UPDATE vc.export_upload_intent i
       SET state = 'CLAIMED',
           claimed_at = now(),
           swept_at = NULL
     WHERE i.owner_user_id = p_owner_user_id
       AND i.id = p_id
       AND i.state = 'OPEN'
       AND i.lease_expires_at < now() - make_interval(
            secs => greatest(coalesce(p_grace_seconds, 900), 0))
       AND NOT EXISTS (
            SELECT 1 FROM vc.export_request e
             WHERE e.owner_user_id = i.owner_user_id
               AND e.object_key = i.object_key)
       AND NOT EXISTS (
            SELECT 1 FROM vc.account_deletion_intent d
             WHERE d.account_id = i.owner_user_id)
    RETURNING i.object_key INTO v_key;
    IF v_key IS NOT NULL THEN
        -- 07 (defect D): the sweeper inherits the key's delete right — a
        -- WRITER fence held by an attempt that will never seal again
        -- becomes RECLAIM in the claim's own transaction, so the prefix
        -- audit and the re-sweep stay the only deleters of this key.
        UPDATE vc.export_object_fence f
           SET holder = 'RECLAIM', held_at = now()
         WHERE f.object_key = v_key;
    END IF;
    RETURN v_key;
END;
$$;

-- ---------------------------------------------------------------------------
-- claimed_export_upload_intents: bounded re-sweep worklist of CLAIMED
-- tombstones. The claim deleted the object once, but a worker that had
-- already recorded could still put afterwards — the tombstone row makes any
-- such late object discoverable and deletable (invariant 3). Rows are
-- re-listed after the given age and then at most once per day per row
-- (swept_at); the row itself survives until the export's terminal cleanup
-- (clear_export_object) or the owner cascade removes it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.claimed_export_upload_intents(
    p_limit            integer,
    p_min_age_seconds  integer
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_export_id bigint,
                  out_object_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT i.id, i.owner_user_id, i.export_id, i.object_key
          FROM vc.export_upload_intent i
         WHERE i.state = 'CLAIMED'
           AND i.claimed_at < now() - make_interval(
                secs => greatest(coalesce(p_min_age_seconds, 900), 0))
           AND (i.swept_at IS NULL
                OR i.swept_at < now() - interval '24 hours')
           AND NOT EXISTS (
                SELECT 1 FROM vc.account_deletion_intent d
                 WHERE d.account_id = i.owner_user_id)
         ORDER BY i.claimed_at
         LIMIT least(greatest(coalesce(p_limit, 100), 1), 100);
END;
$$;

-- ---------------------------------------------------------------------------
-- retire_export_upload_tombstone (07 redesign): the provably-safe end of a
-- CLAIMED tombstone's life. A row may only be DELETED when ALL of the
-- following hold on the live row (single atomic DELETE, re-evaluated after
-- any row-lock wait):
--   * the claim window is past the WHOLE upload lifecycle, not a fixed
--     60s guess. Derivation: a live upload keeps its lease alive with the
--     durable heartbeat; the claim itself only happens after the lease
--     expired PLUS the grace (p_min_age floor 300s, default 900s), so at
--     claim time no successful renew happened for at least the grace.
--     Every individual HTTP call of an upload (each multipart part, the
--     complete call) is bounded by the storage client's call timeout, and
--     an aborted upload's last in-flight call ends within that bound after
--     the heartbeat stops — by claim + grace every legal writer has long
--     finished. A pathological writer that ignores the abort holds no
--     lease and no intent row: its late-landed object has NO record at all
--     and is finally removed by the fenced prefix audit — the audit is the
--     correctness backstop, the window only bounds pointless re-sweeps;
--   * the export is terminal (no PENDING row for the intent's export —
--     a live attempt could still seal and needs the tombstone's fencing);
--   * no pointer references the key (a READY/FAILED pointer keeps the
--     object protected by the sweeps, not by this row).
-- The caller must already have performed the final object delete and the
-- no-pointer re-check immediately before; this function is the last step
-- and releases the key's fence so a later audit pass can fence the key
-- again for any object a pathological writer might still land.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.retire_export_upload_tombstone(
    p_owner_user_id   bigint,
    p_id              bigint,
    p_min_age_seconds integer DEFAULT 900
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
    v_key  text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'retire_export_upload_tombstone: owner_user_id is required';
    END IF;
    IF p_id IS NULL OR p_id <= 0 THEN
        RAISE EXCEPTION 'retire_export_upload_tombstone: id is required';
    END IF;
    DELETE FROM vc.export_upload_intent i
     WHERE i.owner_user_id = p_owner_user_id
       AND i.id = p_id
       AND i.state = 'CLAIMED'
       AND i.claimed_at < now() - make_interval(
            secs => greatest(coalesce(p_min_age_seconds, 900), 300))
       AND NOT EXISTS (
            SELECT 1 FROM vc.export_request e
             WHERE e.owner_user_id = i.owner_user_id
               AND e.id = i.export_id
               AND e.status = 'PENDING')
       AND NOT EXISTS (
            SELECT 1 FROM vc.export_request e
             WHERE e.owner_user_id = i.owner_user_id
               AND e.object_key = i.object_key)
    RETURNING i.object_key INTO v_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
        DELETE FROM vc.export_object_fence f WHERE f.object_key = v_key;
    END IF;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- mark_export_upload_intent_swept: bookkeeping after the tombstone's
-- idempotent object re-delete. 0 rows means the row vanished (terminal
-- cleanup or cascade won) — harmless for the caller.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.mark_export_upload_intent_swept(
    p_owner_user_id bigint,
    p_id            bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE vc.export_upload_intent
       SET swept_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_id
       AND state = 'CLAIMED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_export_upload_intent: maintenance/test row removal. NOT part of the
-- reclaim protocol (production rows leave via clear_export_object, the seal
-- consumption or the owner cascade); kept for the RLS harness cleanups.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.delete_export_upload_intent(
    p_owner_user_id bigint,
    p_id            bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
    v_key  text;
BEGIN
    DELETE FROM vc.export_upload_intent x
     WHERE x.owner_user_id = p_owner_user_id AND x.id = p_id
    RETURNING x.object_key INTO v_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
        DELETE FROM vc.export_object_fence f WHERE f.object_key = v_key;
    END IF;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- export_object_has_record: does ANY database record still reference this
-- object key (an export_request pointer or an upload-intent row)? The
-- scheduler's prefix audit deletes exactly the objects for which this is
-- false — after an account-deletion cascade a late worker's object has no
-- record at all, and the audit is what finally removes it (invariant 4).
-- Cross-owner maintenance function; the caller re-checks before deleting.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.export_object_has_record(p_object_key text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'export_object_has_record: object_key is required';
    END IF;
    RETURN EXISTS (SELECT 1 FROM vc.export_request e
                    WHERE e.object_key = p_object_key)
        OR EXISTS (SELECT 1 FROM vc.export_upload_intent i
                    WHERE i.object_key = p_object_key);
END;
$$;

-- ---------------------------------------------------------------------------
-- complete_export (06 shape): the READY seal CONSUMES the upload intent
-- atomically with the pointer write. For p_object_key IS NOT NULL the seal
-- itself now (a) verifies the key is bound to THIS owner/export attempt
-- (exports/{owner}/{export}-{16 hex}.json — not merely whatever the Java
-- record stage checked) and (b) REQUIRES exactly one matching OPEN intent
-- row (owner_user_id, export_id, object_key all equal), deleted inside this
-- same transaction. A missing intent, an intent belonging to another
-- export/owner, a mismatched key or an already-CLAIMED tombstone each RAISE
-- inside the transaction, so the pointer write rolls back — after the
-- sweeper irreversibly took an attempt over, or before any fenced record
-- existed, that attempt can never publish a pointer (invariant 2). The
-- inline payload mode (p_payload IS NOT NULL) keeps the V42 behavior: no
-- upload happened, so no intent is required.
-- ---------------------------------------------------------------------------
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
    v_rows    integer;
    v_intents integer;
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
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'complete_export: account deletion is in progress; export sealing is closed';
    END IF;
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
    IF p_object_key IS NOT NULL AND p_object_key !~ (
            '^exports/' || p_owner_user_id::text || '/'
            || p_export_id::text || '-[0-9a-f]{16}\.json$') THEN
        RAISE EXCEPTION 'complete_export: object_key is not bound to this owner/export attempt';
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
    IF v_rows = 1 AND p_object_key IS NOT NULL THEN
        DELETE FROM vc.export_upload_intent x
         WHERE x.owner_user_id = p_owner_user_id
           AND x.export_id = p_export_id
           AND x.object_key = p_object_key
           AND x.state = 'OPEN';
        GET DIAGNOSTICS v_intents = ROW_COUNT;
        IF v_intents <> 1 THEN
            RAISE EXCEPTION 'complete_export: no single OPEN upload intent for this pointer; pointer refused';
        END IF;
        -- 07 (defect D): the pointer now owns the object — the writer fence
        -- is released in the same transaction (a later audit pass sees the
        -- pointer via has_record and never fences this key).
        DELETE FROM vc.export_object_fence f
         WHERE f.object_key = p_object_key AND f.holder = 'WRITER';
    END IF;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- fail_export_with_object (06 shape): the durable FAILED-with-pointer
-- fallback consumes the intent with the SAME fencing — exactly one matching
-- OPEN intent (owner/export/key) is required and consumed atomically with
-- the pointer write; a missing intent, a foreign intent or a surviving
-- CLAIMED tombstone refuses the pointer and rolls the whole transaction
-- back (invariant 2 covers the fallback path too).
-- ---------------------------------------------------------------------------
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
    v_rows    integer;
    v_intents integer;
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
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'fail_export_with_object: account deletion is in progress; pointer fallback is closed';
    END IF;
    IF p_object_key !~ ('^exports/' || p_owner_user_id::text || '/'
                        || p_export_id::text || '-[0-9a-f]{16}\.json$') THEN
        RAISE EXCEPTION 'fail_export_with_object: object_key is not bound to this owner/export attempt';
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
    IF v_rows = 1 THEN
        DELETE FROM vc.export_upload_intent x
         WHERE x.owner_user_id = p_owner_user_id
           AND x.export_id = p_export_id
           AND x.object_key = p_object_key
           AND x.state = 'OPEN';
        GET DIAGNOSTICS v_intents = ROW_COUNT;
        IF v_intents <> 1 THEN
            RAISE EXCEPTION 'fail_export_with_object: no single OPEN upload intent for this pointer; pointer refused';
        END IF;
        -- 07 (defect D): same release as the READY seal — the durable
        -- pointer is the object's record now.
        DELETE FROM vc.export_object_fence f
         WHERE f.object_key = p_object_key AND f.holder = 'WRITER';
    END IF;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- clear_export_object (05 shape): after a terminal object deletion the row —
-- whatever its state, tombstones included — is safe to drop; this is the
-- bounded end of every CLAIMED tombstone's life. The account-deletion
-- cleanup loop (which lists pointer rows AND intent rows) converges here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.clear_export_object(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_object_key    text
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
    v_intents integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'clear_export_object: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'clear_export_object: export id is required';
    END IF;
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'clear_export_object: object_key is required';
    END IF;

    UPDATE vc.export_request
       SET object_key = NULL,
           object_bytes = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND object_key = p_object_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    DELETE FROM vc.export_upload_intent x
     WHERE x.owner_user_id = p_owner_user_id AND x.object_key = p_object_key;
    GET DIAGNOSTICS v_intents = ROW_COUNT;
    -- 07 (defect D): the terminal cleanup owns the key — whatever fence it
    -- still holds is released with the rows.
    DELETE FROM vc.export_object_fence f WHERE f.object_key = p_object_key;
    RETURN v_rows + v_intents;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_owner_export_objects (04 shape): the pre-cascade account-deletion
-- worklist lists the owner's pointer rows AND upload-intent keys (any state).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_owner_export_objects(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_owner_user_id bigint, out_id bigint, out_object_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_owner_export_objects: owner_user_id is required';
    END IF;
    RETURN QUERY
        SELECT e.owner_user_id, e.id, e.object_key
          FROM vc.export_request e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.object_key IS NOT NULL
         ORDER BY e.id
         LIMIT 500;
    RETURN QUERY
        SELECT i.owner_user_id, i.export_id, i.object_key
          FROM vc.export_upload_intent i
         WHERE i.owner_user_id = p_owner_user_id
         ORDER BY i.id
         LIMIT 500;
END;
$$;

-- ---------------------------------------------------------------------------
-- fail_export (07 override of the V76 shape): the plain FAILED terminal
-- now takes the SAME owner barrier as record / complete_export /
-- fail_export_with_object — a record holding the barrier makes the plain
-- fail WAIT (no record(PENDING) ↔ fail(FAILED) pass-through window), and a
-- fail that commits first makes every later record refuse on the PENDING
-- check.
--
-- 07 (defect C): the terminal does NOT touch upload-intent rows or fences
-- anymore. An OPEN intent stays durable until its lease expires and the
-- unified reclaim protocol claims it; a CLAIMED tombstone only ever leaves
-- through retire_export_upload_tombstone. A late put after the terminal
-- therefore keeps its record until the claim, and the (now fenced) prefix
-- audit remains the convergence for whatever a pathological writer lands
-- after retirement. The V76 body is otherwise byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.fail_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
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
        RAISE EXCEPTION 'fail_export: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'fail_export: export id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'fail_export: owner_user_id must match server-trusted context';
    END IF;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);

    UPDATE vc.export_request
       SET status = 'FAILED',
           completed_at = now(),
           error_message = btrim(p_error),
           download_token_hash = NULL,
           payload = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- fence_export_orphan_reclaim (07 defect D, 08 defects A/B): the prefix
-- audit's atomic gate. Attempts to hold the key's RECLAIM fence AND — in
-- the SAME transaction, while this fence's row lock is held — re-verify
-- that no database record appeared. Returns true ONLY when both hold:
--   * the RECLAIM fence was taken (or re-taken by the audit itself — a
--     crashed audit pass is reentrant): a live WRITER (owner still exists)
--     makes the INSERT/UPDATE lose → false, the audit must skip;
--   * 08 (defect A): an ORPHANED WRITER — owner_user_id IS NULL after the
--     account-deletion cascade SET NULL — is taken over: no intent row can
--     survive the cascade, so that writer has no durable record left and
--     its late object is the audit's to converge. The fence INSERT itself
--     resolves the owner from the live vc_user table: for a deleted owner
--     the row is created OWNERLESS (owner_user_id NULL) instead of dying
--     on the old NOT NULL foreign key — a deleted owner's late object can
--     always be fenced. Forging a key under a LIVE foreign owner prefix
--     cannot take over anything: that owner's active WRITER keeps
--     owner_user_id NOT NULL and the ON CONFLICT WHERE refuses;
--   * 08 (defect B): after the fence is held, the pointer and intent
--     tables are re-read INSIDE this transaction — a record/seal that
--     committed between the scheduler's objectHasRecord pre-filter and
--     this call is seen here (the fence row's serialization guarantees the
--     record side is FINISHED: any record that started before us made us
--     lose the fence, any record that starts after us RAISES on our
--     RECLAIM). A pointer or intent row of ANY state means the object is
--     not the audit's to delete: this pass's RECLAIM placeholder is
--     released and false is returned — a READY/FAILED pointer can never
--     reference an object the audit deleted. Cross-owner maintenance
--     function; the release keeps the caller reentrant.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.fence_export_orphan_reclaim(p_object_key text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner  bigint;
    v_actual bigint;
    v_held   boolean;
BEGIN
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'fence_export_orphan_reclaim: object_key is required';
    END IF;
    IF p_object_key !~ '^exports/([0-9]{1,19})/' THEN
        RAISE EXCEPTION 'fence_export_orphan_reclaim: object_key is not under an owner prefix';
    END IF;
    v_owner := (regexp_match(p_object_key, '^exports/([0-9]{1,19})/'))[1]::bigint;
    -- 08 (defect A): resolve the owner against the LIVE table. NULL for a
    -- deleted (or never-existed) owner — the fence is ownerless, not
    -- impossible.
    SELECT u.id INTO v_actual FROM vc.vc_user u WHERE u.id = v_owner;
    INSERT INTO vc.export_object_fence(owner_user_id, object_key, holder)
    VALUES (v_actual, p_object_key, 'RECLAIM')
    ON CONFLICT (object_key) DO UPDATE
        SET held_at       = now(),
            holder        = 'RECLAIM',
            owner_user_id = EXCLUDED.owner_user_id
      WHERE vc.export_object_fence.holder = 'RECLAIM'
         OR (vc.export_object_fence.holder = 'WRITER'
             AND vc.export_object_fence.owner_user_id IS NULL)
    RETURNING true INTO v_held;
    IF NOT coalesce(v_held, false) THEN
        -- An active WRITER (live owner) holds the key — never the audit's.
        RETURN false;
    END IF;
    -- 08 (defect B): the fence is held and its row lock serializes every
    -- concurrent record of this key — re-verify the RECORD state inside
    -- this same transaction. A pointer (any status) or an intent row (any
    -- state, including a CLAIMED tombstone) means the object still has a
    -- durable consumer: release the placeholder and refuse.
    IF EXISTS (SELECT 1 FROM vc.export_request e
                WHERE e.object_key = p_object_key)
       OR EXISTS (SELECT 1 FROM vc.export_upload_intent i
                   WHERE i.object_key = p_object_key) THEN
        DELETE FROM vc.export_object_fence f
         WHERE f.object_key = p_object_key
           AND f.holder = 'RECLAIM';
        RETURN false;
    END IF;
    RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- clear_export_orphan_reclaim (07): release the audit's RECLAIM fence
-- after its object delete finished (success or terminal failure); a WRITER
-- fence is never touched. Cross-owner maintenance function.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.clear_export_orphan_reclaim(p_object_key text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'clear_export_orphan_reclaim: object_key is required';
    END IF;
    DELETE FROM vc.export_object_fence f
     WHERE f.object_key = p_object_key AND f.holder = 'RECLAIM';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION vc.record_export_upload_intent(bigint, bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.renew_export_upload_lease(bigint, bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.stale_export_upload_intents(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.claim_export_upload_intent(bigint, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.claimed_export_upload_intents(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.retire_export_upload_tombstone(bigint, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.mark_export_upload_intent_swept(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.delete_export_upload_intent(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_object_has_record(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.fail_export_with_object(bigint, bigint, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.fail_export(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.fence_export_orphan_reclaim(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.clear_export_orphan_reclaim(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.clear_export_object(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.list_owner_export_objects(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_export_upload_intent(bigint, bigint, text, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.renew_export_upload_lease(bigint, bigint, text, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.stale_export_upload_intents(integer, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.claim_export_upload_intent(bigint, bigint, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.claimed_export_upload_intents(integer, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.retire_export_upload_tombstone(bigint, bigint, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.mark_export_upload_intent_swept(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.delete_export_upload_intent(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.export_object_has_record(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.fence_export_orphan_reclaim(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.clear_export_orphan_reclaim(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz, text, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.fail_export_with_object(bigint, bigint, text, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.clear_export_object(bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_owner_export_objects(bigint) TO vc_api;
