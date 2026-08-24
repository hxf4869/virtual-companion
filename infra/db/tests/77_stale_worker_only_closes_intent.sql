-- 77_stale_worker_only_closes_intent: 过期 worker 只能闭合既存 intent（TASK-0194）。
--
-- lease 墙钟过期后，旧 worker（仍持有进程内 owner proof，可建立新的 owner context）：
--   1) create_attempt_intent（新 attempt）→ RAISE（claim-scoped：无活跃 claim）——
--      stale worker 不得创建新 attempt；
--   2) assert_active_claim → RAISE → 同一 guarded 事务内业务写（candidate 等）整体
--      零写入；
--   3) abandon_late_attempt（既有 CREATED intent）→ 1 行 → ABANDONED_LATE（仅审计闭合）；
--   4) record_attempt_outcome 对已闭合 intent → 0 行（幂等失败关闭）。
-- 终态：provider_attempt 恰 1 行（ABANDONED_LATE），无新 attempt、无业务结果写入。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice-77', 'test-hash', 'USER', 'ACTIVE', 'alice');
UPDATE vc.release_gate SET stage='BETA', eval_passed=true,
    policy_version='test-policy-77', canary_owner_user_id=NULL WHERE id=1;
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-77-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-77-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE stale_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) fixture：generation + work item + claim + CREATED intent。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel  bigint;
    v_conv bigint;
    v_gen  bigint;
    v_wi   bigint;
    v_token text;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-77', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-77', 30, 16)
     WHERE id = v_wi;
    INSERT INTO stale_ctx VALUES
        ('gen', v_gen::text), ('wi', v_wi::text), ('tok', v_token);

    -- outbound 前 intent（CREATED）。
    PERFORM * FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to('FENCE-77', 'UTF8'), 'sha256'), 'hex'),
        'pa-77-1', 'alpha-loopback', 'alpha-supplier',
        'snap-77-req', 'snap-77-exec',
        'test-model', 'test-rev', 'test-prompt', 'test-persona', 'test-config');
END $$;
COMMIT;
RESET ROLE;

-- lease 墙钟过期（模拟 worker 卡死越过 lease）。
UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 second'
 WHERE status = 'CLAIMED';

-- ---------------------------------------------------------------------------
-- stale worker（新事务、新 owner proof）：
--   1) 不得创建新 attempt；2) guard 拒绝 → 业务写零；3) 仅可闭合既存 intent。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen   bigint;
    v_wi    bigint;
    v_token text;
    v_rows  int;
BEGIN
    SELECT value::bigint INTO v_gen  FROM stale_ctx WHERE key = 'gen';
    SELECT value::bigint INTO v_wi   FROM stale_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM stale_ctx WHERE key = 'tok';

    -- 1) 新 attempt intent 被拒（无活跃 claim）。
    BEGIN
        PERFORM * FROM vc.create_attempt_intent(
            1, v_wi, v_gen,
            encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
            encode(vc.digest(convert_to('FENCE-77', 'UTF8'), 'sha256'), 'hex'),
            'pa-77-2', 'alpha-loopback', 'alpha-supplier',
            'snap-77-req', 'snap-77-exec',
            'test-model', 'test-rev', 'test-prompt', 'test-persona', 'test-config');
        RAISE EXCEPTION 'stale worker must not create a new attempt intent';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale worker must not create a new attempt intent%' THEN
            RAISE;
        END IF;
        IF position('no live claim' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;

    -- 2) guard 拒绝 → 同一 guarded 事务内业务写不得发生（本事务随后回滚）。
    BEGIN
        PERFORM vc.assert_active_claim(1, v_wi, v_token, 'FENCE-77');
        RAISE EXCEPTION 'stale worker guard must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale worker guard must fail%' THEN
            RAISE;
        END IF;
        IF position('not active' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;

    -- 3) 审计闭合：既有 intent → ABANDONED_LATE（允许，仅审计）。
    SELECT vc.abandon_late_attempt(1, 'pa-77-1') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'abandon_late_attempt must close exactly 1 intent, got %', v_rows;
    END IF;

    -- 4) 已闭合 intent 的 outcome 更新 → 0 行。
    SELECT vc.record_attempt_outcome(1, 'pa-77-1', 'SUCCEEDED') INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'outcome update on abandoned intent must write 0 rows, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- 终态断言（superuser）：恰 1 个 attempt 且 ABANDONED_LATE；item 仍 CLAIMED；无业务写。
DO $$
DECLARE
    v_n  int;
    v_st text;
    v_ws text;
    v_terminal timestamptz;
BEGIN
    SELECT count(*), max(status), max(terminal_at) INTO v_n, v_st, v_terminal
      FROM vc.attempt_intent WHERE owner_user_id = 1;
    IF v_n <> 1 OR v_st <> 'ABANDONED_LATE' OR v_terminal IS NULL THEN
        RAISE EXCEPTION 'expected exactly 1 terminal ABANDONED_LATE intent, got rows=% status=% terminal=%',
            v_n, v_st, v_terminal;
    END IF;
    SELECT status INTO v_ws FROM vc.work_item WHERE id = (SELECT value::bigint FROM stale_ctx WHERE key = 'wi');
    IF v_ws <> 'CLAIMED' THEN
        RAISE EXCEPTION 'stale worker must not terminalize or write business results, item status=%', v_ws;
    END IF;
END $$;

DROP TABLE stale_ctx;
