-- UX-32: favorites are idempotent per source and owner-isolated; due reminders are consumed once.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27701,'fav owner'),(27702,'fav other');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES(27701,27710,'synthetic',true),(27702,27711,'synthetic',true);
CREATE TEMP TABLE fav_ids (a bigint, r_once bigint, r_daily bigint);
GRANT ALL ON TABLE fav_ids TO vc_api;
INSERT INTO fav_ids VALUES (0,0,0);
BEGIN;
SELECT vc.set_owner_context(27701,'fav-a',encode(vc.hmac(convert_to('vc-owner-binding-v1|27701|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|fav-a','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_a bigint; v_b bigint; v_once bigint; v_daily bigint; v_next timestamptz; BEGIN
 v_a := vc.create_favorite(27701,27710,'chat.jsonl',4,'character',now(),'晚安');
 v_b := vc.create_favorite(27701,27710,'chat.jsonl',4,'character',now(),'晚安 again');
 IF v_a IS NULL OR v_a IS DISTINCT FROM v_b THEN RAISE EXCEPTION 'same source must return the first favorite'; END IF;
 IF (SELECT body FROM vc.favorite WHERE id=v_a)<>'晚安' THEN RAISE EXCEPTION 'first snapshot must stand'; END IF;
 UPDATE fav_ids SET a=v_a;
 BEGIN
  PERFORM vc.create_favorite(27701,27710,'chat.jsonl',5,'character',now(),repeat('x',2001));
  RAISE EXCEPTION 'oversized favorite accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM vc.create_favorite(27701,27710,'chat.jsonl',6,'system',now(),'x');
  RAISE EXCEPTION 'bad role accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM vc.create_favorite(27701,27711,'chat.jsonl',7,'user',now(),'x');
  RAISE EXCEPTION 'foreign relationship accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM vc.favorite WHERE owner_user_id=27702) THEN RAISE EXCEPTION 'foreign favorites visible'; END IF;

 v_once := vc.create_reminder(27701,27710,'drink water',now()-interval '10 minutes','NONE');
 v_daily := vc.create_reminder(27701,27710,'stretch',now()-interval '10 minutes','DAILY');
 UPDATE fav_ids SET r_once=v_once, r_daily=v_daily;
 IF (SELECT count(*) FROM vc.due_reminders(27701,27710,now()))<>2 THEN RAISE EXCEPTION 'due reminders not listed'; END IF;
 IF EXISTS(SELECT 1 FROM vc.due_reminders(27701,27710,now()-interval '1 hour')) THEN RAISE EXCEPTION 'future reminder reported due'; END IF;
 IF NOT vc.consume_reminder(27701,v_once,now()) THEN RAISE EXCEPTION 'consume failed'; END IF;
 IF vc.consume_reminder(27701,v_once,now()) THEN RAISE EXCEPTION 'reminder consumed twice'; END IF;
 IF (SELECT out_status FROM vc.get_reminder(27701,v_once))<>'DISMISSED' THEN RAISE EXCEPTION 'one-shot not dismissed'; END IF;
 IF NOT vc.consume_reminder(27701,v_daily,now()) THEN RAISE EXCEPTION 'daily consume failed'; END IF;
 SELECT out_remind_at INTO v_next FROM vc.get_reminder(27701,v_daily);
 IF v_next <= now() OR (SELECT out_status FROM vc.get_reminder(27701,v_daily))<>'ACTIVE' THEN RAISE EXCEPTION 'daily reminder must roll forward and stay ACTIVE'; END IF;
 IF NOT vc.delete_favorite(27701,v_a) OR vc.delete_favorite(27701,v_a) THEN RAISE EXCEPTION 'favorite delete not exact'; END IF;
END $$;
COMMIT;
BEGIN;
SELECT vc.set_owner_context(27702,'fav-b',encode(vc.hmac(convert_to('vc-owner-binding-v1|27702|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|fav-b','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.due_reminders(27702,27711,now()+interval '2 days')) THEN RAISE EXCEPTION 'foreign reminders visible'; END IF;
 IF vc.consume_reminder(27702,(SELECT r_daily FROM fav_ids),now()) THEN RAISE EXCEPTION 'foreign reminder consumed'; END IF;
 IF vc.delete_favorite(27702,(SELECT a FROM fav_ids)) THEN RAISE EXCEPTION 'foreign favorite deleted'; END IF;
END $$;
COMMIT;
