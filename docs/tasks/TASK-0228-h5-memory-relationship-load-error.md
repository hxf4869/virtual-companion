# TASK-0228：H5 记忆页展示关系列表加载失败

```yaml
taskId: TASK-0228
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
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: d8cae708f0ad59ac07898729d55f7e185c53a159
authorizationCommit: 6d9cfaf18afdffc5e354f14c3ef7eaee4c204492
contextFingerprint: a194058a6beec627c2b003f0235f73d693e91079fd9bd6c2d033a44b66eb5103
contextLock: docs/tasks/context/TASK-0228.context-lock.yaml
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
  surfaceId: TASK_0228_H5_MEMORY_RELATIONSHIP_LOAD_ERROR
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 6
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 40
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
  - docs/tasks/TASK-0228-h5-memory-relationship-load-error.md
  - docs/tasks/context/TASK-0228.context-lock.yaml
  - docs/evidence/TASK-0228/**
  - docs/handoffs/TASK-0228.json
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
      产品细节与合法 task-intake。本卡只在记忆页展示关系列表加载失败文案，
      不改变确认/失败语义，不调用 activate。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/memory/memory.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0227，intake 分配 TASK-0228。

## 背景与用户可观察目标

边界台和聊天页已区分关系加载失败，记忆页失败时当前关系区域消失。用户无法确认是没填 id 还是列表没加载出来。

## 范围内

- 仅改 `memory.vue` / `memory.spec.ts`。
- `relStore.status === error` 时展示 `data-testid=relationship-load-error`「关系列表加载失败。」，`role=status`。
- 不展示 current-relationship。不调用 load/confirm/activate。

## 明确范围外

- 不改 store/API、确认/取消、activate。

## 输入和前置条件

- Base：`d8cae708f0ad59ac07898729d55f7e185c53a159`（TASK-0227 ACCEPTED）。

## API / 事件 / 数据契约

- 不修改 API/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 不改变确认/失败语义。不把关系失败写成记忆 load 失败。

## 模型、Prompt、记忆和安全边界

- 不改变记忆确认语义。

## 验收标准

1. 关系列表加载失败时可见「关系列表加载失败。」。
2. 此时不展示 current-relationship。
3. 不调用 load/confirm/activate；既有预填/导航测试继续 PASS。

## 必跑检查

冻结命令：vitest `memory.spec.ts` 与 `git diff --check`。READY 后真实跑 `doctor.py --task TASK-0228`；候选冻结后真实跑官方 `precheck.py --task TASK-0228` 与 `doctor.py --task TASK-0228 --pre-closure`。未跑不得写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/确认语义立即停止。
