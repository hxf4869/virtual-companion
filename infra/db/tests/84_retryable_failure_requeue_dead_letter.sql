-- 84_retryable_failure_requeue_dead_letter: V29 RETRY-A 语义（owner-gates 2026-08-15
-- RETRY 项，Owner 2026-08-16 确认）。
--
-- 验证：
--   1) 正测：live claim 的 requeue_retryable_failure → RETRY_SCHEDULED；item 回
--      PENDING、attempt_count=1、next_attempt_at 为确定性 15s 退避窗口、token/fence
--      已清空；
--   2) 退避窗口内不可 claim（claim_work_items 0 行）、list_pending_owner_ids 不枚举
--      该 owner——coordinator 不会 5s 空转；
--   3) 到期后再次 claim + requeue → attempt_count=2、60s 退避窗口；
--   4) 第三次失败（attempt 预算 3 耗尽）→ DEAD_LETTERED，attempt_count=3、finished_at
--      落盘——可见死信终态；
--   5) 负测：非 live claim（已终态）的 requeue → RAISE（fail-closed）；attempt_count
--      与 next_attempt_at 列存在且默认值正确。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL);

SET ROLE vc_api;
CREATE TEMP TABLE retry_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- fixture：owner context 下 claim 1 个 item，把 token/fence 存入临时表。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_wi bigint;
    v_token text;
    v_fence text;
BEGIN
    SELECT id, claim_token, claim_fence INTO v_wi, v_token, v_fence
      FROM vc.claim_work_items(1, 'FENCE-84', 30, 16);
    IF v_wi IS NULL THEN
        RAISE EXCEPTION 'claim expected 1 row';
    END IF;
    IF v_fence <> 'FENCE-84' THEN
        RAISE EXCEPTION 'claim must echo the fence, got %', v_fence;
    END IF;
    INSERT INTO retry_ctx VALUES ('wi', v_wi::text), ('token', v_token);
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) 正测：第一次 RETRYABLE 失败 → RETRY_SCHEDULED，15s 确定性退避。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_branch text;
BEGIN
    SELECT vc.requeue_retryable_failure(
        1,
        (SELECT value::bigint FROM retry_ctx WHERE key = 'wi'),
        (SELECT value FROM retry_ctx WHERE key = 'token'),
        'FENCE-84', 3)
      INTO v_branch;
    IF v_branch <> 'RETRY_SCHEDULED' THEN
        RAISE EXCEPTION 'expected RETRY_SCHEDULED, got %', v_branch;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_status text;
    v_attempts int;
    v_next timestamptz;
    v_token text;
BEGIN
    SELECT status, attempt_count, next_attempt_at, claim_token
      INTO v_status, v_attempts, v_next, v_token
      FROM vc.work_item WHERE owner_user_id = 1 AND id = 1;
    IF v_status <> 'PENDING' THEN
        RAISE EXCEPTION 'requeued item must be PENDING, got %', v_status;
    END IF;
    IF v_attempts <> 1 THEN
        RAISE EXCEPTION 'attempt_count must be 1 after first requeue, got %', v_attempts;
    END IF;
    IF v_next IS NULL OR v_next <= clock_timestamp()
        OR v_next > clock_timestamp() + interval '16 seconds' THEN
        RAISE EXCEPTION 'next_attempt_at must be a 15s deterministic backoff window, got %', v_next;
    END IF;
    IF v_token IS NOT NULL THEN
        RAISE EXCEPTION 'requeued item must clear its claim token';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 退避窗口内：claim 0 行、list_pending_owner_ids 不枚举 owner 1。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(*) INTO v_n FROM vc.claim_work_items(1, 'FENCE-84B', 30, 16);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'not-yet-due item must not be claimable, got % row(s)', v_n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_api;
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(*) INTO v_n FROM vc.list_pending_owner_ids();
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'owner with only a not-yet-due item must not be listed, got %', v_n;
    END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3) 到期后第二次 claim + requeue → attempt_count=2、60s 退避窗口。
