# TASK-0201：H5 关系选择器空列表状态提示

```yaml
taskId: TASK-0201
state: IN_REVIEW
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 581f6380376b87813700f99d53acb9ce0af2ec25
authorizationCommit: 77f6a6079258495605fe1585f1da0b91917dd3cf
contextFingerprint: 6984b4633c1b6c691b0141146945e669277d2f88b5a71e067b23758587ef589b
contextLock: docs/tasks/context/TASK-0201.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0201_H5_RELATIONSHIP_EMPTY_STATUS
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  splitDecision: KEEP
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/invariants.yaml
  - .harness/sources-of-truth.yaml
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - frontend/package.json
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
writeAllowlist:
  - docs/tasks/TASK-0201-h5-relationship-empty-status.md
  - docs/tasks/context/TASK-0201.context-lock.yaml
  - docs/evidence/TASK-0201/**
  - docs/handoffs/TASK-0201.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/components/RelationshipSelector.vue
  - frontend/src/components/RelationshipSelector.spec.ts
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - infra/**
  - scripts/**
  - skills/**
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - AGENTS.md
  - CLAUDE.md
  - docs/tasks/task-card-template.md
  - specs/**
  - frontend/src/api/**
  - frontend/src/stores/**
  - frontend/src/domain/**
  - frontend/src/pages/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/components/RelationshipSelector.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只补关系选择器空列表可见状态，不改变激活/新建
      语义，不触及保护路径。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0201
  - pnpm --dir frontend exec vitest run src/components/RelationshipSelector.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0200，intake 分配 TASK-0201。

## 背景与用户可观察目标

关系选择器在 `relationships.length===0` 时只禁用下拉并显示「选择关系…」，没有说明需要先新建。
首次进入聊天且尚无关系的用户应看到一条简短状态提示。

## 范围内

- 仅改 `RelationshipSelector.vue` 与其 spec。
- 当 `status` 不是 `loading`/`error` 且列表为空时，渲染
  `data-testid="empty-relationships"`（`role="status"`），提示先新建关系。
- loading 继续用既有 `rel-status`；error 继续用既有 alert。
- 不改变 activate/create emit 语义。

## 明确范围外

- 不改 relationship store/API、聊天页、记忆页。
- 不实现取消/重试/安全/契约变更。

## 输入和前置条件

- Base：`581f638`（TASK-0200 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。emit 名称与参数不变。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- loading/error 时不显示空列表提示。
- 有关系时不显示空列表提示。

## 模型、Prompt、记忆和安全边界

- 不涉及。

## 验收标准

1. `relationships=[]` 且 status 为 idle/ready 时存在 empty-relationships。
2. status=loading 或 error，或列表非空时，该节点不存在。
3. 既有 emit/disabled/a11y 测试继续 PASS。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API 立即停止。
- 伪造 PASS 立即停止。
