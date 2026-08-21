-- 80_aborted_tx_independent_per_item_fail: aborted 事务后独立新事务仅终止原项（TASK-0194）。
--
-- 矩阵 #8：guarded finalize 事务内发生永久 PG 错误（本测试以 promote_generation 非法
-- 转换模拟）→ 事务进入 aborted 状态 → 同事务内任何后续写都不可能 → 整体回滚。随后
-- independent-fail-tx（全新事务）仅按原 work_item_id/token/fence per-item fail →
-- FAILED 可靠落库；coordinator 不枚举 terminal → 不再 claim → 热循环停止。
-- 本测试额外验证：独立 fail 不触碰 generation 业务写（回滚的 candidate/promote 未
-- 残留），且 recover 不再回收该 FAILED 项。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation_candidate, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-80-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-80-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE aborted_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) fixture：generation + work item + claim + intent（prepare 段已提交）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_conv  bigint;
    v_gen   bigint;
    v_wi    bigint;
    v_token text;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-80', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-80', 30, 16)
     WHERE id = v_wi;
    PERFORM * FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to('FENCE-80', 'UTF8'), 'sha256'), 'hex'),
        'pa-80-1', 'alpha-loopback', 'alpha-supplier', 'snap-80-req', 'snap-80-exec');
    INSERT INTO aborted_ctx VALUES
        ('gen', v_gen::text), ('wi', v_wi::text), ('tok', v_token);
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) guarded finalize 事务内永久 PG 错误 → 事务真实进入 aborted → 整体回滚。
--    （模拟：IN_PROGRESS 状态下 promote_generation 直转 CANCELLED —— V25 状态
--    机只允许终态化函数走 CANCELLED，promote 直转必 RAISE；该错误不捕获，事务
--    进入 aborted 状态，随后 ROLLBACK。此段临时关闭 ON_ERROR_STOP 以观察真实
--    aborted 语义，错误本身正是被测行为。）
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP off
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen bigint;
    v_wi  bigint;
    v_token text;
BEGIN
    SELECT value::bigint INTO v_gen FROM aborted_ctx WHERE key = 'gen';
    SELECT value::bigint INTO v_wi  FROM aborted_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM aborted_ctx WHERE key = 'tok';

    PERFORM vc.assert_active_claim(1, v_wi, v_token, 'FENCE-80');
    -- 永久错误：IN_PROGRESS 直转 CANCELLED 是非法转换（promote 必 RAISE，
    -- 不捕获）→ 整个事务进入 aborted。
    PERFORM vc.promote_generation(1, v_gen, 'CANCELLED');
END $$;
ROLLBACK;
RESET ROLE;
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 2) independent-fail-tx（全新事务）：仅 per-item fail 原项 → FAILED。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_wi   bigint;
    v_token text;
    v_rows int;
BEGIN
    SELECT value::bigint INTO v_wi FROM aborted_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM aborted_ctx WHERE key = 'tok';
    SELECT vc.fail_work_item(v_wi, v_token, 'FENCE-80') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'independent fail must terminalize the original item, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) 终态：item FAILED 且不被 recover 回收；无 PENDING（coordinator 不枚举 terminal）；
--    generation 业务写零残留（candidate 0 行；generation 非 COMPLETED）。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_ws  text;
    v_rec int;
    v_pending int;
    n_cand int;
    v_gen bigint;
BEGIN
    SELECT value::bigint INTO v_gen FROM aborted_ctx WHERE key = 'gen';
    SELECT status INTO v_ws
      FROM vc.work_item WHERE id = (SELECT value::bigint FROM aborted_ctx WHERE key = 'wi');
    IF v_ws <> 'FAILED' THEN
        RAISE EXCEPTION 'independent fail must leave FAILED, got %', v_ws;
    END IF;
    SELECT vc.recover_expired_claims() INTO v_rec;
    IF v_rec <> 0 THEN
        RAISE EXCEPTION 'recover must not touch the terminal FAILED item, got %', v_rec;
    END IF;
    SELECT count(*) INTO v_pending FROM vc.work_item WHERE status = 'PENDING';
    IF v_pending <> 0 THEN
        RAISE EXCEPTION 'no PENDING item may remain (hot loop), got %', v_pending;
    END IF;
    SELECT count(*) INTO n_cand FROM vc.generation_candidate WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_cand <> 0 THEN
        RAISE EXCEPTION 'rolled-back business writes must not survive, got % candidates', n_cand;
    END IF;
END $$;

DROP TABLE aborted_ctx;
