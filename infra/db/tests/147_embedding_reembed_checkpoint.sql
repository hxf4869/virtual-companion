-- 147_embedding_reembed_checkpoint: S0-09 dual-space migration, checkpoint,
-- pause/resume, per-item failure isolation, and guarded old-space retirement.

\set ON_ERROR_STOP on

TRUNCATE vc.embedding_reembed_job, vc.memory_embedding, vc.memory_evidence,
         vc.memory_item, vc.relationship, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_owner bigint;
    v_one bigint;
    v_two bigint;
    v_deleted bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-reembed', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'owner-reembed', '$2a$10$user.hash.placeholder', 'USER', 'Owner') INTO v_owner;
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_owner, 1, 'gentle-listener', true);

    PERFORM vc.set_owner_context(v_owner, 'reembed-seed',
        encode(vc.hmac(convert_to(
            'vc-owner-binding-v1|' || v_owner || '|' || pg_backend_pid() || '|'
            || pg_current_xact_id() || '|reembed-seed', 'UTF8'),
            convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
            'sha256'), 'hex'));
    SELECT vc.create_memory_candidate(
        v_owner, 1, 'RELATIONSHIP', 'first active memory', NULL, ARRAY['message:1']) INTO v_one;
    SELECT vc.create_memory_candidate(
        v_owner, 1, 'RELATIONSHIP', 'second active memory', NULL, ARRAY['message:2']) INTO v_two;
    SELECT vc.create_memory_candidate(
        v_owner, 1, 'RELATIONSHIP', 'deleted memory', NULL, ARRAY['message:3']) INTO v_deleted;
    PERFORM vc.confirm_memory_candidate(v_owner, v_one);
    PERFORM vc.confirm_memory_candidate(v_owner, v_two);
    PERFORM vc.confirm_memory_candidate(v_owner, v_deleted);
    PERFORM vc.delete_memory(v_owner, v_deleted);

    CREATE TEMP TABLE reembed_ids(owner_id bigint, one_id bigint, two_id bigint, deleted_id bigint)
        ON COMMIT PRESERVE ROWS;
    INSERT INTO reembed_ids VALUES (v_owner, v_one, v_two, v_deleted);
END $$;

GRANT SELECT ON reembed_ids TO vc_job_coordinator;
-- Seed the old 64-dimensional space, including one deleted row to prove it is
-- never re-embedded. Direct setup is superuser-only; runtime roles remain SD-only.
INSERT INTO vc.memory_embedding(
    owner_user_id, memory_item_id, embedding, embedding_model_id,
    embedding_model_version, dimension, embedding_space_id)
SELECT owner_id, memory_id,
       ('[' || array_to_string(array_fill(0.0::real, ARRAY[64]), ',') || ']')::public.vector,
       'deterministic-hash', '1', 64, 'alpha-hash-64'
  FROM reembed_ids
 CROSS JOIN LATERAL unnest(ARRAY[one_id, two_id, deleted_id]) AS memory_id;

BEGIN;
SET LOCAL ROLE vc_job_coordinator;
DO $$
DECLARE
    v_status text;
    v_last bigint;
    v_count integer;
    v_owner bigint;
    v_one bigint;
    v_two bigint;
    v_vector text := '[' || array_to_string(array_fill(0.25::real, ARRAY[64]), ',') || ']';
BEGIN
    SELECT out_status, out_last_memory_item_id INTO v_status, v_last
      FROM vc.ensure_embedding_reembed_job(
          'provider-r1-64', 'alpha-hash-64', 'provider-model', 'r1', 64, true);
    IF v_status <> 'RUNNING' OR v_last <> 0 THEN
        RAISE EXCEPTION 'new reembed job must start RUNNING at checkpoint 0';
    END IF;

    SELECT count(*) INTO v_count
      FROM vc.claim_embedding_reembed_batch('provider-r1-64', 10);
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'only two active source-space memories must be claimed, got %', v_count;
    END IF;

    SELECT owner_id, one_id, two_id INTO v_owner, v_one, v_two FROM reembed_ids;
    IF NOT vc.complete_embedding_reembed_item(
            'provider-r1-64', v_owner, v_one, 'SUCCEEDED', v_vector) THEN
        RAISE EXCEPTION 'first reembed completion failed';
    END IF;
    IF NOT vc.complete_embedding_reembed_item(
            'provider-r1-64', v_owner, v_two, 'FAILED', NULL) THEN
        RAISE EXCEPTION 'failed item checkpoint was not recorded';
    END IF;

    SELECT count(*) INTO v_count
      FROM vc.claim_embedding_reembed_batch('provider-r1-64', 10);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'first pass should be exhausted';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_status text;
    v_processed bigint;
    v_failures bigint;
    v_old integer;
    v_target integer;
