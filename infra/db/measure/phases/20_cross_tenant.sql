-- MEASURE 20_cross_tenant: 10,000 unauthorized probes (§26.3 越权规模化).
--
-- Tenant B (owner 2) repeatedly probes tenant A's (owner 1) data through the
-- four realistic surfaces: RLS table reads, the list/get SD gateways, and a
-- forged owner context. Invariant: leaked rows = 0.
--
-- 异常纪律：只有能按文本明确识别的 server-trusted owner 拒绝才视为预期
-- （SQLSTATE 对所有 RAISE 都是 P0001，不能作为放行依据）；夹具失败、函数
-- 缺失、类型错误等一律直接失败。四个探测面各自独立执行并计数；合法 owner
-- 正向对照保证"系统完全不可用所以泄漏为零"不可能伪装成 PASS。

\set ON_ERROR_STOP on

TRUNCATE vc.memory_item, vc.memory_evidence, vc.work_item, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'mallory');

CREATE TEMP TABLE phase20_ids(rel bigint, conv bigint, gen bigint) ON COMMIT PRESERVE ROWS;

DO $seed$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint; v_cand bigint; v_fin boolean;
    v_mem bigint;
BEGIN
    PERFORM vc.set_owner_context(1, 'seed', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'seed', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-seed', 'user', 'alice private turn');
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, 'alice private answer', false);
    SELECT out_finalized INTO v_fin
      FROM vc.finalize_generation(1, v_gen, v_cand, 'alice private answer',
           '', 0, 0, 0, 'USD', 0, false, NULL);
    -- 一条已确认记忆：list_memory 探测面的合法正向对照需要非空返回。
    v_mem := vc.create_memory_candidate(
        1, v_rel, 'RELATIONSHIP', 'alice private memory', NULL, NULL);
    PERFORM vc.confirm_memory_candidate(1, v_mem);
    -- 临时表归 postgres 所有：写回探测面参数前先收回 vc_api 角色。
    RESET ROLE;
    DELETE FROM phase20_ids;
    INSERT INTO phase20_ids VALUES (v_rel, v_conv, v_gen);
END $seed$;

-- Positive control: under the legitimate owner every probed surface must
-- actually return the seeded rows — proves the fixtures and surfaces are live
-- before the attacker probes claim "zero leakage".
DO $control$
DECLARE
    v_rel bigint; v_conv bigint; v_gen bigint;
    n int;
BEGIN
    SELECT rel, conv, gen INTO v_rel, v_conv, v_gen FROM phase20_ids;
    PERFORM vc.set_owner_context(1, 'control', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'control', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 1;
    IF n < 1 THEN
        RAISE EXCEPTION 'positive control failed: RLS message read saw % rows', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_messages(1, v_conv, NULL, 100);
    IF n < 1 THEN
        RAISE EXCEPTION 'positive control failed: list_messages saw % rows', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_memory(1, v_rel, false);
    IF n < 1 THEN
        RAISE EXCEPTION 'positive control failed: list_memory saw % rows', n;
    END IF;
    SELECT count(*) INTO n FROM vc.read_generation_snapshot(1, v_gen);
    IF n < 1 THEN
        RAISE EXCEPTION 'positive control failed: generation snapshot saw % rows', n;
    END IF;
END $control$;

-- 10,000 probes as the attacker.
DO $probe$
DECLARE
    i int;
    n int;
    v_rel bigint; v_conv bigint; v_gen bigint;
    v_leak int;
    v_leak_rls int := 0;
    v_leak_msg int := 0;
    v_leak_mem int := 0;
    v_leak_snap int := 0;
    v_rej_msg int := 0;
    v_rej_mem int := 0;
    v_rej_snap int := 0;
BEGIN
    SELECT rel, conv, gen INTO v_rel, v_conv, v_gen FROM phase20_ids;
    FOR i IN 1..10000 LOOP
        PERFORM vc.set_owner_context(2, 'p' || i, encode(vc.hmac(
            convert_to('vc-owner-binding-v1|2|' || pg_backend_pid()
                       || '|' || pg_current_xact_id() || '|' || 'p' || i, 'UTF8'),
            convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
            'sha256'), 'hex'));
        SET LOCAL ROLE vc_api;

        -- Surface 1: RLS table read. RLS filters; it must not raise at all —
        -- any error here is a fixture/surface failure and aborts the phase.
        SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 1;
        v_leak_rls := v_leak_rls + n;

        -- Surface 2: conversation gateway. Only the identifiable
        -- server-trusted owner denial counts as the expected rejection.
        BEGIN
            SELECT count(*) INTO n FROM vc.list_messages(1, v_conv, NULL, 100);
            v_leak_msg := v_leak_msg + n;
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLERRM LIKE '%must match server-trusted context%' THEN
                    v_rej_msg := v_rej_msg + 1;
                ELSE
                    RAISE;
                END IF;
        END;

        -- Surface 3: memory gateway.
        BEGIN
            SELECT count(*) INTO n FROM vc.list_memory(1, v_rel, false);
            v_leak_mem := v_leak_mem + n;
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLERRM LIKE '%does not match server-trusted current_owner_id%' THEN
                    v_rej_mem := v_rej_mem + 1;
                ELSE
                    RAISE;
                END IF;
        END;

        -- Surface 4: generation snapshot gateway.
        BEGIN
            SELECT count(*) INTO n FROM vc.read_generation_snapshot(1, v_gen);
            v_leak_snap := v_leak_snap + n;
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLERRM LIKE '%does not match server-trusted current_owner_id%' THEN
                    v_rej_snap := v_rej_snap + 1;
                ELSE
                    RAISE;
                END IF;
        END;

        COMMIT;
    END LOOP;

    v_leak := v_leak_rls + v_leak_msg + v_leak_mem + v_leak_snap;
    IF v_rej_msg <> 10000 OR v_rej_mem <> 10000 OR v_rej_snap <> 10000 THEN
        RAISE EXCEPTION 'expected fail-closed denials missing: list_messages=% list_memory=% snapshot=% (want 10000 each)',
            v_rej_msg, v_rej_mem, v_rej_snap;
    END IF;
    IF v_leak <> 0 THEN
        RAISE EXCEPTION 'cross-tenant leak detected: % rows (rls=% list_messages=% list_memory=% snapshot=%)',
            v_leak, v_leak_rls, v_leak_msg, v_leak_mem, v_leak_snap;
    END IF;
    RAISE NOTICE 'PHASE 20_cross_tenant PASS scale=10000 leaked_rows=0 rejections list_messages=% list_memory=% snapshot=%',
        v_rej_msg, v_rej_mem, v_rej_snap;
END $probe$;
