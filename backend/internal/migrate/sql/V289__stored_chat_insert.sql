-- SX-6: explicit insertion keeps existing evidence identities and advances the
-- order fence in the same command transaction. Runtime has no direct DML grant.
CREATE FUNCTION vc.shift_stored_chat_positions(p_owner bigint,p_chat uuid,p_before bigint,p_count bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 IF p_count<1 OR p_count>100 THEN RAISE EXCEPTION 'invalid insert size'; END IF;
 UPDATE vc.stored_message SET position=position+p_count
 WHERE owner_user_id=p_owner AND chat_id=p_chat AND position>=p_before;
END $$;
REVOKE ALL ON FUNCTION vc.shift_stored_chat_positions(bigint,uuid,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.shift_stored_chat_positions(bigint,uuid,bigint,bigint) TO vc_api,vc_worker;
