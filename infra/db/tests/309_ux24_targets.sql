-- UX-32/33: scheduler target lists. A due ACTIVE reminder selects its relationship for the
-- proactive pass; future, consumed and dismissed ones do not. Diary targets need a user
-- message in a present, non-incognito companion chat inside the window.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(28101,'targets owner');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES
 (28101,28110,'synthetic',true),(28101,28111,'synthetic',true),(28101,28112,'synthetic',true),
 (28101,28113,'synthetic',true),(28101,28114,'synthetic',true),(28101,28115,'synthetic',true);
INSERT INTO vc.reminder(owner_user_id,id,relationship_id,text,remind_at,recurrence,status,cancelled_at) VALUES
 (28101,28120,28110,'due',now()-interval '5 minutes','NONE','ACTIVE',NULL),
 (28101,28121,28111,'future',now()+interval '1 hour','NONE','ACTIVE',NULL),
 (28101,28122,28112,'consumed',now()-interval '5 minutes','NONE','DISMISSED',NULL),
 (28101,28123,28113,'cancelled',now()-interval '5 minutes','NONE','CANCELLED',now());
INSERT INTO vc.conversation(owner_user_id,id,relationship_id,st_chat_identity,st_mode,incognito) VALUES
 (28101,28130,28110,'chat-targets-a','COMPANION',false),
 (28101,28131,28111,'chat-targets-b','COMPANION',true),
 (28101,28132,28112,'chat-targets-c','COMPANION',false),
 (28101,28133,28113,'chat-targets-d','COMPANION',false),
 (28101,28134,28114,'chat-targets-e','COMPANION',false);
INSERT INTO vc.st_message_source(owner_user_id,conversation_id,message_id,candidate_id,source_revision,source_generation,source_ref,role,content_cipher,present,settled,eligible,source_timestamp) VALUES
 (28101,28130,'30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000011',1,1,'st:t:a','user','hi',true,true,true,now()-interval '1 hour'),
 (28101,28131,'30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000012',1,1,'st:t:b','user','hi',true,true,true,now()-interval '1 hour'),
 (28101,28132,'30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000013',1,1,'st:t:c','assistant','hi',true,true,true,now()-interval '1 hour'),
 (28101,28133,'30000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000014',1,1,'st:t:d','user','hi',true,true,true,now()-interval '3 days'),
 (28101,28134,'30000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000015',1,1,'st:t:e','user','hi',false,true,true,now()-interval '1 hour');
BEGIN;
SET LOCAL ROLE vc_worker;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.list_proactive_targets() WHERE out_owner=28101 AND out_relationship=28110) THEN RAISE EXCEPTION 'due ACTIVE reminder not a proactive target'; END IF;
 IF EXISTS(SELECT 1 FROM vc.list_proactive_targets() WHERE out_owner=28101 AND out_relationship IN (28111,28112,28113)) THEN RAISE EXCEPTION 'future, consumed or cancelled reminder selected a target'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.list_diary_targets(now()-interval '36 hours') WHERE out_owner=28101 AND out_relationship=28110) THEN RAISE EXCEPTION 'chat with a user message today is not a diary target'; END IF;
 IF EXISTS(SELECT 1 FROM vc.list_diary_targets(now()-interval '36 hours') WHERE out_owner=28101 AND out_relationship IN (28111,28112,28113,28114)) THEN RAISE EXCEPTION 'incognito, assistant-only, stale or absent-source chat became a diary target'; END IF;
END $$;
COMMIT;
-- A consumed reminder stops selecting its relationship.
UPDATE vc.reminder SET status='DISMISSED' WHERE owner_user_id=28101 AND id=28120;
BEGIN;
SET LOCAL ROLE vc_worker;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.list_proactive_targets() WHERE out_owner=28101 AND out_relationship=28110) THEN RAISE EXCEPTION 'dismissed reminder still selects a target'; END IF;
END $$;
COMMIT;
-- Relationship reset clears favorites and diary pages of that relationship only.
INSERT INTO vc.favorite(owner_user_id,relationship_id,chat_file,mes_id,role,body) VALUES(28101,28110,'f.jsonl',1,'user','keep?'),(28101,28114,'f.jsonl',2,'user','other');
INSERT INTO vc.diary_entry(owner_user_id,relationship_id,day,body,vibe) VALUES(28101,28110,date '2026-11-02','page','开心'),(28101,28114,date '2026-11-02','page','开心');
BEGIN;
SELECT vc.set_owner_context(28101,'targets-owner',encode(vc.hmac(convert_to('vc-owner-binding-v1|28101|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|targets-owner','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 PERFORM vc.clear_relationship_ux24(28101,28110);
 IF EXISTS(SELECT 1 FROM vc.favorite WHERE relationship_id=28110) OR EXISTS(SELECT 1 FROM vc.diary_entry WHERE relationship_id=28110) THEN RAISE EXCEPTION 'reset left favorites or diary'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.favorite WHERE relationship_id=28114) OR NOT EXISTS(SELECT 1 FROM vc.diary_entry WHERE relationship_id=28114) THEN RAISE EXCEPTION 'reset touched another relationship'; END IF;
END $$;
COMMIT;
