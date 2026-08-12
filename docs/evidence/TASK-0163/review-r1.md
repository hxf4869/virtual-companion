# R1 Independent Review — TASK-0163（§5.1.1 前端 realtime envelope `event` 字段修复）

- Reviewer: `task0163_r1`（independent-review-gate，static-only，fresh TMPDIR 重跑）
- Candidate commit: `91f654eae6709fa3b139bac0773ca9a7e8388594`
- Candidate tree: `7f88592813d01d69f0421af80c218e25dabd8983`
- Base commit: `8db787e3dfe71a1e17f8fb912bb968ba7216f996`（TASK-0162 ACCEPTED terminal）
- Verdict: **PASS** — 0 P0 / 0 P1 / 0 P2（2 个非阻塞 P3 观察）

## 1. 复核范围

R1 覆盖 complete matrix / acceptance / invariants / adjacent risk，静态 only（Owner 2026-08-12
static-gates-only 策略；完整 Harness unittest deferred to unified audit）。

Diff scope（`8db787e..91f654e`）恰好 6 路径，全部 ∈ writeAllowlist，无一 ∈ forbiddenPaths：

| 路径 | 性质 |
|---|---|
| `.harness/project-state.yaml` | activeTask/nextAction 治理投影 |
| `docs/tasks/TASK-0163-frontend-realtime-envelope-event-field.md` | 任务卡 |
| `docs/tasks/context/TASK-0163.context-lock.yaml` | context lock（fingerprint c1552b4c） |
| `frontend/src/api/realtime-envelope.ts` | 新增纯函数模块 |
| `frontend/src/api/realtime-envelope.spec.ts` | 新增 glue 测试（10） |
| `frontend/src/pages/chat/chat.vue` | 移除内联 parseEvent + 引用 parseStreamEvent |

无 protected-path 被触碰：`frontend/src/**` 不在 `protected-paths.yaml`；`specs/**`、`service/**`、
`**/db/migration/**`、`infra/db/**`、`scripts/harness/**`、`.github/workflows/**`、`skills/**`、
治理 yaml（除 project-state）均未改。无 C3/C4 protected-rule 触发；C2 卡，本卡自声明 R1 静态独立复核。

## 2. 缺陷确认与修复正确性

**缺陷（当前 HEAD 已确认）**：后端 realtime envelope 权威 wire 字段是 `event`
（`specs/catalog/realtime-events.yaml` `envelopeRequired` 含 `event` 无 `eventType`；V8
`vc.resume_stream`/`vc.read_generation_snapshot` 均 `jsonb_build_object('event', e.event_type, ...)`；
SQL 测试 `50_realtime_event_catalog.sql:131`、`23_resume_terminal_snapshot.sql:79,90,91,94` 断言
`el->>'event'`）。前端 `chat.vue` 旧内联 `parseEvent` 读 `value.eventType` → 真实 envelope 进来
`eventType=undefined→""` → 返回 null → 在 candidates 循环被静默丢弃；所有真实 catalog 事件被前端丢弃、
流永不到 terminal（INV-RT-001 可观察性隐性回归）。

**修复正确性**：
- `parseStreamEvent` 读 `String(value.event ?? "")`，对齐 catalog 权威字段；内部仍赋值给
  `StreamEvent.eventType` 属性（reducer `event.eventType === TERMINAL_EVENT_TYPE` 判终态逻辑不变）。
- 失败语义与原 `parseEvent` 逐行等价：非 record / `eventSeq` 非有限数 / `streamEpoch` 非有限数 /
  `event` 缺失或空 → null。故 chat.vue 的 candidates/null 过滤循环、reducer 的 gap/reset/terminal
  行为零变更。
- 不保留 `value.eventType` 回退（会掩盖契约漂移、留死代码），符合"对齐 catalog 契约"的唯一正确修复。
- chat.vue：仅 import 替换 + 移除内联 `parseEvent` + 两处调用点改名；`isRecord` 保留（fetchSnapshot
  snapshot-data 校验仍用）；页面 setup/template/style 不动。

**回归门禁**：`realtime-envelope.spec.ts` 含显式回归用例 "drops a real envelope that carries only
`eventType`"（旧 bug 形状）→ 必须 null，证明修复不接受错误字段。覆盖 delta/`chat.completed` terminal/
`chat.replace`/`chat.cancelled`/`safety.notice`/缺 event/空 event/epoch 回退/非有限 eventSeq/非 record/
payload 透传。

## 3. 独立静态门禁重跑（fresh TMPDIR `/tmp/vc_t0163_r1.afx2A0`）

| 门禁 | 结果 | 证据 |
|---|---|---|
| doctor --task TASK-0163 | **PASS** | 775074 checks，103.9s（fresh TMPDIR 全量，非 receipt cache） |
| canonical precheck（profile=precheck 8 子命令） | **PASS** | doctor/catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck/betaRosterGate/openapiValidate/openapiDrift 全 exit 0 |
| `pnpm -C frontend run type-check`（vue-tsc --noEmit） | **PASS** | exit 0 |
| `pnpm -C frontend run test:run`（vitest） | **PASS** | 16 files / 148 tests（含新增 realtime-envelope.spec.ts 10；chat.spec.ts 3 / stream-reducer 12 / sse-parser 10 / realtime 14 全绿） |
| `git diff --check` | **PASS** | exit 0，无 whitespace 错误 |

注：canonical 与 diff --check 各按策略执行（实现者官方一次 + R1 fresh TMPDIR 独立复核一次，目的不同，
非"重复挑 PASS"）。完整 Harness unittest discover 按 static-gates-only 策略 deferred to unified audit
（列入 requiredCommands 但本卡不跑，不转换为 PASS）。

## 4. 不变量与相邻风险

- **INV-RT-001**（client never fabricates missing deltas）：reducer/transport 契约未改；修复反而消除
  "真实事件被静默丢弃→UI 永不终态"的隐性回归，恢复正确的连续 cursor 推进与 terminal 收口。
- **INV-HARNESS-002/003/005/007/009**：唯一活动任务、writeAllowlist 内、Evidence 不把未跑转 PASS、
  single-card policy、LOCAL_EXACT_TREE_FALLBACK 冻结于 READY（remote exact-SHA 如实非 PASS，
  dispatchCount=0）。
- 无新依赖（`package.json`/`pnpm-lock.yaml` 未改，license-inventory 无变化，licenseCheck PASS）。
- 无 API/事件/数据契约变更（catalog wire 字段 `event` 是既有权威，前端对齐之）。
- `isRecord` 在 chat.vue/sse-parser.ts/realtime-envelope.ts 各有一份（仓库既有重复模式，本卡未新增
  chat.vue 的 isRecord——它本来就存在；非回归）。

## 5. 发现项

- **P0**：0
- **P1**：0
- **P2**：0
- **P3（非阻塞）**：
  1. `isRecord` 在前端三处重复（既有模式；如需收敛可后续独立小卡，不在本卡范围）。
  2. 未跑 `pnpm build`（type-check + vitest 对此最小改动已充分；build 留 unified audit）。

## 6. 结论

**R1 PASS**。修复最小、正确、契约对齐；静态门禁 fresh TMPDIR 独立重跑全 PASS；0 P0/P1/P2。§5.1.1
前端 realtime envelope `event` 字段缺陷完整落地，真实后端 catalog 事件不再被前端静默丢弃。完整
unittest deferred per Owner static-gates-only 策略。
