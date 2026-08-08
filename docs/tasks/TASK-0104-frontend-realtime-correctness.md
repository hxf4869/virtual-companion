# TASK-0104：Frontend realtime 正确性（P1-07 + P2-14 + P2-15 + P2-17）

```yaml
taskId: TASK-0104
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
baseCommit: c9c3ccce88a16528c9a8af28d49c92869d5c0f6f
authorizationCommit: ""
contextFingerprint: 516e01072cf59ef1d6f97e88279ffb17dec7348dfa22196a5ce5f257bd4d9f4b
contextLock: docs/tasks/context/TASK-0104.context-lock.yaml
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
  surfaceId: TASK_0104_FRONTEND_REALTIME_CORRECTNESS
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - docs/tasks/TASK-0103-frontend-session-wiring.md
  - docs/handoffs/TASK-0103.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/transport.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/stores/auth.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/domain/stream-reducer.spec.ts
  - frontend/package.json
writeAllowlist:
  - docs/tasks/TASK-0104-frontend-realtime-correctness.md
  - docs/tasks/context/TASK-0104.context-lock.yaml
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/sse-parser.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/domain/stream-reducer.spec.ts
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0104/**
  - docs/handoffs/TASK-0104.json
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0103-frontend-session-wiring.md
  - docs/evidence/TASK-0103/**
  - docs/handoffs/TASK-0103.json
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
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
  - specs/**
  - service/**
  - infra/**
  - frontend/src/main.ts
  - frontend/src/App.vue
  - frontend/src/domain/capability-gates.ts
  - frontend/src/domain/capability-gates.spec.ts
  - frontend/src/api/auth.ts
  - frontend/src/api/auth.spec.ts
  - frontend/src/api/transport.ts
  - frontend/src/api/baseline.ts
  - frontend/src/api/baseline.spec.ts
  - frontend/src/api/memory.ts
  - frontend/src/api/memory.spec.ts
  - frontend/src/stores/auth.ts
  - frontend/src/stores/auth.spec.ts
  - frontend/src/stores/baseline.ts
  - frontend/src/stores/baseline.spec.ts
  - frontend/src/stores/memory.ts
  - frontend/src/stores/memory.spec.ts
  - frontend/src/pages/login/**
  - frontend/src/pages/memory/**
  - frontend/src/pages/index/**
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/vite.config.*
  - frontend/vitest.config.*
  - frontend/tsconfig*.json
  - mvnw
  - mvnw.cmd
  - pom.xml
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
  - docs/tasks/TASK-0103-frontend-session-wiring.md
  - docs/handoffs/TASK-0103.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-RT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 10 分配 Frontend realtime 正确性卡
      （TASK-0104）：P1-07 Snapshot 失败/非终态被伪装成安全完成 + P2-14 前端
      取消不 abort SSE/fetch + P2-15 SSE parser 不支持 CRLF/错误被当空流 +
      P2-17 Chat 旧 run 覆盖新 generation/reset。工作包 10 无 Owner 决策门，
      直接可执行；TASK-0103 nextAction 逐字一致的下一卡。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0104
  - pnpm --dir frontend test:run
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0103 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0104 起）。frontend/** 无保护路径规则，风险类 C2，但属实时状态机与安全边界（INV-RT-001），独立 Reviewer 按卡要求执行。契约 realtime-contract.yaml 本卡不改（只读真源）。

## 背景与用户可观察目标

审计确认前端 realtime 四个缺陷（全部位于 `frontend/src/pages/chat/chat.vue` 页面内嵌 transport/parser 与 `frontend/src/api/realtime.ts` 编排、`frontend/src/stores/chat.ts`）：

1. **P1-07**：`fetchSnapshot` 在任何失败（!ok、parse 失败、401/500）时返回 `[]`；`streamGeneration` 的 snapshot 恢复路径对空快照调用 `applyTerminalSnapshot(state, [])` → **terminal: true**——快照获取失败被伪装成"安全终态"，UI 显示"已完成（安全终态）"。
2. **P2-14**：`chat.vue` 的 resume/snapshot fetch 无 AbortController——`store.cancel()` 只翻转 handle 标志，底层 SSE fetch 继续拉流；新 run/unmount 也不中止旧请求。
3. **P2-15**：`readSseEvents`（chat.vue 内嵌）只按 `\n\n` 切帧——CRLF（`\r\n\r\n`）帧永不终止导致全部事件丢失（表现为空流）；错误/畸形帧被静默吞掉。
4. **P2-17**：`store.run()` 无 run 序号——旧 run 的 `streamGeneration` 完成后无条件覆写 `stream/phase/outcome`，可覆盖新 generation/reset 的状态。

本卡完成后，用户能观察到：快照恢复失败/非终态快照进入 typed 失败（exhausted/重试），UI 不再误报安全终态；取消/新 run/卸载会真实 abort 底层 fetch（含 reader.cancel）；SSE parser 支持 LF 与 CRLF、尾帧 flush、畸形帧 typed 错误；chat store 只接受当前 run 的结果，旧 run 迟到写入被丢弃。

## 范围内

- **`frontend/src/api/realtime.ts`（P1-07 + P2-14 编排侧）**：
  - `RealtimeDeps.fetchSnapshot` 返回 typed `SnapshotResult`（`{ ok: boolean; status: number | null; events: StreamEvent[] }` 或等价结构），不再用 `[]` 表示失败；
  - `streamGeneration`：snapshot 失败（!ok / 非 200）/ 空快照 / 快照不含 durable 终态事件（chat.completed）→ **不调用 applyTerminalSnapshot 完成**，返回 `exhausted`（typed 非终态失败，UI 显示恢复失败而非安全完成）；只有合法终态快照才完成；
  - `RealtimeDeps.resume/fetchSnapshot` 接受 `AbortSignal`（P2-14 编排侧）；`streamGeneration` 将 handle 的信号传入 deps；取消/中止时返回 cancelled 而非继续。
- **新增 `frontend/src/api/sse-parser.ts`（P2-15）**：
  - 从 chat.vue 移出并泛化：`readSseEvents(body, epoch, signal?)`（或等价纯函数）——LF 与 **CRLF**（`\r\n\r\n`）帧边界、`data:` 行（含 `\r` 尾随）、尾帧 flush（流结束未闭合帧按事件处理）、TextDecoder stream 解码；
  - typed 错误：`SseParseError`（畸形帧/非 JSON/无 data 行）与取消（AbortError）区分；错误不再静默吞成空流。
- **`frontend/src/pages/chat/chat.vue`（P2-14 传输侧）**：
  - 移除内嵌 `readSseEvents`/parser 与裸 fetch；改用 `sse-parser`；
  - resume/snapshot fetch 使用每 run 的 `AbortController`（signal 来自 handle/run）；`onCancel`/新 run/`onUnmounted` 触发 `controller.abort()`（fetch 中止 + reader.cancel 语义）；
  - 401/403/404 → NOT_FOUND_OR_FORBIDDEN（存在性不披露，保持）；5xx/网络/超时 → typed 失败（exhausted），不再返回空快照伪装完成。
- **`frontend/src/stores/chat.ts`（P2-17 + P2-14 store 侧）**：
  - run 序号（自增）与 handle 绑定：`run()` 递增序号并记录当前序号；`streamGeneration` 返回后仅当序号仍是当前 run 才提交 `stream/phase/outcome`，否则丢弃（旧 run 迟到写入不覆盖新状态）；
  - `cancel()`/`reset()` 同时中止当前 handle 的 AbortController（P2-14 store 侧）；
  - `StreamHandle` 扩展：`{ cancelled: boolean; abort: () => void }` 或等价（createStreamHandle 携带 AbortController）。
- **`frontend/src/domain/stream-reducer.ts`（P1-07 防御纵深，最小变更）**：
  - `applyTerminalSnapshot` 增加终态校验：快照不含 durable 终态事件（chat.completed）时**不置 terminal**（返回非终态状态，调用方按失败处理）；既有 spec 断言相应更新。
- **测试**：
  - 新增 `sse-parser.spec.ts`：LF/CRLF 帧、多 data 行、尾帧 flush、畸形帧 typed 错误、AbortError；
  - `realtime.spec.ts` 增补：snapshot 失败/空/非终态 → exhausted 而非 completed；resume 取消 → cancelled；AbortSignal 传递；
  - `stores/chat.spec.ts` 增补：旧 run 迟到完成不覆盖新 run（双 run 交错）；cancel/reset abort 底层；
  - `stream-reducer.spec.ts` 更新：非终态快照不完成；
  - 全部既有用例保持（无删测）。

## 明确范围外

- 不改 `specs/contracts/realtime-contract.yaml`（只读真源；若实现揭示契约缺口则停止询问 Owner）。
- 不修后端（service/**）、P2-16/18/19、P3-03/04、P1-09 遗留（已闭环）。
- 不改 `frontend/src/api/auth.ts`/`transport.ts`（TASK-0103 已闭环）、main.ts、baseline/memory 文件、login/index/memory 页面。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。
- 条件风险 1（Generation/Realtime HTTP 纵切未实现——controller/dispatcher 缺失）不在本卡：本卡只修前端既有 transport/编排的正确性，不实现后端纵切。

## 输入和前置条件

- Base Commit 固定为 `c9c3ccce88a16528c9a8af28d49c92869d5c0f6f`（TASK-0103 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0104 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- 前端验证：`pnpm --dir frontend test:run`（vitest）+ `pnpm --dir frontend type-check` + `pnpm --dir frontend build`（定向验证）；本机 pnpm 10.32.1 / node v22.23.1。
- Canonical argv 保持机器策略规定的 `python`（受控 venv `~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀）；每次 doctor/precheck 干净 `TMPDIR=$(mktemp -d ...)`。
- 本卡 C2（frontend/** 无保护路径规则），但属实时状态机/安全边界：独立 Reviewer 按卡要求执行；不变量 INV-RT-001（event gaps/epoch 显式，客户端不伪造缺失 delta）必须保持。

## API / 事件 / 数据契约

- `RealtimeDeps.fetchSnapshot`：返回 typed `SnapshotResult`——`ok=false`（HTTP/parse 失败）与 `ok=true` 且空 events / 不含终态事件均可区分；`streamGeneration` 只对合法终态快照完成。
- `RealtimeDeps.resume/fetchSnapshot`：新增可选 `AbortSignal`；abort 后抛 `AbortError`（编排按 cancelled/exhausted 处理，不重试成伪造流）。
- `StreamHandle`：`{ cancelled: boolean; abort(): void }`；`createStreamHandle()` 返回绑定 AbortController 的 handle。
- `streamGeneration` 返回值/outcome 语义不变（completed/cancelled/not_found_or_forbidden/exhausted）；snapshot 失败 → exhausted（非终态 typed 失败）。
- SSE parser：`readSseEvents(body, epoch, signal?) → { disposition, events }`，支持 LF/CRLF；畸形帧抛 `SseParseError`（调用方按 typed 失败处理，不静默空流）。
- chat store：`run`/`cancel`/`reset` 签名不变；内部 run 序号保证单写者。
- 无后端/契约/DB 变更。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据/凭据；测试为合成 fixture。
- 不向任何存储写入 token（TASK-0103 语义保持）；realtime 事件 payload 不含凭据。
- 快照/事件只在内存 reducer 中处理；不写日志、URL 或模型上下文。

## 状态机和失败行为

- 快照恢复：fetchSnapshot 失败（网络/5xx/parse）→ exhausted（UI"恢复失败，请重试"，非"安全终态"）；快照合法（含 chat.completed）→ terminal completed；快照空/非终态（IN_PROGRESS 等）→ exhausted（不伪装完成）。
- 取消：cancel/new run/unmount → handle.abort() → fetch abort + reader.cancel → streamGeneration 返回 cancelled（或 abort 后立即取消检查）。
- SSE 解析：LF/CRLF 帧正常切分；尾帧 flush；畸形帧 → typed SseParseError → resume 失败路径（exhausted 或按 disposition 处理），绝不静默空流。
- 并发 run：旧 run 完成后序号不匹配 → 丢弃结果（不覆盖新 run 状态）；reset 后旧 run 同样被丢弃。
- 任一测试失败保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095..0103 先例），本地等价验证（vitest + type-check + build + canonical precheck）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆、SafetyGate；不引入新依赖、SaaS 或付费运行时。
- INV-RT-001 保持：reducer 仍不伪造缺失 delta；snapshot 只做权威替换。

## 验收标准

1. **P1-07 快照失败不伪装完成**：fetchSnapshot 失败（!ok/5xx/网络/parse）、空快照、不含 chat.completed 的非终态快照 → `streamGeneration` 返回 `exhausted`（不置 terminal、不显示"安全终态"）；含 chat.completed 的合法快照 → completed（spec 断言全部路径）。
2. **P2-14 真实 abort**：每 run 的 AbortController 绑定 handle；cancel/new run/unmount 触发 `controller.abort()` 且底层 fetch 收到 abort signal（reader.cancel 语义）；abort 后编排返回 cancelled 且不重试（spec 断言 signal 传递与取消路径）。
3. **P2-15 SSE parser**：LF 与 CRLF 帧边界均正确切分；多 data 行拼接；流结束尾帧 flush；畸形帧（非 JSON/无 data 行）抛 typed SseParseError 而非静默空流；AbortError 区分（spec 全路径）。
4. **P2-17 单写者**：双 run 交错——旧 run 迟到完成不覆盖新 run 的 stream/phase/outcome（序号守卫断言）；cancel/reset 中止当前 run 且旧结果丢弃。
5. **INV-RT-001 保持**：reducer 不伪造缺失 delta 的既有 spec 全部保持 PASS；stream-reducer.spec 只增补非终态快照断言。
6. **前端验证**：`pnpm --dir frontend test:run` 全 PASS；type-check PASS；build PASS（定向验证）；canonical precheck 5/5 PASS。
7. **交付闭环**：Diff 仅含 writeAllowlist；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`pnpm --dir frontend test:run` 是任务特有前端门禁（precheck 不含前端），只运行一次；`git diff --check` 只运行一次。type-check/build 作为定向验证记录。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/环境身份。

## 回滚或前向修复

- 修复采用最小前端变更；若测试失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 无持久数据变更；回滚 = 修正文件后重跑 vitest/type-check/build 与 precheck。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 realtime-contract.yaml、transport.ts/auth.ts（TASK-0103 闭环物）、package.json（新依赖）、main.ts、service/** 等）时立即停止并询问 Owner。
- 实现揭示 realtime-contract.yaml 契约缺口（如 disposition 语义与前端假设不符）时停止并询问 Owner（契约变更需 contract-change + 独立决策）。
- 条件风险 1（后端纵切未实现）若成为阻塞（如需要真实后端端点才能验证）时按既有 Alpha 离线契约以合成/测试路径验证，不扩大范围。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0104/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0104.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、解释器/环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。
