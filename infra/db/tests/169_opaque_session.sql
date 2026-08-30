-- 169_opaque_session: G9 additive opaque session functions.
-- Covers issue/lookup/revoke/expiry/reauth/revoke-all and least privilege.
-- Never stores or prints a raw session token.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_opaque_session, vc.identity_refresh_token,
         vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE
    v_user bigint;
    v_other bigint;
    v_hash text := encode(sha256('opaque-fixture-token'::bytea), 'hex');
    v_hash2 text := encode(sha256('opaque-fixture-other'::bytea), 'hex');
    v_expired text := encode(sha256('opaque-fixture-expired'::bytea), 'hex');
    v_sid bigint;
    v_sid2 bigint;
    v_look bigint;
    n int;
    v_reauth timestamptz;
BEGIN
    INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (1, 'alice', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'USER', 'ACTIVE', 'alice'),
           (2, 'bob', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'USER', 'ACTIVE', 'bob');
    v_user := 1;
    v_other := 2;

    v_sid := vc.identity_opaque_session_issue(v_user, v_hash, now() + interval '7 days');
    IF v_sid IS NULL OR v_sid <= 0 THEN
        RAISE EXCEPTION 'issue must return a session id';
    END IF;

    SELECT out_session_id INTO v_look
      FROM vc.identity_opaque_session_lookup(v_hash);
    IF v_look IS DISTINCT FROM v_sid THEN
        RAISE EXCEPTION 'lookup must return the issued session';
    END IF;

    SELECT count(*) INTO n FROM vc.identity_opaque_session_lookup(v_hash2);
    IF n <> 0 THEN
        RAISE EXCEPTION 'unknown hash must miss';
    END IF;

    v_sid2 := vc.identity_opaque_session_issue(v_other, v_hash2, now() + interval '7 days');
    IF vc.identity_opaque_session_revoke(v_other, v_sid) THEN
        RAISE EXCEPTION 'cross-account revoke must fail closed';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_opaque_session_lookup(v_hash);
    IF n <> 1 THEN
        RAISE EXCEPTION 'foreign revoke must leave the live session';
    END IF;

    IF NOT vc.identity_opaque_session_revoke(v_user, v_sid) THEN
        RAISE EXCEPTION 'owner revoke must succeed';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_opaque_session_lookup(v_hash);
    IF n <> 0 THEN
        RAISE EXCEPTION 'revoked session must miss on next lookup';
    END IF;
    IF vc.identity_opaque_session_revoke(v_user, v_sid) THEN
        RAISE EXCEPTION 'second revoke is idempotent false';
    END IF;

    PERFORM vc.identity_opaque_session_issue(v_user, v_expired, now() + interval '1 second');
    UPDATE vc.identity_opaque_session SET expires_at = now() - interval '1 second', created_at = now() - interval '2 seconds'
     WHERE token_hash = v_expired;
    SELECT count(*) INTO n FROM vc.identity_opaque_session_lookup(v_expired);
    IF n <> 0 THEN
        RAISE EXCEPTION 'expired session must miss';
    END IF;

    v_sid := vc.identity_opaque_session_issue(
        v_user, encode(sha256('opaque-fixture-reauth'::bytea), 'hex'), now() + interval '7 days');
    IF NOT vc.identity_opaque_session_record_reauth(v_user, v_sid) THEN
        RAISE EXCEPTION 'reauth must update the live session';
    END IF;
    SELECT out_reauth_at INTO v_reauth
      FROM vc.identity_opaque_session_lookup(encode(sha256('opaque-fixture-reauth'::bytea), 'hex'));
    IF v_reauth IS NULL THEN
        RAISE EXCEPTION 'reauth_at must be set';
    END IF;

    n := vc.identity_opaque_session_revoke_all(v_user);
    IF n < 1 THEN
        RAISE EXCEPTION 'revoke-all must revoke live rows, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.identity_opaque_session_list(v_user);
    IF n <> 0 THEN
        RAISE EXCEPTION 'list after revoke-all must be empty';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_opaque_session_lookup(v_hash2);
    IF n <> 1 THEN
        RAISE EXCEPTION 'revoke-all must not touch another account';
    END IF;
END $$;

SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM count(*) FROM vc.identity_opaque_session;
        RAISE EXCEPTION 'vc_api must not read identity_opaque_session directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
RESET ROLE;
