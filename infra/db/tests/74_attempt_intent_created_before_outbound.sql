-- 74_attempt_intent_created_before_outbound: outbound 前 CREATED attempt intent（TASK-0194）。
--
-- 实证：
--   1) claim 后、外发前，create_attempt_intent 创建 status='CREATED' 的 intent 行：
--      绑定 owner/work_item/generation/providerAttemptId（唯一）/双授权快照/provider/
--      supplier；claim token/fence 仅以 SHA-256 hash 落库（不存原始值）；
--   2) record_attempt_outcome 只 UPDATE 同一行（CREATED→SUCCEEDED），不另插一行；
--   3) providerAttemptId 唯一约束：同一 id 第二次创建 → unique_violation；
--   4) intent 创建是 claim-scoped：错误 token hash / 错误 fence hash → RAISE；
--   5) 无 server-trusted context 调用 create_attempt_intent → V17 RAISE（fail-closed）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.attempt_intent, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories, task_cancelled, source_data_deleted)
VALUES
    (1, 'snap-74-req', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false),
    (1, 'snap-74-exec', 'ACTIVE', 'alpha-loopback', 'us', 'alpha-standard',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT'], false, false);

-- 跨事务传递 token/fence/生成 id（test 63 模式）。
SET ROLE vc_api;
CREATE TEMP TABLE intent_ctx(key text, value text) ON COMMIT PRESERVE ROWS;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 0) fixture：relationship/conversation/generation + enqueue work item。
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
    v_fence text;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-74', 'user', 'hello');
    v_wi := vc.enqueue_work_item(1, 'GENERATION', v_gen, NULL);

    -- 1) claim（返回显式 claim_fence）。
    SELECT claim_token, claim_fence INTO v_token, v_fence
      FROM vc.claim_work_items(1, 'FENCE-74', 30, 16)
     WHERE id = v_wi;
    IF v_token IS NULL OR v_fence IS DISTINCT FROM 'FENCE-74' THEN
        RAISE EXCEPTION 'claim must return token and the explicit fence';
    END IF;
    INSERT INTO intent_ctx VALUES
        ('gen', v_gen::text), ('wi', v_wi::text),
        ('tok', v_token), ('fen', v_fence);
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 1) 正向：create_attempt_intent 创建 CREATED intent（outbound 前）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen    bigint;
    v_wi     bigint;
    v_token  text;
    v_fence  text;
    v_id     bigint;
    v_paid   text;
    v_status text;
    v_th     text;
    v_fh     text;
    v_wi_col bigint;
BEGIN
    SELECT value::bigint INTO v_gen  FROM intent_ctx WHERE key = 'gen';
    SELECT value::bigint INTO v_wi   FROM intent_ctx WHERE key = 'wi';
    SELECT value INTO v_token FROM intent_ctx WHERE key = 'tok';
    SELECT value INTO v_fence FROM intent_ctx WHERE key = 'fen';

    SELECT out_id, out_provider_attempt_id INTO v_id, v_paid
      FROM vc.create_attempt_intent(
        1, v_wi, v_gen,
        encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
        encode(vc.digest(convert_to(v_fence, 'UTF8'), 'sha256'), 'hex'),
        'pa-74-1', 'alpha-loopback', 'alpha-supplier',
        'snap-74-req', 'snap-74-exec');
    IF v_paid IS DISTINCT FROM 'pa-74-1' THEN
        RAISE EXCEPTION 'create_attempt_intent returned provider_attempt_id %, expected pa-74-1', v_paid;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- intent 行断言（superuser）：CREATED + work_item 绑定 + 仅 hash 落库（原始值不存）。
DO $$
DECLARE
    v_token  text;
    v_fence  text;
    v_status text;
    v_wi_col bigint;
    v_th     text;
    v_fh     text;
