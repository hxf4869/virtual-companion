-- TASK-0021 V8: persistent Fetch-SSE resume, single-use ticket, gap/reset/snapshot.
--
-- Brings the vc.realtime_event table (created PENDING-only in V7) up to the
-- realtime-events envelope (streamEpoch/eventSeq/committedAt) and adds the
-- durable persistence that lets a client resume a Fetch-SSE stream across
-- disconnects, recover from gaps via terminal snapshot, reset on epoch change,
-- and never fabricate missing deltas (INV-RT-001). chat.completed stays PENDING
-- until its transaction commits, so resume/snapshot can never publish an
-- uncommitted terminal event (INV-TX-001, INV-GEN-003).
--
-- Three new structures back the contract (specs/contracts/realtime-contract.yaml):
--   * vc.generation.stream_epoch   -- the authoritative current epoch; a reset
--                                     bumps it so a stale epoch => RESET_REQUIRED.
--   * vc.realtime_stream           -- per-generation stream state: next_seq high
--                                     water mark (durable + non-durable) and
--                                     retained_after_seq low water mark, making
--                                     GAP_EXPIRED a deterministic, testable rule
--                                     (after_seq < retained_after_seq).
--   * vc.realtime_ticket           -- short-lived single-use resume ticket, TTL
--                                     45s, server stores only sha256(secret)
--                                     (mayContainLongLivedCredential: false),
--                                     bound to the seven-tuple in the contract.
--
-- SECURITY DEFINER functions append durable events, issue/consume tickets,
-- resume a stream (RESUMED | TERMINAL_SNAPSHOT | GAP_EXPIRED | RESET_REQUIRED |
-- NOT_FOUND_OR_FORBIDDEN), read a terminal snapshot, reset the epoch and expire
-- the window. All revoke PUBLIC EXECUTE and grant only vc_api (TASK-0016 P0
-- class). Every new owned table is FORCE RLS with the V2 owner_isolation policy.

SET search_path TO vc, public;

-- digest() backs the hash-only ticket store; gen_random_uuid() is built-in from
-- PG13 but pgcrypto is declared explicitly so the migration is self-contained.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- vc.realtime_event: align with the realtime-events envelope. stream_epoch +
-- event_seq make a per-(generation, epoch) monotonic cursor; committed_at is the
-- envelope committedAt. Alpha tables are empty (tests TRUNCATE), so NOT NULL
-- DEFAULTS are safe for any pre-existing V7 row.
ALTER TABLE vc.realtime_event
    ADD COLUMN IF NOT EXISTS stream_epoch bigint NOT NULL DEFAULT 1;
ALTER TABLE vc.realtime_event
    ADD COLUMN IF NOT EXISTS event_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE vc.realtime_event
    ADD COLUMN IF NOT EXISTS committed_at timestamptz NOT NULL DEFAULT now();

-- INV-RT-001: event_seq is unique per (owner, generation, epoch) so a cursor
-- position resolves to at most one event; the resume index serves the
-- event_seq > after_seq scan that drives RESUMED.
CREATE UNIQUE INDEX IF NOT EXISTS realtime_event_seq_uniq
    ON vc.realtime_event (owner_user_id, generation_id, stream_epoch, event_seq);
CREATE INDEX IF NOT EXISTS realtime_event_resume_idx
    ON vc.realtime_event (owner_user_id, generation_id, stream_epoch, event_seq);

-- TASK-0100 P2-08: realtime_event.event_type is bound to the durable subset of
-- specs/catalog/realtime-events.yaml (durable: true entries). Non-durable
-- stream events (chat.delta, chat.replace, stream.*) never persist, and the
-- four terminal types (chat.completed / chat.cancelled / chat.blocked /
-- chat.failed) can only be written by the terminal transitions
-- (finalize_generation / terminalize_generation / cancel_generation) through
-- the owner-only vc.append_terminal_event allocator.
ALTER TABLE vc.realtime_event
    DROP CONSTRAINT IF EXISTS realtime_event_type_catalog;
