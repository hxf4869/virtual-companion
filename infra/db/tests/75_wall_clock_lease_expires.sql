-- 75_wall_clock_lease_expires: lease 按墙钟真实过期（TASK-0194）。
--
-- PostgreSQL now() 是事务开始时间戳；全仓迁移在 V28 前无 clock_timestamp()。V28 把
-- claim/renew/terminalize/recover 的 lease 时间源改为 clock_timestamp()。本测试在
-- 同一长事务内实证：
--   1) claim(lease=2s) 后 pg_sleep(3)——事务内 now() 仍固定、墙钟已过 lease；
--   2) assert_active_claim → RAISE（显式 guard 用墙钟判过期）；
--   3) per-item complete_work_item → 0 行（迟到写拒绝，INV-WORKER-001）；
--   4) per-item renew_lease → 0 行（过期 claim 无法续租）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_token text;
    v_rows  int;
BEGIN
    -- 2 秒 lease 的 claim；同一事务内停留 3 秒墙钟。
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-75', 2, 16)
     WHERE id = 1;
    IF v_token IS NULL THEN
        RAISE EXCEPTION 'claim must return a token';
    END IF;

    PERFORM pg_sleep(3);

    -- now() 仍是事务开始时间戳；clock_timestamp() 已越过 lease。
    BEGIN
        PERFORM vc.assert_active_claim(1, 1, v_token, 'FENCE-75');
        RAISE EXCEPTION 'assert_active_claim must reject a wall-clock-expired lease';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%assert_active_claim must reject a wall-clock-expired lease%' THEN
            RAISE;
        END IF;
        IF position('not active' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;

    SELECT vc.complete_work_item(1, v_token, 'FENCE-75') INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'complete after wall-clock expiry must write 0 rows, got %', v_rows;
    END IF;

    SELECT vc.renew_lease(1, v_token, 'FENCE-75', 30) INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'renew after wall-clock expiry must write 0 rows, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- 终态：item 仍 CLAIMED（无任何迟到写入）。
DO $$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM vc.work_item WHERE id = 1;
    IF v_status <> 'CLAIMED' THEN
        RAISE EXCEPTION 'expired claim must stay CLAIMED, got %', v_status;
    END IF;
END $$;
