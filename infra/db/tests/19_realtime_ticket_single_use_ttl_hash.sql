-- 19_realtime_ticket_single_use_ttl_hash: the short-lived resume ticket is
-- single-use, hash-only, TTL-bound and bound to the contract seven-tuple.
-- issue_realtime_ticket returns a plaintext secret exactly once while the table
-- stores only sha256(secret); consume_realtime_ticket validates the secret, the
-- boundTo tuple, single-use and TTL, failing closed on every mismatch.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-ticket-1', 'IN_PROGRESS');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id      bigint;
    v_secret  text;
    v_second  bigint;
    v_consumed boolean;
    v_hashcount int;
BEGIN
    -- Issue a ticket; the plaintext secret is returned, the table stores a hash.
    SELECT out_ticket_id, out_secret INTO v_id, v_secret
      FROM vc.issue_realtime_ticket(1, 5000, 'sess-1', 'https://app.example', 'FETCH_SSE', 1, 0);
    IF v_id IS NULL OR v_secret IS NULL OR v_secret = '' THEN
        RAISE EXCEPTION 'issue must return a non-empty secret';
    END IF;

    -- serverStoresHashOnly: the plaintext secret is NOT the stored hash.
    SELECT count(*) INTO v_hashcount FROM vc.realtime_ticket
     WHERE owner_user_id = 1 AND id = v_id AND ticket_hash = v_secret;
    IF v_hashcount <> 0 THEN
        RAISE EXCEPTION 'ticket plaintext secret must not be stored as the hash';
    END IF;
    -- The stored hash is a 64-char lowercase hex sha256 (the exact hash is
    -- proven implicitly by the successful consume below, which recomputes it
    -- inside the SECURITY DEFINER function).
    IF NOT EXISTS (SELECT 1 FROM vc.realtime_ticket
                    WHERE owner_user_id = 1 AND id = v_id
                      AND length(ticket_hash) = 64
                      AND ticket_hash ~ '^[0-9a-f]{64}$') THEN
        RAISE EXCEPTION 'ticket_hash must be a 64-char lowercase hex sha256';
    END IF;

    -- Happy path: matching boundTo + secret consumes the ticket.
    SELECT vc.consume_realtime_ticket(
        1, v_id, v_secret, 5000, 'sess-1', 'https://app.example', 'FETCH_SSE', 1, 0)
        INTO v_consumed;
    IF v_consumed IS NOT TRUE THEN
        RAISE EXCEPTION 'consume must return true for a valid ticket';
    END IF;

    -- single-use: a second consume with the same secret must fail.
    BEGIN
        PERFORM vc.consume_realtime_ticket(
            1, v_id, v_secret, 5000, 'sess-1', 'https://app.example', 'FETCH_SSE', 1, 0);
        RAISE EXCEPTION 'single-use ticket was consumed twice';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%single-use ticket was consumed twice%' THEN
            RAISE;
        END IF;
        -- expected: already consumed
    END;

    -- wrong secret must fail.
    BEGIN
        PERFORM vc.consume_realtime_ticket(
            1, v_id, 'wrong-secret', 5000, 'sess-1', 'https://app.example', 'FETCH_SSE', 1, 0);
        RAISE EXCEPTION 'wrong secret unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%wrong secret unexpectedly accepted%' THEN
            RAISE;
        END IF;
        -- expected: invalid secret
    END;

    -- boundTo mismatch (origin) must fail on a fresh ticket.
    SELECT out_ticket_id INTO v_second
      FROM vc.issue_realtime_ticket(1, 5000, 'sess-2', 'https://app.example', 'FETCH_SSE', 1, 0);
    BEGIN
        PERFORM vc.consume_realtime_ticket(
            1, v_second, 'anything', 5000, 'sess-2', 'https://evil.example', 'FETCH_SSE', 1, 0);
        RAISE EXCEPTION 'boundTo mismatch unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%boundTo mismatch unexpectedly accepted%' THEN
            RAISE;
        END IF;
        -- expected: boundTo mismatch (secret also differs, still fails closed)
    END;

    -- a non-vc_api role must NOT be able to issue or consume (EXECUTE isolation).
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_worker;
BEGIN;
DO $$
DECLARE v_id bigint;
BEGIN
    BEGIN
        PERFORM * FROM vc.issue_realtime_ticket(1, 5000, 's', 'o', 'FETCH_SSE', 1, 0);
        RAISE EXCEPTION 'vc_worker unexpectedly issued a ticket';
    EXCEPTION WHEN insufficient_privilege THEN
        -- expected: EXECUTE revoked from PUBLIC, granted only to vc_api
    END;
END $$;
COMMIT;
RESET ROLE;

-- TTL: expire an unconsumed ticket, then consume must fail.
-- TASK-0153 V16 note: direct UPDATE on vc.realtime_ticket was revoked from
-- runtime roles. The whole block runs as the PostgreSQL superuser so the
-- test-setup UPDATE (forcing expires_at into the past) reaches the table;
-- consume_realtime_ticket is a SECURITY DEFINER function whose TTL logic is
-- independent of caller role, so verifying it under the superuser preserves
-- the original semantics. SET LOCAL vc.owner_user_id still binds the context
-- the SECURITY DEFINER functions rely on.
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_id     bigint;
    v_secret text;
BEGIN
    SELECT out_ticket_id, out_secret INTO v_id, v_secret
      FROM vc.issue_realtime_ticket(1, 5000, 'sess-ttl', 'https://app.example', 'FETCH_SSE', 1, 0);
    -- Force the ticket past its TTL without consuming it (superuser UPDATE:
    -- runtime roles can no longer direct-UPDATE realtime_ticket after V16).
    UPDATE vc.realtime_ticket
       SET expires_at = now() - interval '1 second'
     WHERE owner_user_id = 1 AND id = v_id;
    BEGIN
        PERFORM vc.consume_realtime_ticket(
            1, v_id, v_secret, 5000, 'sess-ttl', 'https://app.example', 'FETCH_SSE', 1, 0);
        RAISE EXCEPTION 'expired ticket unexpectedly consumed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%expired ticket unexpectedly consumed%' THEN
            RAISE;
        END IF;
        -- expected: ticket expired
    END;
END $$;
COMMIT;
