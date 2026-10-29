-- The admin summary is the acting owner's rows. cacheHitRate's basis is
-- settled input on rows that reported a cache count, not held estimates.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('fix-go-usage', 'meter', 1, 0.001, 0.001, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES
    (29901, 'fix usage owner'),
    (29902, 'fix usage other'),
    (29909, 'fix usage admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (29901, 'fix-299-owner', 'synthetic', 'ADMIN', 'ACTIVE', 'owner'),
    (29902, 'fix-299-other', 'synthetic', 'USER', 'ACTIVE', 'other'),
    (29909, 'fix-299-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE';

DO $$
DECLARE
    r record;
    v_cached bigint;
    v_basis bigint;
    v_input bigint;
    v_other_cached bigint;
    v_other_basis bigint;
    v_other_input bigint;
BEGIN
    PERFORM vc.set_owner_context(29901, 'm299a', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|29901|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m299a',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT * INTO r FROM vc.reserve_model_usage(
        29901, 'FOREGROUND_CHAT', 'fix-cache', 'fix-go-usage', 'meter', 1000, 1, 0, 0);
    PERFORM vc.settle_model_usage_reservation(29901, r.out_reservation_id, 1000, 1, 800);
    SELECT * INTO r FROM vc.reserve_model_usage(
        29901, 'FOREGROUND_CHAT', 'fix-nocache', 'fix-go-usage', 'meter', 500, 1, 0, 0);
    PERFORM vc.settle_model_usage_reservation(29901, r.out_reservation_id, 500, 1, NULL);
    PERFORM vc.reserve_model_usage(
        29901, 'FOREGROUND_CHAT', 'fix-held', 'fix-go-usage', 'meter', 100000, 1, 0, 0);

    PERFORM vc.set_owner_context(29902, 'm299b', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|29902|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m299b',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT * INTO r FROM vc.reserve_model_usage(
        29902, 'FOREGROUND_CHAT', 'fix-other', 'fix-go-usage', 'meter', 50, 1, 0, 0);
    PERFORM vc.settle_model_usage_reservation(29902, r.out_reservation_id, 50, 1, 40);

    SELECT out_cached_input_tokens, out_cache_basis_input_tokens, out_input_tokens
      INTO v_cached, v_basis, v_input
      FROM vc.admin_model_usage_summary(29901, now() - interval '1 day')
     WHERE out_purpose = 'FOREGROUND_CHAT';
    IF v_cached IS DISTINCT FROM 800 OR v_basis IS DISTINCT FROM 1000 OR v_input IS DISTINCT FROM 101500 THEN
        RAISE EXCEPTION 'owner summary cached=% basis=% input=%', v_cached, v_basis, v_input;
    END IF;
    SELECT out_cached_input_tokens, out_cache_basis_input_tokens, out_input_tokens
      INTO v_other_cached, v_other_basis, v_other_input
      FROM vc.admin_model_usage_summary(29909, now() - interval '1 day')
     WHERE out_purpose = 'FOREGROUND_CHAT';
    IF v_other_cached IS NOT NULL OR v_other_basis IS DISTINCT FROM 0 OR v_other_input IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'other admin cached=% basis=% input=%', v_other_cached, v_other_basis, v_other_input;
    END IF;
END $$;
