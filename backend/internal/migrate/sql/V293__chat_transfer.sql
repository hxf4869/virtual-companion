-- SX-8. Schema installation never changes an account's authority.
SET search_path=vc,pg_catalog;

CREATE TABLE vc.chat_file_alias (
 owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('SINGLE','GROUP')),
 scope_ref text NOT NULL CHECK(scope_ref<>''),
 file_name text NOT NULL CHECK(file_name<>'' AND file_name ~ '\.jsonl$' AND file_name !~ '[/\\]' AND file_name NOT IN ('.jsonl','..jsonl')),
 chat_id uuid NOT NULL,
 is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY(owner_user_id,kind,scope_ref,file_name)
);
CREATE UNIQUE INDEX chat_file_alias_primary ON vc.chat_file_alias(owner_user_id,chat_id) WHERE is_primary;
CREATE INDEX chat_file_alias_identity ON vc.chat_file_alias(owner_user_id,chat_id);
-- No chat FK: conversation deletion must not release old names or identities.
CREATE FUNCTION vc.default_chat_file_alias() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 INSERT INTO vc.chat_file_alias VALUES(NEW.owner_user_id,NEW.kind,coalesce(NEW.character_ref,NEW.group_ref),NEW.chat_id::text||'.jsonl',NEW.chat_id,true);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION vc.default_chat_file_alias() FROM PUBLIC;
CREATE TRIGGER default_chat_file_alias AFTER INSERT ON vc.stored_chat FOR EACH ROW EXECUTE FUNCTION vc.default_chat_file_alias();
INSERT INTO vc.chat_file_alias SELECT owner_user_id,kind,coalesce(character_ref,group_ref),chat_id::text||'.jsonl',chat_id,true FROM vc.stored_chat;

-- Intentionally no owner FK: GC must survive account deletion and interrupted uploads.
CREATE TABLE vc.chat_transfer_object (
 transfer_id uuid PRIMARY KEY,
 owner_user_id bigint,
 prefix text NOT NULL UNIQUE CHECK(prefix ~ '^chat-transfer/[0-9a-f-]{36}/$'),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 released boolean NOT NULL DEFAULT false
);
CREATE INDEX chat_transfer_object_expiry ON vc.chat_transfer_object(expires_at);
CREATE TABLE vc.chat_import (
 owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
 import_id uuid NOT NULL,
 request_id uuid NOT NULL,
 request_digest bytea NOT NULL,
 authority_epoch bigint NOT NULL CHECK(authority_epoch>0),
 chat_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','DONE','FAILED','EXPIRED')),
 input_cipher text,
 prepared_cipher text,
 result_cipher text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 lease_token uuid,
 lease_until timestamptz,
 PRIMARY KEY(owner_user_id,import_id),
 UNIQUE(owner_user_id,request_id),
 UNIQUE(owner_user_id,chat_id),
 CHECK(input_cipher IS NULL OR input_cipher LIKE 'enc2:%'),
 CHECK(prepared_cipher IS NULL OR prepared_cipher LIKE 'enc2:%'),
 CHECK(result_cipher IS NULL OR result_cipher LIKE 'enc2:%')
);
CREATE UNIQUE INDEX chat_import_active ON vc.chat_import(owner_user_id) WHERE status='PENDING';
CREATE INDEX chat_import_pending ON vc.chat_import(expires_at,lease_until) WHERE status='PENDING';

