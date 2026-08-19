-- 117_embedding_recall_degraded: EMBED-RECALL / DEGRADED-AI V62 —
-- deterministic embeddings, semantic recall and the entitled/actual pair.
--
-- Covers: upsert_memory_embedding is idempotent and validates the lineage
-- (only dimension 64, live memory required); semantic_recall returns only
-- same-space ACCEPTED non-deleted rows of the owner, cosine-ordered, and a
-- soft-deleted memory disappears; mint with a degraded actual class records
-- 应得 PREMIUM / 实际 ECONOMY while NULL keeps them equal; cross-owner
-- isolation and the vc_api-only grants hold.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_embedding, vc.trial_grant, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.quota_ledger_entry, vc.invite_code,
         vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

-- Seed: admin + alice (PREMIUM assignment) + bob; ids live in a temp map.
DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-embed', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-embed', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-embed', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;
    PERFORM vc.assign_service_class(v_admin, v_alice, 'PREMIUM');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true), (v_bob, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL), (v_bob, 1, 1, NULL);
    CREATE TEMP TABLE embed_owner(a bigint, b bigint) ON COMMIT PRESERVE ROWS;
    DELETE FROM embed_owner;
    INSERT INTO embed_owner VALUES (v_alice, v_bob);
END $$;

BEGIN;
SELECT set_config('embed.alice', (SELECT a::text FROM embed_owner), true),
       set_config('embed.bob', (SELECT b::text FROM embed_owner), true);
