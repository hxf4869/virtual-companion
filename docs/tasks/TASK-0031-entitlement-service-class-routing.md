# TASK-0031：模拟权益、Service Class 与确定性路由

```yaml
taskId: TASK-0031
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: d9b3baba3e5803eb50c54fd55b5eccd6223ab5898c2b211b3b83d3e1be72ab6a
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 1a55e8fd51007e0e98c8ace506736e8b00ac6ad1
authorizationCommit: ""
contextFingerprint: eab9adb64933b6d08cb044480f4555fa4e6bf6048af6fc3883425724f03dbeb4
contextLock: docs/tasks/context/TASK-0031.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0031_ENTITLEMENT_SERVICE_CLASS_ROUTING
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0031-entitlement-service-class-routing.md
  - docs/tasks/TASK-0022-fake-failure-offline-e2e-slice.md
  - docs/tasks/TASK-0019-context-plan-persona-listen-discuss.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/route-decision-statuses.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/RouteDecisionStatus.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderDeployment.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderRegistration.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/ProviderId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/AdmissionStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/QuotaAction.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - docs/evidence/TASK-0022/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0031-entitlement-service-class-routing.md
  - docs/tasks/context/TASK-0031.context-lock.yaml
  - docs/evidence/TASK-0031/**
  - docs/handoffs/TASK-0031.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/ServiceClass.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/Entitlement.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaReservation.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RoutingRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RouteDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DecisionHash.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DeterministicRouter.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/DeterministicRouterTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/QuotaLedgerTest.java
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
  - specs/**
  - frontend/**
  - deploy/**
  - ops/**
  - docs/source/**
  - db/**
  - infra/**
  - service/adapters/**
  - service/apps/**
  - service/platform/**
  - service/modules/conversation/**
  - service/modules/safety/**
  - service/tests/**
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/**
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
  - skills/model-routing-change/SKILL.md
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-COST-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0031 在 service/modules/modelruntime/routing 建立模拟权益、
      Service Class、额度预留与供应商中立确定性路由。新建 routing 包（ServiceClass/Entitlement/
      QuotaReservation/QuotaLedger/RoutingRequest/RouteDecision/DecisionHash/DeterministicRouter）
      及 JUnit 单测；经 ProviderRegistry.deployments() 选部署、为外发尝试产出携带双授权快照的
      ExternalAttemptBinding（供 ExecutionAuthorizationGuard 执行期授权）、为 ZERO_LLM 降级产出
      DeterministicSourceBinding（不创建 provider_attempt）。纯领域 Java、无数据库迁移、无真实支付或
      订阅或 Provider 或凭据；同一输入确定性产出可审计 decisionNo 与 NO_ELIGIBLE_DEPLOYMENT；不绕过
      Registry 或 Guard、不绑定具体模型、不拼接多 Attempt 输出。model-routing-change 为
      independentReview（非 humanApproval）保护路径，由独立 R1 复核。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0031
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在 `service/modules/modelruntime/routing` 建立供应商中立的模拟权益（Entitlement）、Service Class、额度预留（Quota Reservation）与确定性路由决策（Route Decision）。给定相同输入（ownership、服务等级、请求协议/能力、注册表状态、额度状态）产生相同路由选择与可审计的不可变 `decisionNo`；在无合格部署时确定性给出 `NO_ELIGIBLE_DEPLOYMENT`。路由必须经 Provider Registry 选部署、经 Execution Authorization Guard 的绑定契约外发，不得绕过二者。

## 范围内

- 新建 `com.virtualcompanion.modelruntime.routing` 包：`ServiceClass`（供应商中立服务等级，只携带降级/外发策略标志，绝不绑定具体模型或供应商）、`Entitlement`（owner 的活跃权益快照）、`QuotaReservation` 与 `QuotaLedger`（合成额度预留，失败关闭）、`RoutingRequest`、`RouteDecision`（携带确定性 `decisionNo` 与 `RouteDecisionStatus`）、`DecisionHash`（确定性 SHA-256 审计摘要）、`DeterministicRouter`。
- `DeterministicRouter` 经 `ProviderRegistry.deployments()` 选部署（admitted + 协议 + 能力匹配后按 `ProviderId.value()` 稳定全序取首），为外发部署产出 `ExternalAttemptBinding`（携带 requested + execution 授权快照 ID，供 ExecutionAuthorizationGuard 在执行期授权），为 ZERO_LLM 降级产出 `DeterministicSourceBinding`（不创建 provider_attempt）。
- 合成 Fake/Failure/ZERO_LLM 候选与服务降级：Service Class 控制是否允许外发尝试与是否允许 ZERO_LLM 兜底；降级链确定性（外发部署 → ZERO_LLM），无随机隐藏 fallback。
- 纯领域 Java 单测（JUnit 5）：确定性、稳定选序、`NO_ELIGIBLE_DEPLOYMENT`、协议/能力/准入过滤、ZERO_LLM 降级、Service Class 策略、额度预留与失败关闭、外发绑定双快照、`decisionNo` 可复算与互异、ZERO_LLM 不产 provider_attempt、不绕过 Registry。

## 明确禁止

- 真实支付、真实订阅、真实 Provider 或真实凭据；权益/额度不得成为付费前置（INV-COST-001）。
- Service Class 绑定具体模型、模型名或供应商身份；不得绕过授权、区域或 Execution Authorization Guard（INV-AUTH-001）。
- 非确定性隐藏 fallback；同一输入不得产生不同路由或 `decisionNo`。
- 路由绕过 Provider Registry（不得发明未注册部署）或 Execution Authorization Guard（外发尝试必须经绑定携带双快照）。
- 把多 Attempt 输出拼接为一个可见响应（INV-GEN-002）；ZERO_LLM 创建 provider_attempt。
- 改动 modelruntime 的 contract/port/guard/registry/authorization 子包、其测试、pom.xml 或任何 specs/generated 生成物。

## 依赖与决策闸门

- 依赖：TASK-0013（REJECTED，由后继 TASK-0081 Provider Registry ACCEPTED 满足）、TASK-0018（ACCEPTED，finalize 证明原子终态与额度结算语义）、TASK-0022（ACCEPTED，离线纵切证明 Guard→Adapter→Reducer 接线与 DeterministicSourceBinding/ExternalAttemptBinding 双绑定）。
- 无独立硬决策闸门。

## 验收

- 确定性：同一 `RoutingRequest` + 同一注册表/额度状态重复调用 `DeterministicRouter.decide` 产生 byte-for-byte 相同的 `decisionNo`、相同 `status`、相同选中部署/绑定（`decisionNo` 由决策自身字段可复算）。
- 稳定选序：当多个 admitted 部署匹配协议与能力时，按 `ProviderId.value()` 确定性取首，与注册顺序或迭代顺序无关。
- `NO_ELIGIBLE_DEPLOYMENT`：无 admitted 匹配部署、或外发类缺失双授权快照、或额度不足且不允许 ZERO_LLM 兜底时，`status=NO_ELIGIBLE_DEPLOYMENT` 且无绑定/预留。
- 经 Registry：选中部署恒为 `registry.deployments()` 的成员，绝不发明。
- 经 Guard（结构）：外发尝试产出 `ExternalAttemptBinding` 携带 requested + execution 授权快照 ID（INV-AUTH-001）；ZERO_LLM 产出 `DeterministicSourceBinding` 且不创建 provider_attempt。
- 额度失败关闭：外发预留不足时降级或 `NO_ELIGIBLE_DEPLOYMENT`，绝不预留负值或绕过预留。
- 降级确定性：Service Class 策略（外发允许 / ZERO_LLM 允许）唯一决定降级路径，无随机兜底。

## 晋级规则

全部依赖 ACCEPTED 且执行顺序允许时，才基于最新 main 创建唯一 DRAFT；具体 Base、Context、白名单、精确命令与 Skill 版本在该时点锁定。
