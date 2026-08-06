# R1 Review — TASK-0024 (Relationship 与唯一活跃 Companion)

- **Reviewed commit**: `752d1b2ae06b7851d82847af786422d628e1e313` (candidate)
- **Candidate tree**: `9bd819c7f80497b656126dc18b903826bb7b5266`
- **Reviewer**: `task0024_r1` (independent-review-gate, general-purpose agent, single adversarial pass)
- **Budget**: 15 min (elapsed ~692s, hard limit not reached)
- **Verdict**: **PASS** — no P0/P1. Both acceptance criteria satisfied.

## Acceptance criteria

**AC1 — 并发创建仍最多一个活跃 Companion: SATISFIED.**
The partial unique index `relationship_one_active_per_owner ON vc.relationship (owner_user_id) WHERE active`
(V9) is the structural authority. Test 27 proves a direct INSERT bypassing every function raises
`unique_violation` on a second active row for the same owner, allows a different owner, and allows a dormant
row to coexist. The per-owner `pg_advisory_xact_lock` in `create_relationship`/`activate_relationship`
serializes the deactivate-then-activate pair so the functions always return a clean result; the index is the
hard backstop. Under READ COMMITTED, a concurrent direct INSERT through `vc_api` (no BYPASSRLS) blocks on the
index and raises on commit. No viable path produces two active rows.

**AC2 — 越权查询统一 NOT_FOUND_OR_FORBIDDEN: SATISFIED.**
Empirically verified: `get_relationship` returns no row cross-owner; `activate_relationship` raises
cross-owner (mapped to 404); `deactivate_relationship` returns `false` for both cross-owner and absent ids —
indistinguishable. No raised message discloses the foreign owner or id (only the caller's own supplied
values appear). The explicit `WHERE owner_user_id = p_owner_user_id` plus FORCE RLS is defense-in-depth.

## Review matrix (10) — independently verified

1. **Partial unique index** — CLEAN. `(owner_user_id) WHERE active` enforces one active per owner, permits
   unbounded dormant rows, never conflicts across owners. Test 27 covers all three cases directly.
2. **TOCTOU / concurrency** — CLEAN. `pg_advisory_xact_lock(hashtext('vc.relationship.active:' || owner))`
   in create + activate serializes per-owner mutation; `FOR UPDATE` on the target in activate prevents
   mid-check mutation. The index catches any gap.
3. **RLS / existence hiding** — CLEAN. Explicit owner predicate + FORCE RLS both scope; `set_config(...,true)`
   binds tenant context; cross-owner and absent return identical results (no row / false). No message leaks.
4. **SECURITY DEFINER hygiene** — CLEAN. All 5 functions `SECURITY DEFINER SET search_path = vc, public`,
   `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO vc_api`; fully-qualified object refs; no hostile-search_path
   hijack surface.
5. **BYPASSRLS / role escalation** — CLEAN. No new roles, no BYPASSRLS; sequence grant mirrors V7's
   `finalize_row_id_seq` (USAGE, SELECT to the four runtime roles).
6. **V1–V8 untouched** — CLEAN. `git diff 752d682 752d1b2 -- V1..V8` is empty.
7. **OpenAPI contract** — CLEAN. Cross-owner endpoints carry 404 NOT_FOUND_OR_FORBIDDEN; create/list omit it
   correctly; ErrorEnvelope/ErrorCode reused (specs/catalog + specs/generated unchanged); validate + drift PASS.
8. **writeAllowlist / forbiddenPaths** — CLEAN. All 15 changed paths map to writeAllowlist entries; no
   forbidden path touched (catalog, contracts, generated, V1-V8, Java, pom, CI all zero-diff).
9. **Test quality** — ADEQUATE. Test 26 (function path: create×2 → one active), 27 (index guard, direct
   INSERT), 28 (cross-owner existence hiding), 29 (full lifecycle + idempotency). No tautological tests.
10. **Idempotency / edge cases** — CLEAN. deactivate on owned-already-inactive → true (UPDATE matches the
    owned row regardless of value change); activate on already-active → clean no-op; empty/NULL persona_ref
    and NULL args raise.

## Independent verification executed
- `bash infra/db/run-rls-tests.sh` → all 29 PASS (re-run in a fresh ephemeral PG18+pgvector container)
- `python scripts/dev/openapi_tool.py validate` → PASS
- `python scripts/dev/openapi_tool.py diff --fail-on-drift` → PASS
- Empirical probe of deactivate return semantics (owned=true, foreign=false, absent=false)
- `git diff` confirmed V1–V8, catalog, generated, Java sources, pom all unchanged
- writeAllowlist cross-checked against all 15 diff paths

## Non-blocking findings (P3 — no fix batch; pure documentation/coverage, no bearing or safety impact)

- **P3-1** `infra/db/tests/29_relationship_lifecycle_activate_deactivate.sql:61` comment claims an idempotent
  deactivate on an already-inactive *owned* relationship "returns false". Verified it actually returns `true`
  (UPDATE matches the owned row; ROW_COUNT=1). The test does not assert this value (uses PERFORM) so it still
  passes, and the actual behavior is correct and stronger than the comment implies — the comment is simply
  inaccurate. Non-functional documentation drift; the migration docstring states the correct contract.
- **P3-2** No real two-session concurrency test; the invariant is argued structurally (partial unique index +
  advisory lock) and via the sequential index-guard test (test 27), which the acceptance criteria explicitly
   accept ("顺序冲突测试证明"). The index is the structural guarantee.
- **P3-3** OpenAPI `Relationship.active` and `createdAt` are always present in responses but not marked
  `required`. Cosmetic.
- **P3-4** Create returns 200 rather than 201; consistent with the existing codebase convention and the
  generator's 200-response return-type derivation. Cosmetic.

## Conclusion
No P0 or P1. The implementation is correct, follows the V7/V8 baseline (SECURITY DEFINER + set_config +
REVOKE PUBLIC/GRANT vc_api + out_-prefixed RETURNS TABLE + advisory-lock pattern), and both acceptance
criteria are satisfied: the partial unique index makes the one-active-Companion invariant structural, and
cross-owner existence is uniformly hidden across every read/mutation path.
