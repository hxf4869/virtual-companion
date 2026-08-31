-- 67_generation_external_attempt_completed_chain: 外部 provider 成功 SD 链（TASK-0177）。
--
-- 复用既有 SD 函数（V25 promote_generation / V20 record_provider_attempt /
-- V15 insert_generation_candidate / V7 finalize_generation，均已 GRANT vc_api），
-- 实证 generation 可经外部 provider 成功路径落为 COMPLETED——这正是
-- GenerationWorkItemHandler external SUCCEEDED 分支调用的同一序列：
--   CREATED →(promote) IN_PROGRESS
--           → record_provider_attempt(SUCCEEDED, reqSnap, execSnap)   -- INV-AUTH-001
--           → insert_generation_candidate(content)
--           → (promote) FINAL_REVIEW
--           → finalize_generation(content, provider_ref, real tokens, outbox=false)
--           → COMPLETED
--
-- authorization_snapshot 行由 superuser 预置（V16 撤销了 vc_api 对该表的
-- INSERT/UPDATE/DELETE；运行期 snapshot 创建需 create-snapshot SD 函数，留 TASK-0178）。
-- record_provider_attempt 是 SECURITY DEFINER 函数（postgres 拥有，GRANT vc_api），
-- 其内部 INSERT 绕过 vc_api 直写限制——与 provider_attempt 同模式。
--
-- 断言（superuser，vc_api 无 generation/provider_attempt/generation_usage 直查权限）：
--   1) generation.status = 'COMPLETED'，assistant_message_id 非空；
--   2) 该 generation 恰好 1 条 final assistant message（INV-GEN-002）；
--   3) provider_attempt 1 行：status='SUCCEEDED' + 双 snapshot id 绑定（INV-AUTH-001）；
--   4) generation_usage 1 行：真实 input/output token (>0) + 非空 provider_ref；
--   5) quota_ledger_entry 1 行 SETTLE。
--
-- 负向：record_provider_attempt 引用未知 snapshot_id → foreign_key_violation
-- （V20 composite FK）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.provider_attempt, vc.generation_usage,
         vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- superuser 预置 dual authorization snapshot（requested + execution，同 provider/
-- region/contract/purpose，requested.data_categories ⊇ execution's）。运行期等价
-- 写入需 TASK-0178 的 create_authorization_snapshots SD 函数（V16 后 vc_api 不可直写）。
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-67-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-67-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

-- ---------------------------------------------------------------------------
-- 正向：external provider 成功 COMPLETED 全链（vc_api SD 调用）。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel        bigint;
    v_conv       bigint;
    v_gen        bigint;
    v_attempt    bigint;
    v_cand       bigint;
    v_st         text;
    v_final      boolean;
    v_content    text  := 'I hear you. Take a breath; there''s no rush.';
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);

    -- receive_generation 创建 generation(CREATED) + user message。
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-67', 'user', 'I had a rough day');

    -- CREATED → IN_PROGRESS。
    v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    IF v_st <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'promote IN_PROGRESS returned %', v_st;
    END IF;

    -- 记录真实外发 attempt，绑定双 snapshot（INV-AUTH-001；V20 7 参数版）。
    SELECT out_id INTO v_attempt
      FROM vc.record_provider_attempt(
        1, v_gen, 'alpha-loopback', 'alpha-supplier', 'SUCCEEDED',
        'snap-67-req', 'snap-67-exec');
    IF v_attempt IS NULL OR v_attempt <= 0 THEN
        RAISE EXCEPTION 'record_provider_attempt returned no id';
    END IF;

    -- 插入候选（真实模型输出）。
    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, v_content, false);
    IF v_cand IS NULL OR v_cand <= 0 THEN
        RAISE EXCEPTION 'insert_generation_candidate returned no id';
    END IF;

    -- IN_PROGRESS → FINAL_REVIEW。
    v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    IF v_st <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'promote FINAL_REVIEW returned %', v_st;
    END IF;

    -- finalize：真实 token、非空 provider_ref、outbox=false（memory legacy runtime 域未接，避免悬挂 outbox）。
    SELECT out_finalized INTO v_final
      FROM vc.finalize_generation(
        1, v_gen, v_cand, v_content, 'pa-' || v_attempt,
        42, 58, 0.001000, 'USD', 1, false, NULL);
    IF v_final IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize_generation did not finalize generation %', v_gen;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 断言（superuser）。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_gen       bigint;
    v_assistant bigint;
    n_msg       int;
    n_attempt   int;
    v_att_st    text;
    v_att_req   text;
    v_att_exec  text;
    n_usage     int;
    v_in_tok    bigint;
    v_out_tok   bigint;
    v_ref       text;
    n_quota     int;
