-- 82_expired_claim_with_intent_not_resent: 有 outbound intent 的过期 claim 不得重发（TASK-0194）。
--
-- 矩阵 #1/#4/#12：
--   a) 过期 claim 已有 outbound attempt intent → recover 终止为 FAILED（不回 PENDING、
--      不再次外发），仍为 CREATED 的 intent 闭合为 ABANDONED_LATE；list_pending_owner_ids
--      不含该 owner（coordinator 不再 claim）。
--   b) 过期 claim 可证明无 intent（崩溃于 outbound 前）→ recover 回 PENDING 可重试。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-82-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-82-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

SET ROLE vc_api;
CREATE TEMP TABLE resend_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) fixture：两个 owner 各一个 work item；owner 1 的 claim 有 intent（外发已发生），
--    owner 2 的 claim 无 intent（崩溃于 outbound 前）。
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
    -- owner 1：generation + work item + claim + intent（外发已发生）。
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-82', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);
    SELECT claim_token INTO v_token
      FROM vc.claim_work_items(1, 'FENCE-82-A', 30, 16)
     WHERE id = v_wi;
    PERFORM * FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to('FENCE-82-A', 'UTF8'), 'sha256'), 'hex'),
        'pa-82-a', 'alpha-loopback', 'alpha-supplier', 'snap-82-req', 'snap-82-exec');
    INSERT INTO resend_ctx VALUES ('wi-a', v_wi::text);

    -- owner 2 的 work item（claim 后崩溃于 prepare 前，无 intent）。
    INSERT INTO resend_ctx VALUES ('wi-b', '1');
END $$;
COMMIT;
RESET ROLE;

-- owner 2 fixture（superuser 作用域）：claim 已提交但从未创建 intent。
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
-- id from the shared sequence: a hardcoded id collides with ids already
-- allocated by earlier tests (or after a sequence reset / single-file run).
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload)
VALUES (2, nextval('vc.work_item_id_seq'), 'GENERATION', 20, NULL);
UPDATE vc.work_item
   SET status = 'CLAIMED', claim_token = 'tok-b', claim_fence = 'FENCE-82-B',
       claimed_at = clock_timestamp(),
       lease_expires_at = clock_timestamp() + interval '30 seconds'
 WHERE owner_user_id = 2;

-- 两者 lease 均墙钟过期。
UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 second'
 WHERE status = 'CLAIMED';

-- ---------------------------------------------------------------------------
-- 1) recover：owner 1（有 intent）→ FAILED 且 intent ABANDONED_LATE；owner 2（无
--    intent）→ PENDING。返回 2。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
DO $$
DECLARE v_rec int;
BEGIN
    SELECT vc.recover_expired_claims() INTO v_rec;
    IF v_rec <> 2 THEN
        RAISE EXCEPTION 'recover must process both expired claims, got %', v_rec;
    END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
    v_sa text;
    v_sb text;
    v_ast text;
    v_owners int;
BEGIN
    SELECT status INTO v_sa
      FROM vc.work_item WHERE id = (SELECT value::bigint FROM resend_ctx WHERE key = 'wi-a');
    IF v_sa <> 'FAILED' THEN
        RAISE EXCEPTION 'claim with intent must be terminated FAILED (never PENDING), got %', v_sa;
    END IF;
    SELECT status INTO v_sb
      FROM vc.work_item WHERE id = (SELECT value::bigint FROM resend_ctx WHERE key = 'wi-b');
    IF v_sb <> 'PENDING' THEN
        RAISE EXCEPTION 'claim without intent must return PENDING (retryable), got %', v_sb;
    END IF;
    SELECT max(status) INTO v_ast FROM vc.attempt_intent WHERE provider_attempt_id = 'pa-82-a';
    IF v_ast <> 'ABANDONED_LATE' THEN
        RAISE EXCEPTION 'created intent of a never-resent claim must close as ABANDONED_LATE, got %', v_ast;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) coordinator 视角：owner 1 不在 PENDING 队列（不再外发）；owner 2 仍在队列（重试）。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
DO $$
DECLARE v_n int;
BEGIN
    SELECT count(*) INTO v_n
      FROM vc.list_pending_owner_ids() WHERE owner_user_id = 1;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'owner with intent must not be re-listed for claiming';
    END IF;
    SELECT count(*) INTO v_n
      FROM vc.list_pending_owner_ids() WHERE owner_user_id = 2;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'owner without intent must remain listed for retry';
    END IF;
END $$;
RESET ROLE;

DROP TABLE resend_ctx;