SELECT vc.set_owner_context(current_setting('embed.alice')::bigint, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('embed.alice') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint := current_setting('embed.alice')::bigint;
    v_rel   bigint := 1;
    v_mem1  bigint;
    v_mem2  bigint;
    v_mem3  bigint;
    n       int;
    v_id    bigint;
    v_sum   text;
    v_cls   text;
    v_ent   text;
    v_act   text;
BEGIN
    SELECT vc.create_memory_candidate(
        v_alice, v_rel, 'RELATIONSHIP', '喜欢安静的晚上', NULL, ARRAY[]::text[])
      INTO v_mem1;
    SELECT vc.create_memory_candidate(
        v_alice, v_rel, 'RELATIONSHIP', '周五有项目汇报', NULL, ARRAY[]::text[])
      INTO v_mem2;
    SELECT vc.create_memory_candidate(
        v_alice, v_rel, 'RELATIONSHIP', '完全无关的一条', NULL, ARRAY[]::text[])
      INTO v_mem3;
    PERFORM vc.confirm_memory_candidate(v_alice, v_mem1);
    PERFORM vc.confirm_memory_candidate(v_alice, v_mem2);
    PERFORM vc.confirm_memory_candidate(v_alice, v_mem3);

    -- Upsert is idempotent; only dimension 64 is registered.
    PERFORM vc.upsert_memory_embedding(
        v_alice, v_mem1, 'deterministic-hash', '1', 64, 'alpha-hash-64',
        '[0.9,0.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]');
    PERFORM vc.upsert_memory_embedding(
        v_alice, v_mem1, 'deterministic-hash', '1', 64, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]');
    -- Idempotency is asserted after RESET ROLE (memory_embedding is SD-only).
    BEGIN
        PERFORM vc.upsert_memory_embedding(
            v_alice, v_mem2, 'deterministic-hash', '1', 128, 'alpha-hash-64', '[1]');
        RAISE EXCEPTION 'dimension 128 unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%dimension%' THEN RAISE; END IF;
    END;

    -- The nearest memory to the query vector surfaces first; a soft-deleted
    -- memory never appears; an unembedded memory never surfaces.
    PERFORM vc.upsert_memory_embedding(
        v_alice, v_mem3, 'deterministic-hash', '1', 64, 'alpha-hash-64',
        '[0.0,0.9,0.1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]');
    SELECT out_memory_id, out_summary INTO v_id, v_sum
      FROM vc.semantic_recall(v_alice, v_rel, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10)
     LIMIT 1;
    IF v_id <> v_mem1 OR v_sum <> '喜欢安静的晚上' THEN
        RAISE EXCEPTION 'nearest hit wrong: % / %', v_id, v_sum;
    END IF;

    PERFORM vc.delete_memory(v_alice, v_mem3);
    SELECT count(*) INTO n FROM vc.semantic_recall(v_alice, v_rel, 'alpha-hash-64',
        '[0.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10);
    IF n <> 1 THEN
        RAISE EXCEPTION 'soft-deleted memory must vanish from semantic recall (only mem1 left), got %', n;
    END IF;

    SELECT count(*) INTO n FROM vc.semantic_recall(v_alice, v_rel, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10);
    IF n <> 1 THEN
        RAISE EXCEPTION 'only embedded memories surface, got %', n;
    END IF;

    -- DEGRADED-AI: NULL actual keeps 应得==实际 at PREMIUM; an explicit
    -- lower actual records PREMIUM/ECONOMY and the router consumes ECONOMY.
    SELECT generation_id INTO v_id
      FROM vc.receive_generation(v_alice, 1, 'embed-key-1', 'user', 'hello');
    SELECT out_service_class, out_entitled_service_class, out_actual_service_class
      INTO v_cls, v_ent, v_act
      FROM vc.mint_entitlement_snapshot(v_alice, v_id, false);
    IF v_cls <> 'PREMIUM' OR v_ent <> 'PREMIUM' OR v_act <> 'PREMIUM' THEN
        RAISE EXCEPTION 'undegraded mint wrong: %/%/%', v_cls, v_ent, v_act;
    END IF;

    SELECT generation_id INTO v_id
      FROM vc.receive_generation(v_alice, 1, 'embed-key-2', 'user', 'again');
    SELECT out_service_class, out_entitled_service_class, out_actual_service_class
      INTO v_cls, v_ent, v_act
      FROM vc.mint_entitlement_snapshot(v_alice, v_id, true);
    IF v_cls <> 'ECONOMY' OR v_ent <> 'PREMIUM' OR v_act <> 'ECONOMY' THEN
        RAISE EXCEPTION 'degraded mint wrong: %/%/%', v_cls, v_ent, v_act;
    END IF;
END $$;
RESET ROLE;

-- Idempotency + row count asserted as the test role (direct read is fine
-- outside any SET ROLE; the table is SD-only for runtime roles).
DO $$
DECLARE
    v_alice bigint := (SELECT a FROM embed_owner);
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.memory_embedding WHERE owner_user_id = v_alice;
    IF n <> 2 THEN
        RAISE EXCEPTION 'two embedded memories expected (mem1 idempotent + mem3), got %', n;
    END IF;
END $$;

BEGIN;
SELECT set_config('embed.alice', (SELECT a::text FROM embed_owner), true),
       set_config('embed.bob', (SELECT b::text FROM embed_owner), true);
SELECT vc.set_owner_context(current_setting('embed.bob')::bigint, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('embed.bob') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_bob bigint := current_setting('embed.bob')::bigint;
    n     int;
BEGIN
    -- Cross-owner: bob sees none of alice's vectors, and a foreign upsert
    -- fails the live-memory check.
    SELECT count(*) INTO n FROM vc.semantic_recall(v_bob, 1, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10);
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner must not see alice vectors, got %', n;
    END IF;
    BEGIN
        PERFORM vc.upsert_memory_embedding(
            v_bob, current_setting('embed.alice')::bigint, 'deterministic-hash', '1', 64,
            'alpha-hash-64',
            '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]');
        RAISE EXCEPTION 'foreign memory embedding unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%absent or deleted%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;

BEGIN;
SELECT set_config('embed.alice', (SELECT a::text FROM embed_owner), true);
SELECT vc.set_owner_context(current_setting('embed.alice')::bigint, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('embed.alice') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.semantic_recall(current_setting('embed.alice')::bigint, 1, 'alpha-hash-64',
        '[1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0]', 10);
    RAISE EXCEPTION 'vc_worker unexpectedly executed semantic_recall';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
