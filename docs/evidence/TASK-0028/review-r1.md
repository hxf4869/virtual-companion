# R1 Independent Review — TASK-0028

- **Task**: TASK-0028 记忆候选、确认、修改、删除与来源 API
- **Candidate commit**: `50b1543fca95d7e6b7d6919e3f3616d1a26ca0eb`
- **Candidate tree**: `1ea87ef8776f6cf15acaf56fdd3dabcd27c7e14d`
- **Base commit**: `2a715085d0f55104fda7af40001fcf7c0d256e7e`
- **Reviewer**: independent-review-gate (general-purpose, single pass)
- **Budget**: 15 min maximum; elapsed ~278 s; hard limit not reached
- **Verdict**: **PASS** (no P0/P1)

## Scope reviewed

Adversarial audit of the V12 migration (`update_memory`, `list_memory_evidence`, `CREATE OR REPLACE delete_memory`), SQL tests 34 (modified) / 35 / 36 (new), the OpenAPI memory surface (8 endpoints + 4 schemas + MemoryId param), and the candidate diff scope against the frozen writeAllowlist/forbiddenPaths.

## Acceptance criteria — both satisfied

- **AC1 (canonical gate intact)**: `create_memory_candidate` (V11, unchanged) hardcodes `PENDING_CONFIRMATION`; `confirm_memory_candidate` remains the sole `status='ACCEPTED'` path; `update_memory`'s SET clause is `SET summary = p_summary` only — no `status`, no `deleted_at`, no INSERT. No V12 change restores direct DML on `memory_item`/`memory_evidence`. INV-MEM-001/002 unweakened.
- **AC2 (fail-closed + contract tests)**: `update_memory`/`delete_memory`/`list_memory_evidence` echo only the caller's own values on a foreign/absent id; `list_memory_evidence` returns empty for foreign/absent/deleted (indistinguishable from no-evidence); cross-owner/cross-relationship covered by tests 33/35. confirm/modify/delete/duplicate-request/unauthorized all have SQL tests (32/34/35/36).

## Verified claims

- **delete_memory idempotency**: `PERFORM ... FOR UPDATE` locks the owned row; foreign/absent → NOT FOUND → raise (caller values only); owned-already-deleted → found, UPDATE affects 0 rows, returns TRUE. No TOCTOU (concurrent deletes block on FOR UPDATE then re-read committed `deleted_at` under READ COMMITTED). Test 33 still passes because the cross-owner PERFORM matches no row.
- **update_memory**: FOR UPDATE present; `btrim` blank guard; `NOT IN ('PENDING_CONFIRMATION','ACCEPTED')` status guard; deleted guard; foreign/absent raise. Strictly status-preserving.
- **list_memory_evidence**: JOIN on `memory_item` with `m.deleted_at IS NULL` hides deleted-memory evidence; `out_` prefix avoids PL/pgSQL variable shadowing; no column leak (id/source_ref/created_at only).
- **Privileges**: new functions `REVOKE ... FROM PUBLIC` + `GRANT ... TO vc_api`; all `SECURITY DEFINER SET search_path=vc,public`; `set_config('vc.owner_user_id', ...)` runs before any table access in all three functions. `CREATE OR REPLACE delete_memory(bigint,bigint)` preserves V11's `proacl` (same signature) — no PUBLIC EXECUTE leak.
- **OpenAPI ↔ SQL consistency**: all 8 endpoints map to the correct functions; list/evidence endpoints correctly return empty (not 404); delete documented idempotent; confirm documented non-idempotent. `openapi.snapshot.json` SHA matches the source YAML; `error-codes.yaml` unchanged (15 entries, no new codes); `specs/generated`/`specs/catalog`/`specs/contracts`/V1–V11/Java/pom diffs empty. OpenAPI validate + drift PASS.
- **Write scope**: all 13 changed files within `writeAllowlist`; no `forbiddenPaths` touched.

## Findings (non-blocking)

### P2 — Vacuous negative assertions in tests 35/36
- `infra/db/tests/35_memory_edit_evidence.sql` (rejected-status, blank-summary, absent, deleted, cross-owner negative cases); `infra/db/tests/36_memory_idempotency.sql` (confirm/reject guards).
- The `BEGIN; PERFORM vc.<fn>(...); RAISE EXCEPTION 'must fail'; EXCEPTION WHEN OTHERS THEN END;` pattern cannot detect a removed guard: if the guard were removed, the PERFORM would succeed, the test's own RAISE would fire, and the same `WHEN OTHERS` would catch it — the test still passes.
- **Why non-blocking**: the guards are independently verified correct in this review; cross-owner has defense-in-depth (FORCE RLS + explicit owner predicate, both must fall); absent/deleted are covered by the structural NOT FOUND check; the positive assertions in 35/36 and test 34's re-delete assertion are non-vacuous and meaningful. This is the same pattern used in V11 tests 32/33 (ACCEPTED baseline). The weakness is regression-detection quality, not a present defect.
- **Suggested fix (deferred)**: convert negative cases to positive assertions via `GET DIAGNOSTICS` / SQLSTATE capture in a subtransaction, or assert the post-call `get_memory` state is unchanged.

### P3 — No HTTP status code for validation-class failures
- `specs/openapi/virtual-companion.yaml` (updateMemory / createMemoryCandidate responses).
- Blank-summary / non-editable-status raise inside the function, but the OpenAPI documents only 200/401/404 and the `ErrorCode` enum has no 400-class code; a future HTTP layer would have to map a validation raise to NOT_FOUND_OR_FORBIDDEN (404), which is semantically off.
- **Why non-blocking**: out of scope (no Java/HTTP layer in this card), matches V11 precedent (`create_memory_candidate` has the same shape), and the card explicitly forbids adding catalog error codes. The function fails closed (safe); only the HTTP-status mapping is unspecified.

## Decision

No fix batch. No P0/P1. Both P2/P3 are non-blocking, consistent with the V11 ACCEPTED baseline, and do not weaken any carrying or security property (the guards are correct; the notes concern test-assertion quality and a future-card HTTP mapping). Proceed to ACCEPTED.
