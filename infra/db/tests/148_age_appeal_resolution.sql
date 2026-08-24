-- 148_age_appeal_resolution: S0-12 human age-appeal disposition is role-gated,
-- append-only for effective age state, audited, repeat-safe, and stores no
-- identity-document or biometric payload.

\set ON_ERROR_STOP on

TRUNCATE vc.ops_case_event, vc.ops_case, vc.age_appeal, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_priv bigint;
    v_user bigint;
    v_approve_owner bigint;
    v_deny_owner bigint;
    v_reverify_owner bigint;
    v_suspend_owner bigint;
    v_appeal bigint;
    v_case bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-age-resolution', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'privacy-age-resolution', '$2a$10$priv.hash.placeholder',
        'PRIVACY_OPERATOR', 'Privacy') INTO v_priv;
    SELECT vc.identity_account_create(
        v_admin, 'user-age-resolution', '$2a$10$user.hash.placeholder',
        'USER', 'User') INTO v_user;
    SELECT vc.identity_account_create(
        v_admin, 'owner-approve-age', '$2a$10$a.hash.placeholder',
        'USER', 'A') INTO v_approve_owner;
    SELECT vc.identity_account_create(
        v_admin, 'owner-deny-age', '$2a$10$b.hash.placeholder',
        'USER', 'B') INTO v_deny_owner;
    SELECT vc.identity_account_create(
        v_admin, 'owner-reverify-age', '$2a$10$c.hash.placeholder',
        'USER', 'C') INTO v_reverify_owner;
    SELECT vc.identity_account_create(
        v_admin, 'owner-suspend-age', '$2a$10$d.hash.placeholder',
        'USER', 'D') INTO v_suspend_owner;

    INSERT INTO vc.age_verification(owner_user_id, id, age_state, provider_ref)
    SELECT owner_id, nextval('vc.age_verification_id_seq'),
           'AGE_APPEAL_PENDING', 'age-appeal'
      FROM unnest(ARRAY[
          v_approve_owner, v_deny_owner, v_reverify_owner, v_suspend_owner]) owner_id;

    v_appeal := nextval('vc.age_appeal_id_seq');
    INSERT INTO vc.age_appeal(owner_user_id, id, reason)
    VALUES (v_approve_owner, v_appeal, 'approve');
    PERFORM set_config('t.approve_appeal', v_appeal::text, false);

    v_appeal := nextval('vc.age_appeal_id_seq');
    INSERT INTO vc.age_appeal(owner_user_id, id, reason)
    VALUES (v_deny_owner, v_appeal, 'deny');
    PERFORM set_config('t.deny_appeal', v_appeal::text, false);

    v_appeal := nextval('vc.age_appeal_id_seq');
    INSERT INTO vc.age_appeal(owner_user_id, id, reason)
    VALUES (v_reverify_owner, v_appeal, 'reverify');
    PERFORM set_config('t.reverify_appeal', v_appeal::text, false);

    v_appeal := nextval('vc.age_appeal_id_seq');
    INSERT INTO vc.age_appeal(owner_user_id, id, reason)
    VALUES (v_suspend_owner, v_appeal, 'suspend');
    PERFORM set_config('t.suspend_appeal', v_appeal::text, false);

    SELECT out_id INTO v_case FROM vc.open_ops_case(
        v_admin, 'AGE_APPEAL', v_reverify_owner,
        current_setting('t.reverify_appeal')::bigint, 'P1');
    PERFORM set_config('t.reverify_case', v_case::text, false);
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.priv', v_priv::text, false);
    PERFORM set_config('t.user', v_user::text, false);
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_state text;
BEGIN
    SELECT out_age_state INTO v_state FROM vc.resolve_age_appeal(
        current_setting('t.admin')::bigint,
        current_setting('t.approve_appeal')::bigint,
        'APPROVE_ADULT', 'human review approved');
    IF v_state <> 'ADULT_VERIFIED' THEN
        RAISE EXCEPTION 'APPROVE_ADULT mapped to %', v_state;
    END IF;

    SELECT out_age_state INTO v_state FROM vc.resolve_age_appeal(
        current_setting('t.priv')::bigint,
        current_setting('t.deny_appeal')::bigint,
        'DENY_MINOR', 'human review denied');
    IF v_state <> 'MINOR_VERIFIED' THEN
        RAISE EXCEPTION 'DENY_MINOR mapped to %', v_state;
    END IF;

    SELECT out_age_state INTO v_state FROM vc.resolve_age_appeal(
        current_setting('t.priv')::bigint,
        current_setting('t.reverify_appeal')::bigint,
        'REVERIFY', 'evidence insufficient; reverify');
    IF v_state <> 'AGE_REVERIFY_REQUIRED' THEN
        RAISE EXCEPTION 'REVERIFY mapped to %', v_state;
    END IF;

    SELECT out_age_state INTO v_state FROM vc.resolve_age_appeal(
        current_setting('t.admin')::bigint,
        current_setting('t.suspend_appeal')::bigint,
        'SUSPEND', 'access suspended after review');
    IF v_state <> 'AGE_ACCESS_SUSPENDED' THEN
        RAISE EXCEPTION 'SUSPEND mapped to %', v_state;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
    v_state text;
    v_actor bigint;
