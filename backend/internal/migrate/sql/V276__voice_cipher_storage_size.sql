-- VO-12: encrypted enc2 objects expand the already bounded 32 MiB WAV via
-- Base64. storage_bytes records the actual envelope, not plaintext audio size.
-- Keep the existing NOT NULL / nonnegative column constraint as the size guard.
CREATE OR REPLACE FUNCTION vc.record_voice_size(p_owner bigint,p_clip bigint,p_bytes bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.voice_clip SET storage_bytes=p_bytes WHERE owner_user_id=p_owner AND id=p_clip AND status='ready';
END $$;
