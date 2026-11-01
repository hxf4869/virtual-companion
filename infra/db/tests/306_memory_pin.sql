-- UX-31: pin state is owner-bound, shown in the management row, and limited to live memories.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27901,'pin owner'),(27902,'pin other');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES(27901,27910,'synthetic',true),(27902,27911,'synthetic',true);
INSERT INTO vc.memory_item(owner_user_id,id,relationship_id,scope,summary,status,engine_record_id,engine_version)
VALUES(27901,27920,27910,'RELATIONSHIP','owner fact','ACCEPTED','r-a',1),
      (27901,27921,27910,'RELATIONSHIP','second fact','ACCEPTED','r-b',1),
      (27902,27922,27911,'RELATIONSHIP','other fact','ACCEPTED','r-c',1);
UPDATE vc.memory_item SET deleted_at=now() WHERE owner_user_id=27901 AND id=27921;
BEGIN;
SELECT vc.set_owner_context(27901,'pin-a',encode(vc.hmac(convert_to('vc-owner-binding-v1|27901|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|pin-a','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF vc.memory_management_row(27901,27920)->>'pinnedAt' IS NOT NULL THEN RAISE EXCEPTION 'fresh memory already pinned'; END IF;
 IF NOT vc.memory_set_pin(27901,27920,true) THEN RAISE EXCEPTION 'own pin failed'; END IF;
 IF vc.memory_management_row(27901,27920)->>'pinnedAt' IS NULL THEN RAISE EXCEPTION 'pinnedAt missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.memory_pinned_ids(27901,27910) WHERE out_id=27920) THEN RAISE EXCEPTION 'pinned id not listed'; END IF;
 IF vc.memory_set_pin(27901,27922,true) THEN RAISE EXCEPTION 'foreign memory pinned'; END IF;
 IF vc.memory_set_pin(27901,27921,true) THEN RAISE EXCEPTION 'forgotten memory pinned'; END IF;
 BEGIN
  PERFORM vc.memory_set_pin(27902,27922,true);
  RAISE EXCEPTION 'foreign owner id accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='foreign owner id accepted' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM vc.memory_pinned_ids(27902,27911)) THEN RAISE EXCEPTION 'foreign pins disclosed'; END IF;
 IF NOT vc.memory_set_pin(27901,27920,false) THEN RAISE EXCEPTION 'unpin failed'; END IF;
 IF vc.memory_management_row(27901,27920)->>'pinnedAt' IS NOT NULL OR EXISTS(SELECT 1 FROM vc.memory_pinned_ids(27901,27910)) THEN RAISE EXCEPTION 'unpin left state'; END IF;
END $$;
COMMIT;
