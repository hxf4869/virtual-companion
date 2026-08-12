# TASK-0163：前端 realtime envelope `event` 字段修复（§5.1.1）

```yaml
taskId: TASK-0163
state: IN_PROGRESS
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 8db787e3dfe71a1e17f8fb912bb968ba7216f996
authorizationCommit: "76da1dc219525dde439dc2b1f42488dae758a92b"
contextFingerprint: c1552b4c89d66d3fc8655ee553ad43a9ef05a8a6d08dabafab9134c833062109
contextLock: docs/tasks/context/TASK-0163.context-lock.yaml
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
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 30, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0163_FRONTEND_REALTIME_ENVELOPE_EVENT_FIELD
  policySurfaces: [FRONTEND_TRANSPORT]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0163
  - pnpm -C frontend run type-check
  - pnpm -C frontend run test:run
  - python -m unittest discover -s scripts/harness/tests -p "test_*.py"
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/realtime-events.yaml
  - specs/contracts/realtime-contract.yaml
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/chat/chat.spec.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/sse-parser.spec.ts
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/domain/stream-reducer.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/package.json
  - frontend/tsconfig.json
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - docs/evidence/TASK-0162/evidence-pack.json
  - docs/evidence/TASK-0162/review-r1.md
  - docs/handoffs/TASK-0162.json
  - docs/tasks/TASK-0162-p2-13-admin-seed-concurrency-guard.md
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - frontend/src/api/realtime-envelope.ts
  - frontend/src/api/realtime-envelope.spec.ts
  - frontend/src/pages/chat/chat.vue
  - docs/tasks/TASK-0163-frontend-realtime-envelope-event-field.md
  - docs/tasks/context/TASK-0163.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0163/**
  - docs/handoffs/TASK-0163.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/TASK-0141-*
  - docs/tasks/TASK-0142-*
  - docs/tasks/TASK-0143-*
  - docs/tasks/TASK-0144-*
  - docs/tasks/TASK-0145-*
  - docs/tasks/TASK-0146-*
  - docs/tasks/TASK-0147-*
  - docs/tasks/TASK-0148-*
  - docs/tasks/TASK-0149-*
  - docs/tasks/TASK-0150-*
  - docs/tasks/TASK-0151-*
  - docs/tasks/TASK-0152-*
  - docs/tasks/TASK-0153-*
  - docs/tasks/TASK-0154-*
  - docs/tasks/TASK-0155-*
  - docs/tasks/TASK-0156-*
  - docs/tasks/TASK-0157-*
  - docs/tasks/TASK-0158-*
  - docs/tasks/TASK-0159-*
  - docs/tasks/TASK-0160-*
  - docs/tasks/TASK-0161-*
  - docs/tasks/TASK-0162-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - docs/tasks/context/TASK-0145.context-lock.yaml
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - docs/tasks/context/TASK-0148.context-lock.yaml
  - docs/tasks/context/TASK-0149.context-lock.yaml
  - docs/tasks/context/TASK-0150.context-lock.yaml
  - docs/tasks/context/TASK-0151.context-lock.yaml
  - docs/tasks/context/TASK-0152.context-lock.yaml
  - docs/tasks/context/TASK-0153.context-lock.yaml
  - docs/tasks/context/TASK-0154.context-lock.yaml
  - docs/tasks/context/TASK-0155.context-lock.yaml
  - docs/tasks/context/TASK-0156.context-lock.yaml
  - docs/tasks/context/TASK-0157.context-lock.yaml
  - docs/tasks/context/TASK-0158.context-lock.yaml
  - docs/tasks/context/TASK-0159.context-lock.yaml
  - docs/tasks/context/TASK-0160.context-lock.yaml
  - docs/tasks/context/TASK-0161.context-lock.yaml
  - docs/tasks/context/TASK-0162.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/evidence/TASK-0142/**
  - docs/evidence/TASK-0143/**
  - docs/evidence/TASK-0144/**
  - docs/evidence/TASK-0145/**
  - docs/evidence/TASK-0146/**
  - docs/evidence/TASK-0147/**
  - docs/evidence/TASK-0148/**
  - docs/evidence/TASK-0149/**
  - docs/evidence/TASK-0150/**
  - docs/evidence/TASK-0151/**
  - docs/evidence/TASK-0152/**
  - docs/evidence/TASK-0153/**
  - docs/evidence/TASK-0154/**
  - docs/evidence/TASK-0155/**
  - docs/evidence/TASK-0156/**
  - docs/evidence/TASK-0157/**
  - docs/evidence/TASK-0158/**
  - docs/evidence/TASK-0159/**
  - docs/evidence/TASK-0160/**
  - docs/evidence/TASK-0161/**
  - docs/evidence/TASK-0162/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/handoffs/TASK-0142.json
  - docs/handoffs/TASK-0143.json
  - docs/handoffs/TASK-0144.json
  - docs/handoffs/TASK-0145.json
  - docs/handoffs/TASK-0146.json
  - docs/handoffs/TASK-0147.json
  - docs/handoffs/TASK-0148.json
  - docs/handoffs/TASK-0149.json
  - docs/handoffs/TASK-0150.json
  - docs/handoffs/TASK-0151.json
  - docs/handoffs/TASK-0152.json
  - docs/handoffs/TASK-0153.json
  - docs/handoffs/TASK-0154.json
  - docs/handoffs/TASK-0155.json
  - docs/handoffs/TASK-0156.json
  - docs/handoffs/TASK-0157.json
  - docs/handoffs/TASK-0158.json
  - docs/handoffs/TASK-0159.json
  - docs/handoffs/TASK-0160.json
  - docs/handoffs/TASK-0161.json
  - docs/handoffs/TASK-0162.json
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
  - scripts/harness/**
  - .github/workflows/**
  - specs/**
  - service/apps/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/**/*.java
  - service/**/pom.xml
  - service/platform/persistence/src/main/resources/db/migration/**
  - infra/db/**
  - .mvn/**
  - pom.xml
  - mvnw
  - mvnw.cmd
  - frontend/src/domain/stream-reducer.ts
  - frontend/src/domain/stream-reducer.spec.ts
  - frontend/src/api/realtime.ts
  - frontend/src/api/realtime.spec.ts
  - frontend/src/api/sse-parser.ts
  - frontend/src/api/sse-parser.spec.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/chat.spec.ts
  - frontend/src/pages/chat/chat.spec.ts
  - frontend/package.json
  - frontend/package-lock.json
  - frontend/pnpm-lock.yaml
  - frontend/tsconfig.json
  - frontend/vite.config.ts
  - frontend/uni.config.ts
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
  - .harness/tools.lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/realtime-events.yaml
  - specs/contracts/realtime-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0162.json
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
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权长线审计修复一次一张新卡推进；2026-08-12 在 TASK-0162（P2-13 admin seed
      并发保护）ACCEPTED 闭环后接续评估剩余 OPEN/OWNER_GATE 项。经当前 HEAD（8db787e）对 §5.1 新审计
      候选并行复核，确认 §5.1.1 为真实缺陷：后端 realtime envelope 权威字段是 `event`
      （specs/catalog/realtime-events.yaml envelopeRequired + V8 resume_stream/read_generation_snapshot
      jsonb_build_object('event', ...) + SQL 测试 50/23 断言 el->>'event'），而前端解析器
      frontend/src/pages/chat/chat.vue:70 内联 parseEvent 读 `value.eventType`——真实 envelope 进来
      eventType=undefined→""→parseEvent 返回 null→在 :120 静默丢弃，所有 catalog 事件被前端丢弃、
      流永不到 terminal；无任何前后端 glue 测试覆盖（前端测试 mock resume 绕过解析器）。Owner
      2026-08-12 确认 §5.1.1 作为下一张 single-card。修复 = 抽取 wire envelope→StreamEvent 解析为
      纯函数 frontend/src/api/realtime-envelope.ts（读 catalog 权威字段 `event`，仿 TASK-0104 抽取
      sse-parser 的先例使 transport glue 可单测），chat.vue 引用它，补真实 catalog envelope glue
      测试。纯前端、不触保护路径（frontend/src/** 非 protected-path）、不改 catalog/contract/service/
      DB。C2 + static-gates-only 验证 + R1 静态独立复核（INV-RT-001 契约敏感）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS（TASK-0162 R1 PASS 不复用）。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §5.1.1 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §5.1 第 1 项 / RISK-02 wire 字段）：
> 修复前端 realtime envelope 解析器读取权威字段 `event` 而非 `eventType`，让真实后端 catalog
> envelope 事件不再被前端静默丢弃。沿用 `owner-authorization://longline-2026-08-09` 长线授权
> （hash `cc0f91c1...`），与 TASK-0153..0162 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§5.1.1 / RISK-02（TASK-0109 审计 §5.1 第 1 项 "Frontend realtime envelope：event 与 eventType"）：
后端 realtime event 的权威 wire 字段名是 `event`，前端解析器只读 `eventType`，字段映射不匹配导致
事件被静默丢弃。

