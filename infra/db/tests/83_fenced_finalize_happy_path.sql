-- 83_fenced_finalize_happy_path: 显式 claim guard 下完整 happy path 原子完成（TASK-0194）。
--
-- 完整分段链路（与 GenerationWorkItemHandler 新流程一致）：
--   claim-tx → prepare-tx（intent CREATED）→ external-no-db（SQL 层以 outcome 更新
--   模拟）→ audit-outcome-tx（CREATED→SUCCEEDED）→ guarded-finalize-tx（assert +
--   candidate + FINAL_REVIEW + finalize(usage/quota/event) + per-item complete 同一事务）
--   → COMPLETED。
-- 断言：generation COMPLETED、恰 1 条 final assistant message（INV-GEN-002）、
-- provider_attempt 恰 1 行 SUCCEEDED（INV-AUTH-001）、usage 1 行真实 token、
-- quota SETTLE 1 行、work_item DONE；事务内任一失败则全部回滚（V7 fault 已由
-- 16/17/79 覆盖，此处为合法路径原子性）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation_usage,
         vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice-83', 'test-hash', 'USER', 'ACTIVE', 'alice');
UPDATE vc.release_gate SET stage='BETA', eval_passed=true,
    policy_version='test-policy-83', canary_owner_user_id=NULL WHERE id=1;
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-83-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-83-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE happy_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) claim-tx + prepare-tx（intent CREATED）+ audit-outcome-tx（SUCCEEDED）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_conv  bigint;
    v_gen   bigint;
    v_wi    bigint;
    v_token text;
    v_rows  int;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-83', 'user', 'I had a rough day');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);

    -- claim-tx。
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-83', 30, 16)
     WHERE id = v_wi;
    -- prepare-tx：promote + intent。
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    PERFORM * FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to('FENCE-83', 'UTF8'), 'sha256'), 'hex'),
        'pa-83-1', 'alpha-loopback', 'alpha-supplier', 'snap-83-req', 'snap-83-exec',
        'test-model', 'test-rev', 'test-prompt', 'test-persona', 'test-config');
    -- audit-outcome-tx。
    SELECT vc.record_attempt_outcome(1, 'pa-83-1', 'SUCCEEDED') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'outcome update must affect 1 row, got %', v_rows;
    END IF;
    INSERT INTO happy_ctx VALUES
        ('gen', v_gen::text), ('wi', v_wi::text), ('tok', v_token);
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) guarded-finalize-tx：assert + candidate + FINAL_REVIEW + finalize + per-item
--    complete 单事务原子完成。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen    bigint;
    v_wi     bigint;
    v_token  text;
    v_cand   bigint;
    v_st     text;
    v_final  boolean;
    v_rows   int;
    v_content text := 'I hear you. Take a breath; there''s no rush.';
BEGIN
    SELECT value::bigint INTO v_gen FROM happy_ctx WHERE key = 'gen';
    SELECT value::bigint INTO v_wi  FROM happy_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM happy_ctx WHERE key = 'tok';

    -- 显式 claim guard 是同一事务第一条业务语句（非 GUC 授权）。
    PERFORM vc.assert_active_claim(1, v_wi, v_token, 'FENCE-83');

    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, v_content, false);
    v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    IF v_st <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'promote FINAL_REVIEW returned %', v_st;
    END IF;
    SELECT out_finalized INTO v_final
      FROM vc.finalize_generation(
        1, v_gen, v_cand, v_content, 'pa-83-1',
        42, 58, 0.001000, 'USD', 1, false, NULL);
    IF v_final IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize_generation did not finalize';
    END IF;
    -- per-item complete 与 finalize 同事务（INV-TX-001 原子性扩展）。
    SELECT vc.complete_work_item(v_wi, v_token, 'FENCE-83') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'per-item complete must affect 1 row, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2) 终态断言（superuser）。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_gen  bigint;
    v_st   text;
    v_assistant bigint;
    n_msg  int;
    n_att  int;
    v_ast  text;
    n_use  int;
    v_in   bigint;
    v_out  bigint;
    n_quota int;
    v_ws   text;
BEGIN
    SELECT value::bigint INTO v_gen FROM happy_ctx WHERE key = 'gen';
    SELECT status, assistant_message_id INTO v_st, v_assistant
      FROM vc.generation WHERE id = v_gen;
    IF v_st <> 'COMPLETED' OR v_assistant IS NULL THEN
        RAISE EXCEPTION 'expected COMPLETED with assistant message, got %', v_st;
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
    SELECT count(*), COALESCE(sum(input_tokens), -1), COALESCE(sum(output_tokens), -1)
      INTO n_use, v_in, v_out
      FROM vc.generation_usage WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_use <> 1 OR v_in <> 42 OR v_out <> 58 THEN
        RAISE EXCEPTION 'expected 1 usage row in=42 out=58, got rows=% in=% out=%',
            n_use, v_in, v_out;
    END IF;
    SELECT count(*) INTO n_quota
      FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = v_gen AND kind = 'SETTLE';
    IF n_quota <> 1 THEN
        RAISE EXCEPTION 'expected 1 SETTLE quota row, got %', n_quota;
    END IF;
    SELECT status INTO v_ws
      FROM vc.work_item WHERE id = (SELECT value::bigint FROM happy_ctx WHERE key = 'wi');
    IF v_ws <> 'DONE' THEN
        RAISE EXCEPTION 'expected work item DONE, got %', v_ws;
    END IF;
END $$;

DROP TABLE happy_ctx;
