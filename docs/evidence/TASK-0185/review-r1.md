# TASK-0185 R1 自检 — H5 realtime transport 对齐 0184 resume endpoint 契约（C2 task-intake）

- taskId: TASK-0185
- reviewer: self-review (C2 independentReview not-required)
- reviewedCommit: b1d5d5765456f98efe0cc0f007c650aef2a714b1
- candidateTree: 835c8d55031afd93f7ee058ab151c6acfc6156dd
- evidencePath: docs/evidence/TASK-0185/review-r1.md
- verdict: PASS

> C2 条件风险卡（independentReview not-required）。本记录为交付前自检，非独立 Reviewer gate；照
> task-delivery-flow C2 自检范围（writeAllowlist 合规 + forbiddenPaths 未越界 + 不变量保持 + 验证全 PASS）。

## writeAllowlist / forbiddenPaths 合规

- **改动文件（5）全在 writeAllowlist**：frontend/src/api/realtime-transport.ts（新）、realtime-transport.spec.ts
  （新）、sse-parser.ts、sse-parser.spec.ts、pages/chat/chat.vue。git status 核对无越界。
- **未触碰 forbiddenPaths**：specs/contracts/**（0184 已定，消费方不改）、specs/openapi/**（不重建 dist）、
  service/**、migration、catalog/generated、.harness 真源（放行 project-state/task-ledger）、frontend 非写
  目标源（精确文件名 auth/baseline/memory/realtime/realtime-envelope/transport + domain/stores/pages 非 chat.vue
  + 配置文件）、0170-0184 产物、scripts/skills/ci。forbiddenPaths glob 不覆盖写目标（sse-parser.*/realtime-
  transport.*/chat.vue 用精确名，realtime.ts 精确名不匹配 realtime-transport.ts）。

## 契约对齐复核（0184 resume endpoint）

- **mint ticket wire**：POST /api/v1/realtime/tickets body `{generationId, sessionId, origin, streamEpoch, afterSeq}`
  （全 decimal string），owner/transport 服务端固定不入 body（与 OpenAPI RealtimeTicketCreateRequest 一致）；
  401/403/404→null 存在性隐藏（不打 resume stream）。spec 验证 body 字段 + owner/transport undefined。
- **resume stream wire**：GET /api/v1/realtime/streams/{generationId}?ticketId&secret&sessionId&origin&streamEpoch
  （path 携带 generationId）+ Last-Event-ID: afterSeq header（SSE 标准 cursor）。spec 验证 URL + query + header。
- **每次 resume 重 mint**：ticket 单次 45s（consume 后失效），streamGeneration 重连循环每次 mint 新 ticket。
  spec 验证两次 resume 两次 mint。
- **5 disposition 映射**（mapFrames）：stream.gap→GAP_EXPIRED；stream.reset→RESET_REQUIRED（nextEpoch 从 data
  提取，缺则 reducer fallback）；stream.denied→NOT_FOUND_OR_FORBIDDEN；snapshot→TERMINAL_SNAPSHOT（snapshot.events
  替换 draft，applyTerminalSnapshot 只在含 chat.completed 时 complete）；durable envelope→RESUMED
  （parseStreamEvent 读 catalog `event` 字段）。spec 逐覆盖 5 disposition。
- **存在性不披露**：mint/stream 401/403/404 统一 NOT_FOUND_OR_FORBIDDEN（不区分原因）；5xx throw（exhausted，
  非空流伪装断连）。spec 覆盖 mint 404/stream 403。

## sse-parser 扩展复核

- **关键 gap 修复**：0184 controller 用 SSE event: name 编码控制信号（stream.gap/reset/denied 只有 event: 行
  无 data: 行），原 sse-parser 只解析 data: 行且"无 data 帧跳过"→ 控制事件全丢弃 → transport 永远 RESUMED。
- **扩展（向后兼容）**：SseFrame 加可选 event；flushFrame 解析 event: 行；有 event 无 data 的帧 push
  {event, data:null}；无 event 无 data（comment/keepalive : ping）仍跳过。realtime.spec.ts 14 项（未动逻辑层）
  + sse-parser.spec.ts 原 10 项全绿（向后兼容确认）。

## 不变量保持

- **INV-RT-001**（只推进最后连续序号、gap 停止、不伪造 delta）：transport 只路由 disposition + 解析 envelope，
  reducer 逻辑（stream-reducer.ts）不变；missing deltas 从不伪造。
- **h5Security**：ticket secret 45s 单次短期凭据走 resume query（非 long-lived token，
  longLivedTokenInRealtimeQueryForbidden 不冲突）；long-lived access token 仍由 auth transport Bearer header，
  不进 localStorage（longLivedTokenInLocalStorageForbidden 保持）。

## 治理复核

- **C2 定位**：frontend/** 非 protected；不改 specs/contracts/openapi → 不触发 contract-change/catalog-change；
  requiredSkills task-delivery-flow(1.3.7)+task-intake(1.2.7)；independentReview not-required。
- **context-lock**：43 inputs（42 readAllowlist + 1 provenanceOnly owner-authorization cc0f91c1），baseCommit
  a323cddf（TASK-0184 terminal），contextFingerprint 072a97e1。复刻 verify_context_lock round-trip 复现 0184
  2aebe476 自验通过后再生 0185。
- **ledger TASK-0185 完整 5 字段**（state:ACCEPTED + contractVersion:2 + taskCard + evidence + handoff）。
- **nextAction 三处 sha256 一致**（b747317c）：project-state.yaml（yaml >- 折叠 round-trip 验证 == 单行）+
  evidence-pack.json nextAction + handoff.json nextAction；仅引用已注册 TASK-0185（本卡），未引用未注册 task ID。
- **最小验证全 PASS**：frontend vitest 170 passed + type-check exit 0 + git diff --check exit 0。
  doctor/canonical precheck/完整 unittest deferred per Owner（如实标 NOT_RUN，不标 PASS）。

## 结论

自检 PASS：transport 对齐 0184 resume endpoint 契约（mint+path+query+Last-Event-ID+5 disposition）+ sse-parser
扩展 event: 解析修复控制事件丢弃 + 19 项 transport spec/3 项 sse-parser spec；INV-RT-001/h5Security 保持；
context-lock 复现自验 + ledger 5 字段 + nextAction 三处一致；forbiddenPaths 精确未越界。knownRisks 如实
（doctor/precheck deferred、sessionId demo 来源、stream.reset nextEpoch fallback、policy 测试卡住）。
