# TASK-0176：Generation ZERO_LLM 确定性完成路径接线（handler 走 LiveModelInvoker.invoke ZERO_LLM 分支 → finalize COMPLETED；ZeroLlm-only bean 装配 + LiveInvocationRequest assembler + finalize 服务 + DB test 66）

```yaml
taskId: TASK-0176
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
baseCommit: 04523bd539dd7550389eb81c94ef1a9576d62854
authorizationCommit: "plan-approved-2026-08-12-generation-zero-llm-completion"
contextFingerprint: f0716ba062a9c3e6d268ea05aad3062bf4a842757f43b69b8a04a47f5ed84587
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0176.context-lock.yaml
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
  surfaceId: TASK_0176_GENERATION_ZERO_LLM_COMPLETION
  policySurfaces: [BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 15
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - pom.xml
  - service/apps/runtime/pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - infra/db/run-rls-tests.sh
  - docs/tasks/TASK-0174-generation-http-vertical-slice.md
  - docs/tasks/context/TASK-0174.context-lock.yaml
  - docs/evidence/TASK-0174/evidence-pack.json
  - docs/evidence/TASK-0174/review-r1.md
  - docs/handoffs/TASK-0174.json
  - docs/tasks/TASK-0175-task0174-governance-remediation.md
  - docs/evidence/TASK-0175/evidence-pack.json
  - docs/handoffs/TASK-0175.json
  - infra/db/tests/58_admin_seed_concurrent.sql
  - infra/db/tests/63_worker_runtime_role_claim_complete.sql
  - infra/db/tests/65_generation_intake_workitem_promotion.sql
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptTerminal.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/AdapterLocator.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/InMemoryAdapterLocator.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RoutingRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DeterministicRouter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/Entitlement.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/ServiceClass.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RouteDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/ClassifierReport.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/DeterministicSafetyResponse.java
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationStateService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LoggingWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemCoordinator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/WorkItemWorker.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ZeroLlmModelRuntimeConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/LiveInvocationAssembler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandler.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationFinalizeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - infra/db/tests/66_generation_zero_llm_completed_chain.sql
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/GenerationWorkItemHandlerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/LiveInvocationAssemblerTest.java
  - docs/tasks/TASK-0176-generation-zero-llm-completion.md
  - docs/tasks/context/TASK-0176.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0176/**
  - docs/handoffs/TASK-0176.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-5]-*
  - docs/tasks/context/TASK-017[0-5].context-lock.yaml
  - docs/evidence/TASK-017[0-5]/**
  - docs/handoffs/TASK-017[0-5].json
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
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemEnqueueService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationCreateService.java
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V2[0-5]__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviders.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReader.java
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
  - infra/db/tests/6[0-5]_*.sql
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
  - docs/handoffs/TASK-0174.json
  - docs/handoffs/TASK-0175.json
requiredInvariants:
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
      Owner 2026-08-12 长线授权继续 generation 纵切（一次一张新卡，idle DRAFT 治理例外）。TASK-0174 已打通
      generation HTTP→work_item→handler→terminalize FAILED_FINAL→snapshot 降级链路（V25 create_conversation/
      enqueue_work_item/promote_generation + 3 persistence service + 2 HTTP 端点 + GenerationWorkItemHandler），
      但所有 generation 终态都是 FAILED_FINAL——真实模型调用未接线。本卡 TASK-0176 接线 ZERO_LLM 确定性
      完成路径：当 zero-llm.enabled=true 且 model-providers.enabled=false 时，新 ZeroLlmModelRuntimeConfig
      用空 InMemory* 协作者装配 LiveModelInvoker bean（modelruntime 库已完整实现 invoke→router.decide→
      DeterministicSourceBinding→recovery.completeZeroLlm→zeroLlmCompleted 路径，全部协作者经逐类型核实可空
      装配），handler 走 invoke ZERO_LLM 分支拿到确定性输出（DeterministicSafetyResponse.ZERO_LLM_FALLBACK），
      经 promote→FINAL_REVIEW→insert_generation_candidate→finalize_generation 落为 COMPLETED。复用既有 V7/V15/V25
      SD 函数（均已 GRANT vc_api），不新增 migration、不改 modelruntime/safety 源码。真实外部 provider 成功
      路径（auth snapshot/safety 流水线/adapter 装配）留 TASK-0177+。Owner 在本会话确认选卡（ZERO_LLM
      确定性完成路径）与部署形态（独立 zero-llm.enabled 开关，互斥 model-providers.enabled）。开卡前已用
      当前 HEAD（04523bd）核实：handler 当前恒 terminalize FAILED_FINAL；LiveModelInvoker bean 仅在
      ApprovedModelProviderConfig（model-providers.enabled=true）下存在，默认 false 时 ObjectProvider 返回 null。
independentReview: not-required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation 纵切的
> ZERO_LLM 确定性完成路径卡，承接 TASK-0174（降级链路）与 TASK-0175（治理补救），沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0153..0175
> 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何保护路径**：`service/modules/modelruntime/**`(C3)、
> `**/db/migration/**`(C4)、`service/**/safety/**`(C4) 均不改——只消费 modelruntime/safety 公共 API +
> 复用既有 SD 函数；全部产出落在 `service/apps/runtime/**` + `service/platform/persistence/**`
> （非保护路径）+ 治理文档。INV-TX-001/GEN-002/GEN-003 执行点在 V7 SD 函数层（未改），handler 是新
> 调用方。故 riskClass=C2，independentReview=not-required（仍按长线惯例产出 review-r1）。

## 背景与用户可观察目标

TASK-0174 打通了 generation 端到端可观察降级链路，但 handler 把每个 claimed generation 都
`terminalize FAILED_FINAL`——真实模型调用（`LiveModelInvoker.invoke`）未接线。本卡接线 **ZERO_LLM
确定性完成路径**：在配置启用时，handler 走真实 `LiveModelInvoker.invoke` 的 ZERO_LLM 分支，把确定性
安全降级输出 finalize 为 `COMPLETED`，产出一个真实可观察的成功 generation（无需真实 provider、
外部 auth snapshot 或 adapter）。

当前 HEAD（04523bd）事实（代码核实）：

1. `LiveModelInvoker.invoke(LiveInvocationRequest)`（modelruntime 库）已完整实现 ZERO_LLM 分支：
   `router.decide(routingRequest)` → 当 `entitlement.serviceClass().zeroLlmFallbackAllowed()==true`
   且 `zeroLlmSourceId` 非空时选 `DeterministicSourceBinding` → `recovery.completeZeroLlm` →
   `LiveAttemptOutcome.zeroLlmCompleted`，其 `response()` = `DeterministicSafetyResponse.ZERO_LLM_FALLBACK`
   （"I'm not able to help with that. Let's talk about something else."）。
2. **核心缺口**：modelruntime 模块零 Spring bean；`LiveModelInvoker`/`DeterministicRouter`/
   `GenerationRecovery`/`QuotaLedger` 全部由 `ApprovedModelProviderConfig` 装配，整体 gated 在
   `model-providers.enabled=true`（默认 false）。无 ZERO_LLM-only 子集配置 → handler 的
   `ObjectProvider<LiveModelInvoker>.getIfAvailable()` 返回 null → 只能降级 FAILED_FINAL。
3. **全部协作者可空装配**（逐类型核实）：`InMemoryProviderRegistry()`（空 deployments，router 的
   `tryExternal` 因 `ServiceClass.zeroLlmOnly().externalAttemptAllowed()==false` 永不进入）、
   `InMemoryAdapterLocator(List.of())`、`InMemoryAuthorizationSnapshotStore()`、`new QuotaLedger()`
   （ZERO_LLM 无 reservation 时 `releaseIfPresent(null)` no-op）、`Map.of()` supplierNames。ZERO_LLM
   分支只触 `router.decide` + `recovery.completeZeroLlm`，从不读 adapter/authGuard/snapshotStore/
   supplierNames。→ 无需改 modelruntime/safety 源码。
4. **COMPLETED 落库复用既有 SD 函数**：`promote_generation`(V25) `CREATED→IN_PROGRESS→FINAL_REVIEW` +
   `insert_generation_candidate`(V15) + `finalize_generation`(V7)，均已 GRANT vc_api。无需新 migration。
5. `finalize_generation`（V7）要求 generation 在 `FINAL_REVIEW` 且有 candidate 行；原子写 final message
   + COMPLETED + assistant_message_id + usage(0 token) + quota SETTLE(0) + chat.completed realtime +
   可选 outbox。`p_outbox_eligible=>false` 抑制 ZERO_LLM 固定串的 memory.extract 候选（INV-MEM 语义）。
6. fence：`WorkItemClaim` 无 fence 字段；V17 `claim_work_items` 用
   `set_config('vc.job_fence', p_fence, true)` 事务内绑定；`RoutingRequest.fence` 是 `long ≥0`，ZERO_LLM
   下仅折入 `RouteDecision.computeDecisionNo`（审计/身份），不 gate 外部会话 → 读 GUC 的 UUID 串派生
   非负 long（`Math.abs(UUID.getMostSignificantBits())`），缺省回落 0。
7. ownership 两跳：`GenerationRepository.find`→`conversationId`；`ConversationRepository.find`→
   `relationshipId`；`OwnershipTuple` 四字段均 String。

用户可观察结果（本卡完成后）：

- **`ZeroLlmModelRuntimeConfig`**：新 `@Configuration`，`zero-llm.enabled=true` 且
  `model-providers.enabled!=true` 时装配 ZERO_LLM-only `LiveModelInvoker` bean（空协作者）；真实 provider
  启用时本配置不激活（互斥，无 bean 冲突）。
- **`GenerationWorkItemHandler`**：invoker 可用时走 ZERO_LLM→COMPLETED；不可用时保留既有 FAILED_FINAL
  降级。COMPLETED 链：promote IN_PROGRESS → assemble request → invoke →
  （ZERO_LLM_COMPLETED）insert candidate(确定性串) → promote FINAL_REVIEW → finalize COMPLETED。
- **`LiveInvocationAssembler`**：装配 ZERO_LLM-tuned `LiveInvocationRequest`（ownership 两跳 + messages
  + fence GUC + zeroLlmOnly entitlement + ZERO_LLM protocol + 配置 sourceId）。
- **`GenerationFinalizeService`**：封装 `insert_generation_candidate`/`finalize_generation`/
  `terminalize_generation` 三 SD 函数调用。
- **`MessageRepository.listByConversation`**：新增（RLS select，取最近 N 条防溢出）。
- **DB test 66**：实证 SD 函数 COMPLETED 全链路（create_conversation→receive→promote→insert_candidate→
  finalize）→ generation.status='COMPLETED' + 唯一 final message + 无 provider_attempt 行。
- **Java 测试**：handler test 重写（ZERO_LLM COMPLETED happy path + unexpected-outcome FAILED + 既有
  skip/disabled/exception）+ assembler test。

## 范围内

1. **`ZeroLlmModelRuntimeConfig.java`（新增，`runtime.modelproviders` 包）**：
   - `@Configuration` + 互斥条件（`zero-llm.enabled=true` 且 `model-providers.enabled!=true`；若
     `@ConditionalOnProperty` 叠注有疑义则改 10 行自定义 `Condition`）。
   - 装 bean：`QuotaLedger`、`InMemoryAuthorizationSnapshotStore`、`InMemoryProviderRegistry`、
     `InMemoryAdapterLocator(List.of())`、`ExecutionAuthorizationGuard(store, registry)`、
     `DeterministicRouter(registry, quotaLedger)`、`GenerationRecovery(quotaLedger)`、
     `LiveModelInvoker(router, guard, store, locator, recovery, Map.of())`。
2. **`LiveInvocationAssembler.java`（新增，`runtime.worker` 包）**：
   - `LiveInvocationRequest assemble(long ownerUserId, long generationId)`：
     - ownership 两跳：`generationRepository.find`→conversationId；`conversationRepository.find`→relationshipId；
       四 ID（ownerUserId/conversationId/relationshipId/generationId）转 String 建 `OwnershipTuple`。
     - messages：`messageRepository.listByConversation` 映射 `ProtocolMessage`（role USER/ASSISTANT→对应，
       SYSTEM→SYSTEM；空列表塞单条占位 USER 消息保证非空，限 64 条）。
     - fence：`jdbcTemplate.queryForObject("SELECT current_setting('vc.job_fence', true)", String.class)`
       → 非空时 `Math.abs(UUID.fromString(s).getMostSignificantBits())`，null/空→0。
     - 建 `RoutingRequest(ownership, new Entitlement(ownerStr, ServiceClass.zeroLlmOnly()),
       ModelProtocol.ZERO_LLM, new ModelProtocolCapabilities(Set.of()), null, null, zeroLlmSourceId, fence)`。
     - 包 `LiveInvocationRequest(routingRequest, messages, new ResponseMode.Text(), false,
       new TimeoutBudget(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)),
       List.of(), new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.80))`。
   - 依赖：GenerationRepository、ConversationRepository、MessageRepository、JdbcTemplate、
     `@Value("${virtual-companion.zero-llm.source-id:ZERO_LLM_FALLBACK}")`。
3. **`GenerationFinalizeService.java`（新增，`platform.persistence` 包）**：
   - `long insertCandidate(long ownerUserId, long generationId, String content)` →
     `SELECT out_candidate_id FROM vc.insert_generation_candidate(?, ?, ?, false)`。
   - `void finalizeCompleted(long ownerUserId, long generationId, long candidateId, String content,
     String providerRef, boolean outboxEligible)` →
     `SELECT vc.finalize_generation(?, ?, ?, ?, ?, 0, 0, 0, 'USD', 0, ?, NULL)`（0 token / SETTLE 0）。
   - `void terminalizeAsFailed(long ownerUserId, long generationId, String fault)` →
     `SELECT vc.terminalize_generation(?, ?, 'FAILED_FINAL', 'chat.failed', jsonb)`（既有降级下沉）。
4. **`MessageRepository.java`（修改）**：新增 `List<Message> listByConversation(long ownerUserId, long
   conversationId)`——`SELECT ... FROM vc.message WHERE owner_user_id=? AND conversation_id=? ORDER BY id
   DESC LIMIT 64`（RLS select，最近 64 条防溢出，反序回正序）。
5. **`GenerationWorkItemHandler.java`（修改，核心重写 handle）**：
   - 新构造：`GenerationStateService`、`GenerationFinalizeService`、`LiveInvocationAssembler`、
     `ObjectProvider<LiveModelInvoker>`（去掉直接 jdbcTemplate）。
   - flow：`if !KIND_GENERATION skip` → `stateService.promote(IN_PROGRESS)` → `invoker=getIfAvailable()`；
     null→`finalizeService.terminalizeAsFailed("model-providers-disabled")`（保留降级）→ 否则
     `request=assembler.assemble(...)`→`outcome=invoker.invoke(request)`；
     `outcome.terminal()==ZERO_LLM_COMPLETED`：`candidateId=finalizeService.insertCandidate(content)`→
     `stateService.promote(FINAL_REVIEW)`→`finalizeService.finalizeCompleted(...content, "", false)`；
     否则 `terminalizeAsFailed("zero-llm-unexpected-outcome:"+terminal)`。`catch RuntimeException`→
     `safeTerminalize("handler-exception")`+rethrow。content = `outcome.response()`。
6. **`AuthDataSourceConfig.java`（修改）**：+ `MessageRepository` bean、`GenerationFinalizeService` bean、
   `LiveInvocationAssembler` bean（注入 GenerationRepository+ConversationRepository+MessageRepository+
   authJdbcTemplate+`@Value zero-llm.source-id`）；`workItemHandler` bean 构造改注入新依赖。
7. **`application.yaml`（修改）**：`virtual-companion.zero-llm: { enabled: ${VC_ZERO_LLM_ENABLED:false},
   source-id: ${VC_ZERO_LLM_SOURCE_ID:ZERO_LLM_FALLBACK} }`（在 `model-providers` 节后）。
8. **DB test 66（新增，`infra/db/tests/66_generation_zero_llm_completed_chain.sql`）**：PL/pgSQL DO 块
   （照 58/63/65 模式）：superuser 建 owner/relationship→`create_conversation`→`receive_generation`→
   `promote_generation IN_PROGRESS`→`promote_generation FINAL_REVIEW`→`insert_generation_candidate`（content
   =ZERO_LLM_FALLBACK 串）→`finalize_generation`（provider_ref=''、0 token、outbox_eligible=false）→断言
   `generation.status='COMPLETED'` + `assistant_message_id` 非空 + 该 generation 唯一 final message +
   `provider_attempt` 0 行（ZERO_LLM 不外发）+ `generation_usage` 1 行 0 token。
9. **Java 测试**：
   - `GenerationWorkItemHandlerTest`（重写）：`skipsNonGenerationItem`（保留）、
     `degradesToFailedWhenProvidersDisabled`（保留，invoker null→FAILED_FINAL）、
     `completesViaZeroLlmWhenInvokerPresent`（替换原 integration-pending；mock invoker 返回
     `zeroLlmCompleted` → 验证 promote IN_PROGRESS、assemble、invoke、insertCandidate、promote
     FINAL_REVIEW、finalizeCompleted 含确定性串）、`terminalizesFailedOnUnexpectedOutcome`（mock 返回
     NO_ELIGIBLE_DEPLOYMENT→FAILED_FINAL）、`promotionFailurePropagatesAndAttemptsTerminalize`（保留，适配）。
   - `LiveInvocationAssemblerTest`（新增）：ownership 两跳、fence GUC 读取、ZERO_LLM request 字段断言、
     空 messages→占位单条。
10. 终态治理闭环：run-rls-tests.sh（含 test 66，66/66）+ runtime 模块定向测试 + git diff --check +
    结构化 review-r1 + Evidence/Handoff + 单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **真实外部 provider 成功路径**（auth snapshot 创建服务 / safety 流水线接入 / adapter 装配 / 真实
  record_provider_attempt）：留 TASK-0177+。ZERO_LLM 不创建 provider_attempt（`zeroLlmCompleted` 的
  audits 为空）。
- **realtime SSE 推送**（SseEmitter + RealtimeResumeService）、**listMessages / cancelGeneration /
  relationship HTTP 端点**。
- **modelruntime/safety 源码改动**、**新 DB migration**、catalog/contract/OpenAPI 改动、ID hashid 编码。
- **重试/死信机制**（FAILED 保持终态，V5/V15 语义不变）。
- **长任务续租 / coordinator 自动 renew**（同 TASK-0173 knownRisk）。
- **真实 provider 与 ZERO_LLM 同时启用**的行为（互斥：model-providers.enabled=true 时 ZeroLlmConfig
  不激活，真实 provider 优先；同时启用不属于本卡验收）。
- 根级 Maven verify 与完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred。

## 输入和前置条件

- Base `04523bd539dd7550389eb81c94ef1a9576d62854` = TASK-0175 ACCEPTED terminal（已 push、
  HEAD==origin/main、0/0、clean；nextAction 三处 sha256 `027ddae4…` 一致）。
- DRAFT 前已复核：handler 当前恒 FAILED_FINAL；LiveModelInvoker bean 仅 model-providers.enabled=true
  下存在；ZERO_LLM 路径与协作者空装配经逐类型核实；finalize/insert_candidate/promote SD 函数签名与
  vc_api 授权确认；fence GUC `vc.job_fence` 由 V17 claim 事务内绑定可读。
- context lock 输入钉在 Base（107 inputs = 106 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1…`）；contextFingerprint `f0716ba0…` 由
  复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0174 `9965b6e6…` 通过，再生 0176）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack
  （pgvector/pgvector:0.8.5-pg18 digest-pinned）。

## API / 事件 / 数据契约

- 产品 API 不变（无新端点、无新错误码、不改 OpenAPI）。ZERO_LLM 完成路径是 worker 内部行为。
- 数据契约：复用既有 SD 函数（V7 finalize_generation / V15 insert_generation_candidate+terminalize /
  V25 promote_generation），不新增表/列/约束/角色/状态/事件。ZERO_LLM finalize 写 0 token usage、
  SETTLE 0 quota、chat.completed realtime（V7 既有）、不写 outbox（p_outbox_eligible=false）。
- `finalizeCompleted` 的 provider_ref=''（ZERO_LLM 无 provider；V7 列 `text NOT NULL`，'' 合法）。

## 权限、RLS 和数据处理要求

- 全部 SD 函数调用复用既有 vc_api EXECUTE 授权（V7/V15/V25 已 GRANT）；无新增授权、无 REVOKE、无新角色。
- handler 运行在 worker 的 owner-bound 事务内（coordinator claimed + 绑 `vc.owner_user_id` +
  `vc.job_fence`），每个 `vc.*` SD 调用在正确 server-trusted tenant context（同 TASK-0174）。
- fence GUC 读取（`current_setting('vc.job_fence', true)`）是同事务内只读，不跨租户、不泄露（fence 不
  进日志，只折入 RouteDecision 审计身份）。
- ZERO_LLM 不外发（无 provider_attempt 行；DB test 66 实证）、不调真实模型、不读真实凭据、不写
  Canonical Memory（outbox_eligible=false）。INV-TENANT-001（运行角色 NO BYPASSRLS）不变。
- 日志不含 payload/token/fence/消息内容（只记 generationId/ownerId/terminal）。

## 状态机和失败行为

- ZERO_LLM COMPLETED 链：`CREATED →(promote) IN_PROGRESS →(invoke zeroLlmCompleted) → insert_candidate
  →(promote) FINAL_REVIEW →(finalize) COMPLETED`。任一 SD 函数 RAISE（状态非法/candidate 缺失/
  finalize race）→ handler catch → safeTerminalize FAILED_FINAL + rethrow（worker 记批次失败）。
- invoker 返回非 `ZERO_LLM_COMPLETED`（如 NO_ELIGIBLE_DEPLOYMENT，仅配错时发生）→ terminalize
  FAILED_FINAL("zero-llm-unexpected-outcome:...")。
- invoker bean 缺失（zero-llm.enabled=false）→ 既有降级 FAILED_FINAL("model-providers-disabled")。
- ZeroLlmConfig 装配异常（Spring 启动）→ 应用启动失败（fail-closed，不静默）。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及真实模型/Prompt。ZERO_LLM 输出是固定安全降级串（`DeterministicSafetyResponse.ZERO_LLM_FALLBACK`，
非模型生成、非自由文本），不经 safety 流水线（ZERO_LLM 路径在 invoker 内不触 SafetyGate——仅 external
分支触）。不写 Canonical Memory（finalize outbox_eligible=false，固定串不产生 memory 候选；INV-MEM-001/
002 不受影响）。不读凭据、不外发、不写 provider_attempt。

## 验收标准

1. `ZeroLlmModelRuntimeConfig`：`zero-llm.enabled=true` 且 `model-providers.enabled!=true` 时装配
   `LiveModelInvoker` bean（空 InMemory* 协作者）；`model-providers.enabled=true` 时不激活（无 bean
   冲突，`ApprovedModelProviderDisabledTest` 等既有测试仍 PASS——默认 zero-llm.enabled=false）。
2. `GenerationWorkItemHandler`：invoker 可用且返回 `ZERO_LLM_COMPLETED` 时产 COMPLETED；invoker 缺失
   时 FAILED_FINAL("model-providers-disabled")；非 ZERO_LLM 终态时 FAILED_FINAL。
3. `LiveInvocationAssembler`：装配的 `RoutingRequest` 含 `zeroLlmOnly` entitlement、配置 sourceId、
   fence(≥0)、两 null snapshotId；messages 非空 ≤64。
4. `GenerationFinalizeService`：insertCandidate/finalizeCompleted/terminalizeAsFailed 正确调用三 SD 函数。
5. `MessageRepository.listByConversation`：返回 owner+conversation 范围消息（RLS）。
6. `application.yaml`：新增 `virtual-companion.zero-llm.{enabled,source-id}` 节。
7. DB test 66：finalize 后 generation.status='COMPLETED' + assistant_message_id 非空 + 唯一 final
   message + provider_attempt 0 行 + usage 1 行 0 token；run-rls-tests.sh 66/66 PASS。
8. `GenerationWorkItemHandlerTest` 覆盖 skip/disabled/completed-via-zero-llm/unexpected-outcome/exception
   5 场景；`LiveInvocationAssemblerTest` 覆盖 ownership 两跳/fence/messages；runtime 模块测试全 PASS。
9. `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（0 failure，0 skip）。
10. `git diff --check` exit 0。
11. Evidence 如实标注 canonical precheck / 完整 unittest discover deferred per Owner static-gates-only；
    real external provider path deferred TASK-0177+。
12. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（run-rls-tests.sh 一次含 test 66；runtime 模块定向测试
一次；同一无参 `git diff --check` 一次）。canonical precheck（`python scripts/harness/precheck.py
--task TASK-0176`）与完整 Harness unittest、根级 Maven verify 按 Owner 2026-08-12 static-gates-only
策略 deferred to 统一全项目复审。

## 回滚或前向修复

- 若 runtime 单测暴露 handler/assembler/config 装配问题：最多 1 fix batch 修 runtime/persistence 代码。
- 若 DB test 66 暴露 SD 函数组合问题（非本卡新增函数）：记录为 SD 函数已定行为，调整 test 66
  断言或 test 66 本身（不改 V1-V25 migration）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须触碰 modelruntime/safety 源码或新 migration 或非 writeAllowlist 路径：立即停止，向
  Owner 申请范围升级（自批禁止）。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 modelruntime/safety 源码、
  V1-V25 migration、.harness/** 除 project-state/task-ledger、specs、application.yaml 既有节、
  既有 persistence/runtime 文件等）。
- run-rls-tests.sh / runtime 定向测试 / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 Evidence/Handoff/pre-closure/
  终态提交/push/远端 0/0 的 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0176/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0176.json`。