**当前 HEAD（8db787e）核实的缺陷链**：

1. 后端 wire 字段 = `event`（权威）：
   - `specs/catalog/realtime-events.yaml` `envelopeRequired` 含 `event`（无 `eventType`）。
   - `V8__realtime_resume_ticket_gap_reset_snapshot.sql` 的 `vc.resume_stream`（line 645-650、675-680）
     和 `vc.read_generation_snapshot`（line 721-726）均 `jsonb_build_object('event', e.event_type, ...)`。
   - `RealtimeResumeService.java` 直通 SQL JSONB blob，无重命名；`RealtimeEventRecord.java` javadoc
     确认 envelope 形状 `event`。
   - SQL 测试 `50_realtime_event_catalog.sql:131`、`23_resume_terminal_snapshot.sql:79,90,91,94` 断言
     `el->>'event'`。
2. 前端解析器只读 `eventType`：`frontend/src/pages/chat/chat.vue:70`
   `const eventType = String(value.eventType ?? "");`——真实 envelope（`{event:"chat.delta",...}`）
   进来 `value.eventType` 为 undefined → `""` → parseEvent 返回 null → 在 `:120` 被 `if (event)` 静默
   过滤。**所有真实后端 catalog 事件被前端丢弃；由于 terminal 事件（`chat.completed`）也匹配不到，
   流永远到不了 terminal。**