BEGIN
    SELECT count(*) INTO v_count FROM vc.age_appeal
     WHERE status = 'RESOLVED' AND resolution_decision IS NOT NULL
       AND resolved_by_account_id IS NOT NULL AND resolved_at IS NOT NULL;
    IF v_count <> 4 THEN
        RAISE EXCEPTION 'all four appeals must be resolved, got %', v_count;
    END IF;

    SELECT age_state INTO v_state FROM vc.age_verification
     WHERE owner_user_id = (SELECT owner_user_id FROM vc.age_appeal
         WHERE id = current_setting('t.reverify_appeal')::bigint)
     ORDER BY id DESC LIMIT 1;
    IF v_state <> 'AGE_REVERIFY_REQUIRED' THEN
        RAISE EXCEPTION 'effective reverify state not appended';
    END IF;

    SELECT resolved_by_account_id INTO v_actor FROM vc.age_appeal
     WHERE id = current_setting('t.reverify_appeal')::bigint;
    IF v_actor <> current_setting('t.priv')::bigint THEN
        RAISE EXCEPTION 'privacy reviewer actor not audited';
    END IF;

    SELECT count(*) INTO v_count FROM vc.age_verification
     WHERE provider_ref = 'operator-appeal-review';
    IF v_count <> 4 THEN
        RAISE EXCEPTION 'resolution history must use the fixed provider reference';
    END IF;

    SELECT count(*) INTO v_count FROM vc.ops_case
     WHERE id = current_setting('t.reverify_case')::bigint
       AND status = 'RESOLVED';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'linked AGE_APPEAL ops case was not resolved';
    END IF;
    SELECT count(*) INTO v_count FROM vc.ops_case_event
     WHERE case_id = current_setting('t.reverify_case')::bigint
       AND event_type = 'RESOLVE'
       AND actor_account_id = current_setting('t.priv')::bigint;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'linked ops case resolution was not actor-audited';
    END IF;
END $$;

-- A normal user cannot act as reviewer; repeat and free-form decisions fail closed.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_denied boolean;
BEGIN
    v_denied := false;
    BEGIN
        PERFORM * FROM vc.resolve_age_appeal(
            current_setting('t.user')::bigint,
            current_setting('t.approve_appeal')::bigint,
            'APPROVE_ADULT', 'not authorized');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%mutation denied%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'USER reviewer must fail closed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.resolve_age_appeal(
            999999999,
            current_setting('t.approve_appeal')::bigint,
            'APPROVE_ADULT', 'unknown actor');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%mutation denied%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'unknown reviewer must fail closed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.resolve_age_appeal(
            current_setting('t.priv')::bigint,
            current_setting('t.approve_appeal')::bigint,
            'APPROVE_ADULT', 'repeat');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%already resolved%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'repeat resolution must fail closed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.resolve_age_appeal(
            current_setting('t.priv')::bigint,
            current_setting('t.approve_appeal')::bigint,
            'FREE_FORM', 'invalid');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%unsupported decision%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'free-form decision must fail closed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF has_function_privilege(
        'public', 'vc.resolve_age_appeal(bigint, bigint, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC must not execute resolve_age_appeal';
    END IF;
    IF NOT has_function_privilege(
        'vc_api', 'vc.resolve_age_appeal(bigint, bigint, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api must execute resolve_age_appeal';
    END IF;
    IF has_function_privilege(
        'vc_worker', 'vc.resolve_age_appeal(bigint, bigint, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute resolve_age_appeal';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'vc' AND table_name = 'age_appeal'
           AND (column_name LIKE '%document%' OR column_name LIKE '%biometric%'
                OR column_name LIKE '%image%')) THEN
        RAISE EXCEPTION 'age appeal schema must not store document/biometric payloads';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        UPDATE vc.age_appeal SET resolution_note = 'bypass'
         WHERE id = current_setting('t.approve_appeal')::bigint;
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_api must not bypass resolve_age_appeal with direct UPDATE';
    END IF;
END $$;
COMMIT;
RESET ROLE;
