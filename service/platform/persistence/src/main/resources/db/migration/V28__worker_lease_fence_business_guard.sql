-- TASK-0194 V28: worker lease/fence 墙钟生效、outbound 前 attempt intent、
-- 显式 claim guard、per-item terminalize 与失败热循环收敛。
--
-- 外部审计 P1-01/P1-03 与独立复验第 2/4 项修复（不可分割安全基座）：
--   1) 墙钟 lease：claim/renew/terminalize/recover 的时间源 now()（事务开始时间戳）
--      改为 clock_timestamp()（真实墙钟）。同一长事务内 lease 不再“永不过期”。
--   2) outbound 前 attempt intent：新表 vc.attempt_intent + 新函数
--      vc.create_attempt_intent 在外部调用之前以独立短事务创建 status='CREATED' 的
--      intent 行（绑定 owner/work_item/generation/token_hash/fence_hash/
--      providerAttemptId(唯一)/双授权快照/provider 身份）；intent 写入失败 → 事务回滚
--      → 禁止外发（adapter 零调用）。claim token/fence 仅以 SHA-256 hash 形式落库，
--      不存原始 token/fence/proof/secret/凭据。intent 独立建表：provider_attempt
--      （V15/V20，9 列审计表 + record_provider_attempt 兼容路径）结构保持不变，
--      test 40 的“恰 9 列”断言不被破坏。
--   3) 显式 claim guard：vc.assert_active_claim(owner, work_item_id, claim_token,
--      claim_fence) 逐 work item 直接校验行仍 CLAIMED、token/fence 精确匹配、
--      lease_expires_at > clock_timestamp()；不读取也不信任任何 transaction-local GUC
--      作为授权标记；失败 RAISE。业务写入口（candidate/promote/finalize/usage/quota/
--      event 与 work-item complete）必须在同一 guarded finalize 事务内先通过该断言。
--   4) per-item terminalize/renew：新增按 (work_item_id, claim_token, claim_fence) 的
--      complete/fail/cancel/renew_lease，废除共享 token 整批污染（同批一项失败不再把
--      成功项一起标 FAILED）。
--   5) recover_expired_claims 区分：已有 outbound attempt intent 的过期 claim →
--      终止（FAILED）且仍为 CREATED 的 intent 标记 ABANDONED_LATE，绝不回 PENDING
--      再外发；可证明无 intent 的过期 claim → 回 PENDING 可重试（崩溃于 outbound 前）。
--
-- 追加式：不编辑 V1-V27 任何文件（Flyway checksum 安全）。不改公共 adapter 契约。
-- claim_work_items 返回类型（RETURNS TABLE 行类型）变化，必须 DROP + CREATE（V20 对
-- record_provider_attempt 的既有先例），V17 trusted-owner 断言与 job_fence set_config
-- 语义原样保留；V18 search_path 硬化方向保持一致：全部函数 SET search_path =
-- vc, pg_catalog（test 57 G1 要求）。FORCE RLS、复合 owner FK、V27 owner 密码学绑定
-- 与 current_owner_id() 每调用重校验均不被弱化。

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. attempt_intent 表（追加，独立于 provider_attempt 9 列审计表）。
--    provider_attempt_id 全表唯一；status 复用 provider-attempt-statuses 目录
--    （CREATED/SUCCEEDED/.../ABANDONED_LATE，catalog 只读不改）。
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- 自包含：digest() 供 intent token hash 校验

CREATE SEQUENCE IF NOT EXISTS vc.attempt_intent_id_seq;

CREATE TABLE IF NOT EXISTS vc.attempt_intent (
    owner_user_id                     bigint NOT NULL,
    id                                bigint NOT NULL,
    work_item_id                      bigint NOT NULL,
    generation_id                     bigint NOT NULL,
    provider_attempt_id               text   NOT NULL,
    provider_id                       text   NOT NULL,
    supplier_name                     text   NOT NULL,
    status                            text   NOT NULL DEFAULT 'CREATED',
    claim_token_hash                  text   NOT NULL,
    claim_fence_hash                  text   NOT NULL,
    requested_authorization_snapshot  text   NOT NULL,
    execution_authorization_snapshot  text   NOT NULL,
    created_at                        timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    CONSTRAINT attempt_intent_provider_attempt_id_unique UNIQUE (provider_attempt_id),
    FOREIGN KEY (owner_user_id, work_item_id)
        REFERENCES vc.work_item(owner_user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, requested_authorization_snapshot)
        REFERENCES vc.authorization_snapshot(owner_user_id, snapshot_id),
    FOREIGN KEY (owner_user_id, execution_authorization_snapshot)
        REFERENCES vc.authorization_snapshot(owner_user_id, snapshot_id),
    CONSTRAINT attempt_intent_status_check CHECK (
        status IN ('CREATED','SUCCEEDED','RETRYABLE_FAILED','NON_RETRYABLE_FAILED',
                   'TIMED_OUT','CANCELLED','ABANDONED_LATE'))
);