ALTER TABLE vc.realtime_event
    ADD CONSTRAINT realtime_event_type_catalog CHECK (
        event_type IN (
            'chat.accepted', 'chat.completed', 'chat.cancelled',
            'chat.blocked', 'chat.failed', 'safety.notice',
            'service.mode.changed', 'memory.candidate.created',
            'memory.candidate.confirmation_required'));

-- The authoritative current epoch for a generation. A reset increments it; a
-- resume carrying a stale epoch returns RESET_REQUIRED and the client must
-- discard uncommitted draft (realtime-contract rule: "an epoch mismatch
-- discards uncommitted draft and requires reset").
ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS stream_epoch bigint NOT NULL DEFAULT 1;

-- Per-generation stream state. next_seq is the high water mark assigned to both
-- durable and non-durable events (deltas consume seq without persisting); the
-- gap between persisted durable seqs and next_seq is exactly what a client may
-- have missed. retained_after_seq is the low water mark: every seq <= it has
-- aged out of the recoverable window, so a client whose after_seq falls below
-- it is GAP_EXPIRED and must recover via snapshot.
CREATE TABLE IF NOT EXISTS vc.realtime_stream (
    owner_user_id      bigint NOT NULL,
    id                 bigint NOT NULL,
    generation_id      bigint NOT NULL,
    stream_epoch       bigint NOT NULL DEFAULT 1,
    next_seq           bigint NOT NULL DEFAULT 1,
    retained_after_seq bigint NOT NULL DEFAULT 0,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, generation_id)
);

-- Short-lived single-use resume ticket (POST /api/v1/realtime/tickets). The
-- server stores only sha256(secret); the plaintext secret is returned once at
-- issue time and presented by the client on resume. boundTo matches the
-- contract seven-tuple; any mismatch, expiry or replay fails closed.
CREATE TABLE IF NOT EXISTS vc.realtime_ticket (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    ticket_hash     text NOT NULL,
    generation_id   bigint NOT NULL,
    session_id      text NOT NULL,
    origin          text NOT NULL,
    transport       text NOT NULL,
    stream_epoch    bigint NOT NULL,
    after_seq       bigint NOT NULL,
    expires_at      timestamptz NOT NULL,
    consumed_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT realtime_ticket_transport CHECK (transport IN ('FETCH_SSE'))
);

-- FORCE ROW LEVEL SECURITY + owner_isolation on the two new owned tables,
-- matching the V2/V7 baseline. A missing tenant context matches nothing.
DO $$
DECLARE
    t text;
    owned text[] := ARRAY['realtime_stream', 'realtime_ticket'];
