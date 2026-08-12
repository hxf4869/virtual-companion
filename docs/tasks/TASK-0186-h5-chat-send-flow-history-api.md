# TASK-0186：H5 Chat 发送流程 + 历史 API 消费纵切（C2 task-intake）

```yaml
taskId: TASK-0186
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
baseCommit: bbb1b487317df24a3f62a5c0e07efd4dc2786249
authorizationCommit: "plan-approved-2026-08-13-h5-chat-send-flow"
contextFingerprint: 869ff0d52cdc2d43fbc957e977613d9a6affcd8af7adbf57a537084947539845
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0186.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0186_H5_CHAT_SEND_FLOW_HISTORY_API
  policySurfaces: [FRONTEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 50
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - pnpm --dir frontend test:run
  - pnpm --dir frontend type-check
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/dev/openapi_tool.py validate
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/dev/openapi_tool.py diff
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0185-h5-realtime-transport-contract-align.md
  - docs/tasks/context/TASK-0185.context-lock.yaml
  - docs/evidence/TASK-0185/evidence-pack.json
  - docs/evidence/TASK-0185/review-r1.md
  - docs/handoffs/TASK-0185.json
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - frontend/package.json
  - frontend/src/api/transport.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime-transport.ts
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/stores/auth.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
  - frontend/src/pages/memory/memory.vue
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/conversation/web/ConversationController.java
writeAllowlist:
  - frontend/src/api/chat.ts
  - frontend/src/api/chat.spec.ts
  - frontend/src/api/authed-fetch.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
  - docs/tasks/TASK-0186-h5-chat-send-flow-history-api.md
  - docs/tasks/context/TASK-0186.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0186/**
  - docs/handoffs/TASK-0186.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-018[0-5]-*
  - docs/tasks/context/TASK-018[0-5].context-lock.yaml
  - docs/evidence/TASK-018[0-5]/**
  - docs/handoffs/TASK-018[0-5].json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
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
  - scripts/**
  - .github/workflows/**
  - specs/catalog/**
  - specs/generated/**
  - specs/contracts/**
  - service/**
  - "**/db/migration/**"
  - infra/**
  - .mvn/**
  - mvnw
  - mvnw.cmd
  - pom.xml
  - frontend/src/api/auth.ts
  - frontend/src/api/auth.spec.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/realtime-envelope.ts
  - frontend/src/api/realtime-envelope.spec.ts
  - frontend/src/api/realtime-transport.ts
  - frontend/src/api/realtime-transport.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/sse-parser.spec.ts
  - frontend/src/api/transport.ts
  - frontend/src/api/transport.spec.ts
  - frontend/src/domain/**
  - frontend/src/stores/auth.ts
  - frontend/src/stores/auth.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/index/**
  - frontend/src/pages/login/**
  - frontend/src/pages/memory/**
  - frontend/src/App.vue
  - frontend/src/main.ts
  - frontend/src/env.d.ts
  - frontend/src/shims-uni.d.ts
  - frontend/src/manifest.json
  - frontend/src/pages.json
  - frontend/src/uni.scss
  - frontend/src/static/**
  - frontend/.gitignore
  - frontend/index.html
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/pnpm-workspace.yaml
  - frontend/tsconfig.json
  - frontend/vite.config.ts
  - frontend/vitest.config.ts
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
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0185.json
requiredInvariants:
  - INV-RT-001
  - INV-TENANT-001
  - INV-GEN-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: 0186-h5-chat-send-flow-2026-08-13
    evidence: >-
      Owner 2026-08-13 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT
      治理例外）。TASK-0185 闭环后 nextAction 指向 TASK-0025 Chat/Generation/History API
      纵切。经代码调研确认后端 Chat/Generation/History API 已在 TASK-0174/0179 全部完整
      （ConversationController POST /conversations + GenerationController POST sendGeneration
      + GET snapshot + GenerationCancelController POST cancel + MessageHistoryController
      GET messages + V6/V8/V10 DB 函数），但 frontend 完全缺失消费层：无 chat API client、
      无类型、chat.vue demo 模式（硬编码 gen-alpha-1 自动起流）、sessionId 假值、
      realtime-transport 用裸 fetch 无 Bearer/CSRF；OpenAPI 有 drift（POST /conversations
      后端有但 spec 未定义）。本卡建 frontend chat API client（照 memory.ts 模式，存在性
      隐藏）+ authed-fetch（注入 realtime transport 不改模块）+ store send/history actions
      + chat.vue 真实发送 UI + OpenAPI 补 conversation 端点。不改 specs/contracts/catalog/
      generated（C2 边界），不改 service/** 或 DB migration（后端已完整）。
independentReview: not-required
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion
> 纵切的 H5 Chat 发送流程消费卡（TASK-0025 frontend 纵切），承接 TASK-0185 闭环后的
> nextAction，沿用 `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），
> 与 TASK-0173..0185 同属 idle DRAFT 治理例外，不进 backlog。**不触碰任何 protected path**：
> frontend/** 非 protected；specs/openapi/** 非 protected（仅 specs/contracts/catalog/generated
> 是 C3）→ requiredSkills task-delivery-flow+task-intake，independentReview not-required。

## 背景与用户可观察目标

TASK-0174/0179 交付了完整的后端 Chat/Generation/History API（ConversationController、
GenerationController、GenerationCancelController、MessageHistoryController + V6/V8/V10 DB
函数），TASK-0182/0184/0185 交付了完整的 realtime 栈。但 H5 frontend 仍处于**纯 demo 模式**：

- `chat.vue` 硬编码 `generationId = "gen-alpha-1"` + `sessionId = "session-alpha-1"`，mount 时
  自动起流，**无发送能力**、无消息历史、无 API client、无类型。
- `realtime-transport.ts`（TASK-0185）用裸 `fetch` 无 Bearer/CSRF — ticket mint POST 需要认证。
- OpenAPI 缺 `POST /api/v1/conversations` 端点（后端 ConversationController 已有但 spec 未定义）。

本卡交付**前端消费纵切**：

1. **`chat.ts`** — typed chat API client（照 `memory.ts` 模式）：`createConversation` /
   `sendGeneration` / `listMessages` / `cancelGeneration`，`ChatHttpError` 类型化错误，
   403/404→null 存在性隐藏，`asId` 接受 string|number 归一为 string（Java long wire format）。
2. **`authed-fetch.ts`** — fetch wrapper 加 Bearer + CSRF + credentials:include，作为
   `createBrowserRealtimeDeps` 的 `fetchImpl` 注入参数（**不改 realtime-transport.ts**）。
3. **`stores/chat.ts`** — 增 `send(transport, deps, content)` / `loadHistory(transport)` /
   `initConversation(transport, relationshipId)` actions，`conversationId` / `messages` state，
   `displayMessages` getter；保留现有 `run/cancel/reset` 流式消费语义不变。
4. **`chat.vue`** — 真实发送流程：消息输入 + 发送按钮 + 历史显示 + sessionId UUID +
   认证 realtime transport；移除硬编码 gen-alpha-1 demo。
5. **OpenAPI** — 补 `POST /api/v1/conversations` + `CreateConversationRequest` /
   `ConversationResponse` schema（对齐后端 ConversationController）。

用户可观察结果：用户打开聊天页 → 创建对话 → 看到历史消息 → 输入消息发送 → 流式接收增量 →
完成后历史刷新。sessionId 是客户端 UUID 真实来源。

## 范围内

1. **`frontend/src/api/chat.ts`**（新）：`ChatTransport` 接口（结构兼容 `AuthTransport`）；
   `Generation` / `Message` / `CreateConversationResponse` 类型；`ChatHttpError`；
   `createConversation` / `sendGeneration` / `listMessages` / `cancelGeneration` 函数；
   403/404→null，401/5xx→throw；`asId` string|number 归一。
2. **`frontend/src/api/chat.spec.ts`**（新，17 项）：wire（POST/GET path+body+query）+ response
   解析 + 存在性隐藏（403/404→null）+ 401/5xx throw + listMessages 空数组（foreign 不披露）。
3. **`frontend/src/api/authed-fetch.ts`**（新）：`createAuthedFetch(getAccessToken): typeof fetch`；
   Bearer header + credentials:include + POST 时 X-CSRF-Token from vc_csrf cookie。
4. **`frontend/src/stores/chat.ts`**（改）：增 `conversationId` / `messages` state；
   `initConversation` / `send` / `loadHistory` actions；`displayMessages` getter；`reset` 清理
   新 state；保留 `run/cancel/reset` 不变。
5. **`frontend/src/stores/chat.spec.ts`**（改）：保留现有 7 项 run/cancel/reset 测试；增 7 项
   send/history/initConversation/displayMessages/reset 测试。
6. **`frontend/src/pages/chat/chat.vue`**（改）：认证 transport + authedFetch + realtime deps；
   sessionId UUID；onMounted 创建 conversation + loadHistory；消息输入 + 发送 + 历史 + draft +
   status + cancel UI；移除硬编码 demo。
7. **`frontend/src/pages/chat/chat.spec.ts`**（改）：5 项 glue 测试（消息输入+发送按钮渲染、
   status role+aria-live、send 禁用/启用、history 容器渲染）。
8. **`specs/openapi/virtual-companion.yaml`**（改）：增 `POST /api/v1/conversations` endpoint +
   `CreateConversationRequest` / `ConversationResponse` schema。
9. **`specs/openapi/dist/**`**（重新生成）：openapi_tool.py generate。
10. 终态治理闭环：frontend vitest 196 项 + type-check exit 0 + openapi validate/diff PASS +
    git diff --check exit 0 + 结构化 review-r1 + Evidence/Handoff + 单父 `[skip ci]`/push。

## 明确范围外

- **改 `realtime.ts` / `stream-reducer.ts` / `realtime-envelope.ts` / `sse-parser.ts` / `realtime-transport.ts`**
  （逻辑层和 transport 层不动；authed-fetch 是外部注入，不改模块）。
- **改 `specs/contracts/**` / `specs/catalog/**` / `specs/generated/**`**（C3 边界）。
- **改 `service/**` 或 DB migration**（后端已完整）。
- **relationship 选择器 UI**（真实 relationshipId 来源，独立卡）。
- **ID hashid 编码**（候选方向，独立卡）。
- **WebSocket、语音、图片、主动消息**（Alpha forbidden capabilities）。
- **doctor / canonical precheck / 完整 unittest discover**（Owner 2026-08-13 策略：跳过长检查只完成任务；
  Evidence 如实标注 deferred，不标 PASS）。

## 输入和前置条件

- Base `bbb1b48` = TASK-0185 ACCEPTED terminal（已 push、HEAD==origin/main、0/0、clean；
  nextAction 三处 sha256 `b747317c...` 一致）。
- context lock 输入钉在 Base（48 inputs = 47 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `869ff0d5...`
  由复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0185 `072a97e1...` 通过，再生 0186）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。frontend 测试：pnpm 11.9.0 +
  vitest 3.2.6 + vue-tsc 1.0.24（node v22.23.1）。本卡碰 OpenAPI（openapi_tool validate/diff <1s）
  但不碰 DB（run-rls SKIP）、不碰 service（mvn SKIP）。

## Harness 契约与治理边界

- **不触碰任何 protected path**：`frontend/**` 不在 protected-paths.yaml；`specs/openapi/**` 不在
  protected-paths.yaml（仅 specs/contracts/catalog/generated 是 C3）→ 不触发 contract-change/catalog-change。
- 治理路径（`docs/tasks/**`、project-state、task-ledger、evidence、handoff）走 task-intake C2（与
  TASK-0179-0185 C2 卡一致）；`independentReview: not-required`（C2 条件风险）。
- `INV-TENANT-001`（存在性不披露）：chat.ts 403/404→null/空数组，不 throw existence-disclosing error。
- `INV-GEN-001`（generationId stable）：store 用 sendGeneration 返回的 generationId 起流，不猜测。
- `INV-RT-001`（client 只推进连续序号）：store.send 调用现有 run/streamGeneration，reducer 逻辑不变。

## 验收标准

1. `chat.ts`：4 个 API 函数（createConversation/sendGeneration/listMessages/cancelGeneration）+
   ChatHttpError + asId 归一；403/404→null，401/5xx→throw。
2. `authed-fetch.ts`：Bearer + CSRF + credentials:include fetch wrapper。
3. `stores/chat.ts`：send/loadHistory/initConversation actions + conversationId/messages state +
   displayMessages getter；现有 run/cancel/reset 不变。
4. `chat.vue`：消息输入 + 发送 + 历史 + sessionId UUID + 认证 realtime；移除 demo 硬编码。
5. `chat.spec.ts`（17 项）+ `stores/chat.spec.ts`（14 项）+ `pages/chat/chat.spec.ts`（5 项）全 PASS。
6. `pnpm --dir frontend test:run`：196 tests，0 failures。
7. `pnpm --dir frontend type-check`：vue-tsc exit 0。
8. `python scripts/dev/openapi_tool.py validate` + `diff`：PASS。
9. `git diff --check` exit 0。
10. Evidence 如实记录；doctor / canonical precheck / 完整 unittest deferred per Owner（不标 PASS），
    authorizationCommit 占位符 + relationshipId demo 来源记 knownRisk。
11. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 回滚或前向修复

- 若 frontend vitest 暴露 chat API client/store/chat.vue 问题：最多 1 fix batch。
- 若 type-check 暴露类型问题：最多 1 fix batch。
- 若 openapi diff 暴露 drift：最多 1 fix batch 修 OpenAPI + 重新生成 dist。
- 若实测必须改逻辑层、contracts、catalog、generated 或 service：立即停止（超出授权，需新卡）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰。
- frontend vitest / type-check / openapi validate/diff / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0186/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0186.json`。
