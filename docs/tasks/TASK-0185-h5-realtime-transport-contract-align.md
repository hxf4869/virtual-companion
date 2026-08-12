# TASK-0185：H5 realtime transport 对齐 0184 resume endpoint 契约（C2 task-intake）

```yaml
taskId: TASK-0185
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
baseCommit: a323cddf4c20027afc42d97d370168591b4b2abb
authorizationCommit: "plan-approved-2026-08-13-h5-realtime-transport"
contextFingerprint: 072a97e13576ec6e45596e9cab83634b43a1860b91536ea103594c86f8f77d23
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0185.context-lock.yaml
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
  surfaceId: TASK_0185_H5_REALTIME_TRANSPORT_CONTRACT_ALIGN
  policySurfaces: [FRONTEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 10
  estimatedWallMinutes: 35
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - pnpm --dir frontend test:run
  - pnpm --dir frontend type-check
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
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/context/TASK-0184.context-lock.yaml
  - docs/evidence/TASK-0184/evidence-pack.json
  - docs/evidence/TASK-0184/review-r1.md
  - docs/handoffs/TASK-0184.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - frontend/package.json
  - frontend/vitest.config.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime-envelope.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/transport.ts
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/stores/chat.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
writeAllowlist:
  - frontend/src/api/realtime-transport.ts
  - frontend/src/api/realtime-transport.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/sse-parser.spec.ts
  - frontend/src/pages/chat/chat.vue
  - docs/tasks/TASK-0185-h5-realtime-transport-contract-align.md
  - docs/tasks/context/TASK-0185.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0185/**
  - docs/handoffs/TASK-0185.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-018[0-4]-*
  - docs/tasks/context/TASK-018[0-4].context-lock.yaml
  - docs/evidence/TASK-018[0-4]/**
  - docs/handoffs/TASK-018[0-4].json
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
  - specs/openapi/**
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
  - frontend/src/api/transport.ts
  - frontend/src/api/transport.spec.ts
  - frontend/src/domain/**
  - frontend/src/stores/**
  - frontend/src/pages/chat/chat.spec.ts
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
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0184.json
requiredInvariants:
  - INV-RT-001
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
    sourceThreadId: 0185-h5-realtime-transport-2026-08-13
    evidence: >-
      Owner 2026-08-13 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT 治理例外）。
      TASK-0184 闭环后 nextAction 指向 H5 离线聊天/流式显示与断线恢复（Fetch-SSE 客户端，TASK-0026 范围）。
      经代码调研确认 frontend realtime 逻辑层（realtime.ts/stream-reducer/sse-parser/realtime-envelope）
      在 TASK-0026/0104/0163 已完整，但 chat.vue 内联 transport（createBrowserRealtimeDeps）停留在
      0184 之前的猜测端点 /api/v1/realtime/resume（generationId/afterSeq 全 query，无 ticket），与 0184
      定的 GET /api/v1/realtime/streams/{generationId} + ticket query + Last-Event-ID header 契约漂移；
      且 sse-parser 只解析 data: 行，会丢弃 0184 controller 用 event: name 编码的控制事件（stream.gap/
      reset/denied）。本卡对齐 transport + 扩展 sse-parser event: 解析 + 补 transport 单元测试，不改逻辑层
      语义、契约或 OpenAPI。C2 卡：frontend/** 非 protected-path，不改 specs/contracts/openapi →
      requiredSkills task-delivery-flow+task-intake，independentReview not-required。
independentReview: not-required
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion 纵切的
> H5 realtime transport 对齐卡（TASK-0026 frontend 纵切），承接 TASK-0184 闭环后的 nextAction，沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0173..0184 同属
> idle DRAFT 治理例外，不进 backlog。**不触碰任何 protected path**：frontend/** 非 protected；不改
> specs/contracts/**（0184 已定 resume endpoint 契约，本卡是消费方）也不改 specs/openapi/**（契约端点
> 已定，frontend 手写 fetch 消费，不重建 dist）。

## 背景与用户可观察目标

TASK-0184 交付了服务端 SSE resume 端点（`GET /api/v1/realtime/streams/{generationId}` + ticket query +
Last-Event-ID header），契约与 OpenAPI 已固化。但 H5 frontend 消费端的 transport 实现
（`chat.vue` 内联 `createBrowserRealtimeDeps`）仍停留在 0184 之前的**猜测端点**：

- 端点 path：用 `/api/v1/realtime/resume?generationId=` —— 应为 `GET /api/v1/realtime/streams/{generationId}`
  （generationId 走 path）。
- 缺 ticket 流程：0184 要求 resume 携带 `ticketId/secret/sessionId/origin/streamEpoch`（query），需先
  `POST /api/v1/realtime/tickets` mint 单次短期 ticket；当前 transport 完全没有 mint。
- afterSeq 位置：当前走 query `&afterSeq=` —— 应走 SSE 标准 `Last-Event-ID` header。

此外 `sse-parser.ts` 只解析 `data:` 行、且"无 data 帧直接跳过"，而 0184 controller 用 SSE `event:` name
编码控制信号（`stream.gap`/`stream.reset`/`stream.denied` 这些控制事件**只有 `event:` 行、没有 `data:` 行**），
会被 sse-parser 完全丢弃 → transport 永远只能看到 RESUMED，4 个控制 disposition 失效。

逻辑层（`realtime.ts`/`stream-reducer.ts`/`sse-parser.ts`/`realtime-envelope.ts`）在 TASK-0026/0104/0163
已完整且测试覆盖，本卡**不改其语义**，只：① 扩展 sse-parser 解析 `event:` 行（向后兼容）；② 提取并
对齐 transport 到独立可测模块；③ chat.vue 改用新模块。

用户可观察结果（本卡完成后）：

- **transport 对齐契约**：`realtime-transport.ts` 按 0184 契约 mint ticket + 打开 resume stream（path +
  query + Last-Event-ID）+ fetchSnapshot，5 disposition 全映射，存在性不披露，5xx/abort 类型化失败。
- **sse-parser 消费控制事件**：`event:` 行解析，控制事件（stream.gap/reset/denied）不再被丢弃。
- **测试**：新增 `realtime-transport.spec.ts`（19 项）覆盖 mint/resume wire + 5 disposition + 错误/abort/
  snapshot；sse-parser.spec.ts 加 3 项 event: 解析。frontend vitest 170 项全绿。

## 范围内

1. **`frontend/src/api/realtime-transport.ts`**（新）：提取并对齐 0184 契约的 transport。导出
   `createBrowserRealtimeDeps({ sessionId, origin }, fetchImpl?) → RealtimeDeps`：
   - `resume(request)`：mint ticket（`POST /api/v1/realtime/tickets`，body `{generationId, sessionId, origin,
     streamEpoch, afterSeq}`，owner/transport 服务端固定不入 body；401/403/404→null 存在性隐藏）→
     `GET /api/v1/realtime/streams/{generationId}?ticketId&secret&sessionId&origin&streamEpoch` +
     `Last-Event-ID: afterSeq` header → `readSseFrames` → `mapFrames` 映射 5 disposition（stream.gap→GAP_EXPIRED；
     stream.reset→RESET_REQUIRED+nextEpoch；stream.denied→NOT_FOUND_OR_FORBIDDEN；snapshot→TERMINAL_SNAPSHOT；
     durable envelope→RESUMED）；401/403/404→NOT_FOUND_OR_FORBIDDEN；5xx→throw；SseAbortedError 透传。
   - `fetchSnapshot(generationId)`：`GET /api/v1/generations/{generationId}/snapshot`（对齐路径 + envelope 解析；
     非 ok/解析失败→`{ok:false}`）。
2. **`frontend/src/api/sse-parser.ts`**：`SseFrame` 加可选 `event` 字段；`flushFrame` 解析 `event:` 行；
   有 `event` 但无 `data` 的控制事件帧 push `{event, data:null}`；无 `event` 无 `data`（comment/keepalive）
   仍跳过。向后兼容（现有 `data`/`disposition` 读取不变）。
3. **`frontend/src/api/realtime-transport.spec.ts`**（新，19 项）：mock fetch 覆盖 mint wire（POST + body 5
   字段 + owner/transport 不在 body + 每次 resume 重 mint）+ stream wire（path generationId + query 5 参数 +
   Last-Event-ID header）+ 5 disposition SSE 映射 + mint/stream 401/403/404→NOT_FOUND_OR_FORBIDDEN + 5xx→throw +
   malformed ticket→throw + abort（mint/snapshot/readSseFrames）+ snapshot ok/非 ok/解析失败。
4. **`frontend/src/api/sse-parser.spec.ts`**：加 3 项（event: 行解析 + 控制事件帧 + snapshot 帧）。
5. **`frontend/src/pages/chat/chat.vue`**：移除内联 transport（`createBrowserRealtimeDeps`/`RESUME_ENDPOINT`/
   `SNAPSHOT_ENDPOINT`/`isRecord` 及相关 import），改 import 新模块；setup 提供
   `origin`（`window.location.origin` fallback）+ `sessionId`（demo 固定值 `session-alpha-1`，真实来源待
   TASK-0025）。
6. 终态治理闭环：frontend vitest 170 项全绿 + type-check exit 0 + git diff --check exit 0 + 结构化
   review-r1 + Evidence/Handoff + 单父 `[skip ci]`/push/远端 0/0。

## 明确范围外

- **改 `realtime.ts`/`stream-reducer.ts`/`realtime-envelope.ts` 语义**（逻辑层不动；sse-parser 只补 event:
  解析能力，不改现有 data/disposition 契约）。
- **改 `specs/contracts/**` 或 `specs/openapi/**`**（0184 已定 resume endpoint 契约，frontend 是消费方；
  不重建 dist）。
- **发送幂等 / generation 创建 → sessionId 真实来源**（TASK-0025 Chat API 范围；本卡 sessionId 用 demo 固定值）。
- **长连接订阅模式**（0184 是一次性 resume 积压，非持续推送）。
- **WebSocket、语音、图片、主动消息**（Alpha forbidden capabilities）。
- **doctor / canonical precheck / 完整 unittest discover**（Owner 2026-08-13 策略：跳过长检查只完成任务；
  Evidence 如实标注 deferred，不标 PASS）。

## 输入和前置条件

- Base `a323cddf` = TASK-0184 ACCEPTED terminal（已 push、HEAD==origin/main、0/0、clean；nextAction 三处
  sha256 `bd27fbcc...` 一致）。
- DRAFT 前已复核：realtime-contract.yaml resume 段（0184 补的 endpoint/ticketBinding/ticketBoundTo/
  deniedEvent）；OpenAPI `GET /api/v1/realtime/streams/{generationId}`（5 query required + Last-Event-ID
  header optional）+ `RealtimeTicketCreateRequest`（5 字段，owner/transport 不在 body）+ `RealtimeTicket`
  （ticketId/secret）+ `RealtimeStreamEvent`（event/id/data）；`RealtimeStreamController.dispatch`（RESUMED/
  TERMINAL_SNAPSHOT 发 durable events 逐个 id=eventSeq + snapshot；GAP_EXPIRED→stream.gap；RESET_REQUIRED→
  stream.reset；NOT_FOUND_OR_FORBIDDEN→stream.denied；控制事件只 event: name 无 data）；frontend realtime 逻辑层
  （realtime.ts `RealtimeDeps`/`ResumeRequest`/`ResumeResult`；stream-reducer INV-RT-001；sse-parser data: 解析；
  realtime-envelope `event` 字段）；chat.vue 内联 transport（猜测端点 + 无 ticket）；chat.spec.ts（glue 测试
  stub fetch 走 exhausted）。
- context lock 输入钉在 Base（43 inputs = 42 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `072a97e1...` 由
  复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0184 `2aebe476...` 通过，再生 0185）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。frontend 测试：pnpm 11.9.0 + vitest 3.2.6
  + vue-tsc 1.0.24（node v22.23.1）。本卡不碰 DB（run-rls SKIP）、不碰 service（mvn SKIP）、不碰 OpenAPI
  （openapi diff SKIP）。

## Harness 契约与治理边界

- **不触碰任何 protected path**：`frontend/**` 不在 protected-paths.yaml；不改 `specs/contracts/**`（0184
  已定）也不改 `specs/openapi/**`（消费方）→ 不触发 contract-change/catalog-change。
- 治理路径（`docs/tasks/**`、project-state、task-ledger、evidence、handoff）走 task-intake C2（与
  TASK-0179-0182 C2 卡一致）；`independentReview: not-required`（C2 条件风险）。
- `INV-RT-001`（client 只推进最后连续序号、gap 停止拼接、不伪造缺失 delta）：transport 只路由 disposition +
  解析 envelope，reducer 逻辑不变。
- h5Security（realtime-contract）：ticket secret 是 45s 单次短期凭据走 resume query（非 long-lived token，
  `longLivedTokenInRealtimeQueryForbidden` 只禁 long-lived，不冲突）；long-lived access token 仍由 auth
  transport Bearer header 携带，不进 localStorage（`longLivedTokenInLocalStorageForbidden` 保持）。
- 不改 V8 migration、catalog、generated、contracts、openapi、service、modelruntime/safety——均 forbiddenPaths。

## 状态机和失败行为

- mint ticket：401/403/404→null（存在性隐藏，resume 返回 NOT_FOUND_OR_FORBIDDEN，不打 resume stream）；
  5xx/非 ok→throw（exhausted）；malformed payload（缺 ticketId/secret）→throw；abort→fetch 抛错传播。
- resume stream：401/403/404→NOT_FOUND_OR_FORBIDDEN（不披露）；5xx/非 ok→throw（exhausted，非空流伪装断连）；
  readSseFrames abort→SseAbortedError 透传；其他 SSE 解析错→SseParseError。
- mapFrames：stream.gap→GAP_EXPIRED；stream.reset→RESET_REQUIRED（nextEpoch 从 data 提取，缺则 fallback
  reducer epoch+1）；stream.denied→NOT_FOUND_OR_FORBIDDEN；snapshot→TERMINAL_SNAPSHOT（snapshot.events 替换
  draft）；durable envelope→RESUMED（parseStreamEvent 解析 catalog `event` 字段）。
- fetchSnapshot：非 ok→`{ok:false}`（P1-07 类型化失败，非伪终态）；malformed（非 record/无 events）→
  `{ok:false}`；ok→`{ok:true, events}`。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆/业务数据（realtime 传输层 + frontend transport）。安全边界：ticket secret 是 45s 单次
短期凭据（mint 返回一次，sha256-only persisted），走 resume query；owner 从 server-verified principal 取
（transport 不传 owner）；transport FETCH_SSE 服务端固定（不从 query）；存在性不披露（401/403/404 +
stream.denied 统一 NOT_FOUND_OR_FORBIDDEN）；long-lived token 不进 localStorage/query。

## 验收标准

1. `realtime-transport.ts`：mint ticket（body 5 字段，owner/transport 不入 body）→ resume stream（path +
   query 5 参数 + Last-Event-ID header）→ mapFrames 5 disposition 全映射；fetchSnapshot 对齐路径；存在性
   隐藏 + 5xx throw + abort 透传。
2. `sse-parser.ts`：`SseFrame.event` 可选字段；`event:` 行解析；控制事件帧（有 event 无 data）保留；
   comment/keepalive（无 event 无 data）仍跳过；现有 data/disposition 向后兼容。
3. `chat.vue`：移除内联 transport，import 新模块；origin=location.origin fallback，sessionId=demo 固定值。
4. `realtime-transport.spec.ts`（19 项）+ `sse-parser.spec.ts`（+3 项）全 PASS。
5. `pnpm --dir frontend test:run`：170 tests（151 既有 + 19 新 transport），0 failures。
6. `pnpm --dir frontend type-check`：vue-tsc exit 0。
7. `git diff --check` exit 0。
8. Evidence 如实记录；doctor / canonical precheck / 完整 unittest deferred per Owner（不标 PASS），
   authorizationCommit 占位符 + sessionId demo 来源记 knownRisk。
9. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（frontend vitest run 一次；vue-tsc type-check 一次；
`git diff --check` 一次）。run-rls（69 项）SKIP：不改 DB。runtime mvn SKIP：不改 service Java。
openapi diff SKIP：不改 OpenAPI 源。doctor / canonical precheck / 完整 unittest discover 按 Owner 策略
deferred。

## 回滚或前向修复

- 若 frontend vitest 暴露 transport/sse-parser 问题：最多 1 fix batch 修 transport/sse-parser/chat.vue/spec。
- 若 type-check 暴露类型问题：最多 1 fix batch 修类型签名。
- 若 R1 发现阻塞项（C2 not-required，但仍有自检）：最多 1 fix batch。
- 若实测必须改逻辑层语义、契约、OpenAPI 或 service：立即停止（超出本卡授权，需新卡）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（0170-0184 产物、contracts/openapi、catalog/generated、
  migration、service、.harness 真源、scripts/skills/ci、frontend 非写目标源）。
- frontend vitest / type-check / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0185/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0185.json`。
