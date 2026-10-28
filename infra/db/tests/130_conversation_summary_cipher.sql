-- 130_conversation_summary_cipher: W08 removes summary re-encryption surfaces.
-- Plaintext current/history/invalid summaries remain intact, while the memory
-- domain retains RLS, FORCE RLS and trusted-owner policies. Message cipher
-- backfill is outside the memory domain and must remain available.

\set ON_ERROR_STOP on

TRUNCATE vc.conversation_summary, vc.message, vc.conversation, vc.relationship,
         vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true), (2, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL), (2, 1, 1, NULL);

INSERT INTO vc.conversation_summary(
    owner_user_id, id, conversation_id, from_message_id, to_message_id,
    summary, model_id, model_version, prompt_version, confidence,
    validated, service_class, valid, prev_id)
VALUES
    (1, 1, 1, 10, 11, 'historical plaintext summary', 'm', '1', '1', 0.9, true, 'ECONOMY', true, NULL),
    (1, 2, 1, 10, 12, 'current plaintext summary', 'm', '1', '1', 0.9, true, 'ECONOMY', true, 1),
    (1, 3, 1, 10, 11, 'invalid plaintext summary', 'm', '1', '1', 0.9, true, 'ECONOMY', false, 2),
    (2, 4, 1, 10, 11, 'foreign plaintext summary', 'm', '1', '1', 0.9, true, 'ECONOMY', true, NULL);

DO $$
DECLARE signature text; relation_name text; relation_id oid; n integer;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'vc.backfill_stale_cipher_summary_batch(bigint,integer,text)',
        'vc.backfill_replace_summary_cipher(bigint,bigint,text,text)',
        'vc.conversation_summary_cipher_ready(text)',
        'vc.record_encrypted_conversation_summary(bigint,bigint,bigint,bigint,text,text,text,text,real,boolean,text)'
    ] LOOP
        IF to_regprocedure(signature) IS NOT NULL THEN
            RAISE EXCEPTION 'retired summary cipher function remains: %', signature;
        END IF;
    END LOOP;
    IF to_regprocedure('vc.backfill_stale_cipher_message_batch(bigint,integer,text)') IS NULL
       OR to_regprocedure('vc.backfill_replace_message_cipher(bigint,bigint,text,text)') IS NULL THEN
        RAISE EXCEPTION 'non-memory message cipher helpers must remain';
    END IF;
    FOREACH relation_name IN ARRAY ARRAY[
        'memory_item', 'conversation_summary', 'st_message_source',
        'memory_extract_attempt', 'memory_import_bundle'
    ] LOOP
        relation_id := to_regclass('vc.' || relation_name);
        IF NOT EXISTS (SELECT 1 FROM pg_class
                        WHERE oid=relation_id AND relrowsecurity AND relforcerowsecurity) THEN
            RAISE EXCEPTION 'memory domain must retain RLS and FORCE RLS: %', relation_name;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policy
                        WHERE polrelid=relation_id AND polname='owner_isolation'
                          AND pg_get_expr(polqual,polrelid) LIKE '%current_owner_id()%'
                          AND pg_get_expr(polwithcheck,polrelid) LIKE '%current_owner_id()%') THEN
            RAISE EXCEPTION 'trusted-owner read/write policy missing: %', relation_name;
        END IF;
    END LOOP;
    SELECT count(*) INTO n FROM vc.conversation_summary
      WHERE owner_user_id=1 AND id=3 AND NOT valid AND prev_id=2
        AND summary='invalid plaintext summary';
    IF n<>1 THEN RAISE EXCEPTION 'invalid summary history must remain intact'; END IF;
END $$;

-- Missing owner context must not expose plaintext, even though ciphertext
-- readiness no longer exists.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM vc.conversation_summary;
        RAISE EXCEPTION 'direct plaintext summary access must remain denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM vc.latest_conversation_summary(1,1);
        RAISE EXCEPTION 'missing owner context exposed plaintext summaries';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1,'summary-plain',encode(vc.hmac(
    convert_to('vc-owner-binding-v1|1|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|summary-plain','UTF8'),
    convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.latest_conversation_summary(2,1);
        RAISE EXCEPTION 'foreign plaintext summary leaked';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN RAISE; END IF;
    END;
    IF (SELECT out_summary FROM vc.latest_conversation_summary(1,1)) IS DISTINCT FROM 'current plaintext summary' THEN
        RAISE EXCEPTION 'latest valid plaintext summary changed';
    END IF;
END $$;
COMMIT;
RESET ROLE;