3. 无 glue 测试：`chat.spec.ts` stub fetch 抛错、`sse-parser.spec.ts` 只测帧分割（输入 `{eventSeq:N}`）、
   `realtime.spec.ts`/`stores/chat.spec.ts` mock 了 `resume` 完全绕过 `parseEvent`。前后端字段对接处
   处于测试盲区。TASK-0104 改的是帧分割/释放/cancel，未触及此字段映射。

`StreamEvent.eventType`（`stream-reducer.ts:22`）只是内部 TS 属性名；reducer 用
`event.eventType === TERMINAL_EVENT_TYPE` 判终态。修复只改 wire→内部的解析点（读 wire `event` 赋给
内部 `eventType`），reducer/transport 契约不变。

**产品语义（经当前 HEAD 核实）**：catalog 是 wire 契约唯一真源，字段名 `event` 不可改（改 catalog 会
触 C3 protected-path 且破坏 SQL/测试一致）。**唯一正确修复是前端读 `event`**，对齐 catalog 契约。
保留 `value.eventType` 回退会掩盖契约漂移、留死代码，不采用。

用户可观察结果：
1. 前端解析真实后端 envelope（`{event:"chat.delta",...}`）时产出有效 `StreamEvent`，不再返回 null。
2. terminal 事件 `chat.completed` 能被解析并驱动 reducer 进入终态（流可达 terminal）。
3. 新增 `realtime-envelope.spec.ts` 用真实 catalog envelope（含 resume/snapshot/terminal 场景）覆盖
   wire→StreamEvent 解析，机器证明字段映射正确、回归有门禁。
