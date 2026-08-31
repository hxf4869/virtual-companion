-- V29: RETRY-A 有界重试与 dead-letter（owner-gates 2026-08-15 RETRY 项，
-- Owner 2026-08-16 逐项确认落地）。
--
-- 语义（Owner 批准参数）：仅明确分类为 RETRYABLE_FAILED 的 provider 失败可重试，
-- 最多 2 次重试（总计最多 3 次 provider attempt），确定性有界退避 [15s, 60s, 60s…]；
-- 耗尽后 work_item 原子进入 DEAD_LETTERED 可见状态，generation 由调用方在同一
-- guarded 事务内终止为 FAILED_FINAL。NON_RETRYABLE / TIMED_OUT / 安全 / 授权失败
-- 保持既有失败关闭路径（fail_work_item，不重试）。已取消的 claim（status 不再是
-- CLAIMED）自然无法 requeue——claim 守卫拒绝，事务回滚零写入。
--
-- 每次 outbound 仍走 V28 attempt_intent：重试是新的 claim 周期，prepare-tx 会创建
-- 新的独立 intent 行（新 provider_attempt_id），失败 attempt 的 outcome 已由
-- audit-outcome-tx 记为 RETRYABLE_FAILED——attempt 级审计闭合不受重试影响。
--
-- 追加式：不编辑 V1-V28 任何文件（migration history checksum 安全）。claim_work_items 与
-- list_pending_owner_ids 仅以 CREATE OR REPLACE 收紧 WHERE（签名/权限不变）。

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. work_item 增加 attempt 计数与 next_attempt_at；状态集合加 DEAD_LETTERED。
--    attempt_count = 该 item 已完成的 provider attempt 数（初始 0；每次 requeue
--    +1；dead-letter 也 +1，即耗尽时恰为最大 attempt 数）。
-- ---------------------------------------------------------------------------
ALTER TABLE vc.work_item
    ADD COLUMN attempt_count    integer     NOT NULL DEFAULT 0,
    ADD COLUMN next_attempt_at  timestamptz;

ALTER TABLE vc.work_item DROP CONSTRAINT work_item_status;
ALTER TABLE vc.work_item ADD CONSTRAINT work_item_status CHECK (
    status IN ('PENDING', 'CLAIMED', 'DONE', 'FAILED', 'DEAD_LETTERED', 'CANCELLED')
);

