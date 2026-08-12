# TASK-0181：C4 snapshot SD 函数 V26 + AuthorizationSnapshotProvider JDBC 实现 + loopback adapter e2e（激活 external 运行期路径）

```yaml
taskId: TASK-0181
state: ACCEPTED
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
targetSkillVersions: {}
baseCommit: aa3d7f7848aeda1c10b37d039d2069e8b6ba1a7a
authorizationCommit: "plan-approved-2026-08-12-authorization-snapshot-external-activation"
contextFingerprint: 4661a26345317f59bee317a79b3ff7f16b916dce832336e348262252f78b9bb5
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0181.context-lock.yaml
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
  riskClass: C4
  surfaceId: TASK_0181_AUTHORIZATION_SNAPSHOT_EXTERNAL_ACTIVATION
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 14
  terminalCheckMinutesEstimate: 14
  estimatedWallMinutes: 60
  thresholdsTriggered: [MIGRATION_C4]
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
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
  - docs/evidence/TASK-0180/evidence-pack.json
  - docs/evidence/TASK-0180/review-r1.md
  - docs/handoffs/TASK-0180.json
  - docs/tasks/TASK-0180-memory-http-api.md
  - docs/tasks/context/TASK-0180.context-lock.yaml
  - docs/tasks/TASK-0177-generation-external-provider-persistence-chain.md
  - docs/tasks/TASK-0144-p2-12-jdbc-authorization-snapshot-one-way.md
  - docs/tasks/TASK-0020-safety-pipeline.md
  - docs/tasks/TASK-0022-fake-failure-offline-e2e-slice.md
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotProvider.java
  - infra/db/tests/67_generation_external_attempt_completed_chain.sql
  - specs/catalog/processing-purposes.yaml
  - specs/catalog/data-categories.yaml
  - service/adapters/model-fake/src/main/java/com/virtualcompanion/modelfake/FakeModelProtocolAdapter.java
  - service/adapters/model-fake/src/main/java/com/virtualcompanion/modelfake/FakeModelProtocolSession.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/StopReason.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderDeployment.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistration.java
  - service/tests/generation-contract-tests/src/test/java/com/virtualcompanion/generation/contract/OfflineGenerationSlice.java
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V26__authorization_snapshot_runtime_creation.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotProvider.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/loopback/LoopbackModelProtocolAdapter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/loopback/LoopbackModelProtocolSession.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotProviderTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/loopback/LoopbackModelProtocolAdapterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/loopback/LoopbackExternalInvocationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - infra/db/tests/68_authorization_snapshot_runtime_creation_external_chain.sql
  - docs/tasks/TASK-0181-authorization-snapshot-external-activation.md
  - docs/tasks/context/TASK-0181.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0181/**
  - docs/handoffs/TASK-0181.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-0180-*
  - docs/tasks/context/TASK-0180.context-lock.yaml
  - docs/evidence/TASK-0180/**
  - docs/handoffs/TASK-0180.json
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
  - service/platform/persistence/src/main/resources/db/migration/V2[0-5]__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviders.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReader.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ZeroLlmModelRuntimeConfig.java
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeSchedulerTest.java
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
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0180.json
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
    sourceThreadId: 7c1f5a9e-2b4d-4e8c-9a3f-6d2b8e1c4a5f
    evidence: >-
      Owner 2026-08-12 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT 治理例外）。
      TASK-0180 闭环后 nextAction 指向本卡（project-state 三处 sha256 b5438660 一致）：C4 snapshot SD
      函数 V26 create_authorization_snapshots + AuthorizationSnapshotProvider JDBC 实现 + loopback
      adapter e2e（激活 external 运行期路径）。Owner 2026-08-12 计划审批拍板两个设计决策：
      (1) 双快照内容（region/contract-ref/purpose/data-categories）来自 external-attempt 配置扩展
      （默认 us/alpha-standard/COMPANION_CHAT/[MESSAGE_TEXT]，与 infra/db test 67/68 fixture 一致），
      providerId 运行期从 registry 按与 DeterministicRouter 一致的候选规则推导（ADMITTED +
      external-attempt.protocol 匹配 + providerId 排序取第一个，与 router 选择一致避免运行期
      blockedByAuthorization）；(2) loopback adapter 落在 runtime main 包（runtime/loopback，
      protocol()=FAKE——catalog ModelProtocol 无 LOOPBACK 枚举且 specs/generated/** 是保护路径），
      ApprovedModelProviderProvisioner.buildAdapter 增加 FAKE 分支，operator 配置 protocol=FAKE 的
      deployment 即装配（model-providers.enabled=true 才生效，默认关闭 fail closed）。C4 卡照
      TASK-0144/0020 治理模式：database-migration skill + independentReview required + 结构化 reviewers。
  - scope: migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 7c1f5a9e-2b4d-4e8c-9a3f-6d2b8e1c4a5f
    evidence: >-
      database-migration skill 1.0.0 授权新增前向 migration V26（新建
      vc.create_authorization_snapshots SECURITY DEFINER 函数 + REVOKE PUBLIC + GRANT vc_api）。
      只新增不修改：不触碰 V1-V25 任何既有 migration/表/列/约束/角色/授权；不改表结构（authorization_snapshot
      表在 V3 已存在）；无 BYPASSRLS；快照行经 FORCE RLS owner_isolation 始终落在 server-trusted 当前
      owner 名下（V17 trusted-owner 断言 + generation 存在性校验）。回滚策略：仅前向修复（V26 只 CREATE
      OR REPLACE 新函数，Flyway checksum 不受影响）。
independentReview: required
reviewers:
  - id: task0181_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: d1d97a3086cb8b326d1ef451a9981db80db06222
    evidencePath: docs/evidence/TASK-0181/review-r1.md
    reason: "R1 完整复核 PASS（candidate 回填）：C4 治理字段齐全；V26 SD 函数符合 V17/V18 硬化模式（trusted-owner 断言、search_path=vc,pg_catalog、REVOKE PUBLIC+GRANT vc_api、generation 存在性校验）；provider 选择与 DeterministicRouter 候选规则一致；loopback adapter 只接受 ExternalAttemptBinding 且 protocol=FAKE；装配条件与 ApprovedModelProviderConfig 一致；Diff 未越 writeAllowlist。"
    candidateTree: 3042daf90020b3d5127f69133eab89fb79ccfed4
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion 纵切的
> C4 snapshot 卡（TASK-0180 范围外明确指向的下一张卡），承接 TASK-0177 的接口 seam（AuthorizationSnapshotProvider
> 无实现无 bean）+ TASK-0180 的 nextAction，沿用 `owner-authorization://longline-2026-08-09` 长线授权
> （hash `cc0f91c1...`），与 TASK-0173..0180 同属 idle DRAFT 治理例外，不进 backlog。
> **C4 触发**：writeAllowlist 含 `**/db/migration/V26__*.sql` → protected-paths `**/db/migration/**` 要求
> `database-migration` skill（已注册 1.0.0）+ humanApproval（migration scope 条目已声明）+ 独立评审
> （independentReview: required + reviewers 结构化数组）。其余写路径（runtime/persistence 非保护文件、
> SchemaReadinessHealthIndicatorTest 期望值随 V26 更新）均不触发额外保护规则。`service/adapters/**`、
> `service/modules/**`、`specs/**`、`scripts/harness/**`、`frontend/**` 保持禁改（loopback adapter 落
> runtime main 包，不落 service/adapters）。

