-- 157_conversation_summary_encrypted_boundary: S0-32 runtime has no plaintext
-- writer; turn metadata contains no message body; incognito produces no metadata.

\set ON_ERROR_STOP on

TRUNCATE vc.conversation_summary, vc.entitlement_snapshot, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE v_admin bigint; v_user bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-summary-boundary', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'summary-boundary', '$2a$10$user.hash.placeholder', 'USER', 'User') INTO v_user;
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, incognito)
    VALUES (v_user, 1, 1, false), (v_user, 2, 1, true);
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (v_user, 10, 1, 'user', 'sensitive-normal'),
           (v_user, 11, 1, 'assistant', 'normal-response'),
           (v_user, 20, 2, 'user', 'sensitive-incognito'),
           (v_user, 21, 2, 'assistant', 'incognito-response');
    INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
    VALUES (v_user, 100, 1, 'summary-normal', 'IN_PROGRESS'),
           (v_user, 101, 2, 'summary-incognito', 'IN_PROGRESS');
    UPDATE vc.message SET generation_id = 100 WHERE owner_user_id = v_user AND id = 11;
    UPDATE vc.message SET generation_id = 101 WHERE owner_user_id = v_user AND id = 21;
    PERFORM set_config('t.summary_user', v_user::text, false);
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.summary_user')::bigint,
    'summary-boundary',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.summary_user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|summary-boundary', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n integer; stored text;
BEGIN
    IF has_function_privilege(
        'vc_api',
        'vc.record_conversation_summary(bigint,bigint,bigint,bigint,text,text,text,text,real,boolean,text)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'legacy plaintext-capable writer must be revoked';
    END IF;
    IF to_regprocedure('vc.record_turn_summary(bigint,bigint)') IS NOT NULL THEN
        RAISE EXCEPTION 'SQL plaintext turn writer must be removed';
    END IF;
    IF to_regprocedure('vc.conversation_summary_stored_text(bigint,bigint)') IS NOT NULL THEN
        RAISE EXCEPTION 'plaintext stored-text reader must be removed';
    END IF;

    BEGIN
        PERFORM vc.record_encrypted_conversation_summary(
            current_setting('t.summary_user')::bigint, 1, 10, 11,
            'sensitive-normal', 'm', '1', '1', 1.0, true, 'ECONOMY');
        RAISE EXCEPTION 'plaintext unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%plaintext unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%enc2 ciphertext is required%' THEN RAISE; END IF;
    END;

    SELECT count(*) INTO n FROM vc.conversation_summary_turn_metadata(
        current_setting('t.summary_user')::bigint, 100);
    IF n <> 1 THEN RAISE EXCEPTION 'normal turn metadata missing'; END IF;
    SELECT count(*) INTO n FROM vc.conversation_summary_turn_metadata(
        current_setting('t.summary_user')::bigint, 101);
    IF n <> 0 THEN RAISE EXCEPTION 'incognito turn must not produce summary metadata'; END IF;

    PERFORM vc.record_encrypted_conversation_summary(
        current_setting('t.summary_user')::bigint, 1, 10, 11,
        'enc2:default:1:QUJDRA==', 'm', '1', '1', 1.0, true, 'ECONOMY');
    SELECT out_summary INTO stored FROM vc.latest_conversation_summary(
        current_setting('t.summary_user')::bigint, 1);
    IF stored NOT LIKE 'enc2:%' OR stored LIKE '%sensitive-normal%' THEN
        RAISE EXCEPTION 'effective summary is not opaque ciphertext';
    END IF;

    PERFORM vc.delete_message(current_setting('t.summary_user')::bigint, 1, 10);
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM vc.conversation_summary
     WHERE owner_user_id = current_setting('t.summary_user')::bigint;
    IF n <> 0 THEN RAISE EXCEPTION 'message deletion left derived summary residue'; END IF;
END $$;
