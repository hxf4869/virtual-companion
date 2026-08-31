-- TASK-0171 V23: P1-04 worker 半边 —— runtime 同进程 worker 复用 authDataSource
-- 连接池（VC_DB_USERNAME，vc_api 成员语义），为 vc_api 授予 claim 家族 SECURITY
-- DEFINER 函数的 EXECUTE，使 runtime 内 worker 路径（WorkItemWorker）可以调用
-- vc.claim_work_items / vc.renew_lease / vc.complete_work_item / vc.fail_work_item /
-- vc.cancel_work_item。
--
-- 安全论证（为什么授 vc_api 不构成越权）：
--  - V17（TASK-0154）已为 claim_work_items 强断言 p_owner_user_id IS DISTINCT FROM
--    vc.current_owner_id() 即 RAISE（test 54/55 实证）——函数只能在 server-trusted
--    owner context（OwnerContext.asOwner 经事务级 set_config 建立）内以匹配 owner
--    调用；
--  - renew_lease/_terminalize 读 current_owner_id() + transaction-local vc.job_fence
--    GUC，无 context 时 WHERE 不匹配 → 0 行（test 08-11 实证）；
--  - 因此 EXECUTE 授权本身不打开任何越权面：无 context / mismatch 一律失败关闭，
--    worker 路径与 API 路径同属服务端可信代码（Owner 2026-08-12 决策：asOwner 服务端
--    注入，不新增 DB 角色、不 SET ROLE、不建 per-principal 连接池）。
--
-- 不 REVOKE vc_worker 既有 EXECUTE（V5 基线保持）；不新增角色；不修改任何函数
-- （无 CREATE OR REPLACE，search_path 无涉——V18 已把既有 SD 函数重写为 vc,pg_catalog）。
-- V1-V22 frozen（migration history checksum 安全）。

SET search_path TO vc, pg_catalog;

GRANT EXECUTE ON FUNCTION
    vc.claim_work_items(bigint, text, integer, integer),
    vc.renew_lease(text, integer),
    vc.complete_work_item(text),
    vc.fail_work_item(text),
    vc.cancel_work_item(text)
    TO vc_api;
