-- 162_model_eligibility: DOGFOOD-STABILIZATION-03 audit defect A — blocked /
-- cancelled turn messages keep data rights but lose model-egress eligibility.
--
-- Covers:
--   * receive_generation stores the user message with model_eligible = true;
--   * INPUT_BLOCKED terminalization flips the turn's user message to
--     model_eligible = false in the SAME transaction while the row and its
--     content stay readable (data rights);
--   * the model-facing history query (model_eligible filter) excludes the
--     blocked turn's text while the unfiltered data-rights read still sees it;
--   * cancel_generation flips the cancelled turn's message;
--   * a cancelled regenerate also flips the REUSED source user message
--     (generation.source_user_message_id branch);
--   * another owner's messages are untouched.

\set ON_ERROR_STOP on

TRUNCATE vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true), (2, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL), (2, 1, 1, NULL);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen1   bigint;
    v_gen2   bigint;
    v_gen3   bigint;
    v_msg1   bigint;
    v_msg2   bigint;
    v_msg3   bigint;
    n        int;
BEGIN
    -- Turn 1: a sensitive message is received, then INPUT_BLOCKED.
    SELECT generation_id, message_id INTO v_gen1, v_msg1
      FROM vc.receive_generation(1, 1, 'elig-1', 'user',
                                 '我的手机号是13800138000，记一下');
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    WHERE m.owner_user_id = 1 AND m.id = v_msg1
                      AND m.model_eligible) THEN
        RAISE EXCEPTION 'fresh message must start model-eligible';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.generation g
                    WHERE g.owner_user_id = 1 AND g.id = v_gen1
                      AND g.source_user_message_id = v_msg1) THEN
        RAISE EXCEPTION 'receive must link source_user_message_id';
    END IF;

    PERFORM vc.promote_generation(1, v_gen1, 'INPUT_REVIEW');
    PERFORM vc.terminalize_generation(1, v_gen1, 'INPUT_BLOCKED', 'chat.blocked');

    -- Data rights: the blocked message row and content survive.
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    WHERE m.owner_user_id = 1 AND m.id = v_msg1
                      AND m.content LIKE '%13800138000%') THEN
        RAISE EXCEPTION 'blocked message must stay persisted with content';
    END IF;
    -- Model egress: eligibility is gone.
    IF EXISTS (SELECT 1 FROM vc.message m
                WHERE m.owner_user_id = 1 AND m.id = v_msg1 AND m.model_eligible) THEN
        RAISE EXCEPTION 'INPUT_BLOCKED must clear model_eligible';
    END IF;

    -- Turn 2: a clean message stays eligible.
    SELECT generation_id, message_id INTO v_gen2, v_msg2
      FROM vc.receive_generation(1, 1, 'elig-2', 'user', '今天天气不错，我们随便聊聊。');
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    WHERE m.owner_user_id = 1 AND m.id = v_msg2 AND m.model_eligible) THEN
        RAISE EXCEPTION 'clean turn message must stay model-eligible';
    END IF;

    -- The model-facing history read excludes the blocked text; the
    -- data-rights (unfiltered) read still returns both rows.
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 1 AND model_eligible;
    IF n <> 1 THEN
        RAISE EXCEPTION 'model-facing read must exclude the blocked message, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 1;
    IF n <> 2 THEN
        RAISE EXCEPTION 'data-rights read must keep both messages, got %', n;
    END IF;

    -- Turn 3: a cancelled turn also loses eligibility.
    SELECT generation_id, message_id INTO v_gen3, v_msg3
      FROM vc.receive_generation(1, 1, 'elig-3', 'user', '再聊一会儿吧');
    PERFORM vc.cancel_generation(1, v_gen3);
    IF EXISTS (SELECT 1 FROM vc.message m
                WHERE m.owner_user_id = 1 AND m.id = v_msg3 AND m.model_eligible) THEN
        RAISE EXCEPTION 'CANCELLED must clear model_eligible';
    END IF;

    -- Turn 4: a cancelled REGENERATE also flips the reused source message.
    PERFORM vc.receive_generation(1, 1, 'elig-4', 'user', '', 'AUTO', v_msg2);
    PERFORM vc.cancel_generation(1, (SELECT id FROM vc.generation
                                      WHERE owner_user_id = 1
                                        AND idempotency_key = 'elig-4'));
    IF EXISTS (SELECT 1 FROM vc.message m
                WHERE m.owner_user_id = 1 AND m.id = v_msg2 AND m.model_eligible) THEN
        RAISE EXCEPTION 'cancelled regenerate must clear the reused source message';
    END IF;
