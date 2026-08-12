# TASK-0180：memory HTTP 端点（8 端点；复用 V11/V12/V13 SD，OpenAPI 已定义）

```yaml
taskId: TASK-0180
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
baseCommit: 456e6d7e4802dcdaf198abff01e773649b9f4c7f
authorizationCommit: "plan-approved-2026-08-12-memory-http-api"
contextFingerprint: 70d6933e630cd062dd7dbaa777863bb2e11600e523e993ebcd273de851fae450
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0180.context-lock.yaml
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
  surfaceId: TASK_0180_MEMORY_HTTP_API
  policySurfaces: [BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 12
  estimatedWallMinutes: 40
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - bash infra/db/run-rls-tests.sh
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
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
  - docs/evidence/TASK-0179/evidence-pack.json
  - docs/evidence/TASK-0179/review-r1.md
  - docs/handoffs/TASK-0179.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0179-list-messages-cancel-generation-http-api.md
  - docs/tasks/context/TASK-0179.context-lock.yaml
  - docs/tasks/task-card-template.md
  - infra/db/run-rls-tests.sh
  - infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql
  - infra/db/tests/66_generation_zero_llm_completed_chain.sql
  - pom.xml
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
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
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
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
  - specs/openapi/virtual-companion.yaml
  - docs/tasks/TASK-0028-memory-candidate-management-api.md
  - frontend/src/api/memory.ts
  - frontend/src/stores/memory.ts
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipService.java
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/memory-scopes.yaml
writeAllowlist:
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MemoryRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MemoryEvidenceRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MemoryService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/memory/web/MemoryController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/MemoryServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/memory/web/MemoryControllerTest.java
  - docs/tasks/TASK-0180-memory-http-api.md
  - docs/tasks/context/TASK-0180.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0180/**
  - docs/handoffs/TASK-0180.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
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
  - .github/workflows/**
  - specs/**
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
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotProvider.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipRecord.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationCancelServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationReceiveServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStoreTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/MessageHistoryServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeResumeServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepositoryTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RelationshipServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V2[0-9]__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/generation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/relationship/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/message/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/cancel/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-5][0-9]_*.sql
  - infra/db/tests/6[0-7]_*.sql
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
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0179.json
requiredInvariants:
  - INV-TENANT-001
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-TX-001
  - INV-WORKER-001
  - INV-AUTH-001
  - INV-MEM-001
  - INV-MEM-002
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
    sourceThreadId: 3b7e9c2d-6f4a-4b8e-9d2c-1a5e8f0b3c6d
    evidence: >-
      Owner 2026-08-12 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT 治理例外）。
      TASK-0179 闭环后 nextAction 指向本卡：实现 OpenAPI 已定义但 Java HTTP 层缺失的 8 个 memory
      端点——POST /api/v1/relationships/{relationshipId}/memories/candidates（createMemoryCandidate，
      OpenAPI L315-353）、GET /api/v1/relationships/{relationshipId}/memories（listMemories，L354-386，
      无 404）、GET /api/v1/memories/{memoryId}（getMemory，L387-415）、PATCH /api/v1/memories/{memoryId}
      （updateMemory，L416-452，死端状态→404）、DELETE /api/v1/memories/{memoryId}（deleteMemory，L453-481）、
      POST /api/v1/memories/{memoryId}/confirm（confirmMemoryCandidate，L482-512，非 pending→404）、
      POST /api/v1/memories/{memoryId}/reject（rejectMemoryCandidate，L513-542，非 pending→404）、
      GET /api/v1/memories/{memoryId}/evidence（listMemoryEvidence，L543-569，无 404）；复用 V11/V12/V13
      SD 函数（均已 GRANT vc_api）；纯 runtime + persistence 层，不新增 migration、不改
      modelruntime/safety/adapters/specs。Owner 2026-08-12 计划审批拍板：DELETE 对已软删记忆（owned 但
      deleted_at 非空，SD 幂等 TRUE）返回 404 NOT_FOUND_OR_FORBIDDEN——与其他 memory 端点一致视为 absent，
      SD 层幂等由 DB test 36 承载；OpenAPI prose「duplicate delete 返回 success」分歧记 knownRisk。
      memory 端点非 200 语义逐端点核对：update/confirm/reject 的状态冲突按 OpenAPI 明确映射
      NOT_FOUND_OR_FORBIDDEN（与 cancel 的 400 不同）。
independentReview: not-required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion 纵切的
> Memory 管理 API 卡（TASK-0028 契约纵切），承接 TASK-0179（listMessages + cancelGeneration HTTP 端点），沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0179
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何保护路径**：`service/modules/**`(C3)、
> `service/modules/safety/**`(C4)、`service/adapters/**`(C3)、`**/db/migration/**`(C4)、`specs/**`、
> `auth/**`、`runtime/conversation/**`、`runtime/generation/**`、`runtime/worker/**`、
> `runtime/relationship/**`、`runtime/web/**`、`runtime/message/**`、`runtime/cancel/**` 等均不改——
> 只消费 V11/V12/V13 SD 公共函数 + 新建 runtime/persistence 非保护文件。
> 故 riskClass=C2，independentReview=not-required（仍按长线惯例产出 review-r1）。

## 背景与用户可观察目标

OpenAPI（specs/openapi/virtual-companion.yaml L315-570）已定义 8 个 memory 端点，V11/V12/V13 SD 函数已就绪
（create_memory_candidate / list_memory / get_memory / update_memory / delete_memory / confirm_memory_candidate /
reject_memory_candidate / list_memory_evidence，均已 GRANT vc_api），但 Java HTTP 层缺失——客户端无法
创建/管理记忆候选、确认/拒绝候选、编辑/软删记忆、读取来源 Evidence。本卡补齐该层。

当前 HEAD（456e6d7e）事实（代码核实）：

1. **OpenAPI 端点与响应码（逐端点核对，0179 教训）**：
   - `POST /api/v1/relationships/{relationshipId}/memories/candidates`（createMemoryCandidate）：body
     MemoryCandidateCreateRequest（scope/summary 必填，conversationId/evidence 可选）；200 Memory；401；**404**
     （foreign relationship → NOT_FOUND_OR_FORBIDDEN）。
   - `GET /api/v1/relationships/{relationshipId}/memories?includeDeleted=`（listMemories）：query 参数
     includeDeleted（boolean，可选）；200 Memory[]；401。**无 404**——foreign relationship → 空数组
     （list_memory 不 RAISE、关系谓词 + FORCE RLS，存在性不泄露）。
   - `GET /api/v1/memories/{memoryId}`（getMemory）：200 Memory；401；**404**（foreign/absent/deleted，
     get_memory 只返回非软删行）。
   - `PATCH /api/v1/memories/{memoryId}`（updateMemory）：body MemoryUpdateRequest（summary 必填）；200 Memory
     （status 不变）；401；**404**——OpenAPI 描述明确「A foreign, absent, deleted **or dead-end id** maps to
     NOT_FOUND_OR_FORBIDDEN」（可编辑状态仅 PENDING_CONFIRMATION/ACCEPTED，V12 update_memory RAISE）。
   - `DELETE /api/v1/memories/{memoryId}`（deleteMemory）：200 Memory（已软删或本就已删）；401；**404**
     （foreign/absent）。Owner 2026-08-12 拍板：**HTTP 层对已软删记忆同样返回 404**（所有 SD 读取排除软删行，
     无法构造必填字段响应体；SD 层幂等 TRUE 由 DB test 36 承载；与其他端点一致视为 absent）。
   - `POST /api/v1/memories/{memoryId}/confirm`（confirmMemoryCandidate）：200 Memory（ACCEPTED）；401；**404**——
     OpenAPI 描述明确「confirming an already-confirmed or otherwise transitioned memory ... maps to
     NOT_FOUND_OR_FORBIDDEN」（confirm 故意对 canonical 不幂等）。
   - `POST /api/v1/memories/{memoryId}/reject`（rejectMemoryCandidate）：200 Memory（REJECTED）；401；**404**
     （非 pending 同样映射 NOT_FOUND_OR_FORBIDDEN）。
   - `GET /api/v1/memories/{memoryId}/evidence`（listMemoryEvidence）：200 MemoryEvidence[]；401。**无 404**——
     foreign/absent/deleted → 空数组（与无证据不可区分，list_memory_evidence 不 RAISE）。
   - Memory schema 必填：memoryId/scope/summary/status（conversationId/createdAt 可选；**无 deletedAt 字段**，
     includeDeleted=true 返回的软删行以原 status 呈现）。
2. **V11/V12/V13 SD 语义**：所有 SD 均 SECURITY DEFINER、SET search_path=vc,public、V17 断言
   p_owner==current_owner_id、REVOKE PUBLIC + GRANT vc_api；V11 起 vc_api 对 memory_item/memory_evidence
   无直接 DML（含 SELECT），全部访问走 SD。RAISE 语义：
   - `create_memory_candidate(owner, rel, scope, summary, conv DEFAULT NULL, evidence text[] DEFAULT ARRAY[]::text[])`
     → bigint id；RAISE：缺参/空 summary/scope 非 Alpha（SESSION/RELATIONSHIP）/SESSION 缺 conv/relationship
     或 conversation foreign（不披露存在性）。
   - `list_memory(owner, rel, include_deleted DEFAULT false)` → 行集（out_id/out_scope/out_summary/out_status/
     out_conversation_id/out_deleted_at/out_created_at）；不 RAISE；relationship 谓词 + FORCE RLS。
   - `get_memory(owner, id)` → 单行集（out_id/out_relationship_id/out_scope/out_summary/out_status/
     out_conversation_id/out_created_at，**无 out_deleted_at**）；仅非软删行；不 RAISE。
   - `update_memory(owner, id, summary)` → boolean；RAISE：缺参/空 summary/foreign/absent/deleted/
     非可编辑状态（REJECTED/EXPIRED）。
   - `delete_memory(owner, id)` → boolean；RAISE：缺参/foreign/absent；owned 已软删幂等 TRUE（V12 修正，
     FOR UPDATE 存在性检查）。
   - `confirm_memory_candidate(owner, id)` / `reject_memory_candidate(owner, id)` → boolean；RAISE：缺参/
     foreign/absent/deleted/非 PENDING_CONFIRMATION。
   - `list_memory_evidence(owner, id)` → 行集（out_id/out_source_ref/out_created_at）；不 RAISE；join
     memory_item 的 deleted_at IS NULL（软删记忆的 evidence 不可见）。
3. Controller 注册：`@SpringBootApplication` 组件扫描 `com.virtualcompanion.runtime`，非 @Bean；
   `@ConditionalOnProperty(auth.datasource-enabled=true)`；`@AuthenticationPrincipal(expression="accountId")`
   long ownerUserId；路径 id 经 parseId（Long.parseLong 正数校验，hashid deferred）。
4. 错误处理：`AuthExceptionHandler` 全局 `@RestControllerAdvice`——DataAccessException→401
   AUTHENTICATION_REQUIRED（schema 缺失 SQLSTATE 42883/42P01/42703/3F000→503 SCHEMA_UNAVAILABLE）。
   V11/V12/V13 RAISE 若逃逸会被误映射 401 → **service 层必须翻译**（0179 教训 16/31）：
   BadSqlGrammarException 上抛（保 503）；其余 DataAccessException（业务 RAISE）→ Optional.empty() → 404
   **（memory 端点与 cancel 的关键差异：OpenAPI 明确把状态冲突映射 NOT_FOUND_OR_FORBIDDEN，故翻译为 404
   而非 400）**。`runtime.web` 的 RuntimeApiExceptionHandler 处理 ResourceNotFoundException→404
   NOT_FOUND_OR_FORBIDDEN、IllegalArgumentException/校验异常→400 INVALID_REQUEST（直接复用）。
5. Spring Modulith（RuntimeModuleStructureTest）禁止跨模块依赖 web 子包类型：`runtime/memory/web` 只依赖
   platform.persistence 与 runtime.web（同 message/cancel/relationship 模式，Modulith 结构 PASS 可预期）。
6. 写路径约束：`runtime/message/**`、`runtime/cancel/**`、`runtime/relationship/**`、`runtime/web/**` 是
   保护路径（不可改 0179 产物）；`RelationshipService` 在同包可注入（MemoryService.create 预检 relationship
   存在性，照 GenerationCancelService 依赖 GenerationRepository 模式）→ 新建独立 service 包 V11/V12/V13。

用户可观察结果（本卡完成后）：

- **POST /api/v1/relationships/{relationshipId}/memories/candidates**：body（scope/summary 必填）→ 200 返回
  PENDING_CONFIRMATION 候选 Memory；foreign relationship → 404 NOT_FOUND_OR_FORBIDDEN；非法 scope/
  SESSION 缺 conversationId/空 summary → 400 INVALID_REQUEST。
- **GET /api/v1/relationships/{relationshipId}/memories?includeDeleted=**：该 relationship 的候选与 canonical
  记忆（默认排除软删）；foreign relationship → 200 空数组。
- **GET /api/v1/memories/{memoryId}**：单个非软删记忆；foreign/absent/deleted → 404。
- **PATCH /api/v1/memories/{memoryId}**：编辑 summary（status 不变、幂等）；foreign/absent/deleted/
  死端状态 → 404；空 summary → 400。
- **DELETE /api/v1/memories/{memoryId}**：软删（幂等）；alive → 200 删除前快照；foreign/absent/
  **已软删** → 404（Owner 拍板）。
- **POST /api/v1/memories/{memoryId}/confirm**：PENDING_CONFIRMATION → ACCEPTED（canonical 唯一入口，
  INV-MEM-002）；非 pending/foreign/absent → 404。
- **POST /api/v1/memories/{memoryId}/reject**：PENDING_CONFIRMATION → REJECTED；非 pending/foreign/absent → 404。
- **GET /api/v1/memories/{memoryId}/evidence**：来源 Evidence 链（有序）；foreign/absent/deleted → 200 空数组。
- 统一错误：404 `NOT_FOUND_OR_FORBIDDEN`（不泄露存在性）、400 `INVALID_REQUEST`（非法 id/body/query）、
  401/503 由既有 auth advice 保持。

## 范围内

1. **`MemoryRecord.java`（新，`platform.persistence`）**：`record(long id, Long relationshipId, String scope,
   String summary, String status, Long conversationId, Instant deletedAt, Instant createdAt)`——get_memory 与
   list_memory 两个 out 列集并集（relationshipId/deletedAt 可空；id/scope/summary/status/createdAt 非空校验；
   createdAt null→Instant.EPOCH fallback，照 MessageHistoryRecord/RelationshipRecord）。
2. **`MemoryEvidenceRecord.java`（新，`platform.persistence`）**：`record(long id, String sourceRef,
   Instant createdAt)`（sourceRef 非空校验；createdAt EPOCH fallback）。
3. **`MemoryService.java`（新，`platform.persistence`）**：8 个方法，统一翻译模式：
   - `Optional<MemoryRecord> create(owner, relationshipId, scope, summary, Long conversationId,
     List<String> evidence)`：参数校验（正数 id；scope ∈ {SESSION, RELATIONSHIP} 镜像 memory-scopes catalog；
     summary 非空；SESSION 必带 conversationId 且正数）→ IllegalArgument→400；`RelationshipService.get`
     预检 relationship（empty→Optional.empty→404，不依赖 RAISE）；`SELECT vc.create_memory_candidate(?,?,?,?,?,?)`
     （evidence 经 `ps.getConnection().createArrayOf("text", ...)` + PreparedStatementSetter，照
     JdbcProviderDeploymentRepository:51；null/空 evidence 透传 null）；RAISE→Optional.empty→404；
     BadSqlGrammar 上抛；创建后 `getMemory` 回读（empty→IllegalStateException 防御）。
   - `List<MemoryRecord> list(owner, relationshipId, Boolean includeDeleted)`：`SELECT out_* FROM
     vc.list_memory(?, ?, ?)` 3 参透传；不预检（foreign→空数组，OpenAPI 无 404）；includeDeleted null→SD 默认
     false。
   - `Optional<MemoryRecord> get(owner, memoryId)`：`SELECT out_* FROM vc.get_memory(?, ?)`。
   - `Optional<MemoryRecord> update(owner, memoryId, summary)`：参数校验（正数 id、summary 非空）→400；
     `get` 预检（empty→Optional.empty→404）；可编辑状态集合 {PENDING_CONFIRMATION, ACCEPTED} 预检
     （死端→Optional.empty→404，OpenAPI 明确）；`SELECT vc.update_memory(?, ?, ?)`；RAISE→empty→404；
     回读。
   - `Optional<MemoryRecord> delete(owner, memoryId)`：参数校验；`get` 预读（alive 快照；empty→
     Optional.empty→404——**已软删与 foreign/absent 一致视为 absent，Owner 拍板**，不调 SD）；`SELECT
     vc.delete_memory(?, ?)`（TRUE 断言，非 TRUE→IllegalStateException 防御）；RAISE→empty→404；返回删除前
     快照。
   - `Optional<MemoryRecord> confirm(owner, memoryId)`：`get` 预检 + status==PENDING_CONFIRMATION 预检
     （非 pending→empty→404）；`SELECT vc.confirm_memory_candidate(?, ?)`；RAISE→empty→404；回读
     （ACCEPTED）。
   - `Optional<MemoryRecord> reject(owner, memoryId)`：同上 → REJECTED。
   - `List<MemoryEvidenceRecord> listEvidence(owner, memoryId)`：`SELECT out_id, out_source_ref,
     out_created_at FROM vc.list_memory_evidence(?, ?)`；不预检（foreign/absent/deleted→空数组）。
   - 两个静态 RowMapper（getMapper 带 relationshipId、listMapper 带 deletedAt）。
4. **`MemoryController.java`（新，`runtime.memory.web`）**：`@RestController @RequestMapping("/api/v1")
   @ConditionalOnProperty(auth.datasource-enabled=true)`；8 端点（路径/方法严格对齐 OpenAPI）；
   `@AuthenticationPrincipal(expression="accountId") long ownerUserId`；`parseId`（Long.parseLong 正数，
   非数字/非正→400）；`includeDeleted` String 手解（仅 "true"/"false" 忽略大小写，其余→400，避免
   MethodArgumentTypeMismatchException 无处理→500，照 0179 query 参数教训）；DTO：
   `MemoryResponse(memoryId, scope, summary, status, conversationId, createdAt)`、
   `MemoryEvidenceResponse(evidenceId, sourceRef, createdAt)`、
   `MemoryCandidateCreateRequest(@NotBlank scope, @NotBlank summary, String conversationId, List<String>
   evidence)`、`MemoryUpdateRequest(@NotBlank summary)`（@Valid 触发 MethodArgumentNotValidException→400）；
   create 的 foreign relationship→`ResourceNotFoundException("relationship")`→404；get/update/delete/confirm/
   reject 的 empty→`ResourceNotFoundException("memory")`→404；list/evidence 无 404 分支。
5. **`AuthDataSourceConfig.java`（修改）**：+ `MemoryService` bean（注入 authJdbcTemplate + relationshipService）。
   Controller 组件扫描，不需 @Bean。
6. **测试**（2 类）：
   - `MemoryServiceTest`（新，platform.persistence）：mock JdbcTemplate + RelationshipService；create happy
     （relationship 预检→SD→回读）/foreign relationship→empty 且不调 SD/非法 scope/SESSION 缺 conv/空
     summary→IAE/RAISE→empty/BadSqlGrammar 上抛；list happy（含 deletedAt 映射）/空/includeDeleted 透传
     verify/参数校验；get happy/empty；update happy/absent→empty 不调 SD/死端状态→empty/RAISE→empty/
     空 summary→IAE；delete happy→删除前快照/absent→empty 不调 SD/RAISE→empty/非 TRUE→ISE；confirm+reject
     happy（预检→SD→回读）/非 pending→empty/RAISE→empty；evidence happy/空/参数校验。
   - `MemoryControllerTest`（新，runtime.memory.web）：standalone MockMvc + Principal resolver +
     RuntimeApiExceptionHandler；8 端点 happy 200（字段/状态回读 verify）；get/update/delete/confirm/reject
     foreign→404；create foreign relationship→404、非法 scope→400、缺 summary body→400；非法
     memoryId/relationshipId→400；includeDeleted=true 透传 verify、非法值→400；list/evidence foreign→200
     空数组（无 404）。
7. 终态治理闭环：run-rls-tests.sh 67/67（regression；V11-V13 未改，既有 test 32/33/34/35/36 覆盖 memory
   SD 语义）+ runtime 定向测试 + git diff --check + 结构化 review-r1 + Evidence/Handoff + 单父
   [skip ci]/push/远端 0/0。

## 明确范围外

- **C4 snapshot SD 函数 V26 create_authorization_snapshots + AuthorizationSnapshotProvider JDBC 实现 +
  loopback adapter e2e**（激活 external 运行期路径）→ 下一张卡。
- **realtime SSE 推送（SseEmitter + V8 resume_stream）、ID hashid 编码** → 后续卡。
- **新 DB migration、modelruntime/safety/adapters 源码改动、catalog/contract/OpenAPI 改动**（OpenAPI 端点已
  定义，本卡只补 Java 实现，不改 spec）、**auth/conversation/generation/worker/relationship/web/message/cancel
  包源码改动**（保护路径）、**RelationshipService/RelationshipRecord 修改**（保护路径，本卡仅注入消费）、
  **memory SD 的 RECALL 路径（recall_memory）**（V13 面向 ContextPlan 注入，运行期消费不在本卡）。
- **doctor/precheck/完整 unittest/根级 mvn verify**（Owner 2026-08-12 static-gates-only 策略 deferred）。

## 输入和前置条件

- Base `456e6d7e4802dcdaf198abff01e773649b9f4c7f` = TASK-0179 ACCEPTED terminal（已 push、HEAD==origin/main、
  0/0、clean；nextAction 三处 sha256 `03f01b92...` 一致）。
- DRAFT 前已复核：OpenAPI 8 端点与 schema（含各端点 404 有无的差异：list/evidence 无 404，update/confirm/
  reject 的状态冲突→404）；V11/V12/V13 SD 签名与 RAISE 语义（create/update/delete/confirm/reject RAISE，
  list/get/evidence 不 RAISE）；AuthExceptionHandler DataAccessException→401/503 全局映射（SD RAISE 必须
  翻译）；Controller 组件扫描 + @ConditionalOnProperty 模式；@AuthenticationPrincipal(expression="accountId")
  模式；Modulith 跨模块 web 依赖禁令（memory.web 只依赖 platform.persistence + runtime.web）；保护路径
  （message/cancel/relationship/web/migration 禁改）。
- context lock 输入钉在 Base（142 inputs = 141 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `70d6933e...` 由复刻
  verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0179 `751b2354...` 通过，再生 0180）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack。

## API / 事件 / 数据契约

- 8 端点严格对齐 OpenAPI：路径、方法、请求/响应 schema 与错误码（200/400/401/404）不变。DTO id 用
  long（OpenAPI id 是 string——long 序列化为数字字符串，与 TASK-0174/0178/0179 一致；hashid deferred）。
  createdAt 用 Instant.toString()（RFC 3339；null→null）；conversationId null→null。
- 数据契约：复用 V11/V12/V13 SD 函数，不新增表/列/约束/角色/状态/事件。候选初始状态
  PENDING_CONFIRMATION（catalog alphaModelCandidateInitialStatus）；canonical（ACCEPTED）仅确认路径
  （INV-MEM-001/002）。
- NOT_FOUND_OR_FORBIDDEN：create 的 foreign relationship、get/update/delete/confirm/reject 的
  foreign/absent/deleted（含 update 死端状态、confirm/reject 非 pending、delete 已软删）→ 404，不泄露
  存在性；list/evidence 的 foreign → 200 空数组（OpenAPI 契约，无 404）。
- 400 INVALID_REQUEST：非法 id、非法 scope（非 SESSION/RELATIONSHIP）、SESSION 缺 conversationId、
  空/缺 summary（@Valid + service 双重）、非法 includeDeleted 值。
- Memory 响应不含 deletedAt（OpenAPI Memory schema 无该字段）；includeDeleted=true 返回的软删行以原
  status 呈现（前端不展示软删行时靠 includeDeleted=false 默认值）。

## 权限、RLS 和数据处理要求

- 全部 SD 函数调用复用既有 vc_api EXECUTE 授权（V11/V12/V13 已 GRANT）；无新增授权、无 REVOKE、无新角色。
- 每个 SD 调用运行在 server-trusted owner 上下文（owner-injection filter 已 SET vc.owner_user_id；V17 断言
  p_owner==current_owner_id 重新校验）。INV-TENANT-001（vc_api NO BYPASSRLS + FORCE RLS owner_isolation）不变。
- 日志不含敏感数据（只记 ownerId/relationshipId/memoryId/操作；不记 summary 内容）。

## 状态机和失败行为

- create：PENDING_CONFIRMATION 候选（模型提取唯一入口）；foreign relationship→404；非法输入→400。
- get/list/evidence：无状态变更；foreign→404 或 200 空数组（按端点契约）。
- update：summary-only、status 不变（不可 promote/复活）；foreign/absent/deleted/死端→404；空 summary→400。
- delete：软删（deleted_at=now()）；alive→200 删除前快照；foreign/absent/已软删→404（Owner 拍板）。
- confirm：PENDING_CONFIRMATION→ACCEPTED（canonical 唯一入口，非幂等）；其余→404。
- reject：PENDING_CONFIRMATION→REJECTED；其余→404。
- SD RAISE 逃逸（非预期）→ BadSqlGrammarException 保持上抛（既有 503 SCHEMA_UNAVAILABLE）；其余
  DataAccessException → 翻译 Optional.empty→404（预检通过后的并发竞态，OpenAPI 明确状态冲突→404）。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt（recall_memory 的 ContextPlan 注入是运行期消费，不在本卡）。本卡是记忆候选/规范的
HTTP 管理面：所有写入经用户确认路径（INV-MEM-002），软删是墓碑（INV-MEM-001 删除后不可召回），
无外发、无凭据、无真实数据。

## 验收标准

1. 8 端点行为与 OpenAPI 一致：create 200 PENDING_CONFIRMATION/foreign relationship→404；list 200 数组/
   foreign→200 空数组；get 200/foreign→404；update 200 status 不变/死端→404；delete 200 删除前快照/
   已软删→404；confirm 200 ACCEPTED/非 pending→404；reject 200 REJECTED/非 pending→404；evidence 200 数组/
   foreign→200 空数组。
2. `MemoryService` 正确调用 V11/V12/V13 SD（SQL 精确、evidence text[] 经 createArrayOf）；统一翻译
   （BadSqlGrammarException 上抛保 503、业务 RAISE→404、非法输入→400）；create 经 RelationshipService.get
   预检（单测）。
3. update/confirm/reject 的预检（可编辑状态/pending 状态）与 delete 的预读快照逻辑正确（单测）。
4. Modulith 结构测试（RuntimeModuleStructureTest）PASS：新 memory.web 包不依赖 auth/generation/conversation
   模块类型。
5. `MemoryServiceTest` + `MemoryControllerTest` 全 PASS；runtime 模块测试 BUILD SUCCESS（0 failure，
   0 skip）。
6. run-rls-tests.sh 67/67 PASS（regression）。
7. `git diff --check` exit 0。
8. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
   C4 snapshot SD 函数 deferred 下一张卡。
9. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次；runtime 模块定向测试一次；同一无参
`git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py --task TASK-0180`）与完整
Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 回滚或前向修复

- 若 runtime 单测暴露 controller/service 问题：最多 1 fix batch 修 runtime/persistence 代码。
- 若 Modulith 结构测试失败：调整新建类的包归属/依赖（不触碰 auth/generation/conversation 包、不改
  RuntimeModuleStructureTest）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 OpenAPI spec 或 migration 或 modelruntime 或 auth 包：立即停止申请范围升级。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（auth/conversation/generation/worker/relationship/web/
  message/cancel、modelruntime、safety、adapters、migration、specs、harness、frontend 等）。
- run-rls-tests.sh / runtime 定向测试 / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0180/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0180.json`。
