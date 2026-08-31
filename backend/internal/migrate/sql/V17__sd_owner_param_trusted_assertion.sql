-- TASK-0154 V17: SECURITY DEFINER owner parameter trusted assertion (P1-04).
--
-- Closes the caller-forgery gap (P1-04): all 34 SECURITY DEFINER functions that
-- accepted p_owner_user_id previously trusted the caller-supplied value and
-- bound it via set_config. V17 redefines every one of them to REQUIRE that
-- vc.owner_user_id was already set by a server-trusted path (runtime request
-- filter / SET LOCAL) and that p_owner_user_id matches it exactly. The internal
-- set_config('vc.owner_user_id') is removed; context must be established before
-- the call. A NULL or mismatched context raises immediately (fail-closed).
--
-- claim_work_items is the only function that also bound vc.job_fence; that
-- binding is preserved (only the owner set_config is removed).
--
-- Function signatures, RETURNS, LANGUAGE, SECURITY DEFINER and search_path are
-- unchanged. No GRANT/REVOKE (V5-V15 already set EXECUTE correctly). No RLS,
-- table-structure or V1-V16 migration changes (migration history checksum safe).

SET search_path TO vc, public;

-- ============================================================================
-- V5: claim_work_items (owner set_config removed; job_fence set_config kept).
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.claim_work_items(
    p_owner_user_id bigint,
    p_fence text,
    p_lease_seconds integer DEFAULT 30,
    p_limit integer DEFAULT 16
)
    RETURNS TABLE(owner_user_id bigint, id bigint, kind text, ref_id bigint,
                  payload bytea, claim_token text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_token text := gen_random_uuid()::text;
BEGIN
    -- A stale or empty fence refuses to establish a job context (TASK-0015
    -- fail-closed skeleton extended here).
    IF p_fence IS NULL OR btrim(p_fence) = '' OR p_fence = 'STALE' THEN
        RAISE EXCEPTION 'stale or missing fence refuses work claim';
    END IF;
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    PERFORM set_config('vc.job_fence', p_fence, true);

    RETURN QUERY
    WITH picked AS (
        SELECT wi.id
        FROM vc.work_item wi
        WHERE wi.owner_user_id = p_owner_user_id
          AND wi.status = 'PENDING'
        ORDER BY wi.id
        FOR UPDATE OF wi SKIP LOCKED
        LIMIT GREATEST(p_limit, 1)
    )
    UPDATE vc.work_item u
       SET status = 'CLAIMED',
           claim_token = v_token,
           claim_fence = p_fence,
           claimed_at = now(),
           lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 1))
      FROM picked
     WHERE u.owner_user_id = p_owner_user_id
       AND u.id = picked.id
    RETURNING u.owner_user_id, u.id, u.kind, u.ref_id, u.payload, v_token;
END;
$$;

