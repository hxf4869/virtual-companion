-- go_memorycore_clarification is owner-scoped and not executable by PUBLIC.
\set ON_ERROR_STOP on
DO $$
BEGIN
    IF has_function_privilege('public', 'vc.go_memorycore_clarification(bigint,bigint,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public can execute clarification';
    END IF;
    IF NOT has_function_privilege('vc_api', 'vc.go_memorycore_clarification(bigint,bigint,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api cannot execute clarification';
    END IF;
    IF NOT has_function_privilege('vc_worker', 'vc.go_memorycore_clarification(bigint,bigint,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker cannot execute clarification';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.go_memorycore_clarification(1, 1, 'token', 'fence', '明天晚上提醒我带书。');
    RAISE EXCEPTION 'clarification ran without owner context';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'clarification ran without owner context' THEN
        RAISE;
    END IF;
END $$;
COMMIT;
