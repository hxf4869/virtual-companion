-- 81_batch_per_item_terminalize_no_pollution: per-item terminalize 无整批污染（TASK-0194）。
--
-- 同批两项共享一个 claim token（V5 一次 claim 签发一个批 token）。V28 提供按
-- (work_item_id, claim_token, claim_fence) 的 per-item complete/fail：
--   1) 同批成功项 complete → DONE，失败项 fail → FAILED，终态互不污染（矩阵 #11）；
--   2) per-item renew 只续租指定项（另一项不受影响）；
--   3) 错误 id/token/fence 组合 → 0 行（迟到/越权拒绝）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload) VALUES
    (1, 1, 'GENERATION', 10, NULL),
    (1, 2, 'GENERATION', 11, NULL),
    (1, 3, 'GENERATION', 12, NULL);

SET ROLE vc_api;
CREATE TEMP TABLE peritem_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- 一次 claim 拿共享批 token（3 项）。
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_token text;
BEGIN
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-81', 30, 16)
      LIMIT 1;
    IF v_token IS NULL THEN
        RAISE EXCEPTION 'claim must return a token';
    END IF;
    INSERT INTO peritem_ctx VALUES ('tok', v_token);
END $$;
COMMIT;
RESET ROLE;

-- 分段事务：项 1 complete、项 2 fail、项 3 renew + complete（per-item，各自事务）。
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_token text;
    v_rows  int;
BEGIN
    SELECT value INTO v_token FROM peritem_ctx WHERE key = 'tok';

    -- 项 1 complete → 1 行（不是整批 3 行）。
    SELECT vc.complete_work_item(1, v_token, 'FENCE-81') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'per-item complete must affect exactly 1 row, got %', v_rows;
    END IF;

    -- 项 2 fail → 1 行（成功项不受污染）。
    SELECT vc.fail_work_item(2, v_token, 'FENCE-81') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'per-item fail must affect exactly 1 row, got %', v_rows;
    END IF;

    -- 项 3 renew 后 complete。
    SELECT vc.renew_lease(3, v_token, 'FENCE-81', 60) INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'per-item renew must affect exactly 1 row, got %', v_rows;
    END IF;
    SELECT vc.complete_work_item(3, v_token, 'FENCE-81') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'per-item complete after renew must affect 1 row, got %', v_rows;
    END IF;

    -- 错误组合 → 0 行：错 id（已 DONE 的 1 再次 complete）、错 token。
    SELECT vc.complete_work_item(1, v_token, 'FENCE-81') INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 're-complete of a terminal item must write 0 rows, got %', v_rows;
    END IF;
    SELECT vc.fail_work_item(3, 'WRONG-TOKEN', 'FENCE-81') INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'wrong token per-item fail must write 0 rows, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- 终态：1=DONE、2=FAILED、3=DONE；无整批污染。
DO $$
DECLARE
    v_s1 text;
    v_s2 text;
    v_s3 text;
BEGIN
    SELECT status INTO v_s1 FROM vc.work_item WHERE id = 1;
    SELECT status INTO v_s2 FROM vc.work_item WHERE id = 2;
    SELECT status INTO v_s3 FROM vc.work_item WHERE id = 3;
    IF v_s1 <> 'DONE' OR v_s2 <> 'FAILED' OR v_s3 <> 'DONE' THEN
        RAISE EXCEPTION 'per-item terminals polluted: 1=% 2=% 3=%', v_s1, v_s2, v_s3;
    END IF;
END $$;

DROP TABLE peritem_ctx;
