-- activate-normal-chat-30d.sql — DOGFOOD-07（ADR-0006 §7.1）
--
-- 用途：仅限 ADR-0006 Owner-only 本地 7 天 dogfood 的本机数据库，把 NORMAL_CHAT
-- （对话正文 vc.message）的保留周期激活为 30 天。不得用于任何其他环境；
-- 不批准、也不得连带激活 beta-readiness/08 草案中其余 7 类 DRAFT 周期。
--
-- 执行前置条件：
--   1. 全量 Flyway 迁移已应用（至少 V104：data_retention_policy.status 列存在）。
--   2. 以迁移属主/超级用户执行（psql 直连；vc.data_retention_policy 已 REVOKE
--      所有 runtime 角色，运行时角色无权改策略）。
--   3. 此刻调度器开关保持仓库默认：VC_RETENTION_PURGE_ENABLED=false、
--      VC_RETENTION_DRY_RUN=true。激活策略行本身不会触发任何清理；
--      按观察顺序由 Owner 再翻开关（见文末"Owner 执行顺序"）。
--
-- 执行后效果：
--   - vc.data_retention_policy 追加一个 NORMAL_CHAT 新版本行（policy_version =
--     当前最大 + 1，append-only，不 UPDATE 历史版本值）：retain_days=30、
--     active=true、status='ACTIVE'。
--   - vc.active_retention_days('NORMAL_CHAT') 从 fail-closed 变为返回 30；
--     其余 7 类仍为 DRAFT，继续 fail-closed。
--   - 幂等：重复执行不会追加第二个 ACTIVE 行（已存在 ACTIVE 30 天行时为 no-op）。
--   - 已确认结构化记忆（ACCEPTED）不受影响：NORMAL_CHAT purge 只删 vc.message
--     并失效覆盖它的会话摘要（V70/V104 语义，ADR-0006 §7.1）。
--
-- 回退方式（见文末注释段；append-only 语义下回退 = 置 RETIRED，不 DELETE 历史）：
--   将该 ACTIVE 行 UPDATE status='RETIRED' 后，active_retention_days 重新
--   fail-closed，调度器 dry-run/purge 均拒绝执行。V104 的 status CHECK
--   （DRAFT/ACTIVE/RETIRED）允许该 UPDATE；beta-readiness/08 §启用流程本身
--   就以 migrator 置 ACTIVE/RETIRED 为生命周期机制。

\set ON_ERROR_STOP on

BEGIN;

-- 前置：V104 已应用（status 列存在），否则给出明确错误。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'vc'
           AND table_name = 'data_retention_policy'
           AND column_name = 'status') THEN
        RAISE EXCEPTION 'data_retention_policy.status 不存在：请先应用全量迁移（>= V104）';
    END IF;
END $$;

-- 激活（幂等，与 infra/db/tests/159_dogfood_retention_activation.sql 中等价逻辑保持同步）。
DO $$
DECLARE
    v_next  int;
    v_rows  int;
BEGIN
    SELECT count(*) INTO v_rows FROM vc.data_retention_policy
     WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE';
    IF v_rows = 1 AND EXISTS (
        SELECT 1 FROM vc.data_retention_policy
         WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE'
           AND retain_days = 30) THEN
        RAISE NOTICE 'NORMAL_CHAT 30 天 ACTIVE 行已存在：幂等 no-op';
    ELSIF v_rows <> 0 THEN
        RAISE EXCEPTION '已存在其他 ACTIVE NORMAL_CHAT 策略（% 行）：请先人工核对再执行', v_rows;
    ELSE
        SELECT COALESCE(max(policy_version), 0) + 1 INTO v_next
          FROM vc.data_retention_policy WHERE category = 'NORMAL_CHAT';
        INSERT INTO vc.data_retention_policy(
            policy_version, category, retain_days, active, status)
        VALUES (v_next, 'NORMAL_CHAT', 30, true, 'ACTIVE')
        ON CONFLICT (policy_version, category) DO NOTHING;
        RAISE NOTICE 'NORMAL_CHAT retain_days=30 已激活为 policy_version %', v_next;
    END IF;
END $$;

-- 执行后校验：NORMAL_CHAT=30；其余 7 类仍 DRAFT（钉死“不得整体 ACTIVE”）；
-- 全表恰好 1 个 ACTIVE 行。
DO $$
DECLARE
    c        text;
    v_days   int;
    v_rows   int;
    v_denied boolean;
BEGIN
    v_days := vc.active_retention_days('NORMAL_CHAT');
    IF v_days <> 30 THEN
        RAISE EXCEPTION 'active_retention_days(NORMAL_CHAT) 应为 30，实际 %', v_days;
    END IF;
    FOREACH c IN ARRAY ARRAY[
        'DELETED_CHAT', 'MEMORY_CANDIDATE', 'REJECTED_CANDIDATE',
        'MODEL_CALL_DETAIL', 'SAFETY_LOG', 'EXPORT_RESIDUE', 'STREAM_FRAGMENT']
    LOOP
        v_denied := false;
        BEGIN
            PERFORM vc.active_retention_days(c);
        EXCEPTION WHEN others THEN
            v_denied := SQLERRM LIKE '%no active policy%';
        END;
        IF NOT v_denied THEN
            RAISE EXCEPTION '% 仍应为 DRAFT（本脚本不得整体激活 Beta 草案周期）', c;
        END IF;
    END LOOP;
    SELECT count(*) INTO v_rows FROM vc.data_retention_policy
     WHERE active AND status = 'ACTIVE';
    IF v_rows <> 1 THEN
        RAISE EXCEPTION '全表应恰好 1 个 ACTIVE 行（NORMAL_CHAT 30 天），实际 %', v_rows;
    END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- 回退段（需要时去掉注释执行；执行前先确认调度器 VC_RETENTION_PURGE_ENABLED=false）
-- ---------------------------------------------------------------------------
-- BEGIN;
-- UPDATE vc.data_retention_policy
--    SET status = 'RETIRED'
--  WHERE category = 'NORMAL_CHAT'
--    AND active AND status = 'ACTIVE' AND retain_days = 30
--    AND policy_version = (
--        SELECT max(policy_version) FROM vc.data_retention_policy
--         WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE');
-- COMMIT;
-- 回退后：active_retention_days('NORMAL_CHAT') 重新 fail-closed；
-- 之后重新启用 = 再次执行本激活脚本（幂等检查只认 ACTIVE 行，会追加新版本）。
--
-- ---------------------------------------------------------------------------
-- Owner 执行顺序（dogfood 启动后，与 ops/deploy/DOGFOOD.md 配合）：
--   1. 应用全量迁移；
--   2. psql 执行本脚本（保持 VC_RETENTION_PURGE_ENABLED=false）；
--   3. 可先手工复核：SELECT * FROM vc.run_retention_category('NORMAL_CHAT', true);
--      （vc_api/超级用户可执行；返回待删行数，不删任何行）
--   4. 设置 VC_RETENTION_PURGE_ENABLED=true，保持 VC_RETENTION_DRY_RUN=true，
--      观察至少一次调度 DRY_RUN run 计数；
--   5. 复核无误后再设 VC_RETENTION_DRY_RUN=false 启用真实清理。
-- ---------------------------------------------------------------------------
