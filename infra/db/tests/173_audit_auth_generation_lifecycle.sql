-- Exercise the SQL credential boundary directly as vc_api, independently of
-- the Go verifier. The transaction rolls fixture data back for other tests.
\set ON_ERROR_STOP on
BEGIN;
TRUNCATE vc.account_deletion_intent, vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'audit-alice');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'audit-alice', 'synthetic-password', 'USER', 'ACTIVE', 'audit-alice');

SELECT vc.set_owner_context(1, 'audit-lifecycle', encode(vc.hmac(
    convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id()
        || '|audit-lifecycle', 'UTF8'),
    convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'),
    'sha256'), 'hex'));
SET LOCAL ROLE vc_api;

DO $$
DECLARE
    recovery_hashes text[] := ARRAY(
        SELECT lpad(to_hex(i), 64, '0') FROM generate_series(1,10) i);
    rejected boolean := false;
    n integer;
BEGIN
    IF NOT vc.identity_auth_challenge_create_current(repeat('A',43), 'TOTP_ENROLL', now()+interval '5 minutes')
       OR NOT vc.identity_auth_challenge_create_current(repeat('B',43), 'TOTP_ENROLL', now()+interval '5 minutes') THEN
        RAISE EXCEPTION 'initial enrollment challenges unavailable';
    END IF;
    PERFORM * FROM vc.identity_auth_challenge_setup(repeat('A',43), 'enc2:audit:first', now());
    PERFORM * FROM vc.identity_auth_challenge_setup(repeat('B',43), 'enc2:audit:second', now());
    PERFORM * FROM vc.identity_auth_challenge_complete_current(
        repeat('A',43), 'TOTP_ENROLL', repeat('1',64), now()+interval '1 hour',
        NULL, recovery_hashes, NULL, NULL, NULL, now(), 1);
    BEGIN
        PERFORM * FROM vc.identity_auth_challenge_complete_current(
            repeat('B',43), 'TOTP_ENROLL', repeat('2',64), now()+interval '1 hour',
            NULL, recovery_hashes, NULL, NULL, NULL, now(), 2);
    EXCEPTION WHEN OTHERS THEN
        rejected := SQLERRM LIKE '%challenge not found%';
    END;
    IF NOT rejected THEN
        RAISE EXCEPTION 'direct SQL completion replaced an active authenticator';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_opaque_session_list(1);
    IF n <> 1 THEN RAISE EXCEPTION 'stale enrollment issued another session'; END IF;

    IF NOT vc.identity_auth_challenge_create_current(repeat('C',43), 'TOTP_VERIFY', now()+interval '5 minutes') THEN
        RAISE EXCEPTION 'verification challenge unavailable';
    END IF;
    IF NOT vc.identity_change_current_password('changed-synthetic-password') THEN
        RAISE EXCEPTION 'password change failed';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.identity_auth_challenge_lock(repeat('C',43), 'TOTP_VERIFY', now())) THEN
        RAISE EXCEPTION 'old-password challenge survived password change';
    END IF;
    IF NOT vc.identity_auth_challenge_create_current(repeat('D',43), 'TOTP_VERIFY', now()+interval '5 minutes') THEN
        RAISE EXCEPTION 'new-password challenge rejected';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_auth_challenge_lock(repeat('D',43), 'TOTP_VERIFY', now())) THEN
        RAISE EXCEPTION 'fresh challenge cannot be verified';
    END IF;

    IF has_function_privilege('public',
        'vc.identity_auth_challenge_complete_current(text,text,text,timestamptz,bigint,text[],text,text,timestamptz,timestamptz,bigint)', 'EXECUTE')
       OR NOT has_function_privilege('vc_api',
        'vc.identity_auth_challenge_complete_current(text,text,text,timestamptz,bigint,text[],text,text,timestamptz,timestamptz,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'replacement changed authentication execution grants';
    END IF;
END;
$$;
ROLLBACK;
