# TASK-0161 R1 Independent Review

## Verdict: PASS

**Reviewed commit:** 93325661d1909841ad8e7d69f2bf98bb2a69e2f8
**Candidate tree:** 68d066c9a507ad8a8da1301c4c1d550c2c664466
**Date:** 2026-08-12
**Reviewer:** independent R1 (replacement for TASK-0157 REJECTED TIMEOUT)
**Strategy note:** Static-gates-only per Owner 2026-08-12 authorization; complete `python -m unittest discover` deferred to unified project-wide audit. R1 did NOT run any unittest (forbidden by strategy). Acceptance criterion #2 (complete Harness unittest PASS) is superseded — Evidence records "deferred to unified audit".

## Review scope
- COMPLETE_MATRIX — full diff Base→Candidate line-by-line
- ACCEPTANCE — 7 criteria (criterion #2 unittest superseded by Owner strategy)
- INVARIANTS — INV-HARNESS-001/002/003/004/005/007/009
- ADJACENT_RISK — inherited implementation (872311a in Base b0c44fb) correctness

## Findings
### 0 P0 / 0 P1 / 0 P2

No blocking or non-blocking issues found.

**Diff scope (Base b0c44fb → Candidate 9332566):** exactly 3 files, all governance/metadata:
- `.harness/project-state.yaml` — activeTask TASK-0161, activeTaskCard path, nextAction updated (6 line change)
- `docs/tasks/TASK-0161-p2-27-complete-ci-matrix-replacement.md` — new task card (421 lines)
- `docs/tasks/context/TASK-0161.context-lock.yaml` — new context lock (162 lines, 39 inputs)

**No implementation files touched** (ci-execution-policy.yaml, doctor.py, test_harness.py, ci.yml NOT in diff — confirmed via `git diff --stat`). writeAllowlist adherence: PASS.

**Task card frontmatter (verified):**
- state=IN_PROGRESS (correct for R1 timing; becomes ACCEPTED at terminal)
- baseCommit=b0c44fb252a1b0ba1ac2c5f7fbae49b49a069b84 (TASK-0157 REJECTED terminal)
- authorizationCommit=21d2147b3933737a839ba2b3fdc85e642a3e6ece (READY commit)
- contextFingerprint=b4d84bf26d487c99077bf4a82c0e3b3ed9bb636ea212c035ab5c7d5f0655d339
- requiredSkillVersions: harness-change "1.1.7", task-delivery-flow "1.3.7", task-intake "1.2.7"
- deliveryBudgets.hardFuseWallMinutes=180, r3Forbidden=true, maximumReviewRounds=2
- humanApprovals: 3 scopes declared (task-assignment, harness-change, local-exact-tree-fallback)

**Context lock:** 39 inputs (38 file paths pinned to b0c44fb + 1 provenanceOnly `owner-authorization://longline-2026-08-09` hash cc0f91c1...). Fingerprint matches task card.

**project-state.yaml:** activeTask=TASK-0161, activeTaskCard path set, nextAction updated from "建立 TASK-0161 replacement..." to "完成 TASK-0161...". lastTerminalTask=TASK-0157, lastAcceptedTask=TASK-0160 (unchanged, correct).

**task-ledger.yaml:** TASK-0157 REJECTED entry present at Base (unchanged in candidate diff). TASK-0161 NOT in ledger — correct (added at terminal closure).

## Independent verification

| Check | Result |
|---|---|
| `doctor --task TASK-0161` | **PASS** (756217 checks, receipt e309cb51d708) |
| `precheck --task TASK-0161` (canonical, 8 commands) | **PASS** (doctor/catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck/betaRosterGate/openapiValidate/openapiDrift all PASS) |
| `git diff --check` (no args, working tree) | **exit 0** |
| `git diff --check b0c44fb..9332566` (Base→Candidate range) | **exit 0** |
| Diff scope | **3 files** (project-state.yaml + TASK-0161 task card + TASK-0161 context-lock.yaml; ONLY governance/metadata, zero implementation files) |
| Linear history | **yes** — 3 commits single-parent linear: `129b7fc` (DRAFT, +task card +context lock) → `21d2147` (READY, +project-state +state flip) → `9332566` (IN_PROGRESS, authorizationCommit binding, parent=21d2147) |
| Hash recompute (ci-execution-policy.yaml canonical) | **matches** — `f8f2ea2088cd6075c599fb406de6b1f9c65b52eb39fd14be9fe8ddb122ccd6fe` (boundary doctor blobOid/sha256 placeholder canonicalization applied to 6 task records) |
| Candidate tree SHA | **matches** — `68d066c9a507ad8a8da1301c4c1d550c2c664466` |

### Inherited implementation @ Base b0c44fb (4 files) — per-file verdict

**1. `.harness/ci-execution-policy.yaml` — PASS**
- BACKEND_LOCAL profile has `javaToolchain: {distribution: temurin, versionLine: "25-LTS", resolver: ACTIONS_SETUP_JAVA}` and `modifySystemJava: false`.
- Zero occurrences of `windowsJavaHome` anywhere in BACKEND_LOCAL (grep confirms only `javaToolchain` at line 195).

**2. `scripts/harness/doctor.py` — PASS**
- Assertion (L13091-13125) validates `backend.get("javaToolchain") == {distribution: temurin, versionLine: "25-LTS", resolver: "ACTIONS_SETUP_JAVA"}`, asserts `"windowsJavaHome" not in backend`, plus frontend nodeVersion=22/pnpmVersion=11.9.0 and full_stack composeProfiles binding.
- `CI_EXECUTION_POLICY_CANONICAL_HASH` (L175-177) = `f8f2ea2088cd6075c599fb406de6b1f9c65b52eb39fd14be9fe8ddb122ccd6fe` — matches recomputed hash.
- Boundary doctor hashes (TASK_0072_BOUNDARY_DOCTOR_BLOB_OID=6c934c..., TASK_0072_BOUNDARY_DOCTOR_SHA256) unchanged.

**3. `scripts/harness/tests/test_harness.py` — PASS**
- New test `test_policy_rejects_backend_and_frontend_local_profile_drift` (L2558+) with **exactly 7 subTest variants**:
  1. `windowsJavaHome_returned`
  2. `missing_javaToolchain`
  3. `javaToolchain_versionLine_drift`
  4. `javaToolchain_resolver_unsupported`
  5. `javaToolchain_distribution_drift`
  6. `frontend_pnpmVersion_drift`
  7. `frontend_nodeVersion_drift`
- Each variant asserts `audit.errors` non-empty (drift detected). Correct negative-test design.

**4. `.github/workflows/ci.yml` — PASS**
- `backend` job: 3-OS matrix (ubuntu-latest 30min, windows-latest 30min, macos-latest 30min), fail-fast:false, Java temurin 25, Maven cache, `./mvnw --batch-mode --no-transfer-progress verify`.
- `frontend` job: 3-OS matrix (ubuntu 20min, windows 25min, macos 20min), fail-fast:false, pnpm 11.9.0.
- `database` job: Linux-only reference platform (ubuntu-latest, PostgreSQL 18 + pgvector, 20min) — annotation "Linux-only reference platform" present.
- `harness-full` (ubuntu) and `harness-smoke` (windows/macos) unchanged — INV-HARNESS-004 cross-platform parity preserved.

### Acceptance criteria verdict

| # | Criterion | Verdict |
|---|---|---|
| 1 | Candidate 872311a implementation unchanged in Base | **PASS** (4 files verified above) |
| 2 | Complete Harness unittest PASS (278+ tests) | **DEFERRED** — Owner 2026-08-12 static-gates-only strategy; recorded for unified audit. Not represented as PASS. |
| 3 | Canonical precheck 8/8 PASS | **PASS** (independently re-run) |
| 4 | `git diff --check` exit 0 | **PASS** (both working tree and Base→Candidate range) |
| 5 | R1 independent review PASS (0 P0/P1/P2) | **PASS** (this review) |
| 6 | Terminal closure (pre-closure, single-parent ACCEPTED, push, 0/0, clean) | **PENDING** — not in R1 scope; evaluated at closure |
| 7 | INV-HARNESS-004 improvement | **PASS** — 3-OS backend/frontend matrix landed via inherited candidate |

### Invariants compliance

| Invariant | Verdict | Basis |
|---|---|---|
| INV-HARNESS-001 | PASS | AGENTS.md / CLAUDE.md untouched; canonical source preserved |
| INV-HARNESS-002 | PASS | Single active task (TASK-0161), single-parent atomic commits, frozen context + diff scope honored (3-file governance-only diff) |
| INV-HARNESS-003 | PASS | C4 harness-change requires independent review (this R1) + humanApproval(scope: harness-change) declared; no protected path bypassed |
| INV-HARNESS-004 | PASS | Windows/macOS/Linux Harness parity improved via inherited 3-OS matrix; no platform-specific fork introduced |
| INV-HARNESS-005 | PASS | No unexecuted check represented as PASS; unittest explicitly DEFERRED with Owner strategy on record, not converted to PASS |
| INV-HARNESS-007 | PASS | Single registered machine policy (task-delivery-policy.yaml); bounded review (r3Forbidden=true, maxRounds=2); exact candidate identity (9332566/68d066c); LOCAL_EXACT_TREE_FALLBACK profile=precheck owner-authorized |
| INV-HARNESS-009 | PASS | Remote exact-SHA channel如实 non-PASS (dispatchCount=0); LOCAL_EXACT_TREE_FALLBACK owner-authorized 2026-08-11; deferred unittest gap not represented as PASS |

### Adjacent risk

The inherited candidate 872311a (already in Base b0c44fb) is the entire deliverable for P2-27. Independent re-verification of all 4 implementation files confirms the static layer is correct: policy/doctor/test/workflow all coherent, canonical hash matches, negative tests cover the 7 drift dimensions, 3-OS matrix structured with correct timeouts and fail-fast disabled. The only unverified layer is the full unittest run (deferred per Owner strategy) — this is a known, explicitly-authorized gap, not a silent risk. No regression vectors identified in the governance-only diff.

## Recommendation

**ACCEPTED** (at terminal closure).

R1 finds 0 P0/P1/P2. Static gates all PASS: doctor 756217 checks, canonical precheck 8/8, git diff --check exit 0, hash recompute matches, diff scope is governance-only (3 files), linear single-parent history, inherited 4-file implementation independently verified correct. Acceptance criterion #2 (complete unittest) is deferred to the unified project-wide audit per Owner 2026-08-12 static-gates-only authorization — gap on record, not converted to PASS. Terminal closure may proceed: pre-closure doctor + single-parent [skip ci] ACCEPTED + push + remote 0/0/clean verification, with Evidence recording the unittest deferral.
