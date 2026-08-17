-- 102_relationship_companion_prefs: COMP-CFG V47 — structured Companion prefs.
--
-- Covers: create defaults (MEDIUM/LOW/LIGHT/ASK_FIRST/RELATIONSHIP, empty
-- avoid list, no names); update_relationship_prefs writes the full record
-- (sorted unique avoid topics); get/list surface the new OUT columns;
-- unapproved catalog codes / over-long names RAISE; foreign ids return FALSE
-- without disclosing existence; a non-vc_api role cannot execute the update.

\set ON_ERROR_STOP on

TRUNCATE vc.age_verification, vc.identity_auth_event, vc.identity_refresh_token,
         vc.identity_account, vc.export_request, vc.consent_record,
         vc.entitlement_snapshot, vc.service_class_assignment, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 10, 'gentle-listener', true);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_name text;
    v_len text;
    v_scope text;
    v_topics text;
    v_ok boolean;
    n int;
BEGIN
    v_rel := 10;

    SELECT out_companion_name, out_reply_length, out_memory_share_scope, out_avoid_topics
      INTO v_name, v_len, v_scope, v_topics
      FROM vc.get_relationship(1, v_rel);
    IF v_name IS NOT NULL OR v_len IS DISTINCT FROM 'MEDIUM'
       OR v_scope IS DISTINCT FROM 'RELATIONSHIP' OR v_topics IS DISTINCT FROM '' THEN
        RAISE EXCEPTION 'create defaults mismatch name=% len=% scope=% topics=%',
            v_name, v_len, v_scope, v_topics;
    END IF;

    v_ok := vc.update_relationship_prefs(
        1, v_rel, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
        false, 'SESSION', 'FAMILY,WORK,WORK');
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'owned update must succeed';
    END IF;

    SELECT out_companion_name, out_reply_length, out_memory_share_scope, out_avoid_topics
      INTO v_name, v_len, v_scope, v_topics
      FROM vc.get_relationship(1, v_rel);
    IF v_name IS DISTINCT FROM '小安' OR v_len IS DISTINCT FROM 'SHORT'
       OR v_scope IS DISTINCT FROM 'SESSION' OR v_topics IS DISTINCT FROM 'FAMILY,WORK' THEN
        RAISE EXCEPTION 'updated prefs mismatch name=% len=% scope=% topics=%',
            v_name, v_len, v_scope, v_topics;
    END IF;

    SELECT count(*) INTO n FROM vc.list_relationships(1)
     WHERE out_companion_name = '小安';
    IF n <> 1 THEN
        RAISE EXCEPTION 'list must surface the updated name';
    END IF;

    BEGIN
        PERFORM vc.update_relationship_prefs(
            1, v_rel, '小安', '老张', 'YELL', 'LOW', 'NONE', 'RARE',
            false, 'SESSION', '');
        RAISE EXCEPTION 'unapproved reply_length unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved reply_length unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM vc.update_relationship_prefs(
            1, v_rel, repeat('x', 33), '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
            false, 'SESSION', '');
        RAISE EXCEPTION 'overlong name unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%overlong name unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM vc.update_relationship_prefs(
            1, v_rel, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
            false, 'SESSION', 'NOT_A_TOPIC');
        RAISE EXCEPTION 'unapproved avoid topic unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved avoid topic unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;

    IF vc.update_relationship_prefs(
           1, 999999, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
           false, 'SESSION', '') IS NOT FALSE THEN
        RAISE EXCEPTION 'absent update must return FALSE';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Cross-owner: bob's context cannot update alice's relationship.
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_ok boolean;
BEGIN
    BEGIN
        v_ok := vc.update_relationship_prefs(
            1, 10, 'x', 'y', 'SHORT', 'LOW', 'NONE', 'RARE',
            false, 'SESSION', '');
        RAISE EXCEPTION 'cross-owner trusted-owner assertion unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cross-owner trusted-owner assertion unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM vc.update_relationship_prefs(
        1, 10, 'x', 'y', 'SHORT', 'LOW', 'NONE', 'RARE',
        false, 'SESSION', '');
    RAISE EXCEPTION 'vc_worker unexpectedly executed update_relationship_prefs';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