END;
$$;
ROLLBACK;

-- Another owner's messages are untouched. The owner switch needs a FRESH
-- transaction established as the migration owner: vc_api cannot read the
-- HMAC secret table (test 73), so the binding for owner 2 is computed
-- BEFORE SET ROLE — the same shape every other cross-owner test uses.
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.receive_generation(2, 1, 'elig-b1', 'user', 'hello there');
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    WHERE m.owner_user_id = 2 AND m.model_eligible) THEN
        RAISE EXCEPTION 'foreign owner messages must stay eligible';
    END IF;
END;
$$;
COMMIT;

-- DOGFOOD-STABILIZATION-04 (audit defect C): the id-array marker flips
-- SPECIFIC rows — including an OLD turn's row — inside the caller's
-- transaction, never touching another owner's rows.
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_old   bigint;
    v_new   bigint;
    v_rows  int;
    n       int;
BEGIN
    -- An OLD clean, eligible row and a fresh clean row in the same convo.
    SELECT message_id INTO v_old
      FROM vc.receive_generation(1, 1, 'elig-c1', 'user', '旧的干净回合');
    SELECT message_id INTO v_new
      FROM vc.receive_generation(1, 1, 'elig-c2', 'user', '新的干净回合');

    -- Mark ONLY the old row by id (the egress gate's rejection shape).
    SELECT vc.mark_messages_model_ineligible(1, ARRAY[v_old]) INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'the marker must flip exactly one row, got %', v_rows;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.message
                WHERE owner_user_id = 1 AND id = v_old AND model_eligible) THEN
        RAISE EXCEPTION 'the marked row must be ineligible';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.message
                    WHERE owner_user_id = 1 AND id = v_new AND model_eligible) THEN
        RAISE EXCEPTION 'the unmarked row must stay eligible';
    END IF;
    -- Re-marking is a no-op (0 rows) — idempotent rejection handling.
    SELECT vc.mark_messages_model_ineligible(1, ARRAY[v_old]) INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 're-marking must flip nothing, got %', v_rows;
    END IF;

    -- Cross-owner isolation: owner 1 addressing owner 2's row ids (or NULLs
    -- — RLS hides owner 2's rows from this context) flips NOTHING. The
    -- owner-2 eligibility check runs below as the migration owner.
    SELECT vc.mark_messages_model_ineligible(
        1, ARRAY[coalesce((SELECT m.id FROM vc.message m
                            WHERE m.owner_user_id = 2 LIMIT 1), 0)]) INTO v_rows;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'owner 1 must not flip owner 2 rows, got %', v_rows;
    END IF;

    -- A caller whose trusted binding does not match the owner argument is
    -- refused outright (V17 pattern).
    BEGIN
        PERFORM vc.mark_messages_model_ineligible(2, ARRAY[v_old]);
        RAISE EXCEPTION 'unbound owner mark unexpectedly allowed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly allowed%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%server-trusted%' THEN
            RAISE EXCEPTION 'unexpected unbound mark error: %', SQLERRM;
        END IF;
    END;

    -- The model-facing read drops the marked row; the data-rights read
    -- still returns it.
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 1 AND NOT model_eligible;
    IF n < 1 THEN
        RAISE EXCEPTION 'the marked row must be visible as ineligible';
    END IF;

    -- Invalid arguments fail closed.
    BEGIN
        PERFORM vc.mark_messages_model_ineligible(1, ARRAY[]::bigint[]);
        RAISE EXCEPTION 'empty array unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN
            RAISE;
        END IF;
    END;
END;
$$;
ROLLBACK;

-- Owner 2's committed rows stay eligible (read as the migration owner:
-- owner 1's RLS context cannot even see them).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    WHERE m.owner_user_id = 2 AND m.model_eligible) THEN
        RAISE EXCEPTION 'owner 2 rows must stay eligible';
    END IF;
END;
$$;