4. chat.vue 的内联 `parseEvent`/`isRecord` 抽取为可单测的 `api/realtime-envelope.ts`（仿 TASK-0104
   抽取 `sse-parser` 的先例）。
5. 不改 catalog/contract/service/DB/migration；终态治理闭环。

## 范围内

1. **新增 `frontend/src/api/realtime-envelope.ts`**：导出纯函数
   `parseStreamEvent(value: unknown, fallbackEpoch: number): StreamEvent | null`，从 wire envelope 读
   catalog 权威字段 `event`（而非 `eventType`）作为事件类型，连同 `eventSeq`、`streamEpoch`（缺省回
   fallbackEpoch）、`payload`；非 record / `eventSeq` 非有限数 / `streamEpoch` 非有限数 / `event` 缺失
   或空 → 返回 null（与原 parseEvent 失败语义一致）。可附 `parseEnvelopeEvents(data, fallbackEpoch)`
   便利函数处理 `{events:[...]}` 批或单对象（对齐 chat.vue resume/snapshot 的 candidates 逻辑）。
2. **新增 `frontend/src/api/realtime-envelope.spec.ts`** glue 测试，用**真实 catalog envelope 形状**
   （`{schemaVersion:1,event,generationId,streamEpoch,eventSeq,committedAt,payload}`）覆盖：
   - delta（`chat.delta`）→ 有效 StreamEvent；terminal（`chat.completed`）→ 有效且 eventType 为
     `chat.completed`（reducer 据此判终态）。
   - resume 批 `{disposition,events:[...]}` 与 snapshot 批解析多事件。
   - 缺 `event` 字段 / `eventSeq` 非有限数 / 非 record → null（缺陷回归门禁：纯 `eventType` 的旧
     envelope 必须返回 null，证明不再误读）。
   - `streamEpoch` 缺省回退 fallbackEpoch。
3. **改 `frontend/src/pages/chat/chat.vue`**：删除内联 `parseEvent`/`isRecord`，从
   `@/api/realtime-envelope` import `parseStreamEvent`（及必要的便利函数），`resume` 与 `fetchSnapshot`
   两处改用它；行为对齐（candidates 处理、null 过滤逻辑不变）。
4. 终态治理闭环：pnpm type-check + vitest run + canonical precheck + git diff --check + R1 静态独立
   复核 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不改 `specs/catalog/realtime-events.yaml`（wire 字段 `event` 是权威真源，改它触 C3 且破坏 SQL/测试）。
- 不改 `specs/contracts/realtime-contract.yaml`。
- 不改任何后端：`service/**`、`V*.sql`、`RealtimeResumeService.java`、Java SSE 控制器。
- 不改前端 reducer/transport 契约：`stream-reducer.ts`、`realtime.ts`、`sse-parser.ts`、`stores/chat.ts`
  及其既有测试（这些是 read-only 输入，forbiddenPaths 已锁定）。
- 不改 `chat.spec.ts`（既有测试不动；新增 glue 测试放在独立 `realtime-envelope.spec.ts`）。
- 不改前端依赖/配置：`package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vite.config.ts` 等。
- 不引入 WebSocket/语音/图片/主动消息（Alpha 禁止能力不变）。
- 不处理其它 §5.1 候选（§5.1.2 worker claim fence、§5.1.3 provider_attempt snapshot、§5.1.4 quota、
  §5.1.6 V8/V11 存量）或 P1-04/05/11 等其它审计项。
- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit。

## 输入和前置条件