-- ============================================================================
-- V6: receive_generation.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.receive_generation(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_idempotency_key text,
    p_user_role       text DEFAULT 'user',
    p_user_content    text DEFAULT ''
)
    RETURNS TABLE(logical_generation_id text, generation_id bigint,
                  message_id bigint, created boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_logical text;
    v_gen_id  bigint;
    v_msg_id  bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_id is required to receive a generation';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        -- Pre-compute the stable logical id + primary key so the INSERT needs no
        -- RETURNING (the RETURNS TABLE output column names would otherwise
        -- shadow the table columns inside the function body). First reception
        -- races to insert; ON CONFLICT DO NOTHING turns a concurrent or duplicate
        -- first-reception into a no-op, detected via FOUND.
        v_logical := 'gen_' || gen_random_uuid()::text;
        v_gen_id  := nextval('vc.generation_id_seq');
        INSERT INTO vc.generation
            (owner_user_id, id, conversation_id, logical_generation_id,
             status, idempotency_key)
        VALUES
            (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
             'CREATED', p_idempotency_key)
        ON CONFLICT (owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
        DO NOTHING;

        IF FOUND THEN
            -- Won the race: this is the first reception. Create the user message.
            v_msg_id := nextval('vc.message_id_seq');
            INSERT INTO vc.message
                (owner_user_id, id, conversation_id, role, content)
            VALUES
                (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
            RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
            RETURN;
        END IF;

        -- Duplicate reception (same owner + key): resolve the existing stable
        -- logical_generation_id and create NO new message. Columns are
        -- alias-qualified to avoid any output-column name shadowing.
        SELECT g.logical_generation_id, g.id INTO v_logical, v_gen_id
          FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT v_logical, v_gen_id, NULL::bigint, false;
        RETURN;
    END IF;

    -- No idempotency key: always create a fresh generation and user message.
    v_gen_id  := nextval('vc.generation_id_seq');
    v_logical := 'gen_' || gen_random_uuid()::text;
    v_msg_id  := nextval('vc.message_id_seq');
    INSERT INTO vc.generation
        (owner_user_id, id, conversation_id, logical_generation_id,
         status, idempotency_key)
    VALUES
        (p_owner_user_id, v_gen_id, p_conversation_id, v_logical, 'CREATED', NULL);
    INSERT INTO vc.message
        (owner_user_id, id, conversation_id, role, content)
    VALUES
        (p_owner_user_id, v_msg_id, p_conversation_id, p_user_role, p_user_content);
    RETURN QUERY SELECT v_logical, v_gen_id, v_msg_id, true;
END;
$$;

-- ============================================================================
-- V7: finalize_generation.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.finalize_generation(
    p_owner_user_id      bigint,
    p_generation_id      bigint,
    p_final_candidate_id bigint,
    p_assistant_content  text,
    p_provider_ref       text   DEFAULT '',
    p_input_tokens       bigint DEFAULT 0,
    p_output_tokens      bigint DEFAULT 0,
    p_actual_cost        numeric DEFAULT 0,
    p_currency           text   DEFAULT 'USD',
    p_quota_amount       integer DEFAULT 0,
    p_outbox_eligible    boolean DEFAULT true,
    p_fault              text   DEFAULT NULL
)
    RETURNS TABLE(out_generation_id bigint, out_assistant_message_id bigint, out_finalized boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_conv_id bigint;
    v_status  text;
    v_msg_id  bigint;
    v_assistant_message_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL OR p_final_candidate_id IS NULL THEN
        RAISE EXCEPTION 'owner_user_id, generation_id and final_candidate_id are required';
    END IF;

    -- TASK-0098 P1-03: lock the generation row FIRST so every terminal
    -- transition (finalize / cancel_generation / terminalize_generation)
    -- serializes on the same row and the status re-check below cannot be
    -- split by a concurrent writer. Without the lock, two sessions could both
    -- observe FINAL_REVIEW and both write COMPLETED plus duplicate
    -- message/usage/quota/event/outbox artifacts.
    SELECT g.conversation_id, g.status, g.assistant_message_id
      INTO v_conv_id, v_status, v_assistant_message_id
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'finalize: generation % not found for owner %', p_generation_id, p_owner_user_id;
    END IF;

    -- INV-GEN-003 + P1-03: only a generation still in FINAL_REVIEW under our
    -- lock may be completed. A concurrent cancel/terminalize winner surfaces
    -- here as its terminal state and fails closed, so a later finalize can
    -- never overwrite CANCELLED / OUTPUT_BLOCKED / FAILED_FINAL (terminal
    -- states are not rewritable). A generation still IN_PROGRESS at provider
    -- EOS fails here, so EOS can never imply chat.completed.
    IF v_status <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'finalize: generation must be in FINAL_REVIEW (current %)', v_status;
    END IF;

    -- INV-GEN-002 idempotency guard: at most one final assistant message per
    -- generation. assistant_message_id is only ever set by finalize, so a
    -- non-NULL value here means this generation was already finalized.
    IF v_assistant_message_id IS NOT NULL THEN
        RAISE EXCEPTION 'finalize: generation % already has a final assistant message (id %)',
            p_generation_id, v_assistant_message_id;
    END IF;

    -- Precondition: the chosen candidate belongs to this generation.
    IF NOT EXISTS (
        SELECT 1 FROM vc.generation_candidate c
         WHERE c.owner_user_id = p_owner_user_id
           AND c.generation_id = p_generation_id
           AND c.id = p_final_candidate_id
    ) THEN
        RAISE EXCEPTION 'finalize: final candidate % not found for generation %',
            p_final_candidate_id, p_generation_id;
    END IF;

    -- INV-GEN-002: marking the candidate final relies on the partial unique
    -- index generation_candidate_one_final; a second final for one generation
    -- raises unique_violation and aborts the whole transaction.
    UPDATE vc.generation_candidate
       SET is_final = true
     WHERE owner_user_id = p_owner_user_id
       AND generation_id = p_generation_id
       AND id = p_final_candidate_id;

    -- Final assistant message, bound to its generation. The partial unique
    -- index message_generation_one_final (INV-GEN-002) rejects a second final
    -- assistant message for the same generation.
    v_msg_id := nextval('vc.message_id_seq');
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, generation_id)
    VALUES (p_owner_user_id, v_msg_id, v_conv_id, 'assistant', p_assistant_content, p_generation_id);

    -- Conditional UPDATE winner (P1-03): the status predicate is the
    -- machine-readable winner condition. Under the row lock it always matches;
    -- if a future code path drops the lock, the UPDATE still fails closed
    -- instead of overwriting a terminal state.
    UPDATE vc.generation
       SET status = 'COMPLETED', assistant_message_id = v_msg_id
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id
       AND status = 'FINAL_REVIEW';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'finalize: generation % lost the terminal transition race (status no longer FINAL_REVIEW)',
            p_generation_id;
    END IF;

    -- Usage + actual cost.
    INSERT INTO vc.generation_usage(
        owner_user_id, id, generation_id, provider_ref,
        input_tokens, output_tokens, actual_cost, currency)
    VALUES (
        p_owner_user_id, nextval('vc.finalize_row_id_seq'), p_generation_id, p_provider_ref,
        p_input_tokens, p_output_tokens, p_actual_cost, p_currency);

    -- Quota settlement.
    INSERT INTO vc.quota_ledger_entry(
        owner_user_id, id, generation_id, kind, quota_amount, reason)
    VALUES (
        p_owner_user_id, nextval('vc.finalize_row_id_seq'), p_generation_id,
        'SETTLE', p_quota_amount, 'finalize');

    -- Durable chat.completed, PENDING only (published post-commit). TASK-0100
    -- P2-09: allocated from the shared stream allocator inside this terminal
    -- transaction, so the event carries the real (stream_epoch, event_seq) and
    -- the stream high water mark advances atomically with the terminal state.
    PERFORM vc.append_terminal_event(
        p_owner_user_id, p_generation_id, 'chat.completed',
        jsonb_build_object('generation_id', p_generation_id, 'assistant_message_id', v_msg_id));

    -- Eligible outbox event (memory.extract.requested).
    IF p_outbox_eligible THEN
        INSERT INTO vc.outbox_event(
            owner_user_id, id, generation_id, event_type, payload, status)
        VALUES (
            p_owner_user_id, nextval('vc.finalize_row_id_seq'), p_generation_id,
            'memory.extract.requested',
            jsonb_build_object('generation_id', p_generation_id),
            'PENDING');
    END IF;

    -- Fault injection: raise AFTER every write so a test can prove the entire
    -- transaction (messages, candidate flag, terminal state, usage, quota,
    -- realtime, outbox) rolls back together. INV-TX-001.
    IF p_fault IS NOT NULL THEN
        RAISE EXCEPTION 'finalize fault injection: %', p_fault;
    END IF;

    RETURN QUERY SELECT p_generation_id, v_msg_id, true;
END;
$$;

-- ============================================================================
-- V8: ensure_realtime_stream.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'ensure_realtime_stream: owner_user_id and generation_id are required';
    END IF;

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

-- ============================================================================
-- V8: append_realtime_event.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
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

-- ============================================================================
-- V8: advance_realtime_seq.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_count IS NULL OR p_count < 0 THEN
        RAISE EXCEPTION 'advance_realtime_seq: count must be non-negative';
    END IF;
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

-- ============================================================================
-- V8: append_terminal_event.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'append_terminal_event: owner_user_id and generation_id are required';
    END IF;
    IF p_event_type NOT IN ('chat.completed', 'chat.cancelled', 'chat.blocked', 'chat.failed') THEN
        RAISE EXCEPTION 'append_terminal_event: % is not a terminal event type', p_event_type;
    END IF;

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

-- ============================================================================
-- V8: expire_realtime_window.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_up_to_seq IS NULL OR p_up_to_seq < 0 THEN
        RAISE EXCEPTION 'expire_realtime_window: up_to_seq must be non-negative';
    END IF;
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

-- ============================================================================
-- V8: reset_stream_epoch.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
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

-- ============================================================================
-- V8: issue_realtime_ticket.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
        RAISE EXCEPTION 'issue_realtime_ticket: session_id is required';
    END IF;
    IF p_origin IS NULL OR btrim(p_origin) = '' THEN
        RAISE EXCEPTION 'issue_realtime_ticket: origin is required';
    END IF;
    IF p_transport IS NULL OR p_transport <> 'FETCH_SSE' THEN
        RAISE EXCEPTION 'issue_realtime_ticket: transport must be FETCH_SSE';
    END IF;
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

-- ============================================================================
-- V8: consume_realtime_ticket.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_secret IS NULL OR btrim(p_secret) = '' THEN
        RAISE EXCEPTION 'consume_realtime_ticket: secret is required';
    END IF;

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

-- ============================================================================
-- V8: resume_stream.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_after_seq IS NULL OR p_after_seq < 0 THEN
        RAISE EXCEPTION 'resume_stream: after_seq must be non-negative';
    END IF;

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

-- ============================================================================
-- V8: read_generation_snapshot.
-- ============================================================================
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
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
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

-- ============================================================================
-- V9: create_relationship.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.create_relationship(
    p_owner_user_id bigint,
    p_persona_ref   text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_persona_ref IS NULL OR btrim(p_persona_ref) = '' THEN
        RAISE EXCEPTION 'create_relationship: persona_ref is required';
    END IF;

    -- Serialize per-owner lifecycle mutations. Collisions across owners only
    -- over-serialize and never affect correctness; the partial unique index is
    -- the invariant, the lock only yields clean non-error returns.
    PERFORM pg_advisory_xact_lock(hashtext('vc.relationship.active:' || p_owner_user_id::text));

    -- Deactivate the owner's current active Companion (at most one under Alpha).
    UPDATE vc.relationship
       SET active = false
     WHERE owner_user_id = p_owner_user_id
       AND active;

    v_id := nextval('vc.relationship_id_seq');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (p_owner_user_id, v_id, p_persona_ref, true);
    RETURN v_id;
END;
$$;

-- ============================================================================
-- V9: get_relationship.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.get_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS TABLE(out_id bigint, out_persona_ref text,
                  out_active boolean, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_rel_id IS NULL THEN
        RAISE EXCEPTION 'get_relationship: owner_user_id and relationship id are required';
    END IF;
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
           AND r.id = p_rel_id;
END;
$$;

-- ============================================================================
-- V9: list_relationships.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.list_relationships(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_persona_ref text,
                  out_active boolean, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
         ORDER BY r.created_at, r.id;
END;
$$;

-- ============================================================================
-- V9: activate_relationship.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.activate_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_rel_id IS NULL THEN
        RAISE EXCEPTION 'activate_relationship: owner_user_id and relationship id are required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('vc.relationship.active:' || p_owner_user_id::text));

    -- Lock the target row and confirm ownership (FOR UPDATE prevents a
    -- concurrent mutation from changing it under us). A foreign/absent id
    -- matches nothing under RLS, so existence is never disclosed.
    PERFORM 1
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.id = p_rel_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'activate_relationship: relationship % not found for owner %',
            p_rel_id, p_owner_user_id;
    END IF;

    -- Deactivate every other active relationship, then activate the target. The
    -- partial unique index is satisfied throughout: after the first UPDATE no
    -- *other* row is active, so setting the target active yields exactly one.
    UPDATE vc.relationship
       SET active = false
     WHERE owner_user_id = p_owner_user_id
       AND active
       AND id <> p_rel_id;
    UPDATE vc.relationship
       SET active = true
     WHERE owner_user_id = p_owner_user_id
       AND id = p_rel_id;
    RETURN true;
END;
$$;

-- ============================================================================
-- V9: deactivate_relationship.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.deactivate_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_rel_id IS NULL THEN
        RAISE EXCEPTION 'deactivate_relationship: owner_user_id and relationship id are required';
    END IF;
    UPDATE vc.relationship
       SET active = false
     WHERE owner_user_id = p_owner_user_id
       AND id = p_rel_id;
    RETURN FOUND;
END;
$$;

-- ============================================================================
-- V10: cancel_generation.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.cancel_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
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

-- ============================================================================
-- V10: list_messages.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.list_messages(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_role text,
                  out_content text, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'list_messages: owner_user_id and conversation_id are required';
    END IF;

    -- Clamp the page size into a safe band; defaults are applied for NULL/empty.
    IF p_limit IS NULL OR p_limit < 1 THEN
        p_limit := 50;
    END IF;
    IF p_limit > 100 THEN
        p_limit := 100;
    END IF;
    IF p_after_id IS NULL THEN
        p_after_id := 0;
    END IF;

    RETURN QUERY
        SELECT m.id, m.role, m.content, m.created_at
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.conversation_id = p_conversation_id
           AND m.id > p_after_id
         ORDER BY m.id
         LIMIT p_limit;
END;
$$;

-- ============================================================================
-- V11: create_memory_candidate.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.create_memory_candidate(
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
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
    v_evidence text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: owner_user_id and relationship_id are required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'create_memory_candidate: summary is required';
    END IF;
    -- Alpha scope gate. ACCOUNT_PRIVATE/ACCOUNT_SHARED are not enabled in Alpha.
    IF p_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'create_memory_candidate: scope % is not enabled in Alpha', p_scope;
    END IF;
    -- SESSION requires a conversation binding (structural + redundant function check).
    IF p_scope = 'SESSION' AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: SESSION scope requires a conversation_id';
    END IF;

    -- The relationship (and, for SESSION, the conversation) must belong to this
    -- owner; FORCE RLS makes a foreign id resolve to no row.
    PERFORM 1 FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_memory_candidate: relationship % not found for owner %',
            p_relationship_id, p_owner_user_id;
    END IF;
    IF p_scope = 'SESSION' THEN
        PERFORM 1 FROM vc.conversation c
          WHERE c.owner_user_id = p_owner_user_id AND c.id = p_conversation_id
            AND c.relationship_id = p_relationship_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'create_memory_candidate: conversation % not found for owner/relationship',
                p_conversation_id;
        END IF;
    END IF;

    v_id := nextval('vc.memory_id_seq');
    INSERT INTO vc.memory_item(
        owner_user_id, id, relationship_id, scope, summary, status, conversation_id)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'PENDING_CONFIRMATION', p_conversation_id);

    -- Evidence chain: each cited source becomes a memory_evidence row.
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

-- ============================================================================
-- V11: confirm_memory_candidate.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.confirm_memory_candidate(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
    v_deleted timestamptz;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'confirm_memory_candidate: owner_user_id and memory_id are required';
    END IF;

    SELECT m.status, m.deleted_at INTO v_status, v_deleted
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id AND m.id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'confirm_memory_candidate: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    IF v_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'confirm_memory_candidate: memory % is deleted', p_memory_id;
    END IF;
    IF v_status <> 'PENDING_CONFIRMATION' THEN
        RAISE EXCEPTION 'confirm_memory_candidate: memory % is not pending confirmation (status %)',
            p_memory_id, v_status;
    END IF;

    UPDATE vc.memory_item
       SET status = 'ACCEPTED'
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ============================================================================
-- V11: reject_memory_candidate.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.reject_memory_candidate(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
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
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'reject_memory_candidate: owner_user_id and memory_id are required';
    END IF;

    SELECT m.status INTO v_status
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id AND m.id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reject_memory_candidate: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    IF v_status <> 'PENDING_CONFIRMATION' THEN
        RAISE EXCEPTION 'reject_memory_candidate: memory % is not pending confirmation (status %)',
            p_memory_id, v_status;
    END IF;

    UPDATE vc.memory_item
       SET status = 'REJECTED'
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ============================================================================
-- V11: delete_memory (V11 original; superseded by V12 version below).
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.delete_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'delete_memory: owner_user_id and memory_id are required';
    END IF;

    UPDATE vc.memory_item
       SET deleted_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        -- Either foreign/absent, or already deleted. Existence is not disclosed.
        RAISE EXCEPTION 'delete_memory: memory % not found (or already deleted) for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    RETURN TRUE;
END;
$$;

-- ============================================================================
-- V11: list_memory.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.list_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_include_deleted boolean DEFAULT false
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_status text, out_conversation_id bigint,
                  out_deleted_at timestamptz, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
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
               m.deleted_at, m.created_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND (p_include_deleted OR m.deleted_at IS NULL)
         ORDER BY m.created_at, m.id;
END;
$$;

-- ============================================================================
-- V11: get_memory.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.get_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_scope text,
                  out_summary text, out_status text, out_conversation_id bigint,
                  out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
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
               m.conversation_id, m.created_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_memory_id
           AND m.deleted_at IS NULL;
END;
$$;

-- ============================================================================
-- V12: update_memory.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.update_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint,
    p_summary       text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status  text;
    v_deleted timestamptz;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'update_memory: owner_user_id and memory_id are required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'update_memory: summary is required and must not be blank';
    END IF;

    SELECT m.status, m.deleted_at INTO v_status, v_deleted
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id AND m.id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'update_memory: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    IF v_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'update_memory: memory % is deleted', p_memory_id;
    END IF;
    IF v_status NOT IN ('PENDING_CONFIRMATION', 'ACCEPTED') THEN
        RAISE EXCEPTION 'update_memory: memory % is in non-editable status %',
            p_memory_id, v_status;
    END IF;

    UPDATE vc.memory_item
       SET summary = p_summary
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ============================================================================
-- V12: list_memory_evidence.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.list_memory_evidence(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS TABLE(out_id bigint, out_source_ref text, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'list_memory_evidence: owner_user_id and memory_id are required';
    END IF;

    RETURN QUERY
        SELECT e.id, e.source_ref, e.created_at
          FROM vc.memory_evidence e
          JOIN vc.memory_item m
            ON m.owner_user_id = e.owner_user_id
           AND m.id = e.memory_item_id
         WHERE e.owner_user_id = p_owner_user_id
           AND e.memory_item_id = p_memory_id
           AND m.deleted_at IS NULL
         ORDER BY e.id;
END;
$$;

-- ============================================================================
-- V12: delete_memory (idempotent version; supersedes the V11 definition).
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.delete_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'delete_memory: owner_user_id and memory_id are required';
    END IF;

    -- Lock the owned row if it exists. A foreign or absent id resolves to no
    -- row; existence is not disclosed.
    PERFORM 1
      FROM vc.memory_item
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'delete_memory: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;

    -- Idempotent: if already soft-deleted this affects 0 rows and we still
    -- return TRUE (matching the V11 documented intent).
    UPDATE vc.memory_item
       SET deleted_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
       AND deleted_at IS NULL;
    RETURN TRUE;
END;
$$;

-- ============================================================================
-- V13: recall_memory.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.recall_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_conversation_id bigint DEFAULT NULL,
    p_max_entries     int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_conversation_id bigint, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_limit int;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'recall_memory: owner_user_id and relationship_id are required';
    END IF;

    -- Budget clamp to a safe band. The entries upper bound mirrors the
    -- ContextBudget shape; exact token budgeting is the runtime consumer's job.
    v_limit := LEAST(GREATEST(p_max_entries, 1), 100);

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.conversation_id, m.created_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND (
                    m.scope = 'RELATIONSHIP'
                 OR (    m.scope = 'SESSION'
                     AND p_conversation_id IS NOT NULL
                     AND m.conversation_id = p_conversation_id)
           )
         ORDER BY m.scope, m.created_at, m.id
         LIMIT v_limit;
END;
$$;

-- ============================================================================
-- V15: record_provider_attempt.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.record_provider_attempt(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_provider_id    text,
    p_supplier_name  text,
    p_status         text
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'record_provider_attempt: owner_user_id and generation_id are required';
    END IF;
    IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: provider_id is required';
    END IF;
    IF p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: supplier_name is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'CREATED','CONNECTING','STREAMING','EOS_RECEIVED','SUCCEEDED',
        'RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT',
        'CANCEL_REQUESTED','CANCELLED','ABANDONED_LATE'
    ) THEN
        RAISE EXCEPTION 'record_provider_attempt: unsupported status %', p_status;
    END IF;

    -- The generation must exist for this owner (existence hidden otherwise).
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_provider_attempt: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    v_id := nextval('vc.provider_attempt_id_seq');
    INSERT INTO vc.provider_attempt(
        owner_user_id, id, generation_id, provider_id, supplier_name, status)
    VALUES (
        p_owner_user_id, v_id, p_generation_id,
        p_provider_id, p_supplier_name, p_status);

    RETURN QUERY SELECT v_id, p_owner_user_id;
END;
$$;

-- ============================================================================
-- V15: terminalize_generation.
-- ============================================================================
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
    SET search_path = vc, public
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
    IF p_to_status NOT IN ('FAILED_FINAL','OUTPUT_BLOCKED','COMPLETED_FALLBACK') THEN
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

    -- generation-states.yaml legal edges for these three terminal states:
    --   FAILED_FINAL        <- IN_PROGRESS, WAITING_FOR_CAPACITY, COMMITTING
    --   OUTPUT_BLOCKED      <- FINAL_REVIEW
    --   COMPLETED_FALLBACK  <- COMMITTING
    IF NOT (
        (p_to_status = 'FAILED_FINAL'
            AND v_status IN ('IN_PROGRESS','WAITING_FOR_CAPACITY','COMMITTING'))
        OR (p_to_status = 'OUTPUT_BLOCKED' AND v_status = 'FINAL_REVIEW')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND v_status = 'COMMITTING')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: illegal transition % -> %',
            v_status, p_to_status;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

    -- Durable terminal event, PENDING only (published post-commit), matching
    -- finalize_generation's chat.completed (V7). TASK-0100 P2-09: allocated
    -- from the shared stream allocator inside this terminal transaction so the
    -- event carries the real (stream_epoch, event_seq).
    PERFORM vc.append_terminal_event(
        p_owner_user_id, p_generation_id, p_event_type,
        COALESCE(p_payload, '{}'::jsonb));

    RETURN p_to_status;
END;
$$;

-- ============================================================================
-- V15: insert_generation_candidate.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.insert_generation_candidate(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_content        text,
    p_is_final       boolean DEFAULT false
)
    RETURNS TABLE(out_candidate_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
    v_id     bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'insert_generation_candidate: owner_user_id and generation_id are required';
    END IF;
    IF p_content IS NULL OR btrim(p_content) = '' THEN
        RAISE EXCEPTION 'insert_generation_candidate: content is required';
    END IF;

    -- P2-10: lock the generation row before checking status so a concurrent
    -- finalize/cancel/terminalize winner is observed under our lock instead of
    -- racing the insert.
    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'insert_generation_candidate: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;
    IF v_status IN ('INPUT_BLOCKED','COMPLETED','COMPLETED_FALLBACK','CANCELLED',
                    'OUTPUT_BLOCKED','FAILED_FINAL') THEN
        RAISE EXCEPTION 'insert_generation_candidate: cannot insert into a terminal generation';
    END IF;

    v_id := nextval('vc.generation_candidate_id_seq');
    INSERT INTO vc.generation_candidate(
        owner_user_id, id, generation_id, content, is_final)
    VALUES (
        p_owner_user_id, v_id, p_generation_id, p_content, COALESCE(p_is_final, false));

    RETURN QUERY SELECT v_id;
END;
$$;

-- ============================================================================
-- V15: record_quota_release.
-- ============================================================================
CREATE OR REPLACE FUNCTION vc.record_quota_release(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_quota_amount   integer,
    p_reason         text
)
    RETURNS TABLE(out_entry_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
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

    v_id := nextval('vc.finalize_row_id_seq');
    INSERT INTO vc.quota_ledger_entry(
        owner_user_id, id, generation_id, kind, quota_amount, reason)
    VALUES (
        p_owner_user_id, v_id, p_generation_id, 'RELEASE', p_quota_amount, p_reason);

    RETURN QUERY SELECT v_id;
END;
$$;

-- ============================================================================
-- V17 summary: 34 SECURITY DEFINER functions redefined with the trusted-owner
-- assertion. Each had its internal set_config('vc.owner_user_id') removed; the
-- caller-supplied p_owner_user_id is now validated against the server-trusted
-- vc.current_owner_id() context (fail-closed on NULL or mismatch).
--
-- V5:  claim_work_items                         (job_fence set_config preserved)
-- V6:  receive_generation
-- V7:  finalize_generation
-- V8:  ensure_realtime_stream
--      append_realtime_event
--      advance_realtime_seq
--      append_terminal_event
--      expire_realtime_window
--      reset_stream_epoch
--      issue_realtime_ticket
--      consume_realtime_ticket
--      resume_stream
--      read_generation_snapshot
-- V9:  create_relationship
--      get_relationship
--      list_relationships
--      activate_relationship
--      deactivate_relationship
-- V10: cancel_generation
--      list_messages
-- V11: create_memory_candidate
--      confirm_memory_candidate
--      reject_memory_candidate
--      delete_memory
--      list_memory
--      get_memory
-- V12: update_memory
--      list_memory_evidence
--      delete_memory
-- V13: recall_memory
-- V15: record_provider_attempt
--      terminalize_generation
--      insert_generation_candidate
--      record_quota_release
-- ============================================================================
