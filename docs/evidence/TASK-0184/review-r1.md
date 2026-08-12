# TASK-0184 R1 独立复核 — realtime SSE resume 端点（C3 contract-change）

- taskId: TASK-0184
- reviewer: independent-review-gate (task0184_r1)
- reviewedCommit: 0000000000000000000000000000000000000000（candidate 回填占位）
- candidateTree: 0000000000000000000000000000000000000000（candidate 回填占位）
- evidencePath: docs/evidence/TASK-0184/review-r1.md
- verdict: PASS

## 范围与契约复核（contract-change skill 1.0.0）

- **契约真源先改**（contract-change Procedure 4）：`specs/contracts/realtime-contract.yaml` resume 段（原 L20-32）确缺 `endpoint` 字段；本卡补 `endpoint: GET /api/v1/realtime/streams/{generationId}` + `ticketBinding: query` + `ticketBoundTo: [ticketId, secret, sessionId, origin, streamEpoch]` + `deniedEvent: stream.denied`。生产者=RealtimeStreamController，消费者=未来 H5 Fetch-SSE 客户端（TASK-0026）；兼容窗口=Alpha FETCH_SSE 唯一传输；失败语义=stream.denied fail closed 不披露。符合 contract-change Preconditions（列生产者/消费者/兼容/失败语义/不变量）。
- **OpenAPI 同步**：`specs/openapi/virtual-companion.yaml` 加 GET 端点（text/event-stream；GenerationId path + 5 query required + Last-Event-ID header optional）+ `RealtimeStreamEvent` schema（event/id/data）。`openapi_tool.py generate` 重建 dist（含新增 `RealtimeStreamEvent.java`），`diff` PASS、`validate` PASS——单源一致，无手改生成物。
- **未越界**：forbiddenPaths 精确禁 specs/contracts 其余 10 文件（放行 realtime-contract.yaml）、service 其余 java（放行 RealtimeStreamController/test + runtime pom）、.harness 真源（放行 project-state/task-ledger）、catalog/generated/migration/skills。writeAllowlist 12 路径，diff 全在其中（git status 核对）。

## 失败场景复核（contract-change Procedure 6：从失败场景复核）

- **5 disposition 全映射**（ResumeResult 常量）：RESUMED→逐个 durable event（id=eventSeq）；TERMINAL_SNAPSHOT→snapshot + durable events；GAP_EXPIRED→stream.gap；RESET_REQUIRED→stream.reset；NOT_FOUND_OR_FORBIDDEN→stream.denied；default→stream.denied。测试逐覆盖（5 个用例）。
- **fail closed 不披露**：ticket consume 失败（DataAccessException：secret 错/过期/重放/绑定不匹配）→ 单个 stream.denied + complete，**resume 不被调用**（verify resume never called）；NOT_FOUND_OR_FORBIDDEN 同样 stream.denied。存在性不披露（realtime-contract deniedEvent 语义）。
- **建连前 vs 建连后错误分离**：参数 malformed/missing（path 非数字、query 缺失/非正、Last-Event-ID 负）→ IllegalArgumentException → RuntimeApiExceptionHandler → 400 INVALID_REQUEST（建连前，HTTP 错误体）；建连后业务错误 → SSE 事件（不 HTTP 错误体）。4 项 400 测试覆盖。
- **BadSqlGrammarException re-throw**（schema 不可用）：不被 catch 为 stream.denied，re-throw 走全局 503（照 0182 controller 模式）。assertThrows hasCauseOfType 覆盖。
- **INV-RT-001 保持**：resume_stream 返回 envelope 编码 durable events（committed_at/event_seq 排序），controller 逐个 id=eventSeq 发送，client 只推进最后连续序号；missing deltas 从不伪造（resume_stream 只返回 persisted durable events）。
- **INV-TX-001/INV-GEN-003 保持**：TERMINAL_SNAPSHOT 路径——resume_stream 只返回 committed 事件（chat.completed 只在 finalize/cancel/fail 事务提交后由 append_terminal_event 写入），resume/snapshot 永不发布未提交终态事件。

## 实现复核

- **SseEmitter 选型**：servlet stack 原生（Spring Boot 4.1.0 + spring-boot-starter-webmvc），无需 webflux；与现有 JDBC/owner-injection filter 链一致。一次性 resume（积压发完 complete），非长连接订阅——符合 Alpha resume 语义。
- **consume_realtime_ticket 9 参完整**：owner（principal）+ ticketId（query→long）+ secret（query）+ generationId（path→long）+ sessionId/origin（query）+ transport（固定 FETCH_SSE，不从 query）+ streamEpoch（query→long）+ afterSeq（Last-Event-ID header→long，默认 0）。与 V8 consume_realtime_ticket 签名（L532-587）+ RealtimeTicketRepository.consume（L64）完全对齐。
- **jackson-databind compile**：原经 jjwt-jackson runtime scope 传递（compile 期不可见 JsonNode）；controller 解析 envelope JSON 需 compile 依赖。显式声明（无版本，Boot BOM 管理 2.21.4），R1 确认仅用于 SSE envelope 解析，无版本锁定风险。pom 注释说明提升理由。
- **参数校验**：@RequestParam(required=false) + 手动 requireNonBlank/parseId → 缺失统一 IllegalArgumentException → 400（避免 MissingServletRequestParameterException 不被 RuntimeApiExceptionHandler 处理）。与 OpenAPI required:true 契约等价。

## 治理复核

- **context-lock**：44 inputs（43 readAllowlist + 1 provenanceOnly owner-authorization cc0f91c1），baseCommit 1879ab7（TASK-0183 terminal），contextFingerprint 2aebe476。复刻 verify_context_lock 算法（harness_common.py:260-339）round-trip 复现 0183 4deb540c 自验通过后再生 0184。readAllowlist 含 realtime 契约/代码 read 项 + contract-change SKILL。
- **ledger TASK-0184 完整 5 字段**（state:ACCEPTED + contractVersion:2 + taskCard + evidence + handoff）——照 0176/0183，不重蹈 0177-0182 漏字段（grandfather warn 不应触发）。
- **nextAction 三处 sha256 一致**（bd27fbcc）：project-state.yaml（yaml >- 折叠，round-trip 验证）+ evidence-pack.json nextAction + handoff.json nextAction，均 = 同一单行文本；仅引用已注册 TASK-0184（本卡），未引用未注册 task ID（doctor P2-22 规则）。
- **C3 independentReview required + 结构化 reviewers 数组**（照 TASK-0181/0183）；C3 不要求 humanApproval（protected-paths specs/contracts/** independentReview:true 无 humanApproval）；humanApprovals 仅 task-assignment（Owner 授权 3 个设计决策）。
- **最小验证全 PASS**：runtime mvn 332/0/0（含 12 新增）+ openapi diff PASS + git diff --check exit 0。doctor/canonical precheck/完整 unittest deferred per Owner（如实标 NOT_RUN，不标 PASS）。

## 结论

R1 PASS：契约真源先改且同步 OpenAPI 无漂移；5 disposition 全映射 + fail-closed 不披露 + 建连前后错误分离 + BadSqlGrammar re-throw；INV-RT-001/TX-001/GEN-003 保持；context-lock 复现自验 + ledger 5 字段完整 + nextAction 三处一致；forbiddenPaths 精确未越界。knownRisks 如实（doctor/precheck deferred、secret query 脱敏建议、jackson compile 依赖、policy 测试卡住）。
