-- TASK-0153 V16: revoke broad DML on business state tables from runtime roles,
-- and correct any dangerous pre-existing role attributes (LOGIN / BYPASSRLS)
-- so the migration fails closed instead of silently inheriting them.
--
-- P1-05 (runtime roles could direct-write business state, bypassing the
-- SECURITY DEFINER state-machine functions) and P2-29 (V1 only created roles
-- when absent, never correcting pre-set LOGIN/BYPASSRLS attributes) are both
-- closed here. After V16 a runtime role can only:
--   * SELECT from business state tables (read path stays owner-scoped via RLS),
--   * call the窄 SECURITY DEFINER functions that own every state transition.
--
-- This migration ONLY revokes privileges and corrects role attributes; it does
-- not alter RLS policies, table structure, or any SECURITY DEFINER function.
-- Existing V1..V15 migrations are untouched (migration history checksum integrity).
-- SQL tests under infra/db/tests run as the PostgreSQL superuser (postgres),
-- which bypasses all privilege checks, so fixture INSERTs are unaffected.

-- ---------------------------------------------------------------------------
-- 1. Correct dangerous role attributes (P2-29). ALTER ROLE is idempotent: a
--    role that already has NOBYPASSRLS NOLOGIN is unchanged; a role that was
--    pre-polluted with LOGIN and/or BYPASSRLS is forced back to the safe
--    baseline. The subsequent DO block asserts the final state and raises a
--    hard error if any attribute could not be corrected (fail closed).
-- ---------------------------------------------------------------------------
ALTER ROLE vc_api           NOBYPASSRLS NOLOGIN;
ALTER ROLE vc_worker        NOBYPASSRLS NOLOGIN;
ALTER ROLE vc_job_coordinator NOBYPASSRLS NOLOGIN;
ALTER ROLE vc_dispatcher    NOBYPASSRLS NOLOGIN;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT rolname, rolbypassrls, rolcanlogin
        FROM pg_roles
        WHERE rolname IN ('vc_api','vc_worker','vc_job_coordinator','vc_dispatcher')
    LOOP
        IF r.rolbypassrls THEN
            RAISE EXCEPTION 'V16 fail-closed: role % still has BYPASSRLS after ALTER', r.rolname;
        END IF;
        IF r.rolcanlogin THEN
            RAISE EXCEPTION 'V16 fail-closed: role % still has LOGIN after ALTER', r.rolname;
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Revoke direct INSERT, UPDATE, DELETE on every business state table from
--    the four runtime roles (P1-05). SELECT is retained so read paths stay
--    owner-scoped through FORCE RLS. Every state transition must now go
--    through the窄 SECURITY DEFINER functions (claim_work_items, receive_
--    generation, finalize_generation, append_realtime_event, terminalize_
--    generation, record_provider_attempt, identity_*, etc.) which already
--    bind vc.owner_user_id from the server-trusted OwnerContext.
--
--    Tables covered (17):
--      V2 (10): vc_user, relationship, conversation, message, generation,
--               generation_route, generation_attempt, generation_candidate,
--               memory_item, memory_evidence
--      V3 ( 1): authorization_snapshot
--      V7 ( 4): generation_usage, quota_ledger_entry, realtime_event,
--               outbox_event
--      V8 ( 2): realtime_stream, realtime_ticket
--      V15( 1): provider_attempt
--
--    REVOKE is idempotent: revoking a privilege the role lacks is a no-op.
--    provider_deployment (V4) is intentionally excluded: it is already
--    tightened (SELECT to all, INSERT/UPDATE only to vc_job_coordinator).
--    work_item (V5) and identity_* (V14) are already tightened.
-- ---------------------------------------------------------------------------

-- V2 user-domain tables (10).
REVOKE INSERT, UPDATE, DELETE ON vc.vc_user
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.relationship
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.conversation
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.message
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.generation
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.generation_route
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.generation_attempt
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.generation_candidate
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.memory_item
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.memory_evidence
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- V3 authorization snapshot (1).
REVOKE INSERT, UPDATE, DELETE ON vc.authorization_snapshot
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- V7 finalize/usage/quota/outbox tables (4).
REVOKE INSERT, UPDATE, DELETE ON vc.generation_usage
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.quota_ledger_entry
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.realtime_event
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.outbox_event
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- V8 realtime stream/ticket tables (2).
REVOKE INSERT, UPDATE, DELETE ON vc.realtime_stream
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE ON vc.realtime_ticket
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- V15 provider_attempt audit table (1). V15 granted SELECT, INSERT, UPDATE;
-- revoke the write privileges, keep SELECT and the sequence USAGE so the
-- record_provider_attempt SECURITY DEFINER function still works.
REVOKE INSERT, UPDATE ON vc.provider_attempt
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
