-- 65_generation_intake_workitem_promotion: V25 intake 原语语义（TASK-0174）。
--
-- V25 后 vc_api 获得 create_conversation / enqueue_work_item / promote_generation
-- 的 EXECUTE。本测试实证：
--   1) create_conversation：在 owner 的 relationship 下建 conversation，返回 id；
--      无 server-trusted context RAISE。
--   2) enqueue_work_item：入队 PENDING work_item（kind/ref_id/payload），返回 id；
--      coordinator 可枚举该 owner（list_pending_owner_ids）；无 context RAISE。
--   3) promote_generation：CREATED→IN_PROGRESS→FINAL_REVIEW 合法；非法转换
--      （如 CREATED→FINAL_REVIEW 跳级）或不支持目标 RAISE。
-- 终态验证走 superuser（vc_api 无 work_item/generation SELECT，test 63 模式）。
--
-- 所有 vc_api SD 调用需在 SET LOCAL vc.owner_user_id 事务内（V17 trusted-owner
-- 断言）；负测（无 context）在 autocommit 无 SET LOCAL 下验证 RAISE。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- ---------------------------------------------------------------------------
-- 1) create_conversation：先建 relationship（V9），再建 conversation。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE v_rel bigint; v_conv bigint;
BEGIN
    v_rel := vc.create_relationship(1, 'persona-alpha');
    IF v_rel IS NULL OR v_rel <= 0 THEN
        RAISE EXCEPTION 'create_relationship must return a positive id, got %', v_rel;
    END IF;
    v_conv := vc.create_conversation(1, v_rel);
    IF v_conv IS NULL OR v_conv <= 0 THEN
        RAISE EXCEPTION 'create_conversation must return a positive id, got %', v_conv;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.conversation WHERE owner_user_id = 1;
    IF n <> 1 THEN
        RAISE EXCEPTION 'expected 1 conversation for owner 1, got %', n;
    END IF;
END $$;

-- 无 server-trusted context（无 SET LOCAL owner）：参数与 GUC 不匹配 RAISE。
-- 用硬编码非 NULL relationship_id（避免 vc_api 无 context 时 SELECT 被 RLS 过滤
-- 返回 NULL 而先触发参数检查）；trusted-owner 断言在参数检查之后。
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.create_conversation(1, 1);
        RAISE EXCEPTION 'create_conversation without trusted context should fail';
    EXCEPTION WHEN OTHERS THEN
        IF position('must match server-trusted' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'create_conversation no-context: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2) enqueue_work_item：入队 PENDING work_item；coordinator 可枚举。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE v_rel bigint; v_conv bigint; v_gen bigint; v_work bigint; v_owners int;
BEGIN
    SELECT id INTO v_rel FROM vc.relationship WHERE owner_user_id = 1 LIMIT 1;
    SELECT id INTO v_conv FROM vc.conversation WHERE owner_user_id = 1 LIMIT 1;

    -- receive_generation 创建 generation(CREATED) + user message。
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-65', 'user', 'hello');

    -- enqueue_work_item(kind=GENERATION, ref_id=generation_id)。
    v_work := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    IF v_work IS NULL OR v_work <= 0 THEN
        RAISE EXCEPTION 'enqueue_work_item must return a positive id, got %', v_work;
    END IF;

    -- coordinator 枚举：owner 1 有 PENDING work_item。
    SELECT count(*) INTO v_owners FROM vc.list_pending_owner_ids();
    IF v_owners <> 1 THEN
        RAISE EXCEPTION 'list_pending_owner_ids expected owner 1, got % owners', v_owners;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.work_item WHERE owner_user_id = 1 AND status = 'PENDING';
    IF n <> 1 THEN
        RAISE EXCEPTION 'expected 1 PENDING work_item, got %', n;
    END IF;
END $$;

-- 无 context enqueue RAISE。
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.enqueue_work_item(1, 'GENERATION', 1, NULL);
        RAISE EXCEPTION 'enqueue_work_item without trusted context should fail';
    EXCEPTION WHEN OTHERS THEN
        IF position('must match server-trusted' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'enqueue no-context: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) promote_generation：CREATED→IN_PROGRESS→FINAL_REVIEW 合法；非法转换 RAISE。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE v_conv bigint; v_gen bigint; v_st text;
BEGIN
    SELECT id INTO v_conv FROM vc.conversation WHERE owner_user_id = 1 LIMIT 1;
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-65b', 'user', 'hi');

    -- 当前状态应为 CREATED。
    SELECT status INTO v_st FROM vc.generation WHERE id = v_gen;
    IF v_st <> 'CREATED' THEN
        RAISE EXCEPTION 'expected CREATED, got %', v_st;
    END IF;

    -- CREATED → IN_PROGRESS（合法）。
    v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    IF v_st <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'promote to IN_PROGRESS returned %', v_st;
    END IF;

    -- IN_PROGRESS → FINAL_REVIEW（合法）。
    v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    IF v_st <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'promote to FINAL_REVIEW returned %', v_st;
    END IF;

    -- 非法：CREATED → FINAL_REVIEW 跳级（用一个新 CREATED generation 验证）。
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-65c', 'user', 'skip');
    BEGIN
        PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
        RAISE EXCEPTION 'CREATED->FINAL_REVIEW skip must fail';
    EXCEPTION WHEN OTHERS THEN
        IF position('illegal transition' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'skip promote: unexpected error: %', SQLERRM;
        END IF;
    END;

    -- 非法：不支持的目标状态（如 'COMPLETED'，那是 finalize 的职责）。
    BEGIN
        PERFORM vc.promote_generation(1, v_gen, 'COMPLETED');
        RAISE EXCEPTION 'promote to COMPLETED must fail';
    EXCEPTION WHEN OTHERS THEN
        IF position('unsupported target status' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'promote COMPLETED: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;
