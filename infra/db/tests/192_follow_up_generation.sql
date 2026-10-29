-- W09-S4: greeting generation is owner-scoped, a blocked outcome cannot store
-- a body, a repeated finish does not change the stable event id, and a second
-- cost hold for the same attempt does not double the reservation.
-- V39 vc.reminder is not extended.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (19201, 'w09 greeting owner'),
    (19202, 'w09 greeting other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (19201, 19210, 'persona-s4', true),
    (19202, 19220, 'persona-other', true);
UPDATE vc.relationship SET companion_name = '小南'
 WHERE owner_user_id = 19201 AND id = 19210;

INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES (
    19201, 19210, 19210, 'w09-s4',
    '19200000-0000-4000-8000-000000000192', 'COMPANION', 'PRESENT', false);
INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
VALUES
    (19201, 19210, '11111111-1111-4111-8111-000000000192', '22222222-2222-4222-8222-000000000192',
     1, 1, 'st:19200000-0000-4000-8000-000000000192:11111111-1111-4111-8111-000000000192:22222222-2222-4222-8222-000000000192:1:1',
     'user', 'w09-ready', true, true, true, false, 1),
    (19201, 19210, '11111111-1111-4111-8111-000000000193', '22222222-2222-4222-8222-000000000193',
     1, 1, 'st:19200000-0000-4000-8000-000000000192:11111111-1111-4111-8111-000000000193:22222222-2222-4222-8222-000000000193:1:1',
     'user', 'w09-blocked', true, true, true, false, 2);

BEGIN;
SELECT vc.set_owner_context(19201, 'w09s4', encode(vc.hmac(convert_to('vc-owner-binding-v1|19201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status) VALUES
    (19211, 19201, 19210, 'RELATIONSHIP', 'w09 ready topic', 'ACCEPTED'),
    (19212, 19201, 19210, 'RELATIONSHIP', 'w09 blocked topic', 'ACCEPTED');
INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
    (19201, 19221, 19211, 'st:19200000-0000-4000-8000-000000000192:11111111-1111-4111-8111-000000000192:22222222-2222-4222-8222-000000000192:1:1'),
    (19201, 19222, 19212, 'st:19200000-0000-4000-8000-000000000192:11111111-1111-4111-8111-000000000193:22222222-2222-4222-8222-000000000193:1:1');
COMMIT;
RESET ROLE;

INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
VALUES ('greet-prov', 'greet-model', 1, 0.001, 0.002);

BEGIN;
SELECT vc.set_owner_context(19201, 'w09s4w', encode(vc.hmac(convert_to('vc-owner-binding-v1|19201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s4w', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_ready bigint;
    v_blocked bigint;
    v_name text;
    v_source boolean;
    v_enabled boolean;
    v_offline boolean;
    v_greeting text;
    v_event text;
    v_body text;
    v_status text;
    v_outcome text;
    v_deliverable text;
    v_decision text;
    v_again text;
    v_doc jsonb;
    v_ref_ready text := 'st:19200000-0000-4000-8000-000000000192:11111111-1111-4111-8111-000000000192:22222222-2222-4222-8222-000000000192:1:1';
    v_ref_blocked text := 'st:19200000-0000-4000-8000-000000000192:11111111-1111-4111-8111-000000000193:22222222-2222-4222-8222-000000000193:1:1';
BEGIN
    PERFORM vc.put_proactive_policy(
        19201, 19210, true, NULL, NULL, NULL, 1, 0, ARRAY['COMPANION'], true);
    v_ready := vc.insert_follow_up(
        19201, 19210, 19211, v_ref_ready, 1, 'w09 ready topic',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
    v_blocked := vc.insert_follow_up(
        19201, 19210, 19212, v_ref_blocked, 1, 'w09 blocked topic',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-12-03', '09:30', 'Asia/Shanghai', timestamptz '2026-12-03 09:30:00+08');
    SELECT out_companion_name, out_source_valid, out_policy_enabled, out_offline_capable
      INTO v_name, v_source, v_enabled, v_offline
      FROM vc.load_follow_up_generation(19201, v_ready);
    IF v_name IS DISTINCT FROM '小南' OR v_source IS NOT TRUE
       OR v_enabled IS NOT TRUE OR v_offline IS NOT TRUE THEN
        RAISE EXCEPTION 'load did not see the display name, source and offline policy';
    END IF;

    BEGIN
        PERFORM vc.finish_follow_up_generation(
            19201, v_blocked, 'BLOCKED', 'output-ai-identity-human-claim', 'blocked phrase',
            'greet-prov', 'greet-model', 'OPENAI_CHAT_COMPLETIONS', 4, 9, NULL);
        RAISE EXCEPTION 'blocked body unexpectedly stored';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: blocked generation cannot store a body' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.finish_follow_up_generation(
            19201, v_ready, 'BODY_READY', 'BODY_READY', NULL,
            NULL, NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'body ready without greeting unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: body ready requires a greeting' THEN
            RAISE;
        END IF;
    END;

    PERFORM vc.finish_follow_up_generation(
        19201, v_ready, 'BODY_READY', 'BODY_READY', '下周见',
        'greet-prov', 'greet-model', 'OPENAI_CHAT_COMPLETIONS', 4, 9,
        '{"temperature":0.5}'::jsonb);
    PERFORM vc.finish_follow_up_generation(
        19201, v_ready, 'BODY_READY', 'BODY_READY', '另一句',
        NULL, NULL, NULL, NULL, NULL, NULL);
    SELECT status, greeting_body, event_id, body, deliverable
      INTO v_status, v_greeting, v_event, v_body, v_deliverable
      FROM vc.follow_up
     WHERE owner_user_id = 19201 AND id = v_ready;
    IF v_status <> 'BODY_READY' OR v_greeting <> '下周见' OR v_event <> 'fu-m-19211'
       OR v_body <> 'w09 ready topic' OR v_deliverable <> 'DELIVERABLE' THEN
        RAISE EXCEPTION 'ready greeting was rewritten or lost its event id';
    END IF;

    PERFORM vc.finish_follow_up_generation(
        19201, v_blocked, 'BLOCKED', 'output-ai-identity-human-claim', NULL,
        'greet-prov', 'greet-model', 'OPENAI_CHAT_COMPLETIONS', 4, 9, NULL);
    SELECT status, greeting_body, event_id, body, deliverable, generation_outcome
      INTO v_status, v_greeting, v_event, v_body, v_deliverable, v_outcome
      FROM vc.follow_up
     WHERE owner_user_id = 19201 AND id = v_blocked;
    IF v_status <> 'SILENT' OR v_greeting IS NOT NULL OR v_outcome <> 'BLOCKED'
       OR v_deliverable <> 'NOT_DELIVERABLE' OR v_event <> 'fu-m-19212'
       OR v_body <> 'w09 blocked topic' THEN
        RAISE EXCEPTION 'blocked generation stored a body or changed the topic';
    END IF;

    SELECT vc.export_v2_owner_metadata(19201) INTO v_doc;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_doc->'followUps', '[]'::jsonb)) e
         WHERE e->>'eventId' = 'fu-m-19211' AND e->>'greetingBody' = '下周见') THEN
        RAISE EXCEPTION 'export missed the ready greeting';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_doc->'followUps', '[]'::jsonb)) e
         WHERE e->>'generationOutcome' = 'BLOCKED'
           AND COALESCE(e->>'greetingBody', '') <> '') THEN
        RAISE EXCEPTION 'export included a blocked greeting';
    END IF;

    v_decision := vc.prepare_follow_up_model_call(
        19201, 19290, 'follow-up:19290', 'greet-prov', 'greet-model', 10, 16, 1000000, 100000000000);
    v_again := vc.prepare_follow_up_model_call(
        19201, 19290, 'follow-up:19290', 'greet-prov', 'greet-model', 10, 16, 1000000, 100000000000);
    IF v_decision <> 'HELD' OR v_again <> 'REUSED_HELD' THEN
        RAISE EXCEPTION 'cost prepare decisions were % then %', v_decision, v_again;
    END IF;
    v_decision := vc.prepare_follow_up_model_call(
        19201, 19291, 'follow-up:19291', 'greet-prov', 'missing-model', 10, 16, 1000000, 100000000000);
    IF v_decision <> 'HELD' THEN
        RAISE EXCEPTION 'unknown price decision %', v_decision;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The cost ledger is not readable by vc_api. The reservation check runs as the
-- test role after the owner transaction commits.
DO $$
DECLARE
    v_count integer;
    v_reserved text;
BEGIN
    SELECT count(*)::integer, coalesce(sum(reserved_usd), 0)::text
      INTO v_count, v_reserved
      FROM vc.model_cost_reservation
     WHERE provider_attempt_id = 'follow-up:19290';
    IF v_count <> 1 OR v_reserved <> '0.000042' THEN
        RAISE EXCEPTION 'reservation was doubled: count % reserved %', v_count, v_reserved;
    END IF;
    IF (SELECT count(*) FROM vc.model_cost_reservation
         WHERE provider_attempt_id = 'follow-up:19291'
           AND price_version IS NULL AND reserved_usd = 0 AND status = 'HELD') <> 1 THEN
        RAISE EXCEPTION 'unknown price did not insert an unpriced hold';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(19202, 'w09s4o', encode(vc.hmac(convert_to('vc-owner-binding-v1|19202|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s4o', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.follow_up) <> 0 THEN
        RAISE EXCEPTION 'other owner read a greeting';
    END IF;
    BEGIN
        PERFORM vc.finish_follow_up_generation(
            19201, 1, 'CANCELLED', 'CANCELLED', NULL,
            NULL, NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'cross-owner finish unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    IF vc.follow_up_provider_credential('missing-prov', 1) IS NOT NULL THEN
        RAISE EXCEPTION 'missing provider returned a credential';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.follow_up_provider_credential('missing-prov', 1);
    RAISE EXCEPTION 'api credential unexpectedly allowed';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
COMMIT;
RESET ROLE;
