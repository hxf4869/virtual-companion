-- 143_refresh_session_registry: S0-15 V92 — family replay revoke, session
-- list without token_hash, single/all revoke, password change, admin reset
-- requires re-auth and never invents a delivery channel.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_old text := encode(sha256('rt-family-old'::bytea), 'hex');
    v_new text := encode(sha256('rt-family-new'::bytea), 'hex');
    v_replay text := encode(sha256('rt-family-replay'::bytea), 'hex');
    v_other text := encode(sha256('rt-other'::bytea), 'hex');
    v_sid bigint;
    v_n integer;
    v_cur boolean;
    v_ok boolean;
BEGIN
    SELECT vc.identity_admin_seed('root-sess', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-sess', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    PERFORM vc.identity_refresh_token_issue(v_user, v_old, now() + interval '7 days', 'h5');
    PERFORM vc.identity_refresh_token_issue(v_user, v_other, now() + interval '7 days', 'h5');
    PERFORM vc.identity_refresh_token_rotate(v_old, v_new, now() + interval '7 days');

    -- Delayed replay (stolen previous token) after the 5s grace used to spare
    -- concurrent rotate losers.
    UPDATE vc.identity_refresh_token
       SET revoked_at = clock_timestamp() - interval '10 seconds'
     WHERE token_hash = v_old;

    SELECT count(*) INTO v_n
      FROM vc.identity_refresh_token_rotate(v_old, v_replay, now() + interval '7 days');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'replay must fail closed with no rows';
    END IF;
    SELECT count(*) INTO v_n
      FROM vc.identity_refresh_token WHERE token_hash = v_new AND revoked_at IS NULL;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'replay must revoke the live family successor';
    END IF;
    SELECT count(*) INTO v_n
      FROM vc.identity_refresh_token WHERE token_hash = v_other AND revoked_at IS NULL;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'replay must not revoke a different family';
    END IF;

    SELECT count(*) INTO v_n FROM vc.identity_list_sessions(v_user, v_other);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'list must show the remaining live session, got %', v_n;
    END IF;
    SELECT out_current INTO v_cur FROM vc.identity_list_sessions(v_user, v_other);
    IF NOT v_cur THEN
        RAISE EXCEPTION 'current cookie hash must mark current=true';
    END IF;

    SELECT out_id INTO v_sid FROM vc.identity_list_sessions(v_user, v_other);
    v_ok := vc.identity_revoke_session(v_user, v_sid);
    IF NOT v_ok THEN
        RAISE EXCEPTION 'owner must revoke own session';
    END IF;
    SELECT count(*) INTO v_n FROM vc.identity_list_sessions(v_user, NULL);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'revoke session must leave no live rows';
    END IF;

    PERFORM vc.identity_refresh_token_issue(v_user, encode(sha256('rt-a'::bytea), 'hex'), now() + interval '7 days');
    PERFORM vc.identity_refresh_token_issue(v_user, encode(sha256('rt-b'::bytea), 'hex'), now() + interval '7 days');
    v_n := vc.identity_revoke_all_sessions(v_user);
    IF v_n < 2 THEN
        RAISE EXCEPTION 'revoke-all must revoke live rows, got %', v_n;
    END IF;

    v_ok := vc.identity_change_password(v_user, '$2a$10$changed.hash.placeholderxx');
    IF NOT v_ok THEN
        RAISE EXCEPTION 'change password must succeed for ACTIVE user';
    END IF;

    BEGIN
        PERFORM vc.identity_admin_reset_password(
            v_admin, v_user, '$2a$10$reset.hash.placeholderxxx');
        RAISE EXCEPTION 'admin reset without reauth must fail';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%re-auth%' THEN
                RAISE;
            END IF;
    END;

    v_ok := vc.identity_record_reauth(v_admin);
    IF NOT v_ok THEN
        RAISE EXCEPTION 'admin reauth must record';
    END IF;
    IF NOT vc.identity_reauth_valid(v_admin) THEN
        RAISE EXCEPTION 'reauth window must be valid';
    END IF;
    v_ok := vc.identity_admin_reset_password(
        v_admin, v_user, '$2a$10$reset.hash.placeholderxxx');
    IF NOT v_ok THEN
        RAISE EXCEPTION 'admin reset after reauth must succeed';
    END IF;
END $$;
