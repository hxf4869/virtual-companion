-- 159_dogfood_retention_activation: DOGFOOD-07（ADR-0006 §7.1）— Owner-only
-- 本地 dogfood 批准的 NORMAL_CHAT 30 天正文周期激活（运行时数据操作，非迁移）。
-- 钉死：
--   1. 与 infra/db/dogfood/activate-normal-chat-30d.sql 等价的幂等激活后，
--      active_retention_days('NORMAL_CHAT') = 30；
--   2. 重复执行激活不追加第二个 ACTIVE 行；
--   3. dry-run（vc_api 经 vc.run_retention_category）只计数 >30 天消息、不删行、
--      不失效摘要、不触碰 ACCEPTED 记忆；
--   4. 真实 purge 只删 >30 天 vc.message、同事务失效覆盖它的摘要、保留 <=30 天
--      消息与 ACCEPTED 记忆（结构化记忆保留至主动删除/撤回同意/被替代）；
--   5. 其余 7 类仍 DRAFT：active_retention_days 与 wrapper 一律 fail-closed
--      （不得把 Beta 草案 DRAFT 周期整体置 ACTIVE）。

\set ON_ERROR_STOP on

TRUNCATE vc.retention_legal_hold, vc.conversation_summary, vc.memory_evidence,
         vc.memory_item, vc.identity_auth_event, vc.identity_refresh_token,
         vc.identity_account, vc.message, vc.conversation, vc.relationship,
         vc.vc_user CASCADE;
-- 无论更早的测试（124/152 激活/重置过策略）留下什么状态，本测试从 V70/V104
-- seed 的全 DRAFT 面开始（与 152 相同的归一化）。
UPDATE vc.data_retention_policy SET status = 'DRAFT';

DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
    v_next  int;
    v_rows  int;
    v_days  int;
    v_ver   int;
    i       int;
    v_denied boolean;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-dogfood-retention', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'dogfood-retention-user', '$2a$10$dogfood.hash.placeholder',
        'USER', 'Dogfood') INTO v_user;
    PERFORM set_config('t.user', v_user::text, false);

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user, 1, 1, NULL);
    -- 3 条 >30 天与 2 条 <=30 天（2 天前）的正文。
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, created_at)
    VALUES (v_user, 1, 1, 'user',      'old turn one',   now() - interval '40 days'),
           (v_user, 2, 1, 'user',      'old turn two',   now() - interval '40 days'),
           (v_user, 3, 1, 'assistant', 'old reply',      now() - interval '40 days'),
           (v_user, 4, 1, 'user',      'fresh turn',     now() - interval '2 days'),
           (v_user, 5, 1, 'assistant', 'fresh reply',    now() - interval '2 days');
    -- 摘要覆盖新旧消息：真实 purge 必须把它失效。
    INSERT INTO vc.conversation_summary(
        owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence, service_class)
    VALUES (v_user, 1, 1, 1, 5, 'covers old and fresh', 'model-x',
            'v1', 'chat-v1', 0.9, 'ECONOMY');
    -- 已确认结构化记忆（>30 天）：ADR-0006 §7.1 保留至主动删除/撤回同意/被替代，
    -- 不随 NORMAL_CHAT 周期清理；超龄 PENDING 候选属于仍 DRAFT 的
    -- MEMORY_CANDIDATE 类，本测试同样必须保留。
    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope,
                               summary, status, created_at)
    VALUES (v_user, 1, 1, 'RELATIONSHIP', 'accepted memory', 'ACCEPTED',
            now() - interval '40 days'),
           (v_user, 2, 1, 'RELATIONSHIP', 'pending candidate',
            'PENDING_CONFIRMATION', now() - interval '40 days');

    -- 激活前：NORMAL_CHAT 与其他类别一样 fail-closed。
    v_denied := false;
    BEGIN
        PERFORM vc.active_retention_days('NORMAL_CHAT');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%no active policy%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION '激活前 NORMAL_CHAT 必须 fail-closed';
    END IF;

    -- 与 activate-normal-chat-30d.sql 等价的激活逻辑，连续执行两次验证幂等
    -- （容器内 harness 无法 \i 仓库路径，两处需人工保持同步）。
    v_ver := 0;
    FOR i IN 1..2 LOOP
        SELECT count(*) INTO v_rows FROM vc.data_retention_policy
         WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE';
        IF v_rows = 1 AND EXISTS (
            SELECT 1 FROM vc.data_retention_policy
             WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE'
               AND retain_days = 30) THEN
            NULL; -- 幂等 no-op（第二次执行走此分支）
        ELSIF v_rows <> 0 THEN
            RAISE EXCEPTION '存在非预期的 ACTIVE NORMAL_CHAT 策略（% 行）', v_rows;
        ELSE
            SELECT COALESCE(max(policy_version), 0) + 1 INTO v_next
              FROM vc.data_retention_policy WHERE category = 'NORMAL_CHAT';
            INSERT INTO vc.data_retention_policy(
                policy_version, category, retain_days, active, status)
            VALUES (v_next, 'NORMAL_CHAT', 30, true, 'ACTIVE')
            ON CONFLICT (policy_version, category) DO NOTHING;
            v_ver := v_next;
        END IF;
    END LOOP;

    SELECT count(*) INTO v_rows FROM vc.data_retention_policy
     WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE';
    IF v_rows <> 1 OR v_ver < 2 THEN
        RAISE EXCEPTION '重复激活后应恰好 1 个 ACTIVE 行（追加版本 %），实际 % 行', v_ver, v_rows;
    END IF;
    SELECT retain_days INTO v_days FROM vc.data_retention_policy
     WHERE category = 'NORMAL_CHAT' AND active AND status = 'ACTIVE';
    IF v_days <> 30 THEN
        RAISE EXCEPTION '激活行 retain_days 应为 30，实际 %', v_days;
    END IF;
    v_days := vc.active_retention_days('NORMAL_CHAT');
    IF v_days <> 30 THEN
        RAISE EXCEPTION 'active_retention_days(NORMAL_CHAT) 应为 30，实际 %', v_days;
    END IF;