-- ---------------------------------------------------------------------------
-- 2. requeue_retryable_failure：guarded 重试调度 / dead-letter。
--    前置：work item 必须仍 CLAIMED 且 token/fence 精确匹配、lease 未过期
--    （与 assert_active_claim 同一守卫），owner 必须匹配 server-trusted context。
--    返回 'RETRY_SCHEDULED'（回到 PENDING，带 next_attempt_at 确定性退避）或
--    'DEAD_LETTERED'（attempt 耗尽，终态可见）。任何守卫失败 RAISE。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.requeue_retryable_failure(
    p_owner_user_id bigint,
    p_work_item_id  bigint,
    p_claim_token   text,
    p_claim_fence   text,
    p_max_attempts  integer DEFAULT 3)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_attempts integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_work_item_id IS NULL THEN
        RAISE EXCEPTION 'requeue_retryable_failure: owner_user_id and work_item_id are required';
    END IF;
    IF p_claim_token IS NULL OR btrim(p_claim_token) = '' THEN
        RAISE EXCEPTION 'requeue_retryable_failure: claim_token is required';
    END IF;
    IF p_claim_fence IS NULL OR btrim(p_claim_fence) = '' THEN
        RAISE EXCEPTION 'requeue_retryable_failure: claim_fence is required';
    END IF;
    IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
        RAISE EXCEPTION 'requeue_retryable_failure: p_max_attempts must be positive';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'requeue_retryable_failure: owner_user_id must match server-trusted context';
    END IF;

    -- 与 assert_active_claim 同守卫；行锁防并发 requeue/terminalize 竞争。
    SELECT attempt_count INTO v_attempts
      FROM vc.work_item
     WHERE owner_user_id = p_owner_user_id
       AND id = p_work_item_id
       AND status = 'CLAIMED'
       AND claim_token = p_claim_token
       AND claim_fence = p_claim_fence
       AND lease_expires_at > clock_timestamp()
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'requeue_retryable_failure: work item % has no live claim matching the presented token/fence (missing, overtaken, cancelled or lease expired)',
            p_work_item_id;
    END IF;

    IF v_attempts + 1 >= p_max_attempts THEN
        UPDATE vc.work_item
           SET status = 'DEAD_LETTERED',
               attempt_count = attempt_count + 1,
               finished_at = clock_timestamp()
         WHERE owner_user_id = p_owner_user_id
           AND id = p_work_item_id;
        RETURN 'DEAD_LETTERED';
    END IF;

    -- 确定性有界退避：第 1 次重试 15s，第 2 次起 60s（封顶）。
    UPDATE vc.work_item
       SET status = 'PENDING',
           attempt_count = attempt_count + 1,
           next_attempt_at = clock_timestamp() + make_interval(secs =>
               CASE WHEN attempt_count + 1 = 1 THEN 15 ELSE 60 END),
           claim_token = NULL,
           claim_fence = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_work_item_id;
    RETURN 'RETRY_SCHEDULED';
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. claim_work_items：只 claim 已到期（或无退避）的 PENDING 项。签名不变，
--    CREATE OR REPLACE 保留 V5/V28 的既有授权。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.claim_work_items(
    p_owner_user_id bigint,
    p_fence text,
    p_lease_seconds integer DEFAULT 30,
    p_limit integer DEFAULT 16
)
    RETURNS TABLE(owner_user_id bigint, id bigint, kind text, ref_id bigint,
                  payload bytea, claim_token text, claim_fence text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_token text := gen_random_uuid()::text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_fence IS NULL OR btrim(p_fence) = '' OR p_fence = 'STALE' THEN
        RAISE EXCEPTION 'stale or missing fence refuses work claim';
    END IF;
    -- V17 trusted-owner 断言：调用参数必须与 server-trusted context 一致。
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    PERFORM set_config('vc.job_fence', p_fence, true);

    RETURN QUERY
    WITH picked AS (
        SELECT wi.id
        FROM vc.work_item wi
        WHERE wi.owner_user_id = p_owner_user_id
          AND wi.status = 'PENDING'
          AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
        ORDER BY wi.id
        FOR UPDATE OF wi SKIP LOCKED
        LIMIT GREATEST(p_limit, 1)
    )
    UPDATE vc.work_item u
       SET status = 'CLAIMED',
           claim_token = v_token,
           claim_fence = p_fence,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs => GREATEST(p_lease_seconds, 1))
      FROM picked
     WHERE u.owner_user_id = p_owner_user_id
       AND u.id = picked.id
    RETURNING u.owner_user_id, u.id, u.kind, u.ref_id, u.payload, v_token, u.claim_fence;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. list_pending_owner_ids：同样只枚举存在可 claim（已到期）PENDING 项的 owner，
--    避免退避窗口内每 5s 轮询空转。签名不变，CREATE OR REPLACE 保留 V24 授权。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_pending_owner_ids()
    RETURNS TABLE(owner_user_id bigint)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT DISTINCT wi.owner_user_id
      FROM vc.work_item wi
     WHERE wi.status = 'PENDING'
       AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
     ORDER BY wi.owner_user_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. 权限：requeue 只授 worker 与 runtime 池角色（assert_active_claim 同族模式），
--    PUBLIC 全撤销。
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
    vc.requeue_retryable_failure(bigint, bigint, text, text, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.requeue_retryable_failure(bigint, bigint, text, text, integer)
    TO vc_worker, vc_api;

-- ---------------------------------------------------------------------------
-- 6. 迁移末尾 fail-closed DO 块：断言关键不变量。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_def  text;
    v_cols text;
BEGIN
    IF to_regprocedure('vc.requeue_retryable_failure(bigint,bigint,text,text,integer)') IS NULL THEN
        RAISE EXCEPTION 'V29: requeue_retryable_failure missing';
    END IF;
    SELECT pg_get_constraintdef(con.oid) INTO v_def
      FROM pg_constraint con
     WHERE con.conname = 'work_item_status'
       AND con.conrelid = 'vc.work_item'::regclass;
    IF v_def IS NULL OR v_def NOT LIKE '%DEAD_LETTERED%' THEN
        RAISE EXCEPTION 'V29: work_item_status constraint must allow DEAD_LETTERED';
    END IF;
    SELECT string_agg(attname, ',') INTO v_cols
      FROM pg_attribute
     WHERE attrelid = 'vc.work_item'::regclass
       AND attname IN ('attempt_count', 'next_attempt_at');
    IF v_cols IS NULL OR v_cols NOT LIKE '%attempt_count%'
                       OR v_cols NOT LIKE '%next_attempt_at%' THEN
        RAISE EXCEPTION 'V29: work_item attempt_count/next_attempt_at columns missing';
    END IF;
    IF has_function_privilege('public',
        'vc.requeue_retryable_failure(bigint,bigint,text,text,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V29: requeue_retryable_failure must not be PUBLIC-executable';
    END IF;
END;
$$;
