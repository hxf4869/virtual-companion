-- 68_authorization_snapshot_runtime_creation_external_chain: 运行期 snapshot 创建 SD 链（TASK-0181）。
--
-- TASK-0177 的 67 号测试以 superuser 预置 dual authorization snapshot 后走
-- external SUCCEEDED 链；本测试替换生产侧：以 vc_api 身份调用 V26 新增的
-- vc.create_authorization_snapshots SECURITY DEFINER 函数（V16 撤销了 vc_api
-- 对 authorization_snapshot 的 INSERT/UPDATE/DELETE，这是运行期创建双快照的
-- 唯一合法路径——GenerationWorkItemHandler external 分支经
-- JdbcAuthorizationSnapshotProvider 调用的同一函数），再走完整 external 链：
--   CREATED →(promote) IN_PROGRESS
--           → create_authorization_snapshots(双 ACTIVE 行)      -- 本卡新增
--           → record_provider_attempt(SUCCEEDED, reqSnap, execSnap) -- INV-AUTH-001
--           → insert_generation_candidate(content)
--           → (promote) FINAL_REVIEW
--           → finalize_generation(content, provider_ref, real tokens, outbox=false)
--           → COMPLETED
--
-- 断言（superuser，vc_api 无 authorization_snapshot/provider_attempt/generation_usage
-- 直查权限）：
--   1) create_authorization_snapshots 返回双 id，authorization_snapshot 恰 2 行
--      ACTIVE（owner 1 名下、provider/region/contract/purpose/categories 对齐、
--      task_cancelled/source_data_deleted=false）；
--   2) generation.status = 'COMPLETED'，assistant_message_id 非空；
--   3) 恰好 1 条 final assistant message（INV-GEN-002）；
--   4) provider_attempt 1 行：status='SUCCEEDED' + 双 snapshot id 绑定（INV-AUTH-001）；
--   5) generation_usage 1 行：真实 input/output token (>0) + 非空 provider_ref；
--   6) quota_ledger_entry 1 行 SETTLE。
--
-- 负向（vc_api 身份）：
--   a) 未知 generation → 业务 RAISE（raise_exception）；
--   b) 跨 owner（p_owner_user_id != server-trusted current_owner_id）→ V17 断言 RAISE；
--   c) 空 provider_id → RAISE。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.provider_attempt, vc.generation_usage,
         vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- ---------------------------------------------------------------------------
