-- W09-S1: follow-up and proactive policy are a new owner-scoped store.
-- V39 vc.reminder stays untouched for W11.
--
-- Covers: cross-owner read and write fail; a role with no owner context sees
-- nothing; needs_clarification cannot be stored as a triggerable moment; a
-- date-only moment without a confirmed reminder rule is rejected; a confirmed
-- date rule keeps its own instant; export_v2_owner_metadata includes the
-- follow-up; account deletion removes it; go_claim_jobs can claim FOLLOW_UP.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (19001, 'w09 follow-up owner'),
    (19002, 'w09 follow-up other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (19001, 10, 'persona-a', true),
    (19002, 20, 'persona-b', true);

-- V161 rejects a triggerable row that has no memory and source. These two
-- published memories share one current source so the scheduled inserts below
-- keep the same bodies, instants and error text.
INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES (
    19001, 19010, 10, 'w09',
    '19000000-0000-4000-8000-000000001901', 'COMPANION', 'PRESENT', false);
INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
VALUES (
    19001, 19010, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    1, 1, 'st:19000000-0000-4000-8000-000000001901:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1',
    'user', 'w09-source', true, true, true, false, 1);
BEGIN;
SELECT vc.set_owner_context(19001, 'w09src', encode(vc.hmac(convert_to('vc-owner-binding-v1|19001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09src', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status) VALUES
    (19011, 19001, 10, 'RELATIONSHIP', 'w09 dated memory', 'ACCEPTED'),
    (19012, 19001, 10, 'RELATIONSHIP', 'w09 minute memory', 'ACCEPTED');
INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
    (19001, 19021, 19011, 'st:19000000-0000-4000-8000-000000001901:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1'),
    (19001, 19022, 19012, 'st:19000000-0000-4000-8000-000000001901:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
COMMIT;
RESET ROLE;

CREATE TEMP TABLE w09_ids (
    follow_id bigint,
    job_id bigint
);
INSERT INTO w09_ids VALUES (NULL, NULL);
GRANT ALL ON TABLE w09_ids TO vc_api, vc_worker;

-- Rows exist only after the owner transaction below. This first pass pins the
-- empty-context shape before any write.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.follow_up) <> 0 THEN
        RAISE EXCEPTION 'missing owner context leaked follow-ups';
    END IF;
    IF (SELECT count(*) FROM vc.proactive_policy) <> 0 THEN
        RAISE EXCEPTION 'missing owner context leaked proactive policy';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19001, 'w09a', encode(vc.hmac(convert_to('vc-owner-binding-v1|19001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_enabled boolean;
    v_offline boolean;
    v_daily integer;
    v_modes text[];
    v_quiet time;
    v_id bigint;
    v_dated bigint;
    v_unclear bigint;
    v_trigger timestamptz;
BEGIN
    SELECT out_enabled, out_offline_capable, out_daily_limit, out_allowed_modes
      INTO v_enabled, v_offline, v_daily, v_modes
      FROM vc.get_proactive_policy(19001, 10);
    IF v_enabled IS NOT FALSE OR v_offline IS NOT FALSE OR v_daily <> 0
       OR v_modes IS DISTINCT FROM ARRAY['COMPANION']::text[] THEN
        RAISE EXCEPTION 'proactive policy must default off without offline capability';
    END IF;

    PERFORM vc.put_proactive_policy(
        19001, 10, true, '22:00', '08:00', 'Asia/Shanghai', 3, 120, ARRAY['COMPANION'], false);
    SELECT out_enabled, out_offline_capable, out_quiet_start
      INTO v_enabled, v_offline, v_quiet
      FROM vc.get_proactive_policy(19001, 10);
    IF v_enabled IS NOT TRUE OR v_offline IS NOT FALSE OR v_quiet IS DISTINCT FROM time '22:00' THEN
        RAISE EXCEPTION 'owner policy write was not readable';
    END IF;

    BEGIN
        PERFORM vc.insert_follow_up(
            19001, 10, NULL, NULL, NULL, 'should not schedule',
            'SCHEDULED', 'needs_clarification', 'minute', false,
            DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
        RAISE EXCEPTION 'needs_clarification trigger unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: needs_clarification cannot be triggerable' THEN
            RAISE;
        END IF;
    END;

    v_unclear := vc.insert_follow_up(
        19001, 10, NULL, NULL, NULL, 'w09-untriggerable',
        'NEEDS_CLARIFICATION', 'needs_clarification', 'date', false,
        DATE '2026-11-02', NULL, NULL, NULL);
    IF v_unclear IS NULL OR (SELECT trigger_at FROM vc.follow_up WHERE id = v_unclear) IS NOT NULL THEN
        RAISE EXCEPTION 'needs_clarification row must be stored without a trigger';
    END IF;

    BEGIN
        PERFORM vc.insert_follow_up(
            19001, 10, NULL, NULL, NULL, 'date only',
            'SCHEDULED', 'explicit_date', 'date', false,
            DATE '2026-11-02', NULL, 'Asia/Shanghai', timestamptz '2026-11-02 00:00:00+08');
        RAISE EXCEPTION 'date-only trigger unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: date-only moment requires a confirmed reminder rule' THEN
            RAISE;
        END IF;
    END;

    v_dated := vc.insert_follow_up(
        19001, 10, 19011, 'st:19000000-0000-4000-8000-000000001901:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1', 1, 'w09-confirmed-date',
        'SCHEDULED', 'explicit_date', 'date', true,
        DATE '2026-11-02', NULL, 'Asia/Shanghai', timestamptz '2026-11-02 09:30:00+08');
    SELECT trigger_at INTO v_trigger FROM vc.follow_up WHERE id = v_dated;
    IF v_trigger IS DISTINCT FROM timestamptz '2026-11-02 09:30:00+08' THEN
        RAISE EXCEPTION 'confirmed date rule did not keep its own instant';
    END IF;

    v_id := vc.insert_follow_up(
        19001, 10, 19012, 'st:19000000-0000-4000-8000-000000001901:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1', 1, 'w09-follow-up-body',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
    IF v_id IS NULL OR (SELECT count(*) FROM vc.list_follow_ups(19001, 10) WHERE out_id = v_id AND out_body = 'w09-follow-up-body') <> 1 THEN
        RAISE EXCEPTION 'owner cannot read own follow-up';
    END IF;
    IF (SELECT count(*) FROM vc.follow_up) < 3 THEN
        RAISE EXCEPTION 'owner direct read missed follow-ups';
    END IF;

    UPDATE w09_ids SET follow_id = v_id;
END $$;
COMMIT;
RESET ROLE;

-- vc_api has no table privilege on V39 vc.reminder. The leak check stays a
-- zero-row assertion, run as the migration principal after the owner commit.
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.reminder WHERE owner_user_id = 19001) <> 0 THEN
        RAISE EXCEPTION 'follow-up write leaked into vc.reminder';
    END IF;
END $$;

-- Committed rows stay invisible without an owner context.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.follow_up) <> 0 THEN
        RAISE EXCEPTION 'missing owner context leaked follow-ups';
    END IF;
    IF (SELECT count(*) FROM vc.proactive_policy) <> 0 THEN
        RAISE EXCEPTION 'missing owner context leaked proactive policy';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19002, 'w09b', encode(vc.hmac(convert_to('vc-owner-binding-v1|19002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM vc.follow_up;
    IF n <> 0 THEN
        RAISE EXCEPTION 'cross owner read follow-up (% rows)', n;
    END IF;
    SELECT count(*) INTO n FROM vc.proactive_policy;
    IF n <> 0 THEN
        RAISE EXCEPTION 'cross owner read proactive policy (% rows)', n;
    END IF;
    IF (SELECT count(*) FROM vc.list_follow_ups(19002, 20)) <> 0 THEN
        RAISE EXCEPTION 'other owner list returned rows';
    END IF;

    BEGIN
        PERFORM 1 FROM vc.list_follow_ups(19001, 10);
        RAISE EXCEPTION 'cross owner list unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.insert_follow_up(
            19001, 10, NULL, NULL, NULL, 'cross write',
            'SILENT', 'none', NULL, false, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'cross owner insert unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.put_proactive_policy(
            19001, 10, false, NULL, NULL, NULL, 0, 0, ARRAY['COMPANION'], false);
        RAISE EXCEPTION 'cross owner policy write unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN
            RAISE;
        END IF;
    END;
    IF vc.cancel_follow_up(19002, (SELECT follow_id FROM w09_ids)) THEN
        RAISE EXCEPTION 'cross owner cancel succeeded';
    END IF;

    BEGIN
        INSERT INTO vc.follow_up(owner_user_id, relationship_id, body, status, normalization_status, event_id)
        VALUES (19002, 20, 'direct', 'SILENT', 'none', 'direct-event');
        RAISE EXCEPTION 'direct follow-up insert unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    BEGIN
        INSERT INTO vc.proactive_policy(owner_user_id, relationship_id, enabled)
        VALUES (19002, 20, true);
        RAISE EXCEPTION 'direct policy insert unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF (SELECT status FROM vc.follow_up WHERE owner_user_id = 19001 AND id = (SELECT follow_id FROM w09_ids)) IS DISTINCT FROM 'SCHEDULED' THEN
        RAISE EXCEPTION 'cross owner session changed the follow-up';
    END IF;
    IF (SELECT enabled FROM vc.proactive_policy WHERE owner_user_id = 19001 AND relationship_id = 10) IS NOT TRUE THEN
        RAISE EXCEPTION 'cross owner session changed the proactive policy';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(19001, 'w09export', encode(vc.hmac(convert_to('vc-owner-binding-v1|19001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09export', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    doc jsonb;
    v_job bigint;
BEGIN
    SELECT vc.export_v2_owner_metadata(19001) INTO doc;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(doc->'followUps', '[]'::jsonb)) e
         WHERE e->>'body' = 'w09-follow-up-body' AND e->>'status' = 'SCHEDULED'
           AND e->>'triggerAt' IS NOT NULL) THEN
        RAISE EXCEPTION 'export missing follow-up';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(doc->'followUps', '[]'::jsonb)) e
         WHERE e->>'status' = 'NEEDS_CLARIFICATION' AND e->'triggerAt' = 'null'::jsonb) THEN
        RAISE EXCEPTION 'export dropped the untriggerable follow-up';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(doc->'proactivePolicies', '[]'::jsonb)) e
         WHERE e->>'relationshipId' = '10' AND e->>'enabled' = 'true' AND e->>'offlineCapable' = 'false') THEN
        RAISE EXCEPTION 'export missing proactive policy';
    END IF;

    v_job := vc.enqueue_follow_up(19001, (SELECT follow_id FROM w09_ids));
    IF v_job IS NULL THEN
        RAISE EXCEPTION 'enqueue_follow_up returned no job';
    END IF;
    UPDATE w09_ids SET job_id = v_job;
END $$;
COMMIT;
RESET ROLE;

-- Make this kind the oldest pending item so the shared claim limit cannot hide it
-- behind jobs left by earlier tests.
UPDATE vc.work_item
   SET created_at = '-infinity'
 WHERE owner_user_id = 19001
   AND id = (SELECT job_id FROM w09_ids)
   AND kind = 'FOLLOW_UP';

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n
      FROM vc.go_claim_jobs(30, 30, 30, 32, 0, 0) c
     WHERE c.out_kind = 'FOLLOW_UP'
       AND c.out_owner_user_id = 19001
       AND c.out_ref_id = (SELECT follow_id FROM w09_ids)
       AND c.out_job_id = (SELECT job_id FROM w09_ids)
       AND c.out_lease_seconds = 30;
    IF n <> 1 THEN
        RAISE EXCEPTION 'claim did not return FOLLOW_UP (% rows)', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The source fixture makes this an ST-bound account. The existing deletion
-- guard requires a completed ST receipt before the owner row can cascade.
INSERT INTO vc.account_deletion_intent(account_id, username_digest, status, st_status)
VALUES (19001, lpad('190', 64, '0'), 'REQUESTED', 'COMPLETED');
DELETE FROM vc.vc_user WHERE id = 19001;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.follow_up WHERE owner_user_id = 19001) THEN
        RAISE EXCEPTION 'follow-up survived account deletion';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.proactive_policy WHERE owner_user_id = 19001) THEN
        RAISE EXCEPTION 'proactive policy survived account deletion';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.work_item WHERE owner_user_id = 19001 AND kind = 'FOLLOW_UP') THEN
        RAISE EXCEPTION 'follow-up job survived account deletion';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.vc_user WHERE id = 19002) THEN
        RAISE EXCEPTION 'other owner removed';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'vc.reminder'::regclass
           AND pg_get_constraintdef(oid) LIKE '%WAITING_HOST%') THEN
        RAISE EXCEPTION 'V39 reminder status was extended';
    END IF;
END $$;