-- ---------------------------------------------------------------------------
UPDATE vc.work_item SET next_attempt_at = clock_timestamp() WHERE owner_user_id = 1 AND id = 1;

BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_token text;
    v_branch text;
BEGIN
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-84C', 30, 16);
    IF v_token IS NULL THEN
        RAISE EXCEPTION 'due item must be claimable again';
    END IF;
    UPDATE retry_ctx SET value = v_token WHERE key = 'token';
    SELECT vc.requeue_retryable_failure(
        1,
        (SELECT value::bigint FROM retry_ctx WHERE key = 'wi'),
        v_token, 'FENCE-84C', 3)
      INTO v_branch;
    IF v_branch <> 'RETRY_SCHEDULED' THEN
        RAISE EXCEPTION 'expected RETRY_SCHEDULED on second requeue, got %', v_branch;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_attempts int;
    v_next timestamptz;
BEGIN
    SELECT attempt_count, next_attempt_at INTO v_attempts, v_next
      FROM vc.work_item WHERE owner_user_id = 1 AND id = 1;
    IF v_attempts <> 2 THEN
        RAISE EXCEPTION 'attempt_count must be 2 after second requeue, got %', v_attempts;
    END IF;
    IF v_next IS NULL OR v_next <= clock_timestamp() + interval '50 seconds'
        OR v_next > clock_timestamp() + interval '61 seconds' THEN
        RAISE EXCEPTION 'next_attempt_at must be the 60s deterministic backoff window, got %', v_next;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) 第三次失败耗尽预算（max 3 = initial + 2 retries）→ DEAD_LETTERED。
-- ---------------------------------------------------------------------------
UPDATE vc.work_item SET next_attempt_at = clock_timestamp() WHERE owner_user_id = 1 AND id = 1;

BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_token text;
    v_branch text;
BEGIN
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-84D', 30, 16);
    IF v_token IS NULL THEN
        RAISE EXCEPTION 'due item must be claimable a third time';
    END IF;
    SELECT vc.requeue_retryable_failure(
        1,
        (SELECT value::bigint FROM retry_ctx WHERE key = 'wi'),
        v_token, 'FENCE-84D', 3)
      INTO v_branch;
    IF v_branch <> 'DEAD_LETTERED' THEN
        RAISE EXCEPTION 'expected DEAD_LETTERED on budget exhaustion, got %', v_branch;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_status text;
    v_attempts int;
    v_finished timestamptz;
BEGIN
    SELECT status, attempt_count, finished_at INTO v_status, v_attempts, v_finished
      FROM vc.work_item WHERE owner_user_id = 1 AND id = 1;
    IF v_status <> 'DEAD_LETTERED' THEN
        RAISE EXCEPTION 'exhausted item must be DEAD_LETTERED, got %', v_status;
    END IF;
    IF v_attempts <> 3 THEN
        RAISE EXCEPTION 'attempt_count must equal the full budget at dead-letter, got %', v_attempts;
    END IF;
    IF v_finished IS NULL THEN
        RAISE EXCEPTION 'dead-lettered item must record finished_at';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5) 负测：已终态（DEAD_LETTERED）的 item 再 requeue → RAISE（无 live claim）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_token text := (SELECT value FROM retry_ctx WHERE key = 'token');
BEGIN
    BEGIN
        PERFORM vc.requeue_retryable_failure(1, 1, v_token, 'FENCE-84D', 3);
        RAISE EXCEPTION 'requeue on a terminal item must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF position('no live claim' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- 新列默认值：新插入的 item attempt_count=0、next_attempt_at 为空。
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 2, 'GENERATION', 11, NULL);
DO $$
DECLARE
    v_attempts int;
    v_next timestamptz;
BEGIN
    SELECT attempt_count, next_attempt_at INTO v_attempts, v_next
      FROM vc.work_item WHERE owner_user_id = 1 AND id = 2;
    IF v_attempts <> 0 OR v_next IS NOT NULL THEN
        RAISE EXCEPTION 'new items must default attempt_count=0 and next_attempt_at NULL';
    END IF;
END $$;
