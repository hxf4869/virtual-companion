# TASK-0182 Review R1 (C2, independentReview not-required — 长线惯例产出)

- taskId: TASK-0182
- reviewer: task0182_r1 (independent-review-gate; C2 → independentReview: not-required,
  reviewers: []；本 review 照 TASK-0173..0181 长线惯例产出)
- candidateCommit: (TASK-0182 candidate, single-parent over base 241b8d6d)
- riskClass: C2
- policySurfaces: [BACKEND] (single surface; distinctCrossRiskSurfaces=1;
  no protected-path threshold triggered — specs/openapi/** 非 protected-path)

## R1 scope (COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK)

## 1. Write-scope (writeAllowlist / forbiddenPaths)

- Changed paths (git status --porcelain -uall): 6 modified + 4 new, 全部在 writeAllowlist 内。
  - modified: specs/openapi/virtual-companion.yaml (+ticket 端点 +2 schema)、
    specs/openapi/dist/{api-bundle.yaml, openapi.snapshot.json,
    java/.../VirtualCompanionApi.java, typescript/api.ts}（generate 重建）、
    AuthDataSourceConfig（+3 realtime bean +3 import）。
  - new: RealtimeTicketController（runtime/realtime/web）、
    RealtimeTicketControllerTest（runtime/realtime/web）、
    specs/openapi/dist/java/.../RealtimeTicket.java + RealtimeTicketCreateRequest.java
    （生成 record）、任务卡 + context-lock + evidence-pack + review-r1 + handoff。
- forbiddenPaths 关键设计：本卡是纵切系列首次写 specs/openapi/**，故把 0180/0181 的
  `specs/**` 整体禁拆为精确 `specs/catalog/**` + `specs/contracts/**` + `specs/generated/**`
  （三个 C3 保护路径，全部未碰），放行 `specs/openapi/**`（源 + dist 经 writeAllowlist）。
  其余 forbidden 照 0181：0170-0181 历史产物（TASK-017[0-9]-*/TASK-018[01]-*）、
  migration V1-V29（V[1-9]__*/V[1-2][0-9]__*，本卡不改 migration）、
  tests [0-9][0-9]_*.sql + run-rls-tests.sh、modelruntime/safety/adapters、
  auth/worker/web/conversation/generation/relationship/message/cancel/memory/loopback
  各包、persistence 既有类与测试逐个禁（含 RealtimeTicketRepository/ResumeService/
  EventRepository 三类——只读消费不改）、frontend、harness、scripts 等。
- 无保护路径被触碰：specs/contracts（C3）、specs/catalog（C3）、specs/generated（C3）、
  db/migration（C4）、safety（C4）、modelruntime（C3）、adapters（C3）全部只读或不依赖。
  specs/openapi/** 不在 protected-paths 清单（非保护路径），本卡改它同步契约已定义的
  ticket path（realtime-contract.yaml L7）不触发 contract-change skill。

## 2. OpenAPI 源 + dist 一致性（TASK-0023 单源契约）

- 源新增 `POST /api/v1/realtime/tickets`（operationId createRealtimeTicket，200 RealtimeTicket
  / 400 INVALID_REQUEST / 401 / 404 NOT_FOUND_OR_FORBIDDEN）+ schema
  RealtimeTicketCreateRequest{generationId,sessionId,origin,streamEpoch,afterSeq}
  + RealtimeTicket{ticketId,secret}（均 string 必填）。端点放在 snapshot 端点后（realtime
  域聚集）；schema 放在 GenerationSnapshot 后、Message 前。
- prose 明确：owner 来自 principal 不在 body、transport 服务端固定 FETCH_SSE、secret 一次性
  返回（sha256-only）、foreign/absent generation→404 不披露、consume 留 SSE 卡。
- dist 经 `python scripts/dev/openapi_tool.py generate` 确定性重建：api-bundle.yaml +82、
  openapi.snapshot.json（operations +createRealtimeTicket，source sha256 更新）、
  VirtualCompanionApi.java（+createRealtimeTicket 方法）、typescript/api.ts、新
  RealtimeTicket.java + RealtimeTicketCreateRequest.java record；ErrorCode.java 不变
  （复用 NOT_FOUND_OR_FORBIDDEN/INVALID_REQUEST，未加新 enum）。
- `openapi_tool.py validate` PASS + `diff` PASS（源与生成物一致，drift gate 绿）。
- dist 变化只含 ticket 相关（无无关 stale 修正——本卡改源前 dist 本就一致）。

## 3. RealtimeTicketController 核验

- owner 来源：`@AuthenticationPrincipal(expression = "accountId") long ownerUserId`——
  server-trusted，不在 body（INV-TENANT-001，客户端 owner 声明不成为身份真源）。
- transport：服务端常量 `TRANSPORT_FETCH_SSE = "FETCH_SSE"`，硬编码不从 body 取——
  契约 alpha 唯一 transport（realtime-contract transport.alpha: [FETCH_SSE]），
  避免 WEBSOCKET 等禁止值；RealtimeTicketRepository.validateIssue 也强制 FETCH_SSE，
  双重保险。
- parseId(generationId/streamEpoch 正数) + parseNonNegative(afterSeq≥0，0=从头 resume)：
  非数字/非正→IAE→400；@Valid @NotBlank 拦截缺字段→400。
- issue 调用参数精确透传（ownerUserId/generationId/sessionId/origin/FETCH_SSE/streamEpoch/
  afterSeq），与 RealtimeTicketRepository.issue 签名一致。
- 异常翻译（关键，0180 教训）：issue 内部 ensure_realtime_stream 对 foreign/absent
  generation RAISE → DataAccessException；全局 AuthExceptionHandler 会把 DataAccessException
  误映射 401（除非 SQLSTATE 42xxx→503）。controller catch 顺序正确：
  `catch (BadSqlGrammarException e) { throw e; }`（schema 错上抛→全局 503）
  → `catch (DataAccessException e) { throw new ResourceNotFoundException("generation"); }`
  （业务 raise→404 不披露）。BadSqlGrammarException 是 DataAccessException 子类，catch
  顺序先具体后通用，Java 语义正确。
- DTO：RealtimeTicketCreateRequest（5 @NotBlank string）+ RealtimeTicketResponse(ticketId,
  secret)，嵌套 record 照 MemoryController 模式。

## 4. AuthDataSourceConfig bean wiring

- +3 @Bean：realtimeTicketRepository / realtimeResumeService / realtimeEventRepository，
  均 `new X(authJdbcTemplate)`（照既有 persistence bean 模式 L246-307，如 generationStateService）。
- 本卡 controller（组件扫描注册）注入 ticketRepository；resume/eventRepository wire 后
  本卡无消费者——为 TASK-0183 SSE 卡铺路。三个均为纯 repository（无 @PostConstruct/
  init），wire 无副作用，Spring 允许未使用 bean。
- @ConditionalOnProperty(auth.datasource-enabled=true) 顶层已覆盖（AuthDataSourceConfig
  类级），3 个 bean 随之条件装配；无 DB 时不装配（fail closed，与既有 bean 一致）。

## 5. 测试（RealtimeTicketControllerTest 9 场景）

- standalone MockMvc + mock RealtimeTicketRepository + 自定义 @AuthenticationPrincipal
  resolver（复刻 MemoryControllerTest，返回 Principal(1,"USER","alice")）+
  setControllerAdvice(new RuntimeApiExceptionHandler())。
- happy：issue 返回 IssuedTicket(99,"secret-uuid") → 200 + ticketId/secret；verify issue
  参数 ownerUserId=1（来自 principal）/transport=FETCH_SSE（固定）/其余透传；afterSeq=0 合法。
- generation foreign/absent：repository 抛 DataAccessException（匿名子类，非 BadSqlGrammar）
  → 404 NOT_FOUND_OR_FORBIDDEN（不披露）。
- BadSqlGrammarException：repository 抛 → controller 上抛（assertThrows + hasCauseOfType
  沿 cause 链断言 BadSqlGrammarException，验证不误映射 404）。standalone MockMvc 无该异常
  resolver，故用 assertThrows 而非 getResolvedException()——正确处理。
- 非法 generationId（非数字 "not-a-number" / "0"）→ 400；零 streamEpoch → 400；
  负 afterSeq（"-1"）→ 400；缺 sessionId → 400；缺 origin → 400。

## 6. Modulith 结构（RuntimeModuleStructureTest）

- runtime.realtime.web 包依赖 platform.persistence（RealtimeTicketRepository）+ runtime.web
  （ResourceNotFoundException）——不依赖 auth/generation/conversation 等 web 子包（照
  memory.web/generation.web 模式）。RuntimeModuleStructureTest PASS（BUILD SUCCESS 内）。

## 7. Validation evidence (Owner 2026-08-12 static-gates-only)

- run-rls-tests.sh: 69/69 PASS（V8 未改；test 19-25/49/50/61 realtime resume 状态机 +
  67/68 external 链 regression）。
- `./mvnw -pl service/apps/runtime -am test`: BUILD SUCCESS — runtime 320/0/0
  （+9：RealtimeTicketControllerTest），persistence 102/0/0（不变），modelruntime 173/0/0；
  RuntimeModuleStructureTest Modulith PASS；0 failure 0 skip。
- `openapi_tool.py diff`: PASS（源与 dist 一致）。
- git diff --check: exit 0。
- context-lock: round-trip 复现 TASK-0181 fingerprint 4661a263（自验通过），再生 0182
  b717b548；卡 readAllowlist 147 条与 lock inputs 147 文件条目逐一相等（脚本核验），
  +1 provenanceOnly = 148 inputs。
- nextAction 三处（project-state / evidence-pack / handoff）字节一致，
  sha256 c30657d9。
- doctor / canonical precheck / complete unittest discover / root mvn verify:
  NOT_RUN, deferred per Owner (static-gates-only) — recorded in evidence.

## 8. INVARIANTS

- INV-RT-001（gap/epoch 显式、不伪造 delta）：本卡只 mint ticket，不涉及事件流；ticket
  bindTo 七元组含 streamEpoch/afterSeq，consume 时校验（SSE 卡）。不变。
- INV-TENANT-001（vc_api NO BYPASSRLS + FORCE RLS）：owner 取自 principal（server-trusted），
  SD 调用经 owner-injection filter SET vc.owner_user_id + V8 内部 set_config + FORCE RLS
  owner_isolation。foreign generation → ensure_realtime_stream 零行 RAISE → 404 不披露。
- INV-TX-001 / INV-GEN-003：ticket 不触碰终态事务（只 mint 凭据）。
- INV-HARNESS-001/002/003/005/007/009：单活动任务、writeAllowlist/forbiddenPaths 边界、
  Evidence 真实（PASS 绑实际执行）、context-lock 锁定 baseCommit、nextAction 三处一致。

## R1 verdict

PASS（no P0/P1, no ACCEPTANCE_VIOLATION, no INVARIANT_VIOLATION）。C2 卡：
requiredSkills task-delivery-flow + task-intake（无 contract-change——不碰 specs/contracts/），
independentReview not-required（本 review 照长线惯例产出）。
Non-blocking notes: (P2) realtime SSE resume 端点 path 在 realtime-contract.yaml resume 段
未命名，TASK-0183 需补（改 specs/contracts/ → C3 contract-change）；(P3) controller 直接
调 repository 无中间 service 层（单端点最简，异常翻译集中在 createTicket，可审计）。
No fix batch.