ALTER TABLE vc.attempt_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.attempt_intent FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.attempt_intent;
CREATE POLICY owner_isolation ON vc.attempt_intent FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

CREATE INDEX attempt_intent_work_item_idx
    ON vc.attempt_intent (owner_user_id, work_item_id);

-- 无运行期直接 DML 授权：intent 行的全部写入（create/outcome/abandon）只经
-- SECURITY DEFINER 函数（V16 撤销业务直写方向一致）；测试/回收经 superuser 或 SD 函数。
-- RLS policy 保留为纵深防御。

-- ---------------------------------------------------------------------------
-- 2. create_attempt_intent：outbound 前创建 CREATED intent（审计/幂等锚点）。
--    claim-scoped：work item 必须仍 CLAIMED、token/fence hash 精确匹配、lease 未过期；
--    过期/被接管/无 claim 一律 RAISE → prepare-tx 回滚 → 禁止外发。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_attempt_intent(
    p_owner_user_id                    bigint,
    p_work_item_id                     bigint,
    p_generation_id                    bigint,
    p_claim_token_hash                 text,
    p_claim_fence_hash                 text,
    p_provider_attempt_id              text,
    p_provider_id                      text,
    p_supplier_name                    text,
    p_requested_authorization_snapshot text,
    p_execution_authorization_snapshot text)
    RETURNS TABLE(out_id bigint, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_work_item_id IS NULL THEN
        RAISE EXCEPTION 'create_attempt_intent: work_item_id is required';
    END IF;
    IF p_generation_id IS NULL THEN
        RAISE EXCEPTION 'create_attempt_intent: generation_id is required';
    END IF;
    IF p_claim_token_hash IS NULL OR btrim(p_claim_token_hash) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: claim_token_hash is required';
    END IF;
    IF p_claim_fence_hash IS NULL OR btrim(p_claim_fence_hash) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: claim_fence_hash is required';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: provider_attempt_id is required';
    END IF;
    IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: provider_id is required';
    END IF;
    IF p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: supplier_name is required';
    END IF;
    IF p_requested_authorization_snapshot IS NULL OR btrim(p_requested_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: requested_authorization_snapshot is required';
    END IF;
    IF p_execution_authorization_snapshot IS NULL OR btrim(p_execution_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: execution_authorization_snapshot is required';
    END IF;

    -- claim-scoped：显式逐项校验（work_item_id + token/fence hash + 墙钟 lease）。
    -- 原始 token/fence 不作为参数传入、不落库；仅校验 hash 是否匹配当前 claim。
    PERFORM 1 FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.id = p_work_item_id
       AND wi.status = 'CLAIMED'
       AND encode(digest(wi.claim_token, 'sha256'), 'hex') = p_claim_token_hash
       AND encode(digest(wi.claim_fence, 'sha256'), 'hex') = p_claim_fence_hash
       AND wi.lease_expires_at > clock_timestamp();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_attempt_intent: work item % has no live claim matching the presented token/fence (missing, overtaken or lease expired)',
            p_work_item_id;
    END IF;

    -- generation 必须属于该 owner（存在性隐藏）。
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_attempt_intent: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    v_id := nextval('vc.attempt_intent_id_seq');
    INSERT INTO vc.attempt_intent(
        owner_user_id, id, work_item_id, generation_id, provider_attempt_id,
        provider_id, supplier_name, status,
        claim_token_hash, claim_fence_hash,
        requested_authorization_snapshot, execution_authorization_snapshot)
    VALUES (
        p_owner_user_id, v_id, p_work_item_id, p_generation_id, p_provider_attempt_id,
        p_provider_id, p_supplier_name, 'CREATED',
        p_claim_token_hash, p_claim_fence_hash,
        p_requested_authorization_snapshot, p_execution_authorization_snapshot);

    RETURN QUERY SELECT v_id, p_provider_attempt_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. record_attempt_outcome：外发结束后仅 UPDATE 同一 intent 行的 outcome（不另插一行）。
--    仅允许 CREATED → 终态（SUCCEEDED/RETRYABLE_FAILED/NON_RETRYABLE_FAILED/TIMED_OUT/
--    CANCELLED）；重复更新返回 0 行（幂等失败关闭）。审计闭合不要求 claim 仍活跃
--    （stale worker 可闭合既存 intent 的 outcome，见 4/5 与矛盾消解）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_attempt_outcome(
    p_owner_user_id       bigint,
    p_provider_attempt_id text,
    p_status              text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'record_attempt_outcome: provider_attempt_id is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'SUCCEEDED','RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT','CANCELLED'
    ) THEN
        RAISE EXCEPTION 'record_attempt_outcome: unsupported outcome status %', p_status;
    END IF;

    UPDATE vc.attempt_intent
       SET status = p_status
     WHERE owner_user_id = p_owner_user_id
       AND provider_attempt_id = p_provider_attempt_id
       AND status = 'CREATED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. abandon_late_attempt：stale worker / 回收路径把仍为 CREATED 的既存 intent 闭合为
--    ABANDONED_LATE（审计终态）。仅审计闭合：不创建新 attempt、不写任何业务结果。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.abandon_late_attempt(
    p_owner_user_id       bigint,
    p_provider_attempt_id text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'abandon_late_attempt: provider_attempt_id is required';
    END IF;

    UPDATE vc.attempt_intent
       SET status = 'ABANDONED_LATE'
     WHERE owner_user_id = p_owner_user_id
       AND provider_attempt_id = p_provider_attempt_id
       AND status = 'CREATED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. assert_active_claim：显式 claim guard（非 GUC 授权标记）。逐 work item 校验
--    status=CLAIMED、claim_token/claim_fence 精确匹配、lease_expires_at > 墙钟。
--    任何失败 RAISE → 调用方（guarded finalize/fail 事务）整体回滚 → 业务零写。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.assert_active_claim(
    p_owner_user_id bigint,
    p_work_item_id  bigint,
    p_claim_token   text,
    p_claim_fence   text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_live boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_work_item_id IS NULL THEN
        RAISE EXCEPTION 'assert_active_claim: owner_user_id and work_item_id are required';
    END IF;
    IF p_claim_token IS NULL OR btrim(p_claim_token) = '' THEN
        RAISE EXCEPTION 'assert_active_claim: claim_token is required';
    END IF;
    IF p_claim_fence IS NULL OR btrim(p_claim_fence) = '' THEN
        RAISE EXCEPTION 'assert_active_claim: claim_fence is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'assert_active_claim: owner_user_id must match server-trusted context';
    END IF;

    SELECT (wi.status = 'CLAIMED'
            AND wi.claim_token = p_claim_token
            AND wi.claim_fence = p_claim_fence
            AND wi.lease_expires_at > clock_timestamp())
      INTO v_live
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.id = p_work_item_id;

    IF v_live IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'assert_active_claim: work item % claim is not active (missing / not claimed / wrong token or fence / lease expired)',
            p_work_item_id;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. per-item renew/terminalize（按 work_item_id + claim_token + claim_fence，显式
--    参数而非 GUC）；墙钟 lease。owner 仍来自 server-trusted context（current_owner_id）。
--    与共享 token 版本共存（重载）：共享 token 版保留供既有测试/兼容路径使用，生产
--    worker 只使用 per-item 版本。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.renew_lease(
    p_work_item_id  bigint,
    p_claim_token   text,
    p_claim_fence   text,
    p_lease_seconds integer DEFAULT 30)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows  integer;
BEGIN
    UPDATE vc.work_item
       SET lease_expires_at = clock_timestamp()
               + make_interval(secs => GREATEST(p_lease_seconds, 1))
     WHERE owner_user_id = v_owner
       AND id = p_work_item_id
       AND claim_token = p_claim_token
       AND claim_fence = p_claim_fence
       AND status = 'CLAIMED'
       AND lease_expires_at > clock_timestamp();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.complete_work_item(
    p_work_item_id bigint,
    p_claim_token  text,
    p_claim_fence  text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows  integer;
BEGIN
    UPDATE vc.work_item
       SET status = 'DONE', finished_at = clock_timestamp()
     WHERE owner_user_id = v_owner
       AND id = p_work_item_id
       AND claim_token = p_claim_token
       AND claim_fence = p_claim_fence
       AND status = 'CLAIMED'
       AND lease_expires_at > clock_timestamp();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.fail_work_item(
    p_work_item_id bigint,
    p_claim_token  text,
    p_claim_fence  text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows  integer;
BEGIN
    UPDATE vc.work_item
       SET status = 'FAILED', finished_at = clock_timestamp()
     WHERE owner_user_id = v_owner
       AND id = p_work_item_id
       AND claim_token = p_claim_token
       AND claim_fence = p_claim_fence
       AND status = 'CLAIMED'
       AND lease_expires_at > clock_timestamp();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.cancel_work_item(
    p_work_item_id bigint,
    p_claim_token  text,
    p_claim_fence  text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows  integer;
BEGIN
    UPDATE vc.work_item
       SET status = 'CANCELLED', finished_at = clock_timestamp()
     WHERE owner_user_id = v_owner
       AND id = p_work_item_id
       AND claim_token = p_claim_token
       AND claim_fence = p_claim_fence
       AND status = 'CLAIMED'
       AND lease_expires_at > clock_timestamp();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. claim_work_items：墙钟 lease + 返回 claim_fence（worker 显式持有
--    token/fence 供 guard/per-item terminalize；不再依赖 transaction-local GUC）。
--    返回类型（RETURNS TABLE 行类型）发生变化，必须 DROP + CREATE（V20 先例）；
--    V17 trusted-owner 断言与 job_fence set_config 原样保留（owner set_config 不设，
--    与 V17 一致——RLS/断言只信任 V27 current_owner_id()）。
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.claim_work_items(bigint, text, integer, integer);

CREATE FUNCTION vc.claim_work_items(
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
-- 8. 共享 token 版 renew/terminalize：now() → clock_timestamp()（墙钟 lease 生效）。
--    _terminalize 的 fence 守卫保持 transaction-local GUC 读取（V5 兼容语义，供
--    共享 token 版与既有测试 63/64 使用）；生产 worker 已切换到 per-item 显式 fence 版。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.renew_lease(
    p_token text,
    p_lease_seconds integer DEFAULT 30
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows integer;
BEGIN
    UPDATE vc.work_item
       SET lease_expires_at = clock_timestamp() + make_interval(secs => GREATEST(p_lease_seconds, 1))
     WHERE owner_user_id = v_owner
       AND claim_token = p_token
       AND claim_fence = NULLIF(current_setting('vc.job_fence', true), '')
       AND status = 'CLAIMED'
       AND lease_expires_at > clock_timestamp();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc._terminalize(
    p_token text,
    p_new_status text
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows integer;
BEGIN
    UPDATE vc.work_item
       SET status = p_new_status, finished_at = clock_timestamp()
     WHERE owner_user_id = v_owner
       AND claim_token = p_token
       AND claim_fence = NULLIF(current_setting('vc.job_fence', true), '')
       AND status = 'CLAIMED'
       AND lease_expires_at > clock_timestamp();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. recover_expired_claims：墙钟 + intent 感知区分：
--    a) 过期 CLAIMED 且存在 outbound attempt intent（attempt_intent 行绑定该
--       work_item，任何状态——外发已发生）→ 终止为 FAILED（绝不回 PENDING 再外发）；
--       仍为 CREATED 的 intent 一并闭合为 ABANDONED_LATE（审计终态）。
--    b) 过期 CLAIMED 且可证明无 intent → 回 PENDING（清 token/fence/时间戳），可重试
--       （崩溃于 outbound 前，矩阵 #1）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.recover_expired_claims(p_lease_grace_seconds integer DEFAULT 0)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows   integer;
    v_rows2  integer;
    v_cutoff timestamptz := clock_timestamp() - make_interval(secs => GREATEST(p_lease_grace_seconds, 0));
BEGIN
    -- a) 有 intent 的过期 claim → 终止 FAILED（不回 PENDING）。
    UPDATE vc.work_item u
       SET status = 'FAILED', finished_at = clock_timestamp()
     WHERE u.status = 'CLAIMED'
       AND u.lease_expires_at <= v_cutoff
       AND EXISTS (
           SELECT 1 FROM vc.attempt_intent ai
            WHERE ai.owner_user_id = u.owner_user_id
              AND ai.work_item_id = u.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- 闭合仍为 CREATED 的 intent（含本轮终止与先前独立 fail 遗留的悬挂 intent）。
    UPDATE vc.attempt_intent ai
       SET status = 'ABANDONED_LATE'
      FROM vc.work_item wi
     WHERE wi.status = 'FAILED'
       AND wi.finished_at IS NOT NULL
       AND ai.owner_user_id = wi.owner_user_id
       AND ai.work_item_id = wi.id
       AND ai.status = 'CREATED';

    -- b) 无 intent 的过期 claim → 回 PENDING（可重试）。
    UPDATE vc.work_item u
       SET status = 'PENDING',
           claim_token = NULL,
           claim_fence = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
     WHERE u.status = 'CLAIMED'
       AND u.lease_expires_at <= v_cutoff
       AND NOT EXISTS (
           SELECT 1 FROM vc.attempt_intent ai
            WHERE ai.owner_user_id = u.owner_user_id
              AND ai.work_item_id = u.id);
    GET DIAGNOSTICS v_rows2 = ROW_COUNT;
    RETURN v_rows + v_rows2;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. 权限：新函数 PUBLIC 全撤销，仅授 worker 与 runtime 池角色（V5/V23 同族模式）。
--     assert_active_claim/create_attempt_intent/record_attempt_outcome 由 vc_api 池
--     调用（runtime worker 复用 authDataSource，V23 论证不变）；per-item terminalize
--     与 renew 同 claim 家族；claim_work_items 在 DROP+CREATE 后重新授予（V5+V23
--     语义保持）。recover_expired_claims/list_pending_owner_ids 的 V24 vc_api 授权
--     保持不变。
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text),
    vc.record_attempt_outcome(bigint, text, text),
    vc.abandon_late_attempt(bigint, text),
    vc.assert_active_claim(bigint, bigint, text, text),
    vc.renew_lease(bigint, text, text, integer),
    vc.complete_work_item(bigint, text, text),
    vc.fail_work_item(bigint, text, text),
    vc.cancel_work_item(bigint, text, text),
    vc.claim_work_items(bigint, text, integer, integer)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text),
    vc.record_attempt_outcome(bigint, text, text),
    vc.abandon_late_attempt(bigint, text),
    vc.assert_active_claim(bigint, bigint, text, text),
    vc.renew_lease(bigint, text, text, integer),
    vc.complete_work_item(bigint, text, text),
    vc.fail_work_item(bigint, text, text),
    vc.cancel_work_item(bigint, text, text),
    vc.claim_work_items(bigint, text, integer, integer)
    TO vc_worker, vc_api;

-- ---------------------------------------------------------------------------
-- 11. 迁移末尾 fail-closed DO 块：断言关键不变量（表/约束/函数存在、PUBLIC 无
--     EXECUTE、per-item 版本存在）。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_constraint boolean;
BEGIN
    IF to_regclass('vc.attempt_intent') IS NULL THEN
        RAISE EXCEPTION 'V28: attempt_intent table missing';
    END IF;
    IF to_regprocedure('vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text)') IS NULL THEN
        RAISE EXCEPTION 'V28: create_attempt_intent missing';
    END IF;
    IF to_regprocedure('vc.record_attempt_outcome(bigint,text,text)') IS NULL THEN
        RAISE EXCEPTION 'V28: record_attempt_outcome missing';
    END IF;
    IF to_regprocedure('vc.abandon_late_attempt(bigint,text)') IS NULL THEN
        RAISE EXCEPTION 'V28: abandon_late_attempt missing';
    END IF;
    IF to_regprocedure('vc.assert_active_claim(bigint,bigint,text,text)') IS NULL THEN
        RAISE EXCEPTION 'V28: assert_active_claim missing';
    END IF;
    IF to_regprocedure('vc.complete_work_item(bigint,text,text)') IS NULL
       OR to_regprocedure('vc.fail_work_item(bigint,text,text)') IS NULL
       OR to_regprocedure('vc.cancel_work_item(bigint,text,text)') IS NULL
       OR to_regprocedure('vc.renew_lease(bigint,text,text,integer)') IS NULL THEN
        RAISE EXCEPTION 'V28: per-item claim functions missing';
    END IF;
    SELECT EXISTS (
        SELECT 1 FROM pg_constraint c
         WHERE c.conname = 'attempt_intent_provider_attempt_id_unique'
           AND c.conrelid = 'vc.attempt_intent'::regclass)
      INTO v_constraint;
    IF NOT v_constraint THEN
        RAISE EXCEPTION 'V28: attempt_intent provider_attempt_id unique constraint missing';
    END IF;
    IF has_function_privilege('public',
        'vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V28: create_attempt_intent must not be PUBLIC-executable';
    END IF;
    IF has_function_privilege('public',
        'vc.assert_active_claim(bigint,bigint,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V28: assert_active_claim must not be PUBLIC-executable';
    END IF;
    IF has_function_privilege('public',
        'vc.fail_work_item(bigint,text,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V28: per-item fail_work_item must not be PUBLIC-executable';
    END IF;
END;
$$;
