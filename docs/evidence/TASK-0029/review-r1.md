# R1 Independent Review — TASK-0029

- **Task**: TASK-0029 跨会话召回、Context 注入与删除墓碑
- **Candidate commit (as reviewed)**: `e459759` (V13 + tests 37/38)
- **Base commit**: `2c4237687431a4421cdfd93c49593712d77be872`
- **Reviewer**: independent-review-gate (general-purpose, single pass)
- **Budget**: 15 min maximum; elapsed ~261 s; hard limit not reached
- **Verdict**: **PASS** (no P0/P1; one non-blocking P2, addressed by fix batch → see review-r2.md)

## Acceptance criteria — both satisfied

- **AC1 (deterministic recall before/after deletion, tombstone, reindex)**: recall_memory is a pure SELECT with `status='ACCEPTED' AND deleted_at IS NULL`, `ORDER BY m.scope, m.created_at, m.id` (total order — id is per-owner unique, so no ambiguous ties), no volatile functions. Tombstone structural (deleted_at IS NULL; no vector/cache/matview store to revive from). Test 38 covers delete-then-recall + determinism. (Order assertion strengthened post-R1 — see P2.)
- **AC2 (cross-session injects only current Owner/Relationship confirmed memory)**: predicate is `(owner_user_id, relationship_id)`; RELATIONSHIP recalled cross-conversation; SESSION only for the bound conversation (OR-parenthesized so SESSION cannot leak when conversation_id is NULL); cross-owner/cross-relationship return empty (indistinguishable from empty relationship); unconfirmed (PENDING/REJECTED) never recalled (`status='ACCEPTED'`). Test 37 covers scope/budget/isolation.

## Verified claims (no defect)

1. **Confirmed-only / canonical gate**: `status='ACCEPTED' AND deleted_at IS NULL` in WHERE; body is pure `RETURN QUERY SELECT ... LIMIT` — no INSERT/UPDATE/DELETE. Cannot create candidates or change status. INV-MEM-001/002 unweakened.
2. **Scope correctness**: OR branch explicitly parenthesized — `scope='RELATIONSHIP' OR (scope='SESSION' AND p_conversation_id IS NOT NULL AND m.conversation_id = p_conversation_id)`. SESSION cannot leak without the bound conversation. Composite ownership makes cross-relationship SESSION leakage structurally impossible.
3. **Ownership / existence hiding**: cross-owner and cross-relationship resolve to empty, indistinguishable from an empty relationship. Returning empty (not raising) is consistent with list_memory/get_memory/list_memory_evidence.
4. **Budget clamp**: empirically verified in a PG18 container — `LEAST(GREATEST(x,1),100)` yields 1 for NULL/0/negative and 100 for >100. GREATEST/LEAST ignore NULLs. LIMIT applies after ORDER BY (deterministic slice).
5. **Determinism (impl)**: `ORDER BY m.scope, m.created_at, m.id` is a total order; no now()/random() in the query.
6. **Tombstone / no revival**: deleted_at IS NULL excludes soft-deleted rows; V13 creates no vector store, matview, or cache; recall reads the live table under READ COMMITTED.
7. **Privilege/EXECUTE**: REVOKE PUBLIC + GRANT vc_api; signature `(bigint,bigint,bigint,int)` matches defaults; SECURITY DEFINER SET search_path=vc,public; set_config runs before table access; resolves to pg_catalog.set_config (no schema-hijack surface).
8. **Write scope**: `git diff 36c28ab..e459759` = exactly 3 files (V13 + tests 37/38), all in writeAllowlist; no forbiddenPaths touched; SQL-only (no OpenAPI/catalog/Java/contract change).

## Finding (non-blocking)

### P2 — Test 38 did not assert the ORDER (AC1 "顺序不变")
- `infra/db/tests/38_memory_recall_tombstone_determinism.sql`: both `array_agg(out_id ORDER BY out_id)` captures re-sorted by id, so the comparison checked only the SET {a,b,c}/{a,c}, never the function's own (scope, created_at, id) sequence. If someone changed V13's ORDER BY (or removed it), test 38 would still pass but the budget slice would silently change. AC1 explicitly requires order unchanged, and budget truncation depends on the order.
- The V13 implementation is correct; this is a test-validity gap, not a production defect.
- **Resolution**: fix batch (commit `d734723`) — capture via WITH ORDINALITY (preserves function emission order) and compare ordered arrays; test 37 budget=1 now asserts which row is kept. See review-r2.md for closure.

## Decision

No P0/P1. The single P2 (test-order verification) was addressed by a test-only fix batch (V13 unchanged). Both acceptance criteria are satisfied. Proceed to closure after R2 finding-closure confirms the fix.
