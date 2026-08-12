# TASK-0158 R1 Independent Review (static-gates-only)

- **Verdict: PASS**
- **Reviewed commit (candidate HEAD):** `a4281c5c676b9b2d85e8a5dc27cc899d4abf98fd`
- **Candidate tree:** `e78fe31dbcdea9cb010c7f3ac1093619742afe28` (matches expected)
- **Base commit:** `b21e344ea35c67523a63e947855113b8c3afb28b` (TASK-0161 ACCEPTED terminal)
- **Date:** 2026-08-12
- **Reviewer kind:** independent-review-gate (R1), static-gates-only
- **Risk class:** C4 (database-migration); independent review required and performed
- **Review scope:** COMPLETE_MATRIX (line-by-line diff) + ACCEPTANCE (10 criteria) + INVARIANTS (7) + ADJACENT_RISK

## Summary

RISK-09 hardening is implemented exactly as scoped: a new V18 Flyway migration rewrites the
`SET search_path` clause of every SECURITY DEFINER function in schema `vc` from `vc, public` to
`vc, pg_catalog` via a `pg_proc` introspection loop, and `REVOKE CREATE ON SCHEMA public FROM
PUBLIC`. A new cross-tenant negative test (57) machine-proves all three properties (G1/G2/G3).
No prior migration (V1–V17), no function body/signature/owner/GRANT/RLS, and no role/table is
touched. All static gates pass with real exit code 0; the RLS suite applies V1..V18 cleanly and
passes 57/57. 0 P0 / 0 P1 / 0 P2.

## Independent static-gate re-runs (real recorded values)

| Gate | Command | Result | Exit |
|------|---------|--------|------|
| Worktree clean | `git status --porcelain` | empty | 0 |
| diff --check (no args) | `git diff --check` | clean | 0 |
| diff --check (range) | `git diff --check b21e344..a4281c5` | clean | 0 |
| Harness doctor | `python scripts/harness/doctor.py --task TASK-0158` | `Harness doctor: PASS (762679 checks) [receipt hit c95e62895234]` | 0 |
| Canonical precheck | `python scripts/harness/precheck.py --task TASK-0158` | `Harness precheck: PASS (8 commands)` | 0 |
| RLS test suite | `bash infra/db/run-rls-tests.sh` | `ALL TESTS PASS`, 57/57 PASS (incl. 57_search_path_public_create_fail_closed.sql); V1..V18 applied | 0 |

Precheck 8/8 subcommands all PASS: `doctor`, `catalogValidate`, `catalogDrift`,
`paidFeatureCheck`, `licenseCheck`, `betaRosterGate`, `openapiValidate`, `openapiDrift`.

## Diff scope (exact-tree)

`git diff --name-only b21e344..a4281c5` returns exactly the 5 authorized paths:

1. `.harness/project-state.yaml` (+3/-3)
2. `docs/tasks/TASK-0158-risk-09-search-path-hardening.md` (+465, new)
3. `docs/tasks/context/TASK-0158.context-lock.yaml` (+158, new)
4. `infra/db/tests/57_search_path_public_create_fail_closed.sql` (+119, new)
5. `service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql` (+60, new)

No V1–V17 migration file appears in the diff (Flyway-checksum safe). Total: 805 insertions, 3
deletions. `writeAllowlist`/`forbiddenPaths` zero conflict (doctor PASS confirms).

## COMPLETE_MATRIX — line-by-line review

### V18 migration (60 lines)

- Header line 26: `SET search_path TO vc, pg_catalog;` — binds only this script's own DDL
  session; explicitly documented as non-persistent to runtime (each SD function carries its own
  hardened SET clause after step 1). Correct.
- Lines 31–50: a single `DO $$ ... $$` block introspects `pg_proc p JOIN pg_namespace n` with
  `n.nspname = 'vc' AND p.prosecdef = true`, and for each match executes
  `format('ALTER FUNCTION vc.%s(%s) SET search_path = vc, pg_catalog', quote_ident(r.proname),
  r.ident_args)` where `ident_args = pg_get_function_identity_arguments(p.oid)`. This is the
  identity-arguments form, which uniquely identifies each overload — correct for ALTER FUNCTION.
  Only the `SET` clause is touched; `prosecdef`, `prosrc`, `prolang`, owner, GRANTs, RLS are
  untouched. The loop covers all 37 SD functions (34 from V17 + 3 V5 inline
  complete/fail/cancel_work_item) because it is data-driven on `prosecdef=true ∧ vc`.
