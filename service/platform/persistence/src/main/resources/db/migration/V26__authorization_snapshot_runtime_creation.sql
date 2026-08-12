-- TASK-0181 V26: authorization_snapshot runtime creation SECURITY DEFINER function.
--
-- 现状缺口（当前 HEAD aa3d7f7 代码核实）：
--  - V16 REVOKE INSERT/UPDATE/DELETE ON vc.authorization_snapshot FROM 全部运行期角色
--    （vc_api/vc_worker/vc_job_coordinator/vc_dispatcher），保留 SELECT 供 FORCE RLS
--    租户隔离读路径。
--  - 全仓无 create-snapshot SECURITY DEFINER 函数：JdbcAuthorizationSnapshotStore 自述
--    persistence skeleton（直写 SQL 在 V16 后对 vc_api 不可执行），
--    AuthorizationSnapshotProvider 是接口 seam（无运行期 bean）→ 运行期 external 分支
--    （GenerationWorkItemHandler.completeViaExternal）在 TASK-0177 后仍不激活。
--  - INV-AUTH-001 要求每次 external 尝试绑定 requested + execution 双 authorization
--    snapshot；V20 已把 provider_attempt 双 snapshot 列 + composite FK 落地
--    （消费侧），但生产侧（mint 双快照）没有运行期入口。
--
-- 本迁移提供（SECURITY DEFINER，SET search_path = vc, pg_catalog，V18 硬化模式）：
--  vc.create_authorization_snapshots(owner, generation_id, provider_id, region,
--    contract_ref, purpose, data_categories) —— 一次创建 requested + execution 双
--    ACTIVE 行（同 provider/region/contract/purpose/categories；execution ⊆ requested
--    由同内容天然满足 ExecutionAuthorizationGuard 校验），返回双 snapshot_id 供
--    ExternalAttemptBinding / record_provider_attempt 绑定。
--
-- 安全论证（为什么授 vc_api 不构成越权）：
--  - V17 trusted-owner 断言：p_owner_user_id IS DISTINCT FROM vc.current_owner_id()
--    RAISE —— 只能为 server-trusted 上下文内的当前 owner 创建（OwnerContext.asOwner
--    建立的 GUC，与 receive_generation/finalize_generation/record_provider_attempt
--    同一调用模式）；
--  - generation 存在性校验（PERFORM 1 + owner 谓词）—— 不为不存在或跨 owner 的
--    generation 铸造快照（存在性不披露）；
--  - INSERT 受 FORCE RLS owner_isolation 约束（definer 身份仍绑定 current_owner_id），
--    行永远落在当前 owner 名下；快照内容（provider/region/contract/purpose/categories）
--    由调用方（运行期批准配置 + registry 推导）提供，行隔离不变；
--  - purpose 白名单对齐 specs/catalog/processing-purposes.yaml；data_categories 由
--    Java 侧 DataCategory 枚举约束（SD 层 text[] 无注入面，元素不在此校验）。
--  - 无新角色、无新表/列/约束/状态；不 REVOKE 任何既有授权；V1-V25 frozen（Flyway
--    checksum 安全）。

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.create_authorization_snapshots(
    p_owner_user_id   bigint,
    p_generation_id   bigint,
    p_provider_id     text,
    p_region          text,
    p_contract_ref    text,
    p_purpose         text,
    p_data_categories text[])
    RETURNS TABLE(out_requested_id text, out_execution_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_requested_id text;
    v_execution_id text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'create_authorization_snapshots: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL THEN
        RAISE EXCEPTION 'create_authorization_snapshots: generation_id is required';
    END IF;
    IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
        RAISE EXCEPTION 'create_authorization_snapshots: provider_id is required';
    END IF;
    IF p_region IS NULL OR btrim(p_region) = '' THEN
        RAISE EXCEPTION 'create_authorization_snapshots: region is required';
    END IF;
    IF p_contract_ref IS NULL OR btrim(p_contract_ref) = '' THEN
        RAISE EXCEPTION 'create_authorization_snapshots: contract_ref is required';
    END IF;
    IF p_purpose IS NULL OR p_purpose NOT IN (
        'COMPANION_CHAT','OUTPUT_REVIEW','MEMORY_EXTRACT','EMBEDDING',
        'CONVERSATION_SUMMARY','PRODUCT_EVAL'
    ) THEN
        RAISE EXCEPTION 'create_authorization_snapshots: unsupported purpose %', p_purpose;
    END IF;
    IF p_data_categories IS NULL OR cardinality(p_data_categories) = 0 THEN
        RAISE EXCEPTION 'create_authorization_snapshots: data_categories is required';
    END IF;
    -- V17 trusted-owner 断言：调用参数必须与 server-trusted GUC 一致。
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_authorization_snapshots: owner_user_id must match server-trusted context';
    END IF;

    -- 该 generation 必须存在且属于 owner（存在性不披露；INV-AUTH-001 的 mint 侧前置）。
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_authorization_snapshots: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- 双快照同内容：requested = execution（execution ⊆ requested 天然满足
    -- ExecutionAuthorizationGuard 的 purpose/categories/provider/region/contract 对齐）。
    v_requested_id := 'snap_' || gen_random_uuid()::text;
    v_execution_id := 'snap_' || gen_random_uuid()::text;
    INSERT INTO vc.authorization_snapshot(
        owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
        purpose, data_categories, task_cancelled, source_data_deleted)
    VALUES
        (p_owner_user_id, v_requested_id, 'ACTIVE', p_provider_id, p_region,
         p_contract_ref, p_purpose, p_data_categories, false, false),
        (p_owner_user_id, v_execution_id, 'ACTIVE', p_provider_id, p_region,
         p_contract_ref, p_purpose, p_data_categories, false, false);

    RETURN QUERY SELECT v_requested_id, v_execution_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.create_authorization_snapshots(bigint, bigint, text, text, text, text, text[])
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.create_authorization_snapshots(bigint, bigint, text, text, text, text, text[])
    TO vc_api;
