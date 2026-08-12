-- 64_worker_coordinator_cross_session_recovery: §5.1.2 worker coordinator 语义
-- （TASK-0173）。
--
-- V24 后 runtime 角色 vc_api 获得 vc.list_pending_owner_ids /
-- vc.recover_expired_claims 的 EXECUTE。本测试用真实双会话（dblink，模式照 test 58）
-- 实证：
--   1) 跨连接伪造拒绝：会话 A（vc_api + server-trusted context）claim 并 COMMIT 后，
--      会话 B（独立连接）无 transaction-local context 用 A 的 token 调
--      complete_work_item → 0 行；B 伪造 owner + 错误 fence → 仍 0 行
--      （INV-WORKER-001：迟到/伪造写零写入）。
--   2) lease 过期回收 + 接管：A 的 lease 过期（模拟 worker 崩溃滞留）→
--      vc.recover_expired_claims 回收回 PENDING → 会话 B 重新 claim 拿新 token
--      （接管）→ A 的旧 token + 旧 fence complete → 0 行（接管后旧持有者零写入）。
--   3) 队列枚举：vc.list_pending_owner_ids 只返回有 PENDING 项的 owner
--      （返回类型只有 owner_user_id 一列，不暴露 payload/token/元数据）；
--      全部终态后返回空。
-- 终态验证走 superuser（vc_api 无 work_item SELECT，test 63 模式）。
--
-- 结构：SET ROLE / BEGIN / SET LOCAL / COMMIT / RESET ROLE 全部为顶层语句
-- （PL/pgSQL DO 块内不允许事务控制）；跨语句传递用 psql \gset 变量 + DO 断言。

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL),
    (1, 2, 'GENERATION', 11, NULL);

-- 正向（验收 2c）：seed 后两件均 PENDING（work_item.status DEFAULT 'PENDING'，
-- V5:25）→ vc_api 调 list_pending_owner_ids 恰好只返回 owner 1（返回类型仅
-- owner_user_id 一列，不暴露 payload/token）。
SET ROLE vc_api;
SELECT count(*) AS owners_seed, max(owner_user_id) AS owner_seed
  FROM vc.list_pending_owner_ids() \gset
RESET ROLE;
DO $$
BEGIN
    IF :'owners_seed'::int <> 1 OR :'owner_seed'::bigint <> 1 THEN
        RAISE EXCEPTION 'list_pending_owner_ids seed must return exactly owner 1, got count=% max=%', :'owners_seed', :'owner_seed';
    END IF;
END $$;

-- 双会话连接（autocommit 语句先于 send 块；主会话不持锁等待 dblink 结果）。
DO $$
BEGIN
    PERFORM dblink_connect('sess_a', 'dbname=vc');
    PERFORM dblink_connect('sess_b', 'dbname=vc');
END $$;

-- ---------------------------------------------------------------------------
-- 1) 跨连接伪造拒绝：会话 A claim（vc_api + context，同事务 COMMIT 持久 token）；
--    会话 B 无 context 用 A 的 token complete → 0 行；B 伪造 owner+错 fence → 0 行。
-- ---------------------------------------------------------------------------
SELECT dblink_send_query('sess_a',
    $q$SET ROLE vc_api; BEGIN;
       SET LOCAL vc.owner_user_id = '1';
       SELECT array_agg(claim_token ORDER BY id) AS token
         FROM vc.claim_work_items(1, 'FENCE-A', 30, 16);
       COMMIT; RESET ROLE;$q$);
SELECT t.token FROM dblink_get_result('sess_a') AS t(token text) \gset tok_a

-- 会话 B（独立连接，无任何 context）：用 A 的 token complete → 0 行。
SELECT dblink_send_query('sess_b',
    format($q$SELECT vc.complete_work_item(%L) AS rows$q$, :'tok_a'));
SELECT t.rows FROM dblink_get_result('sess_b') AS t(rows int) \gset rows_b
DO $$
BEGIN
    IF :'rows_b'::int <> 0 THEN
        RAISE EXCEPTION 'cross-connection complete without context must write 0 rows, got %', :'rows_b';
    END IF;
END $$;

-- 会话 B 伪造 owner context + 错误 fence：仍 0 行（fence 不匹配）。
SELECT dblink_send_query('sess_b',
    format($q$SET ROLE vc_api; BEGIN;
       SET LOCAL vc.owner_user_id = '1';
       SET LOCAL vc.job_fence = 'WRONG-FENCE';
       SELECT vc.complete_work_item(%L) AS rows;
       COMMIT; RESET ROLE;$q$, :'tok_a'));