BEGIN
    FOREACH t IN ARRAY owned LOOP
        EXECUTE format('ALTER TABLE vc.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE vc.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS owner_isolation ON vc.%I', t);
        EXECUTE format(
            'CREATE POLICY owner_isolation ON vc.%I FOR ALL '
            'TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher '
            'USING (owner_user_id = vc.current_owner_id()) '
            'WITH CHECK (owner_user_id = vc.current_owner_id())',
            t
        );
    END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON vc.realtime_stream, vc.realtime_ticket
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ensure_realtime_stream: idempotently create the per-generation stream row if
-- absent, seeded from the generation's authoritative stream_epoch. Returns the
-- stream state so callers (append/resume/...) operate on a known cursor. Output
-- columns are out_-prefixed so the RETURNS TABLE names never shadow the table
-- columns inside the body (TASK-0017 lesson).
CREATE OR REPLACE FUNCTION vc.ensure_realtime_stream(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS TABLE(out_id bigint, out_stream_epoch bigint,
                  out_next_seq bigint, out_retained_after_seq bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_epoch bigint;
    v_id    bigint;
    v_row   record;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'ensure_realtime_stream: owner_user_id and generation_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Generation must exist for this owner (FORCE RLS scoped read).
    SELECT g.stream_epoch INTO v_epoch
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ensure_realtime_stream: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    SELECT * INTO v_row FROM vc.realtime_stream s
     WHERE s.owner_user_id = p_owner_user_id
       AND s.generation_id = p_generation_id;
    IF NOT FOUND THEN
        v_id := nextval('vc.finalize_row_id_seq');
        INSERT INTO vc.realtime_stream(
            owner_user_id, id, generation_id, stream_epoch, next_seq, retained_after_seq)
        VALUES (
            p_owner_user_id, v_id, p_generation_id, v_epoch, 1, 0)
        ON CONFLICT (owner_user_id, generation_id) DO NOTHING;
        SELECT * INTO v_row FROM vc.realtime_stream s
         WHERE s.owner_user_id = p_owner_user_id
           AND s.generation_id = p_generation_id;
    END IF;

    -- Keep the stream epoch in lockstep with the authoritative generation epoch
    -- (a reset updates both atomically); reconcile defensively on access.
    IF v_row.stream_epoch <> v_epoch THEN
        UPDATE vc.realtime_stream
           SET stream_epoch = v_epoch, updated_at = now()
         WHERE owner_user_id = p_owner_user_id
           AND generation_id = p_generation_id;
        v_row.stream_epoch := v_epoch;
    END IF;

    RETURN QUERY SELECT v_row.id, v_row.stream_epoch, v_row.next_seq, v_row.retained_after_seq;
END;
$$;

-- append_realtime_event: persist one durable event and allocate its monotonic
-- event_seq from the stream high water mark. Rejects an epoch mismatch so an
-- event can never be appended to a stale epoch. Returns the assigned event_seq.
--
-- TASK-0100 P2-07/P2-08: the seq allocation is one atomic UPDATE (row lock +
-- epoch predicate, so concurrent appends get strictly unique increasing seqs
-- and a concurrent reset cannot split the check from the write); the event
-- type is validated against the durable non-terminal subset of
-- specs/catalog/realtime-events.yaml — unknown (foo), non-durable (chat.delta,
-- stream.*) and terminal types (chat.completed/cancelled/blocked/failed, which
-- only the terminal transitions may produce) all fail closed.
CREATE OR REPLACE FUNCTION vc.append_realtime_event(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_stream_epoch   bigint,
    p_event_type     text,
    p_payload        jsonb DEFAULT '{}'::jsonb
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_stream  record;
    v_seq     bigint;
    v_row_id  bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'append_realtime_event: owner_user_id and generation_id are required';
    END IF;
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'append_realtime_event: event_type is required';
    END IF;
    IF p_event_type NOT IN (
        'chat.accepted', 'safety.notice', 'service.mode.changed',
        'memory.candidate.created', 'memory.candidate.confirmation_required'
    ) THEN
        RAISE EXCEPTION 'append_realtime_event: event type % is not a durable non-terminal event (realtime-events catalog)',
            p_event_type;
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT * INTO v_stream FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);
    IF p_stream_epoch IS NULL OR p_stream_epoch <> v_stream.out_stream_epoch THEN
        RAISE EXCEPTION 'append_realtime_event: stream_epoch mismatch (got %, current %)',
            p_stream_epoch, v_stream.out_stream_epoch;
    END IF;

    -- Defense in depth (R1 P2-4): a terminal generation never accepts new durable
    -- events; terminal state is reached only via finalize/cancel/fail (INV-GEN-003).
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
       AND g.status IN ('INPUT_BLOCKED','COMPLETED','COMPLETED_FALLBACK','CANCELLED',
                        'OUTPUT_BLOCKED','FAILED_FINAL');
    IF FOUND THEN
        RAISE EXCEPTION 'append_realtime_event: cannot append to a terminal generation';
    END IF;

    -- Atomic allocation (P2-07): the row lock serializes concurrent appends and
    -- the stream_epoch predicate makes the epoch check race-free against a
    -- concurrent reset (a stale epoch matches zero rows and fails closed).
    -- next_seq is the post-increment high water mark, so the allocated seq is
    -- next_seq - 1 (the first event of a fresh stream is seq 1).
    UPDATE vc.realtime_stream
       SET next_seq = next_seq + 1, updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND generation_id = p_generation_id
       AND stream_epoch = p_stream_epoch
     RETURNING next_seq - 1 INTO v_seq;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'append_realtime_event: stream_epoch mismatch under lock (got %)',
            p_stream_epoch;
    END IF;

    v_row_id := nextval('vc.finalize_row_id_seq');
    INSERT INTO vc.realtime_event(
        owner_user_id, id, generation_id, event_type, payload, status,
        stream_epoch, event_seq, committed_at)
    VALUES (
        p_owner_user_id, v_row_id, p_generation_id, p_event_type, COALESCE(p_payload, '{}'::jsonb),
        'PENDING', p_stream_epoch, v_seq, now());

    RETURN v_seq;
END;
$$;

-- advance_realtime_seq: consume seq slots for non-durable events (deltas) that
-- are never persisted. This keeps next_seq a true high water mark so the gap
-- between persisted durable seqs and next_seq reflects deltas a client may have
-- missed. Returns the new next_seq.
--
-- TASK-0100 P2-07: one atomic UPDATE (row lock) so concurrent advances never
-- lose an increment.
CREATE OR REPLACE FUNCTION vc.advance_realtime_seq(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_count          integer DEFAULT 1
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_stream record;
    v_next   bigint;
BEGIN
    IF p_count IS NULL OR p_count < 0 THEN
        RAISE EXCEPTION 'advance_realtime_seq: count must be non-negative';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    SELECT * INTO v_stream FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);
    UPDATE vc.realtime_stream
       SET next_seq = next_seq + p_count, updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND generation_id = p_generation_id
     RETURNING next_seq INTO v_next;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'advance_realtime_seq: stream row vanished for generation %',
            p_generation_id;
    END IF;
    RETURN v_next;
END;
$$;

-- append_terminal_event: the shared stream allocator for terminal transitions
-- (TASK-0100 P2-09/P2-11). finalize_generation (chat.completed),
-- terminalize_generation (chat.failed / chat.blocked / chat.completed) and
-- cancel_generation (chat.cancelled) allocate the terminal event's epoch/seq
-- from the same per-generation stream high water mark, atomically, inside
-- their own terminal transaction, so the event carries a real (epoch, seq)
-- that advances the stream cursor and resume/gap semantics stay correct.
--
-- The function accepts ONLY terminal event types and is NOT granted to any
-- runtime role (REVOKE PUBLIC, no GRANT): only the SECURITY DEFINER terminal
-- functions (executed as the migration owner) can reach it, so terminal events
-- can only ever be produced by the corresponding terminal transaction.
CREATE OR REPLACE FUNCTION vc.append_terminal_event(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_event_type     text,
    p_payload        jsonb DEFAULT '{}'::jsonb
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_stream  record;
    v_seq     bigint;
    v_row_id  bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'append_terminal_event: owner_user_id and generation_id are required';
    END IF;
    IF p_event_type NOT IN ('chat.completed', 'chat.cancelled', 'chat.blocked', 'chat.failed') THEN
        RAISE EXCEPTION 'append_terminal_event: % is not a terminal event type', p_event_type;
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Defense in depth (R1 P3): a terminal event may only be written for a
    -- generation that is already terminal in this transaction — the terminal
    -- transitions (finalize / terminalize / cancel) flip the status before
    -- allocating their event, so any future caller that writes a terminal
    -- event for a non-terminal generation fails closed here.
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
       AND g.status IN ('INPUT_BLOCKED','COMPLETED','COMPLETED_FALLBACK','CANCELLED',
                        'OUTPUT_BLOCKED','FAILED_FINAL');
    IF NOT FOUND THEN
        RAISE EXCEPTION 'append_terminal_event: generation % is not terminal', p_generation_id;
    END IF;

    SELECT * INTO v_stream FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);

    UPDATE vc.realtime_stream
       SET next_seq = next_seq + 1, updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND generation_id = p_generation_id
       AND stream_epoch = v_stream.out_stream_epoch
     RETURNING next_seq - 1 INTO v_seq;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'append_terminal_event: stream row vanished for generation %',
            p_generation_id;
    END IF;

    v_row_id := nextval('vc.finalize_row_id_seq');
    INSERT INTO vc.realtime_event(
        owner_user_id, id, generation_id, event_type, payload, status,
        stream_epoch, event_seq, committed_at)
    VALUES (
        p_owner_user_id, v_row_id, p_generation_id, p_event_type,
        COALESCE(p_payload, '{}'::jsonb), 'PENDING',
        v_stream.out_stream_epoch, v_seq, now());

    RETURN v_seq;
END;
$$;

-- expire_realtime_window: advance the retained_after_seq low water mark. Events
-- at or below it have left the recoverable window; a resume whose after_seq
-- falls below it becomes GAP_EXPIRED (deterministic, testable gap detection).
CREATE OR REPLACE FUNCTION vc.expire_realtime_window(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_up_to_seq      bigint
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_retained bigint;
BEGIN
    IF p_up_to_seq IS NULL OR p_up_to_seq < 0 THEN
        RAISE EXCEPTION 'expire_realtime_window: up_to_seq must be non-negative';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    PERFORM * FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);
    -- Atomic monotonic advance (R1 P2-1): a single GREATEST-in-UPDATE prevents
    -- a lower concurrent value from moving the boundary backwards.
    UPDATE vc.realtime_stream
       SET retained_after_seq = GREATEST(retained_after_seq, p_up_to_seq),
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND generation_id = p_generation_id
    RETURNING retained_after_seq INTO v_retained;
    RETURN v_retained;
END;
$$;

-- reset_stream_epoch: bump the authoritative generation epoch and reset the
-- stream cursor (next_seq back to 1, retained window cleared). A subsequent
-- resume carrying the old epoch returns RESET_REQUIRED.
CREATE OR REPLACE FUNCTION vc.reset_stream_epoch(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_new_epoch bigint;
BEGIN
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    PERFORM * FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);

    UPDATE vc.generation
       SET stream_epoch = vc.generation.stream_epoch + 1
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id
    RETURNING stream_epoch INTO v_new_epoch;

    UPDATE vc.realtime_stream
       SET stream_epoch = v_new_epoch, next_seq = 1, retained_after_seq = 0, updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND generation_id = p_generation_id;

    RETURN v_new_epoch;
END;
$$;

-- issue_realtime_ticket: mint a single-use ticket bound to the seven-tuple. The
-- server stores only sha256(secret); the plaintext secret is returned once.
-- expires_at is now() + 45s (contract ttlSeconds).
CREATE OR REPLACE FUNCTION vc.issue_realtime_ticket(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_session_id     text,
    p_origin         text,
    p_transport      text,
    p_stream_epoch   bigint,
    p_after_seq      bigint
)
    RETURNS TABLE(out_ticket_id bigint, out_secret text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id     bigint;
    v_secret text;
    v_hash   text;
BEGIN
    IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
        RAISE EXCEPTION 'issue_realtime_ticket: session_id is required';
    END IF;
    IF p_origin IS NULL OR btrim(p_origin) = '' THEN
        RAISE EXCEPTION 'issue_realtime_ticket: origin is required';
    END IF;
    IF p_transport IS NULL OR p_transport <> 'FETCH_SSE' THEN
        RAISE EXCEPTION 'issue_realtime_ticket: transport must be FETCH_SSE';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    PERFORM * FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);

    v_secret := gen_random_uuid()::text;
    v_hash := encode(digest(v_secret, 'sha256'), 'hex');
    v_id := nextval('vc.finalize_row_id_seq');
    INSERT INTO vc.realtime_ticket(
        owner_user_id, id, ticket_hash, generation_id, session_id, origin,
        transport, stream_epoch, after_seq, expires_at)
    VALUES (
        p_owner_user_id, v_id, v_hash, p_generation_id, p_session_id, p_origin,
        p_transport, p_stream_epoch, p_after_seq, now() + interval '45 seconds');

    RETURN QUERY SELECT v_id, v_secret;
END;
$$;

-- consume_realtime_ticket: validate the secret (hash-only), the boundTo
-- seven-tuple, single-use and TTL. Every failure raises so the path fails
-- closed; the API layer surfaces NOT_FOUND_OR_FORBIDDEN. Returns true on consume.
CREATE OR REPLACE FUNCTION vc.consume_realtime_ticket(
    p_owner_user_id  bigint,
    p_ticket_id      bigint,
    p_secret         text,
    p_generation_id  bigint,
    p_session_id     text,
    p_origin         text,
    p_transport      text,
    p_stream_epoch   bigint,
    p_after_seq      bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_ticket record;
BEGIN
    IF p_secret IS NULL OR btrim(p_secret) = '' THEN
        RAISE EXCEPTION 'consume_realtime_ticket: secret is required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT * INTO v_ticket FROM vc.realtime_ticket t
     WHERE t.owner_user_id = p_owner_user_id
       AND t.id = p_ticket_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'consume_realtime_ticket: ticket not found';
    END IF;
    IF v_ticket.ticket_hash <> encode(digest(p_secret, 'sha256'), 'hex') THEN
        RAISE EXCEPTION 'consume_realtime_ticket: invalid ticket secret';
    END IF;
    IF v_ticket.generation_id <> p_generation_id
       OR v_ticket.session_id <> p_session_id
       OR v_ticket.origin <> p_origin
       OR v_ticket.transport <> p_transport
       OR v_ticket.stream_epoch <> p_stream_epoch
       OR v_ticket.after_seq <> p_after_seq THEN
        RAISE EXCEPTION 'consume_realtime_ticket: ticket boundTo mismatch';
    END IF;
    IF v_ticket.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'consume_realtime_ticket: ticket already consumed';
    END IF;
    IF now() >= v_ticket.expires_at THEN
        RAISE EXCEPTION 'consume_realtime_ticket: ticket expired';
    END IF;

    UPDATE vc.realtime_ticket
       SET consumed_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_ticket_id;
    RETURN true;
END;
$$;

-- resume_stream: the resume disposition machine. Given the client's
-- (streamEpoch, afterSeq) it returns one of:
--   NOT_FOUND_OR_FORBIDDEN -- generation invisible to this owner (RLS fail closed)
--   RESET_REQUIRED        -- requested epoch <> authoritative epoch
--   TERMINAL_SNAPSHOT     -- generation is terminal; return the snapshot + events
--   GAP_EXPIRED           -- after_seq fell below the retained window
--   RESUMED               -- return durable events with event_seq > after_seq
-- Clients advance only the last contiguous sequence (realtime-contract rule).
CREATE OR REPLACE FUNCTION vc.resume_stream(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_stream_epoch   bigint,
    p_after_seq      bigint
)
    RETURNS TABLE(out_disposition text, out_events jsonb, out_snapshot jsonb)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_g         record;
    v_stream    record;
    v_snapshot  jsonb;
    v_events    jsonb;
BEGIN
    IF p_after_seq IS NULL OR p_after_seq < 0 THEN
        RAISE EXCEPTION 'resume_stream: after_seq must be non-negative';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT g.id, g.status, g.stream_epoch, g.assistant_message_id INTO v_g
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND_OR_FORBIDDEN'::text,
            '[]'::jsonb, 'null'::jsonb;
        RETURN;
    END IF;

    IF p_stream_epoch IS NULL OR p_stream_epoch <> v_g.stream_epoch THEN
        RETURN QUERY SELECT 'RESET_REQUIRED'::text,
            '[]'::jsonb, 'null'::jsonb;
        RETURN;
    END IF;

    SELECT * INTO v_stream FROM vc.ensure_realtime_stream(p_owner_user_id, p_generation_id);

    -- Terminal generation: snapshot recovery is the only path (INV-GEN-003:
    -- terminal state is reached solely via finalize/cancel/fail, never provider
    -- EOS). The snapshot includes status, assistant message and all durable
    -- events so the client can reconstruct the full committed state.
    IF v_g.status IN ('INPUT_BLOCKED','COMPLETED','COMPLETED_FALLBACK','CANCELLED',
                      'OUTPUT_BLOCKED','FAILED_FINAL') THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'schemaVersion', 1,
                'event', e.event_type,
                'generationId', e.generation_id,
                'streamEpoch', e.stream_epoch,
                'eventSeq', e.event_seq,
                'committedAt', e.committed_at,
                'payload', e.payload
            ) ORDER BY e.committed_at, e.event_seq), '[]'::jsonb) INTO v_events
          FROM vc.realtime_event e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.generation_id = p_generation_id;
        SELECT jsonb_build_object(
                'status', v_g.status,
                'assistantMessageId', v_g.assistant_message_id,
                'generationId', v_g.id
            ) INTO v_snapshot;
        RETURN QUERY SELECT 'TERMINAL_SNAPSHOT'::text, v_events, v_snapshot;
        RETURN;
    END IF;

    -- Non-terminal: a cursor behind the retained window is an unrecoverable gap.
    IF p_after_seq < v_stream.out_retained_after_seq THEN
        RETURN QUERY SELECT 'GAP_EXPIRED'::text,
            '[]'::jsonb, 'null'::jsonb;
        RETURN;
    END IF;

    -- RESUMED: durable events strictly after the cursor, envelope-encoded and
    -- ordered so the client advances the last contiguous sequence only.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'schemaVersion', 1,
            'event', e.event_type,
            'generationId', e.generation_id,
            'streamEpoch', e.stream_epoch,
            'eventSeq', e.event_seq,
            'committedAt', e.committed_at,
            'payload', e.payload
        ) ORDER BY e.event_seq), '[]'::jsonb) INTO v_events
      FROM vc.realtime_event e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.generation_id = p_generation_id
       AND e.stream_epoch = p_stream_epoch
       AND e.event_seq > p_after_seq;

    RETURN QUERY SELECT 'RESUMED'::text, v_events, 'null'::jsonb;
