-- 116_trial_quota_reconciliation: ENT-TRIAL / QUOTA-PERSIST V61 — simulated
-- trials + ledger reconciliation.
--
-- Covers: mint without a trial mints ECONOMY (entitled=actual, idempotent
-- re-mint resolves the same snapshot); an active trial mints PREMIUM with
-- source TRIAL_GRANT and consumes exactly one turn per NEW generation
-- (idempotent re-mints never double-consume); exhaustion terminalizes
-- CONSUMED and mints fall back to the assignment; expiry terminalizes
-- EXPIRED lazily; trial_status reports the live budget; grant_trial is
-- ADMIN-only. Reconciliation counts settled/released volumes and the three
-- anomaly classes over the window; the persisted registry read is
-- ADMIN-only.

\set ON_ERROR_STOP on

TRUNCATE vc.trial_grant, vc.entitlement_snapshot, vc.service_class_assignment,
         vc.quota_ledger_entry, vc.invite_code, vc.safety_event, vc.age_appeal,
         vc.report_request, vc.age_verification, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.export_request,
         vc.consent_record, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin  bigint;
    v_owner  bigint;
    v_rel    bigint;
    v_gen    bigint;
    v_id     bigint;
    v_class  text;
    v_ent    text;
    n        int;
BEGIN
    SELECT vc.identity_admin_seed('root-trial', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-trial', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_owner;

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_owner, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_owner, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_owner, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_owner || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;

    -- No trial: ECONOMY, entitled=actual, idempotent.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_owner, 1, 'trial-key-1', 'user', 'hello');
    SELECT out_id, out_service_class, out_entitled_service_class
      INTO v_id, v_class, v_ent
      FROM vc.mint_entitlement_snapshot(v_owner, v_gen);
    IF v_class <> 'ECONOMY' OR v_ent <> 'ECONOMY' THEN
        RAISE EXCEPTION 'no-trial mint must be ECONOMY/ECONOMY, got %/%', v_class, v_ent;
    END IF;
    -- Idempotency is verified through the SD alone (entitlement_snapshot is
    -- SD-only): the re-mint must resolve the SAME snapshot id.
    SELECT out_id INTO n FROM vc.mint_entitlement_snapshot(v_owner, v_gen);
    IF n <> v_id THEN
        RAISE EXCEPTION 're-mint must resolve the same snapshot id: % vs %', n, v_id;
    END IF;

    -- Grant a 2-turn trial (ADMIN mints through the SD inside the owner ctx:
    -- grant_trial only checks the acting ADMIN, not the owner context).
    PERFORM vc.grant_trial(v_admin, v_owner, 2, 14);

    -- New generation mints PREMIUM and consumes one turn.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_owner, 1, 'trial-key-2', 'user', 'hi');
    SELECT out_service_class, out_entitled_service_class INTO v_class, v_ent
      FROM vc.mint_entitlement_snapshot(v_owner, v_gen);
    IF v_class <> 'PREMIUM' OR v_ent <> 'PREMIUM' THEN
        RAISE EXCEPTION 'trial mint must be PREMIUM, got %/%', v_class, v_ent;
    END IF;
    -- trial_status reports the live budget (trial_grant is SD-only).
    SELECT out_remaining_turns INTO n FROM vc.trial_status(v_owner);
    IF n <> 1 THEN
        RAISE EXCEPTION 'one turn must be consumed, remaining %', n;
    END IF;
    -- Idempotent re-mint does not consume a second turn.
    PERFORM vc.mint_entitlement_snapshot(v_owner, v_gen);
    SELECT out_remaining_turns INTO n FROM vc.trial_status(v_owner);
    IF n <> 1 THEN
        RAISE EXCEPTION 're-mint must not consume a turn, remaining %', n;
    END IF;

    -- The last turn exhausts the grant; the next mint falls back.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_owner, 1, 'trial-key-3', 'user', 'hey');
    SELECT out_service_class INTO v_class FROM vc.mint_entitlement_snapshot(v_owner, v_gen);
    IF v_class <> 'PREMIUM' THEN
        RAISE EXCEPTION 'last trial turn must still mint PREMIUM';
    END IF;
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_owner, 1, 'trial-key-4', 'user', 'again');
    SELECT out_service_class INTO v_class FROM vc.mint_entitlement_snapshot(v_owner, v_gen);
    IF v_class <> 'ECONOMY' THEN
        RAISE EXCEPTION 'exhausted trial must fall back, got %', v_class;
    END IF;
    SELECT count(*) INTO n FROM vc.trial_status(v_owner);
    IF n <> 0 THEN
        RAISE EXCEPTION 'no live trial may remain after exhaustion';
    END IF;
    -- Session temp map so later blocks can address generations by logical id
    -- without touching RLS-bound direct reads outside the owner context.
    CREATE TEMP TABLE IF NOT EXISTS gen_map(k text, id bigint) ON COMMIT PRESERVE ROWS;
    DELETE FROM gen_map;
    -- The logical id is server-generated; the test addresses generations by
    -- the idempotency key it passed in.
    INSERT INTO gen_map
    SELECT g.idempotency_key, g.id
      FROM vc.generation g
     WHERE g.owner_user_id = v_owner
       AND g.idempotency_key LIKE 'trial-key-%';
    RESET ROLE;