BEGIN
    SELECT status, processed_count, failure_count
      INTO v_status, v_processed, v_failures
      FROM vc.embedding_reembed_job WHERE target_space_id = 'provider-r1-64';
    IF v_status <> 'COMPLETED_WITH_FAILURES' OR v_processed <> 1 OR v_failures <> 1 THEN
        RAISE EXCEPTION 'failed pass status/counts wrong: %/%/%', v_status, v_processed, v_failures;
    END IF;
    SELECT count(*) FILTER (WHERE embedding_space_id = 'alpha-hash-64'),
           count(*) FILTER (WHERE embedding_space_id = 'provider-r1-64')
      INTO v_old, v_target FROM vc.memory_embedding;
    IF v_old <> 3 OR v_target <> 1 THEN
        RAISE EXCEPTION 'dual-space rows wrong before retry: old=% target=%', v_old, v_target;
    END IF;

    BEGIN
        PERFORM vc.retire_embedding_space('alpha-hash-64');
        RAISE EXCEPTION 'old space retired despite failed items';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%retired despite%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no successful completed migration%' THEN RAISE; END IF;
    END;
END $$;

-- Explicit resume resets only the failed pass checkpoint. The successful target
-- row is excluded, so only the missing second row is retried.
BEGIN;
SET LOCAL ROLE vc_job_coordinator;
DO $$
DECLARE
    v_owner bigint;
    v_two bigint;
    v_count integer;
    v_vector text := '[' || array_to_string(array_fill(0.5::real, ARRAY[64]), ',') || ']';
BEGIN
    IF NOT vc.set_embedding_reembed_status('provider-r1-64', 'RUNNING') THEN
        RAISE EXCEPTION 'failed migration did not resume';
    END IF;
    SELECT count(*) INTO v_count
      FROM vc.claim_embedding_reembed_batch('provider-r1-64', 10);
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'retry must claim exactly the missing target row, got %', v_count;
    END IF;
    SELECT owner_id, two_id INTO v_owner, v_two FROM reembed_ids;
    PERFORM vc.complete_embedding_reembed_item(
        'provider-r1-64', v_owner, v_two, 'SUCCEEDED', v_vector);
    PERFORM count(*) FROM vc.claim_embedding_reembed_batch('provider-r1-64', 10);
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_job_coordinator;
DO $$
DECLARE v_deleted bigint;
BEGIN
    SELECT vc.retire_embedding_space('alpha-hash-64') INTO v_deleted;
    IF v_deleted <> 3 THEN
        RAISE EXCEPTION 'old-space retirement deleted %, expected 3', v_deleted;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_status text;
    v_target integer;
BEGIN
    SELECT status INTO v_status FROM vc.embedding_reembed_job
     WHERE target_space_id = 'provider-r1-64';
    IF v_status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'clean retry must complete, got %', v_status;
    END IF;
    SELECT count(*) INTO v_target FROM vc.memory_embedding
     WHERE embedding_space_id = 'provider-r1-64';
    IF v_target <> 2 THEN
        RAISE EXCEPTION 'target space must retain two active rows, got %', v_target;
    END IF;
END $$;
-- Runtime API/worker cannot operate the global migration or direct-DML vectors.
DO $$
BEGIN
    IF has_function_privilege(
            'public', 'vc.claim_embedding_reembed_batch(text,integer)', 'EXECUTE')
       OR has_function_privilege(
            'vc_api', 'vc.claim_embedding_reembed_batch(text,integer)', 'EXECUTE')
       OR has_function_privilege(
            'vc_worker', 'vc.retire_embedding_space(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'reembed/retire functions leaked beyond coordinator';
    END IF;
    IF NOT has_function_privilege(
            'vc_job_coordinator', 'vc.claim_embedding_reembed_batch(text,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'coordinator lacks reembed claim';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_job_coordinator;
DO $$
DECLARE v_denied boolean := false;
BEGIN
    BEGIN
        DELETE FROM vc.memory_embedding;
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'coordinator must not directly delete embedding rows';
    END IF;
END $$;
COMMIT;
RESET ROLE;
