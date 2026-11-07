-- SX-3: raw chat storage. Installing this migration does NOT switch authority.
SET search_path TO vc, pg_catalog;

CREATE TABLE vc.chat_authority (
    owner_user_id bigint PRIMARY KEY REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    authority text NOT NULL DEFAULT 'ST' CHECK (authority IN ('ST','GO','FROZEN')),
    epoch bigint NOT NULL DEFAULT 1 CHECK (epoch > 0)
);

CREATE TABLE vc.stored_chat (
    owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    chat_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('SINGLE','GROUP')),
    conversation_id bigint,
    relationship_id bigint,
    character_ref text,
    group_ref text,
    branch_root uuid NOT NULL,
    title text NOT NULL DEFAULT '',
    header_cipher text NOT NULL CHECK (header_cipher LIKE 'enc2:%' OR (deleted_at IS NOT NULL AND header_cipher='')),
    metadata_cipher text NOT NULL CHECK (metadata_cipher LIKE 'enc2:%' OR (deleted_at IS NOT NULL AND metadata_cipher='')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    metadata_revision bigint NOT NULL DEFAULT 1 CHECK (metadata_revision > 0),
    order_revision bigint NOT NULL DEFAULT 1 CHECK (order_revision > 0),
    next_position bigint NOT NULL DEFAULT 0 CHECK (next_position >= 0),
    message_count bigint NOT NULL DEFAULT 0 CHECK (message_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    deleted_at timestamptz,
    PRIMARY KEY (owner_user_id,chat_id),
    FOREIGN KEY (owner_user_id,conversation_id) REFERENCES vc.conversation(owner_user_id,id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id,relationship_id) REFERENCES vc.relationship(owner_user_id,id) ON DELETE CASCADE,
    CHECK ((kind='SINGLE' AND character_ref IS NOT NULL AND group_ref IS NULL AND conversation_id IS NOT NULL AND relationship_id IS NOT NULL)
        OR (kind='GROUP' AND group_ref IS NOT NULL AND character_ref IS NULL AND conversation_id IS NULL AND relationship_id IS NULL))
);
CREATE INDEX stored_chat_index ON vc.stored_chat(owner_user_id,updated_at DESC,chat_id DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX stored_chat_binding ON vc.stored_chat(owner_user_id,conversation_id) WHERE conversation_id IS NOT NULL;

CREATE TABLE vc.stored_message (
    owner_user_id bigint NOT NULL,
    chat_id uuid NOT NULL,
    message_id uuid NOT NULL,
    position bigint NOT NULL CHECK (position > 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    selected_candidate_id uuid,
    data_cipher text NOT NULL CHECK (data_cipher LIKE 'enc2:%' OR (deleted_at IS NOT NULL AND data_cipher='')),
    initial_digest bytea NOT NULL,
    deleted_at timestamptz,
    PRIMARY KEY (owner_user_id,chat_id,message_id),
    FOREIGN KEY (owner_user_id,chat_id) REFERENCES vc.stored_chat ON DELETE CASCADE,
    UNIQUE (owner_user_id,chat_id,position) DEFERRABLE INITIALLY DEFERRED,
    CHECK (deleted_at IS NOT NULL OR selected_candidate_id IS NOT NULL)
);
CREATE INDEX stored_message_page ON vc.stored_message(owner_user_id,chat_id,position) WHERE deleted_at IS NULL;

CREATE TABLE vc.stored_candidate (
    owner_user_id bigint NOT NULL,
    chat_id uuid NOT NULL,
    message_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    source_revision bigint NOT NULL DEFAULT 1 CHECK (source_revision > 0),
    source_generation bigint NOT NULL DEFAULT 1 CHECK (source_generation > 0),
    settled boolean NOT NULL DEFAULT false,
    data_cipher text NOT NULL CHECK (data_cipher LIKE 'enc2:%' OR (deleted_at IS NOT NULL AND data_cipher='')),
    initial_digest bytea NOT NULL,
    deleted_at timestamptz,
    PRIMARY KEY (owner_user_id,chat_id,message_id,candidate_id),
    FOREIGN KEY (owner_user_id,chat_id,message_id) REFERENCES vc.stored_message ON DELETE CASCADE
);
ALTER TABLE vc.stored_message ADD CONSTRAINT stored_message_selection
    FOREIGN KEY (owner_user_id,chat_id,message_id,selected_candidate_id)
    REFERENCES vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id)
    DEFERRABLE INITIALLY DEFERRED;

-- The compact id/digest outlives the seven-day response. No automatic replay
-- may execute an expired operation or resurrect an identity after deletion.
CREATE TABLE vc.chat_receipt (
    owner_user_id bigint NOT NULL REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    resource text NOT NULL,
    request_id uuid NOT NULL,
    request_digest bytea NOT NULL,
    operation_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    result_revision bigint NOT NULL,
    status integer NOT NULL,
    result_cipher text CHECK (result_cipher IS NULL OR result_cipher LIKE 'enc2:%'),
    expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
    PRIMARY KEY (owner_user_id,resource,request_id)
);
CREATE INDEX chat_receipt_chat ON vc.chat_receipt(owner_user_id,chat_id) WHERE result_cipher IS NOT NULL;
CREATE INDEX chat_receipt_expiry ON vc.chat_receipt(owner_user_id,expires_at) WHERE result_cipher IS NOT NULL;

-- One body-free event per transaction doubles as the durable source outbox.
CREATE TABLE vc.chat_change (
    owner_user_id bigint NOT NULL,
    chat_id uuid NOT NULL,
    revision bigint NOT NULL,
    event jsonb NOT NULL CHECK (jsonb_typeof(event)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    dispatched_at timestamptz,
    PRIMARY KEY (owner_user_id,chat_id,revision),
    FOREIGN KEY (owner_user_id,chat_id) REFERENCES vc.stored_chat ON DELETE CASCADE
);
CREATE INDEX chat_change_retention ON vc.chat_change(owner_user_id,created_at) WHERE dispatched_at IS NOT NULL;

DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['chat_authority','stored_chat','stored_message','stored_candidate','chat_receipt','chat_change'] LOOP
        EXECUTE format('ALTER TABLE vc.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('ALTER TABLE vc.%I FORCE ROW LEVEL SECURITY',t);
        EXECUTE format('CREATE POLICY owner_isolation ON vc.%I FOR ALL TO vc_api,vc_worker USING (owner_user_id=vc.current_owner_id()) WITH CHECK (owner_user_id=vc.current_owner_id())',t);
        EXECUTE format('REVOKE ALL ON vc.%I FROM PUBLIC',t);
        EXECUTE format('GRANT SELECT ON vc.%I TO vc_api,vc_worker',t);
        -- Runtime writes go through owner-checked SECURITY DEFINER functions.
    END LOOP;
END $$;

-- Pin account/authority before chat rows. A missing authority row means ST/1;
-- no runtime API can manufacture GO authority. Deletion uses the existing
-- export and memory barriers in the same order as the other write domains.
CREATE FUNCTION vc.lock_chat_authority(p_owner bigint,p_write boolean)
RETURNS TABLE(authority text,epoch bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_write THEN PERFORM 1 FROM vc.vc_user WHERE id=p_owner FOR NO KEY UPDATE; END IF;
    PERFORM vc.export_pointer_barrier(p_owner);
    IF p_write THEN PERFORM vc.memory_write_barrier(p_owner); END IF;
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    PERFORM 1 FROM vc.identity_account WHERE id=p_owner AND status='ACTIVE' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner is not an active account'; END IF;
    RETURN QUERY SELECT a.authority,a.epoch FROM vc.chat_authority a WHERE a.owner_user_id=p_owner FOR SHARE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'ST'::text,1::bigint; END IF;
END $$;
REVOKE ALL ON FUNCTION vc.lock_chat_authority(bigint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.lock_chat_authority(bigint,boolean) TO vc_api,vc_worker;

CREATE FUNCTION vc.erase_stored_chat_receipts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    UPDATE vc.chat_receipt SET result_cipher=NULL
     WHERE owner_user_id=OLD.owner_user_id AND chat_id=OLD.chat_id AND result_cipher IS NOT NULL;
    RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION vc.erase_stored_chat_receipts() FROM PUBLIC;
CREATE TRIGGER erase_stored_chat_receipts BEFORE DELETE ON vc.stored_chat
    FOR EACH ROW EXECUTE FUNCTION vc.erase_stored_chat_receipts();

-- Existing rights entrypoints also cover the new authoritative chat rows.
CREATE OR REPLACE FUNCTION vc.end_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS TABLE(out_ok boolean, out_incognito_cleared boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_incognito boolean;
    v_generation record;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: conversation id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1 FROM vc.vc_user WHERE id=p_owner_user_id FOR NO KEY UPDATE;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    SELECT c.incognito INTO v_incognito
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id
       AND c.id = p_conversation_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Closing a work item alone strands its nonterminal generation and
    -- keeps consuming the owner's outstanding-turn allowance forever.
    FOR v_generation IN
        SELECT g.id FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.conversation_id = p_conversation_id
           AND NOT vc.go_generation_terminal(g.status)
           AND g.status <> 'COMMITTING'
         ORDER BY g.id
         FOR UPDATE
    LOOP
        PERFORM * FROM vc.go_request_cancel(p_owner_user_id, v_generation.id);
    END LOOP;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind = 'MEMORY_EXTRACT'
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
             WHERE g.owner_user_id = p_owner_user_id
               AND g.conversation_id = p_conversation_id
       );

    IF v_incognito THEN
        DELETE FROM vc.stored_chat WHERE owner_user_id=p_owner_user_id AND conversation_id=p_conversation_id;
        UPDATE vc.message
           SET content = ''
         WHERE owner_user_id = p_owner_user_id
           AND conversation_id = p_conversation_id;
    END IF;

    out_ok := true;
    out_incognito_cleared := COALESCE(v_incognito, false);
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION vc.preview_chat_wipe(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_conversation_count bigint, out_message_count bigint,
                  out_in_flight_count bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'preview_chat_wipe: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'preview_chat_wipe: owner_user_id must match server-trusted context';
    END IF;

    SELECT count(*)::bigint INTO out_conversation_count
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id;

    SELECT count(*)::bigint INTO out_message_count
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id;

    SELECT count(*)::bigint INTO out_in_flight_count
      FROM vc.work_item w
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
       );

    out_conversation_count := out_conversation_count + (SELECT count(*) FROM vc.stored_chat WHERE owner_user_id=p_owner_user_id AND kind='GROUP' AND deleted_at IS NULL);
    out_message_count := out_message_count + (SELECT count(*) FROM vc.stored_message WHERE owner_user_id=p_owner_user_id AND deleted_at IS NULL);
    RETURN QUERY SELECT out_conversation_count, out_message_count,
                        out_in_flight_count;
END;
$$;

CREATE OR REPLACE FUNCTION vc.wipe_all_chats(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_conversations_deleted bigint, out_messages_deleted bigint,
                  out_work_items_cancelled bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'wipe_all_chats: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'wipe_all_chats: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1 FROM vc.vc_user WHERE id=p_owner_user_id FOR NO KEY UPDATE;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    SELECT count(*)::bigint INTO out_messages_deleted
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
       );
    GET DIAGNOSTICS out_work_items_cancelled = ROW_COUNT;

    out_messages_deleted := out_messages_deleted + (SELECT count(*) FROM vc.stored_message WHERE owner_user_id=p_owner_user_id AND deleted_at IS NULL);
    out_conversations_deleted := (SELECT count(*) FROM vc.stored_chat WHERE owner_user_id=p_owner_user_id AND kind='GROUP' AND deleted_at IS NULL);
    DELETE FROM vc.stored_chat WHERE owner_user_id=p_owner_user_id AND kind='GROUP';
    WITH deleted_sx_conversations AS (
        DELETE FROM vc.conversation c WHERE c.owner_user_id=p_owner_user_id RETURNING 1
    ) SELECT out_conversations_deleted+count(*) INTO out_conversations_deleted FROM deleted_sx_conversations;

    RETURN NEXT;
END;
$$;

-- Narrow storage functions keep the existing zero direct-DML runtime boundary.
CREATE FUNCTION vc.require_stored_chat_writer(p_owner bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE a text;
BEGIN
    SELECT authority INTO a FROM vc.lock_chat_authority(p_owner,true);
    IF a<>'GO' THEN RAISE EXCEPTION 'stored chat authority unavailable'; END IF;
END $$;

CREATE FUNCTION vc.lock_stored_chat(p_owner bigint,p_chat uuid,p_write boolean)
RETURNS SETOF vc.stored_chat LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_write THEN
        PERFORM vc.require_stored_chat_writer(p_owner);
        RETURN QUERY SELECT * FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL FOR UPDATE;
    ELSE
        RETURN QUERY SELECT * FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat AND deleted_at IS NULL FOR SHARE;
    END IF;
END $$;

CREATE FUNCTION vc.insert_stored_chat(p_owner bigint,p_chat uuid,p_kind text,p_conversation bigint,p_relationship bigint,p_character text,p_group text,p_root uuid,p_title text,p_header text,p_metadata text)
RETURNS SETOF vc.stored_chat LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.require_stored_chat_writer(p_owner);
    RETURN QUERY INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,conversation_id,relationship_id,character_ref,group_ref,branch_root,title,header_cipher,metadata_cipher)
    VALUES(p_owner,p_chat,p_kind,p_conversation,p_relationship,p_character,p_group,p_root,p_title,p_header,p_metadata) RETURNING *;
END $$;

CREATE FUNCTION vc.insert_stored_message(p_owner bigint,p_chat uuid,p_message uuid,p_position bigint,p_revision bigint,p_selected uuid,p_data text,p_digest bytea)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.require_stored_chat_writer(p_owner);
    INSERT INTO vc.stored_message(owner_user_id,chat_id,message_id,position,revision,selected_candidate_id,data_cipher,initial_digest)
    VALUES(p_owner,p_chat,p_message,p_position,p_revision,p_selected,p_data,p_digest);
END $$;

CREATE FUNCTION vc.insert_stored_candidate(p_owner bigint,p_chat uuid,p_message uuid,p_candidate uuid,p_ordinal integer,p_revision bigint,p_generation bigint,p_settled boolean,p_data text,p_digest bytea)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.require_stored_chat_writer(p_owner);
    INSERT INTO vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id,ordinal,source_revision,source_generation,settled,data_cipher,initial_digest)
    VALUES(p_owner,p_chat,p_message,p_candidate,p_ordinal,p_revision,p_generation,p_settled,p_data,p_digest);
END $$;

CREATE FUNCTION vc.insert_chat_change(p_owner bigint,p_chat uuid,p_revision bigint,p_event jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.require_stored_chat_writer(p_owner);
    INSERT INTO vc.chat_change(owner_user_id,chat_id,revision,event) VALUES(p_owner,p_chat,p_revision,p_event);
END $$;

CREATE FUNCTION vc.insert_chat_receipt(p_owner bigint,p_resource text,p_request uuid,p_digest bytea,p_operation uuid,p_chat uuid,p_revision bigint,p_status integer,p_result text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.require_stored_chat_writer(p_owner);
    INSERT INTO vc.chat_receipt(owner_user_id,resource,request_id,request_digest,operation_id,chat_id,result_revision,status,result_cipher)
    VALUES(p_owner,p_resource,p_request,p_digest,p_operation,p_chat,p_revision,p_status,p_result);
    UPDATE vc.chat_receipt SET result_cipher=NULL WHERE owner_user_id=p_owner AND expires_at<=now() AND result_cipher IS NOT NULL;
    DELETE FROM vc.chat_change WHERE owner_user_id=p_owner AND created_at<now()-interval '7 days' AND dispatched_at IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION vc.require_stored_chat_writer(bigint),vc.lock_stored_chat(bigint,uuid,boolean),
 vc.insert_stored_chat(bigint,uuid,text,bigint,bigint,text,text,uuid,text,text,text),
 vc.insert_stored_message(bigint,uuid,uuid,bigint,bigint,uuid,text,bytea),
 vc.insert_stored_candidate(bigint,uuid,uuid,uuid,integer,bigint,bigint,boolean,text,bytea),
 vc.insert_chat_change(bigint,uuid,bigint,jsonb),
 vc.insert_chat_receipt(bigint,text,uuid,bytea,uuid,uuid,bigint,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.lock_stored_chat(bigint,uuid,boolean),
 vc.insert_stored_chat(bigint,uuid,text,bigint,bigint,text,text,uuid,text,text,text),
 vc.insert_stored_message(bigint,uuid,uuid,bigint,bigint,uuid,text,bytea),
 vc.insert_stored_candidate(bigint,uuid,uuid,uuid,integer,bigint,bigint,boolean,text,bytea),
 vc.insert_chat_change(bigint,uuid,bigint,jsonb),
 vc.insert_chat_receipt(bigint,text,uuid,bytea,uuid,uuid,bigint,integer,text) TO vc_api,vc_worker;
