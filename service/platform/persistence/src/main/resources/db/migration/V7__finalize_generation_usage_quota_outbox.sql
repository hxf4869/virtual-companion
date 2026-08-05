-- TASK-0018 V7: finalize_generation atomic transaction with Usage/Quota/Outbox.
--
-- Adds four composite-owned, FORCE-RLS tables (generation_usage, quota_ledger_entry,
-- realtime_event, outbox_event) and the SECURITY DEFINER finalize_generation
-- transaction. After precondition checks (generation in FINAL_REVIEW, candidate
-- belongs to it) the function atomically writes: the final assistant message,
-- the selected candidate is_final flag (INV-GEN-002 partial unique index backs
-- "at most one final"), the Generation terminal state COMPLETED + assistant id,
-- provider usage + actual cost, a SETTLE quota ledger entry, a durable
-- chat.completed realtime event left PENDING (never published before commit),
-- and an eligible memory.extract outbox event. INV-TX-001 (atomic) and
-- INV-GEN-003 (provider EOS never completes) live here.
--
-- A p_fault hook raises AFTER the writes so a fault-injection test proves the
-- whole transaction rolls back; chat.completed is only ever PENDING in the DB
-- and the realtime dispatcher publishes it post-commit (out of scope here).

SET search_path TO vc, public;

-- finalize binds the final assistant message to its generation. NULL until
-- finalize_generation writes it; the composite FK keeps the link owner-consistent.
ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS assistant_message_id bigint;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'generation_assistant_message_fk'
           AND conparentid = 0
    ) THEN
        ALTER TABLE vc.generation
            ADD CONSTRAINT generation_assistant_message_fk
            FOREIGN KEY (owner_user_id, assistant_message_id)
            REFERENCES vc.message(owner_user_id, id)
            ON DELETE SET NULL (assistant_message_id);
    END IF;
END $$;

-- Provider attempt usage + actual cost, settled atomically with finalize.
CREATE TABLE IF NOT EXISTS vc.generation_usage (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    provider_ref    text NOT NULL,
    input_tokens    bigint NOT NULL DEFAULT 0,
    output_tokens   bigint NOT NULL DEFAULT 0,
    actual_cost     numeric(18,6) NOT NULL DEFAULT 0,
    currency        text NOT NULL DEFAULT 'USD',
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE
);

-- Quota ledger: SETTLE on finalize (RELEASE is a later runtime path).
CREATE TABLE IF NOT EXISTS vc.quota_ledger_entry (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    kind            text NOT NULL,
    quota_amount    integer NOT NULL DEFAULT 0,
    reason          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT quota_ledger_kind CHECK (kind IN ('SETTLE', 'RELEASE'))
);

-- Durable realtime events. chat.completed is written PENDING; a post-commit
-- dispatcher publishes it (never published inside the finalize transaction).
CREATE TABLE IF NOT EXISTS vc.realtime_event (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    event_type      text NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'PENDING',
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT realtime_event_status CHECK (status IN ('PENDING', 'PUBLISHED'))
);

-- Transactional outbox: memory.extract / conversation.summary requested by
-- finalize, materialized into work items post-commit (out of scope here).
CREATE TABLE IF NOT EXISTS vc.outbox_event (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    event_type      text NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'PENDING',
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT outbox_event_status CHECK (status IN ('PENDING', 'PUBLISHED'))
);

-- Monotonic id sequence shared by the four finalize-side tables (safe under
-- composite (owner_user_id, id) primary keys).
CREATE SEQUENCE IF NOT EXISTS vc.finalize_row_id_seq AS bigint;

-- FORCE ROW LEVEL SECURITY + owner_isolation on every new owned table, matching
-- the V2 baseline. A missing tenant context matches nothing (fail closed).
DO $$
DECLARE
    t text;
    owned text[] := ARRAY['generation_usage','quota_ledger_entry','realtime_event','outbox_event'];
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

GRANT USAGE ON SCHEMA vc TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON vc.generation_usage, vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT USAGE, SELECT ON SEQUENCE vc.finalize_row_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- finalize_generation: the single atomic entry point that takes a FINAL_REVIEW
-- generation to COMPLETED and writes every finalize artifact or none of them.
-- Output columns are out_-prefixed so the RETURNS TABLE names never shadow the
-- table columns inside the body (TASK-0017 lesson).
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
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL OR p_final_candidate_id IS NULL THEN
        RAISE EXCEPTION 'owner_user_id, generation_id and final_candidate_id are required';
    END IF;
    -- Bind tenant context so FORCE RLS WITH CHECK passes for the definer and
    -- reads in the same transaction stay owner-scoped.
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Precondition: the generation exists for this owner.
    SELECT g.conversation_id, g.status INTO v_conv_id, v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'finalize: generation % not found for owner %', p_generation_id, p_owner_user_id;
    END IF;

    -- INV-GEN-003: only a generation past final review may be completed. A
    -- generation still IN_PROGRESS at provider EOS fails here, so EOS can never
    -- imply chat.completed.
    IF v_status <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'finalize: generation must be in FINAL_REVIEW (current %)', v_status;
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

    -- Final assistant message.
    v_msg_id := nextval('vc.message_id_seq');
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (p_owner_user_id, v_msg_id, v_conv_id, 'assistant', p_assistant_content);

    -- Generation terminal state + assistant binding.
    UPDATE vc.generation
       SET status = 'COMPLETED', assistant_message_id = v_msg_id
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

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

    -- Durable chat.completed, PENDING only (published post-commit).
    INSERT INTO vc.realtime_event(
        owner_user_id, id, generation_id, event_type, payload, status)
    VALUES (
        p_owner_user_id, nextval('vc.finalize_row_id_seq'), p_generation_id,
        'chat.completed',
        jsonb_build_object('generation_id', p_generation_id, 'assistant_message_id', v_msg_id),
        'PENDING');

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

-- finalize_generation defaults to PUBLIC EXECUTE. Revoke it so only the API
-- ingestion role may complete a generation (matches the V5/V6 pattern and the
-- TASK-0016 P0 lesson).
REVOKE EXECUTE ON FUNCTION
    vc.finalize_generation(bigint, bigint, bigint, text, text, bigint, bigint, numeric, text, integer, boolean, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.finalize_generation(bigint, bigint, bigint, text, text, bigint, bigint, numeric, text, integer, boolean, text)
    TO vc_api;
