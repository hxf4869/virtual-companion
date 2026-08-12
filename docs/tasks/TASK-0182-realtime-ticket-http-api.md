# TASK-0182：realtime ticket HTTP 端点（wire 3 realtime bean + POST /api/v1/realtime/tickets + OpenAPI 同步；C2）

```yaml
taskId: TASK-0182
state: ACCEPTED
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 241b8d6d92c5a539a1523545c113a8f0e0c8791d
authorizationCommit: "plan-approved-2026-08-12-realtime-ticket-http-api"
contextFingerprint: b717b548e21ff84c225ba6ea1b97c851895d6b6664b2784c2f7b9be7e629b76b
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0182.context-lock.yaml
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0182_REALTIME_TICKET_HTTP_API
  policySurfaces: [BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - bash infra/db/run-rls-tests.sh
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin python scripts/dev/openapi_tool.py diff
  - git diff --check
readAllowlist:
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - AGENTS.md
  - CLAUDE.md
  - docs/evidence/TASK-0181/evidence-pack.json
  - docs/evidence/TASK-0181/review-r1.md
  - docs/handoffs/TASK-0181.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/TASK-0028-memory-candidate-management-api.md
  - docs/tasks/TASK-0181-authorization-snapshot-external-activation.md
  - docs/tasks/context/TASK-0181.context-lock.yaml
  - docs/tasks/task-card-template.md
  - frontend/src/api/memory.ts
  - frontend/src/stores/memory.ts
  - infra/db/run-rls-tests.sh
  - infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql
  - infra/db/tests/66_generation_zero_llm_completed_chain.sql
  - pom.xml
  - scripts/dev/openapi_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/conversation/web/ConversationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/generation/web/GenerationController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ZeroLlmModelRuntimeConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerCookieTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/LiveInvocationAssemblerTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/DataCategory.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProcessingPurpose.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderContractRef.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderRegion.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/AdapterLocator.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/InMemoryAdapterLocator.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptTerminal.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/ProviderAttemptAudit.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DeterministicRouter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/Entitlement.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaDisposition.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaReservation.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryTerminal.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RouteDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RoutingRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/ServiceClass.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/ClassifierReport.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/DeterministicSafetyResponse.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/memory-scopes.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/realtime/web/RealtimeTicketController.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/realtime/web/RealtimeTicketControllerTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - docs/tasks/TASK-0182-realtime-ticket-http-api.md
  - docs/tasks/context/TASK-0182.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0182/**
  - docs/handoffs/TASK-0182.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-018[01]-*
  - docs/tasks/context/TASK-018[01].context-lock.yaml
  - docs/evidence/TASK-018[01]/**
  - docs/handoffs/TASK-018[01].json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - scripts/harness/**
  - scripts/dev/**
  - .github/workflows/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/**/pom.xml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationCreateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemEnqueueService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotProvider.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotProvider.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MemoryService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MemoryRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRepository.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationCancelServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationReceiveServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStoreTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotProviderTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/MemoryServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/MessageHistoryServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeResumeServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepositoryTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RelationshipServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V[1-2][0-9]__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/loopback/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeScheduler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/generation/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/relationship/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/web/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/message/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/cancel/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/memory/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/generation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/relationship/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/message/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/cancel/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/memory/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/loopback/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/[0-9][0-9]_*.sql
  - frontend/**
  - .mvn/**
  - pom.xml
  - mvnw
  - mvnw.cmd
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0181.json
requiredInvariants:
  - INV-RT-001
  - INV-TENANT-001
  - INV-TX-001
  - INV-GEN-003
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 9d4e1f7a-3c5b-4a6e-8d1f-2e7b9c0a4f3e
    evidence: >-
      Owner 2026-08-12 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT 治理例外）。
      TASK-0181 闭环后 nextAction 指向 realtime SSE 推送；经代码调研确认 V8 十个 SD 函数（issue_realtime_ticket
      / resume_stream / consume_realtime_ticket / read_generation_snapshot 等）与 7 个 SQL 测试（19-25/49/50/61）
      全就绪，persistence 三个 realtime 类（RealtimeTicketRepository / RealtimeResumeService /
      RealtimeEventRepository）已实现但零 wire，runtime 无 SSE 先例。关键发现：契约 realtime-contract.yaml
      L7 已定义 ticket.endpoint POST /api/v1/realtime/tickets，但 OpenAPI 源尚未同步该端点；SSE resume 端点
      path 在契约和 OpenAPI 均未命名。Owner 2026-08-12 现场拍板范围（选项 A）：本卡只做 ticket 端点——wire
      3 个 realtime bean + RealtimeTicketController（POST /api/v1/realtime/tickets，同步 HTTP，照 MemoryController
      模板）+ 把契约已定义的 ticket path 同步进 OpenAPI 源（specs/openapi/** 非 protected-path）+ openapi_tool.py
      generate 重建 dist 生成物保持单源一致；SSE resume 端点（SseEmitter + V8 resume_stream + 契约补 resume endpoint）
      拆 TASK-0183（需改 specs/contracts/ → C3 contract-change skill）。不碰 specs/contracts/、不改 DB、不改
      modelruntime/safety/adapters。C2 卡：requiredSkills task-delivery-flow + task-intake（无 contract-change）、
      independentReview not-required（仍按长线惯例产出 review-r1）。设计决策：transport 服务端硬编码 FETCH_SSE
      （契约 Alpha 唯一值，不从 body 取）；ownerUserId 取自 principal 不在 body；generation foreign/absent 经
      ensure_realtime_stream raise → DataAccessException 在 controller 翻译为 404 NOT_FOUND_OR_FORBIDDEN
      （不披露存在性，且避免被全局 AuthExceptionHandler 误映射 401）；BadSqlGrammarException 上抛保 503。
independentReview: not-required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion 纵切的
> realtime ticket HTTP 卡（TASK-0021 realtime 契约纵切），承接 TASK-0181 的 nextAction，沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0181
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何 C3/C4 保护路径**：`specs/contracts/**`(C3)、
> `specs/catalog/**`(C3)、`specs/generated/**`(C3)、`**/db/migration/**`(C4)、`service/**/safety/**`(C4)、
> `service/modules/**`(C3)、`service/adapters/**`(C3) 均不改。本卡唯一新写路径是 `specs/openapi/**`
> （OpenAPI 源 + dist 生成物，非 protected-path）+ `runtime/realtime/web` 新包 + `AuthDataSourceConfig`
> bean 追加。故 riskClass=C2，independentReview=not-required（仍按长线惯例产出 review-r1）。

## 背景与用户可观察目标

realtime-contract.yaml（`REALTIME_RESUME_TICKET_GAP_RESET`）L7 已定义 ticket 端点
`POST /api/v1/realtime/tickets`（TTL 45s、single-use、serverStoresHashOnly、boundTo 七元组），V8 的
`issue_realtime_ticket` SECURITY DEFINER 函数已就绪（GRANT vc_api），但 OpenAPI 源未同步该端点、
persistence 三个 realtime 类（RealtimeTicketRepository / RealtimeResumeService / RealtimeEventRepository）
零 wire、runtime 无 realtime 包——客户端无法申请 resume ticket。本卡补齐 ticket 端点的 HTTP 层 +
OpenAPI 同步 + bean wiring，为后续 SSE resume 端点（TASK-0183）铺路。

当前 HEAD（241b8d6d）事实（代码核实）：

1. **OpenAPI 现状**：17 个 path 全列出（version/relationships/conversations/messages/generations/snapshot/
   memories/auth）；realtime 相关仅 `GET /api/v1/generations/{generationId}/snapshot`（L285-314，已由
   GenerationController 实现）；**无 `POST /api/v1/realtime/tickets`、无任何 SSE/stream 端点**。memory 端点
   （L354+）由 TASK-0180 实现，证实纵切卡 0174-0180 不改 OpenAPI（端点早由 TASK-0023/0025 基线定义）；
   本卡是纵切系列首次给 OpenAPI 新增业务端点。`specs/openapi/**` 不在 protected-paths 清单（仅 catalog/
   contracts/generated 是保护路径）。
2. **ticket 端点契约**（realtime-contract.yaml）：`POST /api/v1/realtime/tickets`、TTL 45s、single-use、
   `serverStoresHashOnly: true`、boundTo 七元组（ownerUserId/sessionId/generationId/origin/transport/
   streamEpoch/afterSeq）、`mayContainLongLivedCredential: false`、transport alpha 固定 `FETCH_SSE`。
3. **V8 issue_realtime_ticket**（L484-527）：SECURITY DEFINER、校验 session_id/origin 非空、transport==FETCH_SSE、
   `set_config('vc.owner_user_id', ...)` 建 trusted-owner、**`PERFORM * FROM ensure_realtime_stream(...)`**
   （generation 不存在/不属 owner → RAISE 不披露）、gen_random_uuid 生成 secret + sha256 存储、TTL 45s、
   GRANT vc_api。返回 `(out_ticket_id bigint, out_secret text)`。
4. **RealtimeTicketRepository.issue**（已实现、零 wire）：`issue(ownerUserId, generationId, sessionId, origin,
   transport, streamEpoch, afterSeq) → IssuedTicket(ticketId, secret)`；`consume(...)` 方法已存在留给 SSE 卡；
   validateIssue 校验 transport==FETCH_SSE。RealtimeResumeService / RealtimeEventRepository 同样已实现零 wire。
5. **错误映射**（TASK-0180 教训）：全局 `AuthExceptionHandler` 把 DataAccessException→401（误映射！除非
   SQLSTATE 42xxx→503）。SD 业务 RAISE（如 generation not found）若逃逸会被误映射 401，故 controller 必须
   catch：BadSqlGrammarException（schema 错）上抛保 503；其余 DataAccessException（业务 raise）→ 404
   NOT_FOUND_OR_FORBIDDEN（不披露）。`runtime/web/RuntimeApiExceptionHandler` 映射 ResourceNotFoundException→404、
   IAE→400（直接复用）。
6. **Controller 模板**（MemoryController/GenerationController）：`@RestController @RequestMapping("/api/v1")
   @ConditionalOnProperty(auth.datasource-enabled=true)`；`@AuthenticationPrincipal(expression="accountId") long
   ownerUserId`；`@Valid @RequestBody` + 嵌套 record DTO；`parseId`（Long.parseLong 正数校验）；组件扫描注册。
7. **OpenAPI 工具**（scripts/dev/openapi_tool.py）：`validate`/`generate`/`diff`；generate 确定性重建
   `specs/openapi/dist/`（api-bundle.yaml + java records + VirtualCompanionApi.java + typescript/api.ts +
   openapi.snapshot.json）；diff 检查 committed 与 freshly generated 是否一致。修改源后必须 generate 保持
   单源契约（TASK-0023）。dist 生成物属 `generatedFilesAreNotEditable`，只能经 generate 产生。

用户可观察结果（本卡完成后）：

- **POST /api/v1/realtime/tickets**：body（generationId/sessionId/origin/streamEpoch/afterSeq，均 decimal string）
  → 200 返回 `{ticketId, secret}`（secret 一次性明文，服务端仅存 sha256）；foreign/absent generation → 404
  NOT_FOUND_OR_FORBIDDEN（不披露）；非法 id/counter/缺字段 → 400 INVALID_REQUEST；schema 不可用 → 503。
- **OpenAPI 源与 dist 一致**：ticket 端点 + RealtimeTicketCreateRequest/RealtimeTicket schema 同步进源，
  dist 生成物经 openapi_tool.py generate 重建（drift gate PASS）。
- **bean wiring**：RealtimeTicketRepository / RealtimeResumeService / RealtimeEventRepository 三个 bean 装配进
  AuthDataSourceConfig（auth.datasource-enabled=true）；本卡 controller 注入 ticketRepository；resume/event
  为 SSE 卡铺路。

## 范围内

1. **OpenAPI 源加 ticket 端点 + 2 schema**（`specs/openapi/virtual-companion.yaml`）：`POST /api/v1/realtime/tickets`
   （operationId `createRealtimeTicket`，200 RealtimeTicket / 400 INVALID_REQUEST / 401 / 404
   NOT_FOUND_OR_FORBIDDEN）；schema `RealtimeTicketCreateRequest{generationId, sessionId, origin, streamEpoch,
   afterSeq}`（string 必填）+ `RealtimeTicket{ticketId, secret}`（string 必填）。prose 明确 owner 来自 principal、
   transport 服务端固定、secret 一次性、foreign generation→404 不披露。
2. **重建 dist 生成物**（`python scripts/dev/openapi_tool.py generate`）：api-bundle.yaml、openapi.snapshot.json、
   VirtualCompanionApi.java（+createRealtimeTicket 方法）、typescript/api.ts、新 RealtimeTicket.java /
   RealtimeTicketCreateRequest.java record。ErrorCode.java 不变（复用 NOT_FOUND_OR_FORBIDDEN/INVALID_REQUEST）。
3. **`RealtimeTicketController.java`（新，`runtime/realtime/web`）**：单端点 `createTicket`；owner 从 principal；
   transport 常量 FETCH_SSE；parseId(generationId/streamEpoch)、parseNonNegative(afterSeq)；调 ticketRepository.issue；
   catch 顺序 BadSqlGrammarException 上抛 → DataAccessException 转 ResourceNotFoundException("generation")。
4. **`AuthDataSourceConfig.java`（修改）**：+ 3 个 @Bean（realtimeTicketRepository / realtimeResumeService /
   realtimeEventRepository，均 `new X(authJdbcTemplate)`）。
5. **`RealtimeTicketControllerTest.java`（新，runtime/realtime/web）**：9 场景（happy/404/503 上抛/非法 id/
   零 streamEpoch/负 afterSeq/缺 sessionId/缺 origin/afterSeq=0 合法）。
6. 终态治理闭环：run-rls 69/69（regression）+ runtime 320/0/0 + openapi diff PASS + git diff --check + 结构化
   review-r1 + Evidence/Handoff + 单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **realtime SSE resume 端点（SseEmitter + V8 resume_stream + 契约补 resume endpoint path）** → TASK-0183
  （需改 `specs/contracts/realtime-contract.yaml` → C3 contract-change skill + independentReview）。
- **consume 端点 / ticket 消费的 HTTP 层**（consume_realtime_ticket 由 SSE resume controller 调用，本卡只 issue）。
- **catalog/contract 改动**（`specs/contracts/**`、`specs/catalog/**`、`specs/generated/**` 保护路径均不碰；
  OpenAPI 源非保护路径，本卡改它同步契约已定义的 ticket path）。
- **新 DB migration、modelruntime/safety/adapters 源码改动、auth/conversation/generation/worker/relationship/web/
  message/cancel/memory/loopback 包改动**（保护路径）。
- **doctor/precheck/完整 unittest/根级 mvn verify**（Owner 2026-08-12 static-gates-only 策略 deferred）。

## 输入和前置条件

- Base `241b8d6d92c5a539a1523545c113a8f0e0c8791d` = TASK-0181 ACCEPTED terminal（已 push、HEAD==origin/main、
  0/0、clean；nextAction 三处 sha256 `6f9c37a4...` 一致）。
- DRAFT 前已复核：OpenAPI 端点现状（realtime/tickets 缺失、snapshot 已定义）；realtime-contract.yaml ticket
  契约；V8 issue_realtime_ticket 签名与 ensure_realtime_stream raise 语义；RealtimeTicketRepository.issue 签名；
  AuthExceptionHandler DataAccessException→401 误映射（须 controller 翻译）；MemoryController/GenerationController
  模板；openapi_tool.py generate/diff；runtime 无 SSE 先例。
- context lock 输入钉在 Base（148 inputs = 147 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `b717b548...` 由复刻
  verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0181 `4661a263...` 通过，再生 0182）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack。

## API / 事件 / 数据契约

- 单端点严格对齐 realtime-contract.yaml ticket 段：`POST /api/v1/realtime/tickets`、boundTo 七元组、TTL 45s、
  single-use、serverStoresHashOnly。DTO id/counter 用 string（OpenAPI 惯例，hashid deferred），controller parseLong。
- transport 固定 `FETCH_SSE`（契约 alpha 唯一值，服务端硬编码，不接受 body 传入——避免 WEBSOCKET 等禁止值）。
- ownerUserId 取自 principal（server-trusted，不在 body）；owner GUC 由 OwnerInjectionFilter 绑定，issue 调用
  运行在 server-trusted owner 上下文（V8 set_config + FORCE RLS owner_isolation）。
- 数据契约：复用 V8 issue_realtime_ticket SD 函数，不新增表/列/约束/角色/授权。secret 一次性明文返回，
  仅 sha256 持久化（realtime_ticket 表 ticket_hash 列）。
- NOT_FOUND_OR_FORBIDDEN：foreign/absent generation（ensure_realtime_stream raise）→ 404，不泄露存在性。
- 400 INVALID_REQUEST：非数字/非正 generationId/streamEpoch、负 afterSeq、缺 body 字段（@Valid @NotBlank）。

## 权限、RLS 和数据处理要求

- issue_realtime_ticket 复用既有 vc_api EXECUTE 授权（V8 已 GRANT）；无新增授权、无 REVOKE、无新角色。
- SD 调用运行在 server-trusted owner 上下文（owner-injection filter SET vc.owner_user_id；V8 内部再次
  set_config + ensure_realtime_stream 用 owner 谓词）。INV-TENANT-001（vc_api NO BYPASSRLS + FORCE RLS
  owner_isolation）不变。
- secret 是短期（45s）一次性凭据，不在 URL/query/log 持久化（realtime-contract h5Security）；响应体返回一次。
- 日志不含敏感数据（只记 ownerId/generationId；不记 secret/sessionId 内容）。

## 状态机和失败行为

- createTicket：解析 body → parseId/parseNonNegative（非法→400）→ ticketRepository.issue（owner/generation/
  session/origin/FETCH_SSE/streamEpoch/afterSeq）→ 成功返回 ticketId/secret。
- generation foreign/absent：ensure_realtime_stream raise → DataAccessException → ResourceNotFoundException → 404。
- schema 不可用：BadSqlGrammarException → 上抛 → 全局 AuthExceptionHandler → 503 SCHEMA_UNAVAILABLE。
- 非法输入：IAE（parseId/parseNonNegative）或 @Valid 校验失败 → RuntimeApiExceptionHandler → 400。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆（ticket 是 resume 凭据申请，非模型调用）。安全边界：owner 经 principal 可信来源
（INV-TENANT-001）；transport 服务端固定避免禁止值；generation 存在性不披露（404）；secret 短期一次性
（45s TTL + sha256-only）；无外发、无真实数据、无凭据持久化。

## 验收标准

1. OpenAPI 源新增 `POST /api/v1/realtime/tickets`（operationId createRealtimeTicket）+ RealtimeTicketCreateRequest
   + RealtimeTicket schema；dist 生成物经 generate 重建；`openapi_tool.py diff` PASS（源与 dist 一致）。
2. `RealtimeTicketController`：owner 取自 principal、transport 固定 FETCH_SSE、issue 调用参数精确透传、
   DataAccessException→404 不披露、BadSqlGrammarException 上抛保 503（单测）。
3. `RealtimeTicketControllerTest` 9 场景全 PASS：happy（200 + ticketId/secret + verify 参数）、generation
   foreign→404、BadSqlGrammar 上抛、非法 generationId/streamEpoch/负 afterSeq→400、缺 sessionId/origin→400。
4. `AuthDataSourceConfig` 装配 3 个 realtime bean（model-providers/auth 条件不变；resume/event 为 SSE 卡铺路）。
5. runtime 模块测试 BUILD SUCCESS（320 tests，0 failure，0 skip）；persistence 102/0/0 不变。
6. run-rls-tests.sh 69/69 PASS（regression；V8 未改）。
7. `git diff --check` exit 0。
8. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
   SSE resume 端点 deferred TASK-0183。
9. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次；runtime 模块定向测试一次；openapi_tool.py
diff 一次；同一无参 `git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py --task
TASK-0182`）与完整 Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 回滚或前向修复

- 若 runtime 单测暴露 controller 问题：最多 1 fix batch 修 writeAllowlist 内代码。
- 若 openapi_tool.py generate/diff 暴露源问题：修 OpenAPI 源（yaml 语法/端点定义）+ 重新 generate。
- 若 Modulith 结构测试失败：调整 realtime/web 包依赖（不碰其他包、不改 RuntimeModuleStructureTest）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 `specs/contracts/` 或 migration 或 modelruntime：立即停止申请范围升级（触发 C3/C4，需新卡）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（0170-0181 产物、specs/contracts/catalog/generated、
  migration、tests、modelruntime、safety、adapters、auth/worker/web/conversation/generation/relationship/message/
  cancel/memory/loopback 包、frontend、harness、scripts 等）。
- run-rls-tests.sh / runtime 定向测试 / openapi diff / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0182/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0182.json`。
