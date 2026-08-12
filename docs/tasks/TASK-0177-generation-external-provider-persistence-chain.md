# TASK-0177：Generation 外部 provider 成功持久化/审计链接线（handler external 终态分派 + V20 record_provider_attempt + V7 真实 token finalize；snapshot 创建留 TASK-0178）

```yaml
taskId: TASK-0177
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
baseCommit: 885b5e262f97f8773a0b6b5ea5ed835cc7445fc7
authorizationCommit: "plan-approved-2026-08-12-generation-external-provider-persistence-chain"
contextFingerprint: ef5dec13e642af7cb34db913e72d59f9db63e11a6218f0f1bf915f0eb049417d
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0177.context-lock.yaml
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
  surfaceId: TASK_0177_GENERATION_EXTERNAL_PROVIDER_PERSISTENCE_CHAIN
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
  - docs/evidence/TASK-0176/evidence-pack.json
  - docs/evidence/TASK-0176/review-r1.md
  - docs/handoffs/TASK-0176.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0176-generation-zero-llm-completion.md
  - docs/tasks/context/TASK-0176.context-lock.yaml
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
writeAllowlist:
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotProvider.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/resources/application.yaml
  - infra/db/tests/67_generation_external_attempt_completed_chain.sql
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/LiveInvocationAssemblerTest.java
  - docs/tasks/TASK-0177-generation-external-provider-persistence-chain.md
  - docs/tasks/context/TASK-0177.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0177/**
  - docs/handoffs/TASK-0177.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-6]-*
  - docs/tasks/context/TASK-017[0-6].context-lock.yaml
  - docs/evidence/TASK-017[0-6]/**
  - docs/handoffs/TASK-017[0-6].json
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
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemEnqueueService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationCreateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V2[0-9]__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviders.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
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
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemWorkerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/WorkItemCoordinatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-5][0-9]_*.sql
  - infra/db/tests/6[0-6]_*.sql
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
  - docs/handoffs/TASK-0176.json
requiredInvariants:
  - INV-AUTH-001
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-TX-001
  - INV-TENANT-001
  - INV-WORKER-001
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
      Owner 2026-08-12 长线授权继续 generation 纵切（一次一张新卡，idle DRAFT 治理例外）。TASK-0176 接通了
      ZERO_LLM 确定性完成路径（产 COMPLETED）。本卡 TASK-0177 接线外部 provider 成功的**持久化与审计链**：
      handler 在 external 模式下创建 dual authorization snapshot（经 AuthorizationSnapshotProvider 接口）→
      assembleExternal 装配 external RoutingRequest（simulated entitlement + 双 snapshot id + 配置 protocol）→
      invoke → SUCCEEDED 时 record_provider_attempt(V20，绑双 snapshot，INV-AUTH-001)+insert_candidate+promote
      FINAL_REVIEW+finalize_generation(真实 token)；FAILED/TIMED_OUT/CANCELLED（已外发）先 record 再 terminalize
      FAILED_FINAL；BLOCKED_BY_SAFETY/AUTH/NO_ELIGIBLE（未外发）直接 terminalize FAILED_FINAL。复用既有 V3/V7/V15/V20
      SD 函数，不新增 migration、不改 modelruntime/safety 源码。Owner 在本会话确认选卡（external 持久化/审计链），
      并在 V16 权限约束发现后确认**降范围**：运行期 authorization_snapshot 创建（需 create-snapshot SD 函数 = C4）
      与 loopback adapter e2e 留 TASK-0178；AuthorizationSnapshotProvider 仅留接口 seam（无运行期 bean → external
      分支运行期不激活，与无 loopback adapter 一致），持久化/审计链完整单测+DB 实证。
independentReview: not-required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation 纵切的
> 外部 provider 成功持久化/审计链卡，承接 TASK-0176（ZERO_LLM 完成路径），沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0176
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何保护路径**：`service/modules/modelruntime/**`(C3)、
> `service/modules/safety/**`(C4)、`service/adapters/**`(C3)、`**/db/migration/**`(C4) 均不改——只消费
> modelruntime/safety 公共 API + 复用既有 V3/V7/V15/V20 SD 函数；全部产出落在
> `service/apps/runtime/**` + `service/platform/persistence/**`（非保护路径）+ 治理文档。INV-AUTH-001 执行点
> 在 V20 SD 函数层（未改），handler 是新调用方。故 riskClass=C2，independentReview=not-required（仍按长线
> 惯例产出 review-r1）。

## 背景与用户可观察目标

TASK-0176 接通了 ZERO_LLM 确定性完成路径（产 COMPLETED），但真实外部 provider 成功路径的**持久化与审计**
仍未接：invoker 返回 SUCCEEDED 时，handler 不记录 `provider_attempt`（不绑 dual snapshot，违 INV-AUTH-001）、
不以真实 token finalize、不分派 safety/auth/失败终态。本卡接线这条链。

当前 HEAD（885b5e26）事实（代码核实）：

1. `LiveModelInvoker.invokeExternal`(L104-256) 已完整实现（modelruntime 库，C3 不可改）：auth guard →
   snapshot 复核 → SafetyGate → adapterLocator → session fence → 终态映射 LiveAttemptOutcome。invoker **不做
   DB 写**——ProviderAttemptAudit 是纯内存值对象。
2. **权威 `record_provider_attempt` 是 V20 的 7 参数版**（含 `p_requested_authorization_snapshot` /
   `p_execution_authorization_snapshot`），V15 5 参数版已被 V20 DROP。composite FK →
   `authorization_snapshot(owner_user_id, snapshot_id)`（INV-AUTH-001）。
3. **V16 从 vc_api 等所有运行期角色撤销了 authorization_snapshot 的 INSERT/UPDATE/DELETE**；全仓库无
   `create_authorization_snapshot` SECURITY DEFINER 函数；`JdbcAuthorizationSnapshotStore` 自述为「persistence
   skeleton」（未 wire 为 bean，仅 superuser 测试）→ 运行期 authorization_snapshot 写路径**未建**，需新 SD
   函数（C4 migration），不在本卡范围。
4. **无 fake/loopback adapter 接受 `ExternalAttemptBinding`**（`service/adapters/**` 禁改 + provisioner 不支持
   FAKE 协议）→ 真实 loopback e2e 是独立后续卡。
5. 故 external 成功路径在 Alpha 运行期不可达（无 snapshot 写路径 + 无 loopback adapter），但**持久化/审计链
   可完整接线并经单测（mock invoker）+ DB test（superuser 预置 snapshot，实证 SD 链）证明**——与 TASK-0176
   对称（0176 也 mock invoker + DB test 实证 SD 链）。

用户可观察结果（本卡完成后）：

- **`GenerationFinalizeService`**：+`recordProviderAttempt`（V20 7 参数包装）+`finalizeCompletedWithUsage`
  （V7 真实 token/cost/quota 包装）；既有 `finalizeCompleted`（ZERO_LLM 0-token）/`insertCandidate`/
  `terminalizeAsFailed` 不变。
- **`AuthorizationSnapshotProvider`**（新接口，`platform.persistence`）：`SnapshotIds createFor(owner, gen)` seam；
  **无运行期 bean**（V16 后 vc_api 不可直写 authorization_snapshot，需 TASK-0178 的 create-snapshot SD 函数）。
- **`LiveInvocationAssembler`**：+`assembleExternal(owner, gen, reqSnap, execSnap)`（复用 loadOwnership/messages/
  fence；simulated entitlement + 双 snapshot id + 配置 protocol + ZERO_LLM fallback source）。
- **`GenerationWorkItemHandler`**：+`ObjectProvider<AuthorizationSnapshotProvider>`（external 模式信号）；external
  分支 SUCCEEDED→record+insert+promote+finalize(真实 token)；degraded 已外发→record+terminalize，未外发→
  terminalize。
- **`AuthDataSourceConfig`**：assembler bean +externalProtocol(`@Value`)；handler bean +ObjectProvider；**不装**
  AuthorizationSnapshotProvider bean（external 运行期不激活）。
- **`application.yaml`**：+`virtual-companion.external-attempt.protocol`（assembler 消费；snapshot 相关配置留 TASK-0178）。
- **DB test 67**：superuser 预置 dual snapshot → `record_provider_attempt('SUCCEEDED')` → `insert_candidate` →
  `promote FINAL_REVIEW` → `finalize_generation(真实 token)` → 断言 COMPLETED + provider_attempt 1 行 SUCCEEDED
  绑双 snapshot + usage 真实 token + 非空 provider_ref + quota SETTLE；负测 record_provider_attempt 未知 snapshot
  → FK 拒绝。

## 范围内

1. **`GenerationFinalizeService.java`（修改）**：
   - `long recordProviderAttempt(owner, gen, providerId, supplierName, status, reqSnap, execSnap)` →
     `SELECT out_id FROM vc.record_provider_attempt(?, ?, ?, ?, ?, ?, ?)`（V20）。
   - `void finalizeCompletedWithUsage(owner, gen, candidateId, content, providerRef, inputTokens, outputTokens,
     actualCost, currency, quotaAmount, outboxEligible)` → V7 全参数（fault=NULL）。
   - `requireNonBlank` 辅助。
2. **`AuthorizationSnapshotProvider.java`（新接口）**：`SnapshotIds createFor(long, long)` + `record SnapshotIds(req, exec)`；
   javadoc 明示「seam only，无运行期 bean，需 TASK-0178 create-snapshot SD 函数」。
3. **`LiveInvocationAssembler.java`（修改）**：+`externalProtocol`(ModelProtocol) ctor 参数；
   `assembleExternal` 建 `RoutingRequest(simulated entitlement, 配置 protocol, 空 caps, reqSnap, execSnap,
   zeroLlmSourceId fallback, fence)` + `LiveInvocationRequest(空 hardRules, adequate ClassifierReport)`。
4. **`GenerationWorkItemHandler.java`（修改）**：+`ObjectProvider<AuthorizationSnapshotProvider>`；handle 分支：
   invoker null→FAILED_FINAL("model-providers-disabled")；snapshotProvider 可用→completeViaExternal；否则
   completeViaZeroLlm（0176 既有）。completeViaExternal：createFor→assembleExternal→invoke→SUCCEEDED 走
   finalizeExternalSuccess(record+insert+promote+finalizeWithUsage)；degraded 外发→recordExternalAttempt+
   terminalizeAsFailed("external-"+terminal)；未外发→terminalizeAsFailed。
5. **`AuthDataSourceConfig.java`（修改）**：liveInvocationAssembler +`@Value externalProtocol`；workItemHandler
   +`ObjectProvider<AuthorizationSnapshotProvider>`；**不装** AuthorizationSnapshotProvider bean。
6. **`application.yaml`（修改）**：+`virtual-companion.external-attempt.protocol`（默认 OPENAI_CHAT_COMPLETIONS）。
7. **DB test 67（新）**：见上「用户可观察结果」。
8. **Java 测试**：`GenerationWorkItemHandlerTest`+3 external 场景（SUCCEEDED/safety-block/provider-failure）；
   `LiveInvocationAssemblerTest`+assembleExternal 场景。
9. 终态治理闭环：run-rls-tests.sh（含 test 67，67/67）+ runtime 定向测试 + git diff --check + 结构化 review-r1 +
   Evidence/Handoff + 单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **运行期 authorization_snapshot 创建**（V16 撤 vc_api INSERT 权限；无 create-snapshot SD 函数；需 C4 migration）→
  TASK-0178。本卡 AuthorizationSnapshotProvider 仅接口 seam，无运行期 bean。
- **真实 loopback adapter e2e**（无 fake adapter 接受 ExternalAttemptBinding；`service/adapters/**` 禁改）→ TASK-0178+。
- **真实外部模型调用 / 真实凭据**（Alpha FORBIDDEN；需 GATE-LIVE-MODEL-PROVIDER 解锁 TASK-0035）。
- **真实安全分类器接入**（本卡用 adequate ClassifierReport 让 SafetyGate ALLOW；与 ZERO_LLM 同构造）。
- **memory.extract outbox 消费**（external finalize `outbox_eligible=false`，避免悬挂 outbox；memory Java 域未接）。
- **modelruntime/safety/adapters 源码改动、新 DB migration、catalog/contract/OpenAPI 改动、ID hashid、重试/死信、
  realtime SSE、listMessages/cancel/relationship 端点**。
- **doctor/precheck/完整 unittest/根级 mvn verify**（Owner 2026-08-12 static-gates-only 策略 deferred）。

## 输入和前置条件

- Base `885b5e262f97f8773a0b6b5ea5ed835cc7445fc7` = TASK-0176 ACCEPTED terminal（已 push、HEAD==origin/main、0/0、clean；
  nextAction 三处 sha256 `1f59253d...` 一致）。
- DRAFT 前已复核：LiveModelInvoker.invokeExternal 已完整实现且不做 DB 写；record_provider_attempt 权威签名是 V20
  7 参数版；V16 撤销 vc_api 对 authorization_snapshot 的直写权限且无 create-snapshot SD 函数（JdbcAuthorizationSnapshotStore
  自述 persistence skeleton）；无 loopback adapter 接受 ExternalAttemptBinding。
- context lock 输入钉在 Base（124 inputs = 123 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `ef5dec13...` 由复刻
  verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0176 `f0716ba0...` 通过，再生 0177）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack
  （pgvector/pgvector:0.8.5-pg18 digest-pinned）。

## API / 事件 / 数据契约

- 产品 API 不变（无新端点、无新错误码、不改 OpenAPI）。external 持久化/审计链是 worker 内部行为。
- 数据契约：复用既有 SD 函数（V20 record_provider_attempt / V15 insert_generation_candidate / V7 finalize_generation /
  V25 promote_generation），不新增表/列/约束/角色/状态/事件。external finalize 写真实 token usage、SETTLE quota、
  chat.completed realtime（V7 既有）、不写 outbox（p_outbox_eligible=false）。record_provider_attempt 写 provider_attempt
  行绑双 snapshot id（V20 composite FK 强制 INV-AUTH-001）。
- `finalizeCompletedWithUsage` 的 providerRef=audit.providerAttemptId()（非空，真实外发 attempt 标识）。

## 权限、RLS 和数据处理要求

- 全部 SD 函数调用复用既有 vc_api EXECUTE 授权（V7/V15/V20/V25 已 GRANT）；无新增授权、无 REVOKE、无新角色。
- handler 运行在 worker 的 owner-bound 事务内（coordinator claimed + 绑 `vc.owner_user_id` + `vc.job_fence`）。
- **authorization_snapshot 行由 DB test superuser 预置**（V16 后 vc_api 不可直写）；运行期等价写入需 TASK-0178
  create-snapshot SD 函数。record_provider_attempt 是 SECURITY DEFINER（postgres 拥有，GRANT vc_api），其内部
  INSERT 绕过 vc_api 直写限制——与 provider_attempt 同模式。
- 日志不含 payload/token/fence/消息内容/snapshot id（只记 generationId/ownerId/terminal）。

## 状态机和失败行为

- external SUCCEEDED 链：`CREATED →(promote) IN_PROGRESS → record_provider_attempt(SUCCEEDED) → insert_candidate →
  (promote) FINAL_REVIEW → finalize(真实 token) → COMPLETED`。任一 SD 函数 RAISE → handler catch →
  safeTerminalize FAILED_FINAL + rethrow。
- degraded（generation 在 IN_PROGRESS）：SUCCEEDED 以外的终态 → FAILED_FINAL（V15 `FAILED_FINAL ← IN_PROGRESS` 合法）。
  FAILED/TIMED_OUT/CANCELLED（audit 非空，已外发）先 record_provider_attempt(映射 status) 再 terminalize；
  BLOCKED_BY_SAFETY/AUTH/NO_ELIGIBLE（audit 空，未外发）直接 terminalize（不 record）。
  注：V15 `OUTPUT_BLOCKED` 仅从 `FINAL_REVIEW`（external 路径不触达，safety/auth 否决发生在 IN_PROGRESS）→
  本卡不引入 OUTPUT_BLOCKED，统一 FAILED_FINAL。
- invoker bean 缺失 → FAILED_FINAL("model-providers-disabled")（0176 既有，保留）。
- snapshotProvider 缺失（运行期常态）→ completeViaZeroLlm（0176 既有，保留）。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及真实模型/Prompt。external 路径的 SafetyGate 输入是 adequate ClassifierReport（CLASSIFIED, 0.80）+ 空 hardRules
→ ALLOW（与 ZERO_LLM 同构造；真实分类器是独立 safety 工作）。本卡不实际外发（无 loopback adapter；Alpha FORBIDDEN）。
不写 Canonical Memory（finalize outbox_eligible=false）。不读凭据、不外发。

## 验收标准

1. `GenerationFinalizeService.recordProviderAttempt` 正确调用 V20 7 参数 record_provider_attempt；
   `finalizeCompletedWithUsage` 正确调用 V7 全参数 finalize（DB test 67 实证）。
2. `AuthorizationSnapshotProvider` 接口存在且 javadoc 明示 seam-only/需 TASK-0178；**无运行期 bean**（runtime
   context 启动不要求该 bean；external 分支仅 ObjectProvider 依赖）。
3. `LiveInvocationAssembler.assembleExternal` 产出 simulated entitlement + 双 snapshot id + 配置 protocol + ZERO_LLM
   fallback source + fence；messages 非空 ≤64（单测）。
4. `GenerationWorkItemHandler`：snapshotProvider 可用且 SUCCEEDED→finalizeExternalSuccess；provider-failure→record+
   terminalize；safety-block→terminalize（无 record）；snapshotProvider 缺失→ZERO_LLM 既有路径；invoker 缺失→
   FAILED_FINAL（单测 8 场景）。
5. DB test 67：COMPLETED + provider_attempt 1 行 SUCCEEDED 绑双 snapshot + usage 真实 token(42/58) + 非空
   provider_ref + quota SETTLE；run-rls-tests.sh 67/67 PASS。
6. `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（0 failure，0 skip）。
7. `git diff --check` exit 0。
8. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
   runtime snapshot 创建 + loopback adapter e2e deferred TASK-0178。
9. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次含 test 67；runtime 模块定向测试一次；
同一无参 `git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py --task TASK-0177`）
与完整 Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 回滚或前向修复

- 若 runtime 单测暴露 handler/assembler 装配问题：最多 1 fix batch 修 runtime/persistence 代码。
- 若 DB test 67 暴露 SD 函数组合问题（非本卡新增函数）：记录为 SD 函数已定行为，调整 test 67 断言（不改 migration）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须触碰 modelruntime/safety 源码或新 migration 或非 writeAllowlist 路径：立即停止申请范围升级。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（含 modelruntime/safety/adapters/migration/specs/harness 等）。
- run-rls-tests.sh / runtime 定向测试 / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0177/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0177.json`。
