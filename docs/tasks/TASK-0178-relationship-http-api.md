# TASK-0178：Relationship HTTP API（5 端点：create/list/get/activate/deactivate；复用 V9 SD，OpenAPI 已定义）

```yaml
taskId: TASK-0178
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
baseCommit: a8db88c2d3a62606823f45e11410faf924ffcd12
authorizationCommit: "plan-approved-2026-08-12-relationship-http-api"
contextFingerprint: f496f7743a840b1652b54b16b54e5d99e3787efe59c15cda10673982b0d5ccb2
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0178.context-lock.yaml
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
  surfaceId: TASK_0178_RELATIONSHIP_HTTP_API
  policySurfaces: [BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 15
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
  - docs/evidence/TASK-0177/evidence-pack.json
  - docs/evidence/TASK-0177/review-r1.md
  - docs/handoffs/TASK-0177.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0177-generation-external-provider-persistence-chain.md
  - docs/tasks/context/TASK-0177.context-lock.yaml
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
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RelationshipService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/relationship/web/RelationshipController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/web/ErrorEnvelope.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/web/ResourceNotFoundException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/web/RuntimeApiExceptionHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RelationshipServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/relationship/web/RelationshipControllerTest.java
  - docs/tasks/TASK-0178-relationship-http-api.md
  - docs/tasks/context/TASK-0178.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0178/**
  - docs/handoffs/TASK-0178.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-7]-*
  - docs/tasks/context/TASK-017[0-7].context-lock.yaml
  - docs/evidence/TASK-017[0-7]/**
  - docs/handoffs/TASK-017[0-7].json
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
  - service/platform/persistence/src/test/**
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
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/generation/**
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
  - docs/handoffs/TASK-0177.json
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
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 长线授权继续 generation 纵切（一次一张新卡，idle DRAFT 治理例外）。TASK-0177 闭环后
      nextAction 原指向 C4 snapshot SD 函数，但该路径仍需 loopback adapter 才能 e2e 且 C4 带独立 Reviewer 治理
      成本；Owner 在本会话确认下一卡改为 C2 方向。本卡 TASK-0178 实现 OpenAPI 已定义但 Java HTTP 层缺失的
      5 个 relationship 端点（create/list/get/activate/deactivate），复用 V9 SD 函数（均已 GRANT vc_api），
      纯 runtime + persistence 层，不新增 migration、不改 modelruntime/safety/adapters/specs。listMessages +
      cancelGeneration 留 TASK-0179（避免 7 端点单卡触发 complexityGate split）。
independentReview: not-required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion 纵切的
> Relationship HTTP API 卡，承接 TASK-0177（外部 provider 持久化链），沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0177
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何保护路径**：`service/modules/**`(C3)、
> `service/modules/safety/**`(C4)、`service/adapters/**`(C3)、`**/db/migration/**`(C4)、`specs/**`、
> `auth/web/**` 等均不改——只消费 V9 SD 公共函数 + 新建 runtime/persistence 非保护文件。故 riskClass=C2，
> independentReview=not-required（仍按长线惯例产出 review-r1）。

## 背景与用户可观察目标

OpenAPI（specs/openapi/virtual-companion.yaml L42-179）已定义 5 个 relationship 端点，V9 SD 函数已就绪
（create/list/get/activate/deactivate_relationship，均已 GRANT vc_api），但 Java HTTP 层缺失——客户端无法
创建/查看/激活/停用 Companion 关系。本卡补齐该层。

当前 HEAD（a8db88c）事实（代码核实）：

1. OpenAPI 端点：`POST /api/v1/relationships`(createRelationship)、`GET /api/v1/relationships`
   (listRelationships)、`GET /api/v1/relationships/{id}`(getRelationship)、`POST /api/v1/relationships/{id}`
   (activateRelationship)、`POST /api/v1/relationships/{id}/deactivate`(deactivateRelationship)。Schema：
   `Relationship{relationshipId(string),personaRef(string),active(boolean),createdAt(date-time)}`、
   `RelationshipCreateRequest{personaRef(string)}`。
2. V9 SD 函数：create_relationship(owner,persona)→bigint；list_relationships(owner)→TABLE(out_id,
   out_persona_ref,out_active,out_created_at)；get_relationship(owner,id)→TABLE（foreign id 在 RLS 下空）；
   activate_relationship(owner,id)→boolean（foreign/absent RAISE，advisory lock 保证 activeCompanionLimit=1）；
   deactivate_relationship(owner,id)→boolean（foreign/absent false）。全部 V17 trusted-owner 断言
   （p_owner==vc.current_owner_id()）+ GRANT vc_api。
3. Controller 注册：`@SpringBootApplication` 组件扫描 `com.virtualcompanion.runtime`（GenerationController/
   ConversationController 是组件扫描 + `@ConditionalOnProperty(auth.datasource-enabled=true)`），非 @Bean。
   `@AuthenticationPrincipal(expression="accountId") long ownerUserId`（accountId 即 owner_user_id，RLS 绑定由
   owner-injection filter 完成）；路径 id 经 `parseId`（Long.parseLong，hashid 编码 deferred）。
4. 错误处理：`AuthExceptionHandler` 是全局 `@RestControllerAdvice` 但把 DataAccessException→401（auth 专用），
   `auth/web/**` 是保护路径不可改；且 Spring Modulith（RuntimeModuleStructureTest）禁止 `web` 模块依赖
   `auth` 模块未暴露类型（ErrorEnvelope）。故 runtime API 需自己的错误形状与 advice（wire 格式与 OpenAPI
   ErrorEnvelope 一致：code+message）。

用户可观察结果（本卡完成后）：

- **POST /api/v1/relationships**：创建关系（personaRef 必填非空≤128），新关系成为唯一 active Companion，
  既有 active 自动 deactivate；返回 Relationship。
- **GET /api/v1/relationships**：返回调用者全部关系（active + dormant）。
- **GET /api/v1/relationships/{id}**：返回单个关系；foreign/absent → 404 NOT_FOUND_OR_FORBIDDEN。
- **POST /api/v1/relationships/{id}**：激活为唯一 active；foreign/absent → 404。
- **POST /api/v1/relationships/{id}/deactivate**：停用（Alpha 允许 0 active）；foreign/absent → 404。
- 统一错误：404 `NOT_FOUND_OR_FORBIDDEN`（不泄露存在性）、400 `INVALID_REQUEST`（非法 id/body）、
  401/503 由既有 auth advice 保持。

## 范围内

1. **`RelationshipRecord.java`（新，`platform.persistence`）**：`record(long id, String personaRef, boolean
   active, Instant createdAt)`（personaRef/createdAt 非空校验）。
2. **`RelationshipService.java`（新，`platform.persistence`）**：包 V9 SD：
   - `long create(owner, personaRef)` → `SELECT vc.create_relationship(?, ?)`；
   - `List<RelationshipRecord> list(owner)` → `SELECT out_id, out_persona_ref, out_active, out_created_at
     FROM vc.list_relationships(?)`（RowMapper）；
   - `Optional<RelationshipRecord> get(owner, relId)` → get_relationship 空表→empty；
   - `Optional<RelationshipRecord> activate(owner, relId)` → 先 get 判存在（empty→Optional.empty），再
     activate_relationship，再 get 返回更新行；
   - `Optional<RelationshipRecord> deactivate(owner, relId)` → deactivate_relationship false→empty，true→get。
3. **`RelationshipController.java`（新，`runtime.relationship.web`）**：`@RestController @RequestMapping("/api/v1")
   @ConditionalOnProperty(auth.datasource-enabled=true)`，5 端点；`@AuthenticationPrincipal(expression="accountId")
   long ownerUserId`；`parseId`（Long.parseLong，正数校验）；DTO `CreateRelationshipRequest(@NotBlank @Size(max=128)
   personaRef)` + `RelationshipResponse(relationshipId, personaRef, active, createdAt)`；get/activate/deactivate
   foreign/absent → 抛 `ResourceNotFoundException`；create 后回读。
4. **`ResourceNotFoundException.java`（新，`runtime.web`）**：RuntimeException，携带 resource 类型。
5. **`ErrorEnvelope.java`（新，`runtime.web`）**：`record(code, message)`（OpenAPI ErrorEnvelope 契约形状；
   与 auth 模块同名记录独立存在——Modulith 禁止 web→auth 未暴露类型依赖，auth/web/** 保护不可改，wire 格式
   不变）。
6. **`RuntimeApiExceptionHandler.java`（新，`runtime.web`）**：`@RestControllerAdvice`（组件扫描）：
   ResourceNotFoundException→404 NOT_FOUND_OR_FORBIDDEN；IllegalArgumentException→400 INVALID_REQUEST；
   MethodArgumentNotValidException/HandlerMethodValidationException/HttpMessageNotReadableException→400
   INVALID_REQUEST。与 AuthExceptionHandler 各司其职（auth 异常由 auth advice 处理，两者不重叠）。
7. **`AuthDataSourceConfig.java`（修改）**：+ `RelationshipService` bean（注入 authJdbcTemplate）。Controller
   组件扫描，不需 @Bean。
8. **测试**：
   - `RelationshipControllerTest`（新，runtime.relationship.web）：standalone MockMvc + resolver 注入
     Principal（long 参数直接返回 accountId）+ RuntimeApiExceptionHandler；10 场景：create/list/get/activate/
     deactivate happy path、get/activate/deactivate foreign→404、blank persona→400、非法 id→400。
   - `RelationshipServiceTest`（新，platform.persistence）：mock JdbcTemplate；7 场景：create SQL+返回、
     blank persona 拒绝、list RowMapper、get empty、activate empty、deactivate false→empty、
     deactivate true→更新行。
9. 终态治理闭环：run-rls-tests.sh 67/67（regression；V9 未改，既有 test 26/27/28/29 覆盖）+ runtime 定向
   测试 + git diff --check + 结构化 review-r1 + Evidence/Handoff + 单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **listMessages（GET /api/v1/conversations/{id}/messages）+ cancelGeneration（POST /api/v1/generations/{id}/cancel）**
  → TASK-0179。
- **memory HTTP 端点**（candidates/list/get/update/delete/confirm/reject/evidence，OpenAPI 已定义，V11/V12/V13
  SD 已就绪）→ 后续卡。
- **ID hashid 编码**（DTO id 仍 long/numeric string，与 TASK-0174 一致 deferred）。
- **新 DB migration、modelruntime/safety/adapters 源码改动、catalog/contract/OpenAPI 改动**（OpenAPI 端点已
  定义，本卡只补 Java 实现，不改 spec）、**auth/web 源码改动**（保护路径）。
- **doctor/precheck/完整 unittest/根级 mvn verify**（Owner 2026-08-12 static-gates-only 策略 deferred）。

## 输入和前置条件

- Base `a8db88c2d3a62606823f45e11410faf924ffcd12` = TASK-0177 ACCEPTED terminal（已 push、HEAD==origin/main、
  0/0、clean；nextAction 三处 sha256 `ccf29c3d...` 一致）。
- DRAFT 前已复核：OpenAPI 5 端点与 schema；V9 SD 签名与语义（activate RAISE / deactivate false 语义）；
  Controller 组件扫描 + @ConditionalOnProperty 模式；@AuthenticationPrincipal(expression="accountId") 模式；
  AuthExceptionHandler 全局 advice + Modulith web→auth 依赖禁令；auth/web/** 保护路径。
- context lock 输入钉在 Base（132 inputs = 131 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `f496f774...` 由复刻
  verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0177 `ef5dec13...` 通过，再生 0178）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack。

## API / 事件 / 数据契约

- 5 端点严格对齐 OpenAPI：路径、方法、请求/响应 schema 与错误码（200/400/401/404/503）不变。DTO id 用
  long（OpenAPI relationshipId 是 string——long 序列化为数字字符串，与 TASK-0174 的 generationId 一致；
  hashid deferred）。createdAt 用 Instant.toString()（RFC 3339）。
- 数据契约：复用 V9 SD 函数，不新增表/列/约束/角色/状态/事件。activeCompanionLimit=1 由 V9 advisory lock +
  部分唯一索引保证（未改）。
- NOT_FOUND_OR_FORBIDDEN：get 空表 / activate RAISE→service empty / deactivate false→empty，统一 404，
  不泄露存在性。

## 权限、RLS 和数据处理要求

- 全部 SD 函数调用复用既有 vc_api EXECUTE 授权（V9 已 GRANT）；无新增授权、无 REVOKE、无新角色。
- 每个 SD 调用运行在 server-trusted owner 上下文（owner-injection filter 已 SET vc.owner_user_id；V17 断言
  p_owner==current_owner_id 重新校验）。INV-TENANT-001（vc_api NO BYPASSRLS + FORCE RLS owner_isolation）不变。
- 日志不含敏感数据（只记 ownerId/relId/操作）。

## 状态机和失败行为

- create：新关系 active，既有 active 原子 deactivate（V9 advisory lock + 部分唯一索引）。
- activate：目标 active，其他 deactivate；foreign/absent→404（不泄露）。
- deactivate：目标 inactive（Alpha 允许 0 active）；foreign/absent→404。
- personaRef 空/超长 → 400 INVALID_REQUEST（@Valid 校验，服务层 blank 校验兜底）。
- SD RAISE（非 not-found，如非预期）→ DataAccessException → 既有 AuthExceptionHandler 映射（503
  SCHEMA_UNAVAILABLE / 401），本卡不新增处理。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。仅关系生命周期 CRUD（owner 作用域），无外发、无凭据、无真实数据。

## 验收标准

1. 5 端点行为与 OpenAPI 一致：create 返回新关系（active）；list 返回全部；get/activate/deactivate 返回目标
   关系；foreign/absent → 404 NOT_FOUND_OR_FORBIDDEN。
2. `RelationshipService` 正确调用 V9 SD（SQL 精确）；activate/deactivate 的 empty 语义正确（单测）。
3. `RuntimeApiExceptionHandler`：404 NOT_FOUND_OR_FORBIDDEN / 400 INVALID_REQUEST（含校验异常）；
   `ErrorEnvelope` wire 格式 code+message；不触碰 auth 包。
4. Modulith 结构测试（RuntimeModuleStructureTest）PASS：web 模块不依赖 auth 未暴露类型。
5. `RelationshipControllerTest` 10 场景 + `RelationshipServiceTest` 7 场景全 PASS；runtime 模块测试
   BUILD SUCCESS（0 failure，0 skip）。
6. run-rls-tests.sh 67/67 PASS（regression）。
7. `git diff --check` exit 0。
8. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
   listMessages + cancelGeneration deferred TASK-0179。
9. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次；runtime 模块定向测试一次；同一无参
`git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py --task TASK-0178`）与完整
Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 回滚或前向修复

- 若 runtime 单测暴露 controller/service 问题：最多 1 fix batch 修 runtime/persistence 代码。
- 若 Modulith 结构测试失败：调整新建类的包归属/依赖（不触碰 auth 包、不改 RuntimeModuleStructureTest）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 OpenAPI spec 或 migration 或 modelruntime 或 auth 包：立即停止申请范围升级。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（auth/web、modelruntime、safety、adapters、migration、
  specs、harness 等）。
- run-rls-tests.sh / runtime 定向测试 / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0178/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0178.json`。
