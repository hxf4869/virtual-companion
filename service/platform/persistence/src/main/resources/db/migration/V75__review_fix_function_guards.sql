-- REVIEW-FIX function corrections (all CREATE OR REPLACE of the latest
-- definitions; V1-V74 stay untouched):
-- 1) create_report / create_auto_saved_memory / create_memory_candidate:
--    `p_x NOT IN (...)` is NULL for a NULL input, so the enum check was
--    bypassed and the NOT NULL column surfaced a generic 23502 instead of
--    the contract's validation error. Explicit NULL/blank guards first.
-- 2) record_conversation_summary: the PREMIUM quality floor now only applies
--    while the latest summary is still valid — an invalidated PREMIUM row
--    (delete_message / retention) no longer blocks ECONOMY rewrites forever.
-- 3) identity_account_create / redeem_invite_code / create_export_request:
--    check-then-insert races serialized with the V19 transaction-scoped
--    advisory-lock convention (capacity gate, invite gate, in-flight gate).
--    A partial unique index additionally backs the one-in-flight rule.
-- 4) list_reminders: the keyset cursor column (id) is now also the sort key;
--    remind_at is user-editable, so remind_at-ordered pages with an id-only
--    cursor could skip or repeat rows across pages.
-- 5) select_generation_version / receive_generation: the two-step selected
--    flip takes the source message row lock first, so concurrent version
--    selections serialize instead of failing on the partial unique index.

SET search_path TO vc, pg_catalog;

-- Belt-and-braces for the one-in-flight export rule (concurrent create that
-- somehow bypassed the advisory lock still cannot leave two PENDING rows).
CREATE UNIQUE INDEX IF NOT EXISTS export_request_one_pending_per_owner
    ON vc.export_request (owner_user_id) WHERE status = 'PENDING';


CREATE OR REPLACE FUNCTION vc.create_report(
    p_owner_user_id bigint,
    p_message_id    bigint,
    p_reason        text,
    p_note          text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_report: owner_user_id is required';
    END IF;
    IF p_message_id IS NOT NULL AND p_message_id <= 0 THEN
        RAISE EXCEPTION 'create_report: message_id must be positive when present';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'create_report: reason is required';
    END IF;
    IF p_reason NOT IN ('UNSAFE_CONTENT', 'AI_IDENTITY', 'MINOR_SAFEGUARD',
                        'PRIVACY_OR_DATA', 'OTHER') THEN
        RAISE EXCEPTION 'create_report: unapproved report reason';
    END IF;
    IF p_note IS NULL OR length(btrim(p_note)) > 2000 THEN
        RAISE EXCEPTION 'create_report: note must be 1..2000 trimmed characters';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_report: owner_user_id must match server-trusted context';
    END IF;

    IF p_message_id IS NOT NULL THEN
        PERFORM 1
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_message_id;
        IF NOT FOUND THEN
            RETURN 0;
        END IF;
    END IF;

    v_id := nextval('vc.report_request_id_seq');
    INSERT INTO vc.report_request(owner_user_id, id, message_id, reason, note)
    VALUES (p_owner_user_id, v_id, p_message_id, p_reason, btrim(p_note));
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.create_auto_saved_memory(
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
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_evidence text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship_id is required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' OR length(p_summary) > 2000 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: summary must be 1..2000 characters';
    END IF;
    IF p_scope IS NULL OR btrim(p_scope) = '' THEN
        RAISE EXCEPTION 'create_auto_saved_memory: scope is required';
    END IF;
    IF p_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'create_auto_saved_memory: scope % is not enabled in Alpha', p_scope;
    END IF;
    IF p_scope = 'SESSION' AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'create_auto_saved_memory: SESSION scope requires a conversation_id';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id must match server-trusted context';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.relationship r
                    WHERE r.owner_user_id = p_owner_user_id
                      AND r.id = p_relationship_id) THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship not found for owner';
    END IF;
    IF p_scope = 'SESSION' THEN
        IF NOT EXISTS (SELECT 1 FROM vc.conversation c
                        WHERE c.owner_user_id = p_owner_user_id
                          AND c.id = p_conversation_id
                          AND c.relationship_id = p_relationship_id) THEN
            RAISE EXCEPTION 'create_auto_saved_memory: conversation not found for owner/relationship';
        END IF;
    END IF;

    v_id := nextval('vc.memory_id_seq');
    INSERT INTO vc.memory_item(
        owner_user_id, id, relationship_id, scope, summary, status,
        conversation_id, auto_saved)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'ACCEPTED', p_conversation_id, true);

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

