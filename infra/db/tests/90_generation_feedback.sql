-- 90_generation_feedback: FEEDBACK V35 — record_generation_feedback writes one
-- owner-scoped row per (generation, kind), repeats of the same kind are
-- idempotent (the first note wins), unapproved kinds RAISE, a foreign or
-- absent generation returns no rows (existence never disclosed), and a
-- non-vc_api role cannot execute the function.

\set ON_ERROR_STOP on

TRUNCATE vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
-- Seed one owned generation for feedback via the reception SD (vc_api has no
-- direct DML on vc.generation, V16).
DO $$
DECLARE
    v_gen  bigint;
    v_note text;
BEGIN
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, 100, 'key-55', 'user', 'hello');
    IF v_gen IS NULL THEN
        RAISE EXCEPTION 'reception failed to create the seed generation';
    END IF;

    -- First feedback row records the note.
    SELECT o_note INTO v_note
      FROM vc.record_generation_feedback(1, v_gen, 'FACTUAL_ERROR', '数字不对');
    IF v_note IS DISTINCT FROM '数字不对' THEN
        RAISE EXCEPTION 'first feedback must record the note (got %)', v_note;
    END IF;

    -- Repeat of the same kind is idempotent and keeps the first note.
    SELECT o_note INTO v_note
      FROM vc.record_generation_feedback(1, v_gen, 'FACTUAL_ERROR', '第二次的备注');
    IF v_note IS DISTINCT FROM '数字不对' THEN
        RAISE EXCEPTION 'repeat feedback must keep the first note (got %)', v_note;
    END IF;

    -- A different kind records a separate row.
    PERFORM * FROM vc.record_generation_feedback(1, v_gen, 'UNSAFE', NULL);

    -- Unapproved kind RAISEs even for direct callers (defense in depth).
    BEGIN
        PERFORM * FROM vc.record_generation_feedback(1, v_gen, 'TOO_SLOW', NULL);
        RAISE EXCEPTION 'unapproved feedback kind unexpectedly succeeded';
    EXCEPTION
        WHEN OTHERS THEN
            -- expected: the SD guard raises before any write
    END;
END $$;

COMMIT;
RESET ROLE;

-- Row-count assertions run as superuser: vc_api has no direct read on
-- vc.generation_feedback (V16 business-table isolation).
DO $$
DECLARE
    v_gen  bigint;
    v_rows int;
BEGIN
    SELECT id INTO v_gen FROM vc.generation
     WHERE owner_user_id = 1 AND idempotency_key = 'key-55';
    SELECT count(*) INTO v_rows FROM vc.generation_feedback
     WHERE owner_user_id = 1 AND generation_id = v_gen AND kind = 'FACTUAL_ERROR';
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'repeat feedback must not duplicate the row (got % rows)', v_rows;
    END IF;
    SELECT count(*) INTO v_rows FROM vc.generation_feedback
     WHERE owner_user_id = 1 AND generation_id = v_gen;
    IF v_rows <> 2 THEN
        RAISE EXCEPTION 'two kinds must yield two rows (got %)', v_rows;
    END IF;
END $$;

-- A foreign or absent generation returns no rows (never discloses existence).
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rows int;
BEGIN
    SELECT count(*) INTO v_rows
      FROM vc.record_generation_feedback(1, 99999, 'UNSAFE', NULL);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'absent generation must return no rows (got %)', v_rows;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A non-vc_api role must NOT be able to call the function (closed by default).
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.record_generation_feedback(1, 55, 'UNSAFE', NULL);
    RAISE EXCEPTION 'vc_worker unexpectedly executed record_generation_feedback';
EXCEPTION
    WHEN insufficient_privilege THEN
        -- expected: EXECUTE was revoked from PUBLIC and granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
