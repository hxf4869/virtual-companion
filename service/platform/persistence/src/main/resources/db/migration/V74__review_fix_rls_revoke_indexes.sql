-- REVIEW-FIX hardening bundle:
-- 1) generation_feedback was the only owned business table left without
--    FORCE RLS + owner_isolation (V2 invariant); future GRANT or SD-function
--    regressions would otherwise read/write cross-tenant directly.
-- 2) vc._terminalize kept default PUBLIC EXECUTE (V5's REVOKE block missed
--    it), letting any session write CHECK-allowed terminal states on a
--    claimed token outside the complete/fail/cancel whitelists.
-- 3) Retention/purge and export paths scanned without supporting indexes:
--    identity_auth_event purge by occurred_at, generation_usage export by
--    created_at, and semantic recall ORDER BY embedding <=> (pgvector hnsw).

SET search_path TO vc, pg_catalog;

-- 1) generation_feedback tenant isolation (V72 owner_isolation shape).
ALTER TABLE vc.generation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.generation_feedback FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.generation_feedback;
CREATE POLICY owner_isolation ON vc.generation_feedback FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- 2) Close the internal terminalize helper to the outside world. All
--    callers are SECURITY DEFINER wrappers (the owner retains EXECUTE), so
--    no explicit grantee is needed — and granting one would re-open the
--    whitelist bypass the V5 REVOKE block intended to close.
REVOKE EXECUTE ON FUNCTION vc._terminalize(text, text) FROM PUBLIC;

-- 3) Indexes for the retention purge, usage export and semantic recall.
CREATE INDEX IF NOT EXISTS identity_auth_event_occurred_at_idx
    ON vc.identity_auth_event (occurred_at);
CREATE INDEX IF NOT EXISTS generation_usage_recorded_at_idx
    ON vc.generation_usage (recorded_at);
CREATE INDEX IF NOT EXISTS memory_embedding_hnsw_idx
    ON vc.memory_embedding USING hnsw (embedding public.vector_cosine_ops);