CREATE OR REPLACE FUNCTION vc.create_memory_candidate(
    p_owner_user_id    bigint,
    p_relationship_id  bigint,
    p_scope            text,
    p_summary          text,
    p_conversation_id  bigint DEFAULT NULL,
    p_evidence         text[] DEFAULT ARRAY[]::text[],
    p_event_at         timestamptz DEFAULT NULL,
    p_event_status     text DEFAULT NULL,
    p_event_expires_at timestamptz DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
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
    IF p_scope IS NULL OR btrim(p_scope) = '' THEN
        RAISE EXCEPTION 'create_memory_candidate: scope is required';
    END IF;
    IF p_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'create_memory_candidate: scope % is not enabled in Alpha', p_scope;
    END IF;
    -- SESSION requires a conversation binding (structural + redundant function check).
    IF p_scope = 'SESSION' AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: SESSION scope requires a conversation_id';
    END IF;
    -- Event shape (§11.12): any event field requires the anchor event_at; the
    -- status is a catalog code; expiry is strictly after the start.
    IF (p_event_status IS NOT NULL OR p_event_expires_at IS NOT NULL)
       AND p_event_at IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: event_status/event_expires_at require event_at';
    END IF;
    IF p_event_status IS NOT NULL AND p_event_status NOT IN
       ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'create_memory_candidate: unknown event_status %', p_event_status;
    END IF;
    IF p_event_at IS NOT NULL AND p_event_expires_at IS NOT NULL
       AND p_event_expires_at <= p_event_at THEN
        RAISE EXCEPTION 'create_memory_candidate: event_expires_at must be after event_at';
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
        owner_user_id, id, relationship_id, scope, summary, status, conversation_id,
        event_at, event_status, event_expires_at)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'PENDING_CONFIRMATION', p_conversation_id,
        -- A non-event candidate keeps every event column NULL (the shape CHECK
        -- forbids a status without the event_at anchor); an event candidate
        -- defaults to PLANNED (§11.12).
        p_event_at,
        CASE WHEN p_event_at IS NULL THEN NULL
             ELSE COALESCE(p_event_status, 'PLANNED') END,
        p_event_expires_at);

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

