-- W16 review: a deletion intent refuses reserve_model_usage,
-- record_local_embedding_call, apply_follow_up_due enqueue, and
-- finish_follow_up_generation. defer still succeeds.

\set ON_ERROR_STOP on

INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w16e-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (26001, 'w16e deletion') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (26001, 'w16e-260-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (26001, 10, 'persona-a', true)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
VALUES (26001, 26016, 10, 'RELATIONSHIP', '复查', 'ACCEPTED')
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.follow_up(
    owner_user_id, relationship_id, memory_item_id, body, status, normalization_status,
    time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
VALUES (
    26001, 10, 26016, '复查', 'SCHEDULED', 'explicit_date',
    'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
    clock_timestamp() - interval '1 hour', 'fu-w16e-260',
    'st:11111111-1111-4111-8111-111111111111');
DELETE FROM vc.local_embedding_call WHERE owner_user_id = 26001;
DELETE FROM vc.account_deletion_intent WHERE account_id = 26001;

DO $$
DECLARE
    r record;
    v_follow bigint;
    v_job bigint;
    v_created boolean;
    v_status text;
    v_greeting text;
BEGIN
    SELECT id INTO v_follow FROM vc.follow_up
     WHERE owner_user_id = 26001 AND event_id = 'fu-w16e-260';
    PERFORM vc.set_owner_context(26001, 'm260', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|26001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m260',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));

    SELECT * INTO r FROM vc.reserve_model_usage(
        26001, 'FOREGROUND_CHAT', 'fg-260-open', 'w16e-meter', 'priced', 10, 10, 1000000, 8000000);
    IF r.out_status IS DISTINCT FROM 'HELD' THEN
        RAISE EXCEPTION 'open reserve %', r.out_status;
    END IF;
    PERFORM vc.record_local_embedding_call(26001);
    IF (SELECT count(*) FROM vc.local_embedding_call WHERE owner_user_id = 26001) <> 1 THEN
        RAISE EXCEPTION 'embedding was not counted before deletion';
    END IF;
    DELETE FROM vc.local_embedding_call WHERE owner_user_id = 26001;

    INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
    VALUES (26001, '0000000000000000000000000000000000000000000000000000000000002601', 'REQUESTED');

    BEGIN
        PERFORM 1 FROM vc.reserve_model_usage(
            26001, 'FOREGROUND_CHAT', 'fg-260-deleting', 'w16e-meter', 'priced', 10, 10, 1000000, 8000000);
        RAISE EXCEPTION 'reserve during deletion succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN
            RAISE;
        END IF;
    END;
    IF EXISTS (SELECT 1 FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-260-deleting') THEN
        RAISE EXCEPTION 'deletion reserve was stored';
    END IF;

    BEGIN
        PERFORM vc.record_local_embedding_call(26001);
        RAISE EXCEPTION 'embedding during deletion succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN
            RAISE;
        END IF;
    END;
    IF (SELECT count(*) FROM vc.local_embedding_call WHERE owner_user_id = 26001) <> 0 THEN
        RAISE EXCEPTION 'embedding was counted during deletion';
    END IF;

    BEGIN
        PERFORM 1 FROM vc.apply_follow_up_due(26001, v_follow, 'enqueue', NULL);
        RAISE EXCEPTION 'enqueue during deletion succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN
            RAISE;
        END IF;
    END;
    IF EXISTS (
        SELECT 1 FROM vc.work_item
         WHERE owner_user_id = 26001 AND kind = 'FOLLOW_UP' AND ref_id = v_follow
    ) THEN
        RAISE EXCEPTION 'enqueue stored a job during deletion';
    END IF;

    BEGIN
        PERFORM vc.finish_follow_up_generation(
            26001, v_follow, 'BODY_READY', 'BODY_READY', '下周见',
            NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'finish during deletion succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN
            RAISE;
        END IF;
    END;
    SELECT status, greeting_body INTO v_status, v_greeting
      FROM vc.follow_up WHERE owner_user_id = 26001 AND id = v_follow;
    IF v_greeting IS NOT NULL OR v_status IS DISTINCT FROM 'SCHEDULED' THEN
        RAISE EXCEPTION 'finish changed the follow-up % %', v_status, v_greeting;
    END IF;

    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(26001, v_follow, 'defer', clock_timestamp() + interval '1 hour');
    SELECT status INTO v_status FROM vc.follow_up WHERE owner_user_id = 26001 AND id = v_follow;
    IF v_status IS DISTINCT FROM 'DEFERRED' THEN
        RAISE EXCEPTION 'defer during deletion status %', v_status;
    END IF;
END $$;