BEGIN
    SELECT id INTO v_gen FROM vc.generation WHERE owner_user_id = 1 LIMIT 1;
    IF v_gen IS NULL THEN
        RAISE EXCEPTION 'no generation found for owner 1';
    END IF;

    SELECT status, assistant_message_id INTO v_att_st, v_assistant
      FROM vc.generation WHERE id = v_gen;
    IF v_att_st <> 'COMPLETED' THEN
        RAISE EXCEPTION 'expected COMPLETED, got %', v_att_st;
    END IF;
    IF v_assistant IS NULL THEN
        RAISE EXCEPTION 'assistant_message_id must be set after finalize';
    END IF;

    -- INV-GEN-002：恰好 1 条 final assistant message。
    SELECT count(*) INTO n_msg
      FROM vc.message
     WHERE owner_user_id = 1 AND generation_id = v_gen AND role = 'assistant';
    IF n_msg <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 final assistant message, got %', n_msg;
    END IF;

    -- INV-AUTH-001：provider_attempt 1 行，SUCCEEDED + 双 snapshot 绑定。
    SELECT count(*) INTO n_attempt
      FROM vc.provider_attempt WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_attempt <> 1 THEN
        RAISE EXCEPTION 'expected 1 provider_attempt row, got %', n_attempt;
    END IF;
    SELECT status, requested_authorization_snapshot, execution_authorization_snapshot
      INTO v_att_st, v_att_req, v_att_exec
      FROM vc.provider_attempt WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF v_att_st <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'expected provider_attempt status SUCCEEDED, got %', v_att_st;
    END IF;
    IF v_att_req IS DISTINCT FROM 'snap-67-req' OR v_att_exec IS DISTINCT FROM 'snap-67-exec' THEN
        RAISE EXCEPTION 'snapshot binding mismatch: req=% exec=%', v_att_req, v_att_exec;
    END IF;

    -- usage 1 行，真实 token + 非空 provider_ref。
    SELECT count(*), COALESCE(sum(input_tokens), -1), COALESCE(sum(output_tokens), -1),
           (array_agg(provider_ref))[1]
      INTO n_usage, v_in_tok, v_out_tok, v_ref
      FROM vc.generation_usage WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_usage <> 1 OR v_in_tok <> 42 OR v_out_tok <> 58 THEN
        RAISE EXCEPTION 'expected 1 usage row in=42 out=58, got rows=% in=% out=%',
            n_usage, v_in_tok, v_out_tok;
    END IF;
    IF v_ref IS NULL OR btrim(v_ref) = '' THEN
        RAISE EXCEPTION 'provider_ref must be non-empty for a real external attempt';
    END IF;

    -- quota SETTLE 1 行。
    SELECT count(*) INTO n_quota
      FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = v_gen AND kind = 'SETTLE';
    IF n_quota <> 1 THEN
        RAISE EXCEPTION 'expected 1 SETTLE quota row, got %', n_quota;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 负向：record_provider_attempt 引用未知 snapshot_id → composite FK 拒绝（V20）。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_gen bigint;
BEGIN
    SELECT id INTO v_gen FROM vc.generation WHERE owner_user_id = 1 LIMIT 1;
    BEGIN
        PERFORM * FROM vc.record_provider_attempt(
            1, v_gen, 'alpha-loopback', 'alpha-supplier', 'SUCCEEDED',
            'never-seen-req', 'never-seen-exec');
        RAISE EXCEPTION 'record_provider_attempt with unknown snapshots must fail';
    EXCEPTION WHEN foreign_key_violation THEN
        -- expected: composite FK (owner_user_id, snapshot_id) miss
    END;
END $$;
COMMIT;
RESET ROLE;
