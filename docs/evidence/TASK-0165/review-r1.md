# R1 Independent Static Review — TASK-0165

- **Reviewer:** task0165_r1 (independent-review-gate, static-only per Owner 2026-08-12 acceleration strategy)
- **Task:** TASK-0165 — §5.1.4 quota 非负 CHECK + release 幂等
- **Verdict:** **PASS** — 0 P0 / 0 P1 / 0 P2; 1 P3 (informational, non-blocking, documented below)
- **Reviewed commit:** `8d5ac69462cf2a723e6e79a7ec0a2f8352a6b91d`
- **Candidate tree:** `3ce5bd6cfd90ee8db30b335271d3c1e1c1472dac`
- **Base:** `5f2df58a6221b7646671db2e7faf8db4e1515144` (TASK-0164 ACCEPTED terminal)
- **Authorization commit:** `37c34315c156f235bd6038609301ee650d595be7`

## 1. Method

Static-only R1 (Owner 2026-08-12 acceleration mode): read the full candidate diff +
implementation files, reason about correctness/scope/security invariants, and reference the
implementer's already-executed gates. No fresh-TMPDIR re-run of doctor / canonical / rls in this
mode. The implementer's gate outputs were inspected from their run logs and re-checked against the
candidate tree.

## 2. Static gates (implementer-executed, referenced)

| Gate | Result | Evidence |
|---|---|---|
| `bash infra/db/run-rls-tests.sh` | **PASS 60/60** (exit 0) | V1..V21 applied; test 57 `search_path_public_create_fail_closed` PASS (no regression); test 60 `quota_nonneg_check_and_release_idempotency` PASS (new). test 1-59 no regression (test 43 `candidate_and_quota_release` unchanged PASS). |
| `python scripts/harness/precheck.py --task TASK-0165` | **PASS 8/8** (exit 0) | doctor PASS (787021 checks), catalogValidate/catalogDrift/openapiValidate/openapiDrift/paidFeatureCheck/licenseCheck/betaRosterGate all PASS. |
| `git diff --check` | **PASS** (exit 0) | no whitespace/conflict markers. |
| Diff scope | **5 files, all in writeAllowlist** | V21 (new), test 60 (new), TASK-0165 card (new), context-lock (new), project-state.yaml. No forbidden path touched; V1-V20 untouched. |

## 3. Diff scope verification

Files changed vs base `5f2df58`:

1. `service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql` — **new**, in writeAllowlist.
2. `infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql` — **new**, in writeAllowlist.
3. `docs/tasks/TASK-0165-quota-nonneg-check-and-release-idempotency.md` — **new**, in writeAllowlist.
4. `docs/tasks/context/TASK-0165.context-lock.yaml` — **new**, in writeAllowlist.
5. `.harness/project-state.yaml` — activeTask/nextAction update, in writeAllowlist.

- V1-V20 migrations untouched (Flyway checksum safe). ✓
- test 01-59 untouched (test 43 in particular unchanged). ✓
- No `service/**/*.java` changed (QuotaLedger.java / GenerationRecovery.java untouched). ✓
- writeAllowlist ∩ forbiddenPaths = ∅ (canonical doctor confirmed zero conflict). ✓
- Authorization projection frozen at READY: doctor scans every commit
  `authorizationCommit..HEAD` (`7da5b70` binding → `d838ec5` IN_PROGRESS → `8d5ac69` fix); all
  three carry a card projection byte-identical to the READY checkpoint (only the mutable `state`
  field differs). No projection-changing commit in history. ✓

## 4. V21 migration — semantic analysis

### 4.1 Non-negative CHECK constraints (4)

