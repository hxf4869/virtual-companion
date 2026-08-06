# R2 Finding-Closure Review — TASK-0029

- **Task**: TASK-0029 跨会话召回、Context 注入与删除墓碑
- **Candidate (as reviewed)**: `d734723ce772f21fc02ff8f71bd56ee93a71f0f2` (post fix-batch; parent `e459759`)
- **Candidate tree**: `c38a62107612afb079dbf933dfe0062f60edc120`
- **Reviewer**: independent-review-gate (general-purpose, finding-closure pass)
- **Budget**: 15 min maximum; elapsed ~89 s; hard limit not reached
- **Verdict**: **PASS** — R1 P2 closed; no new blocking issue; candidate acceptable for closure.

## What R2 verified

1. **P2 closed — test 38 now pins the ORDER, not just the SET.** The `WITH ORDINALITY AS r(...,ord)` maps 1:1 to recall_memory's 5 output columns and appends `ord` numbering rows in the order the function EMITS them (not a re-sort). `array_agg(out_id ORDER BY ord)` aggregates in function order, and `before IS DISTINCT FROM ARRAY[va,vb,vc]` is an order-sensitive PostgreSQL array comparison. If V13's `ORDER BY m.scope, m.created_at, m.id` were changed (e.g. to `ORDER BY m.id DESC`) or removed, the function would emit `[vc,vb,va]`, the aggregate would become `[vc,vb,va]`, and the comparison `ARRAY[vc,vb,va] IS DISTINCT FROM ARRAY[va,vb,vc]` is TRUE → RAISE → test FAILs. The vacuous gap (function emits one order, test re-sorted by id before comparing) is eliminated. The post-delete `[va,vc]` assertion uses the same mechanism.
2. **Test 37 budget=1 pins the kept row.** `PERFORM 1 FROM recall_memory(...,1) WHERE out_summary='rel-1'` proves LIMIT applies AFTER ORDER BY: rel-1 is the deterministic head (created/confirmed before rel-2 → lower id, same created_at), so the budget=1 slice must be rel-1. If LIMIT applied before ORDER BY or ORDER BY were removed, rel-2 could be kept and the test would FAIL.
3. **Delta risk — no production change.** `git diff e459759 d734723 -- service/` is empty → V13 byte-identical. The delta touches only two `.sql` test files (37: +4 lines; 38: +34/-25). WITH ORDINALITY is standard PostgreSQL syntax; the column list matches the RETURNS TABLE signature exactly. No production/security/privilege change.
4. **No new P0/P1.** Test-only strengthening. Explicit column naming in WITH ORDINALITY is positive (a future return-signature change forces a deliberate test update rather than a silent pass).

## Per-transaction created_at stability

Within one `BEGIN..COMMIT` block, V2's `created_at DEFAULT now()` is stable (transaction start time), so `id` is the only tiebreaker among the three RELATIONSHIP rows; the sequence `[va,vb,vc]` follows insertion/nextval order and is not flaky.

## Findings

- P0: none. P1: none. P2: none (R1's P2 closed by d734723).
- P3 (non-blocking, no action): the test 37 budget=1 row-pin relies on physical insert order equaling sequence order (true on a freshly-TRUNCATEd, never-vacuumed table); mildly redundant with test 38's order pin, but together they strengthen the suite — not a defect.

## Decision

R1's single non-blocking P2 is closed by a test-only fix batch (V13 unchanged, confirmed byte-identical). Candidate `d734723` is acceptable for closure.
