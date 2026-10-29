-- go_memorycore_rebind and memory_forget_profile_gate are owner-scoped and not executable by PUBLIC.
\set ON_ERROR_STOP on
DO $$
BEGIN
    IF has_function_privilege('public', 'vc.go_memorycore_rebind(bigint,bigint,text,text,text,text,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public can execute rebind';
    END IF;
    IF NOT has_function_privilege('vc_api', 'vc.go_memorycore_rebind(bigint,bigint,text,text,text,text,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api cannot execute rebind';
    END IF;
    IF NOT has_function_privilege('vc_worker', 'vc.go_memorycore_rebind(bigint,bigint,text,text,text,text,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker cannot execute rebind';
    END IF;
    IF has_function_privilege('public', 'vc.memory_forget_profile_gate(bigint,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public can execute forget profile gate';
    END IF;
    IF NOT has_function_privilege('vc_api', 'vc.memory_forget_profile_gate(bigint,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api cannot execute forget profile gate';
    END IF;
    IF NOT has_function_privilege('vc_worker', 'vc.memory_forget_profile_gate(bigint,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker cannot execute forget profile gate';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.go_memorycore_rebind(1, 1, 'token', 'fence', 'job-1-r1-b1', '', 1);
    RAISE EXCEPTION 'rebind ran without owner context';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'rebind ran without owner context' THEN
        RAISE;
    END IF;
END $$;
DO $$
BEGIN
    PERFORM vc.memory_forget_profile_gate(1, 1);
    RAISE EXCEPTION 'forget profile gate ran without owner context';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'forget profile gate ran without owner context' THEN
        RAISE;
    END IF;
END $$;
COMMIT;
