-- W14: deleting a mapped companion clears relationship_id and leaves the
-- participant. Account deletion still removes every story row. Only the
-- unmap update is allowed while a deletion intent exists; every other
-- participant write stays behind the V103 barrier.
SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.block_story_participant_outbound_rows()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM vc.account_deletion_intent d
        WHERE d.account_id = NEW.owner_user_id
    ) THEN
        IF TG_OP = 'UPDATE'
           AND NEW.relationship_id IS NULL
           AND OLD.relationship_id IS NOT NULL
           AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id
           AND NEW.id IS NOT DISTINCT FROM OLD.id
           AND NEW.run_id IS NOT DISTINCT FROM OLD.run_id
           AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id
           AND NEW.role IS NOT DISTINCT FROM OLD.role
           AND NEW.scene IS NOT DISTINCT FROM OLD.scene
           AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER story_participant_deletion_intent_guard ON vc.story_participant;
CREATE TRIGGER story_participant_deletion_intent_guard
    BEFORE INSERT OR UPDATE ON vc.story_participant
    FOR EACH ROW EXECUTE FUNCTION vc.block_story_participant_outbound_rows();

DO $$
DECLARE
    v_name text;
BEGIN
    SELECT c.conname INTO v_name
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'vc'
       AND rel.relname = 'story_participant'
       AND c.contype = 'f'
       AND pg_get_constraintdef(c.oid) ILIKE '%relationship%';
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'story participant relationship foreign key is missing';
    END IF;
    EXECUTE format('ALTER TABLE vc.story_participant DROP CONSTRAINT %I', v_name);
END $$;

-- SET NULL (relationship_id) keeps owner_user_id. A bare SET NULL would null
-- both columns of the composite key.
ALTER TABLE vc.story_participant
    ADD CONSTRAINT story_participant_relationship_fk
    FOREIGN KEY (owner_user_id, relationship_id)
    REFERENCES vc.relationship (owner_user_id, id)
    ON DELETE SET NULL (relationship_id);

ALTER TABLE vc.story_participant
    ADD CONSTRAINT story_participant_companion_actor_check
    CHECK (relationship_id IS NULL OR actor_id IN ('lin', 'zhou', 'su'));

CREATE UNIQUE INDEX story_participant_relationship_once
    ON vc.story_participant (owner_user_id, run_id, relationship_id)
    WHERE relationship_id IS NOT NULL;

CREATE FUNCTION vc.map_story_participant(
    p_owner bigint,
    p_run_id bigint,
    p_actor_id text,
    p_relationship_id bigint
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_actor text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_actor_id IS NULL OR btrim(p_actor_id) = ''
       OR p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'map_story_participant: invalid input';
    END IF;
    SELECT p.id, p.actor_id INTO v_id, v_actor
      FROM vc.story_participant p
     WHERE p.owner_user_id = p_owner
       AND p.run_id = p_run_id
       AND p.actor_id = p_actor_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'map_story_participant: actor is not in this run';
    END IF;
    IF v_actor NOT IN ('lin', 'zhou', 'su') THEN
        RAISE EXCEPTION 'story participant actor cannot enter as a companion';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.relationship r
        WHERE r.owner_user_id = p_owner AND r.id = p_relationship_id
    ) THEN
        RAISE EXCEPTION 'story participant relationship is not owned';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.story_participant p
        WHERE p.owner_user_id = p_owner
          AND p.run_id = p_run_id
          AND p.relationship_id = p_relationship_id
          AND p.id <> v_id
    ) THEN
        RAISE EXCEPTION 'story participant relationship is already mapped';
    END IF;
    UPDATE vc.story_participant
       SET relationship_id = p_relationship_id
     WHERE owner_user_id = p_owner AND id = v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.block_story_participant_outbound_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.map_story_participant(bigint, bigint, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.map_story_participant(bigint, bigint, text, bigint)
    TO vc_api, vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint)
    RENAME TO export_v2_owner_metadata_w14_participant;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_w14_participant(p_owner);
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint),
    vc.export_v2_owner_metadata_w14_participant(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_w14_participant(bigint)
    FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
