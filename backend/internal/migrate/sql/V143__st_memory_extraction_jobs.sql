-- W06: persisted ST sources use the existing extraction worker, slots,
-- claim/retry/fence and usage ledger. No synthetic Go messages/generations.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.work_item ADD COLUMN st_source_ref text;
CREATE UNIQUE INDEX work_item_st_extract_source ON vc.work_item(owner_user_id,st_source_ref) WHERE kind='ST_MEMORY_EXTRACT';
ALTER TABLE vc.memory_extract_attempt ALTER COLUMN generation_id DROP NOT NULL;
ALTER TABLE vc.memory_extract_attempt ADD COLUMN st_source_ref text;
ALTER TABLE vc.memory_extract_attempt ADD CONSTRAINT memory_extract_origin CHECK ((generation_id IS NOT NULL)::integer+(st_source_ref IS NOT NULL)::integer=1);

CREATE FUNCTION vc.sync_st_source_jobs(p_owner bigint,p_conversation bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.work_item w SET status='CANCELLED',claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL,finished_at=clock_timestamp()
     WHERE w.owner_user_id=p_owner AND w.kind='ST_MEMORY_EXTRACT' AND w.status IN ('PENDING','CLAIMED')
       AND w.ref_id IN (SELECT id FROM vc.st_message_source WHERE owner_user_id=p_owner AND conversation_id=p_conversation)
       AND NOT EXISTS (SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
         WHERE s.owner_user_id=p_owner AND s.source_ref=w.st_source_ref AND s.present AND s.eligible AND NOT s.suppressed AND NOT c.incognito);
    UPDATE vc.memory_extract_attempt a SET status='ABANDONED',billing_disposition='UNKNOWN',terminal_at=clock_timestamp(),output_payload=NULL
     WHERE a.owner_user_id=p_owner AND a.st_source_ref IS NOT NULL AND a.status='CREATED'
       AND EXISTS(SELECT 1 FROM vc.work_item w WHERE w.owner_user_id=p_owner AND w.id=a.work_item_id AND w.status='CANCELLED');
    UPDATE vc.memory_extract_attempt a SET output_payload=NULL
     WHERE a.owner_user_id=p_owner AND a.st_source_ref IS NOT NULL AND a.output_payload IS NOT NULL
       AND EXISTS(SELECT 1 FROM vc.work_item w WHERE w.owner_user_id=p_owner AND w.id=a.work_item_id
          AND w.ref_id IN (SELECT id FROM vc.st_message_source WHERE owner_user_id=p_owner AND conversation_id=p_conversation))
       AND NOT EXISTS(SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.source_ref=a.st_source_ref AND s.present AND NOT s.suppressed);
    IF vc.account_deletion_intent_active_current() OR NOT vc.get_memory_auto_save_pref(p_owner) THEN RETURN; END IF;
    IF NOT EXISTS(SELECT 1 FROM vc.model_purpose_binding WHERE purpose='MEMORY_EXTRACTION_DEDUP_SUMMARY' AND state='ENABLED' AND provider_id IS NOT NULL) THEN RETURN; END IF;
    INSERT INTO vc.work_item(owner_user_id,id,kind,ref_id,st_source_ref,status)
    SELECT p_owner,nextval('vc.work_item_id_seq'),'ST_MEMORY_EXTRACT',s.id,s.source_ref,'PENDING'
      FROM vc.st_message_source s JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
     WHERE s.owner_user_id=p_owner AND s.conversation_id=p_conversation AND s.present AND s.settled AND s.eligible AND NOT s.suppressed
       AND s.role='user' AND c.st_source_state='PRESENT' AND c.st_mode='COMPANION' AND NOT c.incognito
    ON CONFLICT(owner_user_id,st_source_ref) WHERE kind='ST_MEMORY_EXTRACT' DO NOTHING;
END;
$$;
CREATE FUNCTION vc.st_source_jobs_after_reconcile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF NEW.st_chat_identity IS NOT NULL THEN PERFORM vc.sync_st_source_jobs(NEW.owner_user_id,NEW.id); END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER st_source_jobs_reconcile AFTER UPDATE OF st_source_state ON vc.conversation FOR EACH ROW EXECUTE FUNCTION vc.st_source_jobs_after_reconcile();
CREATE FUNCTION vc.st_source_jobs_after_suppression() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF NEW.suppressed AND NOT OLD.suppressed THEN PERFORM vc.sync_st_source_jobs(NEW.owner_user_id,NEW.conversation_id); END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER st_source_jobs_suppression AFTER UPDATE OF suppressed ON vc.st_message_source FOR EACH ROW EXECUTE FUNCTION vc.st_source_jobs_after_suppression();
REVOKE ALL ON FUNCTION vc.sync_st_source_jobs(bigint,bigint),vc.st_source_jobs_after_reconcile(),vc.st_source_jobs_after_suppression() FROM PUBLIC;

CREATE OR REPLACE FUNCTION vc.go_claim_jobs(
    p_generation_lease_seconds integer,
    p_export_lease_seconds integer,
    p_default_lease_seconds integer,
    p_limit integer,
    p_generation_limit integer,
    p_extract_limit integer)
    RETURNS TABLE(
        out_owner_user_id bigint,
        out_job_id bigint,
        out_kind text,
        out_ref_id bigint,
        out_claim_token text,
        out_claim_fence text,
        out_lease_seconds integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit integer;
    v_gen_limit integer;
    v_extract_limit integer;
BEGIN
    IF p_generation_lease_seconds IS NULL OR p_generation_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: generation lease must be >= 5s';
    END IF;
    IF p_export_lease_seconds IS NULL OR p_export_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: export lease must be >= 5s';
    END IF;
    IF p_default_lease_seconds IS NULL OR p_default_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: default lease must be >= 5s';
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
    v_gen_limit := CASE
        WHEN p_generation_limit IS NULL THEN NULL
        ELSE GREATEST(p_generation_limit, 0)
    END;
    v_extract_limit := CASE
        WHEN p_extract_limit IS NULL THEN NULL
        ELSE GREATEST(p_extract_limit, 0)
    END;

    RETURN QUERY
    WITH gen_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'GENERATION'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_gen_limit
    ),
    export_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'DATA_EXPORT'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ),
    extract_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind IN ('MEMORY_EXTRACT','ST_MEMORY_EXTRACT')
           AND (wi.kind='MEMORY_EXTRACT' OR EXISTS (SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=wi.owner_user_id AND s.id=wi.ref_id AND s.settled))
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_extract_limit
    ),
    picked AS (
        SELECT owner_user_id, id
          FROM (
              SELECT * FROM gen_picked
              UNION ALL SELECT * FROM export_picked
              UNION ALL SELECT * FROM extract_picked
          ) u
         ORDER BY created_at, id
         LIMIT v_limit
    )
    UPDATE vc.work_item wi
       SET status = 'CLAIMED',
           claim_token = gen_random_uuid()::text,
           claim_fence = gen_random_uuid()::text,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs =>
               CASE wi.kind
                   WHEN 'GENERATION' THEN p_generation_lease_seconds
                   WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                   ELSE p_default_lease_seconds
               END)
      FROM picked p
     WHERE wi.owner_user_id = p.owner_user_id AND wi.id = p.id
    RETURNING wi.owner_user_id, wi.id, wi.kind, wi.ref_id, wi.claim_token, wi.claim_fence,
              CASE wi.kind
                  WHEN 'GENERATION' THEN p_generation_lease_seconds
                  WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                  ELSE p_default_lease_seconds
              END;