CREATE OR REPLACE FUNCTION vc.record_conversation_summary(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_from_message_id bigint,
    p_to_message_id   bigint,
    p_summary         text,
    p_model_id        text,
    p_model_version   text,
    p_prompt_version  text,
    p_confidence      real,
    p_validated       boolean,
    p_service_class   text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_prev_id bigint;
    v_prev_class text;
    v_prev_valid boolean;
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_conversation_summary: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'record_conversation_summary: conversation_id is required';
    END IF;
    IF p_from_message_id IS NULL OR p_to_message_id IS NULL
       OR p_from_message_id <= 0 OR p_to_message_id <= 0
       OR p_from_message_id > p_to_message_id THEN
        RAISE EXCEPTION 'record_conversation_summary: message range is invalid';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' OR length(p_summary) > 4000 THEN
        RAISE EXCEPTION 'record_conversation_summary: summary must be 1..4000 characters';
    END IF;
    IF p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_version IS NULL OR btrim(p_model_version) = ''
       OR p_prompt_version IS NULL OR btrim(p_prompt_version) = '' THEN
        RAISE EXCEPTION 'record_conversation_summary: model/prompt versions are required';
    END IF;
    IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
        RAISE EXCEPTION 'record_conversation_summary: confidence must be within [0,1]';
    END IF;
    IF p_service_class NOT IN ('ECONOMY', 'PREMIUM') THEN
        RAISE EXCEPTION 'record_conversation_summary: unapproved service class';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_conversation_summary: owner_user_id must match server-trusted context';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.conversation c
                    WHERE c.owner_user_id = p_owner_user_id
                      AND c.id = p_conversation_id) THEN
        RAISE EXCEPTION 'record_conversation_summary: conversation not found for owner';
    END IF;

    SELECT s.id, s.service_class, s.valid INTO v_prev_id, v_prev_class, v_prev_valid
      FROM vc.conversation_summary s
     WHERE s.owner_user_id = p_owner_user_id
       AND s.conversation_id = p_conversation_id
     ORDER BY s.id DESC
     LIMIT 1;

    -- §11.18 低质不覆盖高质: a validated, still-valid PREMIUM summary is
    -- never replaced by an ECONOMY one (DEGRADED output).
    IF v_prev_id IS NOT NULL AND v_prev_class = 'PREMIUM'
       AND v_prev_valid
       AND p_service_class = 'ECONOMY' THEN
        RETURN 0;
    END IF;

    v_id := nextval('vc.conversation_summary_id_seq');
    INSERT INTO vc.conversation_summary(
        owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence,
        validated, service_class, prev_id)
    VALUES (
        p_owner_user_id, v_id, p_conversation_id, p_from_message_id,
        p_to_message_id, btrim(p_summary), btrim(p_model_id),
        btrim(p_model_version), btrim(p_prompt_version), p_confidence,
        COALESCE(p_validated, true), p_service_class, v_prev_id);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_account_create(
    p_acting_account_id bigint,
    p_username          text,
    p_password_hash     text,
    p_role              text,
    p_display_name      text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username    text := lower(btrim(p_username));
    v_role        text := upper(btrim(p_role));
    v_account_id  bigint;
    v_active_count bigint;
BEGIN
    IF p_acting_account_id IS NULL THEN
        RAISE EXCEPTION 'identity_account_create: acting account is required';
    END IF;
    IF v_username = '' THEN
        RAISE EXCEPTION 'identity_account_create: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_account_create: password_hash is required';
    END IF;
    IF v_role NOT IN ('ADMIN', 'USER') THEN
        RAISE EXCEPTION 'identity_account_create: role must be ADMIN or USER';
    END IF;
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'identity_account_create: display_name is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_account_create: caller is not an active ADMIN';
    END IF;
    -- REVIEW-FIX: serialize the capacity check-then-insert (V19 advisory
    -- lock convention); concurrent creates could both pass count < 30.
    PERFORM pg_advisory_xact_lock(hashtext('vc.identity_account_create.capacity'));
    -- betaGate maxEnabledAccounts=30 (product-scope): fail closed at capacity.
    SELECT count(*) INTO v_active_count
      FROM vc.identity_account
     WHERE status = 'ACTIVE';
    IF v_active_count >= 30 THEN
        RAISE EXCEPTION 'identity_account_create: enabled account capacity reached';
    END IF;
    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, v_role, 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);
    RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.redeem_invite_code(
    p_code          text,
    p_username      text,
    p_password_hash text,
    p_display_name  text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username   text := lower(btrim(p_username));
    v_account_id bigint;
    v_active_count bigint;
BEGIN
    IF p_code IS NULL OR btrim(p_code) = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: code is required';
    END IF;
    IF v_username = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: password_hash is required';
    END IF;
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: display_name is required';
    END IF;

    -- One uniform failure for absent, expired, used or disabled codes —
    -- existence of codes is never disclosed to an anonymous caller.
    IF NOT EXISTS (SELECT 1 FROM vc.invite_code
                    WHERE code = btrim(p_code)
                      AND status = 'ACTIVE'
                      AND expires_at > now()) THEN
        RAISE EXCEPTION 'redeem_invite_code: invite code is invalid or expired';
    END IF;

    -- betaGate maxEnabledAccounts=30 (same gate as identity_account_create).
    PERFORM pg_advisory_xact_lock(hashtext('vc.redeem_invite_code.capacity'));
    SELECT count(*) INTO v_active_count
      FROM vc.identity_account
     WHERE status = 'ACTIVE';
    IF v_active_count >= 30 THEN
        RAISE EXCEPTION 'redeem_invite_code: enabled account capacity reached';
    END IF;

    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, 'USER', 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);

    UPDATE vc.invite_code
       SET status = 'USED', used_by_account = v_account_id, used_at = now()
     WHERE code = btrim(p_code) AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'redeem_invite_code: invite code was consumed concurrently';
    END IF;
    RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.create_export_request(
    p_owner_user_id bigint
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
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_export_request: owner_user_id must match server-trusted context';
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
    INSERT INTO vc.export_request(owner_user_id, id, status)
    VALUES (p_owner_user_id, v_id, 'PENDING');

    -- The work item carries the export id as ref_id; the worker never reads
    -- the export row directly (only the SD functions reach the payload).
    PERFORM vc.enqueue_work_item(p_owner_user_id, 'DATA_EXPORT', v_id, NULL);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.list_reminders(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_text text,
                  out_remind_at timestamptz, out_recurrence text, out_status text,
                  out_created_at timestamptz, out_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_reminders: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_reminders: owner_user_id must match server-trusted context';
    END IF;
    RETURN QUERY
        SELECT r.id, r.relationship_id, r.text, r.remind_at, r.recurrence,
               r.status, r.created_at, r.updated_at
          FROM vc.reminder r
         WHERE r.owner_user_id = p_owner_user_id
           AND (p_relationship_id IS NULL OR r.relationship_id = p_relationship_id)
           AND r.id > p_after_id
         -- REVIEW-FIX: sort by the keyset cursor column; remind_at is
         -- user-editable so a remind_at-ordered page with an id-only
         -- cursor could skip or repeat rows across pages.
         ORDER BY r.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION vc.select_generation_version(
    p_owner_user_id bigint,
    p_generation_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_source bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'select_generation_version: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'select_generation_version: owner_user_id must match server-trusted context';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'select_generation_version: generation_id is required';
    END IF;

    SELECT source_user_message_id INTO v_source
      FROM vc.generation
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
    IF NOT FOUND OR v_source IS NULL THEN
        RETURN FALSE;
    END IF;

    -- REVIEW-FIX: serialize the two-step selected flip on the source
    -- message row; concurrent selects of versions of the same source
    -- otherwise interleave and the later committer hits the partial
    -- unique index as a 500.
    PERFORM 1 FROM vc.message
     WHERE owner_user_id = p_owner_user_id AND id = v_source
       FOR UPDATE;

    UPDATE vc.generation
       SET selected = false
     WHERE owner_user_id = p_owner_user_id
       AND source_user_message_id = v_source
       AND selected
       AND id IS DISTINCT FROM p_generation_id;
    UPDATE vc.generation
       SET selected = true
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.receive_generation(
    p_owner_user_id          bigint,
    p_conversation_id        bigint,
    p_idempotency_key        text,
    p_user_role              text,
    p_user_content           text,
    p_mode                   text,
    p_source_user_message_id bigint
)
    RETURNS TABLE(logical_generation_id text, generation_id bigint,
                  message_id bigint, created boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_logical text;
    v_gen_id  bigint;
    v_mode    text;
    v_conv    bigint;
    v_role    text;
BEGIN
    IF p_source_user_message_id IS NULL THEN
        RETURN QUERY
            SELECT * FROM vc.receive_generation(
                p_owner_user_id, p_conversation_id, p_idempotency_key,
                p_user_role, p_user_content, p_mode);
        RETURN;
    END IF;

    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_id is required to receive a generation';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'receive_generation: idempotency_key is required to regenerate';
    END IF;

    v_mode := CASE
        WHEN p_mode IN ('AUTO', 'LISTEN', 'DISCUSS', 'CASUAL') THEN p_mode
        ELSE 'AUTO'
    END;

    SELECT m.conversation_id, m.role
      INTO v_conv, v_role
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.id = p_source_user_message_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'receive_generation: source user message not found';
    END IF;
    IF v_conv IS DISTINCT FROM p_conversation_id OR v_role IS DISTINCT FROM 'user' THEN
        RAISE EXCEPTION 'receive_generation: source user message not found';
    END IF;

    v_logical := 'gen_' || gen_random_uuid()::text;
    v_gen_id  := nextval('vc.generation_id_seq');
    INSERT INTO vc.generation
        (owner_user_id, id, conversation_id, logical_generation_id,
         status, idempotency_key, mode, source_user_message_id, selected)
    VALUES
        (p_owner_user_id, v_gen_id, p_conversation_id, v_logical,
         'CREATED', p_idempotency_key, v_mode, p_source_user_message_id, false)
    ON CONFLICT (owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING;

    IF NOT FOUND THEN
        SELECT g.logical_generation_id, g.id INTO v_logical, v_gen_id
          FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.idempotency_key = p_idempotency_key;
        RETURN QUERY SELECT v_logical, v_gen_id, NULL::bigint, false;
        RETURN;
    END IF;

    PERFORM 1 FROM vc.message
     WHERE owner_user_id = p_owner_user_id AND id = p_source_user_message_id
       FOR UPDATE;
    UPDATE vc.generation
       SET selected = false
     WHERE owner_user_id = p_owner_user_id
       AND source_user_message_id = p_source_user_message_id
       AND id IS DISTINCT FROM v_gen_id
       AND selected;
    UPDATE vc.generation
       SET selected = true
     WHERE owner_user_id = p_owner_user_id AND id = v_gen_id;

    RETURN QUERY SELECT v_logical, v_gen_id, p_source_user_message_id, true;
END;
$$;
