# TASK-0202：H5 登录页禁止空字段提交

```yaml
taskId: TASK-0202
state: READY
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
baseCommit: 55534da789a1f328d887f3aa4b6c38ecf562eca6
authorizationCommit: ""
contextFingerprint: cd81fcf7b33f6be7aa71cc66889d8c949beb76e1f43b8033578832b92f267134
contextLock: docs/tasks/context/TASK-0202.context-lock.yaml
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
  surfaceId: TASK_0202_H5_LOGIN_EMPTY_SUBMIT_GUARD
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
  - frontend/src/pages/login/login.vue
  - frontend/src/pages/login/login.spec.ts
writeAllowlist:
  - docs/tasks/TASK-0202-h5-login-empty-submit-guard.md
  - docs/tasks/context/TASK-0202.context-lock.yaml
  - docs/evidence/TASK-0202/**
  - docs/handoffs/TASK-0202.json
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
  - INV-AUTH-001
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只禁止登录页空字段提交，不改变服务端失败关闭、
      存在性不披露或认证契约。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0202
  - pnpm --dir frontend exec vitest run src/pages/login/login.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0201，intake 分配 TASK-0202。

## 背景与用户可观察目标

登录页在用户名或密码为空时仍可点击「登录」，会打到 store 并显示「用户名或密码错误」。
空提交应在页面层被拦住：按钮禁用，且不调用 `store.login`。服务端失败关闭与存在性不披露保持不变。

## 范围内

- 仅改 `login.vue` 与 `login.spec.ts`。
- `canSubmit`：用户名 trim 非空且密码长度 > 0（不 trim 密码）。
- 按钮在 `!canSubmit || submitting` 时 disabled。
- `onSubmit` 在 `!canSubmit` 时直接返回，不调用 store。
- 更新 aria-busy 测试：先填字段再点提交。
- 既有失败登录 alert / 回焦测试继续覆盖已填字段路径。

## 明确范围外

- 不改 auth store、identity API、密码策略、速率限制。
- 不披露账号是否存在。
- 不实现取消/重试/安全流水线。

## 输入和前置条件

- Base：`55534da`（TASK-0201 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 空提交不进入 store，不显示「用户名或密码错误」。
- 已填字段后的服务端拒绝文案不变。

## 模型、Prompt、记忆和安全边界

- 不改变认证失败语义。

## 验收标准

1. 用户名或密码为空时提交按钮 disabled，点击不调用 `store.login`。
2. 两字段均非空时按钮可点。
3. 已填字段的失败登录仍显示 role=alert 并回焦用户名。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API 或失败语义立即停止。
- 伪造 PASS 立即停止。
