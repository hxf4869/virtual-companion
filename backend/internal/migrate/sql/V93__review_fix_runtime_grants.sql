-- V93 review-fix: two over-broad runtime-role grants found by the
-- independent acceptance review of the 6ee29b0c..a3f232fc commit chain.
--
-- 1) S0-24-A (V87): advance_release_gate was executable by vc_api, so the
--    API runtime role could push the release gate to BETA with
--    eval_passed=true in one call — no Owner action, no audit, defeating
--    the "no expansion without eval" hard gate. Stage advancement belongs
--    to the operator/migrator path (manual psql as the migration owner),
--    never to a runtime role. Snapshot reads stay with vc_api (the
--    admission gate reads them on every generation intake).
--
-- 2) S0-14-B (V89): SELECT on ops_case_event was granted to all four
--    runtime roles with no production reader — the only consumer was a
--    psql test counting BODY_ACCESS rows under SET ROLE vc_api. That
--    leaked cross-owner audit metadata (who read which case body, when)
--    to worker/coordinator/dispatcher and broke V88's own invariant
--    "runtime roles never take table privileges". Test 140 now asserts
--    the absence of the privilege instead.

REVOKE ALL ON FUNCTION vc.advance_release_gate(text, boolean, text)
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

REVOKE ALL ON TABLE vc.ops_case_event
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
