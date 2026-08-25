-- 161_retention_category_probe: DOGFOOD-STABILIZATION V111 — retention
-- category activation probe.
--
-- Covers: the probe returns false for a DRAFT category and true for an
-- ACTIVATED one (active AND status='ACTIVE', the V104 shape); a blank
-- category RAISEs; the probe stays vc_api-only. State is normalized to the
-- all-DRAFT seed face first (same as 152/159) so earlier tests cannot leak
-- activation into the assertions.

\set ON_ERROR_STOP on

-- Normalize: every category back to the V70 seed DRAFT face.
UPDATE vc.data_retention_policy SET status = 'DRAFT';

BEGIN;
DO $$
DECLARE
    v_active boolean;
BEGIN
    -- DRAFT (the seed face): not activated.
    SELECT vc.retention_category_active('NORMAL_CHAT') INTO v_active;
    IF v_active THEN
        RAISE EXCEPTION 'DRAFT category must probe as not activated';
    END IF;

    -- Blank category RAISEs.
    BEGIN
        PERFORM vc.retention_category_active('  ');
        RAISE EXCEPTION 'blank category unexpectedly probed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly probed%' THEN RAISE; END IF;
        NULL;
    END;
END $$;
COMMIT;

-- Activate NORMAL_CHAT exactly like the dogfood activation SQL.
INSERT INTO vc.data_retention_policy (policy_version, category, retain_days, active, status)
SELECT (SELECT max(policy_version) + 1 FROM vc.data_retention_policy
         WHERE category = 'NORMAL_CHAT'), 'NORMAL_CHAT', 30, true, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM vc.data_retention_policy
                   WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE');

BEGIN;
DO $$
DECLARE
    v_active boolean;
    v_days   integer;
BEGIN
    SELECT vc.retention_category_active('NORMAL_CHAT') INTO v_active;
    IF NOT v_active THEN
        RAISE EXCEPTION 'ACTIVATED category must probe as activated';
    END IF;

    -- 1 ACTIVE + 7 DRAFT face: probe agrees with active_retention_days.
    SELECT vc.active_retention_days('NORMAL_CHAT') INTO v_days;
    IF v_days <> 30 THEN
        RAISE EXCEPTION 'activated policy must read 30 days (got %)', v_days;
    END IF;
    SELECT vc.retention_category_active('EXPORT_RESIDUE') INTO v_active;
    IF v_active THEN
        RAISE EXCEPTION 'EXPORT_RESIDUE must stay DRAFT (not activated)';
    END IF;
END $$;
COMMIT;

-- Leave the all-DRAFT seed face behind for any later test.
UPDATE vc.data_retention_policy SET status = 'DRAFT';

-- The probe stays vc_api-only.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM vc.retention_category_active('NORMAL_CHAT');
    RAISE EXCEPTION 'vc_worker unexpectedly executed retention_category_active';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
