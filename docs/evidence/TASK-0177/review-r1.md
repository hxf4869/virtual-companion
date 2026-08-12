# TASK-0177 Review R1 (self-review, longline convention)

- taskId: TASK-0177
- reviewer: repository-owner (longline self-review; C2 → independentReview not-required)
- candidateCommit: (TASK-0177 candidate, single-parent over base 885b5e26)
- riskClass: C2
- scope: BACKEND (single surface; distinctCrossRiskSurfaces=1)

## R1 scope (COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK)

## 1. Authorization & write-scope (writeAllowlist / forbiddenPaths)

- Changed paths (git status): 7 modified + 2 new, all inside writeAllowlist.
  - modified: AuthDataSourceConfig, GenerationWorkItemHandler, LiveInvocationAssembler,
    application.yaml, GenerationWorkItemHandlerTest, LiveInvocationAssemblerTest,
    GenerationFinalizeService.
  - new: AuthorizationSnapshotProvider (interface), infra/db/tests/67_*.sql.
- forbiddenPaths untouched: `service/modules/**`, `service/adapters/**`,
  `**/db/migration/V[1-9]|V1[0-9]|V2[0-9]__*.sql`, `specs/**`, `.harness/**` (except
  project-state/task-ledger), `skills/**`, `scripts/harness/**` — verified by
  `git status --porcelain` (no path matches any forbidden glob). modelruntime/safety
  source unchanged (consume-only). No new migration (V1–V25 frozen).
- **No C3/C4 trigger**: no modelruntime/safety source change, no new migration.

## 2. The V16 privilege discovery and rescope (critical)

- Original plan wired a runtime AuthorizationSnapshotService that direct-INSERTs
  authorization_snapshot. DB test 67 first run FAILED: `permission denied for table
  authorization_snapshot`.
- Root cause: V16 (L96-97) revoked INSERT/UPDATE/DELETE on authorization_snapshot from
  every runtime role; no `create_authorization_snapshot` SECURITY DEFINER function
  exists; JdbcAuthorizationSnapshotStore self-documents as a "persistence skeleton"
  (not a bean, superuser-only tests). So the runtime write path is unbuilt and requires
  a C4 migration.
- Owner decision (2026-08-12, in-session): **rescope to C2 persistence/audit chain**.
  Dropped runtime AuthorizationSnapshotService; introduced AuthorizationSnapshotProvider
  **interface seam** with no runtime bean (external branch not runtime-active, consistent
  with no loopback adapter). DB test 67 seeds snapshots as superuser (the established
  fixture pattern, e.g. test 59). record_provider_attempt is SECURITY DEFINER (postgres
  owner, GRANT vc_api) — its internal INSERT bypasses the vc_api direct-write block, same
  model as provider_attempt.
- No misrepresentation: the card, handoff and provider javadoc all state external mode
  is not runtime-active until TASK-0178.

## 3. INV-AUTH-001 (core invariant for this card)

- Every external attempt binds dual snapshots: enforced at DB layer by V20
  record_provider_attempt (7-param, both snapshot ids NOT NULL) + two composite FKs to
  authorization_snapshot(owner_user_id, snapshot_id). DB test 67 asserts the bound row
  (status=SUCCEEDED, req/exec snapshot ids) and the negative (unknown snapshot →
  foreign_key_violation). The handler reads both ids from ExternalAttemptBinding and
  passes them to recordProviderAttempt on SUCCEEDED and on degraded-with-attempt.

## 4. State-machine legality (V15 terminalize edges)

- Degraded external terminals are reached while the generation is IN_PROGRESS (safety/auth
  denial and no-eligible happen before any outbound; FAILED/TIMED_OUT/CANCELLED happen
  after). V15 allows `FAILED_FINAL ← IN_PROGRESS`. OUTPUT_BLOCKED is deliberately NOT used:
  V15 restricts `OUTPUT_BLOCKED ← FINAL_REVIEW` only, which the external path never
  reaches at the denial point. So all degraded terminals → FAILED_FINAL (legal). Correct.

## 5. Persistence chain order (SUCCEEDED)

- record_provider_attempt (independent of generation state; only checks existence) →
  insert_generation_candidate (rejects terminal; generation is IN_PROGRESS, OK) →
  promote FINAL_REVIEW → finalize_generation (requires FINAL_REVIEW + candidate; OK).
- If finalize faults, the provider_attempt row remains (the attempt provably happened) —
  correct audit semantics. outbox_eligible=false avoids a dangling PENDING
  memory.extract row (memory Java domain unwired).

## 6. Test coverage

- DB test 67: positive full chain (COMPLETED + provider_attempt SUCCEEDED + dual snapshot
  binding + usage 42/58 + non-empty provider_ref + quota SETTLE) + negative (FK reject).
  run-rls-tests.sh 67/67 PASS.
- GenerationWorkItemHandlerTest: 8 scenarios — skip / disabled / zero-llm-completed /
  unexpected-outcome / promotion-failure (0176, preserved) + external-succeeded /
  external-provider-failure (records attempt then terminalizes) / external-safety-block
  (no attempt, terminalizes). All PASS.
- LiveInvocationAssemblerTest: 3 scenarios (zero-llm two-hop+fence, placeholder+zero-fence,
  assembleExternal simulated+snapshots+protocol). PASS.
- mvn -pl service/apps/runtime -am test: 261/0/0 BUILD SUCCESS.

## 7. Adjacent risk

- ZERO_LLM path (TASK-0176) unchanged in behavior: when AuthorizationSnapshotProvider is
  absent (runtime default) the handler runs completeViaZeroLlm exactly as before; the 5
  preserved zero-llm tests pass. No regression.
- Bean wiring: AuthorizationSnapshotProvider has no bean → ObjectProvider#getIfAvailable
  returns null at runtime → no startup failure (ObjectProvider is nullable by design).
  assembler externalProtocol @Value has a default (OPENAI_CHAT_COMPLETIONS).

## 8. Findings

- P0: none. P1: none. P2: none.
- ACCEPTANCE: all 9 criteria met.
- INVARIANTS: INV-AUTH-001 (DB-enforced + asserted); INV-GEN-002/003, INV-TX-001
  execution points in V7/V15 SD (unchanged); INV-TENANT-001 (vc_api no BYPASSRLS, RLS
  owner_isolation) unchanged.

## Verdict

R1 PASS (C2, conditional; no blocking findings). canonical precheck /完整 unittest
discover / 根级 mvn verify deferred per Owner 2026-08-12 static-gates-only. Runtime
snapshot creation + loopback adapter e2e deferred TASK-0178.
