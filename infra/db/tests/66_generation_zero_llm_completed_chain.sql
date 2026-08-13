-- 66_generation_zero_llm_completed_chain: ZERO_LLM 确定性完成 SD 链（TASK-0176）。
--
-- 复用既有 SD 函数（V25 promote_generation / V15 insert_generation_candidate /
-- V7 finalize_generation，均已 GRANT vc_api），实证 generation 可经确定性路径
-- 落为 COMPLETED——这正是 GenerationWorkItemHandler ZERO_LLM 分支调用的同一序列：
--   CREATED →(promote) IN_PROGRESS →(promote) FINAL_REVIEW
--           → insert_generation_candidate(确定性串)
--           → finalize_generation(content, provider_ref='', 0 token, outbox=false)
--           → COMPLETED
--
-- 断言（superuser，vc_api 无 generation/provider_attempt/generation_usage 直查权限）：
--   1) generation.status = 'COMPLETED'，assistant_message_id 非空；
--   2) 该 generation 恰好 1 条 final assistant message（INV-GEN-002）；
--   3) provider_attempt 0 行（ZERO_LLM 不外发，不创建 provider_attempt）；
--   4) generation_usage 1 行且 input/output token = 0；
--   5) 终态后 insert_generation_candidate RAISE（INV-GEN-003：终态不接受新候选）。
--
-- 所有 vc_api SD 调用需在 SET LOCAL vc.owner_user_id 事务内（V17 trusted-owner 断言）。

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- ---------------------------------------------------------------------------
-- 正向：ZERO_LLM 确定性 COMPLETED 全链。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel     bigint;
    v_conv    bigint;
    v_gen     bigint;
    v_cand    bigint;
    v_st      text;
    v_content text  := 'I''m not able to help with that. Let''s talk about something else.';
    v_final   boolean;
BEGIN
    v_rel  := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);

    -- receive_generation 创建 generation(CREATED) + user message。
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-66', 'user', 'are you there');

    -- CREATED → IN_PROGRESS。
    v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    IF v_st <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'promote IN_PROGRESS returned %', v_st;
    END IF;

    -- IN_PROGRESS → FINAL_REVIEW。
    v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    IF v_st <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'promote FINAL_REVIEW returned %', v_st;
    END IF;

    -- 插入确定性候选（ZERO_LLM 输出）。
    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, v_content, false);
    IF v_cand IS NULL OR v_cand <= 0 THEN
        RAISE EXCEPTION 'insert_generation_candidate returned no id';
    END IF;

    -- finalize：0 token、provider_ref=''、outbox=false（ZERO_LLM 固定串不产 memory 候选）。
    SELECT out_finalized INTO v_final
      FROM vc.finalize_generation(1, v_gen, v_cand, v_content, '', 0, 0, 0, 'USD', 0, false, NULL);
    IF v_final IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize_generation did not finalize generation %', v_gen;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 断言（superuser）。
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_gen       bigint;
    v_assistant bigint;
    n_msg       int;
    n_attempt   int;
    n_usage     int;
    v_in_tok    bigint;
    v_out_tok   bigint;
    v_status    text;
BEGIN
    SELECT id INTO v_gen FROM vc.generation WHERE owner_user_id = 1 LIMIT 1;
    IF v_gen IS NULL THEN
        RAISE EXCEPTION 'no generation found for owner 1';
    END IF;

    SELECT status, assistant_message_id INTO v_status, v_assistant
      FROM vc.generation WHERE id = v_gen;
    IF v_status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'expected COMPLETED, got %', v_status;
    END IF;
    IF v_assistant IS NULL THEN
        RAISE EXCEPTION 'assistant_message_id must be set after finalize';
    END IF;

    -- INV-GEN-002：恰好 1 条 final assistant message。
    SELECT count(*) INTO n_msg
      FROM vc.message
     WHERE owner_user_id = 1 AND generation_id = v_gen AND role = 'assistant';
    IF n_msg <> 1 THEN
        RAISE EXCEPTION 'expected exactly 1 final assistant message, got %', n_msg;
    END IF;

    -- ZERO_LLM 不外发：provider_attempt 0 行。
    SELECT count(*) INTO n_attempt
      FROM vc.provider_attempt WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_attempt <> 0 THEN
        RAISE EXCEPTION 'ZERO_LLM must not create provider_attempt, got %', n_attempt;
    END IF;

    -- usage 1 行 0 token。
    SELECT count(*), COALESCE(sum(input_tokens), -1), COALESCE(sum(output_tokens), -1)
      INTO n_usage, v_in_tok, v_out_tok
      FROM vc.generation_usage WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF n_usage <> 1 OR v_in_tok <> 0 OR v_out_tok <> 0 THEN
        RAISE EXCEPTION 'expected 1 usage row with 0 tokens, got rows=% in=% out=%',
            n_usage, v_in_tok, v_out_tok;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 负向：终态 generation 不接受新候选（INV-GEN-003）。
-- ---------------------------------------------------------------------------
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_gen bigint;
BEGIN
    SELECT id INTO v_gen FROM vc.generation WHERE owner_user_id = 1 LIMIT 1;
    BEGIN
        PERFORM * FROM vc.insert_generation_candidate(1, v_gen, 'late candidate', false);
        RAISE EXCEPTION 'insert into COMPLETED generation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF position('terminal' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'late insert: unexpected error: %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;
