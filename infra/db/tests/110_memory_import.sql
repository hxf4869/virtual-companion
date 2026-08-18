-- 110_memory_import: MEM-IMPORT V55 — FR-COMP-004 explicit archive/import.
--
-- Default reset/delete does not create an archive. retain_importable snapshots
-- ACCEPTED RELATIONSHIP memories. Import copies them into the target
-- Companion and consumes the archive. Discard removes the archive. Same
-- persona create does not inherit unless import is called. Foreign ids hide
-- existence. Only vc_api may execute the new functions.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.outbox_event, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account,
         vc.memory_import_bundle, vc.memory_evidence, vc.memory_item,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_mem bigint;
    v_n integer;
    v_imported integer;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_memory_candidate(
        1, v_rel, 'RELATIONSHIP', 'likes quiet evenings', NULL, ARRAY[]::text[])
      INTO v_mem;
    IF NOT vc.confirm_memory_candidate(1, v_mem) THEN
        RAISE EXCEPTION 'confirm must succeed';
    END IF;

    SELECT count(*) INTO v_n FROM vc.preview_importable_memories(1, 'gentle-listener');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'no archive before retain, got %', v_n;
    END IF;

    IF NOT vc.reset_relationship(1, v_rel, false) THEN
        RAISE EXCEPTION 'default reset must succeed';
    END IF;
    SELECT count(*) INTO v_n FROM vc.preview_importable_memories(1, 'gentle-listener');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'default reset must not archive, got %', v_n;
    END IF;

    SELECT vc.create_memory_candidate(
        1, v_rel, 'RELATIONSHIP', 'likes quiet evenings', NULL, ARRAY[]::text[])
      INTO v_mem;
    IF NOT vc.confirm_memory_candidate(1, v_mem) THEN
        RAISE EXCEPTION 'second confirm must succeed';
    END IF;

    IF NOT vc.reset_relationship(1, v_rel, true) THEN
        RAISE EXCEPTION 'retain reset must succeed';
    END IF;
    SELECT out_item_count INTO v_n FROM vc.preview_importable_memories(1, 'gentle-listener');
    IF v_n IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'retain reset must archive 1, got %', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM vc.list_memory(1, v_rel, false);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'reset still hard-clears live memory, got %', v_n;
    END IF;

    SELECT vc.import_memories_to_relationship(1, v_rel) INTO v_imported;
    IF v_imported IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'import must copy 1, got %', v_imported;
    END IF;
    SELECT count(*) INTO v_n FROM vc.list_memory(1, v_rel, false);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'imported memory missing, got %', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM vc.preview_importable_memories(1, 'gentle-listener');
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'import must consume archive';
    END IF;

    IF vc.import_memories_to_relationship(1, 999999999) IS DISTINCT FROM -1 THEN
        RAISE EXCEPTION 'absent target must return -1';
    END IF;

    IF NOT vc.discard_importable_memories(1, 'gentle-listener') THEN
        RAISE EXCEPTION 'discard of missing archive must still return true';
    END IF;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.preview_importable_memories(2, 'gentle-listener');
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner must not see alice archive';
    END IF;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.preview_importable_memories(1, 'gentle-listener');
    RAISE EXCEPTION 'vc_worker unexpectedly executed preview_importable_memories';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
