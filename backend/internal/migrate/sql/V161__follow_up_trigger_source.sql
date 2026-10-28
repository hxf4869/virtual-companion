-- W09-S2: a triggerable follow-up must name a current published memory and a
-- source that guard_st_memory_source still accepts. Cancellation is terminal:
-- a later insert for the same memory returns the existing row unchanged.
-- V160's validation order and error text stay in front of the new source gate
-- so an unclear or unconfirmed moment is still rejected for that reason.
-- V39 vc.reminder is unchanged.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.follow_up
    ADD CONSTRAINT follow_up_trigger_source CHECK (
        trigger_at IS NULL
        OR (memory_item_id IS NOT NULL AND source_ref IS NOT NULL)),
    ADD CONSTRAINT follow_up_cancel_terminal CHECK (
        cancelled_at IS NULL
        OR (status = 'CANCELLED' AND trigger_at IS NULL));

CREATE UNIQUE INDEX follow_up_one_memory
    ON vc.follow_up (owner_user_id, memory_item_id)
    WHERE memory_item_id IS NOT NULL;

-- Runtime roles cannot read memory_item. Sync uses this gate instead of a
-- direct table probe: accepted, not deleted, not superseded, source still
-- valid, and the same relationship.
CREATE FUNCTION vc.memory_current_for_follow_up(
    p_owner bigint,
    p_relationship bigint,
    p_memory bigint)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT p_owner IS NOT DISTINCT FROM vc.current_owner_id()
       AND EXISTS (
            SELECT 1
              FROM vc.memory_item m
             WHERE m.owner_user_id = p_owner
               AND m.id = p_memory
               AND m.relationship_id = p_relationship
               AND m.status = 'ACCEPTED'
               AND m.deleted_at IS NULL
               AND m.superseded_at IS NULL
               AND m.source_invalidated_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION vc.insert_follow_up(
    p_owner bigint,
    p_relationship bigint,
    p_memory_item_id bigint,
    p_source_ref text,
    p_source_revision bigint,
    p_body text,
    p_status text,
    p_normalization_status text,
    p_time_precision text,
    p_reminder_rule_confirmed boolean,
    p_event_date date,
    p_event_time text,
    p_event_timezone text,
    p_trigger_at timestamptz)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_existing bigint;
    v_rule boolean := COALESCE(p_reminder_rule_confirmed, false);
    v_triggerable boolean;
    v_ref text := NULLIF(btrim(p_source_ref), '');
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    -- Same memory keeps one follow-up. A cancelled row is returned as stored
    -- so a late scheduled write cannot clear cancelled_at or put a trigger back.
    IF p_memory_item_id IS NOT NULL THEN
        SELECT f.id INTO v_existing
          FROM vc.follow_up f
         WHERE f.owner_user_id = p_owner
           AND f.memory_item_id = p_memory_item_id
         FOR UPDATE;
        IF FOUND THEN
            RETURN v_existing;
        END IF;
    END IF;
    IF p_body IS NULL OR btrim(p_body) = '' OR length(p_body) > 4000 THEN
        RAISE EXCEPTION 'follow_up: body must be 1..4000 characters';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'NEEDS_CLARIFICATION', 'SCHEDULED', 'ASKED', 'CANCELLED', 'SILENT',
        'DEFERRED', 'WAITING_HOST', 'BODY_READY') THEN
        RAISE EXCEPTION 'follow_up: status is not allowed';
    END IF;
    IF p_normalization_status IS NULL OR p_normalization_status NOT IN (
        'explicit_date', 'normalized', 'needs_clarification', 'none') THEN
        RAISE EXCEPTION 'follow_up: normalization status is not allowed';
    END IF;
    IF p_time_precision IS NOT NULL AND p_time_precision NOT IN ('date', 'minute') THEN
        RAISE EXCEPTION 'follow_up: time precision is not allowed';
    END IF;
    IF p_source_ref IS NOT NULL AND (btrim(p_source_ref) = '' OR length(p_source_ref) > 512) THEN
        RAISE EXCEPTION 'follow_up: source ref is invalid';
    END IF;
    v_triggerable := p_status = 'SCHEDULED' OR p_trigger_at IS NOT NULL;
    IF v_triggerable AND (p_normalization_status = 'needs_clarification' OR p_status = 'NEEDS_CLARIFICATION') THEN
        RAISE EXCEPTION 'follow_up: needs_clarification cannot be triggerable';
    END IF;
    IF v_triggerable AND p_time_precision = 'date' AND NOT v_rule THEN
        RAISE EXCEPTION 'follow_up: date-only moment requires a confirmed reminder rule';
    END IF;
    IF v_triggerable AND p_time_precision = 'minute' AND (p_event_time IS NULL OR p_event_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
        RAISE EXCEPTION 'follow_up: minute precision requires event_time';
    END IF;
    IF v_triggerable AND p_time_precision = 'date' AND p_event_time IS NOT NULL THEN
        RAISE EXCEPTION 'follow_up: a date has no clock time';
    END IF;
    IF v_triggerable AND (p_event_timezone IS NULL OR btrim(p_event_timezone) = '') THEN
        RAISE EXCEPTION 'follow_up: trigger moment requires a timezone';
    END IF;
    IF v_triggerable AND p_time_precision IS DISTINCT FROM 'minute'
       AND NOT (p_time_precision = 'date' AND v_rule) THEN
        RAISE EXCEPTION 'follow_up: trigger moment is not explicit';
    END IF;
    IF (p_status = 'SCHEDULED') <> (p_trigger_at IS NOT NULL) THEN
        RAISE EXCEPTION 'follow_up: scheduled rows require a trigger moment';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.relationship
         WHERE owner_user_id = p_owner AND id = p_relationship) THEN
        RAISE EXCEPTION 'follow_up: relationship not found';
    END IF;
    IF v_triggerable THEN
        IF p_memory_item_id IS NULL OR v_ref IS NULL THEN
            RAISE EXCEPTION 'follow_up: triggerable row requires a verified memory source';
        END IF;
        IF NOT vc.memory_current_for_follow_up(p_owner, p_relationship, p_memory_item_id) THEN
            RAISE EXCEPTION 'follow_up: memory is not a current published source';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM vc.memory_evidence e
             WHERE e.owner_user_id = p_owner
               AND e.memory_item_id = p_memory_item_id
               AND e.source_ref = v_ref) THEN
            RAISE EXCEPTION 'follow_up: source is not evidence of the memory';
        END IF;
        IF p_source_revision IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM vc.st_message_source s
             WHERE s.owner_user_id = p_owner
               AND s.source_ref = v_ref
               AND s.source_revision = p_source_revision) THEN
            RAISE EXCEPTION 'follow_up: source revision is not current';
        END IF;
        IF NOT vc.guard_st_memory_source(p_owner, p_relationship, v_ref) THEN
            RAISE EXCEPTION 'follow_up: source is not current';
        END IF;
    END IF;
    v_id := nextval('vc.follow_up_id_seq');
    BEGIN
        INSERT INTO vc.follow_up(
            owner_user_id, id, relationship_id, memory_item_id, source_ref, source_revision,
            body, status, normalization_status, time_precision, reminder_rule_confirmed,
            event_date, event_time, event_timezone, trigger_at, event_id)
        VALUES (
            p_owner, v_id, p_relationship, p_memory_item_id, v_ref, p_source_revision,
            btrim(p_body), p_status, p_normalization_status, p_time_precision, v_rule,
            p_event_date, p_event_time, NULLIF(btrim(p_event_timezone), ''), p_trigger_at,
            CASE WHEN p_memory_item_id IS NULL THEN 'fu-' || v_id::text
                 ELSE 'fu-m-' || p_memory_item_id::text END);
    EXCEPTION WHEN unique_violation THEN
        SELECT f.id INTO v_existing
          FROM vc.follow_up f
         WHERE f.owner_user_id = p_owner
           AND f.memory_item_id = p_memory_item_id;
        IF FOUND THEN
            RETURN v_existing;
        END IF;
        RAISE;
    END;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.memory_current_for_follow_up(bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_current_for_follow_up(bigint, bigint, bigint) TO vc_api, vc_worker;
