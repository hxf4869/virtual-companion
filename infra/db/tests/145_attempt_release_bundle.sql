-- 145_attempt_release_bundle: V97 immutable bundle + release-gate capture.
\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice-145', 'test-hash', 'USER', 'ACTIVE', 'alice'),
       (2, 'bob-145', 'test-hash', 'USER', 'ACTIVE', 'bob');
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES (1, 'snap-145-req', 'ACTIVE', 'provider-145', 'us', 'contract-145',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
       (1, 'snap-145-exec', 'ACTIVE', 'provider-145', 'us', 'contract-145',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE bundle_ctx(key text PRIMARY KEY, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b145-setup', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-setup', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_rel bigint; v_conv bigint; v_gen bigint; v_wi bigint; v_token text;
BEGIN
    v_rel := vc.create_relationship(1, 'gentle-listener');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen FROM vc.receive_generation(1, v_conv, 'idem-145', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    SELECT claim_token INTO v_token FROM vc.claim_work_items(1, 'FENCE-145', 300, 1) WHERE id=v_wi;
    INSERT INTO bundle_ctx VALUES ('gen',v_gen::text),('wi',v_wi::text),('tok',v_token);
END $$;
COMMIT;
RESET ROLE;

-- BETA positive: stage/policy are captured by the SD function, not supplied by Java.
UPDATE vc.release_gate SET stage='BETA', eval_passed=true,
    policy_version='policy-beta-145', canary_owner_user_id=NULL WHERE id=1;
BEGIN;
SELECT vc.set_owner_context(1, 'b145-beta', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-beta', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT * FROM vc.create_attempt_intent(
    1,(SELECT value::bigint FROM bundle_ctx WHERE key='wi'),(SELECT value::bigint FROM bundle_ctx WHERE key='gen'),
    encode(vc.digest(convert_to((SELECT value FROM bundle_ctx WHERE key='tok'),'UTF8'),'sha256'),'hex'),
    encode(vc.digest(convert_to('FENCE-145','UTF8'),'sha256'),'hex'),
    'pa-145-beta','provider-145','supplier-145','snap-145-req','snap-145-exec',
    'model-145','revision-145','prompt-145','persona-145','config-145');
SELECT vc.record_attempt_outcome(1,'pa-145-beta','SUCCEEDED',10,NULL);
COMMIT;
RESET ROLE;

DO $$
DECLARE r vc.attempt_intent%ROWTYPE;
BEGIN
    SELECT * INTO r FROM vc.attempt_intent WHERE provider_attempt_id='pa-145-beta';
    IF r.release_stage <> 'BETA' OR r.release_policy_version <> 'policy-beta-145'
       OR r.model_id <> 'model-145' OR r.model_revision <> 'revision-145'
       OR r.prompt_bundle_version <> 'prompt-145' OR r.persona_bundle_version <> 'persona-145'
       OR r.config_version <> 'config-145' THEN
        RAISE EXCEPTION 'BETA release bundle was not captured exactly';
    END IF;
    BEGIN
        UPDATE vc.attempt_intent SET provider_attempt_id='mutated' WHERE provider_attempt_id='pa-145-beta';
        RAISE EXCEPTION 'provider attempt anchor mutation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%anchor mutation must fail%' THEN RAISE; END IF;
        IF position('immutable' in SQLERRM)=0 THEN RAISE; END IF;
    END;
    BEGIN
        UPDATE vc.attempt_intent SET model_revision='mutated' WHERE provider_attempt_id='pa-145-beta';
        RAISE EXCEPTION 'bundle mutation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%bundle mutation must fail%' THEN RAISE; END IF;
        IF position('immutable' in SQLERRM)=0 THEN RAISE; END IF;
    END;
END $$;

-- Runtime roles may use the versioned function but may not bypass it with direct DML.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        UPDATE vc.attempt_intent SET model_revision='runtime-mutated'
         WHERE provider_attempt_id='pa-145-beta';
        RAISE EXCEPTION 'vc_api direct bundle UPDATE must fail';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

-- A partial Java-supplied bundle is rejected before any row is inserted.
BEGIN;
SELECT vc.set_owner_context(1, 'b145-partial', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-partial', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    PERFORM * FROM vc.create_attempt_intent(1,(SELECT value::bigint FROM bundle_ctx WHERE key='wi'),(SELECT value::bigint FROM bundle_ctx WHERE key='gen'),encode(vc.digest(convert_to((SELECT value FROM bundle_ctx WHERE key='tok'),'UTF8'),'sha256'),'hex'),encode(vc.digest(convert_to('FENCE-145','UTF8'),'sha256'),'hex'),'pa-145-partial','provider-145','supplier-145','snap-145-req','snap-145-exec','model-145','revision-145','prompt-145','persona-145',NULL);
    RAISE EXCEPTION 'partial release bundle must fail';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%partial release bundle must fail%' THEN RAISE; END IF;
    IF position('complete immutable release bundle is required' in SQLERRM)=0 THEN RAISE; END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM vc.attempt_intent WHERE provider_attempt_id='pa-145-partial') THEN
        RAISE EXCEPTION 'partial release bundle must insert zero intents';
    END IF;
END $$;

-- CANARY exact owner positive.
UPDATE vc.release_gate SET stage='CANARY', eval_passed=true,
    policy_version='policy-canary-145', canary_owner_user_id=1 WHERE id=1;
BEGIN;
SELECT vc.set_owner_context(1, 'b145-canary', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-canary', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT * FROM vc.create_attempt_intent(
    1,(SELECT value::bigint FROM bundle_ctx WHERE key='wi'),(SELECT value::bigint FROM bundle_ctx WHERE key='gen'),
    encode(vc.digest(convert_to((SELECT value FROM bundle_ctx WHERE key='tok'),'UTF8'),'sha256'),'hex'),
    encode(vc.digest(convert_to('FENCE-145','UTF8'),'sha256'),'hex'),
    'pa-145-canary','provider-145','supplier-145','snap-145-req','snap-145-exec',
    'model-145','revision-145','prompt-145','persona-145','config-145');
SELECT vc.abandon_late_attempt(1,'pa-145-canary');
COMMIT;
RESET ROLE;

DO $$
DECLARE r vc.attempt_intent%ROWTYPE;
BEGIN
    SELECT * INTO r FROM vc.attempt_intent WHERE provider_attempt_id='pa-145-canary';
    IF r.status <> 'ABANDONED_LATE'
       OR r.release_stage <> 'CANARY' OR r.release_policy_version <> 'policy-canary-145'
       OR r.model_id <> 'model-145' OR r.model_revision <> 'revision-145'
       OR r.prompt_bundle_version <> 'prompt-145' OR r.persona_bundle_version <> 'persona-145'
       OR r.config_version <> 'config-145' THEN
        RAISE EXCEPTION 'CANARY abandon must preserve the complete immutable release bundle';
    END IF;
END $$;

-- CANARY wrong owner, disabled owner, and SYNTHETIC all reject before INSERT.
UPDATE vc.release_gate SET stage='CANARY', eval_passed=true,
    policy_version='policy-canary-wrong-145', canary_owner_user_id=2 WHERE id=1;
BEGIN;
SELECT vc.set_owner_context(1, 'b145-wrong', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-wrong', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    PERFORM * FROM vc.create_attempt_intent(1,(SELECT value::bigint FROM bundle_ctx WHERE key='wi'),(SELECT value::bigint FROM bundle_ctx WHERE key='gen'),encode(vc.digest(convert_to((SELECT value FROM bundle_ctx WHERE key='tok'),'UTF8'),'sha256'),'hex'),encode(vc.digest(convert_to('FENCE-145','UTF8'),'sha256'),'hex'),'pa-145-wrong','provider-145','supplier-145','snap-145-req','snap-145-exec','model-145','revision-145','prompt-145','persona-145','config-145');
    RAISE EXCEPTION 'wrong CANARY owner must fail';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%wrong CANARY owner must fail%' THEN RAISE; END IF; END $$;
COMMIT;
RESET ROLE;

UPDATE vc.release_gate SET stage='BETA', eval_passed=true,
    policy_version='policy-disabled-145', canary_owner_user_id=NULL WHERE id=1;
UPDATE vc.identity_account SET status='DISABLED' WHERE id=1;
BEGIN;
SELECT vc.set_owner_context(1, 'b145-disabled', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-disabled', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    PERFORM * FROM vc.create_attempt_intent(1,(SELECT value::bigint FROM bundle_ctx WHERE key='wi'),(SELECT value::bigint FROM bundle_ctx WHERE key='gen'),encode(vc.digest(convert_to((SELECT value FROM bundle_ctx WHERE key='tok'),'UTF8'),'sha256'),'hex'),encode(vc.digest(convert_to('FENCE-145','UTF8'),'sha256'),'hex'),'pa-145-disabled','provider-145','supplier-145','snap-145-req','snap-145-exec','model-145','revision-145','prompt-145','persona-145','config-145');
    RAISE EXCEPTION 'disabled owner must fail';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%disabled owner must fail%' THEN RAISE; END IF; END $$;
COMMIT;
RESET ROLE;
UPDATE vc.identity_account SET status='ACTIVE' WHERE id=1;

UPDATE vc.release_gate SET stage='SYNTHETIC', eval_passed=false,
    policy_version='policy-synthetic-145', canary_owner_user_id=NULL WHERE id=1;
BEGIN;
SELECT vc.set_owner_context(1, 'b145-synthetic', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|b145-synthetic', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    PERFORM * FROM vc.create_attempt_intent(1,(SELECT value::bigint FROM bundle_ctx WHERE key='wi'),(SELECT value::bigint FROM bundle_ctx WHERE key='gen'),encode(vc.digest(convert_to((SELECT value FROM bundle_ctx WHERE key='tok'),'UTF8'),'sha256'),'hex'),encode(vc.digest(convert_to('FENCE-145','UTF8'),'sha256'),'hex'),'pa-145-synthetic','provider-145','supplier-145','snap-145-req','snap-145-exec','model-145','revision-145','prompt-145','persona-145','config-145');
    RAISE EXCEPTION 'SYNTHETIC attempt must fail';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%SYNTHETIC attempt must fail%' THEN RAISE; END IF; END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_count int;
BEGIN
    SELECT count(*) INTO v_count FROM vc.attempt_intent
     WHERE provider_attempt_id IN ('pa-145-wrong','pa-145-disabled','pa-145-synthetic');
    IF v_count <> 0 THEN RAISE EXCEPTION 'rejected release gates must insert zero intents'; END IF;
    IF has_function_privilege('vc_api','vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text)','EXECUTE')
       OR has_function_privilege('vc_worker','vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text)','EXECUTE') THEN
        RAISE EXCEPTION 'legacy create signature must not be runtime executable';
    END IF;
    IF has_function_privilege('public','vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE') THEN
        RAISE EXCEPTION 'versioned create signature must not be PUBLIC executable';
    END IF;
    IF NOT has_function_privilege('vc_api','vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE')
       OR NOT has_function_privilege('vc_worker','vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE') THEN
        RAISE EXCEPTION 'runtime roles must execute the versioned create signature';
    END IF;
    BEGIN
        PERFORM * FROM vc.create_attempt_intent(1,1,1,'a','b','legacy','p','s','r','e');
        RAISE EXCEPTION 'legacy signature must throw bundle required';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%legacy signature must throw%' THEN RAISE; END IF;
        IF position('release bundle required' in SQLERRM)=0 THEN RAISE; END IF;
    END;
END $$;

-- An upgraded historical row may retain an entirely NULL bundle; never fake unknown values.
INSERT INTO vc.attempt_intent(
    owner_user_id,id,work_item_id,generation_id,provider_attempt_id,provider_id,supplier_name,
    status,claim_token_hash,claim_fence_hash,requested_authorization_snapshot,
    execution_authorization_snapshot)
SELECT 1,nextval('vc.attempt_intent_id_seq'),
       (SELECT value::bigint FROM bundle_ctx WHERE key='wi'),
       (SELECT value::bigint FROM bundle_ctx WHERE key='gen'),
       'pa-145-legacy','provider-145','supplier-145','CREATED','legacy-t','legacy-f',
       'snap-145-req','snap-145-exec';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM vc.attempt_intent WHERE provider_attempt_id='pa-145-legacy'
        AND (model_id IS NOT NULL OR model_revision IS NOT NULL OR prompt_bundle_version IS NOT NULL
             OR persona_bundle_version IS NOT NULL OR config_version IS NOT NULL
             OR release_stage IS NOT NULL OR release_policy_version IS NOT NULL)) THEN
        RAISE EXCEPTION 'legacy upgraded row must preserve all-NULL release bundle';
    END IF;
END $$;

DROP TABLE bundle_ctx;
