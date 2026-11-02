-- MB-9: owner-scoped durable dispositions; retries do not claim another client's call.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(28401,'call fixture'),(28402,'other call fixture');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref) VALUES(28401,28410,'call-card');
INSERT INTO vc.conversation(owner_user_id,id,relationship_id,st_chat_identity,st_mode)
 VALUES(28401,28411,28410,'call-rls-chat','COMPANION');
INSERT INTO vc.follow_up(owner_user_id,id,relationship_id,body,status,normalization_status,event_id,deliverable,greeting_body,generation_outcome)
 SELECT 28401,28430+n,28410,'synthetic','BODY_READY','none','call-rls-'||n,'DELIVERABLE','synthetic','BODY_READY' FROM generate_series(1,4) n;
INSERT INTO vc.proactive_message(owner_user_id,id,relationship_id,trigger_key,kind,cluster_key,status,body,event_id)
 SELECT 28401,28440+n,28410,'call','call','topic','INBOX','synthetic','call-rls-'||n FROM generate_series(1,3) n;
BEGIN;
SELECT vc.set_owner_context(28401,'call-rls',encode(vc.hmac(convert_to('vc-owner-binding-v1|28401|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|call-rls','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE event text; until_at timestamptz; BEGIN
 FOR event IN SELECT 'call-rls-'||n FROM generate_series(1,4) n LOOP
  PERFORM vc.create_inbox_event(28401,event,28411,NULL,NULL,NULL);
  PERFORM vc.arm_inbox_call(28401,event);
 END LOOP;
 IF EXISTS(SELECT 1 FROM vc.inbox_event WHERE event_id='call-rls-4' AND call_state IS NOT NULL) THEN RAISE EXCEPTION 'ordinary message armed as call'; END IF;
 SELECT call_expires_at INTO until_at FROM vc.inbox_event WHERE event_id='call-rls-1';
 PERFORM vc.arm_inbox_call(28401,'call-rls-1');
 IF NOT EXISTS(SELECT 1 FROM vc.inbox_event WHERE event_id='call-rls-1' AND call_expires_at=until_at) THEN RAISE EXCEPTION 'ring window restarted'; END IF;
 IF NOT vc.respond_inbox_call(28401,'call-rls-1','ANSWER','00000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'first answer failed'; END IF;
 IF NOT vc.respond_inbox_call(28401,'call-rls-1','ANSWER','00000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'answer retry lost'; END IF;
 IF vc.respond_inbox_call(28401,'call-rls-1','ANSWER','00000000-0000-4000-8000-000000000002') OR vc.respond_inbox_call(28401,'call-rls-1','DECLINE','00000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'another action claimed answered call'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.inbox_event WHERE event_id='call-rls-1' AND call_state='ANSWERED' AND read_at IS NOT NULL AND NOT st_delivered) THEN RAISE EXCEPTION 'answer changed delivery facts'; END IF;
 IF NOT vc.respond_inbox_call(28401,'call-rls-3','DECLINE','00000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'decline failed'; END IF;
 BEGIN PERFORM vc.respond_inbox_call(28401,'call-rls-4','ANSWER','00000000-0000-4000-8000-000000000004');RAISE EXCEPTION 'ordinary message answered';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'inbox call not found' THEN RAISE; END IF;END;
END $$;
COMMIT;
UPDATE vc.inbox_event SET call_expires_at=clock_timestamp()-interval '1 second' WHERE owner_user_id=28401 AND event_id='call-rls-2';
BEGIN;
SELECT vc.set_owner_context(28401,'call-expired',encode(vc.hmac(convert_to('vc-owner-binding-v1|28401|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|call-expired','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF vc.respond_inbox_call(28401,'call-rls-2','ANSWER','00000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'expired call answered'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.inbox_event WHERE event_id='call-rls-2' AND call_state='MISSED' AND body='synthetic') THEN RAISE EXCEPTION 'missed message was lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.inbox_event WHERE event_id='call-rls-1' AND call_state='ANSWERED') THEN RAISE EXCEPTION 'answer not durable'; END IF;
END $$;
COMMIT;
BEGIN;
SELECT vc.set_owner_context(28402,'call-other',encode(vc.hmac(convert_to('vc-owner-binding-v1|28402|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|call-other','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.inbox_event WHERE event_id LIKE 'call-rls-%') THEN RAISE EXCEPTION 'foreign call visible'; END IF;
 BEGIN PERFORM vc.respond_inbox_call(28402,'call-rls-1','ANSWER','00000000-0000-4000-8000-000000000001');RAISE EXCEPTION 'foreign call answered';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'inbox call not found' THEN RAISE; END IF;END;
END $$;
COMMIT;
