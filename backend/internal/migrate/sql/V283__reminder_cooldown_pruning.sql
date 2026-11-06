-- Reminder retry keys are per reminder; discard them once their retry gap ends.
SET search_path=vc,pg_catalog;

CREATE FUNCTION vc.prune_reminder_cooldowns(p_owner bigint, p_relationship bigint, p_now timestamptz)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    DELETE FROM vc.proactive_cooldown
     WHERE owner_user_id = p_owner AND relationship_id = p_relationship
       AND cooldown_key LIKE 'reminder:%' AND until_at <= p_now;
END;
$$;

REVOKE ALL ON FUNCTION vc.prune_reminder_cooldowns(bigint, bigint, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.prune_reminder_cooldowns(bigint, bigint, timestamptz) TO vc_api, vc_worker;
