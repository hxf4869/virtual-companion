-- W16: read pending player-visible story projections on the current branch
-- head. Chat backfill after a refresh uses this. The function only selects.
-- It does not confirm, cancel, or enqueue work. Hidden marker fields are
-- returned as empty text so GM truth and another actor's private fact do not
-- leave the database. state_after and world truth are not selected.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.list_pending_player_story_projections(
    p_owner bigint,
    p_run_id bigint
)
    RETURNS TABLE(
        out_event_id bigint,
        out_world_version bigint,
        out_clue_name text,
        out_text text,
        out_note text,
        out_qualification text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_head bigint;
    v_version bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0 THEN
        RAISE EXCEPTION 'list_pending_player_story_projections: invalid input';
    END IF;

    SELECT r.current_branch_id, r.world_version
      INTO v_head, v_version
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id;
    IF NOT FOUND OR v_head IS NULL OR v_head <= 0 THEN
        RAISE EXCEPTION 'list_pending_player_story_projections: run not found';
    END IF;

    RETURN QUERY
    WITH RECURSIVE chain AS (
        SELECT b.id, b.parent_branch_id, b.fork_world_version, b.run_id,
               NULL::bigint AS max_version, 0 AS depth
          FROM vc.story_branch b
         WHERE b.owner_user_id = p_owner AND b.id = v_head
        UNION ALL
        SELECT parent.id, parent.parent_branch_id, parent.fork_world_version, parent.run_id,
               child.fork_world_version, child.depth + 1
          FROM vc.story_branch parent
          JOIN chain child
            ON parent.owner_user_id = p_owner
           AND parent.id = child.parent_branch_id
           AND parent.run_id = child.run_id
         WHERE child.depth < 32
    )
    SELECT e.id,
           e.world_version,
           CASE
               WHEN COALESCE(e.body->>'clueName', '') = ''
                    OR (e.body->>'clueName') ~ 'PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+'
               THEN ''
               ELSE e.body->>'clueName'
           END,
           CASE
               WHEN COALESCE(e.body->>'text', '') = ''
                    OR (e.body->>'text') ~ 'PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+'
               THEN ''
               ELSE e.body->>'text'
           END,
           CASE
               WHEN COALESCE(e.body->>'note', '') = ''
                    OR (e.body->>'note') ~ 'PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+'
               THEN ''
               ELSE e.body->>'note'
           END,
           CASE
               WHEN COALESCE(e.body->>'qualification', '') = ''
                    OR (e.body->>'qualification') ~ 'PRIVATE_[A-Z0-9_]+|GM_ONLY_[A-Z0-9_]+'
               THEN ''
               ELSE e.body->>'qualification'
           END
      FROM vc.story_event e
      JOIN chain c ON c.id = e.branch_id
     WHERE e.owner_user_id = p_owner
       AND e.run_id = p_run_id
       AND e.projection_state = 'PENDING'
       AND 'player' = ANY(e.visibility)
       AND e.world_version <= v_version
       AND (c.max_version IS NULL OR e.world_version <= c.max_version)
     ORDER BY e.world_version, e.id;
END;
$$;

REVOKE ALL ON FUNCTION vc.list_pending_player_story_projections(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_pending_player_story_projections(bigint, bigint) TO vc_api, vc_worker;
