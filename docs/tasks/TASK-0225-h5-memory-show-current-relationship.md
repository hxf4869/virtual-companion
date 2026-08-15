# TASK-0225：H5 记忆页展示当前关系

```yaml
taskId: TASK-0225
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
baseCommit: 12c19137e04a288171849e72a00c3408b4ad35fc
authorizationCommit: ""
contextFingerprint: 943a9180d2668408729b2667c66f5ed18df8fbd3e1371f23a29bdaff6a10150a
contextLock: docs/tasks/context/TASK-0225.context-lock.yaml
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
  surfaceId: TASK_0225_H5_MEMORY_SHOW_CURRENT_RELATIONSHIP
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
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
  - frontend/src/stores/relationship.ts
writeAllowlist:
  - docs/tasks/TASK-0225-h5-memory-show-current-relationship.md
  - docs/tasks/context/TASK-0225.context-lock.yaml
  - docs/evidence/TASK-0225/**
  - docs/handoffs/TASK-0225.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/pages/memory/memory.vue
  - frontend/src/pages/memory/memory.spec.ts
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
  - frontend/src/pages/login/**
  - frontend/src/pages/index/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/memory/memory.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake，并明确本轮不跑长 Doctor。本卡只在记忆页
      展示已填写的当前关系，不调用 load/confirm/activate。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0224，intake 分配 TASK-0225。

## 背景与用户可观察目标

边界台和聊天页已展示当前关系，记忆页只有输入框。用户填写或选择后，缺少与其他页一致的当前关系状态文案。

## 范围内

- 仅改 `memory.vue` / `memory.spec.ts`。
- `relStore.status === ready` 后展示 `data-testid=current-relationship`：
  - 已填 relationship id：`当前关系：<id>`
  - 未填：`还没有当前关系。`
- 不调用 load/confirm/activate。

## 明确范围外

- 不改 store/API、确认/取消、activate。

## 输入和前置条件

- Base：`12c19137e04a288171849e72a00c3408b4ad35fc`（TASK-0224 ACCEPTED）。

## API / 事件 / 数据契约

- 不修改 API/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 不改变确认/失败语义。加载中/失败不展示该区域。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. load 成功且未填 id 时可见「还没有当前关系。」。
2. 选择或填写 id 后可见「当前关系：<id>」。
3. 不调用 load/confirm/activate；既有预填/导航测试继续 PASS。

## 必跑检查

本轮只跑 vitest 与 `git diff --check`。Doctor / precheck / pre-closure 不跑，不得把未跑写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/确认语义立即停止。
