-- 64_worker_coordinator_cross_session_recovery: §5.1.2 worker coordinator 语义
-- （TASK-0173）。
--
-- V24 后 runtime 角色 vc_api 获得 vc.list_pending_owner_ids /
-- vc.recover_expired_claims 的 EXECUTE。本测试用真实双会话（dblink，模式照 test 58）
-- 实证：
--   0) 队列枚举正向：seed 后两件均 PENDING → list_pending_owner_ids 只返回 owner 1。
--   1) 跨连接伪造拒绝：会话 A（vc_api + server-trusted SET LOCAL context）同事务
--      claim 并 COMMIT 后，会话 B（独立连接，无 transaction-local GUC）用 A 的 token
--      调 complete_work_item → 0 行（owner/fence 守卫不跨连接；INV-WORKER-001）。
--   2) lease 过期回收：A 批 lease 过期（模拟 worker 崩溃滞留）→ vc_api 调
--      recover_expired_claims 回收回 PENDING（清 token/fence/时间戳），返回 2。
--   3) 接管：会话 B（server-trusted context）重新 claim 拿新 token（接管）→
--      A 旧 token complete → 0 行（接管后旧持有者零写入）；B 完成接管批次 → 2 DONE。
--   4) 队列枚举反向：全部终态后 list_pending_owner_ids 返回空。
-- 终态验证走 superuser（vc_api 无 work_item SELECT，test 63 模式）。
--
-- 变量传递全部用 PL/pgSQL 局部变量 + 主会话临时表（test 63 模式）；dblink 同步
-- 单语句（claim/complete）经 dblink() 取结果，会话级 GUC 经 dblink_exec 设置。
-- 不依赖 psql \gset（在 stdin 多语句执行下变量替换不可靠）。

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL),
    (1, 2, 'GENERATION', 11, NULL);

-- 会话 B（独立连接）：跨连接伪造 / 接管 worker。
DO $$
BEGIN
    PERFORM dblink_connect('sess_b', 'dbname=vc');
END $$;

-- ---------------------------------------------------------------------------
-- 0) 正向枚举（验收 2c）：seed 后两件均 PENDING（work_item.status DEFAULT 'PENDING'，
--    V5:25）→ vc_api 调 list_pending_owner_ids 恰好只返回 owner 1（返回类型只有
--    owner_user_id 一列，不暴露 payload/token）。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
DO $$
DECLARE n int; mx bigint;
BEGIN
    SELECT count(*), max(owner_user_id) INTO n, mx FROM vc.list_pending_owner_ids();
    IF n <> 1 OR mx <> 1 THEN
        RAISE EXCEPTION 'list_pending_owner_ids seed must return exactly owner 1, got count=% max=%', n, mx;
    END IF;
END $$;
RESET ROLE;

-- 跨事务 token 暂存（主会话 pg_temp，ON COMMIT PRESERVE 跨 claim 事务存活）。
SET ROLE vc_api;
CREATE TEMP TABLE coord_token(key text, token text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) 跨连接伪造拒绝：主会话（vc_api + SET LOCAL context）同事务 claim 拿 batch
--    token；会话 B（独立连接，无 transaction-local GUC）用该 token complete → 0 行。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
SET LOCAL vc.job_fence = 'FENCE-A';
DO $$
DECLARE tok_a text;
BEGIN
    -- claim_work_items 一次签发整批共享 token（V5 语义）；取其一存临时表。
    SELECT claim_token INTO tok_a
      FROM vc.claim_work_items(1, 'FENCE-A', 30, 16)
      LIMIT 1;
    IF tok_a IS NULL THEN
        RAISE EXCEPTION 'claim must return a shared batch token';
    END IF;
    INSERT INTO coord_token VALUES ('a', tok_a);
END $$;
COMMIT;
RESET ROLE;
-- COMMIT 后主会话 transaction-local owner/fence GUC 已自动清除。

DO $$
DECLARE tok_a text; rows_b int;
BEGIN
    SELECT token INTO tok_a FROM coord_token WHERE key = 'a';
    -- 会话 B 独立连接：未设 vc.owner_user_id / vc.job_fence → _terminalize 的
    -- owner_user_id = current_owner_id() 与 claim_fence = current_setting('vc.job_fence')
    -- 守卫匹配不到任何行 → 0 行（context 不跨连接，INV-WORKER-001）。
    SELECT t.rows INTO rows_b FROM dblink('sess_b',
        format('SELECT vc.complete_work_item(%L) AS rows', tok_a)) AS t(rows int);
    IF rows_b <> 0 THEN
        RAISE EXCEPTION 'cross-connection complete without context must write 0 rows, got %', rows_b;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) lease 过期回收：A 批 lease 置为过去（模拟崩溃滞留）→ vc_api 调
