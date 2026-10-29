-- An extract can publish successfully with no new record. The attempt ledger
-- keeps a closed decision code and never the source text: the model found no
-- fact, dedup merged into an existing record, or a gate dropped the candidate.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.memory_extract_attempt
    ADD COLUMN decision_code text;

ALTER TABLE vc.memory_extract_attempt
    ADD CONSTRAINT memory_extract_attempt_decision_code CHECK (
        decision_code IS NULL OR decision_code IN (
            'MEMORYCORE_EMPTY_NO_NEW_FACT',
            'MEMORYCORE_EMPTY_DEDUP_MERGED',
            'MEMORYCORE_EMPTY_DROPPED_GATE'));

CREATE FUNCTION vc.go_record_memorycore_empty_decision(
    p_owner bigint,
    p_job bigint,
    p_code text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_code IS NULL OR p_code NOT IN (
        'MEMORYCORE_EMPTY_NO_NEW_FACT',
        'MEMORYCORE_EMPTY_DEDUP_MERGED',
        'MEMORYCORE_EMPTY_DROPPED_GATE') THEN
        RAISE EXCEPTION 'invalid empty decision';
    END IF;
    UPDATE vc.memory_extract_attempt
       SET decision_code = p_code
     WHERE owner_user_id = p_owner
       AND work_item_id = p_job
       AND id = (
            SELECT id FROM vc.memory_extract_attempt
             WHERE owner_user_id = p_owner AND work_item_id = p_job
             ORDER BY id DESC
             LIMIT 1);
END;
$$;

REVOKE ALL ON FUNCTION vc.go_record_memorycore_empty_decision(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_record_memorycore_empty_decision(bigint, bigint, text) TO vc_api, vc_worker;