END $$;

-- dry-run：经 vc_api 的 wrapper（调度器真实路径），只计 3 条 >30 天，零删除。
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_count integer;
BEGIN
    v_count := vc.run_retention_category('NORMAL_CHAT', true);
    IF v_count <> 3 THEN
        RAISE EXCEPTION 'dry-run 应只计数 3 条 >30 天消息，实际 %', v_count;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count FROM vc.message;
    IF v_count <> 5 THEN
        RAISE EXCEPTION 'dry-run 不得删除任何消息，剩余 %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM vc.message
     WHERE created_at < now() - interval '30 days';
    IF v_count <> 3 THEN
        RAISE EXCEPTION '>30 天消息应原样保留 % 条（dry-run 非破坏）', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM vc.conversation_summary WHERE valid;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'dry-run 不得失效摘要';
    END IF;
    SELECT count(*) INTO v_count FROM vc.memory_item WHERE status = 'ACCEPTED';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'dry-run 不得触碰 ACCEPTED 记忆';
    END IF;
END $$;

-- 真实 purge：同一 wrapper 关闭 dry_run；断言只删 3 条旧消息且可幂等重跑。
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_count integer;
BEGIN
    v_count := vc.run_retention_category('NORMAL_CHAT', false);
    IF v_count <> 3 THEN
        RAISE EXCEPTION '真实 purge 应恰好删除 3 条 >30 天消息，实际 %', v_count;
    END IF;
    v_count := vc.run_retention_category('NORMAL_CHAT', false);
    IF v_count <> 0 THEN
        RAISE EXCEPTION '重复 purge 应删除 0 条，实际 %', v_count;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_user  bigint := current_setting('t.user')::bigint;
    v_count integer;
    v_valid boolean;
BEGIN
    SELECT count(*) INTO v_count FROM vc.message;
    IF v_count <> 2 THEN
        RAISE EXCEPTION '<=30 天消息必须保留，剩余 %', v_count;
    END IF;
    SELECT count(*) INTO v_count FROM vc.message
     WHERE owner_user_id = v_user AND id IN (1, 2, 3);
    IF v_count <> 0 THEN
        RAISE EXCEPTION '>30 天消息必须已删除';
    END IF;
    SELECT count(*) INTO v_count FROM vc.message
     WHERE owner_user_id = v_user AND id IN (4, 5);
    IF v_count <> 2 THEN
        RAISE EXCEPTION '2 天内消息必须保留';
    END IF;
    SELECT valid INTO v_valid FROM vc.conversation_summary
     WHERE owner_user_id = v_user AND id = 1;
    IF v_valid IS DISTINCT FROM false THEN
        RAISE EXCEPTION '覆盖被删消息的摘要必须失效';
    END IF;
    SELECT count(*) INTO v_count FROM vc.memory_item WHERE status = 'ACCEPTED';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'ACCEPTED 记忆必须跨过 NORMAL_CHAT purge 保留';
    END IF;
    SELECT count(*) INTO v_count FROM vc.memory_item
     WHERE status = 'PENDING_CONFIRMATION';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'PENDING 候选属于仍 DRAFT 的 MEMORY_CANDIDATE，不得被 NORMAL_CHAT 清理';
    END IF;
END $$;

-- 其余 7 类仍 DRAFT：读取与执行入口双 fail-closed，全表仅 1 个 ACTIVE 行。
DO $$
DECLARE
    c        text;
    v_count  integer;
    v_denied boolean;
BEGIN
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
            RAISE EXCEPTION '% 必须保持 DRAFT（禁止整体 ACTIVE）', c;
        END IF;
    END LOOP;
    v_denied := false;
    BEGIN
        PERFORM vc.run_retention_category('MEMORY_CANDIDATE', false);
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%no active policy%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'DRAFT 类别的 purge wrapper 必须 fail-closed';
    END IF;
    SELECT count(*) INTO v_count FROM vc.data_retention_policy
     WHERE active AND status = 'ACTIVE';
    IF v_count <> 1 THEN
        RAISE EXCEPTION '全表应恰好 1 个 ACTIVE 行（NORMAL_CHAT 30 天），实际 %', v_count;
    END IF;
END $$;

-- 还原策略面：删除本测试追加的版本，全部回到 seed 的 v1 DRAFT，供后续测试使用。
DELETE FROM vc.data_retention_policy WHERE category = 'NORMAL_CHAT' AND policy_version > 1;
UPDATE vc.data_retention_policy SET status = 'DRAFT';