BEGIN
    SELECT value INTO v_token FROM intent_ctx WHERE key = 'tok';
    SELECT value INTO v_fence FROM intent_ctx WHERE key = 'fen';
    SELECT status, work_item_id, claim_token_hash, claim_fence_hash
      INTO v_status, v_wi_col, v_th, v_fh
      FROM vc.attempt_intent WHERE owner_user_id = 1 AND provider_attempt_id = 'pa-74-1';
    IF v_status <> 'CREATED' THEN
        RAISE EXCEPTION 'intent must be CREATED, got %', v_status;
    END IF;
    IF v_wi_col IS DISTINCT FROM (SELECT value::bigint FROM intent_ctx WHERE key = 'wi') THEN
        RAISE EXCEPTION 'intent must bind the work item';
    END IF;
    IF v_th IS DISTINCT FROM encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex')
       OR v_fh IS DISTINCT FROM encode(vc.digest(convert_to(v_fence, 'UTF8'), 'sha256'), 'hex') THEN
        RAISE EXCEPTION 'intent must store only the sha256 hashes of token/fence';
    END IF;
    IF v_th = v_token OR v_fh = v_fence THEN
        RAISE EXCEPTION 'intent must never store the raw claim token/fence';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) 正向：record_attempt_outcome 只 UPDATE 同一行（不另插一行）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rows int;
    v_n    int;
    v_st   text;
BEGIN
    SELECT vc.record_attempt_outcome(1, 'pa-74-1', 'SUCCEEDED') INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'record_attempt_outcome must update exactly 1 row, got %', v_rows;
    END IF;
    -- 重复 outcome 更新（已非 CREATED）→ 0 行，幂等失败关闭。
    SELECT vc.record_attempt_outcome(1, 'pa-74-1', 'TIMED_OUT') INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'second outcome update must write 0 rows, got %', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- 行数断言（superuser）：outcome 更新只 UPDATE 同一行，不另插一行。
DO $$
DECLARE
    v_n  int;
    v_st text;
BEGIN
    SELECT count(*), max(status) INTO v_n, v_st
      FROM vc.attempt_intent WHERE owner_user_id = 1 AND provider_attempt_id = 'pa-74-1';
    IF v_n <> 1 OR v_st <> 'SUCCEEDED' THEN
        RAISE EXCEPTION 'outcome update must not insert a second row (rows=%, status=%)', v_n, v_st;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) 负向：providerAttemptId 唯一约束 → unique_violation。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_token text;
    v_fence text;
BEGIN
    SELECT value INTO v_token FROM intent_ctx WHERE key = 'tok';
    SELECT value INTO v_fence FROM intent_ctx WHERE key = 'fen';
    BEGIN
        PERFORM * FROM vc.create_attempt_intent(
            1, (SELECT value::bigint FROM intent_ctx WHERE key = 'wi'),
            (SELECT value::bigint FROM intent_ctx WHERE key = 'gen'),
            encode(vc.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex'),
            encode(vc.digest(convert_to(v_fence, 'UTF8'), 'sha256'), 'hex'),
            'pa-74-1', 'alpha-loopback', 'alpha-supplier',
            'snap-74-req', 'snap-74-exec');
        RAISE EXCEPTION 'duplicate provider_attempt_id must fail';
    EXCEPTION WHEN unique_violation THEN
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4) 负向：错误 token/fence hash → claim-scoped RAISE（intent 不得为伪造 claim 创建）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM * FROM vc.create_attempt_intent(
            1, (SELECT value::bigint FROM intent_ctx WHERE key = 'wi'),
            (SELECT value::bigint FROM intent_ctx WHERE key = 'gen'),
            encode(vc.digest(convert_to('bogus-token', 'UTF8'), 'sha256'), 'hex'),
            encode(vc.digest(convert_to('bogus-fence', 'UTF8'), 'sha256'), 'hex'),
            'pa-74-2', 'alpha-loopback', 'alpha-supplier',
            'snap-74-req', 'snap-74-exec');
        RAISE EXCEPTION 'intent with wrong claim token/fence hash must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%intent with wrong claim token/fence hash must be rejected%' THEN
            RAISE;
        END IF;
        IF position('no live claim' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 5) 负向：无 server-trusted context → V17 RAISE。
-- ---------------------------------------------------------------------------
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM * FROM vc.create_attempt_intent(
            1, 1, 1, 'a', 'b', 'pa-74-3', 'p', 's', 'r', 'e');
        RAISE EXCEPTION 'create_attempt_intent without context must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%create_attempt_intent without context must fail%' THEN
            RAISE;
        END IF;
        IF position('server-trusted' in SQLERRM) = 0
           AND position('current_owner_id' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
RESET ROLE;

DROP TABLE intent_ctx;