- Line 60: `REVOKE CREATE ON SCHEMA public FROM PUBLIC;` — idempotent defense-in-depth; on PG ≥15
  this is already the default but the explicit REVOKE makes the property machine-assertable and
  version/initdb-flag independent. REVOKE of an un-held privilege is a no-op.
- No signature, body, LANGUAGE, SECURITY DEFINER flag, owner, GRANT, RLS, table, role, or prior
  migration is modified. Confirmed by diff scope and by reading the file.

### Test 57 (119 lines)

- **G1 (lines 18–43):** iterates `pg_proc(prosecdef=true, pronamespace='vc')`, asserts each
  `proconfig` contains `search_path=vc, pg_catalog` and does NOT contain `public`; asserts
  `n_sd >= 37`. Correctly fails-closed on both the missing-good and present-bad conditions.
- **G2 (lines 50–73):** `has_schema_privilege('vc_api','public','CREATE')` and `vc_worker` both
  must be false (transitively proves PUBLIC lacks CREATE); then `SET ROLE vc_api` and a live
  `CREATE FUNCTION public.g2_evil_shadow()` must raise a permission error (caught via nested
  EXCEPTION, re-raised if the error is not a permission error). Robust negative assertion.
- **G3 (lines 80–119):** superuser plants `public.current_owner_id()` shadow returning
  `999999::bigint`; sets `vc.owner_user_id='1'`; creates a throwaway SD probe
  `vc.__rls_probe_unqual_owner()` with `SET search_path = vc, pg_catalog` calling unqualified
  `current_owner_id()`; asserts (a) probe result ≠ 999999 (not hijacked), (b) probe result =
  qualified `vc.current_owner_id()` (resolution pinned to vc), (c) qualified call returns 1
  (trusted owner context). Cleanup drops probe + shadow and resets role/GUC. Correct shadow
  hijack rejection proof. The `$body$` dollar-quote tag on the G2 inner CREATE FUNCTION correctly
  avoids collision with the outer `DO $$` body (this was the fix in commit a4281c5).

### project-state.yaml

Only `activeTask` (null → TASK-0158), `activeTaskCard` (null → card path), and `nextAction`
(updated to execution plan) changed. No other field (e.g. capabilityGates, phase, ledger refs)
mutated. This is exactly the READY→IN_PROGRESS authorization projection. (No `updatedAt` field
exists in this file.)

### Task card & context-lock

Card frontmatter `state: IN_PROGRESS`, `riskClass: C4`, `baseCommit: b21e344...`,
`authorizationCommit: 9210a07d7311fb15f12bfde4749a5e9fd3d8796c` (the READY commit), three
humanApprovals (task-assignment 2026-08-11, database-migration 2026-08-12,
local-exact-tree-fallback 2026-08-11), `independentReview: required`. Context-lock pins all
inputs to base commit `b21e344` with SHA256 hashes; `contextFingerprint` matches card.

## Commit chain & authorization

Chain from base: `e0d9c4b` (DRAFT) → `9210a07` (READY authorizationCommit) → `76cb07d` (READY
checkpoint) → `ad2d41e` (IN_PROGRESS + implementation) → `a4281c5` (G2 dollar-quote fix =
candidate HEAD). Single active task (TASK-0158 only since base). authorizationCommit `9210a07`
descends from base `b21e344` and is the READY commit the card is bound to.

## Acceptance criteria audit (10 rows)

| # | Criterion | Verdict | Basis |
|---|-----------|---------|-------|
| 1 | V18 exists; header `SET search_path TO vc, pg_catalog`; DO loop ALTER FUNCTION all SD in vc; REVOKE CREATE public FROM PUBLIC | PASS | V18 lines 26, 31–50, 60 |
| 2 | V1–V17 unmodified (diff only adds V18) | PASS | `diff --name-only`: no V1–V17 |
| 3 | run-rls-tests.sh 57 PASS, exit 0 | PASS | re-ran: `ALL TESTS PASS`, 57/57, exit 0 |
| 4 | test 57 covers G1 (proconfig vc,pg_catalog, no public, ≥37) + G2 (runtime/PUBLIC no CREATE, live CREATE denied) + G3 (public shadow no hijack) | PASS | test 57 lines 18–43, 50–73, 80–119 |
| 5 | canonical precheck 8/8 PASS | PASS | re-ran: PASS (8 commands), exit 0 |
| 6 | no-arg `git diff --check` PASS | PASS | re-ran: exit 0 |
| 7 | R1 independent static review PASS (C4 required), 0 P0/P1/P2 | PASS | this review |
| 8 | complete Harness unittest | DEFERRED | Owner 2026-08-12 static-gates-only; honestly recorded, NOT converted to PASS (INV-HARNESS-005) |
| 9 | terminal pre-closure + single-parent [skip ci] ACCEPTED + push + HEAD==origin/main + 0/0/clean; remote exact-SHA 如实 non-PASS (dispatchCount=0) | N/A at R1 | Terminal artifacts are produced only after R1 PASS; candidate is closure-ready. Remote LOCAL_EXACT_TREE_FALLBACK frozen at READY, dispatchCount=0 |
| 10 | INV-TENANT-001/INV-WORKER-001 strengthened (SD search_path public removed + CREATE revoked) | PASS | V18 + test 57 G1/G2/G3 machine-proven |

