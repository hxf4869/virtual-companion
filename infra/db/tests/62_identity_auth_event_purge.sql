-- 62_identity_auth_event_purge: V22 adds a SECURITY DEFINER retention purge
-- for the append-only identity_auth_event audit trail (V14). vc_api has no
-- table-level DML on the audit table (V14 REVOKE ALL -- not even SELECT); it
-- gains only EXECUTE on vc.identity_auth_event_purge(timestamptz), whose fixed
-- body deletes solely by occurred_at age. This test proves the purge deletes
-- events older than the cutoff while keeping recent ones, returns the removed
-- count, is idempotent, and that vc_api still cannot DELETE directly from the
-- table (the SECURITY DEFINER boundary is the only deletion path).

\set ON_ERROR_STOP on

-- Clean slate (superuser fixture setup). identity_auth_event.account_id has no
-- FK constraint and is nullable, so fixture rows can be inserted directly.
TRUNCATE vc.identity_auth_event;

-- Two events well past the 180-day retention window, two within it. occurred_at
-- is the only column the purge inspects.
INSERT INTO vc.identity_auth_event(event_type, account_id, username, occurred_at) VALUES
    ('LOGIN_FAILURE', NULL, 'old-a', now() - interval '200 days'),
    ('LOGIN_SUCCESS', NULL, 'old-b', now() - interval '190 days'),
    ('LOGIN_SUCCESS', NULL, 'recent-c', now() - interval '10 days'),
    ('LOGOUT',        NULL, 'recent-d', now());

-- Become the runtime application role: it may EXECUTE the purge function but
-- holds no table-level DML (SELECT included) on the audit table.
SET ROLE vc_api;

-- Positive: the purge runs as vc_api (EXECUTE on the SECURITY DEFINER function)
-- and reports exactly the two stale rows removed.
DO $$
DECLARE deleted int;
BEGIN
    SELECT vc.identity_auth_event_purge(now() - interval '180 days') INTO deleted;
    IF deleted <> 2 THEN
        RAISE EXCEPTION 'purge should remove 2 stale rows, function returned %', deleted;
    END IF;
END $$;

-- Idempotency: re-running with the same cutoff removes nothing.
DO $$
DECLARE again int;
BEGIN
    SELECT vc.identity_auth_event_purge(now() - interval '180 days') INTO again;
    IF again <> 0 THEN
        RAISE EXCEPTION 'idempotent re-purge should remove 0 rows, got %', again;
    END IF;
END $$;

-- Negative: vc_api still cannot DELETE directly from the audit table. The
-- SECURITY DEFINER function is the sole deletion path; a direct DELETE must be
-- rejected at the privilege check. Wrapped so ON_ERROR_STOP does not abort.
DO $$
BEGIN
    DELETE FROM vc.identity_auth_event;
    RAISE EXCEPTION 'regression: vc_api direct DELETE on vc.identity_auth_event succeeded';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

RESET ROLE;

-- Table-state verification as superuser: the two stale rows are gone, the two
-- recent rows survive. (vc_api cannot SELECT the audit table, so this check
-- runs outside the runtime role.)
DO $$
DECLARE stale int; total int;
BEGIN
    SELECT count(*) INTO stale
      FROM vc.identity_auth_event
     WHERE occurred_at < now() - interval '180 days';
    IF stale <> 0 THEN
        RAISE EXCEPTION 'purge left % stale rows behind', stale;
    END IF;
    SELECT count(*) INTO total FROM vc.identity_auth_event;
    IF total <> 2 THEN
        RAISE EXCEPTION 'purge should keep 2 recent rows, % remain', total;
    END IF;
END $$;
