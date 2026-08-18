-- 103_relationship_presentation: COMP-PRES V48 — gender/avatar presentation.
--
-- FR-COMP-002: gender presentation (FEMALE/MALE/NEUTRAL) is separate from the
-- persona, every companion stays an adult role (fixed), avatars may only
-- reference platform-curated companion-presentation assets and photo upload is
-- not supported in v1. Covers: create defaults (gender NEUTRAL,
-- AVATAR_NEUTRAL_01); update writes and surfaces the new OUT columns;
-- unapproved gender/avatar_ref RAISE; foreign ids return FALSE without
-- disclosing existence; a non-vc_api role cannot execute the update.

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
    v_gender text;
    v_avatar text;
    v_ok boolean;
    n int;
BEGIN
    v_rel := 10;

    SELECT out_gender, out_avatar_ref
      INTO v_gender, v_avatar
      FROM vc.get_relationship(1, v_rel);
    IF v_gender IS DISTINCT FROM 'NEUTRAL'
       OR v_avatar IS DISTINCT FROM 'AVATAR_NEUTRAL_01' THEN
        RAISE EXCEPTION 'create presentation defaults mismatch gender=% avatar=%',
            v_gender, v_avatar;
    END IF;

    v_ok := vc.update_relationship_prefs(
        1, v_rel, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
        false, 'SESSION', '', 'FEMALE', 'AVATAR_FEMALE_01');
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'owned update must succeed';
    END IF;

    SELECT out_gender, out_avatar_ref
      INTO v_gender, v_avatar
      FROM vc.get_relationship(1, v_rel);
    IF v_gender IS DISTINCT FROM 'FEMALE'
       OR v_avatar IS DISTINCT FROM 'AVATAR_FEMALE_01' THEN
        RAISE EXCEPTION 'updated presentation mismatch gender=% avatar=%',
            v_gender, v_avatar;
    END IF;

    SELECT count(*) INTO n FROM vc.list_relationships(1)
     WHERE out_gender = 'FEMALE' AND out_avatar_ref = 'AVATAR_FEMALE_01';
    IF n <> 1 THEN
        RAISE EXCEPTION 'list must surface the updated presentation';
    END IF;

    BEGIN
        PERFORM vc.update_relationship_prefs(
            1, v_rel, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
            false, 'SESSION', '', 'OTHER', 'AVATAR_NEUTRAL_01');
        RAISE EXCEPTION 'unapproved gender unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved gender unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM vc.update_relationship_prefs(
            1, v_rel, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
            false, 'SESSION', '', 'MALE', 'UPLOADED_PHOTO_99');
        RAISE EXCEPTION 'unapproved avatar_ref unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved avatar_ref unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;

    IF vc.update_relationship_prefs(
           1, 999999, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
           false, 'SESSION', '', 'MALE', 'AVATAR_MALE_01') IS NOT FALSE THEN
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
            false, 'SESSION', '', 'FEMALE', 'AVATAR_FEMALE_01');
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
        false, 'SESSION', '', 'MALE', 'AVATAR_MALE_01');
    RAISE EXCEPTION 'vc_worker unexpectedly executed update_relationship_prefs';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;