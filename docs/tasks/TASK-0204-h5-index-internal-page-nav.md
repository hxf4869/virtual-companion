# TASK-0204：H5 边界台增加内部页面入口

```yaml
taskId: TASK-0204
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
baseCommit: 36e6ddd53cad72f41a7be5ff2471489b20e1f27e
authorizationCommit: a8024041df5567aa7c99792ac089451483a74fa4
contextFingerprint: 2e53916fc338175ec4fc1d49a229fcfe719e174c2096ac80042835a8882d8cbe
contextLock: docs/tasks/context/TASK-0204.context-lock.yaml
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
  surfaceId: TASK_0204_H5_INDEX_INTERNAL_PAGE_NAV
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
  - frontend/src/pages/index/index.vue
  - frontend/src/stores/baseline.ts
writeAllowlist:
  - docs/tasks/TASK-0204-h5-index-internal-page-nav.md
  - docs/tasks/context/TASK-0204.context-lock.yaml
  - docs/evidence/TASK-0204/**
  - docs/handoffs/TASK-0204.json
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
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - skills/task-intake/SKILL.md
  - frontend/src/pages/index/index.vue
  - frontend/src/stores/baseline.ts
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-15"
    evidence: >-
      Owner Goal session 01a0034f-c7a4-7563-bb7a-01834924e3f7 书面授权日常工程、
      产品细节与合法 task-intake。本卡只在边界台增加已有内部页面的展示入口，
      不改变鉴权、基线预检、能力门禁或失败关闭语义。不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0204
  - pnpm --dir frontend exec vitest run src/pages/index/index.spec.ts
  - git diff --check
```

> 本卡为独立延续单卡。永久 ID 由机器派生：Ledger 最大编号 TASK-0203，intake 分配 TASK-0204。

## 背景与用户可观察目标

登录成功后落到边界台，页面只做 Runtime 预检，没有通往已有聊天、记忆、登录页的可见入口。
用户只能手改 URL。本卡只补展示导航，不改变预检、鉴权或门禁。

## 范围内

- 仅改 `index.vue`，并新增 `index.spec.ts`。
- 在边界台增加 `data-testid=alpha-nav` 入口：离线聊天、记忆管理、登录。
- 点击走 `uni.navigateTo`（若存在），否则回退 `location`；失败吞掉，不打断预检。
- 测试：三个入口可见；点击分别导航到 `/pages/chat/chat`、`/pages/memory/memory`、`/pages/login/login`。
- 不改 store/API/鉴权/门禁。

## 明确范围外

- 不改 `stores/baseline.ts`、baseline API、能力门禁映射。
- 不改登录成功跳转、鉴权、会话。
- 不实现取消/重试/安全流水线。
- 不在聊天/记忆页加返回导航（留给后续卡）。

## 输入和前置条件

- Base：`36e6ddd`（TASK-0203 ACCEPTED 终态）。
- 仓库 idle，`activeTask=null`。

## API / 事件 / 数据契约

- 不修改任何 API/事件/schema。

## 权限、RLS 和数据处理要求

- 不触后端与 RLS。

## 状态机和失败行为

- 导航失败不影响预检 `load` / `retryLoad` / 门禁展示。
- 不改变 baseline `state`。

## 模型、Prompt、记忆和安全边界

- 不涉及。

## 验收标准

1. 边界台渲染 `data-testid=alpha-nav`，含聊天、记忆、登录三个入口。
2. 点击入口分别导航到既有页面路径。
3. 预检加载/失败/重试与七项门禁展示保持原语义。
4. 冻结命令真实执行；不得把 FAIL/NOT_RUN 写成 PASS。

## 必跑检查

以 YAML `requiredCommands` 为准。

## 回滚或前向修复

- 仅 writeAllowlist，`maximumFixBatches: 1`。

## 停止条件

- 需要改 store/API/鉴权/门禁语义立即停止。
- 伪造 PASS 立即停止。
