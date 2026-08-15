# TASK-0221：H5 登录页增加记忆入口

```yaml
taskId: TASK-0221
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
baseCommit: ff38d9e7714acd827f41e123aa99ce0187d7965f
authorizationCommit: ""
contextFingerprint: 171ac431e0ab1561b150e55567ffbddd8e63c01d833e6a31f5255bac0b146154
contextLock: docs/tasks/context/TASK-0221.context-lock.yaml
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
  surfaceId: TASK_0221_H5_LOGIN_MEMORY_NAV
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 6
  terminalCheckMinutesEstimate: 12
  estimatedWallMinutes: 35
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
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/login/login.spec.ts
  - frontend/src/stores/auth.ts
writeAllowlist:
  - docs/tasks/TASK-0221-h5-login-memory-nav.md
  - docs/tasks/context/TASK-0221.context-lock.yaml
  - docs/evidence/TASK-0221/**
  - docs/handoffs/TASK-0221.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/login/login.spec.ts
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
  - frontend/src/pages/index/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/login/login.vue
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只在登录页增加记忆入口，
      不改变登录/失败语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - pnpm --dir frontend exec vitest run src/pages/login/login.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0220，intake 分配 TASK-0221。

## 背景与用户可观察目标

登录页已能回边界台和进聊天，没有记忆入口。用户要从登录页进记忆必须先绕道。

## 范围内

- 仅改 `login.vue` / `login.spec.ts`。
- 增加 `data-testid=nav-memory`「记忆管理」，导航到 `/pages/memory/memory`。
- 不携带 relationship id。点击不调用 `login`。

## 明确范围外

- 不改 auth store/API、提交、失败文案、redirectHome。

## 输入和前置条件

- Base：`ff38d9e7714acd827f41e123aa99ce0187d7965f`（TASK-0220 ACCEPTED）。

## API / 事件 / 数据契约

- 不修改 API/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 不改变登录失败语义。

## 模型、Prompt、记忆和安全边界

- 不改变认证语义。

## 验收标准

1. 登录页在提交前可见记忆管理入口。
2. 点击导航到 `/pages/memory/memory`，不调用 login。
3. 既有边界台/聊天导航、空提交/失败聚焦测试继续 PASS。

## 必跑检查

冻结命令：vitest `login.spec.ts` 与 `git diff --check`。READY 后真实跑 `doctor.py --task TASK-0221`；候选冻结后真实跑官方 `precheck.py --task TASK-0221` 与 `doctor.py --task TASK-0221 --pre-closure`。未跑不得写成 PASS。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/失败语义立即停止。
