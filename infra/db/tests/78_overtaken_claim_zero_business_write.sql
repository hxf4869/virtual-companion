-- 78_overtaken_claim_zero_business_write: 被接管 claim 的旧 worker 零业务写（TASK-0194）。
--
-- 场景（矩阵 #6）：worker A claim 后 lease 墙钟过期（无 intent——崩溃于 outbound 前）；
-- coordinator recover → PENDING；worker B 重新 claim（新 token/fence）接管；A 迟到的
-- guarded finalize 用旧 token/fence → assert_active_claim RAISE → 零写；A 的 per-item
-- fail（旧 token/fence）→ 0 行（不误伤接管后的新 claim）；B 正常完成 guarded finalize
-- → COMPLETED + DONE。
-- 终态：generation COMPLETED 恰 1 条 final assistant message；work_item DONE；
-- provider_attempt 恰 1 行（B 的 intent，SUCCEEDED）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation_usage,
         vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice-78', 'test-hash', 'USER', 'ACTIVE', 'alice');
UPDATE vc.release_gate SET stage='BETA', eval_passed=true,
    policy_version='test-policy-78', canary_owner_user_id=NULL WHERE id=1;
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-78-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-78-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE over_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) fixture：generation + work item；A claim（无 intent）→ lease 过期 → recover → PENDING。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel  bigint;
    v_conv bigint;
    v_gen  bigint;
    v_wi   bigint;
    v_token text;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-78', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-78-A', 30, 16)
     WHERE id = v_wi;
    INSERT INTO over_ctx VALUES
        ('gen', v_gen::text), ('wi', v_wi::text), ('tok-a', v_token);
END $$;
COMMIT;
RESET ROLE;

-- A 的 lease 过期 → recover（无 intent → PENDING）。
UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 second'
 WHERE status = 'CLAIMED';
SET ROLE vc_api;
DO $$
DECLARE v_rec int;
BEGIN
    SELECT vc.recover_expired_claims() INTO v_rec;
    IF v_rec <> 1 THEN
        RAISE EXCEPTION 'recover must return the expired claim, got %', v_rec;
    END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) B 接管 claim（新 token/fence）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_wi     bigint;
    v_token_b text;
BEGIN
    SELECT value::bigint INTO v_wi FROM over_ctx WHERE key = 'wi';
    SELECT claim_token INTO v_token_b
      FROM vc.claim_work_items(1, 'FENCE-78-B', 30, 16)
     WHERE id = v_wi;
    IF v_token_b IS NULL THEN
        RAISE EXCEPTION 'takeover claim must succeed';
    END IF;
    INSERT INTO over_ctx VALUES ('tok-b', v_token_b);
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2) A（stale）迟到 guarded finalize：旧 token/fence → guard RAISE；per-item fail
--    旧 token → 0 行（不得误伤 B 的新 claim）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_wi    bigint;
    v_tok_a text;
    v_rows  int;
BEGIN
    SELECT value::bigint INTO v_wi FROM over_ctx WHERE key = 'wi';
    SELECT value INTO v_tok_a FROM over_ctx WHERE key = 'tok-a';

    BEGIN
        PERFORM vc.assert_active_claim(1, v_wi, v_tok_a, 'FENCE-78-A');
        RAISE EXCEPTION 'overtaken worker guard must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%overtaken worker guard must fail%' THEN
            RAISE;
        END IF;
        IF position('not active' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;

    SELECT vc.fail_work_item(v_wi, v_tok_a, 'FENCE-78-A') INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'overtaken worker fail must write 0 rows, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) B 正常 guarded finalize：assert(B) → intent → outcome → candidate/promote/
--    finalize/complete per-item（B）单事务原子完成。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen    bigint;
    v_wi     bigint;
    v_tok_b  text;
    v_cand   bigint;
    v_st     text;
    v_final  boolean;
    v_rows   int;
    v_content text := 'I hear you. Take a breath; there''s no rush.';
BEGIN
    SELECT value::bigint INTO v_gen FROM over_ctx WHERE key = 'gen';
    SELECT value::bigint INTO v_wi  FROM over_ctx WHERE key = 'wi';
    SELECT value INTO v_tok_b FROM over_ctx WHERE key = 'tok-b';

    PERFORM vc.assert_active_claim(1, v_wi, v_tok_b, 'FENCE-78-B');

    -- outbound 前 intent + outcome（prepare/audit 段）。
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    PERFORM * FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_tok_b, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to('FENCE-78-B', 'UTF8'), 'sha256'), 'hex'),
        'pa-78-b', 'alpha-loopback', 'alpha-supplier', 'snap-78-req', 'snap-78-exec',
        'test-model', 'test-rev', 'test-prompt', 'test-persona', 'test-config');
    SELECT vc.record_attempt_outcome(1, 'pa-78-b', 'SUCCEEDED') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'outcome update must affect 1 row, got %', v_rows;
    END IF;

    -- guarded finalize：candidate + FINAL_REVIEW + finalize + per-item complete。
    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, v_content, false);
    v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    IF v_st <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'promote FINAL_REVIEW returned %', v_st;
    END IF;
    SELECT out_finalized INTO v_final
      FROM vc.finalize_generation(
        1, v_gen, v_cand, v_content, 'pa-78-b',
        42, 58, 0.001000, 'USD', 1, false, NULL);
    IF v_final IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize_generation did not finalize';
    END IF;
    SELECT vc.complete_work_item(v_wi, v_tok_b, 'FENCE-78-B') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'per-item complete must affect 1 row, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 终态断言（superuser）：COMPLETED 恰 1 条 final message；work_item DONE；
-- provider_attempt 恰 1 行 SUCCEEDED（B）；usage/quota 各 1 行。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_gen  bigint;
    v_st   text;
    n_msg  int;
    n_att  int;
    v_ast  text;
    v_ws   text;
    n_use  int;
    n_quota int;
BEGIN
    SELECT id INTO v_gen FROM vc.generation WHERE owner_user_id = 1 LIMIT 1;
    SELECT status INTO v_st FROM vc.generation WHERE id = v_gen;
    IF v_st <> 'COMPLETED' THEN
        RAISE EXCEPTION 'expected COMPLETED, got %', v_st;
    END IF;
    SELECT count(*) INTO n_msg
      FROM vc.message WHERE owner_user_id = 1 AND generation_id = v_gen AND role = 'assistant';
    IF n_msg <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 final assistant message, got %', n_msg;
    END IF;
    SELECT count(*), max(status) INTO n_att, v_ast
      FROM vc.attempt_intent WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_att <> 1 OR v_ast <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'expected 1 SUCCEEDED attempt, got rows=% status=%', n_att, v_ast;
    END IF;
    SELECT status INTO v_ws FROM vc.work_item WHERE id = (SELECT value::bigint FROM over_ctx WHERE key = 'wi');
    IF v_ws <> 'DONE' THEN
        RAISE EXCEPTION 'expected work item DONE, got %', v_ws;
    END IF;
    SELECT count(*) INTO n_use FROM vc.generation_usage WHERE owner_user_id = 1 AND generation_id = v_gen;
    SELECT count(*) INTO n_quota
      FROM vc.quota_ledger_entry WHERE owner_user_id = 1 AND generation_id = v_gen AND kind = 'SETTLE';
    IF n_use <> 1 OR n_quota <> 1 THEN
        RAISE EXCEPTION 'expected 1 usage and 1 SETTLE row, got usage=% quota=%', n_use, n_quota;
    END IF;
END $$;

DROP TABLE over_ctx;