## 背景与用户可观察目标

INV-AUTH-001 要求每次 external 模型尝试绑定 requested + execution 双 authorization snapshot。V20 已把
`provider_attempt` 双 snapshot 列 + composite FK 落地（消费侧），V16 撤销了运行期角色对
`authorization_snapshot` 的直写权限，但全仓没有 create-snapshot SECURITY DEFINER 函数——运行期写路径缺失，
`AuthorizationSnapshotProvider` 是纯接口 seam（无实现、无 bean），`GenerationWorkItemHandler.completeViaExternal`
external 分支运行期不激活（`ObjectProvider#getIfAvailable` 返回 null → 走 ZERO_LLM/disabled 路径）。

本卡补齐生产侧并激活运行期路径：

当前 HEAD（aa3d7f7）事实（代码核实）：

1. **V26 尚不存在**（migration 最高 V25）；`create_authorization_snapshots` SD 函数全仓 0 定义（仅
   `AuthorizationSnapshotProvider.java` javadoc 与 infra/db test 67 注释文字引用）。V16 后 vc_api 对
   `authorization_snapshot` 仅剩 SELECT（FORCE RLS 租户隔离读路径保留）。
2. **SD 函数硬化模式**（V25/V20 模板）：SECURITY DEFINER、`SET search_path = vc, pg_catalog`（V18 基线）、
   V17 trusted-owner 断言（`p_owner_user_id IS DISTINCT FROM vc.current_owner_id()` RAISE）、业务 RAISE、
   `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO vc_api`。