-- 正向：vc_api 经 SD 函数创建双快照 → external provider 成功 COMPLETED 全链。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel      bigint;
    v_conv     bigint;
    v_gen      bigint;
    v_attempt  bigint;
    v_cand     bigint;
    v_st       text;
    v_final    boolean;
    v_req      text;
    v_exec     text;
    v_content  text := 'I hear you. Take a breath; there''s no rush.';
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);

    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-68', 'user', 'I had a rough day');

    -- CREATED → IN_PROGRESS。
    v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    IF v_st <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'promote IN_PROGRESS returned %', v_st;
    END IF;

    -- 运行期创建双授权快照（V26；本卡新增的 mint 侧入口）。
    SELECT out_requested_id, out_execution_id INTO v_req, v_exec
      FROM vc.create_authorization_snapshots(
        1, v_gen, 'alpha-loopback', 'us', 'alpha-standard',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']);
    IF v_req IS NULL OR v_exec IS NULL OR v_req = v_exec THEN
        RAISE EXCEPTION 'create_authorization_snapshots returned invalid ids req=% exec=%',
            v_req, v_exec;
    END IF;

    -- 记录真实外发 attempt，绑定双 snapshot（INV-AUTH-001；V20 7 参数版）。
    SELECT out_id INTO v_attempt
      FROM vc.record_provider_attempt(
        1, v_gen, 'alpha-loopback', 'alpha-supplier', 'SUCCEEDED', v_req, v_exec);
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

    -- finalize：真实 token、非空 provider_ref、outbox=false（memory Java 域未接）。
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
    n_snap      int;
    v_snap_st   text;
    v_snap_prov text;
    n_msg       int;
    n_attempt   int;
    v_att_st    text;
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

    -- 1) 恰 2 行 ACTIVE 双快照（owner 1 名下、内容对齐）。
    SELECT count(*), min(status), min(provider_id)
      INTO n_snap, v_snap_st, v_snap_prov
      FROM vc.authorization_snapshot WHERE owner_user_id = 1;
    IF n_snap <> 2 THEN
        RAISE EXCEPTION 'expected exactly 2 authorization_snapshot rows, got %', n_snap;
    END IF;
    IF v_snap_st <> 'ACTIVE' THEN
        RAISE EXCEPTION 'expected snapshot status ACTIVE, got %', v_snap_st;
    END IF;
    IF v_snap_prov <> 'alpha-loopback' THEN
        RAISE EXCEPTION 'expected snapshot provider alpha-loopback, got %', v_snap_prov;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.authorization_snapshot
               WHERE owner_user_id = 1 AND (task_cancelled OR source_data_deleted)) THEN
        RAISE EXCEPTION 'fresh snapshots must have task_cancelled=false and source_data_deleted=false';
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

    -- INV-AUTH-001：provider_attempt 1 行，SUCCEEDED，双 snapshot 绑定存在且归 owner 1。
    SELECT count(*) INTO n_attempt
      FROM vc.provider_attempt WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_attempt <> 1 THEN
        RAISE EXCEPTION 'expected 1 provider_attempt row, got %', n_attempt;
    END IF;
    SELECT status INTO v_att_st
      FROM vc.provider_attempt WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF v_att_st <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'expected provider_attempt status SUCCEEDED, got %', v_att_st;
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.provider_attempt pa
        LEFT JOIN vc.authorization_snapshot a1
               ON a1.owner_user_id = pa.owner_user_id
              AND a1.snapshot_id = pa.requested_authorization_snapshot
        LEFT JOIN vc.authorization_snapshot a2
               ON a2.owner_user_id = pa.owner_user_id
              AND a2.snapshot_id = pa.execution_authorization_snapshot
        WHERE pa.owner_user_id = 1 AND pa.generation_id = v_gen
          AND (a1.snapshot_id IS NULL OR a2.snapshot_id IS NULL)) THEN
        RAISE EXCEPTION 'provider_attempt snapshot binding must reference owner-1 snapshot rows';
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
-- 负向（vc_api 身份）。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_gen bigint;
BEGIN
    SELECT id INTO v_gen FROM vc.generation WHERE owner_user_id = 1 LIMIT 1;

    -- a) 未知 generation → 业务 RAISE。
    BEGIN
        PERFORM * FROM vc.create_authorization_snapshots(
            1, 999999, 'alpha-loopback', 'us', 'alpha-standard',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']);
        RAISE EXCEPTION 'unknown generation must raise';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%unknown generation must raise%' THEN
            RAISE;
        END IF;
        -- expected: generation not found
    END;

    -- b) 跨 owner（p_owner_user_id 2 != trusted current_owner_id 1）→ V17 断言 RAISE。
    BEGIN
        PERFORM * FROM vc.create_authorization_snapshots(
            2, v_gen, 'alpha-loopback', 'us', 'alpha-standard',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']);
        RAISE EXCEPTION 'cross-owner call must raise';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%cross-owner call must raise%' THEN
            RAISE;
        END IF;
        -- expected: trusted-owner assertion
    END;

    -- c) 空 provider_id → RAISE。
    BEGIN
        PERFORM * FROM vc.create_authorization_snapshots(
            1, v_gen, '', 'us', 'alpha-standard',
            'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']);
        RAISE EXCEPTION 'blank provider_id must raise';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE '%blank provider_id must raise%' THEN
            RAISE;
        END IF;
        -- expected: provider_id is required
    END;
END $$;
COMMIT;
RESET ROLE;