SELECT t.rows FROM dblink_get_result('sess_b') AS t(rows int) \gset rows_b
DO $$
BEGIN
    IF :'rows_b'::int <> 0 THEN
        RAISE EXCEPTION 'cross-connection complete with wrong fence must write 0 rows, got %', :'rows_b';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) lease 过期回收 + 接管：A 的批次 lease 过期（模拟崩溃滞留）→ recover 回 PENDING
--    → 会话 B 重新 claim 拿新 token（接管）→ A 的旧 token + 旧 fence complete → 0 行。
-- ---------------------------------------------------------------------------
SELECT claim_token AS tok_old FROM vc.work_item
 WHERE status = 'CLAIMED' ORDER BY id LIMIT 1 \gset tok_old
UPDATE vc.work_item SET lease_expires_at = now() - interval '1 minute'
 WHERE status = 'CLAIMED';

-- vc_api 调 recover_expired_claims() → 2 行回收；项回 PENDING。
SET ROLE vc_api;
SELECT vc.recover_expired_claims() AS recovered \gset recovered
RESET ROLE;
DO $$
BEGIN
    IF :'recovered'::int <> 2 THEN
        RAISE EXCEPTION 'recover_expired_claims expected 2 rows, got %', :'recovered';
    END IF;
END $$;
SELECT count(*) AS pending_n FROM vc.work_item WHERE status = 'PENDING' \gset pending_n
DO $$
BEGIN
    IF :'pending_n'::int <> 2 THEN
        RAISE EXCEPTION 'after recovery expected 2 PENDING items, got %', :'pending_n';
    END IF;
END $$;

-- 会话 B 重新 claim（接管，新 fence 新 token）。
SELECT dblink_send_query('sess_b',
    $q$SET ROLE vc_api; BEGIN;
       SET LOCAL vc.owner_user_id = '1';
       SELECT array_agg(claim_token ORDER BY id) AS token
         FROM vc.claim_work_items(1, 'FENCE-C', 30, 16);
       COMMIT; RESET ROLE;$q$);
SELECT t.token FROM dblink_get_result('sess_b') AS t(token text) \gset tok_new
DO $$
BEGIN
    IF :'tok_new' IS NULL OR :'tok_new' = :'tok_old' THEN
        RAISE EXCEPTION 'takeover claim must issue a fresh token (old=% new=%)', :'tok_old', :'tok_new';
    END IF;
END $$;

-- 旧持有者（A 的旧 token + 旧 fence）complete → 0 行（接管后旧写拒绝）。
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
SET LOCAL vc.job_fence = 'FENCE-A';
SELECT vc.complete_work_item(:'tok_old') AS rows \gset rows_old
COMMIT;
RESET ROLE;
DO $$
BEGIN
    IF :'rows_old'::int <> 0 THEN
        RAISE EXCEPTION 'old holder complete after takeover must write 0 rows, got %', :'rows_old';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) 队列枚举：list_pending_owner_ids 只返回有 PENDING 项的 owner；
--    当前 2 件被接管持有（CLAIMED）→ 空；接管批次完成全部终态后仍空。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
SELECT count(*) AS owners_n FROM vc.list_pending_owner_ids() \gset owners_n
RESET ROLE;
DO $$
BEGIN
    IF :'owners_n'::int <> 0 THEN
        RAISE EXCEPTION 'list_pending_owner_ids with no PENDING items must be empty, got % owners', :'owners_n';
    END IF;
END $$;

-- 有效 context 完成接管批次（同事务 complete → 2 行），全部终态后再枚举仍空。
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
SET LOCAL vc.job_fence = 'FENCE-C';
SELECT vc.complete_work_item(:'tok_new') AS rows \gset rows_takeover
COMMIT;
RESET ROLE;
DO $$
BEGIN
    IF :'rows_takeover'::int <> 2 THEN
        RAISE EXCEPTION 'takeover batch complete expected 2 rows, got %', :'rows_takeover';
    END IF;
END $$;
SELECT count(*) AS done_n FROM vc.work_item WHERE status = 'DONE' \gset done_n
DO $$
BEGIN
    IF :'done_n'::int <> 2 THEN
        RAISE EXCEPTION 'expected 2 DONE items after takeover completion, got %', :'done_n';
    END IF;
END $$;

SET ROLE vc_api;
SELECT count(*) AS owners_n2 FROM vc.list_pending_owner_ids() \gset owners_n2
RESET ROLE;
DO $$
BEGIN
    IF :'owners_n2'::int <> 0 THEN
        RAISE EXCEPTION 'list_pending_owner_ids after all terminal must be empty, got % owners', :'owners_n2';
    END IF;
END $$;
