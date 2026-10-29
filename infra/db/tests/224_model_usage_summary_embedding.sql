-- W11-3: the admin summary counts a reservation once. A generation_usage row
-- with the same provider_ref is kept and is not added again. An unlinked
-- generation_usage row is legacy only. Local embedding is a call count with
-- null money and does not move the month budget. A missing price still inserts
-- one unpriced reservation with a zero hold.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget, vc.generation_usage, vc.local_embedding_call;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002)
ON CONFLICT (provider_id, model_id, price_version) DO NOTHING;
INSERT INTO vc.vc_user(id, display_name) VALUES
    (22401, 'w11 summary owner'),
    (22409, 'w11 summary admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (22401, 'w11-224-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
    (22409, 'w11-224-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', role = EXCLUDED.role;
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (22401, 22410, 'persona-meter');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (22401, 22410, 22410, 'meter');

DO $$
DECLARE
    v_gen1 bigint;
    v_gen2 bigint;
    v_fg text;
    v_legacy text;
    v_legacy_calls bigint;
    v_emb_calls bigint;
    v_emb_actual text;
    v_emb_estimated text;
    v_emb_unsettled text;
    v_old bigint;
    v_settled numeric;
    v_reserved numeric;
    n integer;
BEGIN
    PERFORM vc.set_owner_context(22401, 'm224', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|22401|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m224',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    PERFORM 1 FROM vc.reserve_model_usage(
        22401, 'FOREGROUND_CHAT', 'fg-linked', 'w11-meter', 'priced', 1000, 1000, 1000000, 8000000);
    PERFORM 1 FROM vc.settle_model_usage_reservation(
        22401, (SELECT id FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-linked'), 1000, 1000);
    SELECT generation_id INTO v_gen1 FROM vc.receive_generation(22401, 22410, 'meter-224-1', 'user', 'hello');
    SELECT generation_id INTO v_gen2 FROM vc.receive_generation(22401, 22410, 'meter-224-2', 'user', 'world');
    INSERT INTO vc.generation_usage(owner_user_id, id, generation_id, provider_ref, input_tokens, output_tokens, actual_cost, currency)
    VALUES (22401, 22401, v_gen1, 'fg-linked', 10, 10, 9.990000, 'USD'),
           (22401, 22402, v_gen2, 'legacy-only', 20, 20, 1.250000, 'USD');
    SELECT out_actual_usd INTO v_fg FROM vc.admin_model_usage_summary(22409, now() - interval '1 day')
     WHERE out_purpose = 'FOREGROUND_CHAT';
    SELECT out_calls, out_actual_usd INTO v_legacy_calls, v_legacy
      FROM vc.admin_model_usage_summary(22409, now() - interval '1 day')
     WHERE out_purpose = 'LEGACY_GENERATION';
    IF v_fg IS DISTINCT FROM '0.003000' OR v_legacy_calls IS DISTINCT FROM 1 OR v_legacy IS DISTINCT FROM '1.250000' THEN
        RAISE EXCEPTION 'summary fg=% legacy calls=% actual=%', v_fg, v_legacy_calls, v_legacy;
    END IF;
    SELECT COALESCE(sum(out_generations), 0) INTO v_old
      FROM vc.admin_usage_summary(22409, now() - interval '1 day');
    IF v_old <> 2 THEN
        RAISE EXCEPTION 'old generation_usage rows disappeared (% )', v_old;
    END IF;
    SELECT settled_usd, reserved_usd INTO v_settled, v_reserved FROM vc.month_cost_budget;
    PERFORM vc.record_local_embedding_call(22401);
    PERFORM vc.record_local_embedding_call(22401);
    IF (SELECT settled_usd FROM vc.month_cost_budget) IS DISTINCT FROM v_settled
       OR (SELECT reserved_usd FROM vc.month_cost_budget) IS DISTINCT FROM v_reserved THEN
        RAISE EXCEPTION 'embedding moved the month budget';
    END IF;
    SELECT out_calls, out_actual_usd, out_estimated_usd, out_unsettled_usd
      INTO v_emb_calls, v_emb_actual, v_emb_estimated, v_emb_unsettled
      FROM vc.admin_model_usage_summary(22409, now() - interval '1 day')
     WHERE out_purpose = 'EMBEDDING';
    IF v_emb_calls IS DISTINCT FROM 2 OR v_emb_actual IS NOT NULL
       OR v_emb_estimated IS NOT NULL OR v_emb_unsettled IS NOT NULL THEN
        RAISE EXCEPTION 'embedding % % % %', v_emb_calls, v_emb_actual, v_emb_estimated, v_emb_unsettled;
    END IF;
    PERFORM 1 FROM vc.reserve_model_usage(
        22401, 'FOREGROUND_CHAT', 'fg-224-noprice', 'w11-meter', 'missing', 10, 10, 1000000, 8000000);
    SELECT count(*) INTO n FROM vc.model_cost_reservation
     WHERE provider_attempt_id = 'fg-224-noprice'
       AND price_version IS NULL AND reserved_usd = 0 AND actual_usd IS NULL AND status = 'HELD';
    IF n <> 1 THEN RAISE EXCEPTION 'missing price hold %', n; END IF;
    BEGIN
        PERFORM 1 FROM vc.admin_model_usage_summary(22401, now() - interval '1 day');
        RAISE EXCEPTION 'non-admin read the summary';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-admin read the summary%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
            RAISE EXCEPTION 'summary denial %', SQLERRM;
        END IF;
    END;
END $$;

SET ROLE vc_api;
DO $$
BEGIN
    INSERT INTO vc.local_embedding_call(owner_user_id) VALUES (22401);
    RAISE EXCEPTION 'runtime inserted an embedding call';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
RESET ROLE;
