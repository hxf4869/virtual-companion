# TASK-0026：H5 离线聊天、流式显示与恢复

```yaml
taskId: TASK-0026
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ba76742dc7a03fcdda086cfbc37c8bda4a63ce4a47eee0406e0438adece0d7b7
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: d2bcfa45a6f091c668e9c1c0a1b09afdfd462050
contextFingerprint: 5ddb6f4e8df31c9ec0e4c59505e3377c648ad87a90a08825521a6feccb2b17b2
contextLock: docs/tasks/context/TASK-0026.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: ""
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
  surfaceId: TASK_0026_H5_OFFLINE_CHAT_STREAM_RECOVERY
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
  - docs/tasks/TASK-0026-h5-offline-chat-stream-recovery.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/message-states.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - frontend/package.json
  - frontend/vitest.config.ts
  - frontend/vite.config.ts
  - frontend/tsconfig.json
  - frontend/src/env.d.ts
  - frontend/src/shims-uni.d.ts
  - frontend/src/main.ts
  - frontend/src/App.vue
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/domain/capability-gates.ts
  - frontend/src/domain/capability-gates.spec.ts
  - frontend/src/pages/index/index.vue
  - frontend/src/pages.json
  - specs/generated/openapi/catalog-schemas.yaml
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0025/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0026-h5-offline-chat-stream-recovery.md
  - docs/tasks/context/TASK-0026.context-lock.yaml
  - docs/evidence/TASK-0026/**
  - docs/handoffs/TASK-0026.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/domain/stream-reducer.spec.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages.json
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
  - scripts/dev/**
  - skills/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - specs/openapi/**
  - deploy/**
  - ops/**
  - docs/source/**
  - docs/decisions/**
  - service/**
  - infra/**
  - frontend/node_modules/**
  - frontend/dist/**
  - frontend/package.json
  - frontend/vitest.config.ts
  - frontend/vite.config.ts
  - frontend/tsconfig.json
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/domain/capability-gates.ts
  - frontend/src/domain/capability-gates.spec.ts
  - frontend/src/pages/index/index.vue
  - frontend/src/main.ts
  - frontend/src/App.vue
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
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/realtime-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-RT-001
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0026
  - bash -c "cd frontend && npx vitest run"
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers: []
independentReview: required
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0026 H5 离线聊天/流式显示/断线恢复（frontend/** 未保护路径，riskClass C4，
      policySurfaces AUTHORIZATION，无 protected skill surface 故无需 database-migration/safety-change 等
      skill-humanApproval，仅需 readyRequiresOwnerApproval 的 task-authorization 批准）。前端遵循既有
      api/domain/stores + vitest(node env) 范式：新建 domain/stream-reducer.ts 纯函数（仅推进 last contiguous
      sequence、gap 停止草稿追加、epoch mismatch 丢弃未提交草稿并要求 reset、缺失 delta 永不伪造——INV-RT-001
      客户端侧）、api/realtime.ts Fetch-SSE 恢复客户端（issue single-use ticket→fetch-SSE→解析事件喂 reducer→
      处置 5 disposition RESUMED/TERMINAL_SNAPSHOT/GAP_EXPIRED/RESET_REQUIRED/NOT_FOUND_OR_FORBIDDEN、
      snapshot 恢复、cancel）、stores/chat.ts Pinia store、pages/chat/chat.vue H5 页面，pages.json 注册路由。
      严格遵守 realtime-contract：不存长期 Token 于 localStorage、gap 后不继续拼接草稿、不伪造缺失 delta、
      chat.completed 仅在最终消息+安全复核提交后。验收：离线成功/断线/Gap/Reset/取消/失败 6 场景经 vitest mock
      fetch 自动复测全绿；客户端不伪造缺失 delta。不触碰任何 protected 路径（specs/catalog、specs/contracts、
      specs/generated、specs/openapi、service、db/migration、scripts/harness、.harness 治理文件、frontend 既有
      baseline 文件与构建配置），不引入 WebSocket/语音/图片/主动消息，不开启公开注册或真实账号。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

用离线后端实现 H5 聊天、增量显示、断线恢复和安全终态呈现。

## 范围内

- `frontend/src/domain/stream-reducer.ts` 纯函数：仅推进 last contiguous sequence、gap 停止草稿追加并要求 snapshot 恢复、epoch mismatch 丢弃未提交草稿并要求 reset、缺失 delta 永不伪造（INV-RT-001 客户端侧）；
- `frontend/src/api/realtime.ts` Fetch-SSE 恢复客户端：issue single-use resume ticket → fetch-SSE → 解析事件喂 reducer → 处置 5 disposition（RESUMED/TERMINAL_SNAPSHOT/GAP_EXPIRED/RESET_REQUIRED/NOT_FOUND_OR_FORBIDDEN）+ snapshot 恢复 + cancel；
- `frontend/src/stores/chat.ts` Pinia store + `frontend/src/pages/chat/chat.vue` H5 页面 + `pages.json` 路由；
- 离线成功、断线、Gap、Reset、取消、失败 6 场景的 vitest 自动复测（mock fetch，node env）。

## 明确禁止

- WebSocket、语音、图片和主动消息；
- 长期 Token 存 `localStorage`；
- Gap 后继续拼接草稿；
- 伪造缺失 delta；
- 触碰任何 protected 路径或既有 baseline 文件/构建配置。

## 依赖与决策闸门

- 依赖：TASK-0025（ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- 离线成功、断线、Gap、Reset、取消和失败场景可自动复测（vitest mock fetch 全绿）；
- 客户端不伪造缺失 delta（stream-reducer 仅推进连续序列，gap/epoch 不补齐）。

## 晋级规则

TASK-0025 ACCEPTED、仓库空闲且 Backlog 顺序允许后，才创建唯一 DRAFT。
