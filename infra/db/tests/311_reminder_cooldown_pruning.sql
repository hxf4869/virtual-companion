-- Reminder retry cleanup is owner-bound and never prunes other cooldown kinds.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES (28401,'cooldown owner'),(28402,'cooldown other');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES
 (28401,28410,'synthetic',true),(28401,28411,'synthetic',true),(28402,28412,'synthetic',true);
INSERT INTO vc.proactive_cooldown(owner_user_id,relationship_id,cooldown_key,until_at) VALUES
 (28401,28410,'reminder:expired','2026-11-05 11:59:59+00'),
 (28401,28410,'reminder:boundary','2026-11-05 12:00:00+00'),
 (28401,28410,'reminder:future','2026-11-05 12:00:01+00'),
 (28401,28410,'diary:attempt','2026-11-05 11:00:00+00'),
 (28401,28410,'reminderish:expired','2026-11-05 11:00:00+00'),
 (28401,28411,'reminder:expired','2026-11-05 12:00:00+00'),
 (28402,28412,'reminder:expired','2026-11-05 12:00:00+00');

DO $$ BEGIN
 IF NOT has_function_privilege('vc_api','vc.prune_reminder_cooldowns(bigint,bigint,timestamptz)','EXECUTE')
    OR NOT has_function_privilege('vc_worker','vc.prune_reminder_cooldowns(bigint,bigint,timestamptz)','EXECUTE') THEN
  RAISE EXCEPTION 'runtime roles cannot prune reminder cooldowns';
 END IF;
 IF has_table_privilege('vc_api','vc.proactive_cooldown','DELETE')
    OR has_table_privilege('vc_worker','vc.proactive_cooldown','DELETE') THEN
  RAISE EXCEPTION 'runtime roles have direct cooldown DELETE';
 END IF;
 IF EXISTS(
  SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid='vc.prune_reminder_cooldowns(bigint,bigint,timestamptz)'::regprocedure
     AND a.grantee=0 AND a.privilege_type='EXECUTE'
 ) THEN RAISE EXCEPTION 'PUBLIC may prune reminder cooldowns'; END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 BEGIN
  PERFORM vc.prune_reminder_cooldowns(28401,28410,'2026-11-05 12:00:00+00');
  RAISE EXCEPTION 'missing owner context accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
 BEGIN
  DELETE FROM vc.proactive_cooldown WHERE relationship_id=28410;
  RAISE EXCEPTION 'direct cooldown DELETE accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;

BEGIN;
SELECT vc.set_owner_context(28401,'cooldown-a',encode(vc.hmac(convert_to('vc-owner-binding-v1|28401|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|cooldown-a','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 PERFORM vc.prune_reminder_cooldowns(28401,28410,'2026-11-05 12:00:00+00');
 PERFORM vc.prune_reminder_cooldowns(28401,28410,'2026-11-05 12:00:00+00');
 IF EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE relationship_id=28410 AND cooldown_key IN ('reminder:expired','reminder:boundary')) THEN
  RAISE EXCEPTION 'expired reminder cooldown retained';
 END IF;
 IF (SELECT count(*) FROM vc.proactive_cooldown WHERE relationship_id=28410) <> 3
    OR NOT EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE relationship_id=28410 AND cooldown_key='reminder:future' AND until_at='2026-11-05 12:00:01+00')
    OR NOT EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE relationship_id=28410 AND cooldown_key='diary:attempt' AND until_at='2026-11-05 11:00:00+00')
    OR NOT EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE relationship_id=28410 AND cooldown_key='reminderish:expired' AND until_at='2026-11-05 11:00:00+00') THEN
  RAISE EXCEPTION 'pruning changed live or non-reminder cooldowns';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE relationship_id=28411 AND cooldown_key='reminder:expired') THEN
  RAISE EXCEPTION 'pruning touched another relationship';
 END IF;
 IF EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE owner_user_id=28402) THEN
  RAISE EXCEPTION 'foreign cooldown visible';
 END IF;
 BEGIN
  PERFORM vc.prune_reminder_cooldowns(28402,28412,'2026-11-05 12:00:00+00');
  RAISE EXCEPTION 'forged owner accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
 PERFORM vc.prune_reminder_cooldowns(28401,28412,'2026-11-05 12:00:00+00');
END $$;
COMMIT;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE owner_user_id=28402 AND relationship_id=28412 AND cooldown_key='reminder:expired' AND until_at='2026-11-05 12:00:00+00') THEN
  RAISE EXCEPTION 'pruning changed another owner cooldown';
 END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(28402,'cooldown-b',encode(vc.hmac(convert_to('vc-owner-binding-v1|28402|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|cooldown-b','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_worker;
DO $$ BEGIN
 PERFORM vc.prune_reminder_cooldowns(28402,28412,'2026-11-05 12:00:00+00');
 IF EXISTS(SELECT 1 FROM vc.proactive_cooldown WHERE relationship_id=28412) THEN
  RAISE EXCEPTION 'worker did not prune its expired cooldown';
 END IF;
 BEGIN
  DELETE FROM vc.proactive_cooldown WHERE relationship_id=28412;
  RAISE EXCEPTION 'worker direct cooldown DELETE accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;