END;
$$;

-- read_generation_snapshot: the snapshot endpoint recovery payload. Works for
-- any generation (terminal or not): returns status, assistant message id and
-- all durable events so the client can rebuild committed state. Raises when the
-- generation is invisible to the owner (RLS fail closed => API NOT_FOUND).
CREATE OR REPLACE FUNCTION vc.read_generation_snapshot(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS TABLE(out_status text, out_assistant_message_id bigint, out_events jsonb)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_g      record;
    v_events jsonb;
BEGIN
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    SELECT g.status, g.assistant_message_id INTO v_g
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'read_generation_snapshot: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'schemaVersion', 1,
            'event', e.event_type,
            'generationId', e.generation_id,
            'streamEpoch', e.stream_epoch,
            'eventSeq', e.event_seq,
            'committedAt', e.committed_at,
            'payload', e.payload
        ) ORDER BY e.committed_at, e.event_seq), '[]'::jsonb) INTO v_events
      FROM vc.realtime_event e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.generation_id = p_generation_id;

    RETURN QUERY SELECT v_g.status, v_g.assistant_message_id, v_events;
END;
$$;

-- Every new SECURITY DEFINER function defaults to PUBLIC EXECUTE. Revoke it so
-- only the API ingestion role may mutate realtime state (TASK-0016 P0 class).
REVOKE EXECUTE ON FUNCTION
    vc.ensure_realtime_stream(bigint, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.append_realtime_event(bigint, bigint, bigint, text, jsonb)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.advance_realtime_seq(bigint, bigint, integer)
    FROM PUBLIC;
-- TASK-0100 P2-09/P2-11: terminal-event allocator is intentionally NOT granted
-- to any role (owner-only). Only the SECURITY DEFINER terminal functions
-- (finalize / terminalize / cancel) may produce terminal events.
REVOKE EXECUTE ON FUNCTION
    vc.append_terminal_event(bigint, bigint, text, jsonb)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.expire_realtime_window(bigint, bigint, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.reset_stream_epoch(bigint, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.issue_realtime_ticket(bigint, bigint, text, text, text, bigint, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.consume_realtime_ticket(bigint, bigint, text, bigint, text, text, text, bigint, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.resume_stream(bigint, bigint, bigint, bigint)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
    vc.read_generation_snapshot(bigint, bigint)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.ensure_realtime_stream(bigint, bigint),
    vc.append_realtime_event(bigint, bigint, bigint, text, jsonb),
    vc.advance_realtime_seq(bigint, bigint, integer),
    vc.expire_realtime_window(bigint, bigint, bigint),
    vc.reset_stream_epoch(bigint, bigint),
    vc.issue_realtime_ticket(bigint, bigint, text, text, text, bigint, bigint),
    vc.consume_realtime_ticket(bigint, bigint, text, bigint, text, text, text, bigint, bigint),
    vc.resume_stream(bigint, bigint, bigint, bigint),
    vc.read_generation_snapshot(bigint, bigint)
    TO vc_api;
