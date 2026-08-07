# TASK-0032：最小 ZERO_LLM、额度释放与全故障恢复

```yaml
taskId: TASK-0032
state: IN_PROGRESS
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
planningContractHash: ca5e005fdf2d0d066a4d5fdfc3c220088eb85883d0622cd54bcab8d9f0324f81
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: a44817567d50365c2514785b179037522e6eb17b
authorizationCommit: 10c308f35edb8364345fb802c39e0813e163eb76
contextFingerprint: cd3411f2ceff287a76d7a5a62ec998ae86b797b75ecb69605b71625f595b4430
contextLock: docs/tasks/context/TASK-0032.context-lock.yaml
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
  surfaceId: TASK_0032_ZERO_LLM_QUOTA_FAILURE_RECOVERY
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
  - docs/tasks/TASK-0032-zero-llm-quota-failure-recovery.md
  - docs/tasks/TASK-0031-entitlement-service-class-routing.md
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
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/route-decision-statuses.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - specs/generated/java/com/virtualcompanion/catalog/RouteDecisionStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/GenerationState.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaReservation.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RouteDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DeterministicRouter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RoutingRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/Entitlement.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/ServiceClass.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DecisionHash.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/safety/pom.xml
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/DeterministicSafetyResponse.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyVerdict.java
  - docs/evidence/TASK-0031/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0032-zero-llm-quota-failure-recovery.md
  - docs/tasks/context/TASK-0032.context-lock.yaml
  - docs/evidence/TASK-0032/**
  - docs/handoffs/TASK-0032.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryScenario.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaDisposition.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryTerminal.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/GenerationRecoveryTest.java
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
  - specs/contracts/safety-fail-closed-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-AUTH-001
  - INV-TENANT-001
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
      长线执行 Owner 授权 TASK-0032 在 service/modules/modelruntime/routing 之上实现最小 ZERO_LLM
      执行、合成额度释放与全故障恢复。扩展 QuotaLedger.release（原子归还）+ 新增
      RecoveryScenario/QuotaDisposition/RecoveryTerminal/RecoveryOutcome/GenerationRecovery；4 失败场景
      （TIMEOUT/CANCELLED/NO_CAPACITY/ALL_FAILURE）正确释放或结算额度；ZERO_LLM 完成路径无
      provider_attempt、消费 DeterministicSafetyResponse 确定性响应；全故障绝不自由文本。modelruntime
      pom 新增 safety 依赖（acyclic，safety 仅依赖 catalog）。纯领域 Java、无数据库迁移、无真实
      Provider 或付费；保持稳定 generationId 与唯一终态、不绕过最终安全复核。model-routing-change 为
      independentReview（非 humanApproval）保护路径，由独立 R1 复核。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0032
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在 `service/modules/modelruntime/routing` 之上实现最小 ZERO_LLM 执行、合成额度释放、失败终态与全 Provider 故障恢复。超时、取消、无容量和全故障均正确释放或结算额度；恢复路径保持稳定 `generationId` 与唯一终态。ZERO_LLM 执行不创建 `provider_attempt`，输出安全确定性响应（消费 TASK-0020 的 `DeterministicSafetyResponse`），全故障绝不输出未经审查的自由文本。

## 范围内

- `QuotaLedger.release(owner, units)`：原子归还额度（镜像 reserve 的 compute 语义，失败关闭、不可超还）。
- 新增 `RecoveryScenario`（TIMEOUT/CANCELLED/NO_CAPACITY/ALL_FAILURE）、`QuotaDisposition`（RELEASED/SETTLED/NONE）、`RecoveryTerminal`（路由级唯一终态）、`RecoveryOutcome`（携带稳定 ownership/generationId + 终态 + 额度处置 + 确定性响应）、`GenerationRecovery` 服务。
- `GenerationRecovery`：对 4 个失败场景产出正确额度处置（TIMEOUT/CANCELLED/ALL_FAILURE → RELEASE；NO_CAPACITY → NONE 无预留可还）与唯一终态；ZERO_LLM 完成路径无 `provider_attempt`、消费 `DeterministicSafetyResponse.ZERO_LLM_FALLBACK`、归还既有预留；全故障 → 安全 BLOCK 确定性响应，绝不自由文本。
- modelruntime pom 新增 `virtual-companion-safety` 依赖（acyclic：safety 仅依赖 catalog），使 recovery 直接引用安全审查后的确定性常量（类型级保证，非自由文本）。
- 扩展 `QuotaLedgerTest`（release）+ 新增 `GenerationRecoveryTest`（4 场景 + ZERO_LLM + 稳定 generationId + 唯一终态 + 无 provider_attempt + 不绕过安全）。

## 明确禁止

- ZERO_LLM 创建 `provider_attempt`（INV-AUTH-001 / generation-contract：ZERO_LLM 是 DeterministicSource，非 ExternalAttempt）。
- 全故障时输出未经安全审查的自由文本；必须用 `DeterministicSafetyResponse` 确定性响应。
- 绕过最终安全复核或破坏稳定 `generationId`（INV-GEN-001）；恢复不得铸造新 generationId，不得产出歧义/多重终态。
- 真实模型、真实 Provider、付费权益前置（INV-COST-001）。
- 改动 modelruntime 的 contract/port/guard/registry/authorization 子包、safety 模块、conversation 模块、任何 specs/generated 生成物，或 routing 中 TASK-0031 已交付的 RouteDecision/DeterministicRouter/RoutingRequest/Entitlement/ServiceClass/DecisionHash/QuotaReservation（本任务只扩 QuotaLedger + 新增恢复类型）。

## 依赖与决策闸门

- 依赖：TASK-0020（ACCEPTED，确定性失败关闭安全管线 + `DeterministicSafetyResponse`）、TASK-0021（ACCEPTED，实时事件/gap/恢复语义）、TASK-0031（ACCEPTED，`QuotaLedger`/`RouteDecision`/`DeterministicSourceBinding`/路由降级）。
- 无独立硬决策闸门。

## 验收

- AC1 额度正确处置：TIMEOUT/CANCELLED/ALL_FAILURE 调用恢复后 `QuotaLedger.remaining` 归还预留（RELEASE）；NO_CAPACITY 无预留故为 NONE；ZERO_LLM 归还既有预留且自身不消耗（免费）。可自动复测（预留→恢复→断言 remaining + RecoveryOutcome.quotaDisposition）。
- AC2 稳定 generationId 与唯一终态：每次恢复返回的 `RecoveryOutcome.ownership.generationId` 与输入一致（不铸造新 id），且每次调用恰好产出一个 `RecoveryTerminal`（无歧义/多重终态）。
- AC3 ZERO_LLM 无 provider_attempt：ZERO_LLM 完成路径不构造 `ExternalAttemptBinding`、不携带 providerAttemptId/selectedProviderId（结构可断言）。
- AC4 不绕过安全：全故障/ZERO_LLM 的响应文本恒为 `DeterministicSafetyResponse.ZERO_LLM_FALLBACK`（类型级引用安全常量，非自由文本）。

## 晋级规则

全部依赖 ACCEPTED 且执行顺序允许时，才基于最新 main 创建唯一 DRAFT；具体 Base、Context、白名单、精确命令与 Skill 版本在该时点锁定。
