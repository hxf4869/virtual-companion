-- UX-36: ST 新建对话遵循已有 incognito-pref；已绑定对话的标志保持冻结。
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES (28301,'ux36-owner'),(28302,'ux36-other');
BEGIN;
SELECT vc.set_owner_context(28301, 'ux36', encode(vc.hmac(convert_to('vc-owner-binding-v1|28301|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|ux36', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE original record; private record; retry record; normal record;
BEGIN
    SELECT * INTO original FROM vc.resolve_st_binding(28301,'ux36-original','ux36-card','COMPANION',NULL,'');
    IF (SELECT incognito FROM vc.conversation WHERE id=original.out_conversation_id) THEN RAISE EXCEPTION 'default ST chat should be non-incognito'; END IF;
    PERFORM vc.update_incognito_pref(28301,true);
    SELECT * INTO private FROM vc.resolve_st_binding(28301,'ux36-private','ux36-card','COMPANION',NULL,'');
    IF NOT (SELECT incognito FROM vc.conversation WHERE id=private.out_conversation_id) THEN RAISE EXCEPTION 'new ST chat ignored enabled incognito preference'; END IF;
    SELECT * INTO retry FROM vc.resolve_st_binding(28301,'ux36-original','ux36-card','COMPANION',NULL,'');
    IF retry.out_conversation_id <> original.out_conversation_id OR (SELECT incognito FROM vc.conversation WHERE id=original.out_conversation_id) THEN RAISE EXCEPTION 'preference changed existing ST chat'; END IF;
    PERFORM vc.update_incognito_pref(28301,false);
    SELECT * INTO normal FROM vc.resolve_st_binding(28301,'ux36-normal','ux36-card','COMPANION',private.out_relationship_id,'');
    IF (SELECT incognito FROM vc.conversation WHERE id=normal.out_conversation_id) THEN RAISE EXCEPTION 'new ST branch ignored disabled preference'; END IF;
    SELECT * INTO retry FROM vc.resolve_st_binding(28301,'ux36-private','ux36-card','COMPANION',NULL,'');
    IF NOT (SELECT incognito FROM vc.conversation WHERE id=retry.out_conversation_id) THEN RAISE EXCEPTION 'private conversation lost frozen flag'; END IF;
    PERFORM vc.update_incognito_pref(28301,true);
END $$;
COMMIT;
BEGIN;
SELECT vc.set_owner_context(28302, 'ux36-other', encode(vc.hmac(convert_to('vc-owner-binding-v1|28302|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|ux36-other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE other record; BEGIN
    SELECT * INTO other FROM vc.resolve_st_binding(28302,'ux36-other','ux36-card','COMPANION',NULL,'');
    IF (SELECT incognito FROM vc.conversation WHERE id=other.out_conversation_id) THEN RAISE EXCEPTION 'incognito preference leaked across owners'; END IF;
END $$;
COMMIT;