3. **调用链**：`GenerationWorkItemHandler.completeViaExternal`（已就绪，TASK-0177）：
   `snapshotService.createFor(ownerUserId, generationId)` → `assembler.assembleExternal(..., requestedId,
   executionId)`（双 id 非空断言）→ `invoker.invoke(request)`。`LiveModelInvoker.invokeExternal`：
   `ExecutionAuthorizationGuard.authorize(binding)`（双快照必须在 store、ACTIVE、未 cancelled/deleted、
   execution.purpose==requested.purpose、requested.categories ⊇ execution.categories、execution
   provider/region/contract==requested、provider ADMITTED）→ **executionSnapshot.providerId() ==
   decision.selectedProviderId()**（provider 漂移 fail closed）→ SafetyGate ALLOW → adapterLocator →
   session。`DeterministicRouter` 候选规则：registry 中 ADMITTED + protocol==request.requiredProtocol()
   （assembler 传 external-attempt.protocol）+ capabilities 支持（空集→全匹配），按 providerId 排序取第一个。
4. **guard 读取面**：`ApprovedModelProviderConfig`（model-providers.enabled=true）装配
   `InMemoryAuthorizationSnapshotStore` → `ExecutionAuthorizationGuard` → `LiveModelInvoker`——provider
   创建的快照必须 mirror 进该 store（接口 javadoc 明确），guard 才能 find。
