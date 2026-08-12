# TASK-0178 Review R1 (self-review, longline convention)

- taskId: TASK-0178
- reviewer: repository-owner (longline self-review; C2 → independentReview not-required)
- candidateCommit: (TASK-0178 candidate, single-parent over base a8db88c2)
- riskClass: C2
- scope: BACKEND (single surface; distinctCrossRiskSurfaces=1)

## R1 scope (COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK)

## 1. Authorization & write-scope (writeAllowlist / forbiddenPaths)

- Changed paths (git status): 1 modified + 8 new, all inside writeAllowlist.
  - modified: AuthDataSourceConfig (+RelationshipService bean).
  - new: RelationshipRecord, RelationshipService, RelationshipController,
    runtime.web/ErrorEnvelope, runtime.web/ResourceNotFoundException,
    runtime.web/RuntimeApiExceptionHandler, RelationshipServiceTest,
    RelationshipControllerTest.
- forbiddenPaths untouched: `service/modules/**`, `service/adapters/**`,
  `**/db/migration/*`, `specs/**`, `auth/**` (application/web/jwt/tenant),
  `.harness/**` (except project-state/task-ledger), `skills/**`,
  `scripts/harness/**` — verified by `git status --porcelain`. OpenAPI spec
  unchanged (endpoints were already defined; this card only adds the Java
  implementation). No new migration (V1–V25 frozen). No C3/C4 trigger.

## 2. Controller registration & auth context

- Controllers are component-scanned (`@SpringBootApplication` over
  `com.virtualcompanion.runtime`), matching GenerationController/
  ConversationController; gated by
  `@ConditionalOnProperty(auth.datasource-enabled=true)` so no bean exists
  without a real database. `@AuthenticationPrincipal(expression="accountId")`
  binds the server-verified account id as owner; the owner GUC is bound
  upstream by the owner-injection filter (V17 trusted-owner assertion re-checks
  inside every V9 SD call). No client-supplied owner field anywhere.

## 3. NOT_FOUND_OR_FORBIDDEN contract (INV-TENANT-001 adjacent)

- get: SD returns empty table for a foreign/absent id under FORCE RLS → empty
  Optional → 404. activate: pre-check get → empty before the SD RAISE path.
  deactivate: SD returns false for a foreign/absent id → empty → 404. Existence
  is never disclosed; messages are stable and non-sensitive.

## 4. Modulith structure (RuntimeModuleStructureTest)

- First attempt imported `auth.web.ErrorEnvelope` into the `web` module and the
  Modulith test failed: "Module 'web' depends on non-exposed type
  auth.web.ErrorEnvelope". Fix: runtime.web owns a same-shape ErrorEnvelope
  record (code+message, OpenAPI wire contract identical). auth/web/** is
  protected and cannot be given an exposes annotation. The two records coexist
  in different modules with identical wire format; documented in knownRisks.
  RuntimeModuleStructureTest now PASS.

## 5. Validation semantics

- @Valid @RequestBody + @NotBlank @Size(max=128) on personaRef; blank body →
  MethodArgumentNotValidException/HandlerMethodValidationException →
  400 INVALID_REQUEST (handler added; first test run surfaced an empty-body 400
  from Spring's default handling — the explicit handlers make the contract
  deterministic). parseId rejects non-numeric/non-positive → 400 INVALID_REQUEST.

## 6. Test coverage

- RelationshipControllerTest: 10 scenarios (create/list/get/activate/deactivate
  happy paths; get/activate/deactivate foreign → 404; blank persona → 400;
  invalid id → 400) via standalone MockMvc with a custom
  `@AuthenticationPrincipal` resolver returning the accountId for long params
  (replicating the auth controller test pattern; the SpEL expression is not
  evaluated by custom resolvers — returning the long value directly is the
  correct replication).
- RelationshipServiceTest: 7 scenarios (create SQL+return, blank persona
  rejected, list RowMapper, get empty, activate empty, deactivate false→empty,
  deactivate true→updated row).
- mvn -pl service/apps/runtime -am test: 271/0/0 BUILD SUCCESS (persistence
  module 7 service tests + runtime module 10 controller tests + Modulith PASS).

## 7. Adjacent risk

- AuthExceptionHandler still owns auth-flow failures (401/503); the runtime
  advice owns 404/400. No overlap: the runtime advice handles only
  ResourceNotFoundException / IllegalArgumentException / validation exceptions
  which the auth advice does not handle.
- ZERO_LLM / external provider worker paths untouched (no regression; the 8
  GenerationWorkItemHandler tests and 3 assembler tests pass).
- V9 relationship functions unchanged; DB tests 26/27/28/29 (relationship
  lifecycle) pass in the 67/67 run-rls regression.

## 8. Findings

- P0: none. P1: none. P2: none.
- ACCEPTANCE: all 9 criteria met.
- INVARIANTS: INV-TENANT-001 (owner-scoped reads + no existence disclosure)
  verified; INV-GEN-*/INV-TX-001/INV-AUTH-001 untouched (execution points in
  SD functions, unchanged).

## Verdict

R1 PASS (C2, conditional; no blocking findings). canonical precheck /完整
unittest discover / 根级 mvn verify deferred per Owner 2026-08-12
static-gates-only. listMessages + cancelGeneration deferred TASK-0179.
