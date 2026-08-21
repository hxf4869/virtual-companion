-- 79_external_audit_survives_finalize_rollback: 外发审计不随 finalize 回滚消失（TASK-0194）。
--
-- intent 在 outbound 前以独立短事务落库，outcome 在外发后以独立短事务更新同行。
-- 即使 guarded finalize 事务因故障（V7 pFault 注入）整体回滚：
--   1) provider_attempt（intent+outcome）已独立提交 → 仍存在（INV-AUTH-001 审计链）；
--   2) generation 未 COMPLETED、无 final assistant message（finalize 原子回滚）；
--   3) work_item 仍 CLAIMED；随后 independent-fail-tx（全新事务）per-item fail →
--      FAILED（矩阵 #8：aborted tx 后失败状态可靠落库，停止热循环）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation_usage,
         vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-79-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-79-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE audit_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) fixture：generation + work item + claim + intent + outcome（均独立提交）。
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
      FROM vc.receive_generation(1, v_conv, 'idem-79', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-79', 30, 16)
     WHERE id = v_wi;

    -- 段 1：prepare（intent）。
    PERFORM * FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to('FENCE-79', 'UTF8'), 'sha256'), 'hex'),
        'pa-79-1', 'alpha-loopback', 'alpha-supplier', 'snap-79-req', 'snap-79-exec');
    -- 段 2：audit outcome（外发后）。
    SELECT vc.record_attempt_outcome(1, 'pa-79-1', 'SUCCEEDED') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'outcome update must affect 1 row, got %', v_rows;
    END IF;
    INSERT INTO audit_ctx VALUES
        ('gen', v_gen::text), ('wi', v_wi::text), ('tok', v_token);

    -- 段 3（guarded finalize）：promote IN_PROGRESS 先行（同段 commit）。
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) guarded finalize 事务故障回滚（V7 pFault 注入）：assert 通过后 finalize RAISE。
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
    v_content text := 'final message must not survive the rollback';
BEGIN
    SELECT value::bigint INTO v_gen FROM audit_ctx WHERE key = 'gen';
    SELECT value::bigint INTO v_wi  FROM audit_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM audit_ctx WHERE key = 'tok';

    PERFORM vc.assert_active_claim(1, v_wi, v_token, 'FENCE-79');

    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, v_content, false);
    PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    -- pFault='fault-79'：finalize_generation 在原子写入前注入故障 → RAISE。
    BEGIN
        PERFORM * FROM vc.finalize_generation(
            1, v_gen, v_cand, v_content, 'pa-79-1',
            42, 58, 0.001000, 'USD', 1, false, 'fault-79');
        RAISE EXCEPTION 'fault injection must fail finalize';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%fault injection must fail finalize%' THEN
            RAISE;
        END IF;
        NULL; -- expected: finalize fault
    END;
END $$;
ROLLBACK;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2) 断言：审计已独立提交存活；finalize 整体回滚（generation 非 COMPLETED、
--    无 final message、work_item 仍 CLAIMED）。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_gen  bigint;
    v_st   text;
    n_att  int;
    v_ast  text;
    n_msg  int;
    v_ws   text;
BEGIN
    SELECT value::bigint INTO v_gen FROM audit_ctx WHERE key = 'gen';
    SELECT count(*), max(status) INTO n_att, v_ast
      FROM vc.attempt_intent WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_att <> 1 OR v_ast <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'audit (intent+outcome) must survive the finalize rollback, got rows=% status=%',
            n_att, v_ast;
    END IF;
    SELECT status INTO v_st FROM vc.generation WHERE id = v_gen;
    IF v_st = 'COMPLETED' THEN
        RAISE EXCEPTION 'finalize rollback must not leave the generation COMPLETED';
    END IF;
    SELECT count(*) INTO n_msg
      FROM vc.message WHERE owner_user_id = 1 AND generation_id = v_gen AND role = 'assistant';
    IF n_msg <> 0 THEN
        RAISE EXCEPTION 'finalize rollback must leave no final assistant message, got %', n_msg;
    END IF;
    SELECT status INTO v_ws
      FROM vc.work_item WHERE id = (SELECT value::bigint FROM audit_ctx WHERE key = 'wi');
    IF v_ws <> 'CLAIMED' THEN
        RAISE EXCEPTION 'work item must still be CLAIMED after the rollback, got %', v_ws;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) independent-fail-tx（全新事务）：仅 per-item fail 原 work item → FAILED。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_wi   bigint;
    v_token text;
    v_rows int;
BEGIN
    SELECT value::bigint INTO v_wi FROM audit_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM audit_ctx WHERE key = 'tok';
    SELECT vc.fail_work_item(v_wi, v_token, 'FENCE-79') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'independent per-item fail must terminalize the original item, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_ws text;
BEGIN
    SELECT status INTO v_ws
      FROM vc.work_item WHERE id = (SELECT value::bigint FROM audit_ctx WHERE key = 'wi');
    IF v_ws <> 'FAILED' THEN
        RAISE EXCEPTION 'independent fail must leave FAILED, got %', v_ws;
    END IF;
END $$;

DROP TABLE audit_ctx;