END;
$$;

DROP FUNCTION IF EXISTS vc.go_claim_jobs(integer, integer, integer, integer);

REVOKE ALL ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer, integer, integer)
    TO vc_api, vc_worker;


CREATE OR REPLACE FUNCTION vc.go_list_expired_memory_extract_jobs(p_limit integer)
    RETURNS TABLE(out_owner_user_id bigint, out_job_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.kind IN ('MEMORY_EXTRACT','ST_MEMORY_EXTRACT')
           AND wi.status = 'CLAIMED'
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
         ORDER BY wi.lease_expires_at, wi.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
END;
$$;

-- p_max_attempts mirrors the worker's extraction retry budget (the same bound
-- vc.requeue_retryable_failure receives); the caller passes it explicitly.
CREATE OR REPLACE FUNCTION vc.go_recover_expired_memory_extract(
    p_owner_user_id bigint,
    p_work_item_id  bigint,
    p_max_attempts  integer)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind     text;
    v_status   text;
    v_attempts integer;
BEGIN
    IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
        RAISE EXCEPTION 'go_recover_expired_memory_extract: p_max_attempts must be positive';
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT wi.kind, wi.status, wi.attempt_count
      INTO v_kind, v_status, v_attempts
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
     FOR UPDATE;
    IF NOT FOUND OR v_kind NOT IN ('MEMORY_EXTRACT','ST_MEMORY_EXTRACT') THEN
        RAISE EXCEPTION 'go_recover_expired_memory_extract: memory extract job not found';
    END IF;
    IF v_status IS DISTINCT FROM 'CLAIMED' THEN
        RETURN 'IDEMPOTENT_NON_CLAIMED';
    END IF;
    -- Only an elapsed lease may be recovered; a live claim belongs to its owner.
    IF NOT EXISTS (
        SELECT 1
          FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id
           AND wi.id = p_work_item_id
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
    ) THEN
        RETURN 'LEASE_ACTIVE';
    END IF;

    IF v_attempts + 1 >= p_max_attempts THEN
        UPDATE vc.work_item
           SET status = 'DEAD_LETTERED',
               attempt_count = attempt_count + 1,
               finished_at = clock_timestamp()
         WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
        RETURN 'DEAD_LETTERED';
    END IF;

    UPDATE vc.work_item
       SET status = 'PENDING',
           attempt_count = attempt_count + 1,
           next_attempt_at = NULL,
           claim_token = NULL,
           claim_fence = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
    RETURN 'REQUEUED';
END;
$$;