CREATE TABLE vc.chat_migration_run (
 owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
 run_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN('ST_TO_GO','GO_TO_ST')),
 frozen_epoch bigint NOT NULL,
 status text NOT NULL CHECK(status IN('FROZEN','VERIFIED','ACTIVATED')),
 manifest_cipher text,
 PRIMARY KEY(owner_user_id,run_id),
 CHECK(manifest_cipher IS NULL OR manifest_cipher LIKE 'enc2:%')
);
CREATE TABLE vc.chat_migration_checkpoint (
 owner_user_id bigint NOT NULL,
 run_id uuid NOT NULL,
 old_identity uuid NOT NULL,
 source_hash text NOT NULL CHECK(source_hash='' OR source_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('STAGED','VERIFIED')),
 record_cipher text NOT NULL CHECK(record_cipher LIKE 'enc2:%'),
 PRIMARY KEY(owner_user_id,run_id,old_identity),
 FOREIGN KEY(owner_user_id,run_id) REFERENCES vc.chat_migration_run ON DELETE CASCADE
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['chat_file_alias','chat_transfer_object','chat_import','chat_migration_run','chat_migration_checkpoint'] LOOP
  EXECUTE format('ALTER TABLE vc.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE vc.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_isolation ON vc.%I FOR ALL TO vc_api,vc_worker USING(owner_user_id=vc.current_owner_id()) WITH CHECK(owner_user_id=vc.current_owner_id())',t);
  EXECUTE format('REVOKE ALL ON vc.%I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT ON vc.%I TO vc_api,vc_worker',t);
 END LOOP;
END $$;

CREATE FUNCTION vc.begin_chat_transfer(p_owner bigint,p_id uuid) RETURNS SETOF vc.chat_transfer_object
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 PERFORM vc.lock_chat_authority(p_owner,false);
 RETURN QUERY INSERT INTO vc.chat_transfer_object(transfer_id,owner_user_id,prefix) VALUES(p_id,p_owner,'chat-transfer/'||p_id::text||'/') RETURNING *;
END $$;
CREATE FUNCTION vc.release_chat_transfer(p_owner bigint,p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.chat_transfer_object SET released=true WHERE transfer_id=p_id AND owner_user_id=p_owner;
END $$;
CREATE FUNCTION vc.list_chat_transfer_cleanup(p_limit integer) RETURNS SETOF vc.chat_transfer_object
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT * FROM vc.chat_transfer_object o WHERE released OR expires_at<=now() OR (o.owner_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc.vc_user u WHERE u.id=o.owner_user_id))
 ORDER BY expires_at,transfer_id LIMIT least(greatest(p_limit,1),256)
$$;
CREATE FUNCTION vc.finish_chat_transfer_cleanup(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 DELETE FROM vc.chat_transfer_object WHERE transfer_id=p_id AND expires_at<=now()
$$;
CREATE FUNCTION vc.seal_chat_import(p_owner bigint,p_id uuid,p_request uuid,p_digest bytea,p_epoch bigint,p_chat uuid,p_input text,p_result text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE a record;
BEGIN
 SELECT * INTO a FROM vc.lock_chat_authority(p_owner,true);
 IF a.authority<>'GO' OR a.epoch<>p_epoch THEN RAISE EXCEPTION 'chat authority changed'; END IF;
 UPDATE vc.chat_import SET status='EXPIRED',input_cipher=NULL,prepared_cipher=NULL,result_cipher=NULL,lease_token=NULL,lease_until=NULL WHERE owner_user_id=p_owner AND expires_at<=now();
 INSERT INTO vc.chat_import(owner_user_id,import_id,request_id,request_digest,authority_epoch,chat_id,input_cipher,result_cipher)
 VALUES(p_owner,p_id,p_request,p_digest,p_epoch,p_chat,p_input,p_result);
END $$;
CREATE FUNCTION vc.pending_chat_imports(p_limit integer) RETURNS TABLE(owner_user_id bigint,import_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT owner_user_id,import_id FROM vc.chat_import WHERE status='PENDING' AND expires_at>clock_timestamp() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY expires_at LIMIT least(greatest(p_limit,1),100)
$$;
CREATE FUNCTION vc.claim_chat_import(p_owner bigint,p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.chat_import SET lease_token=p_token,lease_until=clock_timestamp()+interval '150 seconds' WHERE owner_user_id=p_owner AND import_id=p_id AND status='PENDING' AND expires_at>clock_timestamp() AND (lease_until IS NULL OR lease_until<=now());
 RETURN FOUND;
END $$;
CREATE FUNCTION vc.checkpoint_chat_import(p_owner bigint,p_id uuid,p_token uuid,p_prepared text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.chat_import SET prepared_cipher=p_prepared WHERE owner_user_id=p_owner AND import_id=p_id AND status='PENDING' AND lease_token=p_token AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() AND prepared_cipher IS NULL;
 RETURN FOUND;
END $$;
CREATE FUNCTION vc.finish_chat_import(p_owner bigint,p_id uuid,p_token uuid,p_status text,p_result text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_status NOT IN('DONE','FAILED') THEN RAISE EXCEPTION 'invalid import state'; END IF;
 UPDATE vc.chat_import SET status=p_status,result_cipher=p_result,input_cipher=NULL,prepared_cipher=NULL,lease_token=NULL,lease_until=NULL
 WHERE owner_user_id=p_owner AND import_id=p_id AND status='PENDING' AND lease_token=p_token AND lease_until>clock_timestamp() AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
CREATE FUNCTION vc.rename_chat_file(p_owner bigint,p_chat uuid,p_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE c vc.stored_chat; occupied uuid;
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 SELECT * INTO STRICT c FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL;
 SELECT chat_id INTO occupied FROM vc.chat_file_alias WHERE owner_user_id=p_owner AND kind=c.kind AND scope_ref=coalesce(c.character_ref,c.group_ref) AND file_name=p_name;
 IF occupied IS NOT NULL THEN RAISE EXCEPTION 'chat file name reserved' USING ERRCODE='23505'; END IF;
 UPDATE vc.chat_file_alias SET is_primary=false WHERE owner_user_id=p_owner AND chat_id=p_chat;
 INSERT INTO vc.chat_file_alias VALUES(p_owner,c.kind,coalesce(c.character_ref,c.group_ref),p_name,p_chat,true);
END $$;
REVOKE ALL ON FUNCTION vc.begin_chat_transfer(bigint,uuid),vc.release_chat_transfer(bigint,uuid),vc.list_chat_transfer_cleanup(integer),vc.finish_chat_transfer_cleanup(uuid),vc.seal_chat_import(bigint,uuid,uuid,bytea,bigint,uuid,text,text),vc.pending_chat_imports(integer),vc.claim_chat_import(bigint,uuid,uuid),vc.checkpoint_chat_import(bigint,uuid,uuid,text),vc.finish_chat_import(bigint,uuid,uuid,text,text),vc.rename_chat_file(bigint,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.begin_chat_transfer(bigint,uuid),vc.release_chat_transfer(bigint,uuid),vc.seal_chat_import(bigint,uuid,uuid,bytea,bigint,uuid,text,text),vc.claim_chat_import(bigint,uuid,uuid),vc.checkpoint_chat_import(bigint,uuid,uuid,text),vc.finish_chat_import(bigint,uuid,uuid,text,text),vc.rename_chat_file(bigint,uuid,text) TO vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.list_chat_transfer_cleanup(integer),vc.finish_chat_transfer_cleanup(uuid),vc.pending_chat_imports(integer) TO vc_worker;
-- Only the service-token multipart adapter uses an unbound intent before it has
-- read ownerAccountId. It carries no chat access; binding requires owner proof.
CREATE FUNCTION vc.begin_unbound_chat_transfer(p_id uuid) RETURNS SETOF vc.chat_transfer_object
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 INSERT INTO vc.chat_transfer_object(transfer_id,prefix) VALUES(p_id,'chat-transfer/'||p_id::text||'/') RETURNING *
$$;
CREATE FUNCTION vc.bind_chat_transfer(p_owner bigint,p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 PERFORM vc.lock_chat_authority(p_owner,false);
 UPDATE vc.chat_transfer_object SET owner_user_id=p_owner WHERE transfer_id=p_id AND (owner_user_id IS NULL OR owner_user_id=p_owner) AND NOT released AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION vc.begin_unbound_chat_transfer(uuid),vc.bind_chat_transfer(bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.begin_unbound_chat_transfer(uuid),vc.bind_chat_transfer(bigint,uuid) TO vc_api,vc_worker;
-- One bounded batch at a time within the caller's exact-revision transfer commit.
-- All documents are ciphertext; source publication uses its existing guarded helper.
CREATE FUNCTION vc.apply_chat_transfer_rows(p_owner bigint,p_chat uuid,p_revision bigint,p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m jsonb; c jsonb;
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 FOR m IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=(m->>'id')::uuid AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'deleted message identity'; END IF;
  INSERT INTO vc.stored_message(owner_user_id,chat_id,message_id,position,revision,selected_candidate_id,data_cipher,initial_digest,changed_chat_revision,source_changed_revision,created_chat_revision)
   VALUES(p_owner,p_chat,(m->>'id')::uuid,(m->>'position')::bigint,(m->>'revision')::bigint,(m->>'selected')::uuid,m->>'data',''::bytea,p_revision,p_revision,p_revision)
  ON CONFLICT(owner_user_id,chat_id,message_id) DO UPDATE SET position=excluded.position,revision=excluded.revision,selected_candidate_id=excluded.selected_candidate_id,data_cipher=excluded.data_cipher,
   changed_chat_revision=CASE WHEN (m->>'contentChanged')::boolean THEN p_revision ELSE vc.stored_message.changed_chat_revision END,
   source_changed_revision=CASE WHEN (m->>'sourceChanged')::boolean THEN p_revision ELSE vc.stored_message.source_changed_revision END,
   created_chat_revision=vc.stored_message.created_chat_revision;
  UPDATE vc.stored_candidate SET deleted_at=now(),data_cipher='',settled=false,source_generation=source_generation+1
   WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=(m->>'id')::uuid AND deleted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(m->'candidates') x WHERE (x->>'id')::uuid=candidate_id);
  FOR c IN SELECT * FROM jsonb_array_elements(m->'candidates') LOOP
   IF EXISTS(SELECT 1 FROM vc.stored_candidate WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=(m->>'id')::uuid AND candidate_id=(c->>'id')::uuid AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'deleted candidate identity'; END IF;
   INSERT INTO vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id,ordinal,source_revision,source_generation,settled,ever_selected,data_cipher,initial_digest)
    VALUES(p_owner,p_chat,(m->>'id')::uuid,(c->>'id')::uuid,(c->>'ordinal')::integer,(c->>'revision')::bigint,(c->>'generation')::bigint,(c->>'settled')::boolean,(c->>'everSelected')::boolean,c->>'data',''::bytea)
   ON CONFLICT(owner_user_id,chat_id,message_id,candidate_id) DO UPDATE SET ordinal=excluded.ordinal,source_revision=excluded.source_revision,source_generation=excluded.source_generation,settled=excluded.settled,ever_selected=vc.stored_candidate.ever_selected OR excluded.ever_selected,data_cipher=excluded.data_cipher;
  END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION vc.delete_missing_transfer_messages(p_owner bigint,p_chat uuid,p_revision bigint,p_ids uuid[]) RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE removed uuid[];
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 SELECT coalesce(array_agg(message_id),'{}'::uuid[]) INTO removed FROM vc.stored_message WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL AND NOT(message_id=ANY(p_ids));
 UPDATE vc.stored_message SET deleted_at=now(),data_cipher='',selected_candidate_id=NULL,revision=revision+1,changed_chat_revision=p_revision,source_changed_revision=p_revision
  WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=ANY(removed);
 UPDATE vc.stored_candidate SET deleted_at=now(),data_cipher='',settled=false,source_generation=source_generation+1 WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=ANY(removed) AND deleted_at IS NULL;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION vc.apply_chat_transfer_rows(bigint,uuid,bigint,jsonb),vc.delete_missing_transfer_messages(bigint,uuid,bigint,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.apply_chat_transfer_rows(bigint,uuid,bigint,jsonb),vc.delete_missing_transfer_messages(bigint,uuid,bigint,uuid[]) TO vc_api,vc_worker;

-- Operator-only state transitions. Runtime HTTP roles cannot activate authority.
CREATE FUNCTION vc.freeze_chat_migration(p_owner bigint,p_run uuid,p_direction text,p_mode text,p_epoch bigint) RETURNS SETOF vc.chat_migration_run
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE a record; previous vc.chat_migration_run;
BEGIN
 SELECT * INTO a FROM vc.lock_chat_authority(p_owner,true);
 SELECT * INTO previous FROM vc.chat_migration_run WHERE owner_user_id=p_owner AND run_id=p_run;
 IF FOUND THEN
  IF previous.direction=p_direction AND previous.frozen_epoch=p_epoch+1 AND a.authority='FROZEN' AND a.epoch=previous.frozen_epoch THEN RETURN NEXT previous; RETURN; END IF;
  RAISE EXCEPTION 'migration run conflict';
 END IF;
 IF p_direction NOT IN('ST_TO_GO','GO_TO_ST') OR p_mode NOT IN('ST','GO') OR a.authority<>p_mode OR a.epoch<>p_epoch OR (p_direction='ST_TO_GO' AND p_mode<>'ST') OR (p_direction='GO_TO_ST' AND p_mode<>'GO') THEN RAISE EXCEPTION 'migration authority conflict'; END IF;
 INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(p_owner,'FROZEN',p_epoch+1)
 ON CONFLICT(owner_user_id) DO UPDATE SET authority='FROZEN',epoch=excluded.epoch;
 RETURN QUERY INSERT INTO vc.chat_migration_run(owner_user_id,run_id,direction,frozen_epoch,status) VALUES(p_owner,p_run,p_direction,p_epoch+1,'FROZEN') RETURNING *;
END $$;
CREATE FUNCTION vc.require_chat_migration(p_owner bigint,p_run uuid,p_epoch bigint) RETURNS vc.chat_migration_run
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE a record; r vc.chat_migration_run;
BEGIN
 SELECT * INTO a FROM vc.lock_chat_authority(p_owner,true);
 SELECT * INTO STRICT r FROM vc.chat_migration_run WHERE owner_user_id=p_owner AND run_id=p_run;
 IF a.authority<>'FROZEN' OR a.epoch<>p_epoch OR r.frozen_epoch<>p_epoch OR r.status NOT IN('FROZEN','VERIFIED') THEN RAISE EXCEPTION 'migration authority conflict'; END IF;
 RETURN r;
END $$;
CREATE FUNCTION vc.stage_migration_chat(p_owner bigint,p_run uuid,p_epoch bigint,p_chat jsonb,p_header text,p_metadata text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE r vc.chat_migration_run; target_chat uuid:=(p_chat->>'oldIdentity')::uuid; name text;
BEGIN
 r:=vc.require_chat_migration(p_owner,p_run,p_epoch);
 IF r.direction<>'ST_TO_GO' OR r.status<>'FROZEN' THEN RAISE EXCEPTION 'migration direction conflict'; END IF;
 IF EXISTS(SELECT 1 FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=target_chat) OR EXISTS(SELECT 1 FROM vc.chat_file_alias WHERE owner_user_id=p_owner AND chat_id=target_chat) THEN RAISE EXCEPTION 'migration identity conflict'; END IF;
 IF p_chat->>'kind'='SINGLE' AND NOT EXISTS(SELECT 1 FROM vc.conversation WHERE owner_user_id=p_owner AND id=(p_chat->>'conversationId')::bigint AND relationship_id=(p_chat->>'relationshipId')::bigint AND st_chat_identity=target_chat::text) THEN RAISE EXCEPTION 'migration binding unavailable'; END IF;
 INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,conversation_id,relationship_id,character_ref,group_ref,branch_root,header_cipher,metadata_cipher,revision,metadata_revision,order_revision,next_position,message_count,deleted_at)
 VALUES(p_owner,target_chat,p_chat->>'kind',(p_chat->>'conversationId')::bigint,(p_chat->>'relationshipId')::bigint,p_chat->>'characterRef',p_chat->>'groupRef',(p_chat->>'branchRoot')::uuid,p_header,p_metadata,(p_chat->>'chatRevision')::bigint,(p_chat->>'metadataRevision')::bigint,(p_chat->>'orderRevision')::bigint,
 coalesce((SELECT max((x->>'position')::bigint) FROM jsonb_array_elements(p_chat->'messageAndCandidateIdentityRecords') x),0),(p_chat->>'messageCount')::bigint,CASE WHEN p_chat->>'state'='deleted' THEN now() END);
 DELETE FROM vc.chat_file_alias WHERE owner_user_id=p_owner AND chat_id=target_chat AND file_name<>p_chat->>'primaryFileName' AND NOT((p_chat->'aliases') ? file_name);
 UPDATE vc.chat_file_alias SET is_primary=false WHERE owner_user_id=p_owner AND chat_id=target_chat;
 FOR name IN SELECT jsonb_array_elements_text(p_chat->'aliases') UNION SELECT p_chat->>'primaryFileName' LOOP
  INSERT INTO vc.chat_file_alias VALUES(p_owner,p_chat->>'kind',coalesce(p_chat->>'characterRef',p_chat->>'groupRef'),name,target_chat,name=p_chat->>'primaryFileName')
   ON CONFLICT(owner_user_id,kind,scope_ref,file_name) DO UPDATE SET is_primary=excluded.is_primary WHERE vc.chat_file_alias.chat_id=excluded.chat_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'migration alias conflict'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION vc.stage_migration_message(p_owner bigint,p_run uuid,p_epoch bigint,p_chat uuid,p_identity jsonb,p_row jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m uuid:=(p_identity->>'messageId')::uuid; c jsonb; payload jsonb; dead boolean:=(p_identity->>'deleted')::boolean;
BEGIN
 PERFORM vc.require_chat_migration(p_owner,p_run,p_epoch);
 INSERT INTO vc.stored_message(owner_user_id,chat_id,message_id,position,revision,selected_candidate_id,data_cipher,initial_digest,deleted_at)
 VALUES(p_owner,p_chat,m,(p_identity->>'position')::bigint,(p_identity->>'messageRevision')::bigint,CASE WHEN NOT dead THEN (p_identity->>'selectedCandidateId')::uuid END,CASE WHEN dead THEN '' ELSE p_row->>'data' END,''::bytea,CASE WHEN dead THEN now() END);
 FOR c IN SELECT * FROM jsonb_array_elements(p_identity->'candidates') LOOP
  SELECT x INTO payload FROM jsonb_array_elements(p_row->'candidates') x WHERE x->>'id'=c->>'candidateId';
  INSERT INTO vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id,ordinal,source_revision,source_generation,settled,ever_selected,data_cipher,initial_digest,deleted_at)
  VALUES(p_owner,p_chat,m,(c->>'candidateId')::uuid,(c->>'ordinal')::integer,(c->>'sourceRevision')::bigint,(c->>'sourceGeneration')::bigint,(c->>'settled')::boolean,(c->>'everSelected')::boolean,CASE WHEN (c->>'deleted')::boolean THEN '' ELSE payload->>'data' END,''::bytea,CASE WHEN (c->>'deleted')::boolean THEN now() END);
 END LOOP;
END $$;
CREATE FUNCTION vc.checkpoint_migration_chat(p_owner bigint,p_run uuid,p_epoch bigint,p_chat uuid,p_hash text,p_record text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_chat_migration(p_owner,p_run,p_epoch);
 INSERT INTO vc.chat_migration_checkpoint VALUES(p_owner,p_run,p_chat,p_hash,'STAGED',p_record);
END $$;
CREATE FUNCTION vc.verify_chat_migration(p_owner bigint,p_run uuid,p_epoch bigint,p_manifest text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_chat_migration(p_owner,p_run,p_epoch);
 UPDATE vc.chat_migration_checkpoint SET state='VERIFIED' WHERE owner_user_id=p_owner AND run_id=p_run;
 UPDATE vc.chat_migration_run SET status='VERIFIED',manifest_cipher=p_manifest WHERE owner_user_id=p_owner AND run_id=p_run;
END $$;
CREATE FUNCTION vc.activate_chat_migration(p_owner bigint,p_run uuid,p_epoch bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE r vc.chat_migration_run;
BEGIN
 r:=vc.require_chat_migration(p_owner,p_run,p_epoch);
 IF r.status<>'VERIFIED' THEN RAISE EXCEPTION 'migration not verified'; END IF;
 UPDATE vc.chat_authority SET authority=CASE WHEN r.direction='ST_TO_GO' THEN 'GO' ELSE 'ST' END,epoch=epoch+1 WHERE owner_user_id=p_owner AND authority='FROZEN' AND epoch=p_epoch;
 IF NOT FOUND THEN RAISE EXCEPTION 'migration authority conflict'; END IF;
 UPDATE vc.chat_migration_run SET status='ACTIVATED' WHERE owner_user_id=p_owner AND run_id=p_run;
 RETURN p_epoch+1;
END $$;
REVOKE ALL ON FUNCTION vc.freeze_chat_migration(bigint,uuid,text,text,bigint),vc.require_chat_migration(bigint,uuid,bigint),vc.stage_migration_chat(bigint,uuid,bigint,jsonb,text,text),vc.stage_migration_message(bigint,uuid,bigint,uuid,jsonb,jsonb),vc.checkpoint_migration_chat(bigint,uuid,bigint,uuid,text,text),vc.verify_chat_migration(bigint,uuid,bigint,text),vc.activate_chat_migration(bigint,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.freeze_chat_migration(bigint,uuid,text,text,bigint),vc.require_chat_migration(bigint,uuid,bigint),vc.stage_migration_chat(bigint,uuid,bigint,jsonb,text,text),vc.stage_migration_message(bigint,uuid,bigint,uuid,jsonb,jsonb),vc.checkpoint_migration_chat(bigint,uuid,bigint,uuid,text,text),vc.verify_chat_migration(bigint,uuid,bigint,text),vc.activate_chat_migration(bigint,uuid,bigint) TO vc_worker;
CREATE FUNCTION vc.lock_chat_import_lease(p_owner bigint,p_id uuid,p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 PERFORM 1 FROM vc.chat_import WHERE owner_user_id=p_owner AND import_id=p_id AND status='PENDING' AND lease_token=p_token AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION vc.lock_chat_import_lease(bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.lock_chat_import_lease(bigint,uuid,uuid) TO vc_api,vc_worker;
CREATE FUNCTION vc.merge_migration_rights(p_owner bigint,p_run uuid,p_epoch bigint,p_records jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE r jsonb; c vc.stored_chat; tomb jsonb;
BEGIN
 PERFORM vc.require_chat_migration(p_owner,p_run,p_epoch);
 FOR r IN SELECT * FROM jsonb_array_elements(p_records) LOOP
  SELECT * INTO c FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=(r->>'chatId')::uuid;
  IF NOT FOUND THEN
   SELECT record_json INTO tomb FROM vc.chat_identity_tombstone WHERE owner_user_id=p_owner AND chat_id=(r->>'chatId')::uuid;
   IF NOT FOUND THEN RAISE EXCEPTION 'migration rights unavailable'; END IF;
   IF r->>'type'='chat' AND (r->>'deleted')::boolean THEN CONTINUE; END IF;
   IF r->>'type'='source' AND EXISTS(SELECT 1 FROM jsonb_array_elements(tomb->'sourceRecords') x WHERE x->>'messageId'=r->>'messageId' AND x->>'candidateId'=r->>'candidateId' AND (x->>'suppressed')::boolean) THEN CONTINUE; END IF;
   IF r->>'type'='message' AND EXISTS(SELECT 1 FROM jsonb_array_elements(tomb->'messageAndCandidateIdentityRecords') x WHERE x->>'messageId'=r->>'messageId' AND (x->>'deleted')::boolean) THEN CONTINUE; END IF;
   IF r->>'type'='candidate' AND EXISTS(SELECT 1 FROM jsonb_array_elements(tomb->'messageAndCandidateIdentityRecords') x CROSS JOIN LATERAL jsonb_array_elements(x->'candidates') y WHERE x->>'messageId'=r->>'messageId' AND y->>'candidateId'=r->>'candidateId' AND (y->>'deleted')::boolean) THEN CONTINUE; END IF;
   IF r->>'type'='inbox' AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(tomb->'rights','[]'::jsonb)) x WHERE x->>'type'='inbox' AND x->>'eventId'=r->>'eventId' AND x->>'messageId'=r->>'messageId' AND x->>'linkStatus'='removed') THEN CONTINUE; END IF;
   RAISE EXCEPTION 'migration tombstone rights unavailable';
  END IF;
  IF r->>'type'='source' THEN
   IF c.conversation_id IS NOT NULL THEN
    UPDATE vc.st_message_source SET suppressed=suppressed OR coalesce((r->>'suppressed')::boolean,false)
    WHERE owner_user_id=p_owner AND conversation_id=c.conversation_id AND message_id=(r->>'messageId')::uuid AND candidate_id=(r->>'candidateId')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'migration source unavailable'; END IF;
   END IF;
  ELSIF r->>'type'='chat' THEN
   IF (r->>'deleted')::boolean AND c.deleted_at IS NULL THEN RAISE EXCEPTION 'migration deleted chat conflict'; END IF;
  ELSIF r->>'type'='message' THEN
   IF NOT EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=p_owner AND chat_id=c.chat_id AND message_id=(r->>'messageId')::uuid AND (NOT (r->>'deleted')::boolean OR deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'migration message rights unavailable'; END IF;
  ELSIF r->>'type'='candidate' THEN
   IF NOT EXISTS(SELECT 1 FROM vc.stored_candidate WHERE owner_user_id=p_owner AND chat_id=c.chat_id AND message_id=(r->>'messageId')::uuid AND candidate_id=(r->>'candidateId')::uuid AND (NOT (r->>'deleted')::boolean OR deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'migration candidate rights unavailable'; END IF;
  ELSIF r->>'type'='inbox' THEN
   IF NOT EXISTS(SELECT 1 FROM vc.stored_chat_inbox WHERE owner_user_id=p_owner AND chat_id=c.chat_id AND event_id=r->>'eventId' AND message_id=(r->>'messageId')::uuid) THEN RAISE EXCEPTION 'migration inbox rights unavailable'; END IF;
   IF r->>'linkStatus' IN('removed','invalidated') THEN UPDATE vc.inbox_event SET link_status=CASE WHEN link_status='removed' THEN 'removed' ELSE r->>'linkStatus' END WHERE owner_user_id=p_owner AND event_id=r->>'eventId'; END IF;
  ELSE RAISE EXCEPTION 'migration rights record invalid'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION vc.merge_migration_rights(bigint,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.merge_migration_rights(bigint,uuid,bigint,jsonb) TO vc_worker;

-- Parent deletion physically cascades raw rows. Preserve only their identity
-- ledger (never header/message/candidate text) until owner deletion.
CREATE TABLE vc.chat_identity_tombstone (
 owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
 chat_id uuid NOT NULL,
 record_json jsonb NOT NULL CHECK(jsonb_typeof(record_json)='object' AND record_json->>'state'='deleted'),
 PRIMARY KEY(owner_user_id,chat_id)
);
ALTER TABLE vc.chat_identity_tombstone ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.chat_identity_tombstone FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.chat_identity_tombstone TO vc_api,vc_worker USING(owner_user_id=vc.current_owner_id()) WITH CHECK(owner_user_id=vc.current_owner_id());
REVOKE ALL ON vc.chat_identity_tombstone FROM PUBLIC;
GRANT SELECT ON vc.chat_identity_tombstone TO vc_api,vc_worker;
CREATE FUNCTION vc.capture_chat_identity_tombstone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE identities jsonb; sources jsonb; aliases jsonb; primary_name text; rec jsonb; inbox_rights jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.vc_user WHERE id=OLD.owner_user_id) THEN RETURN OLD; END IF;
 SELECT coalesce(jsonb_agg(a.file_name ORDER BY a.file_name),'[]'::jsonb),max(a.file_name) FILTER(WHERE a.is_primary) INTO aliases,primary_name FROM vc.chat_file_alias a WHERE a.owner_user_id=OLD.owner_user_id AND a.chat_id=OLD.chat_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('messageId',m.message_id,'messageRevision',m.revision::text,'position',m.position::text,'selectedCandidateId',m.selected_candidate_id,'deleted',true,'candidates',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('candidateId',c.candidate_id,'ordinal',c.ordinal,'sourceRevision',c.source_revision::text,'sourceGeneration',c.source_generation::text,'settled',c.settled,'everSelected',c.ever_selected,'deleted',true) ORDER BY c.ordinal),'[]'::jsonb)
   FROM vc.stored_candidate c WHERE c.owner_user_id=m.owner_user_id AND c.chat_id=m.chat_id AND c.message_id=m.message_id)) ORDER BY m.position),'[]'::jsonb)
 INTO identities FROM vc.stored_message m WHERE m.owner_user_id=OLD.owner_user_id AND m.chat_id=OLD.chat_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('chatId',OLD.chat_id,'messageId',c.message_id,'candidateId',c.candidate_id,'sourceRevision',c.source_revision::text,'sourceGeneration',c.source_generation::text,'settled',c.settled,'sourceTimestamp',s.source_timestamp,'sourceTimezone',s.source_timezone,'present',false,'eligible',false,'suppressed',true,'conversationId',OLD.conversation_id::text,'appliedRevision',OLD.revision::text,'branchRoot',OLD.branch_root) ORDER BY c.message_id,c.ordinal),'[]'::jsonb)
 INTO sources FROM vc.stored_candidate c LEFT JOIN vc.st_message_source s ON s.owner_user_id=c.owner_user_id AND s.conversation_id=OLD.conversation_id AND s.message_id=c.message_id AND s.candidate_id=c.candidate_id
 WHERE c.owner_user_id=OLD.owner_user_id AND c.chat_id=OLD.chat_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('type','inbox','eventId',event_id,'chatId',chat_id,'messageId',message_id,'linkStatus','removed') ORDER BY event_id),'[]'::jsonb) INTO inbox_rights FROM vc.stored_chat_inbox WHERE owner_user_id=OLD.owner_user_id AND chat_id=OLD.chat_id;
 rec:=jsonb_build_object('oldIdentity',OLD.chat_id,'kind',OLD.kind,'characterRef',OLD.character_ref,'groupRef',OLD.group_ref,'conversationId',OLD.conversation_id::text,'relationshipId',OLD.relationship_id::text,
 'primaryFileName',coalesce(primary_name,OLD.chat_id::text||'.jsonl'),'aliases',aliases,'branchRoot',OLD.branch_root,'chatRevision',OLD.revision::text,'metadataRevision',OLD.metadata_revision::text,'orderRevision',OLD.order_revision::text,
 'sourceFile','','sourceFileSha256','','sourceFileByteCount','0','messageCount','0','candidateCount','0','state','deleted','messageAndCandidateIdentityRecords',identities,'sourceRecords',sources,'rights',inbox_rights);
 INSERT INTO vc.chat_identity_tombstone VALUES(OLD.owner_user_id,OLD.chat_id,rec) ON CONFLICT(owner_user_id,chat_id) DO NOTHING;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION vc.capture_chat_identity_tombstone() FROM PUBLIC;
CREATE TRIGGER capture_chat_identity_tombstone BEFORE DELETE ON vc.stored_chat FOR EACH ROW EXECUTE FUNCTION vc.capture_chat_identity_tombstone();

CREATE FUNCTION vc.stage_migration_tombstone(p_owner bigint,p_run uuid,p_epoch bigint,p_chat jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE id uuid:=(p_chat->>'oldIdentity')::uuid; name text; r vc.chat_migration_run;
BEGIN
 r:=vc.require_chat_migration(p_owner,p_run,p_epoch);
 IF r.status<>'FROZEN' OR r.direction<>'ST_TO_GO' OR p_chat->>'state'<>'deleted' THEN RAISE EXCEPTION 'migration stage conflict'; END IF;
 IF EXISTS(SELECT 1 FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=id) OR EXISTS(SELECT 1 FROM vc.chat_identity_tombstone WHERE owner_user_id=p_owner AND chat_id=id) OR EXISTS(SELECT 1 FROM vc.chat_file_alias WHERE owner_user_id=p_owner AND chat_id=id) THEN RAISE EXCEPTION 'migration identity conflict'; END IF;
 INSERT INTO vc.chat_identity_tombstone VALUES(p_owner,id,p_chat);
 FOR name IN SELECT jsonb_array_elements_text(p_chat->'aliases') UNION SELECT p_chat->>'primaryFileName' LOOP
  INSERT INTO vc.chat_file_alias VALUES(p_owner,p_chat->>'kind',coalesce(p_chat->>'characterRef',p_chat->>'groupRef'),name,id,name=p_chat->>'primaryFileName');
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION vc.stage_migration_tombstone(bigint,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.stage_migration_tombstone(bigint,uuid,bigint,jsonb) TO vc_worker;

-- A FROZEN operator reconciliation may revoke rights, but must not enqueue an
-- old ST history snapshot. The targeted Go synchronizer only sees this source.
CREATE OR REPLACE FUNCTION vc.st_source_jobs_after_suppression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 IF NEW.suppressed AND NOT OLD.suppressed THEN
  IF EXISTS(SELECT 1 FROM vc.chat_authority WHERE owner_user_id=NEW.owner_user_id AND authority IN('GO','FROZEN')) THEN
   PERFORM vc.sync_stored_source_jobs(NEW.owner_user_id,NEW.conversation_id,ARRAY[NEW.id]);
  ELSE
   PERFORM vc.sync_st_source_jobs(NEW.owner_user_id,NEW.conversation_id);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE INDEX chat_import_retention ON vc.chat_import(expires_at) WHERE input_cipher IS NOT NULL OR prepared_cipher IS NOT NULL OR result_cipher IS NOT NULL;
CREATE OR REPLACE FUNCTION vc.list_chat_transfer_cleanup(p_limit integer) RETURNS SETOF vc.chat_transfer_object
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 UPDATE vc.chat_import SET status='EXPIRED',input_cipher=NULL,prepared_cipher=NULL,result_cipher=NULL,lease_token=NULL,lease_until=NULL
 WHERE (owner_user_id,import_id) IN(SELECT owner_user_id,import_id FROM vc.chat_import WHERE expires_at<=now() AND (input_cipher IS NOT NULL OR prepared_cipher IS NOT NULL OR result_cipher IS NOT NULL) ORDER BY expires_at LIMIT 256);
 RETURN QUERY SELECT * FROM vc.chat_transfer_object o WHERE released OR expires_at<=now() OR (o.owner_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vc.vc_user u WHERE u.id=o.owner_user_id)) ORDER BY expires_at,transfer_id LIMIT least(greatest(p_limit,1),256);
END $$;
CREATE FUNCTION vc.limit_chat_transfer_expiry(p_owner bigint,p_id uuid,p_import uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.chat_transfer_object o SET expires_at=i.expires_at FROM vc.chat_import i WHERE o.owner_user_id=p_owner AND o.transfer_id=p_id AND i.owner_user_id=p_owner AND i.import_id=p_import AND i.expires_at>clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION vc.limit_chat_transfer_expiry(bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.limit_chat_transfer_expiry(bigint,uuid,uuid) TO vc_api,vc_worker;
CREATE FUNCTION vc.release_unbound_chat_transfer(p_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 UPDATE vc.chat_transfer_object SET released=true WHERE transfer_id=p_id AND owner_user_id IS NULL
$$;
REVOKE ALL ON FUNCTION vc.release_unbound_chat_transfer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.release_unbound_chat_transfer(uuid) TO vc_worker;
-- Existing ST delivery receipts become Go associations; never deliver or enqueue
-- an event during migration. The persisted event, not the manifest, authorizes it.
CREATE FUNCTION vc.stage_migration_inbox(p_owner bigint,p_run uuid,p_epoch bigint,p_chat uuid,p_records jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE r jsonb; chat vc.stored_chat; event vc.inbox_event; run vc.chat_migration_run;
BEGIN
 run:=vc.require_chat_migration(p_owner,p_run,p_epoch);
 IF run.direction<>'ST_TO_GO' OR run.status<>'FROZEN' THEN RAISE EXCEPTION 'migration stage conflict'; END IF;
 SELECT * INTO STRICT chat FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat;
 FOR r IN SELECT * FROM jsonb_array_elements(p_records) LOOP
  SELECT * INTO event FROM vc.inbox_event WHERE owner_user_id=p_owner AND event_id=r->>'eventId';
  IF NOT FOUND OR r->>'type'<>'inbox' OR (r->>'chatId')::uuid<>p_chat OR chat.conversation_id IS NULL OR event.conversation_id<>chat.conversation_id OR NOT event.st_delivered OR event.st_message_id IS DISTINCT FROM r->>'messageId' OR r->>'linkStatus' NOT IN('present','removed','invalidated') THEN RAISE EXCEPTION 'migration inbox source unavailable'; END IF;
  INSERT INTO vc.stored_chat_inbox(owner_user_id,chat_id,event_id,message_id) VALUES(p_owner,p_chat,event.event_id,(r->>'messageId')::uuid) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM vc.stored_chat_inbox WHERE owner_user_id=p_owner AND chat_id=p_chat AND event_id=event.event_id AND message_id=(r->>'messageId')::uuid) THEN RAISE EXCEPTION 'migration inbox identity conflict'; END IF;
  UPDATE vc.inbox_event SET link_status=CASE WHEN link_status='removed' OR r->>'linkStatus'='removed' THEN 'removed' WHEN link_status='invalidated' OR r->>'linkStatus'='invalidated' THEN 'invalidated' ELSE 'present' END WHERE owner_user_id=p_owner AND event_id=event.event_id;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION vc.stage_migration_inbox(bigint,uuid,bigint,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.stage_migration_inbox(bigint,uuid,bigint,uuid,jsonb) TO vc_worker;
