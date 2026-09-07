-- V133: memory extraction outbound + usage boundary (audit N-04).
--
-- The extraction handler previously called the provider after only a handler-
-- phase OutboundCheck and dropped the returned usage. Three gaps are closed
-- here, all inside the existing extraction job (no new worker kind):
--
--   * go_read_memory_extract_input gains the persisted egress fact
--     vc.message.model_eligible (V112): a blocked/cancelled turn's messages
--     must never enter any provider request, including extraction. The
--     function is dropped and recreated (the added output column changes the
--     return type, which CREATE OR REPLACE cannot do; V125 stays untouched);
--     the handler closes the turn DONE when the source is ineligible.
--   * vc.memory_extract_attempt — the narrow durable record of one extraction
--     model call: owner, work item, generation, attempt number, provider
--     identity and the settled usage (tokens + billing disposition). The
--     generation attempt chain (vc.attempt_intent + go_create_model_attempt,
--     V117/V119) cannot express it: that function pins work_item.kind =
--     'GENERATION' and refuses terminal generations, while an extraction runs
--     against an already-COMPLETED generation under a MEMORY_EXTRACT work
--     item. This table is extraction-only on purpose — no generic task
--     billing framework — and stays separate from vc.generation_usage so
--     extraction usage never mixes into chat usage statistics. There is no
--     price configuration in Alpha (V83 empty price table), so no amount is
--     settled and none is displayed; tokens are recorded real or UNKNOWN.
--   * vc.go_prepare_memory_extract_attempt — the short pre-flight transaction
--     the handler runs immediately before the provider call. It re-checks, in
--     one claim-fenced statement: live claim, auto-save pref, deletion intent,
--     the required consents and the actual outbound category (MESSAGE_TEXT —
--     extraction sends the user message verbatim, so the memory switch and
--     MEMORY_SNIPPET are not the authorization being exercised), turn
--     extractability incl. no_memory markers and model_eligible, and the
--     route's current admission state. It registers the attempt row — unless
--     a replayable prior payload exists, in which case the run is a pure
--     local re-save and registers nothing (attempt id 0, no new usage) — and
--     abandons stale CREATED attempts of earlier holders with an UNKNOWN
--     disposition (the abandoned holder may already have gone outbound, so
--     NOT_SENT would claim a fact nobody observed). Authorization
--     ordering: a withdrawal that commits first refuses the attempt here; an
--     attempt that prepared first is an operation already started — the
--     in-flight call is cancelled best-effort and the write phase stays
--     protected by the V128 barrier + guard re-reads. No transaction or row
--     lock is held across provider I/O.
--   * vc.go_record_memory_extract_outcome — the write-once outcome: status,
--     usage tokens and billing disposition (USAGE_REPORTED with the reported
--     tokens, or UNKNOWN when the provider reported none — never zero), plus
--     the minimal accepted-entries JSON of a successful call so a retry whose
--     local save failed can replay the parsed output without a second model
--     call. The payload is opaque here: the Go runtime stores it encrypted
--     (the same stored-field cipher as every message field) and decrypts it
--     on read.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. The finished-turn read gains model_eligible. The added output column
--    changes the return type, which CREATE OR REPLACE cannot do, so the V125
--    function is dropped and recreated (no other object depends on it; V125
--    itself stays untouched and the grants are re-issued in section 5).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.go_read_memory_extract_input(bigint, bigint);
CREATE FUNCTION vc.go_read_memory_extract_input(
    p_owner_user_id bigint,
    p_generation_id bigint)
    RETURNS TABLE(
        out_relationship_id bigint,
        out_conversation_id bigint,
        out_status text,
        out_source_message_id bigint,
        out_assistant_message_id bigint,
        out_incognito boolean,
        out_user_content text,
        out_user_no_memory boolean,
        out_assistant_content text,
        out_assistant_no_memory boolean,
        out_model_eligible boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    RETURN QUERY
        SELECT c.relationship_id, g.conversation_id, g.status,
               g.source_user_message_id, g.assistant_message_id,
               c.incognito,
               um.content, COALESCE(um.no_memory, false),
               am.content, COALESCE(am.no_memory, false),
               COALESCE(um.model_eligible, false)
          FROM vc.generation g
          JOIN vc.conversation c
            ON c.owner_user_id = g.owner_user_id AND c.id = g.conversation_id
          LEFT JOIN vc.message um
            ON um.owner_user_id = g.owner_user_id AND um.id = g.source_user_message_id
          LEFT JOIN vc.message am
            ON am.owner_user_id = g.owner_user_id AND am.id = g.assistant_message_id
         WHERE g.owner_user_id = p_owner_user_id
           AND g.id = p_generation_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The narrow extraction attempt/usage record.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE vc.memory_extract_attempt_id_seq AS bigint;

CREATE TABLE vc.memory_extract_attempt (
    owner_user_id       bigint NOT NULL,
    id                  bigint NOT NULL,
    work_item_id        bigint NOT NULL,
    generation_id       bigint NOT NULL,
    attempt_no          integer NOT NULL CHECK (attempt_no >= 1),
    provider_id         text NOT NULL,
    supplier_name       text NOT NULL,
    model_id            text NOT NULL,
    allowed_categories  text[] NOT NULL,
    status              text NOT NULL DEFAULT 'CREATED',
    billing_disposition text,
    input_tokens        bigint,
    output_tokens       bigint,
    failure_code        text,
    output_payload      text,
    attempt_started_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    terminal_at         timestamptz,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT memory_extract_attempt_state CHECK (
        status IN ('CREATED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'ABANDONED')),
    CONSTRAINT memory_extract_attempt_terminal CHECK (
        (status = 'CREATED'
            AND terminal_at IS NULL
            AND billing_disposition IS NULL)
        OR (status <> 'CREATED'
            AND terminal_at IS NOT NULL
            AND billing_disposition IN ('NOT_SENT', 'USAGE_REPORTED', 'UNKNOWN'))),
    CONSTRAINT memory_extract_attempt_tokens CHECK (
        (input_tokens IS NULL AND output_tokens IS NULL)
        OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL
            AND input_tokens >= 0 AND output_tokens >= 0)),
    CONSTRAINT memory_extract_attempt_failure CHECK (
        (status IN ('CREATED', 'SUCCEEDED', 'ABANDONED') AND failure_code IS NULL)
        OR (status IN ('FAILED', 'CANCELLED')
            AND (failure_code IS NULL OR failure_code IN (
                'HTTP_429', 'HTTP_5XX', 'DISCONNECTED',
                'TIMEOUT_CONNECT', 'TIMEOUT_FIRST_TOKEN', 'TIMEOUT_TOTAL',
                'RESPONSE_TOO_LARGE', 'OTHER'))))
);

CREATE INDEX memory_extract_attempt_work_item_idx
    ON vc.memory_extract_attempt (owner_user_id, work_item_id, id);

ALTER TABLE vc.memory_extract_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memory_extract_attempt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.memory_extract_attempt;
CREATE POLICY owner_isolation ON vc.memory_extract_attempt FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.memory_extract_attempt FROM PUBLIC;
REVOKE ALL ON SEQUENCE vc.memory_extract_attempt_id_seq FROM PUBLIC;
-- 只读直授：attempt 的全部写入都走 go_prepare/go_record 两个 SECURITY
-- DEFINER 函数（G1 门禁要求 vc_api/vc_worker/vc_dispatcher 零直接写授权）。
GRANT SELECT ON vc.memory_extract_attempt
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT USAGE, SELECT ON SEQUENCE vc.memory_extract_attempt_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- 3. The pre-flight transaction. Every refusal except a lost claim returns a
--    decision code (a normal outcome, closed DONE by the handler); a lost
--    claim returns 'CLAIM_LOST' without burning a retry. Only transport/SQL
--    failures raise.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.go_prepare_memory_extract_attempt(
    p_owner_user_id  bigint,
    p_work_item_id   bigint,
    p_generation_id  bigint,
    p_claim_token    text,
    p_claim_fence    text,
    p_provider_id    text,
    p_supplier_name  text,
    p_model_id       text)
    RETURNS TABLE(out_attempt_id bigint, out_attempt_no integer,
                  out_decision text, out_prior_payload text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status     text;
    v_assistant  bigint;
    v_incognito  boolean;
    v_user_nm    boolean;
    v_asst_nm    boolean;
    v_eligible   boolean;
    v_admission  text;
    v_categories text[];
    v_no         integer;
    v_id         bigint;
    v_payload    text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_work_item_id IS NULL OR p_work_item_id <= 0
       OR p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'go_prepare_memory_extract_attempt: owner, work item and generation are required';
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);

    -- Claim fence: the presented token/fence must still own a live claim.
    -- A lost claim (overtaken, requeued or lease-expired) is not a retryable
    -- provider failure; the handler stops without any outbound.
    IF NOT EXISTS (
        SELECT 1 FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id
           AND wi.id = p_work_item_id
           AND wi.status = 'CLAIMED'
           AND wi.claim_token IS NOT NULL
           AND wi.claim_token = p_claim_token
           AND wi.claim_fence IS NOT NULL
           AND wi.claim_fence = p_claim_fence
           AND wi.lease_expires_at > clock_timestamp()
    ) THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'CLAIM_LOST'::text, NULL::text;
        RETURN;
    END IF;

    -- Auto-save pref is the write-side kill switch; a closed switch means no
    -- outbound for this purpose at all.
    IF NOT vc.get_memory_auto_save_pref(p_owner_user_id) THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'AUTO_SAVE_OFF'::text, NULL::text;
        RETURN;
    END IF;

    -- Outbound authorization: deletion intent first, then the required
    -- consents, then the actual category. Extraction sends the user message
    -- verbatim, so the category that must be authorized is MESSAGE_TEXT;
    -- the memory switch and MEMORY_SNIPPET are not part of this decision.
    IF vc.account_deletion_intent_active_current() THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'DELETION_IN_PROGRESS'::text, NULL::text;
        RETURN;
    END IF;
    IF EXISTS (
        WITH required(consent_type) AS (
            VALUES ('SERVICE_TERMS'), ('PRIVACY_POLICY'),
                   ('AI_CONTENT_NOTICE'), ('THIRD_PARTY_MODEL_PROCESSING'),
                   ('SENSITIVE_DATA_PROCESSING'))
        SELECT 1
          FROM required r
          LEFT JOIN LATERAL (
              SELECT c.granted
                FROM vc.consent_record c
               WHERE c.owner_user_id = p_owner_user_id
                 AND c.consent_type = r.consent_type
               ORDER BY c.id DESC
               LIMIT 1
          ) latest ON true
         WHERE latest.granted IS DISTINCT FROM true) THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'CONSENT_WITHDRAWN'::text, NULL::text;
        RETURN;
    END IF;
    v_categories := ARRAY['MESSAGE_TEXT', 'ACCOUNT_METADATA', 'MEMORY_SNIPPET'];
    IF NOT ('MESSAGE_TEXT' = ANY (v_categories)) THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'MESSAGE_TEXT_NOT_AUTHORIZED'::text, NULL::text;
        RETURN;
    END IF;

    -- The turn must still be extractable: completed, both messages present,
    -- no suppression marker anywhere, and the source user message still
    -- model-eligible (V112 egress fact).
    SELECT g.status, g.assistant_message_id, c.incognito,
           COALESCE(um.no_memory, false), COALESCE(am.no_memory, false),
           COALESCE(um.model_eligible, false)
      INTO v_status, v_assistant, v_incognito, v_user_nm, v_asst_nm, v_eligible
      FROM vc.generation g
      JOIN vc.conversation c
        ON c.owner_user_id = g.owner_user_id AND c.id = g.conversation_id
      LEFT JOIN vc.message um
        ON um.owner_user_id = g.owner_user_id AND um.id = g.source_user_message_id
      LEFT JOIN vc.message am
        ON am.owner_user_id = g.owner_user_id AND am.id = g.assistant_message_id
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND OR v_status IS DISTINCT FROM 'COMPLETED' OR v_assistant IS NULL THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'NOT_EXTRACTABLE'::text, NULL::text;
        RETURN;
    END IF;
    IF v_incognito OR v_user_nm OR v_asst_nm THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'SOURCE_SUPPRESSED'::text, NULL::text;
        RETURN;
    END IF;
    IF NOT v_eligible THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'MODEL_INELIGIBLE'::text, NULL::text;
        RETURN;
    END IF;

    -- Route admission is a current state: refuse when the configured provider
    -- is no longer admitted. Providers without a deployment row are the
    -- process-level env provider, which has no admission concept.
    SELECT d.admission_state INTO v_admission
      FROM vc.provider_deployment d
     WHERE d.provider_id = p_provider_id
     FOR SHARE;
    IF FOUND AND v_admission IS DISTINCT FROM 'ADMITTED' THEN
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'PROVIDER_NOT_ADMITTED'::text, NULL::text;
        RETURN;
    END IF;

    -- Replaying a prior successful call: a retried job whose local save failed
    -- re-parses the stored payload instead of calling the model again. The
    -- payload is opaque here — the Go runtime stores it encrypted and
    -- decrypts it on read.
    v_payload := (
        SELECT a.output_payload
          FROM vc.memory_extract_attempt a
         WHERE a.owner_user_id = p_owner_user_id
           AND a.work_item_id = p_work_item_id
           AND a.status = 'SUCCEEDED'
           AND a.output_payload IS NOT NULL
         ORDER BY a.id DESC
         LIMIT 1);

    -- A previous holder whose lease expired leaves its CREATED attempt behind;
    -- this run supersedes it. That holder may already have sent its outbound
    -- call and died before settling the outcome, so the disposition is
    -- UNKNOWN — NOT_SENT would claim a fact nobody observed.
    UPDATE vc.memory_extract_attempt a
       SET status = 'ABANDONED',
           billing_disposition = 'UNKNOWN',
           terminal_at = clock_timestamp()
     WHERE a.owner_user_id = p_owner_user_id
       AND a.work_item_id = p_work_item_id
       AND a.status = 'CREATED';

    IF v_payload IS NOT NULL THEN
        -- Replay-only run: a pure local re-save — no new attempt row, no new
        -- usage, and the caller gets attempt id 0 and must not record an
        -- outcome. The attempt that made the call stays the only one.
        RETURN QUERY SELECT NULL::bigint, NULL::integer, 'EXTRACTABLE'::text, v_payload;
        RETURN;
    END IF;

    SELECT COALESCE(max(a.attempt_no), 0) + 1 INTO v_no
      FROM vc.memory_extract_attempt a
     WHERE a.owner_user_id = p_owner_user_id
       AND a.generation_id = p_generation_id;

    v_id := nextval('vc.memory_extract_attempt_id_seq');
    INSERT INTO vc.memory_extract_attempt(
        owner_user_id, id, work_item_id, generation_id, attempt_no,
        provider_id, supplier_name, model_id, allowed_categories, status)
    VALUES (
        p_owner_user_id, v_id, p_work_item_id, p_generation_id, v_no,
        COALESCE(btrim(p_provider_id), ''), COALESCE(btrim(p_supplier_name), ''),
        COALESCE(btrim(p_model_id), ''), v_categories, 'CREATED');

    RETURN QUERY SELECT v_id, v_no, 'EXTRACTABLE'::text, NULL::text;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The write-once outcome. NULL tokens are the provider reporting no usage:
--    the disposition records UNKNOWN, never zero.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.go_record_memory_extract_outcome(
    p_owner_user_id  bigint,
    p_work_item_id   bigint,
    p_attempt_id     bigint,
    p_status         text,
    p_input_tokens   bigint,
    p_output_tokens  bigint,
    p_failure_code   text,
    p_output_payload text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_work_item_id IS NULL OR p_work_item_id <= 0
       OR p_attempt_id IS NULL OR p_attempt_id <= 0 THEN
        RAISE EXCEPTION 'go_record_memory_extract_outcome: owner, work item and attempt are required';
    END IF;
    IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'go_record_memory_extract_outcome: unsupported outcome status %', p_status;
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);

    UPDATE vc.memory_extract_attempt a
       SET status = p_status,
           billing_disposition = CASE
               WHEN p_input_tokens IS NULL OR p_output_tokens IS NULL THEN 'UNKNOWN'
               ELSE 'USAGE_REPORTED'
           END,
           input_tokens = p_input_tokens,
           output_tokens = p_output_tokens,
           failure_code = p_failure_code,
           output_payload = p_output_payload,
           terminal_at = clock_timestamp()
     WHERE a.owner_user_id = p_owner_user_id
       AND a.id = p_attempt_id
       AND a.work_item_id = p_work_item_id
       AND a.status = 'CREATED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants: the extraction job runs under the runtime login, which inherits
--    vc_api; both functions follow the V125 worker-claim grant pattern.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION vc.go_read_memory_extract_input(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_read_memory_extract_input(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION
    vc.go_prepare_memory_extract_attempt(bigint, bigint, bigint, text, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.go_prepare_memory_extract_attempt(bigint, bigint, bigint, text, text, text, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION
    vc.go_record_memory_extract_outcome(bigint, bigint, bigint, text, bigint, bigint, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.go_record_memory_extract_outcome(bigint, bigint, bigint, text, bigint, bigint, text, text)
    TO vc_api, vc_worker;
