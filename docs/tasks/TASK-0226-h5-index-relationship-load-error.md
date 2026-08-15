# TASK-0226：H5 边界台展示关系列表加载失败

```yaml
taskId: TASK-0226
state: DRAFT
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
baseCommit: 377b95fd7314b44b6db2e32ba8766abd07b62b07
authorizationCommit: ""
contextFingerprint: 17d6a79086fbe99ef11f74a8ed8136fabb81189e5f0517038fb429d785952464
contextLock: docs/tasks/context/TASK-0226.context-lock.yaml
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
  surfaceId: TASK_0226_H5_INDEX_RELATIONSHIP_LOAD_ERROR
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 6
  terminalCheckMinutesEstimate: 6
  estimatedWallMinutes: 20
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
  - frontend/src/pages/index/index.vue
  - frontend/src/pages/index/index.spec.ts
  - frontend/src/stores/relationship.ts
writeAllowlist:
  - docs/tasks/TASK-0226-h5-index-relationship-load-error.md
  - docs/tasks/context/TASK-0226.context-lock.yaml
  - docs/evidence/TASK-0226/**
  - docs/handoffs/TASK-0226.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/pages/index/index.vue
  - frontend/src/pages/index/index.spec.ts
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
  - frontend/src/pages/chat/**
  - frontend/src/pages/memory/**
  - frontend/src/pages/login/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/index/index.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake，并明确本轮不跑长 Doctor。本卡只在边界台
      展示关系列表加载失败文案，不改变预检失败语义，不调用 activate。
      不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/index/index.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0225，intake 分配 TASK-0226。

## 背景与用户可观察目标

边界台在关系 load ready 后展示当前关系，load 失败时该区域消失。用户无法区分「还没有关系」和「关系列表没加载出来」。

## 范围内

- 仅改 `index.vue` / `index.spec.ts`。
- `relStore.status === error` 时展示 `data-testid=relationship-load-error`「关系列表加载失败。」，`role=status`。
- 不展示 current-relationship。不调用 activate。不改预检失败区域。

## 明确范围外

- 不改 store/API、预检、activate。

## 输入和前置条件

- Base：`377b95fd7314b44b6db2e32ba8766abd07b62b07`（TASK-0225 ACCEPTED）。

## API / 事件 / 数据契约

- 不修改 API/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 不改变预检失败语义。关系失败与预检失败分区展示。

## 模型、Prompt、记忆和安全边界

- 不改变认证/关系激活语义。

## 验收标准

1. 关系列表加载失败时可见「关系列表加载失败。」。
2. 此时不展示 current-relationship。
3. 预检失败区域仍在；不调用 activate；既有导航/当前关系测试继续 PASS。

## 必跑检查

本轮只跑 vitest 与 `git diff --check`。Doctor / precheck / pre-closure 不跑，不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/预检语义立即停止。
