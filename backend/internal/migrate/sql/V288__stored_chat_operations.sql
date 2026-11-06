-- SX-5: transactional commands and generation fences. Authority stays unchanged.
SET search_path=vc,pg_catalog;

-- Provenance counters let generation validate an older context baseline without
-- loading all message documents or retaining historical plaintext snapshots.
ALTER TABLE vc.stored_chat ADD COLUMN metadata_changed_revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN order_changed_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE vc.stored_message ADD COLUMN created_chat_revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN changed_chat_revision bigint NOT NULL DEFAULT 1,
 ADD COLUMN source_changed_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE vc.stored_candidate ADD COLUMN ever_selected boolean NOT NULL DEFAULT false;
UPDATE vc.stored_candidate c SET ever_selected=true FROM vc.stored_message m
 WHERE (c.owner_user_id,c.chat_id,c.message_id,c.candidate_id)=
       (m.owner_user_id,m.chat_id,m.message_id,m.selected_candidate_id);
CREATE INDEX stored_message_source_changes ON vc.stored_message(owner_user_id,chat_id,source_changed_revision);

CREATE TABLE vc.chat_generation_run (
 owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
 chat_id uuid NOT NULL,
 run_id uuid NOT NULL,
 request_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('active','settled','aborted','fenced','expired')),
 fence jsonb,
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 PRIMARY KEY(owner_user_id,run_id),
 FOREIGN KEY(owner_user_id,chat_id) REFERENCES vc.stored_chat ON DELETE CASCADE
);
CREATE UNIQUE INDEX chat_generation_one_active ON vc.chat_generation_run(owner_user_id,chat_id) WHERE state='active';
CREATE INDEX chat_generation_cleanup ON vc.chat_generation_run(owner_user_id,expires_at) WHERE state='active' OR fence IS NOT NULL;
ALTER TABLE vc.chat_generation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.chat_generation_run FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.chat_generation_run TO vc_api,vc_worker
 USING(owner_user_id=vc.current_owner_id()) WITH CHECK(owner_user_id=vc.current_owner_id());
REVOKE ALL ON vc.chat_generation_run FROM PUBLIC;
GRANT SELECT ON vc.chat_generation_run TO vc_api,vc_worker;

-- Inbox receipts survive message tombstones, so redelivery cannot resurrect a
-- removed message. The event's existing lease/ack service remains authoritative.
CREATE TABLE vc.stored_chat_inbox (
 owner_user_id bigint NOT NULL,
 chat_id uuid NOT NULL,
 event_id text NOT NULL,
 message_id uuid NOT NULL,
 PRIMARY KEY(owner_user_id,chat_id,event_id),
 FOREIGN KEY(owner_user_id,chat_id) REFERENCES vc.stored_chat ON DELETE CASCADE,
 FOREIGN KEY(owner_user_id,chat_id,message_id) REFERENCES vc.stored_message
);
ALTER TABLE vc.stored_chat_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.stored_chat_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.stored_chat_inbox TO vc_api,vc_worker
 USING(owner_user_id=vc.current_owner_id()) WITH CHECK(owner_user_id=vc.current_owner_id());
REVOKE ALL ON vc.stored_chat_inbox FROM PUBLIC;
GRANT SELECT ON vc.stored_chat_inbox TO vc_api,vc_worker;