5. **loopback adapter 不存在**：`FakeModelProtocolAdapter`（service/adapters/model-fake，protocol=FAKE）
   只接受 `DeterministicSourceBinding`（`UnsupportedBinding` 终态拒绝 external binding）；catalog
   `ModelProtocol` 枚举有 FAKE 无 LOOPBACK（specs/generated/** 是保护路径不可改）→ loopback adapter 走
   FAKE 协议。`ApprovedModelProviderProvisioner.buildAdapter` 只支持 OPENAI/ANTHROPIC 两种协议。
6. **装配模式**：AuthDataSourceConfig（auth.enabled + auth.datasource-enabled）显式 @Bean 工厂方法注入
   `authJdbcTemplate`；`external-attempt.protocol` 经 `@Value` 注入（默认 OPENAI_CHAT_COMPLETIONS）。

用户可观察结果（本卡完成后）：

- **运行期可铸造双授权快照**：vc_api 身份（worker owner-bound 事务内）调
  `create_authorization_snapshots` 一次创建 requested + execution 两行 ACTIVE
  （provider/region/contract/purpose/categories 同内容，execution ⊆ requested 天然满足 guard 校验），
  返回双 snapshot_id 供 ExternalAttemptBinding / record_provider_attempt 绑定。
- **external 分支运行期激活**：model-providers.enabled=true 且 external-attempt 配置就绪时，
  `AuthorizationSnapshotProvider` bean 存在 → `GenerationWorkItemHandler` 走 external 完成路径
  （createFor → assembleExternal → invoke → record_provider_attempt(双快照) → insert_candidate →
  FINAL_REVIEW → finalize 真实 token）。
- **loopback adapter e2e**：operator 配置 protocol=FAKE 的 deployment（provider-id 如
  `alpha-loopback`）→ provisioner 装配进程内确定性 loopback adapter（接受 ExternalAttemptBinding，
  返回固定 OutputDelta + UsageReported(42,58) + AttemptEos，零网络零凭据）→ 进程内全链
  （guard → adapter → terminal）经 `LoopbackExternalInvocationTest` 证明；DB 全链（SD 创建双快照 →
  record → finalize → COMPLETED）经 infra/db test 68 证明。

## 范围内

1. **`V26__authorization_snapshot_runtime_creation.sql`（新，db/migration）**：
   `vc.create_authorization_snapshots(p_owner_user_id bigint, p_generation_id bigint, p_provider_id text,
   p_region text, p_contract_ref text, p_purpose text, p_data_categories text[]) RETURNS TABLE(
   out_requested_id text, out_execution_id text)`——SECURITY DEFINER + SET search_path=vc,pg_catalog；
   NULL/blank 校验；purpose 白名单（catalog processing-purposes 六值）；V17 trusted-owner 断言；
   generation 存在性校验（owner 谓词，不存在 RAISE 不披露）；`'snap_' || gen_random_uuid()` 生成双 id；
   INSERT 双 ACTIVE 行（task_cancelled=false, source_data_deleted=false）；REVOKE PUBLIC + GRANT vc_api。
   头注释：现状缺口 + 安全论证 + 不 REVOKE 既有授权 + V1-V25 frozen 声明。
2. **`JdbcAuthorizationSnapshotProvider.java`（新，platform.persistence）**：implements
   `AuthorizationSnapshotProvider`；注入 `JdbcTemplate`（SD 调用）+ `AuthorizationSnapshotStore`
   （mirror 目标，装配时给 InMemory 实例）+ `ProviderRegistry` + `ModelProtocol externalProtocol` +
   region/contractRef/purpose/dataCategories（不可变，构造校验非空）。`createFor`：
   按 router 一致规则选 ADMITTED + 协议匹配 + 排序第一个 providerId（无 → IllegalStateException
   fail closed 于铸造前）→ `SELECT out_requested_id, out_execution_id FROM
   vc.create_authorization_snapshots(?,?,?,?,?,?,?)`（text[] 经 `ps.getConnection().createArrayOf("text", ...)`
   + PreparedStatementSetter，照 JdbcAuthorizationSnapshotStore:95 模式）→ 行数 != 1 → ISE 防御 →
   构造双 AuthorizationSnapshot（ACTIVE 同内容）→ mirror put ×2（store 失败 fail closed）→
   返回 SnapshotIds。BadSqlGrammarException 上抛（worker handler catch → safeTerminalize，无 HTTP 层）。
3. **`AuthDataSourceConfig.java`（修改）**：新增 `authorizationSnapshotProvider` @Bean，方法级
   `@ConditionalOnProperty(virtual-companion.model-providers.enabled=true)`（与 ApprovedModelProviderConfig
   同条件），注入 authJdbcTemplate + InMemoryAuthorizationSnapshotStore + ApprovedModelProviders +
   `@Value` external-attempt 五配置（protocol/region/contract-ref/purpose/data-categories，默认与
   test 67/68 fixture 一致）；data-categories 逗号分隔解析（DataCategory 枚举校验，非法值启动失败
   fail closed）。更新 workItemHandler javadoc（TASK-0178 措辞 → 本卡现状）。
4. **`application.yaml`（修改）**：external-attempt 扩展 region/contract-ref/purpose/data-categories
   四项（环境变量 VC_EXTERNAL_REGION/CONTRACT/PURPOSE/CATEGORIES 可覆盖），注释说明 providerId 从
   registry 推导。
5. **`LoopbackModelProtocolAdapter.java` + `LoopbackModelProtocolSession.java`（新，runtime/loopback）**：
   ModelProtocolAdapter 端口实现，`protocol()=FAKE`、capabilities 空；open 时 binding 必须
   `ExternalAttemptBinding`（否则 AttemptFailed(UnsupportedBinding) 终态）；成功路径固定事件流
   OutputDelta("I hear you. Take a breath; there's no rush.") + UsageReported(42,58,0) + AttemptEos(STOP)
   ——usage 与 test 67/68 fixture 一致。Session 单消费者（照 FakeModelProtocolSession 模式）。
6. **`ApprovedModelProviderProvisioner.java`（修改）**：buildAdapter 增加 `case FAKE -> new
   LoopbackModelProtocolAdapter()`；错误消息与 parseProtocol 消息更新为含 FAKE。
7. **测试**（4 类）：
   - `infra/db/tests/68_authorization_snapshot_runtime_creation_external_chain.sql`（新）：vc_api 身份
     调 SD 函数创建双快照（替代 67 的 superuser 预置）→ 完整 external 链（record_provider_attempt
     绑定双 id → insert_candidate → promote FINAL_REVIEW → finalize 42/58 真实 token）→ COMPLETED；
     superuser 断言双 ACTIVE 行 + provider_attempt 绑定 + usage + quota SETTLE + 1 条 assistant message；
     负向：未知 generation / 跨 owner（V17）/ 空 provider_id → raise_exception。
   - `JdbcAuthorizationSnapshotProviderTest`（新，platform.persistence）：mock JdbcTemplate +
     mock AuthorizationSnapshotStore + InMemoryProviderRegistry；钉 SD SQL 文本与 7 参顺序（含 text[]
     createArrayOf）；双 id 映射 + mirror put 断言（ACTIVE/provider/region/contract/purpose/categories）；
     provider 选择与 router 规则一致（协议不匹配/排序）；无 ADMITTED → ISE；0 行 → ISE；
     非法 id → IAE；BadSqlGrammarException 上抛；空 categories 构造拒绝。
   - `LoopbackModelProtocolAdapterTest`（新，runtime）：FAKE 协议 + 空 capabilities；external binding
     确定性三事件流（含 sequence/binding/usage/stopReason）；deterministic binding → UnsupportedBinding
     终态；cancel 语义。
   - `LoopbackExternalInvocationTest`（新，runtime）：进程内 e2e——registry(FAKE/loopback) +
     InMemory store 双快照 + guard + QuotaLedger（provision 预算）+ router + recovery + LiveModelInvoker
     → SUCCEEDED + usage 42/58 + audit（providerId/supplierName/status）；负向：execution snapshot
     缺失 → BLOCKED_BY_AUTHORIZATION 零审计；execution provider 漂移 → BLOCKED。
   - `SchemaReadinessHealthIndicatorTest.java`（修改，runtime/auth/config）：`expectedSchemaVersion`
     25 → 26（V26 落地后 classpath 最大版本变化的必然影响，注释更新）。
8. 终态治理闭环：run-rls 69/69（68 新增）+ runtime 定向测试 311/0/0（persistence 102/0/0）+
   git diff --check + 结构化 review-r1（C4 independent review 记录）+ Evidence/Handoff +
   单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **realtime SSE 推送（SseEmitter + V8 resume_stream）、ID hashid 编码** → 后续卡。
- **catalog/contract/OpenAPI 改动**（ModelProtocol 无 LOOPBACK 枚举，loopback 复用 FAKE；不改
  specs/generated/**）、**service/adapters/** 任何改动**（loopback 落 runtime main 包）、
  **service/modules/modelruntime/** 任何改动**（guard/router/invoker/store 只读消费）、
  **JdbcAuthorizationSnapshotStore 修改**（保留未 wire 状态；本卡经 SD 函数写库，不接线直写 store）、
  **AuthorizationSnapshotProvider 接口修改**（签名不变，只加实现）、**worker 包改动**
  （GenerationWorkItemHandler/Assembler 只读消费）、**V1-V25 migration 修改**。
- **doctor/precheck/完整 unittest/根级 mvn verify**（Owner 2026-08-12 static-gates-only 策略 deferred）。

## 输入和前置条件

- Base `aa3d7f7848aeda1c10b37d039d2069e8b6ba1a7a` = TASK-0180 ACCEPTED terminal（已 push、HEAD==origin/main、
  0/0、clean；nextAction 三处 sha256 `b5438660...` 一致）。
- DRAFT 前已复核：V3 authorization_snapshot 表结构/RLS/权限基线；V16 REVOKE 明细（vc_api 仅剩 SELECT）；
  V20 record_provider_attempt 7 参版 + composite FK；V25/V20 SD 硬化模板；ExecutionAuthorizationGuard
  校验矩阵；LiveModelInvoker execution-snapshot provider 对齐；DeterministicRouter 候选规则；
  ApprovedModelProviderConfig 装配面；Fake adapter 只接受 DeterministicSourceBinding；catalog
  ModelProtocol 枚举（FAKE 存在、LOOPBACK 不存在）；infra/db test 67 fixture
  （alpha-loopback/us/alpha-standard/COMPANION_CHAT/[MESSAGE_TEXT]/42-58）。
- context lock 输入钉在 Base（157 inputs = 156 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `4661a263...`
  由复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0180 `70d6933e...` 通过，再生 0181）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack。

## API / 事件 / 数据契约

- **V26 SD 函数**：`create_authorization_snapshots(bigint, bigint, text, text, text, text, text[])`
  → `TABLE(out_requested_id text, out_execution_id text)`；RAISE：NULL/blank 参数、unsupported purpose、
  V17 跨 owner、generation 不存在；GRANT vc_api（REVOKE PUBLIC 后）。
- **快照内容**：requested = execution 同内容（purpose/categories/provider/region/contract 全等）——
  ExecutionAuthorizationGuard 的 execution ⊆ requested 校验天然满足；快照行 status=ACTIVE、
  task_cancelled=false、source_data_deleted=false；id 格式 `snap_<uuid>`。
- **external-attempt 配置**：`protocol`（默认 OPENAI_CHAT_COMPLETIONS）、`region`（默认 us）、
  `contract-ref`（默认 alpha-standard）、`purpose`（默认 COMPANION_CHAT）、`data-categories`（默认
  MESSAGE_TEXT，逗号分隔多值）。
- **providerId 推导**：registry 中 ADMITTED + protocol == external-attempt.protocol + 按 providerId
  排序取第一个（与 DeterministicRouter 完全一致——LiveModelInvoker 步骤 2 校验
  executionSnapshot.providerId == selectedProviderId，不一致运行期 blockedByAuthorization → FAILED_FINAL）。
- **loopback adapter**：protocol=FAKE；只接受 ExternalAttemptBinding；固定事件流
  （OutputDelta seq0 + UsageReported seq1(42,58,0) + AttemptEos seq2(STOP)）；deterministic binding →
  AttemptFailed(UnsupportedBinding)。
- **失败语义**：createFor 内 BadSqlGrammarException 上抛（worker handler catch → safeTerminalize →
  FAILED_FINAL，无 HTTP 层）；无 ADMITTED 部署 → ISE（handler fail closed）；SD 返回 0 行/多行 → ISE。

## 权限、RLS 和数据处理要求

- 运行期快照创建只经 V26 SECURITY DEFINER 函数（V16 后 vc_api 无表直写权限）；函数内 INSERT 受 FORCE
  RLS owner_isolation 约束 + V17 trusted-owner 断言，行永远落在 server-trusted 当前 owner 名下。
- 无新角色、无新表/列/约束/状态、无 BYPASSRLS、不 REVOKE 任何既有授权、不改既有函数。
- mirror 的 InMemory store 只承载运行期进程内守卫读取面（ExecutionAuthorizationGuard.find）；
  持久化真源是 authorization_snapshot 表（SD 函数写、SELECT 经 RLS）。
- 日志不含敏感数据（只记 ownerId/generationId/providerId/快照 id；不记消息内容/凭据）。
- loopback adapter 零网络、零凭据、零真实数据（进程内确定性事件流）。

## 状态机和失败行为

- **装配**：model-providers.enabled=true + auth.datasource-enabled=true 时 provider bean 装配；
  缺任一 → 无 provider bean（external 分支不激活）或装配失败 fail closed（配置不合法）。
- **createFor**：选 provider → SD 铸造双行 → mirror → 返回双 id；任何失败（无部署/RAISE/缺行/镜像失败）
  上抛 → worker handler catch → safeTerminalize（FAILED_FINAL，不伪造 PASS）。
- **invoke**：guard 拒绝（快照缺失/非 ACTIVE/漂移）→ BLOCKED_BY_AUTHORIZATION（零外发零审计）；
  loopback 会话 → SUCCEEDED（有审计）或 FAILED（无/有审计按 AdapterFailure）。
- **finalize**：SUCCEEDED → record_provider_attempt（V20，双快照 FK 绑定）→ insert_candidate →
  FINAL_REVIEW → finalize_generation（真实 token）；非 SUCCEEDED → FAILED_FINAL（有真实外发则先记审计）。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt 改动（loopback 是进程内确定性 adapter，非真实模型）。安全边界：双快照授权经
ExecutionAuthorizationGuard 全矩阵校验（INV-AUTH-001 契约）；SafetyGate 在 LiveModelInvoker 内保持
（classifier 报告由调用方提供，本卡不变）；零真实外发、零真实数据、零凭据。记忆不涉及（无 memory 域改动）。

## 验收标准

1. V26 提供 `create_authorization_snapshots` SD 函数：V17 trusted-owner 断言、generation 存在性校验、
   purpose 白名单、双 ACTIVE 行（task_cancelled/source_data_deleted=false）、REVOKE PUBLIC + GRANT vc_api。
2. infra/db test 68 PASS：vc_api 身份经 SD 创建双快照 → 完整 external 链 → COMPLETED；负向
   （未知 generation/跨 owner/空 provider_id）RAISE；run-rls 全绿（含 67 回归）。
3. `JdbcAuthorizationSnapshotProvider`：SD 调用 SQL/参数精确（text[] createArrayOf）、双 id 映射、
   mirror put 断言、provider 选择与 router 规则一致、无 ADMITTED/0 行 → fail closed、
   BadSqlGrammarException 上抛（单测）。
4. loopback adapter：接受 ExternalAttemptBinding → 确定性三事件流（usage 42/58）；deterministic
   binding → UnsupportedBinding 终态；protocol=FAKE（单测）。
5. `LoopbackExternalInvocationTest` 进程内 e2e：guard → loopback → SUCCEEDED + audit；缺失 execution
   快照/provider 漂移 → BLOCKED_BY_AUTHORIZATION 零审计（单测）。
6. `AuthDataSourceConfig` 装配：model-providers.enabled=true 时 provider bean 存在（方法级条件与
   ApprovedModelProviderConfig 一致）；external-attempt 配置注入正确。
7. `SchemaReadinessHealthIndicatorTest` 更新为 26；runtime 模块测试 BUILD SUCCESS（0 failure，0 skip）。
8. run-rls-tests.sh 69/69 PASS；`git diff --check` exit 0。
9. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
   C4 reviewers 结构化数组（candidate SHA 回填）。
10. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次；runtime 模块定向测试一次；同一无参
`git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py --task TASK-0181`）与完整
Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 回滚或前向修复

- 若 runtime/persistence 单测暴露问题：最多 1 fix batch 修 writeAllowlist 内代码。
- 若 run-rls 失败：V26 函数体/测试 SQL 前向修复（V26 只 CREATE OR REPLACE 新函数，无既有对象依赖，
  Flyway checksum 不受影响；不修改 V1-V25）。
- 若 Modulith 结构测试失败：调整新建类的包归属/依赖（loopback 包不依赖 web 子包；不改
  RuntimeModuleStructureTest）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 catalog/specs/modelruntime/adapters/worker 或 V1-V25：立即停止申请范围升级。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（0170-0180 全部卡产物、migration V1-V25、
  tests 01-67、modelruntime、safety、adapters、specs、harness、frontend、auth/worker/web 包等）。
- run-rls-tests.sh / runtime 定向测试 / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0181/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0181.json`。
