-- 109_incognito_pref: INC-PREF V54 — default next-conversation incognito flag.
--
-- Covers: missing row reads as false; update writes true; reread matches;
-- owner mismatch fail-closed; vc_worker cannot execute.

\set ON_ERROR_STOP on

TRUNCATE vc.incognito_pref, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_def boolean;
BEGIN
    SELECT vc.get_incognito_pref(1) INTO v_def;
    IF v_def IS NOT FALSE THEN
        RAISE EXCEPTION 'missing pref must default to false, got %', v_def;
    END IF;

    IF vc.update_incognito_pref(1, true) IS NOT TRUE THEN
        RAISE EXCEPTION 'update to true must succeed';
    END IF;
    SELECT vc.get_incognito_pref(1) INTO v_def;
    IF v_def IS NOT TRUE THEN
        RAISE EXCEPTION 'pref not written, got %', v_def;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.update_incognito_pref(1, false);
        RAISE EXCEPTION 'update must reject an owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%update must reject an owner mismatch%' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM vc.get_incognito_pref(1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed get_incognito_pref';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