END $$;

-- Expiry terminalizes lazily (direct update as the test role, then mint).
DO $$
DECLARE
    v_owner bigint;
    v_gen   bigint;
    v_class text;
BEGIN
    SELECT id INTO v_owner FROM vc.identity_account WHERE username = 'alice-trial';
    PERFORM vc.set_owner_context(v_owner, 'n2', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_owner || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.grant_trial(
        (SELECT id FROM vc.identity_account WHERE username = 'root-trial'), v_owner, 5, 14);
    UPDATE vc.trial_grant SET expires_at = now() - interval '1 hour'
     WHERE owner_user_id = v_owner AND status = 'ACTIVE';
    SET LOCAL ROLE vc_api;
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_owner, 1, 'trial-key-5', 'user', 'late');
    SELECT out_service_class INTO v_class FROM vc.mint_entitlement_snapshot(v_owner, v_gen);
    IF v_class <> 'ECONOMY' THEN
        RAISE EXCEPTION 'expired trial must fall back, got %', v_class;
    END IF;
    RESET ROLE;
END $$;

-- The expired grant terminalized EXPIRED (direct read as the test role,
-- outside any SET ROLE — the table is SD-only for runtime roles).
DO $$
DECLARE
    v_owner bigint;
    n int;
BEGIN
    SELECT id INTO v_owner FROM vc.identity_account WHERE username = 'alice-trial';
    SELECT count(*) INTO n FROM vc.trial_grant
     WHERE owner_user_id = v_owner AND status = 'EXPIRED';
    IF n <> 1 THEN
        RAISE EXCEPTION 'expired grant must terminalize EXPIRED, got %', n;
    END IF;
END $$;

