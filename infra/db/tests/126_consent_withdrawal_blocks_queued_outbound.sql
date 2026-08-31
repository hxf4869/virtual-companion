-- 126_consent_withdrawal_blocks_queued_outbound: S0-25 让同意撤回立即作用于
-- 实际执行授权——数据库侧闭环。
--
-- legacy runtime 侧（WithdrawnConsentOutboundBlockTest）已证明：外发前的授权复核读取
-- DB 权威（retired authorization snapshot store），撤回后执行排队任务 Provider 外发
-- 为 0、并发撤回不复活、多实例共享权威。本测试证明该权威的数据库侧事实：
--
--   1) 铸造：vc_api 经 V26 create_authorization_snapshots 创建双 ACTIVE 快照；
--   2) 撤回：同一事务内 record_consent(granted=false) +
--      withdraw_authorization_snapshots（ConsentService.record 撤回分支的
--      确切调用序，V41+V46）翻转该 owner 全部 ACTIVE 快照（返回 2）；
--   3) 权威读（ExecutionAuthorizationGuard 外发前复核的同一查询形态，
--      vc_api + server-trusted owner 上下文 + RLS）：双快照均为 WITHDRAWN
--      ——撤回提交后，任何实例的下一次外发前复核都会 fail-closed；
--   4) 历史审计可读：快照行内容完整可查（撤回是状态转换，不是抹除），
--      consent 追加行保留 granted=false 的完整轨迹；
--   5) 不复活：再次撤回返回 0 行，状态保持 WITHDRAWN。

\set ON_ERROR_STOP on

TRUNCATE vc.consent_record, vc.work_item, vc.provider_attempt, vc.generation_usage,
         vc.quota_ledger_entry, vc.realtime_event, vc.outbox_event,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- ---------------------------------------------------------------------------
-- 1)+2)：vc_api 在一个事务里铸造双快照并撤回同意（生产调用序）。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel  bigint;
    v_conv bigint;
    v_gen  bigint;
    v_req  text;
    v_exec text;
    v_n    int;
    v_rows int;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-126', 'user', 'I had a rough day');

    -- 铸造（V26）：双 ACTIVE 快照。
    SELECT out_requested_id, out_execution_id INTO v_req, v_exec
      FROM vc.create_authorization_snapshots(
        1, v_gen, 'alpha-loopback', 'us', 'alpha-standard',
        'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']);
    IF v_req IS NULL OR v_exec IS NULL OR v_req = v_exec THEN
        RAISE EXCEPTION 'create_authorization_snapshots returned invalid ids';
    END IF;
    SELECT count(*) INTO v_n FROM vc.authorization_snapshot
     WHERE owner_user_id = 1 AND status = 'ACTIVE';
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'mint must leave exactly two ACTIVE snapshots (got %)', v_n;
    END IF;

    -- 撤回同意（ConsentService.record(granted=false) 的确切两步调用序）。
    PERFORM vc.record_consent(1, 'MODEL_TRAINING', '2026-08-audit-v1', false);
    v_rows := vc.withdraw_authorization_snapshots(1);
    IF v_rows <> 2 THEN
        RAISE EXCEPTION 'withdrawal must flip exactly the two ACTIVE snapshots (got %)', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 3)：撤回提交后，权威读（guard 外发前复核的查询形态）必须只看到 WITHDRAWN。
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_active int;
    v_row    record;
    v_status text;
BEGIN
    SELECT count(*) INTO v_active FROM vc.authorization_snapshot
     WHERE owner_user_id = 1 AND status = 'ACTIVE';
    IF v_active <> 0 THEN
        RAISE EXCEPTION 'authoritative read must see zero ACTIVE snapshots (got %)', v_active;
    END IF;

    -- 逐条按 snapshot_id 复核（retired authorization snapshot store.find 的形态）：
    -- 每一行都必须以 WITHDRAWN 呈现给外发前复核。
    FOR v_row IN
        SELECT snapshot_id FROM vc.authorization_snapshot WHERE owner_user_id = 1
    LOOP
        SELECT status INTO v_status
          FROM vc.authorization_snapshot
         WHERE snapshot_id = v_row.snapshot_id;
        IF v_status IS DISTINCT FROM 'WITHDRAWN' THEN
            RAISE EXCEPTION 'snapshot % must read WITHDRAWN before outbound (got %)',
                v_row.snapshot_id, v_status;
        END IF;
    END LOOP;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 4)+5)：历史审计可读（全列核对）；再次撤回 0 行、状态不复活。
-- （list_consents 与 withdraw_authorization_snapshots 均要求 server-trusted
-- owner 上下文，与生产调用方一致。）
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_row     record;
    v_count   int;
    v_flipped int;
    v_latest  boolean;
BEGIN
    -- 历史审计：两条快照行的完整内容仍可读（含类别/目的/提供方）。
    SELECT count(*) INTO v_count FROM vc.authorization_snapshot WHERE owner_user_id = 1;
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'history must remain fully readable (got % rows)', v_count;
    END IF;
    FOR v_row IN
        SELECT * FROM vc.authorization_snapshot WHERE owner_user_id = 1
    LOOP
        IF v_row.status <> 'WITHDRAWN'
            OR v_row.provider_id <> 'alpha-loopback'
            OR v_row.region <> 'us'
            OR v_row.contract_ref <> 'alpha-standard'
            OR v_row.purpose <> 'COMPANION_CHAT'
            OR v_row.data_categories <> ARRAY['MESSAGE_TEXT']::text[] THEN
            RAISE EXCEPTION 'audit row % lost its content', v_row.snapshot_id;
        END IF;
    END LOOP;

    -- Consent 轨迹：MODEL_TRAINING 最新行为 granted=false（append-only 历史）。
    SELECT out_granted INTO v_latest
      FROM vc.list_consents(1)
     WHERE out_consent_type = 'MODEL_TRAINING';
    IF v_latest IS NOT FALSE THEN
        RAISE EXCEPTION 'consent audit must show the revoked MODEL_TRAINING state';
    END IF;

    -- 不复活：重复撤回 0 行，状态保持 WITHDRAWN。
    SELECT vc.withdraw_authorization_snapshots(1) INTO v_flipped;
    IF v_flipped <> 0 THEN
        RAISE EXCEPTION 're-withdrawal must be a no-op (flipped %)', v_flipped;
    END IF;
    SELECT count(*) INTO v_count FROM vc.authorization_snapshot
     WHERE owner_user_id = 1 AND status = 'ACTIVE';
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'withdrawn snapshots must never resurrect (ACTIVE=%)', v_count;
    END IF;
END $$;
COMMIT;
RESET ROLE;
