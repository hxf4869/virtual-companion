-- 63_worker_runtime_role_claim_complete: P1-04 worker 半边 DB 语义（TASK-0171）。
--
-- V23 后 runtime 角色 vc_api 获得 claim 家族 EXECUTE（同进程 worker 复用 authDataSource
-- 连接池）。本测试实证：
--   1) 正测：vc_api 在 server-trusted owner context（模拟 OwnerContext.asOwner 建立的
--      事务级 SET LOCAL vc.owner_user_id）内，同一事务完成 claim → complete 全链路；
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
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
SELECT count(*) AS claimed FROM vc.claim_work_items(1, 'FENCE-A', 30, 16);
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.work_item WHERE status = 'CLAIMED';
    IF n <> 2 THEN
        RAISE EXCEPTION 'expected 2 CLAIMED items, got %', n;
    END IF;
END $$;
DO $$
DECLARE token text; rows int;
BEGIN
    SELECT claim_token INTO token FROM vc.work_item WHERE id = 1;
    rows := vc.complete_work_item(token);
    IF rows <> 1 THEN
        RAISE EXCEPTION 'complete id=1 expected 1 row, got %', rows;
    END IF;
    SELECT claim_token INTO token FROM vc.work_item WHERE id = 2;
    rows := vc.complete_work_item(token);
    IF rows <> 1 THEN
        RAISE EXCEPTION 'complete id=2 expected 1 row, got %', rows;
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
-- ---------------------------------------------------------------------------
TRUNCATE vc.work_item CASCADE;
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 3, 'GENERATION', 30, NULL);

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
SELECT count(*) AS claimed2 FROM vc.claim_work_items(1, 'FENCE-C', 30, 16);
COMMIT;
-- 事务已结束：vc.owner_user_id / vc.job_fence 已自动清除，迟到 complete 必须零写入。
DO $$
DECLARE token text; rows int;
BEGIN
    SELECT claim_token INTO token FROM vc.work_item WHERE status = 'CLAIMED' LIMIT 1;
    IF token IS NULL THEN
        RAISE EXCEPTION 'expected one CLAIMED item after commit';
    END IF;
    rows := vc.complete_work_item(token);
    IF rows <> 0 THEN
        RAISE EXCEPTION 'late complete must write 0 rows, got %', rows;
    END IF;
END $$;
RESET ROLE;