- Base `8db787e3dfe71a1e17f8fb912bb968ba7216f996` = TASK-0162 ACCEPTED terminal（已 push、0/0、clean；
  Doctor summary PASS 937719 checks；HEAD tree `c299ad2...`）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- 前端工具链：`pnpm -C frontend run type-check`（vue-tsc --noEmit）、`pnpm -C frontend run test:run`
  （vitest run）。pnpm@11.9.0。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0163`（profile=precheck 8 子命令，
  不含前端 vitest；前端测试是 affected-module，单独冻结在 requiredCommands 必跑）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck 限于
  macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不改 API/事件/数据契约。本卡使前端解析**对齐**既有 catalog wire 契约（`event` 字段，已由
`specs/catalog/realtime-events.yaml` + V8 SQL + SQL 测试 50/23 固化）。wire 字段名、envelope 形状、
resume dispositions、StreamEvent 内部类型均不变。

## 权限、RLS 和数据处理要求

不涉及。纯前端 transport 解析层修复，不接触鉴权/RLS/用户数据/凭据。

## 状态机和失败行为

- 实现 = 1 个新纯函数模块（~30 行）+ 1 个新 glue 测试（~80 行）+ chat.vue 局部改（删内联函数、改 import、
  两处调用点）。
- `parseStreamEvent` 失败语义与原 `parseEvent` 完全一致（非 record / eventSeq 非有限 / event 缺失 → null），
  故 reducer/transport 的 null 过滤、gap/reset/terminal 行为零变更。
- type-check + vitest run 全 PASS（含新增 spec）。若 chat.vue import 改动破坏类型或既有测试，vitest/type-check
  即时失败，据此迭代。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context fingerprint
  一致；本卡不触 protected-path，无 protected-path skill 要求）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 90min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡修复前端实时传输契约字段映射。

## 验收标准

1. 新增 `frontend/src/api/realtime-envelope.ts` 导出 `parseStreamEvent(value, fallbackEpoch)`，读 wire
   字段 `event`（非 `eventType`）作为事件类型；非 record / `eventSeq` 非有限 / `streamEpoch` 非有限 /
   `event` 缺失或空 → null。
2. 新增 `frontend/src/api/realtime-envelope.spec.ts` 用真实 catalog envelope 覆盖 delta/terminal/
   batch/缺字段回归（纯 `eventType` envelope 必须返回 null）/epoch 回退，全 PASS。
3. `chat.vue` 删除内联 `parseEvent`/`isRecord`，改 import `parseStreamEvent`；resume + fetchSnapshot
   两处调用点行为对齐（candidates/null 过滤不变）；页面其它逻辑不动。
4. `pnpm -C frontend run type-check` PASS（exit 0，vue-tsc --noEmit 无错）。
5. `pnpm -C frontend run test:run` 全 PASS（exit 0，含新增 spec + 既有 chat/sse-parser/realtime/
   stores/domain 全绿）。
6. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
7. 唯一无参数 `git diff --check` PASS（exit 0）。
8. R1 独立静态复核 PASS（0 P0/P1/P2，fresh TMPDIR 独立重跑 type-check/vitest/canonical/diff）。
9. 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
   （Evidence 如实标注，不转换为 PASS）。
10. 终态 pre-closure PASS、单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
    remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
11. INV-RT-001 维护：前端只推进最后连续序号、不伪造缺失 delta 的语义不因本次字段修复改变；修复反而
    消除"真实事件被静默丢弃→UI 永不终态"的隐性回归。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- `pnpm -C frontend run type-check`：前端类型检查（affected module，必跑）。
- `pnpm -C frontend run test:run`：前端 vitest（affected module，含新增 glue 测试，必跑；这是本卡
  修复正确性的主要证据，不可 defer）。
- canonical precheck 只跑一次（8 子命令不重复）。
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands
  但本卡不跑，doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）。
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 type-check/vitest 失败：最多 1 fix batch（修正 parseStreamEvent 字段读取或测试断言）
→ R2；若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner。本卡是前向新增模块 + chat.vue
局部 import 改动，无需回滚既有契约；若有缺陷，下一张 replacement 卡以 REJECTED terminal 为 Base 修正。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 catalog/contract、前端 reducer/transport
  契约模块、service/DB）。
- 修改了 wire 字段名（catalog `event`）或 reducer `StreamEvent.eventType` 内部属性 / reducer 逻辑。
- type-check / vitest / canonical precheck / diff check / pre-closure 任一非 PASS。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0163/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0163.json`。
