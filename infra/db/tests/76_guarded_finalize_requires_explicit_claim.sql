-- 76_guarded_finalize_requires_explicit_claim: 显式 claim guard（非 GUC）（TASK-0194）。
--
-- V28 assert_active_claim(owner, work_item_id, claim_token, claim_fence) 是业务写
-- （candidate/promote/finalize/usage/quota/event + work-item complete）前的唯一授权
-- 断言，逐 work item 校验：仍 CLAIMED、token/fence 精确匹配（显式参数）、
-- lease_expires_at > clock_timestamp()。本测试实证：
--   1) 无 claim（仅 server-trusted owner context）→ RAISE（GUC-only 不是授权）；
--   2) 有 claim 但错误 token → RAISE；
--   3) 有 claim、正确 token 但错误 fence 参数 → RAISE——即使同一事务内
--      vc.job_fence GUC 恰为正确值（claim_work_items 刚设置），guard 也不读取 GUC，
--      只认显式参数（运行时角色可自行 SET GUC，故 GUC 不得充当 active-claim 授权）；
--   4) 正确 token+fence → 通过（void）；
--   5) 负向场景全部零业务写入（item 保持 CLAIMED）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL);

-- ---------------------------------------------------------------------------
-- 1) 无 claim：context 存在但 work item 从未 CLAIMED → RAISE。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.assert_active_claim(1, 1, 'TOK-X', 'FENCE-X');
        RAISE EXCEPTION 'assert_active_claim without a claim must fail';
    EXCEPTION WHEN OTHERS THEN
        IF position('not active' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2)-4) 同一事务：claim（设置 vc.job_fence='FENCE-76' 事务 GUC）→ 错误 token /
--        错误 fence 参数（GUC 正确也不被信任）/ 正确 token+fence。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_token text;
BEGIN
    -- claim 在本事务内执行：transaction-local vc.job_fence 现在 = 'FENCE-76'。
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-76', 30, 16)
     WHERE id = 1;
    IF v_token IS NULL THEN
        RAISE EXCEPTION 'claim must return a token';
    END IF;

    -- 错误 token。
    BEGIN
        PERFORM vc.assert_active_claim(1, 1, 'WRONG-TOKEN', 'FENCE-76');
        RAISE EXCEPTION 'wrong token must fail the guard';
    EXCEPTION WHEN OTHERS THEN
        IF position('not active' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;

    -- 错误 fence 参数：vc.job_fence GUC 恰为正确值 'FENCE-76'，但 guard 只认显式参数。
    BEGIN
        PERFORM vc.assert_active_claim(1, 1, v_token, 'WRONG-FENCE');
        RAISE EXCEPTION 'wrong fence must fail the guard even when the GUC matches';
    EXCEPTION WHEN OTHERS THEN
        IF position('not active' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;

    -- 正确 token+fence → 通过。
    PERFORM vc.assert_active_claim(1, 1, v_token, 'FENCE-76');
END $$;
COMMIT;
RESET ROLE;

-- 终态：item 仍 CLAIMED（负向场景零写入）。
DO $$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM vc.work_item WHERE id = 1;
    IF v_status <> 'CLAIMED' THEN
        RAISE EXCEPTION 'guarded negative paths must not write, got %', v_status;
    END IF;
END $$;
