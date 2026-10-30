-- HL-PROACTIVE: new-relationship defaults, legacy put mapping, owner isolation,
-- and proactive assistant text excluded from the profile allowlist.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (27101, 'hl proactive owner'),
    (27102, 'hl proactive other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (27101, 27110, 'hl-old', false);

CREATE TEMP TABLE hl_ids (rel bigint);
GRANT ALL ON TABLE hl_ids TO vc_api;

BEGIN;
SELECT vc.set_owner_context(27101, 'hl271a', encode(vc.hmac(convert_to('vc-owner-binding-v1|27101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|hl271a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_enabled boolean;
    v_offline boolean;
    v_daily integer;
    v_check integer;
    v_mode text;
    v_start time;
    v_end time;
    v_zone text;
BEGIN
    v_rel := vc.create_relationship(27101, 'hl-proactive');
    DELETE FROM hl_ids;
    INSERT INTO hl_ids VALUES (v_rel);

    SELECT out_enabled, out_offline_capable, out_daily_limit, out_mode,
           out_check_in_after_minutes, out_quiet_start, out_quiet_end, out_quiet_timezone
      INTO v_enabled, v_offline, v_daily, v_mode, v_check, v_start, v_end, v_zone
      FROM vc.get_proactive_policy(27101, v_rel);
    IF v_enabled IS NOT TRUE OR v_offline IS NOT FALSE OR v_daily <> 3
       OR v_mode IS DISTINCT FROM 'CLOSE_FRIEND' OR v_check <> 720
       OR v_start IS DISTINCT FROM time '23:00' OR v_end IS DISTINCT FROM time '08:00'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai' THEN
        RAISE EXCEPTION 'new relationship policy is not CLOSE_FRIEND/720/daily 3/23:00-08:00';
    END IF;

    PERFORM vc.put_proactive_policy(
        27101, v_rel, true, '23:00', '08:00', 'Asia/Shanghai', 4, 0, ARRAY['COMPANION'], false);
    SELECT out_mode, out_check_in_after_minutes, out_daily_limit, out_enabled
      INTO v_mode, v_check, v_daily, v_enabled
      FROM vc.get_proactive_policy(27101, v_rel);
    IF v_mode IS DISTINCT FROM 'CLOSE_FRIEND' OR v_check <> 720 OR v_daily <> 4 OR v_enabled IS NOT TRUE THEN
        RAISE EXCEPTION 'ten-arg put did not keep CLOSE_FRIEND';
    END IF;

    SELECT out_enabled, out_daily_limit, out_mode, out_check_in_after_minutes, out_quiet_start
      INTO v_enabled, v_daily, v_mode, v_check, v_start
      FROM vc.get_proactive_policy(27101, 27110);
    IF v_enabled IS NOT FALSE OR v_daily <> 0 OR v_mode IS DISTINCT FROM 'OFF'
       OR v_check <> 720 OR v_start IS NOT NULL THEN
        RAISE EXCEPTION 'legacy relationship without a policy row must read as OFF';
    END IF;

    PERFORM vc.put_proactive_policy(
        27101, 27110, true, NULL, NULL, NULL, 0, 0, ARRAY['COMPANION'], false);
    SELECT out_mode, out_enabled, out_check_in_after_minutes
      INTO v_mode, v_enabled, v_check
      FROM vc.get_proactive_policy(27101, 27110);
    IF v_mode IS DISTINCT FROM 'FOLLOW_UP' OR v_enabled IS NOT TRUE OR v_check <> 720 THEN
        RAISE EXCEPTION 'legacy enabled=true did not become FOLLOW_UP';
    END IF;

    PERFORM vc.put_proactive_policy(
        27101, 27110, false, NULL, NULL, NULL, 0, 0, ARRAY['COMPANION'], false);
    SELECT out_mode, out_enabled INTO v_mode, v_enabled
      FROM vc.get_proactive_policy(27101, 27110);
    IF v_mode IS DISTINCT FROM 'OFF' OR v_enabled IS NOT FALSE THEN
        RAISE EXCEPTION 'legacy enabled=false did not become OFF';
    END IF;

    BEGIN
        PERFORM vc.put_proactive_policy(
            27101, v_rel, true, '23:00', '08:00', 'Asia/Shanghai', 3, 0, ARRAY['COMPANION'], false,
            'CLOSE_FRIEND', 119);
        RAISE EXCEPTION 'check-in 119 was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'proactive_policy: check-in out of range' THEN
            RAISE;
        END IF;
    END;

    PERFORM vc.save_companion_affect(
        27101, v_rel, 50, 50, 50, 50, 50, 50, clock_timestamp(), '', NULL, 0, NULL, NULL, NULL);
    IF (SELECT count(*) FROM vc.companion_affect WHERE relationship_id = v_rel) <> 1 THEN
        RAISE EXCEPTION 'owner cannot read the affect row just written';
    END IF;
END $$;
COMMIT;
RESET ROLE;

INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
SELECT 27101, 27120, rel, 'hl',
       '27100000-0000-4000-8000-000000002710', 'COMPANION', 'PRESENT', false
  FROM hl_ids;
INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
SELECT 27101, 27120, '27111111-1111-4111-8111-111111111111', '27122222-2222-4222-8222-222222222222',
       1, 1, 'st:27100000-0000-4000-8000-000000002710:27111111-1111-4111-8111-111111111111:27122222-2222-4222-8222-222222222222:1:1',
       'assistant', 'hl-proactive-line', true, true, true, false, 1
  FROM hl_ids;
INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
SELECT 27101, 27120, '27133333-3333-4333-8333-333333333333', '27144444-4444-4444-8444-444444444444',
       1, 1, 'st:27100000-0000-4000-8000-000000002710:27133333-3333-4333-8333-333333333333:27144444-4444-4444-8444-444444444444:1:1',
       'user', 'hl-proactive-line', true, true, true, false, 2
  FROM hl_ids;
INSERT INTO vc.proactive_message(
    owner_user_id, relationship_id, trigger_key, kind, cluster_key, reminder, status, body)
SELECT 27101, rel, 'share_day', 'share', 'share', false, 'INBOX', 'hl-proactive-line'
  FROM hl_ids;

BEGIN;
SELECT vc.set_owner_context(27101, 'hl271b', encode(vc.hmac(convert_to('vc-owner-binding-v1|27101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|hl271b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_n integer;
    v_assistant text := 'st:27100000-0000-4000-8000-000000002710:27111111-1111-4111-8111-111111111111:27122222-2222-4222-8222-222222222222:1:1';
    v_user text := 'st:27100000-0000-4000-8000-000000002710:27133333-3333-4333-8333-333333333333:27144444-4444-4444-8444-444444444444:1:1';
BEGIN
    SELECT rel INTO v_rel FROM hl_ids;
    IF vc.memory_profile_source_allowed(27101, 27120, v_assistant) IS NOT TRUE
       OR vc.memory_profile_source_allowed(27101, 27120, v_user) IS NOT TRUE THEN
        RAISE EXCEPTION 'both sources should be allowed before suppression';
    END IF;
    v_n := vc.suppress_proactive_sources(27101, '27100000-0000-4000-8000-000000002710');
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'suppress should mark exactly the assistant copy, got %', v_n;
    END IF;
    IF vc.memory_profile_source_allowed(27101, 27120, v_assistant) IS NOT FALSE THEN
        RAISE EXCEPTION 'inbox proactive assistant text is still profile-eligible';
    END IF;
    IF vc.memory_profile_source_allowed(27101, 27120, v_user) IS NOT TRUE THEN
        RAISE EXCEPTION 'a user line with the same text must stay eligible';
    END IF;
    IF (SELECT count(*) FROM vc.proactive_message) <> 1
       OR (SELECT count(*) FROM vc.companion_affect) <> 1 THEN
        RAISE EXCEPTION 'owner lost the proactive rows';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(27102, 'hl271c', encode(vc.hmac(convert_to('vc-owner-binding-v1|27102|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|hl271c', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
BEGIN
    SELECT rel INTO v_rel FROM hl_ids;
    IF (SELECT count(*) FROM vc.companion_affect) <> 0
       OR (SELECT count(*) FROM vc.companion_daily_mood) <> 0
       OR (SELECT count(*) FROM vc.proactive_message) <> 0
       OR (SELECT count(*) FROM vc.proactive_cooldown) <> 0 THEN
        RAISE EXCEPTION 'other owner can read proactive state';
    END IF;
    BEGIN
        INSERT INTO vc.companion_affect(owner_user_id, relationship_id) VALUES (27101, v_rel);
        RAISE EXCEPTION 'cross-owner affect write was accepted';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.companion_affect) <> 0
       OR (SELECT count(*) FROM vc.proactive_message) <> 0
       OR (SELECT count(*) FROM vc.proactive_policy WHERE relationship_id = 27110 OR relationship_id IN (SELECT rel FROM hl_ids)) <> 0 THEN
        RAISE EXCEPTION 'missing owner context leaked proactive rows';
    END IF;
END $$;
COMMIT;
RESET ROLE;
