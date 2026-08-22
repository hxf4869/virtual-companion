-- 134_model_cost_budget: S0-29 V83 — empty price table is unknown;
-- month spend is settled + reserved; no direct DML for runtime roles.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice')
ON CONFLICT (id) DO NOTHING;

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_present boolean;
    v_spend numeric;
BEGIN
    v_present := vc.model_unit_price_present();
    IF v_present IS NOT FALSE THEN
        RAISE EXCEPTION 'price table must start empty (unknown price fail-closed)';
    END IF;
    v_spend := vc.month_cost_spend();
    IF v_spend IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'empty month spend must be 0, got %', v_spend;
    END IF;
    BEGIN
        INSERT INTO vc.model_unit_price(provider_id, price_version, input_usd_per_1k, output_usd_per_1k)
        VALUES ('x', 1, 0.1, 0.2);
        RAISE EXCEPTION 'direct INSERT on model_unit_price must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;
