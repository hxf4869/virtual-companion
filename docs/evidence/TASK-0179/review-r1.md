# TASK-0179 Review R1 (self-review, longline convention)

- taskId: TASK-0179
- reviewer: repository-owner (longline self-review; C2 → independentReview not-required)
- candidateCommit: (TASK-0179 candidate, single-parent over base ce12b488)
- riskClass: C2
- scope: BACKEND (single surface; distinctCrossRiskSurfaces=1)

## R1 scope (COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK)

## 1. Authorization & write-scope (writeAllowlist / forbiddenPaths)

- Changed paths (git status): 2 modified + 10 new, all inside writeAllowlist.
  - modified: AuthDataSourceConfig (+MessageHistoryService / +GenerationCancelService
    beans + imports), .harness/project-state.yaml, .harness/task-ledger.yaml.
  - new: MessageHistoryRecord, MessageHistoryService, GenerationCancelService,
    MessageHistoryController (runtime.message.web), GenerationCancelController
    (runtime.cancel.web), MessageHistoryServiceTest, GenerationCancelServiceTest,
    MessageHistoryControllerTest, GenerationCancelControllerTest + task card +
    context-lock + evidence + handoff.
- forbiddenPaths untouched: `service/modules/**`, `service/adapters/**`,
  `**/db/migration/*` (V1–V25 frozen), `specs/**`, `auth/**`
  (application/web/jwt/tenant), `runtime/conversation/**`, `runtime/generation/**`,
  `runtime/worker/**`, `runtime/relationship/**`, `runtime/web/**`,
  MessageRepository, `.harness/**` (except project-state/task-ledger),
  `skills/**`, `scripts/harness/**` — verified by `git status --porcelain`.
  OpenAPI spec unchanged (endpoints already defined; this card only adds the
  Java implementation). No new migration (V10 SD reused as-is). No C3/C4
  trigger.

## 2. Controller registration & auth context

- Controllers are component-scanned (`@SpringBootApplication` over
  `com.virtualcompanion.runtime`) in NEW packages (runtime.message.web /
  runtime.cancel.web — the conversation/generation packages are protected);
  gated by `@ConditionalOnProperty(auth.datasource-enabled=true)`.
  `@AuthenticationPrincipal(expression="accountId")` binds the server-verified
  account id as owner; the owner GUC is bound upstream by the owner-injection
  filter (V17 trusted-owner assertion re-checks inside every V10 SD call). No
  client-supplied owner field anywhere.

## 3. NOT_FOUND_OR_FORBIDDEN / empty-page contracts (INV-TENANT-001 adjacent)

- cancel: `GenerationRepository.find` pre-check → foreign/absent → empty
  Optional → 404 NOT_FOUND_OR_FORBIDDEN (SD RAISE never reached, existence
  never disclosed). listMessages: the OpenAPI contract has no 404 — a foreign
  or absent conversation yields 200 with an empty page (list_messages returns
  no rows under FORCE RLS; the composite ownership FK guarantees no cross-owner
  row can exist).

## 4. Cancellability pre-check + DataAccessException translation (INV-GEN-003 adjacent)

- `GenerationCancelService` mirrors the V10 catalog cancellable state set
  (CREATED/INPUT_REVIEW/QUEUED/IN_PROGRESS/WAITING_FOR_CAPACITY/FINAL_REVIEW)
  in a pre-check → terminal/COMMITTING fails fast as IllegalArgumentException →
  400 INVALID_REQUEST without touching the DB write path. The SD function
  remains the authority (FOR UPDATE + catalog double-hop CANCEL_REQUESTED →
  CANCELLED); a RAISE after the pre-check (concurrent terminal transition) is
  caught and translated to IllegalArgumentException. Translation is REQUIRED:
  the global `AuthExceptionHandler` maps a leaked DataAccessException to 401
  AUTHENTICATION_REQUIRED (misleading for a state conflict), while
  `BadSqlGrammarException` (SQLSTATE 42883/42P01/42703/3F000) is rethrown to
  preserve the existing 503 SCHEMA_UNAVAILABLE contract. First compile surfaced
  a wrong import package (org.springframework.dao.BadSqlGrammarException vs
  org.springframework.jdbc) — fixed.

## 5. Modulith structure (RuntimeModuleStructureTest)

- runtime.cancel.web declares its own same-shape `GenerationResponse`
  (generationId/conversationId/logicalGenerationId/status) instead of importing
  `GenerationController.GenerationResponse`: the generation module's web-package
  types are not depend-on-able across modules (and runtime/generation/** is a
  protected path that cannot gain an exposes). Wire format identical; documented
  in knownRisks (same pattern as the duplicated ErrorEnvelope). New modules
  message/cancel depend only on runtime.web (verified legal by TASK-0178).
  RuntimeModuleStructureTest PASS.

## 6. Query-parameter parsing

- after/limit are bound as String and parsed manually (parseOptionalLong /
  parseOptionalInt): a non-numeric value raises IllegalArgumentException → 400
  INVALID_REQUEST deterministically. Binding them as Integer would have surfaced
  MethodArgumentTypeMismatchException, which the runtime advice does not handle
  (500 instead of 400). null (absent) is passed through so the SD applies its
  defaults/clamp (default 50, max 100) — the SQL stays a faithful 4-parameter
  call.

## 7. Test coverage

- MessageHistoryControllerTest: 6 scenarios (happy page with conversationId
  injection + createdAt; foreign/absent conversation → 200 empty; defaults
  delegated; after non-numeric → 400; limit non-numeric → 400; invalid
  conversation id → 400).
- GenerationCancelControllerTest: 4 scenarios (happy → 200 CANCELLED; foreign/
  absent → 404; not-cancellable → 400; invalid id → 400).
- MessageHistoryServiceTest: 5 (exact V10 SQL 4-param call; null passthrough;
  RowMapper; owner/conversation guards).
- GenerationCancelServiceTest: 7 (happy path with chained find stubs; foreign →
  empty without SD call; terminal pre-check → IAE without SD call; SD RAISE
  translation; BadSqlGrammar rethrow; argument guards; unexpected SD status →
  IllegalStateException).
- mvn -pl service/apps/runtime -am test: 281/0/0 BUILD SUCCESS (persistence
  module 66 + runtime module 281 incl. Modulith PASS). run-rls 67/67.

## 8. Adjacent risk

- AuthExceptionHandler still owns DataAccessException (401/503); the runtime
  advice owns 404/400. No overlap introduced: the cancel service translates
  business RAISEs before they can reach the auth advice; schema-unavailable
  failures still classify 503. listMessages introduces no write path.
- ZERO_LLM / external provider worker paths untouched (GenerationWorkItemHandler
  8 tests + LiveInvocationAssembler 3 tests pass).
- V10 functions unchanged; DB tests 30 (cancel) / 31 (message history
  pagination) / 41 / 45 pass in the 67/67 run-rls regression.

## 9. Findings

- P0: none. P1: none. P2: none.
- ACCEPTANCE: all 9 criteria met.
- INVARIANTS: INV-TENANT-001 (owner-scoped reads + no existence disclosure)
  verified; INV-GEN-* (stable generation identity, unique terminal, cancel
  contract) preserved by reusing the V10 SD; INV-TX-001/INV-AUTH-001 untouched
  (execution points in SD functions, unchanged).

## Verdict

R1 PASS (C2, conditional; no blocking findings). canonical precheck / 完整
unittest discover / 根级 mvn verify deferred per Owner 2026-08-12
static-gates-only. memory HTTP 端点 deferred next card.
