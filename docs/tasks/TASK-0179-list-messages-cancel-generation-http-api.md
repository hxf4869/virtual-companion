# TASK-0179：listMessages + cancelGeneration HTTP 端点（2 端点；复用 V10 SD，OpenAPI 已定义）

```yaml
taskId: TASK-0179
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
baseCommit: ce12b488a34bf8064d68579a1549e474a9355cb0
authorizationCommit: "plan-approved-2026-08-12-list-messages-cancel-generation"
contextFingerprint: 751b235407e7861e2cfa0fe7ce8654e4018e0c9b986f7a6eb1b1a550d083097c
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0179.context-lock.yaml
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
  surfaceId: TASK_0179_LIST_MESSAGES_CANCEL_GENERATION_HTTP_API
  policySurfaces: [BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 12
  estimatedWallMinutes: 35
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
  - docs/evidence/TASK-0178/evidence-pack.json
  - docs/evidence/TASK-0178/review-r1.md
  - docs/handoffs/TASK-0178.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0178-relationship-http-api.md
  - docs/tasks/context/TASK-0178.context-lock.yaml
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
writeAllowlist:
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageHistoryRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageHistoryService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationCancelService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/message/web/MessageHistoryController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/cancel/web/GenerationCancelController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/MessageHistoryServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationCancelServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/message/web/MessageHistoryControllerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/cancel/web/GenerationCancelControllerTest.java
  - docs/tasks/TASK-0179-list-messages-cancel-generation-http-api.md
  - docs/tasks/context/TASK-0179.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0179/**
  - docs/handoffs/TASK-0179.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-8]-*
  - docs/tasks/context/TASK-017[0-8].context-lock.yaml
  - docs/evidence/TASK-017[0-8]/**
  - docs/handoffs/TASK-017[0-8].json
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
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationReceiveServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStoreTest.java
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/generation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/relationship/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/web/**
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
  - docs/handoffs/TASK-0178.json
requiredInvariants:
  - INV-TENANT-001
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-TX-001
  - INV-WORKER-001
  - INV-AUTH-001
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
      TASK-0178 闭环后 nextAction 指向本卡：实现 OpenAPI 已定义但 Java HTTP 层缺失的 listMessages
      （GET /api/v1/conversations/{conversationId}/messages，OpenAPI L217-254，分页 afterId/limit）+
      cancelGeneration（POST /api/v1/generations/{generationId}/cancel，OpenAPI L255-284）端点，复用
      V10 SD 函数（vc.list_messages / vc.cancel_generation，均已 GRANT vc_api），纯 runtime +
      persistence 层，不新增 migration、不改 modelruntime/safety/adapters/specs。cancel 不可取消态
      → 400 INVALID_REQUEST（OpenAPI 仅定义 200/401/404 无 409 先例；ErrorCode catalog 有
      INVALID_REQUEST 无专门码；沿用 TASK-0178 runtime.web 错误层既有形状）。
independentReview: not-required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion 纵切的
> Chat/Generation/History API 卡（TASK-0025 契约纵切），承接 TASK-0178（Relationship HTTP API），沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0178
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何保护路径**：`service/modules/**`(C3)、
> `service/modules/safety/**`(C4)、`service/adapters/**`(C3)、`**/db/migration/**`(C4)、`specs/**`、
> `auth/web/**`、`runtime/conversation/**`、`runtime/generation/**`、`runtime/web/**`、
> `runtime/relationship/**` 等均不改——只消费 V10 SD 公共函数 + 新建 runtime/persistence 非保护文件。
> 故 riskClass=C2，independentReview=not-required（仍按长线惯例产出 review-r1）。

## 背景与用户可观察目标

OpenAPI（specs/openapi/virtual-companion.yaml L217-284）已定义 2 个端点，V10 SD 函数已就绪
（`vc.list_messages(owner, conv, after_id DEFAULT 0, limit DEFAULT 50)` +
`vc.cancel_generation(owner, gen)→'CANCELLED'`，均已 GRANT vc_api），但 Java HTTP 层缺失——客户端无法
分页读取会话消息、无法取消进行中的生成。本卡补齐该层。

当前 HEAD（ce12b48）事实（代码核实）：

1. OpenAPI 端点：
   - `GET /api/v1/conversations/{conversationId}/messages`（operationId listMessages）：query 参数
     `after`（string，opaque cursor=最后消息 id，可选）+ `limit`（integer，可选，服务端 clamp）；200 返回
     `Message[]`（messageId/conversationId/role/content/createdAt）；401。**无 404**——foreign/absent
     conversation → 空数组（list_messages 不 RAISE，存在性不泄露）。
   - `POST /api/v1/generations/{generationId}/cancel`（operationId cancelGeneration）：200 返回
     `Generation`（generationId/conversationId/logicalGenerationId/status）；401；404
     NOT_FOUND_OR_FORBIDDEN（foreign/absent 不泄露）。
2. V10 SD 语义：`list_messages` keyset 分页（`(owner_user_id, id)` 稳定序，`id > after_id`，limit NULL/<1→50、
   >100→100 clamp）；`cancel_generation` 可取消态 = CREATED/INPUT_REVIEW/QUEUED/IN_PROGRESS/
   WAITING_FOR_CAPACITY/FINAL_REVIEW（catalog 双跳 CANCEL_REQUESTED→CANCELLED），COMMITTING 及全部终态
   RAISE，foreign/absent RAISE（FOR UPDATE 锁定 + FORCE RLS 隐藏存在性）。
3. Controller 注册：`@SpringBootApplication` 组件扫描 `com.virtualcompanion.runtime`（GenerationController/
   ConversationController/RelationshipController 是组件扫描 + `@ConditionalOnProperty(auth.datasource-enabled=true)`），
   非 @Bean。`@AuthenticationPrincipal(expression="accountId") long ownerUserId`；路径 id 经 `parseId`
   （Long.parseLong 正数校验，hashid deferred）。
4. 错误处理：`AuthExceptionHandler` 是全局 `@RestControllerAdvice`——**DataAccessException→401
   AUTHENTICATION_REQUIRED（schema 缺失 SQLSTATE 42883/42P01/42703/3F000→503 SCHEMA_UNAVAILABLE）**。
   V10 RAISE 若逃逸到该 advice 会误映射为 401 → cancel 的 service 层必须把业务 RAISE 翻译为领域异常
   （否则对客户端是误导性认证失败）。`runtime.web` 的 `RuntimeApiExceptionHandler` 处理
   ResourceNotFoundException→404 NOT_FOUND_OR_FORBIDDEN、IllegalArgumentException/校验异常→400
   INVALID_REQUEST（TASK-0178 已建，直接复用）。
5. Spring Modulith（RuntimeModuleStructureTest）禁止跨模块依赖 web 子包类型：`runtime/cancel/web` 不能
   import `runtime/generation/web/GenerationController.GenerationResponse`（generation/web 是保护路径不可
   exposes）→ cancel controller 自带同构 `GenerationResponse` record（wire 格式与 GenerationController 的
   4 字段一致）。
6. 写路径约束：`runtime/conversation/**`、`runtime/generation/**` 是保护路径（不可改已有
   ConversationController/GenerationController）；`MessageRepository`（TASK-0176 直读表）也是保护路径
   （直查 `vc.message` 绕过 V10 SD 不满足本卡契约）→ 新建独立 service 包 V10。

用户可观察结果（本卡完成后）：

- **GET /api/v1/conversations/{conversationId}/messages?after=&limit=**：返回该会话消息分页（asc 序），
  `after`=上次最后消息 id 继续翻页，`limit` 服务端 clamp（默认 50、上限 100）；foreign/absent 会话 → 200 空数组。
- **POST /api/v1/generations/{generationId}/cancel**：可取消态生成 → 200 返回 CANCELLED 状态 Generation；
  foreign/absent → 404 NOT_FOUND_OR_FORBIDDEN；不可取消态（COMMITTING/终态）→ 400 INVALID_REQUEST；
  非法 id → 400。
- 统一错误：404 `NOT_FOUND_OR_FORBIDDEN`（不泄露存在性）、400 `INVALID_REQUEST`（非法 id/query）、
  401/503 由既有 auth advice 保持。

## 范围内

1. **`MessageHistoryRecord.java`（新，`platform.persistence`）**：`record(long id, String role, String content,
   Instant createdAt)`（role/content 非空校验；createdAt null→Instant.EPOCH fallback，照 RelationshipRecord）。
2. **`MessageHistoryService.java`（新，`platform.persistence`）**：包 V10：
   - `List<MessageHistoryRecord> listMessages(owner, conversationId, Long afterId, Integer limit)` →
     `SELECT out_id, out_role, out_content, out_created_at FROM vc.list_messages(?, ?, ?, ?)` 4 参透传
     （afterId/limit 为 null 时由 SD 应用默认/clamp——SQL 精确，不重复 SD 逻辑）；owner/conversationId 正数校验。
3. **`GenerationCancelService.java`（新，`platform.persistence`）**：包 V10：
   - `Optional<GenerationRecord> cancel(owner, generationId)`：先 `GenerationRepository.find(owner, genId)`
     判存在（empty→`Optional.empty()`→404 语义，SD RAISE 不泄露存在性）；存在后 `SELECT vc.cancel_generation(?, ?)`
     （String 返回，非 `"CANCELLED"`→IllegalStateException 防御）；
   - **DataAccessException 翻译（必须）**：`BadSqlGrammarException` 上抛（保既有 503 SCHEMA_UNAVAILABLE
     语义），其余 DataAccessException（业务 RAISE P0001——预检后仅可能是不可取消态或并发竞态）→
     `IllegalArgumentException("generation is not cancellable in its current state")`→400。不翻译会被
     AuthExceptionHandler 误映射为 401 AUTHENTICATION_REQUIRED。
4. **`MessageHistoryController.java`（新，`runtime.message.web`）**：`@RestController @RequestMapping("/api/v1")
   @ConditionalOnProperty(auth.datasource-enabled=true)`；GET `/conversations/{conversationId}/messages`；
   `@AuthenticationPrincipal(expression="accountId") long ownerUserId`；`parseId`（Long.parseLong 正数）；
   `after`/`limit` 均 String 手解（非数字→IllegalArgumentException→400，避免
   MethodArgumentTypeMismatchException 无处理）；DTO `MessageResponse(messageId, conversationId, role,
   content, createdAt)`（conversationId 从路径注入，createdAt Instant.toString()，null→null）。
   **无 404 分支**（OpenAPI 语义：foreign/absent → 200 空数组）。
5. **`GenerationCancelController.java`（新，`runtime.cancel.web`）**：POST `/generations/{generationId}/cancel`；
   empty→`ResourceNotFoundException("generation")`→404；自带同构 `GenerationResponse(generationId,
   conversationId, logicalGenerationId, status)` record（不依赖 generation/web 类型——Modulith + 保护路径）。
6. **`AuthDataSourceConfig.java`（修改）**：+ `MessageHistoryService`、`GenerationCancelService` 两个 bean
   （注入 authJdbcTemplate / GenerationRepository）。Controller 组件扫描，不需 @Bean。
7. **测试**（4 类）：
   - `MessageHistoryServiceTest`（新，platform.persistence）：mock JdbcTemplate；SQL 精确 4 参 + RowMapper
     映射 + afterId/limit null 透传 + 参数校验。
   - `GenerationCancelServiceTest`（新，platform.persistence）：happy path（find 存在→SD 调用→find 回读
     CANCELLED）；foreign/absent→empty 且不调 SD；不可取消态预检→IllegalArgumentException 且不调 SD；
     DataAccessException→IllegalArgumentException 翻译；BadSqlGrammarException 上抛；参数校验。
   - `MessageHistoryControllerTest`（新，runtime.message.web）：standalone MockMvc + Principal resolver +
     RuntimeApiExceptionHandler；happy path 200 数组（字段/conversationId 注入/createdAt）；空历史 200 空数组；
     foreign conversation 200 空数组；after 非数字→400；limit 非数字→400；after/limit 透传 verify。
   - `GenerationCancelControllerTest`（新，runtime.cancel.web）：happy path→200 CANCELLED；foreign/absent→404；
     不可取消（IllegalArgumentException）→400；非法 id→400。
8. 终态治理闭环：run-rls-tests.sh 67/67（regression；V10 未改，既有 test 30/31/41/45 覆盖 cancel/list
   语义）+ runtime 定向测试 + git diff --check + 结构化 review-r1 + Evidence/Handoff + 单父
   [skip ci]/push/远端 0/0。

## 明确范围外

- **memory HTTP 端点**（candidates/list/get/update/delete/confirm/reject/evidence，OpenAPI 已定义，V11/V12/V13
  SD 已就绪）→ 下一张卡（TASK-0180+）。
- **C4 snapshot SD 函数 V26 create_authorization_snapshots + AuthorizationSnapshotProvider JDBC 实现 +
  loopback adapter e2e**（激活 external 运行期路径）→ TASK-0180+。
- **realtime SSE 推送（SseEmitter + V8 resume_stream）、ID hashid 编码** → 后续卡。
- **新 DB migration、modelruntime/safety/adapters 源码改动、catalog/contract/OpenAPI 改动**（OpenAPI 端点已
  定义，本卡只补 Java 实现，不改 spec）、**auth/conversation/generation/worker/relationship/web 包源码改动**
  （保护路径）、**MessageRepository 修改**（保护路径，本卡新建独立 service）。
- **doctor/precheck/完整 unittest/根级 mvn verify**（Owner 2026-08-12 static-gates-only 策略 deferred）。

## 输入和前置条件

- Base `ce12b488a34bf8064d68579a1549e474a9355cb0` = TASK-0178 ACCEPTED terminal（已 push、HEAD==origin/main、
  0/0、clean；nextAction 三处 sha256 `0c9a60be...` 一致）。
- DRAFT 前已复核：OpenAPI 2 端点与 schema（listMessages 无 404 / cancel 有 404）；V10 SD 签名与语义
  （cancel RAISE / list clamp）；AuthExceptionHandler DataAccessException→401/503 全局映射（cancel 必须
  翻译）；Controller 组件扫描 + @ConditionalOnProperty 模式；@AuthenticationPrincipal(expression="accountId")
  模式；Modulith 跨模块 web 依赖禁令（cancel 自带 GenerationResponse）；保护路径（conversation/generation/
  MessageRepository 禁改）。
- context lock 输入钉在 Base（132 inputs = 131 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `751b2354...` 由复刻
  verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0178 `f496f774...` 通过，再生 0179）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack。

## API / 事件 / 数据契约

- 2 端点严格对齐 OpenAPI：路径、方法、请求/响应 schema 与错误码（200/400/401/404）不变。DTO id 用
  long（OpenAPI id 是 string——long 序列化为数字字符串，与 TASK-0174/0178 一致；hashid deferred）。
  createdAt 用 Instant.toString()（RFC 3339；MessageResponse.createdAt null→null）。
- 数据契约：复用 V10 SD 函数，不新增表/列/约束/角色/状态/事件。list_messages 分页语义（asc 序 +
  after 游标 + limit clamp 1-100）由 SD 保证；cancel 终态 CANCELLED 由 catalog 双跳保证。
- NOT_FOUND_OR_FORBIDDEN：cancel 的 foreign/absent → service Optional.empty → 404，不泄露存在性；
  listMessages 的 foreign/absent conversation → 200 空数组（OpenAPI 契约，无 404）。
- 400 INVALID_REQUEST：cancel 不可取消态（COMMITTING/终态，SD RAISE 经 service 翻译）、非法 id、
  非法 after/limit。

## 权限、RLS 和数据处理要求

- 全部 SD 函数调用复用既有 vc_api EXECUTE 授权（V10 已 GRANT）；无新增授权、无 REVOKE、无新角色。
- 每个 SD 调用运行在 server-trusted owner 上下文（owner-injection filter 已 SET vc.owner_user_id；V17 断言
  p_owner==current_owner_id 重新校验）。INV-TENANT-001（vc_api NO BYPASSRLS + FORCE RLS owner_isolation）不变。
- 日志不含敏感数据（只记 ownerId/conversationId/generationId/操作；不记消息内容）。

## 状态机和失败行为

- listMessages：无状态变更；foreign/absent → 空数组（不泄露）；after/limit 非法 → 400。
- cancel：可取消态（CREATED/INPUT_REVIEW/QUEUED/IN_PROGRESS/WAITING_FOR_CAPACITY/FINAL_REVIEW）→
  CANCELLED（catalog 双跳 CANCEL_REQUESTED→CANCELLED）；foreign/absent → 404（find 预检，SD RAISE 兜底）；
  不可取消态（COMMITTING/终态）→ service 翻译为 IllegalArgumentException → 400 INVALID_REQUEST。
- SD RAISE 逃逸（非预期）→ BadSqlGrammarException 保持上抛（既有 503 SCHEMA_UNAVAILABLE）；其余
  DataAccessException → service 翻译 400。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。仅消息读取（owner 作用域分页）与生成取消（状态迁移），无外发、无凭据、无真实数据。

## 验收标准

1. 2 端点行为与 OpenAPI 一致：listMessages 返回分页消息数组（foreign→空数组）；cancel 返回 CANCELLED
   Generation（foreign/absent→404 NOT_FOUND_OR_FORBIDDEN）。
2. `MessageHistoryService` 正确调用 V10 SD（SQL 精确 4 参）；`GenerationCancelService` 先 find 判存在再调
   cancel_generation，DataAccessException 翻译正确（单测）。
3. cancel 不可取消态 → 400 INVALID_REQUEST（经 RuntimeApiExceptionHandler）；非法 id/after/limit → 400。
4. Modulith 结构测试（RuntimeModuleStructureTest）PASS：新 controller 包不依赖 auth/generation/conversation
   模块类型（cancel 自带 GenerationResponse）。
5. `MessageHistoryControllerTest` + `GenerationCancelControllerTest` + `MessageHistoryServiceTest` +
   `GenerationCancelServiceTest` 全 PASS；runtime 模块测试 BUILD SUCCESS（0 failure，0 skip）。
6. run-rls-tests.sh 67/67 PASS（regression）。
7. `git diff --check` exit 0。
8. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
   memory HTTP 端点 deferred 下一张卡。
9. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次；runtime 模块定向测试一次；同一无参
`git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py --task TASK-0179`）与完整
Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 回滚或前向修复

- 若 runtime 单测暴露 controller/service 问题：最多 1 fix batch 修 runtime/persistence 代码。
- 若 Modulith 结构测试失败：调整新建类的包归属/依赖（不触碰 auth/generation/conversation 包、不改
  RuntimeModuleStructureTest）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 OpenAPI spec 或 migration 或 modelruntime 或 auth 包：立即停止申请范围升级。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（auth/conversation/generation/worker/relationship/web、
  modelruntime、safety、adapters、migration、specs、harness 等）。
- run-rls-tests.sh / runtime 定向测试 / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0179/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0179.json`。
