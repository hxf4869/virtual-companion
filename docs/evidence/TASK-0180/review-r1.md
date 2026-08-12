# TASK-0180 Review R1 (self-review, longline convention)

- taskId: TASK-0180
- reviewer: repository-owner (longline self-review; C2 → independentReview not-required)
- candidateCommit: (TASK-0180 candidate, single-parent over base 456e6d7e)
- riskClass: C2
- scope: BACKEND (single surface; distinctCrossRiskSurfaces=1)

## R1 scope (COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK)

## 1. Authorization & write-scope (writeAllowlist / forbiddenPaths)

- Changed paths (git status --porcelain -uall): 2 modified + 15 new, all inside
  writeAllowlist.
  - modified: AuthDataSourceConfig (+MemoryService bean + import),
    .harness/project-state.yaml, .harness/task-ledger.yaml.
  - new: MemoryRecord, MemoryEvidenceRecord, MemoryService (platform.persistence),
    MemoryController (runtime.memory.web), MemoryServiceTest,
    MemoryControllerTest + task card + context-lock + evidence-pack + review-r1
    + handoff.
- forbiddenPaths untouched: `service/modules/**`, `service/adapters/**`,
  `**/db/migration/*` (V1–V29 frozen via V[1-9]/V1[0-9]/V2[0-9] globs), `specs/**`,
  `auth/**` (application/web/jwt/tenant/config files), `runtime/conversation/**`,
  `runtime/generation/**`, `runtime/worker/**`, `runtime/relationship/**`,
  `runtime/web/**`, `runtime/message/**`, `runtime/cancel/**`,
  RelationshipService/RelationshipRecord (consumed, not modified), the 10
  pre-existing persistence test files, `.harness/**` (except
  project-state/task-ledger), `skills/**`, `scripts/harness/**`, `frontend/**`.
  OpenAPI spec unchanged (endpoints already defined; this card only adds the
  Java implementation). No new migration (V11/V12/V13 SD reused as-is). No C3/C4
  trigger.

## 2. Controller registration & auth context

- MemoryController is component-scanned (`@SpringBootApplication` over
  `com.virtualcompanion.runtime`) in a NEW package (runtime.memory.web — the
  message/cancel/relationship packages are protected); gated by
  `@ConditionalOnProperty(auth.datasource-enabled=true)`.
  `@AuthenticationPrincipal(expression="accountId")` binds the server-verified
  account id as owner; the owner GUC is bound upstream by the owner-injection
  filter (V17 trusted-owner assertion re-checks inside every V11/V12/V13 SD
  call). No client-supplied owner field anywhere.

## 3. NOT_FOUND_OR_FORBIDDEN / empty-page contracts (INV-TENANT-001 adjacent)

- Per-endpoint OpenAPI response-code audit (the 0179 lesson): single-resource
  endpoints (create/get/update/delete/confirm/reject) document 404 → service
  pre-checks map foreign/absent/deleted to Optional.empty → 404
  NOT_FOUND_OR_FORBIDDEN; collection endpoints (list/evidence) have NO 404 → a
  foreign relationship/id yields 200 with an empty array (list_memory /
  list_memory_evidence return no rows under relationship predicate + FORCE RLS;
  existence never disclosed). delete of an already-deleted memory → 404 (Owner
  2026-08-12 decision; SD-level idempotency covered by DB test 36).
- create pre-checks the relationship through RelationshipService.get (same
  package, mirrors GenerationCancelService → GenerationRepository), so a
  foreign relationship never reaches the SD RAISE.

## 4. Status-machine pre-checks + DataAccessException translation

- update pre-checks editable status {PENDING_CONFIRMATION, ACCEPTED}
  (REJECTED/EXPIRED → dead-end → 404); confirm/reject pre-check
  PENDING_CONFIRMATION (non-pending → 404) — both mirror the V11/V12 SD RAISE
  conditions, which stay authoritative under FOR UPDATE. A RAISE after a passed
  pre-check (concurrent state move) is caught and translated to
  Optional.empty → 404. THIS DIFFERS FROM TASK-0179's cancel (400): the memory
  OpenAPI contract explicitly maps "dead-end"/"otherwise transitioned" to
  NOT_FOUND_OR_FORBIDDEN — the per-endpoint audit conclusion.
- Translation is REQUIRED: the global `AuthExceptionHandler` maps a leaked
  DataAccessException to 401 AUTHENTICATION_REQUIRED (misleading). 
  BadSqlGrammarException (SQLSTATE 42883/42P01/42703/3F000) is rethrown so the
  existing 503 SCHEMA_UNAVAILABLE contract is preserved. Caller-input failures
  (non-positive ids, blank summary, non-Alpha scope, SESSION without
  conversationId, malformed includeDeleted) fail fast as IllegalArgumentException
  → 400 INVALID_REQUEST (0178/0179 precedent).

## 5. INV-MEM-001/002 (canonical memory truth & confirmation gate)

- All writes flow through the V11/V12/V13 SECURITY DEFINER functions; the card
  adds no direct DML (vc_api has no table-level rights since V11).
  create_memory_candidate always produces PENDING_CONFIRMATION; ACCEPTED is
  reached only via confirm (INV-MEM-002). update_memory is summary-only (status
  never changes, cannot promote or revive). delete is a soft-delete tombstone
  (deleted_at), excluded by every SD read (INV-MEM-001). recall_memory (V13) is
  intentionally not wrapped — runtime consumer scope, out of this card.

## 6. Modulith structure (RuntimeModuleStructureTest)

- runtime.memory.web depends only on platform.persistence (MemoryService,
  MemoryRecord, MemoryEvidenceRecord) and runtime.web (ResourceNotFoundException
  / RuntimeApiExceptionHandler), same as message/cancel/relationship packages —
  no cross-module web-package type dependency; the new package carries its own
  DTO records. RuntimeModuleStructureTest PASS.

## 7. Validation evidence (Owner 2026-08-12 static-gates-only)

- run-rls-tests.sh: 67/67 PASS (regression; V11–V13 untouched).
- `./mvnw -pl service/apps/runtime -am test`: BUILD SUCCESS — runtime 304/0/0
  (MemoryControllerTest 23), persistence 94/0/0 (MemoryServiceTest 28);
  Modulith PASS.
- git diff --check: exit 0.
- context-lock: round-trip reproduced TASK-0179 fingerprint 751b2354 (self
  verify), then authoritative verify_context_lock on TASK-0180 → no errors.
- doctor / canonical precheck / complete unittest discover / root mvn verify:
  NOT_RUN, deferred per Owner (static-gates-only) — recorded in evidence.

## R1 verdict

PASS (no P0/P1, no ACCEPTANCE_VIOLATION, no INVARIANT_VIOLATION). Non-blocking
notes: (P2) delete of an already-deleted memory returns 404 although the OpenAPI
description prose claims idempotent success — Owner-approved decision, SD-level
idempotency preserved (test 36), wire body stays schema-valid; (P3) the
conversationId of a RELATIONSHIP-scoped candidate, if supplied, is persisted by
the SD (V11 INSERT) — passthrough per OpenAPI, not a regression. No fix batch.