CREATE FUNCTION vc.update_stored_chat(p_owner bigint,p_chat uuid,p_title text,p_header text,p_metadata text,
 p_revision bigint,p_metadata_revision bigint,p_order_revision bigint,p_next bigint,p_count bigint,
 p_metadata_changed boolean,p_order_changed boolean,p_deleted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.stored_chat SET title=CASE WHEN p_deleted THEN '' ELSE p_title END,
  header_cipher=CASE WHEN p_deleted THEN '' ELSE p_header END,
  metadata_cipher=CASE WHEN p_deleted THEN '' ELSE p_metadata END,
  revision=p_revision,metadata_revision=p_metadata_revision,order_revision=p_order_revision,
  next_position=p_next,message_count=p_count,updated_at=clock_timestamp(),
  metadata_changed_revision=CASE WHEN p_metadata_changed THEN p_revision ELSE metadata_changed_revision END,
  order_changed_revision=CASE WHEN p_order_changed THEN p_revision ELSE order_changed_revision END,
  deleted_at=CASE WHEN p_deleted THEN clock_timestamp() ELSE NULL END
 WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'stored chat missing'; END IF;
END $$;

CREATE FUNCTION vc.update_stored_message(p_owner bigint,p_chat uuid,p_message uuid,p_position bigint,p_revision bigint,
 p_selected uuid,p_data text,p_chat_revision bigint,p_created boolean,p_content_changed boolean,p_source_changed boolean,p_deleted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.stored_message SET position=p_position,revision=p_revision,
  selected_candidate_id=CASE WHEN p_deleted THEN NULL ELSE p_selected END,
  data_cipher=CASE WHEN p_deleted THEN '' ELSE p_data END,
  created_chat_revision=CASE WHEN p_created THEN p_chat_revision ELSE created_chat_revision END,
  changed_chat_revision=CASE WHEN p_content_changed OR p_deleted THEN p_chat_revision ELSE changed_chat_revision END,
  source_changed_revision=CASE WHEN p_source_changed OR p_deleted THEN p_chat_revision ELSE source_changed_revision END,
  deleted_at=CASE WHEN p_deleted THEN clock_timestamp() ELSE NULL END
 WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=p_message AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'stored message missing'; END IF;
 IF p_deleted THEN
  UPDATE vc.stored_candidate SET data_cipher='',settled=false,deleted_at=clock_timestamp()
   WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=p_message AND deleted_at IS NULL;
 END IF;
END $$;

CREATE FUNCTION vc.update_stored_candidate(p_owner bigint,p_chat uuid,p_message uuid,p_candidate uuid,p_ordinal integer,
 p_revision bigint,p_generation bigint,p_settled boolean,p_ever_selected boolean,p_data text,p_deleted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.stored_candidate SET ordinal=p_ordinal,source_revision=p_revision,source_generation=p_generation,
  settled=CASE WHEN p_deleted THEN false ELSE p_settled END,ever_selected=p_ever_selected,
  data_cipher=CASE WHEN p_deleted THEN '' ELSE p_data END,
  deleted_at=CASE WHEN p_deleted THEN clock_timestamp() ELSE NULL END
 WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=p_message AND candidate_id=p_candidate AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'stored candidate missing'; END IF;
END $$;

CREATE FUNCTION vc.clear_stored_chat_receipt_bodies(p_owner bigint,p_chat uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.chat_receipt SET result_cipher=NULL WHERE owner_user_id=p_owner AND chat_id=p_chat AND result_cipher IS NOT NULL;
END $$;

CREATE FUNCTION vc.reorder_stored_message(p_owner bigint,p_chat uuid,p_message uuid,p_position bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.stored_message SET position=p_position WHERE owner_user_id=p_owner AND chat_id=p_chat AND message_id=p_message AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'stored message missing'; END IF;
END $$;

CREATE FUNCTION vc.delete_stored_chat_messages(p_owner bigint,p_chat uuid,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.stored_candidate c SET data_cipher='',settled=false,deleted_at=clock_timestamp(),
  source_generation=source_generation+CASE WHEN c.candidate_id=m.selected_candidate_id THEN 1 ELSE 0 END
 FROM vc.stored_message m WHERE (m.owner_user_id,m.chat_id,m.message_id)=(c.owner_user_id,c.chat_id,c.message_id)
  AND c.owner_user_id=p_owner AND c.chat_id=p_chat AND c.deleted_at IS NULL;
 UPDATE vc.stored_message SET data_cipher='',selected_candidate_id=NULL,deleted_at=clock_timestamp(),revision=revision+1,
  changed_chat_revision=p_revision,source_changed_revision=p_revision
 WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL;
END $$;

-- FieldCipher does not bind ciphertext to row IDs. Copy it without decrypting
-- history; full projections always overlay the fresh canonical row identities.
CREATE FUNCTION vc.copy_stored_chat_prefix(p_owner bigint,p_parent uuid,p_child uuid,p_through bigint,p_mapping jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE copied bigint;
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 INSERT INTO vc.stored_message(owner_user_id,chat_id,message_id,position,revision,selected_candidate_id,data_cipher,initial_digest)
 SELECT p_owner,p_child,(x->>'messageId')::uuid,m.position,1,(selected->>'candidateId')::uuid,m.data_cipher,m.initial_digest
 FROM jsonb_array_elements(p_mapping) x JOIN vc.stored_message m
  ON m.owner_user_id=p_owner AND m.chat_id=p_parent AND m.message_id=(x->>'parentMessageId')::uuid
 CROSS JOIN LATERAL jsonb_array_elements(x->'candidates') selected
 WHERE m.deleted_at IS NULL AND m.position<=p_through AND (selected->>'parentCandidateId')::uuid=m.selected_candidate_id;
 GET DIAGNOSTICS copied = ROW_COUNT;
 INSERT INTO vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id,ordinal,source_revision,source_generation,settled,data_cipher,initial_digest,ever_selected)
 SELECT p_owner,p_child,(x->>'messageId')::uuid,(y->>'candidateId')::uuid,c.ordinal,1,1,c.settled,c.data_cipher,c.initial_digest,
  c.candidate_id=m.selected_candidate_id
 FROM jsonb_array_elements(p_mapping) x CROSS JOIN LATERAL jsonb_array_elements(x->'candidates') y
 JOIN vc.stored_candidate c ON c.owner_user_id=p_owner AND c.chat_id=p_parent
  AND c.message_id=(x->>'parentMessageId')::uuid AND c.candidate_id=(y->>'parentCandidateId')::uuid
 JOIN vc.stored_message m ON (m.owner_user_id,m.chat_id,m.message_id)=(c.owner_user_id,c.chat_id,c.message_id)
 WHERE c.deleted_at IS NULL AND m.deleted_at IS NULL AND m.position<=p_through;
 UPDATE vc.stored_chat SET message_count=copied,next_position=p_through WHERE owner_user_id=p_owner AND chat_id=p_child AND deleted_at IS NULL;
 UPDATE vc.conversation target SET incognito=origin.incognito,st_branch_root=child.branch_root::text
 FROM vc.stored_chat child JOIN vc.stored_chat parent ON parent.owner_user_id=child.owner_user_id AND parent.chat_id=p_parent
 JOIN vc.conversation origin ON origin.owner_user_id=parent.owner_user_id AND origin.id=parent.conversation_id
 WHERE child.owner_user_id=p_owner AND child.chat_id=p_child AND target.owner_user_id=p_owner AND target.id=child.conversation_id;
END $$;

-- Withdrawal is synchronous with edits/deletion. It reuses the existing source
-- triggers and dependency barriers; SX-7 will also publish the new Go projection.
CREATE FUNCTION vc.revoke_stored_chat_sources(p_owner bigint,p_chat uuid,p_changed uuid[],p_deleted boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE conv bigint; changed boolean;
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 SELECT conversation_id INTO conv FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat;
 IF conv IS NULL THEN RETURN; END IF;
 UPDATE vc.st_message_source s SET present=false,settled=false,content_cipher='',source_generation=source_generation+1,
  source_ref=format('st:%s:%s:%s:%s:%s',p_chat,message_id,candidate_id,source_revision,source_generation+1)
 WHERE s.owner_user_id=p_owner AND s.conversation_id=conv AND s.present
  AND (p_deleted OR s.message_id=ANY(p_changed))
  AND (p_deleted OR NOT EXISTS(
   SELECT 1 FROM vc.stored_message m JOIN vc.stored_candidate c
    ON (c.owner_user_id,c.chat_id,c.message_id,c.candidate_id)=(m.owner_user_id,m.chat_id,m.message_id,m.selected_candidate_id)
   WHERE m.owner_user_id=p_owner AND m.chat_id=p_chat AND m.message_id=s.message_id AND m.deleted_at IS NULL AND c.deleted_at IS NULL
    AND c.candidate_id=s.candidate_id AND c.source_revision=s.source_revision AND c.source_generation=s.source_generation));
 changed := FOUND;
 IF changed THEN
  UPDATE vc.memory_item mi SET source_invalidated_at=now()
   WHERE mi.owner_user_id=p_owner AND mi.source_invalidated_at IS NULL
    AND EXISTS(SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=mi.id
     AND e.source_ref LIKE 'st:'||p_chat||':%' AND NOT EXISTS(
      SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.source_ref=e.source_ref AND s.present));
  UPDATE vc.conversation_summary cs SET valid=false WHERE cs.owner_user_id=p_owner AND cs.valid
   AND (cs.st_source_refs IS NULL OR EXISTS(SELECT 1 FROM unnest(cs.st_source_refs) dep(source_ref)
    WHERE NOT EXISTS(SELECT 1 FROM vc.st_message_source src WHERE src.owner_user_id=p_owner
     AND src.source_ref=dep.source_ref AND src.present AND src.eligible AND NOT src.suppressed)));
 END IF;
 IF changed OR p_deleted THEN
  UPDATE vc.conversation SET st_source_state=CASE WHEN p_deleted THEN 'DELETED' ELSE st_source_state END
   WHERE owner_user_id=p_owner AND id=conv;
 END IF;
END $$;

CREATE FUNCTION vc.stored_chat_fence_valid(p_owner bigint,p_chat uuid,p_fence jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE c vc.stored_chat; baseline bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_fence IS NULL THEN RETURN false; END IF;
 baseline := (p_fence->>'chatRevision')::bigint;
 SELECT * INTO c FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL;
 IF NOT FOUND OR baseline<1 OR baseline>c.revision OR c.metadata_changed_revision>baseline OR c.order_changed_revision>baseline
  OR c.branch_root::text IS DISTINCT FROM p_fence->>'branchRoot' THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.chat_authority WHERE owner_user_id=p_owner AND authority='GO'
  AND epoch=(p_fence->>'authorityEpoch')::bigint) THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.stored_message m WHERE m.owner_user_id=p_owner AND m.chat_id=p_chat
  AND m.message_id=(p_fence->>'inputMessageId')::uuid AND m.selected_candidate_id=(p_fence->>'inputCandidateId')::uuid
  AND m.deleted_at IS NULL AND m.created_chat_revision<=baseline AND m.changed_chat_revision<=baseline) THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM vc.stored_message m WHERE m.owner_user_id=p_owner AND m.chat_id=p_chat
  AND m.created_chat_revision<=baseline AND m.source_changed_revision>baseline);
END $$;

CREATE FUNCTION vc.expire_stored_chat_runs(p_owner bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 UPDATE vc.chat_generation_run SET state='expired' WHERE owner_user_id=p_owner AND state='active' AND expires_at<=clock_timestamp();
 UPDATE vc.chat_generation_run SET fence=NULL WHERE owner_user_id=p_owner AND fence IS NOT NULL AND registered_at<clock_timestamp()-interval '7 days';
END $$;

CREATE FUNCTION vc.insert_stored_chat_run(p_owner bigint,p_chat uuid,p_run uuid,p_request uuid,p_fence jsonb)
RETURNS TABLE(registered_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE registered timestamptz := clock_timestamp();
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 PERFORM vc.expire_stored_chat_runs(p_owner);
 IF NOT vc.stored_chat_fence_valid(p_owner,p_chat,p_fence) THEN RAISE EXCEPTION 'stored chat generation fence changed'; END IF;
 UPDATE vc.chat_generation_run SET state='fenced' WHERE owner_user_id=p_owner AND chat_id=p_chat AND state='active';
 INSERT INTO vc.chat_generation_run(owner_user_id,chat_id,run_id,request_id,state,fence,registered_at,expires_at)
  VALUES(p_owner,p_chat,p_run,p_request,'active',p_fence,registered,registered+interval '15 minutes');
 RETURN QUERY SELECT registered,registered+interval '15 minutes';
END $$;

CREATE FUNCTION vc.finish_stored_chat_run(p_owner bigint,p_chat uuid,p_run uuid,p_state text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 IF p_state NOT IN ('settled','aborted') THEN RAISE EXCEPTION 'invalid generation terminal state'; END IF;
 UPDATE vc.chat_generation_run SET state=p_state WHERE owner_user_id=p_owner AND chat_id=p_chat AND run_id=p_run
  AND state='active' AND expires_at>clock_timestamp();
 RETURN FOUND;
END $$;

CREATE FUNCTION vc.fence_changed_stored_chat_runs(p_owner bigint,p_chat uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 PERFORM vc.expire_stored_chat_runs(p_owner);
 UPDATE vc.chat_generation_run r SET state='fenced' WHERE r.owner_user_id=p_owner AND r.chat_id=p_chat AND r.state='active'
  AND NOT vc.stored_chat_fence_valid(p_owner,p_chat,r.fence);
END $$;

CREATE FUNCTION vc.insert_stored_chat_inbox(p_owner bigint,p_chat uuid,p_event text,p_message uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 INSERT INTO vc.stored_chat_inbox(owner_user_id,chat_id,event_id,message_id) VALUES(p_owner,p_chat,p_event,p_message);
END $$;

CREATE FUNCTION vc.lock_stored_chat_inbox_event(p_owner bigint,p_chat uuid,p_event text)
RETURNS SETOF vc.inbox_event LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 RETURN QUERY SELECT i.* FROM vc.inbox_event i JOIN vc.stored_chat c
  ON(c.owner_user_id,c.conversation_id)=(i.owner_user_id,i.conversation_id)
 WHERE i.owner_user_id=p_owner AND c.chat_id=p_chat AND c.deleted_at IS NULL AND i.event_id=p_event
 FOR UPDATE OF i;
END $$;

-- The existing scheduler calls this bounded maintenance pass. It does not
-- acquire chat locks ahead of account locks, nor return any private documents.
CREATE FUNCTION vc.prune_stored_chat_runs() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE owner_id bigint;
BEGIN
 FOR owner_id IN SELECT u.id FROM vc.vc_user u WHERE EXISTS(
   SELECT 1 FROM vc.chat_generation_run r WHERE r.owner_user_id=u.id
    AND ((r.state='active' AND r.expires_at<=clock_timestamp()) OR (r.fence IS NOT NULL AND r.registered_at<clock_timestamp()-interval '7 days')))
   OR EXISTS(SELECT 1 FROM vc.chat_receipt r WHERE r.owner_user_id=u.id AND r.result_cipher IS NOT NULL AND r.expires_at<=clock_timestamp())
   ORDER BY u.id LIMIT 32 FOR NO KEY UPDATE OF u SKIP LOCKED
 LOOP
  UPDATE vc.chat_generation_run SET state='expired' WHERE owner_user_id=owner_id AND state='active' AND expires_at<=clock_timestamp();
  UPDATE vc.chat_generation_run SET fence=NULL WHERE owner_user_id=owner_id AND fence IS NOT NULL AND registered_at<clock_timestamp()-interval '7 days';
  UPDATE vc.chat_receipt SET result_cipher=NULL WHERE owner_user_id=owner_id AND result_cipher IS NOT NULL AND expires_at<=clock_timestamp();
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION vc.update_stored_chat(bigint,uuid,text,text,text,bigint,bigint,bigint,bigint,bigint,boolean,boolean,boolean),
 vc.update_stored_message(bigint,uuid,uuid,bigint,bigint,uuid,text,bigint,boolean,boolean,boolean,boolean),
 vc.update_stored_candidate(bigint,uuid,uuid,uuid,integer,bigint,bigint,boolean,boolean,text,boolean),
 vc.clear_stored_chat_receipt_bodies(bigint,uuid),vc.revoke_stored_chat_sources(bigint,uuid,uuid[],boolean),
 vc.reorder_stored_message(bigint,uuid,uuid,bigint),
 vc.delete_stored_chat_messages(bigint,uuid,bigint),vc.copy_stored_chat_prefix(bigint,uuid,uuid,bigint,jsonb),
 vc.stored_chat_fence_valid(bigint,uuid,jsonb),vc.expire_stored_chat_runs(bigint),
 vc.insert_stored_chat_run(bigint,uuid,uuid,uuid,jsonb),vc.finish_stored_chat_run(bigint,uuid,uuid,text),
 vc.fence_changed_stored_chat_runs(bigint,uuid),vc.insert_stored_chat_inbox(bigint,uuid,text,uuid),vc.prune_stored_chat_runs() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.lock_stored_chat_inbox_event(bigint,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.update_stored_chat(bigint,uuid,text,text,text,bigint,bigint,bigint,bigint,bigint,boolean,boolean,boolean),
 vc.update_stored_message(bigint,uuid,uuid,bigint,bigint,uuid,text,bigint,boolean,boolean,boolean,boolean),
 vc.update_stored_candidate(bigint,uuid,uuid,uuid,integer,bigint,bigint,boolean,boolean,text,boolean),
 vc.clear_stored_chat_receipt_bodies(bigint,uuid),vc.revoke_stored_chat_sources(bigint,uuid,uuid[],boolean),
 vc.reorder_stored_message(bigint,uuid,uuid,bigint),
 vc.delete_stored_chat_messages(bigint,uuid,bigint),vc.copy_stored_chat_prefix(bigint,uuid,uuid,bigint,jsonb),
 vc.stored_chat_fence_valid(bigint,uuid,jsonb),vc.expire_stored_chat_runs(bigint),
 vc.insert_stored_chat_run(bigint,uuid,uuid,uuid,jsonb),vc.finish_stored_chat_run(bigint,uuid,uuid,text),
 vc.fence_changed_stored_chat_runs(bigint,uuid),vc.insert_stored_chat_inbox(bigint,uuid,text,uuid) TO vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.prune_stored_chat_runs() TO vc_worker;
GRANT EXECUTE ON FUNCTION vc.lock_stored_chat_inbox_event(bigint,uuid,text) TO vc_api,vc_worker;

-- Binding allocation only serializes owner work; it does not change owner keys.
-- Avoid upgrading the owner lock after taking the chat memory barrier, which
-- could otherwise deadlock a concurrent foreign-key KEY SHARE holder.
CREATE OR REPLACE FUNCTION vc.resolve_st_binding(
    p_owner_user_id bigint,
    p_chat_identity text,
    p_character_ref text,
    p_mode text,
    p_relationship_id bigint,
    p_display_name text
)
    RETURNS TABLE(out_relationship_id bigint, out_conversation_id bigint,
                  out_chat_identity text, out_character_ref text, out_mode text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_relationship_id bigint;
    v_conversation_id bigint;
    v_character_ref text;
    v_mode text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'resolve_st_binding: owner must match server-trusted context';
    END IF;
    IF p_chat_identity IS NULL OR btrim(p_chat_identity) = ''
       OR p_character_ref IS NULL OR btrim(p_character_ref) = ''
       OR p_mode IS NULL OR p_mode NOT IN ('COMPANION', 'STORY')
       OR (p_relationship_id IS NOT NULL AND p_relationship_id <= 0) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'resolve_st_binding: invalid input';
    END IF;

    -- Serialize first resolution using the existing Owner row. A concurrent
    -- retry sees the committed binding before allocating another instance.
    PERFORM 1 FROM vc.vc_user WHERE id = p_owner_user_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'resolve_st_binding: owner not found';
    END IF;

    SELECT c.relationship_id, c.id, r.st_character_ref, c.st_mode
      INTO v_relationship_id, v_conversation_id, v_character_ref, v_mode
      FROM vc.conversation c
      JOIN vc.relationship r ON (r.owner_user_id, r.id) = (c.owner_user_id, c.relationship_id)
     WHERE c.owner_user_id = p_owner_user_id AND c.st_chat_identity = p_chat_identity
     FOR UPDATE OF c, r;
    IF FOUND THEN
        IF v_character_ref IS DISTINCT FROM p_character_ref
           OR v_mode IS DISTINCT FROM p_mode
           OR (p_relationship_id IS NOT NULL AND p_relationship_id <> v_relationship_id) THEN
            RAISE EXCEPTION 'resolve_st_binding: conflict';
        END IF;
    ELSE
        IF p_relationship_id IS NULL THEN
            v_relationship_id := vc.create_relationship(p_owner_user_id, 'st-character');
            UPDATE vc.relationship
               SET st_character_ref = p_character_ref,
                   companion_name = NULLIF(btrim(p_display_name), '')
             WHERE owner_user_id = p_owner_user_id AND id = v_relationship_id;
        ELSE
            SELECT r.st_character_ref INTO v_character_ref
              FROM vc.relationship r
             WHERE r.owner_user_id = p_owner_user_id AND r.id = p_relationship_id
             FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'resolve_st_binding: relationship not found';
            END IF;
            IF v_character_ref IS DISTINCT FROM p_character_ref THEN
                RAISE EXCEPTION 'resolve_st_binding: conflict';
            END IF;
            v_relationship_id := p_relationship_id;
        END IF;
        v_conversation_id := vc.create_conversation(p_owner_user_id, v_relationship_id, vc.get_incognito_pref(p_owner_user_id));
        UPDATE vc.conversation SET st_chat_identity = p_chat_identity, st_mode = p_mode
         WHERE owner_user_id = p_owner_user_id AND id = v_conversation_id;
    END IF;

    RETURN QUERY SELECT v_relationship_id, v_conversation_id, p_chat_identity, p_character_ref, p_mode;
END;
$$;