-- grant_trial is ADMIN-only (under the user's owner context it must still fail).
DO $$
DECLARE
    v_owner bigint;
BEGIN
    SELECT id INTO v_owner FROM vc.identity_account WHERE username = 'alice-trial';
    PERFORM vc.set_owner_context(v_owner, 'n3', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_owner || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    BEGIN
        PERFORM vc.grant_trial(v_owner, v_owner, 5, 14);
        RAISE EXCEPTION 'non-admin unexpectedly granted a trial';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-admin unexpectedly granted a trial%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    RESET ROLE;
END $$;

-- QUOTA-PERSIST: reconciliation over constructed ledger/generation rows.
DO $$
DECLARE
    v_owner bigint;
    v_admin_id bigint;
    v_settled bigint;
    v_released bigint;
    v_snc     bigint;
    v_cns     bigint;
    v_fwr     bigint;
BEGIN
    SELECT id INTO v_owner FROM vc.identity_account WHERE username = 'alice-trial';
    -- Registry row for the console read (the coordinator owns writes).
    INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
    VALUES ('alpha-loopback', 'OPENAI_CHAT_COMPLETIONS', ARRAY['TEXT'], 'ADMITTED');

    -- g1: COMPLETED with attempt + SETTLE (healthy).
    UPDATE vc.generation SET status = 'COMPLETED'
     WHERE owner_user_id = v_owner AND id = (SELECT id FROM gen_map WHERE k = 'trial-key-1');
    INSERT INTO vc.generation_attempt(owner_user_id, id, generation_id, provider_ref, outcome)
    VALUES (v_owner, 1, (SELECT id FROM gen_map WHERE k = 'trial-key-1'),
            'alpha', 'SUCCEEDED');
    INSERT INTO vc.quota_ledger_entry(owner_user_id, id, generation_id, kind, quota_amount, reason)
    VALUES (v_owner, 1, (SELECT id FROM gen_map WHERE k = 'trial-key-1'),
            'SETTLE', 1, 'finalized');
    -- g2: FAILED_FINAL with attempt but no RELEASE (anomaly: failed-without-release).
    UPDATE vc.generation SET status = 'FAILED_FINAL'
     WHERE owner_user_id = v_owner AND id = (SELECT id FROM gen_map WHERE k = 'trial-key-2');
    INSERT INTO vc.generation_attempt(owner_user_id, id, generation_id, provider_ref, outcome)
    VALUES (v_owner, 2, (SELECT id FROM gen_map WHERE k = 'trial-key-2'),
            'alpha', 'FAILED');
    -- g3: COMPLETED with attempt but no SETTLE (anomaly: completed-not-settled).
    UPDATE vc.generation SET status = 'COMPLETED'
     WHERE owner_user_id = v_owner AND id = (SELECT id FROM gen_map WHERE k = 'trial-key-3');
    INSERT INTO vc.generation_attempt(owner_user_id, id, generation_id, provider_ref, outcome)
    VALUES (v_owner, 3, (SELECT id FROM gen_map WHERE k = 'trial-key-3'),
            'alpha', 'SUCCEEDED');
    -- g4: CANCELLED with a stray SETTLE (anomaly: settled-not-completed).
    UPDATE vc.generation SET status = 'CANCELLED'
     WHERE owner_user_id = v_owner AND id = (SELECT id FROM gen_map WHERE k = 'trial-key-4');
    INSERT INTO vc.quota_ledger_entry(owner_user_id, id, generation_id, kind, quota_amount, reason)
    VALUES (v_owner, 4, (SELECT id FROM gen_map WHERE k = 'trial-key-4'),
            'SETTLE', 1, 'stray');

    -- Resolve the acting admin BEFORE dropping to vc_api (identity_account
    -- is SD-only for runtime roles).
    v_admin_id := (SELECT id FROM vc.identity_account WHERE username = 'root-trial');
    SET LOCAL ROLE vc_api;
    SELECT out_settled_count, out_released_count, out_settled_not_completed,
           out_completed_not_settled, out_failed_without_release
      INTO v_settled, v_released, v_snc, v_cns, v_fwr
      FROM vc.admin_quota_reconciliation(v_admin_id, now() - interval '1 day');
    -- V67 drill-fix guard: without a row the comparisons below are vacuous.
    IF NOT FOUND THEN
        RAISE EXCEPTION 'admin_quota_reconciliation returned no row (V67 regression)';
    END IF;
    IF v_settled <> 2 OR v_released <> 0 THEN
        RAISE EXCEPTION 'volumes wrong: settled=% released=%', v_settled, v_released;
    END IF;
    IF v_snc <> 1 OR v_cns <> 1 OR v_fwr <> 1 THEN
        RAISE EXCEPTION 'anomalies wrong: snc=% cns=% fwr=%', v_snc, v_cns, v_fwr;
    END IF;

    -- Registry read (ADMIN) + non-ADMIN fail-closed.
    SELECT count(*) INTO v_settled FROM vc.admin_provider_registry(v_admin_id);
    IF v_settled <> 1 THEN
        RAISE EXCEPTION 'registry must expose the persisted deployment';
    END IF;
    BEGIN
        PERFORM vc.admin_provider_registry(v_owner);
        RAISE EXCEPTION 'non-admin unexpectedly read the registry';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-admin unexpectedly read the registry%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    RESET ROLE;
END $$;
