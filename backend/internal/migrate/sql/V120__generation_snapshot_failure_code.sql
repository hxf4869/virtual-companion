-- Keep the V117 snapshot function stable for any existing callers while the
-- Go runtime adopts a richer durable failure view.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.go_read_generation_snapshot_with_failure(
    p_owner_user_id bigint,
    p_generation_id bigint)
    RETURNS TABLE(
        out_status text,
        out_assistant_message_id bigint,
        out_assistant_content text,
        out_input_tokens bigint,
        out_output_tokens bigint,
        out_failure_code text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    RETURN QUERY
        SELECT g.status,
               g.assistant_message_id,
               am.content,
               usage_attempt.input_tokens,
               usage_attempt.output_tokens,
               COALESCE(latest_attempt.failure_code, generation_job.last_error_code)
          FROM vc.generation g
          LEFT JOIN vc.message am
            ON am.owner_user_id = g.owner_user_id AND am.id = g.assistant_message_id
          LEFT JOIN LATERAL (
                SELECT a.input_tokens, a.output_tokens
                  FROM vc.attempt_intent a
                 WHERE a.owner_user_id = g.owner_user_id
                   AND a.generation_id = g.id
                   AND a.status = 'SUCCEEDED'
                 ORDER BY a.attempt_no DESC NULLS LAST, a.id DESC
                 LIMIT 1
          ) usage_attempt ON true
          LEFT JOIN LATERAL (
                SELECT a.failure_code
                  FROM vc.attempt_intent a
                 WHERE a.owner_user_id = g.owner_user_id
                   AND a.generation_id = g.id
                 ORDER BY a.attempt_no DESC NULLS LAST, a.id DESC
                 LIMIT 1
          ) latest_attempt ON true
          LEFT JOIN LATERAL (
                SELECT wi.last_error_code
                  FROM vc.work_item wi
                 WHERE wi.owner_user_id = g.owner_user_id
                   AND wi.kind = 'GENERATION'
                   AND wi.ref_id = g.id
                 ORDER BY wi.id DESC
                 LIMIT 1
          ) generation_job ON true
         WHERE g.owner_user_id = p_owner_user_id
           AND g.id = p_generation_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_read_generation_snapshot_with_failure(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_read_generation_snapshot_with_failure(bigint, bigint)
    TO vc_api, vc_worker;
