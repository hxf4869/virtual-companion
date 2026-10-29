-- W16 review: an expired follow-up lease with no stored greeting marks
-- follow-up:{job}:{attempt} UNKNOWN and keeps the hold. A stored greeting
-- is not marked. attempt_count 2 with max 3 dead-letters and still keeps
-- the hold.

\set ON_ERROR_STOP on

INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w16e-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (26101, 'w16e lease') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (26101, 'w16e-261-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (26101, 10, 'persona-a', true)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
VALUES
    (26101, 26121, 10, 'RELATIONSHIP', '复查', 'ACCEPTED'),
    (26101, 26122, 10, 'RELATIONSHIP', '已生成', 'ACCEPTED'),
    (26101, 26123, 10, 'RELATIONSHIP', '耗尽', 'ACCEPTED')
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, memory_item_id, body, status, normalization_status,
    time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
VALUES
    (26101, 26111, 10, 26121, '复查', 'SCHEDULED', 'explicit_date',
     'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
     clock_timestamp() - interval '1 hour', 'fu-w16e-261-open',
     'st:11111111-1111-4111-8111-111111111111'),
    (26101, 26113, 10, 26123, '耗尽', 'SCHEDULED', 'explicit_date',
     'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
     clock_timestamp() - interval '1 hour', 'fu-w16e-261-bound',
     'st:11111111-1111-4111-8111-111111111111');
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, memory_item_id, body, status, normalization_status,
    event_id, deliverable, greeting_body, generation_outcome)
VALUES (
    26101, 26112, 10, 26122, '已生成', 'BODY_READY', 'none',
    'fu-w16e-261-kept', 'DELIVERABLE', '下周见', 'BODY_READY');
INSERT INTO vc.work_item(
    owner_user_id, id, kind, ref_id, status, claim_token, claim_fence,
    claimed_at, lease_expires_at, attempt_count)
VALUES
    (26101, 26101, 'FOLLOW_UP', 26111, 'CLAIMED', 'tok-open', 'fen-open',
     clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 minute', 0),
    (26101, 26102, 'FOLLOW_UP', 26112, 'CLAIMED', 'tok-kept', 'fen-kept',
     clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 minute', 0),
    (26101, 26103, 'FOLLOW_UP', 26113, 'CLAIMED', 'tok-bound', 'fen-bound',
     clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '1 minute', 2);

DO $$
DECLARE
    v_action text;
    v_status text;
    v_actual numeric;
    v_reserved numeric;
    v_attempts integer;
    v_settled numeric;
    v_held numeric;
    v_unsettled numeric;
    v_settled_before numeric;
    v_held_before numeric;
    v_unsettled_before numeric;
BEGIN
    SELECT COALESCE(sum(settled_usd), 0), COALESCE(sum(reserved_usd), 0), COALESCE(sum(unsettled_usd), 0)
      INTO v_settled_before, v_held_before, v_unsettled_before
      FROM vc.month_cost_budget;
    PERFORM vc.set_owner_context(26101, 'm261', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|26101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m261',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    PERFORM vc.go_hold_model_cost(
        26101, 26101, 'follow-up:26101:0', 'w16e-meter', 'priced', 10, 10, 1000000, 8000000,
        'BACKGROUND_GREETINGS');
    PERFORM vc.go_hold_model_cost(
        26101, 26102, 'follow-up:26102:0', 'w16e-meter', 'priced', 10, 10, 1000000, 8000000,
        'BACKGROUND_GREETINGS');
    PERFORM vc.go_hold_model_cost(
        26101, 26103, 'follow-up:26103:2', 'w16e-meter', 'priced', 10, 10, 1000000, 8000000,
        'BACKGROUND_GREETINGS');

    v_action := vc.go_recover_expired_follow_up(26101, 26101, 3);
    IF v_action IS DISTINCT FROM 'REQUEUED' THEN
        RAISE EXCEPTION 'open recover %', v_action;
    END IF;
    SELECT status, attempt_count INTO v_status, v_attempts
      FROM vc.work_item WHERE owner_user_id = 26101 AND id = 26101;
    IF v_status IS DISTINCT FROM 'PENDING' OR v_attempts IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'open job % attempts %', v_status, v_attempts;
    END IF;
    SELECT status, actual_usd, reserved_usd INTO v_status, v_actual, v_reserved
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'follow-up:26101:0';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'open ledger % % %', v_status, v_actual, v_reserved;
    END IF;

    v_action := vc.go_recover_expired_follow_up(26101, 26102, 3);
    IF v_action IS DISTINCT FROM 'REQUEUED' THEN
        RAISE EXCEPTION 'kept greeting recover %', v_action;
    END IF;
    SELECT status, actual_usd, reserved_usd INTO v_status, v_actual, v_reserved
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'follow-up:26102:0';
    IF v_status IS DISTINCT FROM 'HELD' OR v_actual IS NOT NULL OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'kept greeting ledger % % %', v_status, v_actual, v_reserved;
    END IF;

    v_action := vc.go_recover_expired_follow_up(26101, 26103, 3);
    IF v_action IS DISTINCT FROM 'DEAD_LETTERED' THEN
        RAISE EXCEPTION 'bound recover %', v_action;
    END IF;
    SELECT status, attempt_count INTO v_status, v_attempts
      FROM vc.work_item WHERE owner_user_id = 26101 AND id = 26103;
    IF v_status IS DISTINCT FROM 'DEAD_LETTERED' OR v_attempts IS DISTINCT FROM 3 THEN
        RAISE EXCEPTION 'bound job % attempts %', v_status, v_attempts;
    END IF;
    SELECT status, actual_usd, reserved_usd INTO v_status, v_actual, v_reserved
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'follow-up:26103:2';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'bound ledger % % %', v_status, v_actual, v_reserved;
    END IF;

    SELECT COALESCE(sum(settled_usd), 0), COALESCE(sum(reserved_usd), 0), COALESCE(sum(unsettled_usd), 0)
      INTO v_settled, v_held, v_unsettled
      FROM vc.month_cost_budget;
    IF v_settled IS DISTINCT FROM v_settled_before
       OR v_held IS DISTINCT FROM v_held_before + 0.000030
       OR v_unsettled IS DISTINCT FROM v_unsettled_before + 0.000060 THEN
        RAISE EXCEPTION 'month delta settled % reserved % unsettled %',
            v_settled - v_settled_before, v_held - v_held_before, v_unsettled - v_unsettled_before;
    END IF;
END $$;
