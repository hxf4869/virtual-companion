# TASK-0020：输入、增量输出和最终输出安全流水线

```yaml
taskId: TASK-0020
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - safety-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  safety-change: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: cc663f75c8c9c17de49fb5c9e09fe01079262467ea617e77f2771244e4ac01f2
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: f186ecedf495e03544d48dbd0dc2a24b62f3a524
authorizationCommit: ""
contextFingerprint: 38f86be6f24aa30b1fc14c2fe812fe73d3fd986ef8495882fe6ef6f71314a6fa
contextLock: docs/tasks/context/TASK-0020.context-lock.yaml
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
  surfaceId: TASK_0020_SAFETY_PIPELINE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
reviewers: []
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
  - docs/tasks/TASK-0020-safety-pipeline.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/safety-change/SKILL.md
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/product-scope.yaml
  - specs/generated/java/com/virtualcompanion/catalog/SafetyClassifierOutcome.java
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - requirements-harness.txt
  - pom.xml
  - service/modules/conversation/pom.xml
  - docs/evidence/TASK-0019/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0020-safety-pipeline.md
  - docs/tasks/context/TASK-0020.context-lock.yaml
  - docs/evidence/TASK-0020/**
  - docs/handoffs/TASK-0020.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - pom.xml
  - service/modules/safety/pom.xml
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyVerdict.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/ClassifierReport.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyGate.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/SafetyReview.java
  - service/modules/safety/src/main/java/com/virtualcompanion/safety/DeterministicSafetyResponse.java
  - service/modules/safety/src/test/java/com/virtualcompanion/safety/SafetyGateTest.java
  - service/modules/safety/src/test/java/com/virtualcompanion/safety/SafetyReviewTest.java
  - service/modules/safety/src/test/java/com/virtualcompanion/safety/DeterministicSafetyResponseTest.java
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
  - service/adapters/**
  - service/apps/**
  - service/platform/**
  - service/modules/modelruntime/**
  - service/modules/conversation/**
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/02_cross_relationship_reference_denied.sql
  - infra/db/tests/03_cross_conversation_reference_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/11_missing_context_zero_write.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - db/**
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
  - skills/safety-change/SKILL.md
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/catalog/risk-levels.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: safety-change
    approvedBy: repository-owner
    approvedAt: "2026-08-06"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0020 安全流水线变更（覆盖 service/**/safety/** 保护路径）：
      实现确定性优先、失败关闭的输入/增量/最终安全流水线（硬规则可被模型分类器提高但永不降低；
      timeout/UNAVAILABLE/INVALID_RESPONSE/LOW_CONFIDENCE/RULE_CONFLICT 一律失败关闭、不放行自由文本；
      增量复核失败暂停流式；最终复核失败阻止 chat.completed；全部审核路径不可用时走 ZERO_LLM 确定性
      安全替代，绝不绕过）。仅合成数据与确定性单测；不猜测试用未获批的 Alpha/Beta 安全政策。
independentReview: required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0020
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现输入、增量输出和最终输出的确定性优先、失败关闭安全流水线。

## 范围内

- 硬规则、分类信号、增量暂停和最终复核；
- ZERO_LLM 或确定性安全替代。

## 明确禁止

- 分类器降低硬规则风险；
- 超时、低置信、无效响应或规则冲突时放行自由文本；
- 未获批即猜测 Beta 或 Alpha 安全政策。

## 依赖与决策闸门

- 依赖：TASK-0014、TASK-0019；
- 无独立硬决策闸门。

## 验收

- 所有 classifier failure outcome 均失败关闭；
- final review 失败时不存在 `chat.completed`。

## 晋级规则

全部依赖 ACCEPTED、仓库空闲且执行顺序允许后，才能绑定安全 Skill、人工批准和精确测试成为唯一 DRAFT。
