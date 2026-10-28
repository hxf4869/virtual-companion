-- memory_profile is plaintext, FORCE RLS, and not directly writable by vc_api.
\set ON_ERROR_STOP on
TRUNCATE vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id,display_name) VALUES(1,'alice'),(2,'bob');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES(1,18501,'synthetic',true),(2,18502,'synthetic',true);
INSERT INTO vc.memory_profile(owner_user_id,relationship_id,fingerprint,persona,st_source_refs,record_ids)
VALUES
 (1,18501,'fp-alice','画像明文一',ARRAY['st:alice'],ARRAY['rec-alice']),
 (2,18502,'fp-bob','画像明文二',ARRAY['st:bob'],ARRAY['rec-bob']);

DO $$
DECLARE flags boolean; kind text;
BEGIN
    SELECT c.relrowsecurity AND c.relforcerowsecurity INTO flags
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'vc' AND c.relname = 'memory_profile';
    IF flags IS NOT TRUE THEN RAISE EXCEPTION 'memory_profile RLS is not forced'; END IF;
    SELECT a.atttypid::regtype::text INTO kind
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'vc' AND c.relname = 'memory_profile' AND a.attname = 'persona' AND NOT a.attisdropped;
    IF kind IS DISTINCT FROM 'text' THEN RAISE EXCEPTION 'persona type %', kind; END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    IF (SELECT count(*) FROM vc.memory_profile) <> 0 THEN
        RAISE EXCEPTION 'missing owner context returned profiles';
    END IF;
END $$;
COMMIT;

BEGIN;
SELECT vc.set_owner_context(1,'profile',encode(vc.hmac(convert_to('vc-owner-binding-v1|1|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|profile','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    IF (SELECT count(*) FROM vc.memory_profile) <> 1 THEN RAISE EXCEPTION 'owner profile isolation failed'; END IF;
    IF (SELECT persona FROM vc.memory_profile) IS DISTINCT FROM '画像明文一' THEN RAISE EXCEPTION 'owner saw the wrong persona'; END IF;
    BEGIN
        INSERT INTO vc.memory_profile(owner_user_id,relationship_id,fingerprint,persona,st_source_refs,record_ids)
        VALUES (1,18501,'fp-insert','不应写入',ARRAY['st:x'],ARRAY['rec-x']);
        RAISE EXCEPTION 'direct insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