## Invariant compliance

| Invariant | Verdict | Evidence |
|-----------|---------|----------|
| INV-TENANT-001 (RLS/role, no cross-tenant read) | PASS | SD search_path `public` entry removed; CREATE on public revoked; no BYPASSRLS/role/RLS change; test 57 G2 |
| INV-WORKER-001 (SD contract) | PASS | SD body resolution no longer reaches untrusted public objects; test 57 G3 shadow-proof |
| INV-HARNESS-002 (single active task, frozen scope) | PASS | only TASK-0158 active; diff = 5 authorized files exact; authorizationCommit bound |
| INV-HARNESS-003 (protected-path skill) | PASS | `**/db/migration/**` → riskClass C4 + requiredSkill database-migration; card declares C4 + database-migration + humanApproval(scope: database-migration) |
| INV-HARNESS-005 (no unexecuted check as PASS) | PASS | unittest criterion #8 recorded DEFERRED, not PASS; all other PASS backed by real re-runs with exit 0 |
| INV-HARNESS-007 (single registered policy, bounded review) | PASS | single `.harness/task-delivery-policy.yaml`; R1 bounded to static gates per strategy |
| INV-HARNESS-009 (exact-tree channel) | PASS | LOCAL_EXACT_TREE_FALLBACK owner-authorized 2026-08-11; remote 如实 non-PASS dispatchCount=0; no cross-card PASS reuse |

## Adjacent risk assessment

1. **Does V18 risk breaking existing SD function behavior?** No. `ALTER FUNCTION ... SET
   search_path` only updates the `proconfig` catalog entry (the function's runtime GUC preset);
   it does not touch `prosrc` (body), signature, LANGUAGE, `prosecdef`, owner, or GRANTs. The RLS
   suite re-running all 57 tests with V18 applied (including SD-exercising tests 04, 07–11,
   54, 55) and passing is empirical proof.

2. **Does removing `public` from SD search_path break unqualified references in SD bodies?** No.
   The V5 inline helpers (`complete_work_item`/`fail_work_item`/`cancel_work_item`) call
   `vc._terminalize(...)` — fully qualified. The 34 V17 SD functions were authored under the
   `vc.*` qualification convention. The 57-test suite passing post-V18 confirms no SD body relied
   on `public` for resolution; if any had, an existing SD-exercising test would have failed.

3. **Does REVOKE CREATE ON public affect legitimate migration/test setup?** No. Migrations and
   test setup DDL run as superuser, which is unaffected by PUBLIC privilege revocation. V18
   itself runs as superuser. Runtime roles (vc_api/vc_worker) never legitimately CREATE in public.

4. **Flyway checksum safety:** V1–V17 files are byte-identical to base (diff confirms). V18 is a
   new forward-only migration. No checksum is invalidated.

## Findings

- P0: 0
- P1: 0
- P2: 0

## Recommendation

**PASS.** The candidate is static-gate-clean (doctor 762679 checks, precheck 8/8, RLS 57/57,
diff --check 0/0), exactly scoped (5 files, V1–V17 untouched), correctly implements RISK-09
(SD search_path hardened to `vc, pg_catalog` + CREATE revoked on public), and is machine-proven
by test 57 (G1/G2/G3). Acceptance criterion #8 (complete Harness unittest) is honestly DEFERRED
per the Owner's static-gates-only strategy and is not converted to PASS. The candidate is
closure-ready; the Owner/candidate may proceed to terminal pre-closure, single-parent atomic
ACCEPTED commit, push, and remote 0/0 verification.
