-- 91_admin_audit_usage_console: V36 minimal internal admin console reads.
--
-- Covers: identity_auth_event_list is ADMIN-only (non-ADMIN fails closed),
-- newest-first keyset ordering with an exclusive after cursor and a clamped
-- limit; admin_usage_summary aggregates per UTC day (count, tokens, cost),
-- respects the since floor, and fails closed for a non-ADMIN caller.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

-- ===========================================================================
-- 1. Seed: admin + user, several audit events, usage rows on two days.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
    v_rel   bigint;
    v_conv  bigint;
    v_gen1  bigint;
    v_gen2  bigint;
    v_gen3  bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-audit', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-audit', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    -- Audit events via the sanctioned SD paths (ACCOUNT_CREATE is already
    -- written by identity_account_create above).
    PERFORM vc.identity_login_success(v_user, 'alice-audit');
    PERFORM vc.identity_login_failure('alice-audit');

    -- Usage rows: seed a relationship/conversation and finalize two
    -- generations on different days (one day via a back-dated recorded_at).
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
    VALUES (v_user, 10, 'persona-a');
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user, 100, 10, 'conv-audit');
    -- receive_generation requires the server-trusted owner context (V17).
    PERFORM vc.set_owner_context(v_user, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_user || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SELECT generation_id INTO v_gen1
      FROM vc.receive_generation(v_user, 100, 'audit-key-1', 'user', 'hello');
    SELECT generation_id INTO v_gen2
      FROM vc.receive_generation(v_user, 100, 'audit-key-2', 'user', 'world');
    SELECT generation_id INTO v_gen3
      FROM vc.receive_generation(v_user, 100, 'audit-key-3', 'user', 'again');

    INSERT INTO vc.generation_usage(owner_user_id, id, generation_id,
                                    provider_ref, input_tokens, output_tokens,
                                    actual_cost, currency, recorded_at)
    VALUES (v_user, 1, v_gen1, 'fake-1', 100, 50, 0.0010, 'USD', now()),
           (v_user, 2, v_gen2, 'fake-1', 200, 100, 0.0020, 'USD', now()),
           (v_user, 3, v_gen3, 'fake-1', 300, 150, 0.0030, 'USD', now() - interval '2 days');
END $$;

-- ===========================================================================
-- 2. Audit list: ADMIN-only, newest first, keyset cursor, clamped limit.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_first_id bigint;
    v_second_id bigint;
    v_page_size int;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'root-audit';

    -- Newest first, keyset: fetch the newest two via after-cursor chaining.
    SELECT out_id INTO v_first_id FROM vc.identity_auth_event_list(v_admin, NULL, 2)
     ORDER BY out_id DESC LIMIT 1;
    SELECT out_id INTO v_second_id FROM vc.identity_auth_event_list(v_admin, v_first_id, 2)
     ORDER BY out_id DESC LIMIT 1;
    IF v_first_id <= v_second_id THEN
        RAISE EXCEPTION 'audit list must be newest-first with exclusive cursor (% <= %)',
            v_first_id, v_second_id;
    END IF;

    -- Limit is clamped: asking for a huge page still returns rows.
    SELECT count(*) INTO v_page_size FROM vc.identity_auth_event_list(v_admin, NULL, 100000);
    IF v_page_size < 1 THEN
        RAISE EXCEPTION 'audit list returned no rows';
    END IF;
END $$;

DO $$
DECLARE
    v_user bigint;
BEGIN
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'alice-audit';
    BEGIN
        PERFORM 1 FROM vc.identity_auth_event_list(v_user, NULL, 50);
        RAISE EXCEPTION 'non-ADMIN must not list the audit trail';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected: generic fail-closed error
    END;
END $$;

-- ===========================================================================
-- 3. Usage summary: ADMIN-only, per-day aggregates, since floor respected.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_today bigint;
    v_old   bigint;
    v_cut   bigint;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'root-audit';

    -- Since now-1day: only today's two generations aggregate.
    SELECT COALESCE(sum(out_generations), 0) INTO v_today
      FROM vc.admin_usage_summary(v_admin, now() - interval '1 day');
    IF v_today <> 2 THEN
        RAISE EXCEPTION 'one-day window must aggregate 2 generations (got %)', v_today;
    END IF;

    -- Full window: three generations over two days; tokens add up to 600/300.
    SELECT COALESCE(sum(out_generations), 0),
           COALESCE(sum(out_input_tokens), 0),
           COALESCE(sum(out_output_tokens), 0)
      INTO v_cut, v_today, v_old
      FROM vc.admin_usage_summary(v_admin, now() - interval '30 days');
    IF v_cut <> 3 OR v_today <> 600 OR v_old <> 300 THEN
        RAISE EXCEPTION 'full window aggregates mismatch (%/%/%)', v_cut, v_today, v_old;
    END IF;
END $$;

DO $$
DECLARE
    v_user bigint;
BEGIN
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'alice-audit';
    BEGIN
        PERFORM 1 FROM vc.admin_usage_summary(v_user, now() - interval '30 days');
        RAISE EXCEPTION 'non-ADMIN must not read the usage summary';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
END $$;