Four `DO $$ ... IF NOT EXISTS (pg_constraint) ... ADD CONSTRAINT ... CHECK (...) ... END $$`
blocks, each idempotent (mirrors V7's FK constraint guard pattern):

- `generation_usage_input_tokens_nonneg CHECK (input_tokens >= 0)`
- `generation_usage_output_tokens_nonneg CHECK (output_tokens >= 0)`
- `generation_usage_actual_cost_nonneg CHECK (actual_cost >= 0)`
- `quota_ledger_entry_quota_amount_nonneg CHECK (quota_amount >= 0)`

**Correctness:** targets the exact columns V7:80-108 created with only `DEFAULT 0` (no numeric
sign constraint). `DEFAULT 0` satisfies `CHECK (>= 0)`, so a fresh migration with no historical
negative rows applies cleanly (no backfill). The CHECK is defense-in-depth: it catches the
`finalize_generation` write path (which validates no input sign — V7:178-328) AND any direct DML,
not only the `record_quota_release` RELEASE path that V17:1927 already guarded. ✓

### 4.2 Partial unique index

`CREATE UNIQUE INDEX IF NOT EXISTS quota_ledger_release_one_per_generation
ON vc.quota_ledger_entry (owner_user_id, generation_id) WHERE kind = 'RELEASE';`

**Correctness:** enforces at-most-one RELEASE per (owner, generation) — the per-generation
single-conversion invariant. The partial predicate excludes SETTLE rows, so the one-SETTLE-per-
finalize invariant (finalize runs once per generation via its row lock + conditional UPDATE
winner) is unaffected. Pattern matches V7's `message_generation_one_final` /
`generation_candidate_one_final`. ✓

### 4.3 `record_quota_release` idempotency guard (CREATE OR REPLACE)

Signature `(bigint, bigint, integer, text)` is **unchanged** → CREATE OR REPLACE preserves the
V15 EXECUTE grant (no GRANT/REVOKE needed; V17 also did none). The body preserves the V17
trusted-context assertion and all prior validation verbatim:
- `p_owner_user_id IS NULL` → raise ✓
- `IS DISTINCT FROM vc.current_owner_id()` trusted-context assertion ✓
- `owner_user_id and generation_id are required` ✓
- **non-negative guard (`quota_amount IS NULL OR < 0`) stays BEFORE the idempotency check** ✓ —
  a negative-amount call still raises regardless of whether a RELEASE already exists, preserving
  test 43's negative assertion (`record_quota_release(1, 5001, -1, 'bad-release')`).
- `reason is required` ✓
- generation exists ✓

New idempotency branch (after generation-exists check, before INSERT):
```sql
SELECT qle.id INTO v_existing ... WHERE kind='RELEASE';
IF FOUND THEN RETURN QUERY SELECT v_existing; RETURN; END IF;
```
A duplicate valid RELEASE returns the existing entry id and inserts no second row. The partial
unique index is the concurrency backstop: two sessions that both pass the existence check both
attempt INSERT and the second raises `unique_violation` (fail-closed) — verified by the index
existence and the idempotency ordering. ✓

**search_path:** `SET search_path = vc, pg_catalog` — the V18 (TASK-0158 RISK-09) baseline for
every vc SECURITY DEFINER function. CREATE OR REPLACE re-stamps the function's proconfig, so
re-declaring the exact `vc, pg_catalog` clause is required (re-stamping the V17-era `vc, public`
would regress test 57 G1). test 57 PASS confirms. The body is fully schema-qualified
(`vc.current_owner_id`, `vc.generation`, `vc.quota_ledger_entry`, `vc.finalize_row_id_seq`), so the
search_path value is runtime-neutral. ✓

### 4.4 Flyway / RLS / privileges

- V1-V20 untouched (checksum safe). ✓
- No RLS policy, role, BYPASSRLS/NOBYPASSRLS, or table PK/FK/column change. CHECK constraints and
  the partial index are orthogonal to FORCE RLS (V7) on both tables. ✓
- `record_quota_release` remains SECURITY DEFINER + trusted-context; EXECUTE grant preserved. ✓

## 5. test 60 — semantic analysis

Single-session positive/negative assertions under `SET ROLE vc_api` + `SET LOCAL vc.owner_user_id`,
mirroring the test 43 structure. Asserts:

1. **finalize negative input_tokens → check_violation + atomic rollback**: seeds a FINAL_REVIEW
   generation (6000) + candidate, calls `finalize_generation(..., -5, ...)`; the
   generation_usage INSERT hits `generation_usage_input_tokens_nonneg` and the whole finalize
   subtransaction rolls back (INV-TX-001). Post-assertion: zero usage rows for gen 6000. Proves
   the CHECK catches the real finalize write path. ✓
2. **quota_amount CHECK backstop (direct DML)**: a direct `INSERT ... quota_amount = -7` as vc_api
   raises check_violation even outside the function guard — proves the table CHECK is fail-closed
   for any writer, not only the function-guarded RELEASE path. ✓
3. **release idempotency**: `record_quota_release(1, 6001, 3, 'first')` → id1; a second
   `record_quota_release(1, 6001, 2, 'second')` returns the SAME id1 (no-op) and leaves exactly
   one RELEASE row. Proves the idempotency guard + the partial unique index together enforce
   one-RELEASE-per-generation. ✓
4. **validation ordering**: `record_quota_release(1, 6001, -1, ...)` after a RELEASE already
   exists still raises at the non-negative guard — proves idempotency no-op does not swallow an
   invalid-amount call. ✓
5. **unknown generation still rejected** — idempotency does not relax existence checks. ✓

No existing test modified; test 43 unchanged (its single successful RELEASE for gen 5001 is
unaffected; its negative/unknown-gen assertions still raise before the idempotency branch). ✓

## 6. Findings by severity

### P0 / P1 / P2 — none.

No security hole, data loss, invariant violation, functional defect, or scope violation:
- CHECK + idempotency are strict **strengthening** (fail-closed additions); no existing valid path
  is narrowed (test 43, finalize positive path in other tests, all PASS).
- §5.1.4 two enforcement legs (non-negative CHECK + per-generation single RELEASE) both land at
  the DB layer with machine proof (test 60).
- No Java touched; no catalog/contract/openapi drift (canonical PASS).
- No test deleted/skipped; no exit code swallowed.

### P3 (informational, non-blocking) — card-body prose vs implementation search_path value

- **Observation:** the task card body (frozen at the READY checkpoint per the doctor's
  authorization-projection immutability rule, which scans every commit `authorizationCommit..HEAD`)
  describes `record_quota_release`'s search_path as `vc, public` (the V17-era value), in 4 prose
  locations (范围内 / 范围外 / 验收标准 / 停止条件). The V21 implementation uses
  `SET search_path = vc, pg_catalog`.
- **Root cause:** the V17 source file literally declares `SET search_path = vc, public` for this
  function, but V18 (TASK-0158, RISK-09) rewrote every vc SECURITY DEFINER function's proconfig to
  `vc, pg_catalog` via an ALTER FUNCTION introspection loop. The card prose was authored against
  the V17 *source* value rather than the V18 *effective* baseline — a pre-READY inaccuracy.
- **Why it is non-blocking:**
  1. The card's *scope intent* ("do not change search_path behavior; keep the body
     schema-qualified; do not touch §5.1.5") is fully satisfied. "Preserve the current search_path"
     correctly resolves to the V18 baseline `vc, pg_catalog`; re-stamping `vc, public` would have
     been a *regression* (caught by test 57 G1). So the implementation correctly fulfills the
     intent.
  2. The *normative* authorization projection (writeAllowlist, forbiddenPaths, riskClass,
     baseCommit, requiredSkills, humanApprovals, deliveryBudgets) is correct and unchanged; the
     prose value is descriptive, not normative.
  3. The implementation is provably correct: test 57 PASS (G1 asserts every vc SD function has
     `search_path=vc, pg_catalog`) and the full suite is 60/60 PASS.
  4. The card body cannot be corrected post-READY without rewriting committed history, which the
     doctor forbids (it scans each commit's projection). The frozen prose is the lesser cost.
- **Residual risk:** zero functional/security/scope impact. A future reader of the card prose
  alone would see `vc, public`; cross-referencing test 57 / the V18 baseline / the V21
  implementation resolves it immediately. Recommend a one-line note in the terminal Handoff
  `knownRisks` (carried below) so the next session is not misled.

## 7. Acceleration-mode notes

- Per Owner 2026-08-12 static-gates-only strategy, complete Harness `unittest discover` is
  **deferred** to the unified end-of-longline audit (single-process serial run). It is not
  converted to a PASS here. The DB behavior is directly proven by run-rls-tests.sh 60 tests
  (including the §5.1.4 integration test 60).
- Standalone `doctor.py` calls (summary / DRAFT / READY / pre-closure) were skipped in this mode;
  the canonical precheck `doctor` subcommand is the single doctor gate and it PASSED (787021
  checks).
- R1 is static-only (no fresh-TMPDIR re-run of doctor/canonical/rls), per the acceleration policy.

## 8. Conclusion

**R1 PASS.** The §5.1.4 enforcement lands cleanly at the DB layer: four non-negative CHECK
constraints + a per-generation single-RELEASE partial unique index + an idempotency guard in
`record_quota_release` (signature-preserving CREATE OR REPLACE, V17 trusted-context preserved,
non-negative guard ordered before idempotency). test 60 machine-proves all five scenarios. V1-V20
frozen (Flyway safe); no Java/catalog/contract change. 0 P0/P1/P2; one P3 (card prose search_path
value vs V18 baseline, non-blocking, intent-consistent, impl provably correct via test 57). All
static gates PASS. Complete Harness unittest deferred to unified audit per Owner strategy.
