-- TASK-0173 V24: §5.1.2 worker coordinator —— runtime 内 @Scheduled 轮询调度所需的
-- 两个 SECURITY DEFINER 函数，并授予 runtime 连接池角色 vc_api EXECUTE。
--
-- 现状缺口（当前 HEAD 77431d45 代码核实）：
--  - V5 claim_work_items 只选 status='PENDING' 的项（V5__worker_claim_lease_fence.sql
--    :84），CLAIED + lease 过期的项没有任何回收路径——worker 崩溃/超时后该批永久滞留；
--  - vc_api 对 work_item 表零权限（V5 列级 SELECT 只授 vc_job_coordinator、SELECT 授
--    vc_worker），runtime coordinator 无法枚举有 PENDING 项的 owner 队列。
-- 本迁移提供：
--  - vc.list_pending_owner_ids()：枚举有 PENDING work_item 的 distinct owner_user_id
--    （仅 ID，不暴露 payload/token/业务元数据——coordinator 轮询调度的最小必要信息）；
--  - vc.recover_expired_claims([grace_seconds])：把 status='CLAIMED' 且
--    lease_expires_at <= now() - grace 的项重置回 PENDING（清 token/fence/时间戳），
--    返回回收行数（lease 过期回收）。
--
-- 安全论证（为什么授 vc_api 不构成越权）：
--  - list 只暴露 owner_user_id（返回类型只有一列，无 payload/token）；
--  - recover 只重置过期 CLAIMED（不触碰 PENDING/DONE/FAILED/CANCELLED，不产生新
--    claim，不建立 tenant context——等同 V22 retention purge 的系统级清理模式）；
--  - 两者都无 p_owner_user_id 参数，不涉及 V17 trusted-owner 断言面；
--  - V17 断言 + transaction-local GUC 语义不受影响（test 54/55/08-11/63 保持）；
--  - work_item 表 vc_api 仍无表级 SELECT/DML（test 63/64 实证）。
--
-- 不 REVOKE 任何既有授权（vc_worker/vc_api 既有 EXECUTE、vc_job_coordinator 列级
-- SELECT 全保持）；不新增角色；不修改任何既有函数；不新增表/列/约束/状态。
-- V1-V23 frozen（Flyway checksum 安全）。

SET search_path TO vc, pg_catalog;

-- 枚举有 PENDING work_item 的 owner（coordinator 轮询调度；仅 owner ID）。
CREATE OR REPLACE FUNCTION vc.list_pending_owner_ids()
    RETURNS TABLE(owner_user_id bigint)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT DISTINCT wi.owner_user_id
      FROM vc.work_item wi
     WHERE wi.status = 'PENDING'
     ORDER BY wi.owner_user_id;
$$;

-- 回收 lease 已过期的 CLAIMED 项回 PENDING（worker 崩溃/超时释放；返回回收行数）。
CREATE OR REPLACE FUNCTION vc.recover_expired_claims(p_lease_grace_seconds integer DEFAULT 0)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE vc.work_item u
       SET status = 'PENDING',
           claim_token = NULL,
           claim_fence = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
     WHERE u.status = 'CLAIMED'
       AND u.lease_expires_at <= now() - make_interval(secs => GREATEST(p_lease_grace_seconds, 0));
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION
    vc.list_pending_owner_ids(),
    vc.recover_expired_claims(integer)
    TO vc_api;
