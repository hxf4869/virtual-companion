-- UX-33: one page per relationship and local day, owner-isolated, length-bounded.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27801,'diary owner'),(27802,'diary other');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES(27801,27810,'synthetic',true),(27802,27811,'synthetic',true);
BEGIN;
SELECT vc.set_owner_context(27801,'diary-a',encode(vc.hmac(convert_to('vc-owner-binding-v1|27801|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|diary-a','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_id bigint; BEGIN
 v_id := vc.insert_diary_entry(27801,27810,date '2026-11-02','first page','开心',ARRAY['晚霞']);
 IF v_id IS NULL THEN RAISE EXCEPTION 'page not written'; END IF;
 IF vc.insert_diary_entry(27801,27810,date '2026-11-02','second page','开心',ARRAY[]::text[]) IS NOT NULL THEN RAISE EXCEPTION 'second page for one day written'; END IF;
 IF (SELECT body FROM vc.diary_entry WHERE owner_user_id=27801 AND day=date '2026-11-02')<>'first page' THEN RAISE EXCEPTION 'first page must stand'; END IF;
 BEGIN
  PERFORM vc.insert_diary_entry(27801,27810,date '2026-11-03',repeat('字',301),'开心',ARRAY[]::text[]);
  RAISE EXCEPTION 'oversized page accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM vc.insert_diary_entry(27801,27810,date '2026-11-03','ok','开心',ARRAY['a','b','c','d']);
  RAISE EXCEPTION 'four moments accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM vc.insert_diary_entry(27802,27811,date '2026-11-02','x','开心',ARRAY[]::text[]);
  RAISE EXCEPTION 'foreign owner id accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='foreign owner id accepted' THEN RAISE; END IF; END;
END $$;
COMMIT;
BEGIN;
SELECT vc.set_owner_context(27802,'diary-b',encode(vc.hmac(convert_to('vc-owner-binding-v1|27802|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|diary-b','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.diary_entry) THEN RAISE EXCEPTION 'foreign diary visible'; END IF;
 IF vc.insert_diary_entry(27802,27811,date '2026-11-02','mine','困',ARRAY[]::text[]) IS NULL THEN RAISE EXCEPTION 'same day of another owner must be independent'; END IF;
END $$;
COMMIT;