REVOKE ALL ON FUNCTION vc.go_list_expired_memory_extract_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_expired_memory_extract_jobs(integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_recover_expired_memory_extract(bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_recover_expired_memory_extract(bigint, bigint, integer)
    TO vc_api, vc_worker;


CREATE FUNCTION vc.go_prepare_st_memory_extract_attempt(
    p_owner_user_id  bigint,
    p_work_item_id   bigint,
    p_source_id  bigint,
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
    v_source_ref text;
    v_relationship bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_work_item_id IS NULL OR p_work_item_id <= 0
       OR p_source_id IS NULL OR p_source_id <= 0 THEN
        RAISE EXCEPTION 'go_prepare_st_memory_extract_attempt: owner, work item and generation are required';
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    -- Claim fence: the presented token/fence must still own a live claim.
    -- A lost claim (overtaken, requeued or lease-expired) is not a retryable
    -- provider failure; the handler stops without any outbound.
    IF NOT EXISTS (
        SELECT 1 FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id
           AND wi.id = p_work_item_id
           AND wi.kind='ST_MEMORY_EXTRACT' AND wi.ref_id=p_source_id
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

    SELECT w.st_source_ref,c.relationship_id INTO v_source_ref,v_relationship
      FROM vc.work_item w JOIN vc.st_message_source s ON (s.owner_user_id,s.id)=(w.owner_user_id,w.ref_id)
      JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
     WHERE w.owner_user_id=p_owner_user_id AND w.id=p_work_item_id AND s.id=p_source_id AND s.role='user' AND c.st_mode='COMPANION';
    IF NOT FOUND OR NOT vc.guard_st_memory_source(p_owner_user_id,v_relationship,v_source_ref) THEN
        RETURN QUERY SELECT NULL::bigint,NULL::integer,'SOURCE_SUPPRESSED'::text,NULL::text; RETURN;
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
       AND a.work_item_id = p_work_item_id;

    v_id := nextval('vc.memory_extract_attempt_id_seq');
    INSERT INTO vc.memory_extract_attempt(
        owner_user_id, id, work_item_id, st_source_ref, attempt_no,
        provider_id, supplier_name, model_id, allowed_categories, status)
    VALUES (
        p_owner_user_id, v_id, p_work_item_id, v_source_ref, v_no,
        COALESCE(btrim(p_provider_id), ''), COALESCE(btrim(p_supplier_name), ''),
        COALESCE(btrim(p_model_id), ''), v_categories, 'CREATED');

    RETURN QUERY SELECT v_id, v_no, 'EXTRACTABLE'::text, NULL::text;
END;
$$;
REVOKE ALL ON FUNCTION vc.go_prepare_st_memory_extract_attempt(bigint,bigint,bigint,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_prepare_st_memory_extract_attempt(bigint,bigint,bigint,text,text,text,text,text) TO vc_api,vc_worker;

-- A late provider can settle usage but cannot restore invalid source text in
-- a replay payload, including after a source edit/deletion or account intent.
CREATE FUNCTION vc.guard_st_extract_payload() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF NEW.st_source_ref IS NOT NULL AND NEW.output_payload IS NOT NULL AND (
      vc.account_deletion_intent_active_current() OR NOT EXISTS (
        SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
         WHERE s.owner_user_id=NEW.owner_user_id AND s.source_ref=NEW.st_source_ref AND s.present AND s.settled AND s.eligible AND NOT s.suppressed
           AND c.st_source_state='PRESENT' AND NOT c.incognito)) THEN NEW.output_payload:=NULL; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER st_extract_payload_guard BEFORE UPDATE OF output_payload ON vc.memory_extract_attempt FOR EACH ROW EXECUTE FUNCTION vc.guard_st_extract_payload();
REVOKE ALL ON FUNCTION vc.guard_st_extract_payload() FROM PUBLIC;

CREATE FUNCTION vc.go_read_st_memory_extract_input(p_owner bigint,p_job bigint,p_source bigint)
RETURNS TABLE(out_relationship_id bigint,out_conversation_id bigint,out_source_ref text,out_content text,out_eligible boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT c.relationship_id,c.id,w.st_source_ref,
       CASE WHEN s.source_ref=w.st_source_ref AND s.present AND s.eligible AND s.settled AND NOT s.suppressed AND NOT c.incognito AND c.st_source_state='PRESENT' THEN s.content_cipher ELSE '' END,
       s.source_ref=w.st_source_ref AND s.present AND s.eligible AND s.settled AND NOT s.suppressed AND NOT c.incognito AND c.st_source_state='PRESENT'
      FROM vc.work_item w JOIN vc.st_message_source s ON (s.owner_user_id,s.id)=(w.owner_user_id,w.ref_id)
      JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
     WHERE w.owner_user_id=p_owner AND w.id=p_job AND w.kind='ST_MEMORY_EXTRACT' AND w.ref_id=p_source AND s.role='user' AND c.st_mode='COMPANION';
END;
$$;
REVOKE ALL ON FUNCTION vc.go_read_st_memory_extract_input(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_read_st_memory_extract_input(bigint,bigint,bigint) TO vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.go_service_resolve_purpose(bigint,text) TO vc_worker;
