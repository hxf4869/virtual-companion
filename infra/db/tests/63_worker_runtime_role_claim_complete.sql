-- 63_worker_runtime_role_claim_complete: P1-04 worker 半边 DB 语义（TASK-0171）。
--
-- V23 后 runtime 角色 vc_api 获得 claim 家族 EXECUTE（同进程 worker 复用 authDataSource
-- 连接池）。本测试实证：
--   1) 正测：vc_api 在 server-trusted owner context（模拟 OwnerContext.asOwner 建立的
--      事务级 SET LOCAL vc.owner_user_id）内，同一事务完成 claim → complete 全链路
--      （状态终态以 superuser 验证——vc_api 无 work_item 表 SELECT，V5 只授 vc_worker；
--      这正是权限边界本身）；
--   2) 负测：vc_api 无 context 调用 claim_work_items → V17 断言 RAISE（fail-closed）；
--   3) 负测：claim 事务结束后（transaction-local context 已清）迟到 complete → 0 行
--      （INV-WORKER-001 迟到写拒绝——worker 必须在 asOwner 单事务内完成全部终态写入）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL),
    (1, 2, 'GENERATION', 11, NULL);

-- ---------------------------------------------------------------------------
-- 1) 正测：vc_api 在 server-trusted context 内同事务 claim → complete 全链路。
--    一次 claim_work_items 调用签发一个整批共享 token（V5 语义），complete 一次
--    即终态化整个批次（返回批大小）。验证只经函数返回值，不查 work_item 表
--    （vc_api 无表 SELECT，V5 只授 vc_worker——权限边界本身即是预期）。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE tokens text[]; rows int;
BEGIN
    SELECT array_agg(claim_token ORDER BY id)
      INTO tokens
      FROM vc.claim_work_items(1, 'FENCE-A', 30, 16);
    IF tokens IS NULL OR array_length(tokens, 1) <> 2 THEN
        RAISE EXCEPTION 'expected 2 claimed tokens, got %', array_length(tokens, 1);
    END IF;
    IF tokens[1] IS DISTINCT FROM tokens[2] THEN
        RAISE EXCEPTION 'one claim call must share a single batch token';
    END IF;
    rows := vc.complete_work_item(tokens[1]);
    IF rows <> 2 THEN
        RAISE EXCEPTION 'complete batch expected 2 rows, got %', rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.work_item WHERE status = 'DONE';
    IF n <> 2 THEN
        RAISE EXCEPTION 'expected 2 DONE items, got %', n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 负测：vc_api 无 context 调用 claim_work_items → V17 RAISE（fail-closed）。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM * FROM vc.claim_work_items(1, 'FENCE-B', 30, 16);
        RAISE EXCEPTION 'claim without server-trusted context should be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF position('server-trusted' in SQLERRM) = 0
           AND position('current_owner_id' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'claim without context: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) 负测：claim 事务提交后（transaction-local GUC 已清）迟到 complete → 0 行。
--    token 经临时表跨事务传递（vc_api 只写自身 pg_temp，不触 work_item 表）。
-- ---------------------------------------------------------------------------
TRUNCATE vc.work_item CASCADE;
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 3, 'GENERATION', 30, NULL);

SET ROLE vc_api;
CREATE TEMP TABLE claimed_token(token text) ON COMMIT PRESERVE ROWS;
RESET ROLE;
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
INSERT INTO claimed_token
    SELECT claim_token
      FROM vc.claim_work_items(1, 'FENCE-C', 30, 16)
     WHERE id = 3;
COMMIT;
-- 事务已结束：vc.owner_user_id / vc.job_fence 已自动清除，迟到 complete 必须零写入。
DO $$
DECLARE token text; rows int;
BEGIN
    SELECT c.token INTO token FROM claimed_token c;
    IF token IS NULL THEN
        RAISE EXCEPTION 'expected one claimed token after commit';
    END IF;
    rows := vc.complete_work_item(token);
    IF rows <> 0 THEN
        RAISE EXCEPTION 'late complete must write 0 rows, got %', rows;
    END IF;
END $$;
RESET ROLE;
DROP TABLE claimed_token;