--    recover_expired_claims → 2 行回 PENDING（V24 SD 函数，vc_api 经 V24 GRANT）。
-- ---------------------------------------------------------------------------
UPDATE vc.work_item SET lease_expires_at = now() - interval '1 minute'
 WHERE status = 'CLAIMED';

SET ROLE vc_api;
DO $$
DECLARE recovered int;
BEGIN
    -- recover_expired_claims 无 p_owner_user_id，不涉及 V17 断言面；vc_api 经 V24
    -- GRANT EXECUTE 调用，SD 函数以定义者权限 UPDATE（等同 V22 retention purge 模式）。
    SELECT vc.recover_expired_claims() INTO recovered;
    IF recovered <> 2 THEN
        RAISE EXCEPTION 'recover_expired_claims expected 2 rows, got %', recovered;
    END IF;
END $$;
RESET ROLE;

DO $$
DECLARE pending_n int;
BEGIN
    SELECT count(*) INTO pending_n FROM vc.work_item WHERE status = 'PENDING';
    IF pending_n <> 2 THEN
        RAISE EXCEPTION 'after recovery expected 2 PENDING items, got %', pending_n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) 接管：会话 B（server-trusted context）重新 claim 拿新 token；A 的旧 token
--    complete → 0 行（token 已被 recover 清空 + 接管后旧持有者零写入）；会话 B
--    完成接管批次 → 2 行 DONE。
-- ---------------------------------------------------------------------------
-- 会话 B 建立 server-trusted context（session 级 GUC，模拟 OwnerContext.asOwner 在
-- 该连接建立的信任 context）。claim_work_items 内部 set_config(...,true) 是 local，
-- 仅在 claim 的 dblink autocommit 事务内覆盖；事务结束后回到 session 级值，使后续
-- complete 的 owner/fence 守卫匹配 claim_fence。
DO $$
DECLARE tok_old text; tok_new text; rows_old int; rows_new int; done_n int;
BEGIN
    SELECT token INTO tok_old FROM coord_token WHERE key = 'a';

    PERFORM dblink_exec('sess_b', 'SET ROLE vc_api');
    PERFORM dblink_exec('sess_b', $q$SET vc.owner_user_id = '1'$q$);
    PERFORM dblink_exec('sess_b', $q$SET vc.job_fence = 'FENCE-C'$q$);

    -- 会话 B 接管 claim（新 fence FENCE-C，新 token）。
    SELECT t.token INTO tok_new FROM dblink('sess_b',
        $q$SELECT claim_token AS token
            FROM vc.claim_work_items(1, 'FENCE-C', 30, 16)
            LIMIT 1$q$) AS t(token text);
    IF tok_new IS NULL OR tok_new = tok_old THEN
        RAISE EXCEPTION 'takeover claim must issue a fresh token (old=% new=%)', tok_old, tok_new;
    END IF;

    -- 旧持有者（主会话，无 context）用旧 token complete → 0 行。
    SELECT vc.complete_work_item(tok_old) INTO rows_old;
    IF rows_old <> 0 THEN
        RAISE EXCEPTION 'old holder complete after takeover must write 0 rows, got %', rows_old;
    END IF;

    -- 会话 B（owner=1 fence=FENCE-C）完成接管批次 → 2 行 DONE。
    SELECT t.rows INTO rows_new FROM dblink('sess_b',
        format('SELECT vc.complete_work_item(%L) AS rows', tok_new)) AS t(rows int);
    IF rows_new <> 2 THEN
        RAISE EXCEPTION 'takeover batch complete expected 2 rows, got %', rows_new;
    END IF;

    SELECT count(*) INTO done_n FROM vc.work_item WHERE status = 'DONE';
    IF done_n <> 2 THEN
        RAISE EXCEPTION 'expected 2 DONE items after takeover completion, got %', done_n;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) 终态枚举（验收 2c 反向）：全部 DONE 后 list_pending_owner_ids 返回空。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
DO $$
DECLARE owners_n int;
BEGIN
    SELECT count(*) INTO owners_n FROM vc.list_pending_owner_ids();
    IF owners_n <> 0 THEN
        RAISE EXCEPTION 'list_pending_owner_ids after all terminal must be empty, got % owners', owners_n;
    END IF;
END $$;
RESET ROLE;

-- 清理。
DO $$ BEGIN PERFORM dblink_disconnect('sess_b'); END $$;
DROP TABLE coord_token;
