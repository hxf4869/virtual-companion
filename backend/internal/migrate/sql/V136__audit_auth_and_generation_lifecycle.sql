-- Correct the authentication and generation lifecycle findings from the
-- whole-repository audit. Preserve applied migration history and existing
-- signatures/grants; these replacements are consumed by the Go runtime.
SET search_path TO vc, pg_catalog;


CREATE OR REPLACE FUNCTION vc.go_recover_expired_generation(
    p_owner_user_id bigint,
    p_work_item_id bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind text;
    v_ref bigint;
    v_job_status text;
    v_gen_status text;
    v_assistant bigint;
    v_cancel boolean;
    v_action text;
    rec record;
    v_current record;
    v_has_attempt boolean := false;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT wi.kind, wi.ref_id, wi.status
      INTO v_kind, v_ref, v_job_status
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
     FOR UPDATE;
    IF NOT FOUND OR v_kind IS DISTINCT FROM 'GENERATION' THEN
        RAISE EXCEPTION 'go_recover_expired_generation: generation job not found';
    END IF;

    SELECT g.status, g.assistant_message_id, g.cancel_requested
      INTO v_gen_status, v_assistant, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = v_ref
     FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', 'GENERATION_MISSING');
        RETURN 'JOB_CLOSED_MISSING_GENERATION';
    END IF;

    -- 1. generation already terminal.
    IF vc.go_generation_terminal(v_gen_status) THEN
        IF v_gen_status = 'COMPLETED' AND v_assistant IS NULL THEN
            RAISE EXCEPTION 'go_recover_expired_generation: COMPLETED generation has no final message';
        END IF;
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id,
            CASE WHEN v_gen_status = 'CANCELLED' THEN 'CANCELLED'
                 WHEN v_gen_status = 'COMPLETED' THEN 'DONE'
                 ELSE 'FAILED' END,
            NULL);
        RETURN 'IDEMPOTENT_TERMINAL';
    END IF;

    -- A listing is only a hint: another recovery pass may have requeued
    -- this job and a worker may already hold its replacement claim.
    IF v_job_status IS DISTINCT FROM 'CLAIMED' THEN
        RETURN 'IDEMPOTENT_NON_CLAIMED';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
    ) THEN
        RETURN 'LEASE_ACTIVE';
    END IF;

    FOR rec IN
        SELECT a.id, a.attempt_no, a.status, a.billing_disposition, a.reserved_cost
          FROM vc.attempt_intent a
         WHERE a.owner_user_id = p_owner_user_id
           AND a.generation_id = v_ref
         ORDER BY a.attempt_no NULLS LAST, a.id
         FOR UPDATE
    LOOP
        v_has_attempt := true;
        v_current := rec;
        IF rec.status <> 'CREATED' THEN
            -- 8. already terminal: converge reservation by persisted disposition.
            PERFORM vc.go_close_reservation(
                p_owner_user_id,
                COALESCE(rec.reserved_cost, 0),
                rec.billing_disposition,
                0);
        END IF;
    END LOOP;

    -- 2. no attempt intent: requeue.
    IF NOT v_has_attempt THEN
        UPDATE vc.work_item
           SET status = 'PENDING',
               claim_token = NULL,
               claim_fence = NULL,
               claimed_at = NULL,
               lease_expires_at = NULL,
               next_attempt_at = NULL
         WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
        RETURN 'REQUEUE_NO_INTENT';
    END IF;

    -- 3-7. never requeue; never create a new attempt.
    IF v_current.status = 'CREATED' THEN
        -- 4 / 7: non-terminal CREATED → OUTCOME_UNKNOWN (physical ABANDONED_LATE).
        UPDATE vc.attempt_intent
           SET status = 'ABANDONED_LATE',
               billing_disposition = 'UNKNOWN',
               terminal_at = clock_timestamp()
         WHERE owner_user_id = p_owner_user_id AND id = v_current.id;
        PERFORM vc.go_close_reservation(
            p_owner_user_id, COALESCE(v_current.reserved_cost, 0), 'UNKNOWN', 0);
        IF v_cancel THEN
            UPDATE vc.generation SET status = 'CANCELLED', cancel_requested = true
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
            PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, v_ref);
            PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'CANCELLED', 'CANCELED');
            RETURN 'CANCELLED_OUTCOME_UNKNOWN';
        END IF;
        IF v_gen_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
            UPDATE vc.generation SET status = 'IN_PROGRESS'
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        END IF;
        UPDATE vc.generation SET status = 'FAILED_FINAL'
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', 'PROVIDER_OUTCOME_UNKNOWN');
        RETURN 'OUTCOME_UNKNOWN';
    END IF;

    IF v_current.status = 'SUCCEEDED' THEN
        -- 5. candidate lost after attempt.
        IF v_cancel THEN
            UPDATE vc.generation SET status = 'CANCELLED', cancel_requested = true
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
            PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, v_ref);
            PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'CANCELLED', 'CANCELED');
            RETURN 'CANCELLED_AFTER_SUCCESS';
        END IF;
        IF v_gen_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
            UPDATE vc.generation SET status = 'IN_PROGRESS'
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        END IF;
        UPDATE vc.generation SET status = 'FAILED_FINAL'
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', 'CANDIDATE_LOST_AFTER_ATTEMPT');
        RETURN 'CANDIDATE_LOST_AFTER_ATTEMPT';
    END IF;

    -- 6 / 7. other terminal attempts.
    IF v_cancel THEN
        UPDATE vc.generation SET status = 'CANCELLED', cancel_requested = true
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, v_ref);
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'CANCELLED', 'CANCELED');
        RETURN 'CANCELLED_KEEP_ATTEMPT';
    END IF;
    IF v_gen_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
        UPDATE vc.generation SET status = 'IN_PROGRESS'
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
    END IF;
    UPDATE vc.generation SET status = 'FAILED_FINAL'
     WHERE owner_user_id = p_owner_user_id AND id = v_ref;
    v_action := CASE v_current.status
        WHEN 'ABANDONED_LATE' THEN 'PROVIDER_OUTCOME_UNKNOWN'
        WHEN 'TIMED_OUT' THEN 'TIMEOUT'
        WHEN 'CANCELLED' THEN 'CANCELED'
        ELSE 'ATTEMPT_FAILED'
    END;
    PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', v_action);
    RETURN v_action;
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_auth_challenge_lock(
    p_id text,
    p_expected_mode text,
    p_now timestamptz
)
    RETURNS TABLE(
        out_account_id bigint,
        out_role text,
        out_account_name text,
        out_password_must_change boolean,
        out_current_totp_ciphertext text,
        out_pending_totp_ciphertext text,
        out_totp_last_consumed_step bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    -- Match password-change/reset lock ordering: account before challenge.
    -- Re-read the challenge predicates after waiting for the account lock.
    PERFORM 1
      FROM vc.identity_account a
      JOIN vc.identity_auth_challenge c ON c.account_id = a.id
     WHERE c.id = p_id
     FOR UPDATE OF a;
    RETURN QUERY
    SELECT a.id, a.role, COALESCE(a.email, a.username), a.password_must_change,
           a.totp_secret_ciphertext, c.pending_totp_secret_ciphertext,
           a.totp_last_consumed_step
      FROM vc.identity_auth_challenge c
      JOIN vc.identity_account a ON a.id = c.account_id
     WHERE c.id = p_id
       AND c.mode = p_expected_mode
       AND c.consumed_at IS NULL
       AND c.expires_at > p_now
       AND c.failed_attempts < 5
       AND a.status = 'ACTIVE'
       AND (c.mode <> 'TOTP_ENROLL' OR a.totp_secret_ciphertext IS NULL)
     FOR UPDATE OF c, a;
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_auth_challenge_complete_current(
    p_id text,
    p_expected_mode text,
    p_session_hash text,
    p_session_expires_at timestamptz,
    p_recovery_code_id bigint,
    p_new_recovery_hashes text[],
    p_trusted_device_hash text,
    p_trusted_device_name text,
    p_trusted_device_expires_at timestamptz,
    p_now timestamptz,
    p_totp_consumed_step bigint
)
    RETURNS TABLE(out_session_id bigint, out_trusted_device_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_mode text;
    v_pending text;
    v_session_id bigint;
    v_device_id bigint;
BEGIN
    IF v_owner_id IS NULL OR p_expected_mode NOT IN ('TOTP_VERIFY', 'TOTP_ENROLL')
       OR p_session_hash !~ '^[0-9a-f]{64}$'
       OR p_session_expires_at IS NULL OR p_session_expires_at <= p_now
       OR (p_totp_consumed_step IS NOT NULL AND p_totp_consumed_step < 0) THEN
        RAISE EXCEPTION 'identity_auth_challenge_complete_current: invalid request';
    END IF;
    -- Also preserve account-first ordering for direct SQL completions.
    PERFORM 1 FROM vc.identity_account WHERE id = v_owner_id FOR UPDATE;
    SELECT c.mode, c.pending_totp_secret_ciphertext
      INTO v_mode, v_pending
      FROM vc.identity_auth_challenge c
      JOIN vc.identity_account a ON a.id = c.account_id
     WHERE c.id = p_id
       AND c.account_id = v_owner_id
       AND c.mode = p_expected_mode
       AND c.consumed_at IS NULL
       AND c.expires_at > p_now
       AND c.failed_attempts < 5
       AND a.status = 'ACTIVE'
       AND (c.mode <> 'TOTP_ENROLL' OR a.totp_secret_ciphertext IS NULL)
     FOR UPDATE OF c, a;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'identity_auth_challenge_complete_current: challenge not found';
    END IF;

    IF p_recovery_code_id IS NOT NULL THEN
        UPDATE vc.identity_mfa_recovery_code
           SET used_at = p_now
         WHERE id = p_recovery_code_id
           AND account_id = v_owner_id
           AND used_at IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: recovery code not found';
        END IF;
    END IF;

    IF v_mode = 'TOTP_ENROLL' THEN
        IF v_pending IS NULL OR cardinality(p_new_recovery_hashes) IS DISTINCT FROM 10
           OR EXISTS (
               SELECT 1 FROM unnest(p_new_recovery_hashes) h
                WHERE h !~ '^[0-9a-f]{64}$') THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: invalid enrollment';
        END IF;
        -- The locked guard above permits only the first binding. An older
        -- pending enrollment cannot replace an already active factor.
        UPDATE vc.identity_account
           SET totp_secret_ciphertext = v_pending,
               totp_enabled_at = p_now,
               totp_last_consumed_step = p_totp_consumed_step
         WHERE id = v_owner_id;
        DELETE FROM vc.identity_mfa_recovery_code WHERE account_id = v_owner_id;
        INSERT INTO vc.identity_mfa_recovery_code(account_id, code_hash, created_at)
        SELECT v_owner_id, h, p_now FROM unnest(p_new_recovery_hashes) h;
    ELSIF p_totp_consumed_step IS NOT NULL THEN
        -- Current-key semantics (TOTP_VERIFY): a repeated or regressed step
        -- must not create a second session. The abort rolls back the whole
        -- completion — no session, no consumption.
        UPDATE vc.identity_account
           SET totp_last_consumed_step = p_totp_consumed_step
         WHERE id = v_owner_id
           AND (totp_last_consumed_step IS NULL
                OR p_totp_consumed_step > totp_last_consumed_step);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: totp step already consumed';
        END IF;
    END IF;

    INSERT INTO vc.identity_opaque_session(account_id, token_hash, created_at, expires_at)
    VALUES (v_owner_id, p_session_hash, p_now, p_session_expires_at)
    RETURNING id INTO v_session_id;

    IF p_trusted_device_hash IS NOT NULL THEN
        IF p_trusted_device_hash !~ '^[0-9a-f]{64}$'
           OR char_length(btrim(p_trusted_device_name)) NOT BETWEEN 1 AND 120
           OR p_trusted_device_expires_at IS NULL
           OR p_trusted_device_expires_at <= p_now THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: invalid trusted device';
        END IF;
        INSERT INTO vc.identity_trusted_device(
            account_id, token_hash, display_name, created_at, last_used_at, expires_at)
        VALUES (
            v_owner_id, p_trusted_device_hash, btrim(p_trusted_device_name),
            p_now, p_now, p_trusted_device_expires_at)
        RETURNING id INTO v_device_id;
    END IF;

    UPDATE vc.identity_auth_challenge SET consumed_at = p_now WHERE id = p_id;
    IF v_mode = 'TOTP_ENROLL' THEN
        PERFORM 1 FROM vc.ensure_default_relationship(v_owner_id, 'gentle-listener');
    END IF;
    RETURN QUERY SELECT v_session_id, v_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_change_current_password(p_password_hash text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_changed boolean;
BEGIN
    v_changed := vc.identity_change_password(v_owner_id, p_password_hash);
    IF NOT v_changed THEN
        RETURN FALSE;
    END IF;
    -- Password-verified challenges are credentials for the old password.
    -- Invalidate them atomically with the password and session revocation.
    UPDATE vc.identity_auth_challenge
       SET consumed_at = clock_timestamp()
     WHERE account_id = v_owner_id AND consumed_at IS NULL;
    PERFORM vc.identity_opaque_session_revoke_all(v_owner_id);
    PERFORM vc.identity_trusted_device_revoke_all_current();
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.delete_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'delete_conversation: conversation id is required';
    END IF;
    -- V17 trusted-owner assertion: caller identity is server-trusted only.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_conversation: owner_user_id must match server-trusted context';
    END IF;
    -- Both work item kinds reference the generation id; a deleted conversation
    -- must never leave a worker processing a dangling ref (it would retry into
    -- dead-letter). In-flight items are cancelled before the rows cascade.
    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (SELECT g.id
                          FROM vc.generation g
                         WHERE g.owner_user_id = p_owner_user_id
                           AND g.conversation_id = p_conversation_id);
    DELETE FROM vc.conversation
     WHERE owner_user_id = p_owner_user_id
       AND id = p_conversation_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_finalize_generation(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_attempt_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_assistant_content text)
    RETURNS TABLE(out_generation_id bigint, out_assistant_message_id bigint, out_finalized boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_conv bigint;
    v_status text;
    v_assistant bigint;
    v_att_status text;
    v_att_billing text;
    v_msg bigint;
    v_cancel boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);
    IF p_assistant_content IS NULL OR p_assistant_content = '' THEN
        RAISE EXCEPTION 'go_finalize_generation: assistant content is required';
    END IF;

    SELECT g.conversation_id, g.status, g.assistant_message_id, g.cancel_requested
      INTO v_conv, v_status, v_assistant, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_finalize_generation: generation not found';
    END IF;
    IF v_status = 'COMPLETED' AND v_assistant IS NOT NULL THEN
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'DONE', NULL);
        RETURN QUERY SELECT p_generation_id, v_assistant, false;
        RETURN;
    END IF;
    IF v_cancel OR v_status IN ('CANCEL_REQUESTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'go_finalize_generation: generation cancel requested';
    END IF;
    IF vc.go_generation_terminal(v_status) THEN
        RAISE EXCEPTION 'go_finalize_generation: generation already terminal';
    END IF;

    SELECT a.status, a.billing_disposition
      INTO v_att_status, v_att_billing
      FROM vc.attempt_intent a
     WHERE a.owner_user_id = p_owner_user_id
       AND a.id = p_attempt_id
       AND a.generation_id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_finalize_generation: attempt not found';
    END IF;
    IF v_att_status IS DISTINCT FROM 'SUCCEEDED' THEN
        RAISE EXCEPTION 'go_finalize_generation: attempt is not succeeded';
    END IF;
    IF v_att_billing IS NULL THEN
        RAISE EXCEPTION 'go_finalize_generation: attempt reservation is not closed';
    END IF;

    -- Catalog hops: IN_PROGRESS/QUEUED → FINAL_REVIEW → COMMITTING → COMPLETED.
    IF v_status IN ('CREATED', 'QUEUED', 'IN_PROGRESS') THEN
        UPDATE vc.generation SET status = 'FINAL_REVIEW'
         WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
        v_status := 'FINAL_REVIEW';
    END IF;
    IF v_status = 'FINAL_REVIEW' THEN
        UPDATE vc.generation SET status = 'COMMITTING'
         WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
        v_status := 'COMMITTING';
    END IF;
    IF v_status IS DISTINCT FROM 'COMMITTING' THEN
        RAISE EXCEPTION 'go_finalize_generation: illegal transition';
    END IF;

    v_msg := nextval('vc.message_id_seq');
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, generation_id)
    VALUES (p_owner_user_id, v_msg, v_conv, 'assistant', p_assistant_content, p_generation_id);

    UPDATE vc.generation
       SET status = 'COMPLETED',
           assistant_message_id = v_msg,
           cancel_requested = false
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;

    PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'DONE', NULL);
    RETURN QUERY SELECT p_generation_id, v_msg, true;
END;
$$;

-- Restore the reverse link for existing Go responses. The forward link
-- already identifies the actual persisted response, including old versions.
-- Accounts pending deletion remain behind their existing V103 write fence.
UPDATE vc.message m
   SET generation_id = g.id
  FROM vc.generation g
 WHERE g.owner_user_id = m.owner_user_id
   AND g.assistant_message_id = m.id
   AND m.role = 'assistant'
   AND m.generation_id IS NULL
   AND NOT EXISTS (
       SELECT 1 FROM vc.account_deletion_intent d
        WHERE d.account_id = m.owner_user_id);


CREATE OR REPLACE FUNCTION vc.end_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS TABLE(out_ok boolean, out_incognito_cleared boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_incognito boolean;
    v_generation record;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: conversation id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id must match server-trusted context';
    END IF;

    SELECT c.incognito INTO v_incognito
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id
       AND c.id = p_conversation_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Closing a work item alone strands its nonterminal generation and
    -- keeps consuming the owner's outstanding-turn allowance forever.
    FOR v_generation IN
        SELECT g.id FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.conversation_id = p_conversation_id
           AND NOT vc.go_generation_terminal(g.status)
           AND g.status <> 'COMMITTING'
         ORDER BY g.id
         FOR UPDATE
    LOOP
        PERFORM * FROM vc.go_request_cancel(p_owner_user_id, v_generation.id);
    END LOOP;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind = 'MEMORY_EXTRACT'
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
             WHERE g.owner_user_id = p_owner_user_id
               AND g.conversation_id = p_conversation_id
       );

    IF v_incognito THEN
        UPDATE vc.message
           SET content = ''
         WHERE owner_user_id = p_owner_user_id
           AND conversation_id = p_conversation_id;
    END IF;

    out_ok := true;
    out_incognito_cleared := COALESCE(v_incognito, false);
    RETURN NEXT;
END;
$$;
