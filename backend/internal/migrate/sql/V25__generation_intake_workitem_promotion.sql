-- TASK-0174 V25: generation HTTP 纵切所需的 intake 原语。
--
-- 现状缺口（当前 HEAD a36b36e 代码核实）：
--  - conversation 无创建路径：V16 REVOKE vc_api 对 vc.conversation 的 INSERT，
--    且无 SECURITY DEFINER 创建函数。generation 引用 conversation（FK），intake
--    前必须有 conversation 行。
--  - work_item 无入队路径：V5 只授 vc_job_coordinator 列级 SELECT、vc_worker SELECT，
--    vc_api 对 work_item 表零 DML；无 SD 入队函数。runtime intake（vc_api 身份）无法
--    入队 GENERATION work_item 供 coordinator/worker 消费。
--  - generation 状态机缺 CREATED→IN_PROGRESS→FINAL_REVIEW 转换：receive_generation
--    创建 status='CREATED'，finalize_generation 要求 status='FINAL_REVIEW'，但全仓无
--    把 generation 推进到 FINAL_REVIEW 的函数（terminalize 只设终态 FAILED_FINAL 等）。
--
-- 本迁移提供（全部 SECURITY DEFINER，SET search_path = vc, pg_catalog，V18 模式）：
--  1. vc.conversation_id_seq + vc.work_item_id_seq —— 两表 composite PK 的 id 分配序列
--     （照 V6 generation_id_seq/message_id_seq 模式）。
--  2. vc.create_conversation(owner, relationship_id) —— INSERT conversation 行。
--  3. vc.enqueue_work_item(owner, kind, ref_id, payload) —— INSERT PENDING work_item。
--  4. vc.promote_generation(owner, generation_id, to_status) —— 合法前进转换
--     CREATED→IN_PROGRESS、IN_PROGRESS→FINAL_REVIEW（SELECT FOR UPDATE 锁 + 状态断言）。
--
-- 安全论证（为什么授 vc_api 不构成越权）：
--  - create_conversation 只在 owner 自己的 relationship 下建 conversation（FK 约束 +
--    V17 trusted-owner 断言 p_owner_user_id IS DISTINCT FROM current_owner_id RAISE）；
--  - enqueue_work_item 只插入 owner 自己的 work_item（FORCE RLS owner_isolation +
--    断言），kind/ref_id/payload 由调用方提供但行隔离不变；
--  - promote_generation 只前进 owner 自己的 generation 状态（FOR UPDATE 锁 + 断言 +
--    RLS），不触碰终态（COMPLETED/FAILED_FINAL 等不可前进）；
--  - 三函数均需 server-trusted owner context（OwnerContext.asOwner 建立的 GUC），
--    与 receive_generation/finalize_generation 同一调用模式。
--
-- 不 REVOKE 任何既有授权；不新增角色；不修改任何既有函数；不新增表/列/约束/状态
-- （conversation/work_item 表已存在，序列是辅助对象）。V1-V24 frozen（migration history checksum
-- 安全）。

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 序列：conversation / work_item 的 composite PK id 分配（照 V6 模式）。
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.conversation_id_seq AS bigint;
CREATE SEQUENCE IF NOT EXISTS vc.work_item_id_seq AS bigint;

GRANT USAGE, SELECT ON SEQUENCE vc.conversation_id_seq, vc.work_item_id_seq TO vc_api;

-- ---------------------------------------------------------------------------
-- create_conversation: 在 owner 的指定 relationship 下建 conversation。
-- 前置：relationship 必须存在且属于 owner（FK 约束 + RLS 双重保证）。
-- 返回新 conversation 的 id。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_conversation(
    p_owner_user_id  bigint,
    p_relationship_id bigint
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'create_conversation: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'create_conversation: relationship_id is required';
    END IF;
    -- V17 trusted-owner 断言：调用参数必须与 server-trusted GUC 一致。
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_conversation: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.conversation_id_seq');
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id)
    VALUES (p_owner_user_id, v_id, p_relationship_id);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- enqueue_work_item: 入队一个 PENDING work_item 供 coordinator/worker 消费。
-- kind/ref_id/payload 是不透明的 worker 元数据（如 kind='GENERATION',
-- ref_id=generation_id）；payload 为 bytea，coordinator 从不读取（V5 列级
-- SELECT 排除 payload）。
-- 返回新 work_item 的 id。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.enqueue_work_item(
    p_owner_user_id bigint,
    p_kind          text,
    p_ref_id        bigint,
    p_payload       bytea DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'enqueue_work_item: owner_user_id is required';
    END IF;
    IF p_kind IS NULL OR btrim(p_kind) = '' THEN
        RAISE EXCEPTION 'enqueue_work_item: kind is required';
    END IF;
    IF p_ref_id IS NULL THEN
        RAISE EXCEPTION 'enqueue_work_item: ref_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'enqueue_work_item: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.work_item_id_seq');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload, status)
    VALUES (p_owner_user_id, v_id, p_kind, p_ref_id, p_payload, 'PENDING');
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- promote_generation: 把 generation 状态前进到指定可取消状态。
-- 合法转换（照 V10 cancel_generation 的可取消状态集合）：
--   CREATED → IN_PROGRESS（worker 开始处理）
--   IN_PROGRESS → FINAL_REVIEW（模型返回候选，待 finalize 原子确认）
-- 其他状态（含终态）前进 RAISE。SELECT FOR UPDATE 锁串行化并发 cancel/finalize。
-- 返回推进后的状态。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.promote_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_to_status      text
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_current text;
    v_valid_map boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'promote_generation: owner_user_id and generation_id are required';
    END IF;
    IF p_to_status NOT IN ('IN_PROGRESS', 'FINAL_REVIEW') THEN
        RAISE EXCEPTION 'promote_generation: unsupported target status %', p_to_status;
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'promote_generation: owner_user_id must match server-trusted context';
    END IF;

    SELECT g.status INTO v_current
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- 合法前进边：仅 CREATED→IN_PROGRESS、IN_PROGRESS→FINAL_REVIEW。
    v_valid_map :=
        (v_current = 'CREATED'      AND p_to_status = 'IN_PROGRESS')
     OR (v_current = 'IN_PROGRESS'  AND p_to_status = 'FINAL_REVIEW');
    IF NOT v_valid_map THEN
        RAISE EXCEPTION 'promote_generation: illegal transition % -> %', v_current, p_to_status;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id
       AND status = v_current;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_generation: generation % lost the transition race (status no longer %)',
            p_generation_id, v_current;
    END IF;

    RETURN p_to_status;
END;
$$;

GRANT EXECUTE ON FUNCTION
    vc.create_conversation(bigint, bigint),
    vc.enqueue_work_item(bigint, text, bigint, bytea),
    vc.promote_generation(bigint, bigint, text)
    TO vc_api;
