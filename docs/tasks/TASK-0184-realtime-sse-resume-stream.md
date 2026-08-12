# TASK-0184：realtime Fetch-SSE resume 端点（契约补 resume endpoint + GET stream + SseEmitter；C3 contract-change）

```yaml
taskId: TASK-0184
state: ACCEPTED
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - contract-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  contract-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 1879ab722ac37ec140539b413e7f1150bd23df7e
authorizationCommit: "plan-approved-2026-08-13-realtime-sse-resume"
contextFingerprint: 2aebe476779cc8416d9ece6c37322f4d7edee9b5a30a88ba457bb28f4f86845a
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0184.context-lock.yaml
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
  riskClass: C3
  surfaceId: TASK_0184_REALTIME_SSE_RESUME_STREAM
  policySurfaces: [CONTRACT, BACKEND]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
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
  - docs/tasks/TASK-0182-realtime-ticket-http-api.md
  - docs/tasks/TASK-0183-doctor-task-ledger-grandfather-derivation.md
  - docs/tasks/context/TASK-0183.context-lock.yaml
  - docs/evidence/TASK-0183/evidence-pack.json
  - docs/evidence/TASK-0183/review-r1.md
  - docs/handoffs/TASK-0183.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/contract-change/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/realtime/web/RealtimeTicketController.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/realtime/web/RealtimeTicketControllerTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ResumeResult.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/StreamSnapshot.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/web/RuntimeApiExceptionHandler.java
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - scripts/dev/openapi_tool.py
writeAllowlist:
  - specs/contracts/realtime-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/realtime/web/RealtimeStreamController.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/realtime/web/RealtimeStreamControllerTest.java
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/context/TASK-0184.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0184/**
  - docs/handoffs/TASK-0184.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-018[0-3]-*
  - docs/tasks/context/TASK-018[0-3].context-lock.yaml
  - docs/evidence/TASK-018[0-3]/**
  - docs/handoffs/TASK-018[0-3].json
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
  - scripts/dev/**
  - .github/workflows/**
  - specs/catalog/**
  - specs/generated/**
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/contracts/worker-lease-contract.yaml
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/platform/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/loopback/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/generation/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/relationship/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/web/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/message/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/cancel/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/memory/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/realtime/web/RealtimeTicketController.java
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/conversation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/generation/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/relationship/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/message/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/cancel/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/memory/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/loopback/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/realtime/web/RealtimeTicketControllerTest.java
  - pom.xml
  - "**/db/migration/**"
  - infra/**
  - frontend/**
  - .mvn/**
  - mvnw
  - mvnw.cmd
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
  - skills/contract-change/SKILL.md
  - specs/contracts/realtime-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - docs/handoffs/TASK-0183.json
requiredInvariants:
  - INV-RT-001
  - INV-TENANT-001
  - INV-TX-001
  - INV-GEN-003
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
    sourceThreadId: 0184-realtime-sse-resume-stream-2026-08-13
    evidence: >-
      Owner 2026-08-13 长线授权继续 generation/companion 纵切（一次一张新卡，idle DRAFT 治理例外）。
      TASK-0183 闭环后 nextAction 指向 realtime SSE resume 端点。经代码调研确认 V8 resume_stream /
      consume_realtime_ticket / read_generation_snapshot SECURITY DEFINER 函数与 persistence 的
      RealtimeResumeService（resume/readSnapshot）+ RealtimeTicketRepository（consume，9 参含 secret）
      已实现并已在 AuthDataSourceConfig wire 为 bean（L321-334），但 runtime 无 SSE 端点消费它们。
      关键发现：契约 realtime-contract.yaml resume 段（L20-32）定义了 cursor/epoch/sseHeader/
      5 种 dispositions/gapEvent/resetEvent/snapshotEndpoint，但缺 endpoint 字段（resume 端点 path
      未命名）→ 本卡必须改 specs/contracts/realtime-contract.yaml（触发 C3 contract-change skill +
      independentReview required）。Owner 2026-08-13 现场拍板三个设计决策：① SSE resume 端点 path =
      GET /api/v1/realtime/streams/{generationId}（与 ticket 端点同 realtime 前缀）；② SSE 选型 =
      SseEmitter（servlet stack 原生，与现有 webmvc + JDBC 一致，不引入 webflux）；③ ticket 的
      ticketId/secret/sessionId/origin/streamEpoch 走 query string（secret 是 45s 单次短期凭据，
      longLivedTokenInRealtimeQueryForbidden 只禁 long-lived token，不冲突；配 access log 脱敏），
      afterSeq 走 SSE 标准 Last-Event-ID 头（浏览器原生 EventSource 不能设自定义 header）。范围：
      改 realtime-contract.yaml resume 段补 endpoint/ticketBinding/ticketBoundTo/deniedEvent +
      OpenAPI 加 GET stream 端点 + RealtimeStreamEvent schema + generate 重建 dist +
      RealtimeStreamController（SseEmitter + consume + resume 5 种 disposition 映射）+ 12 项测试 +
      runtime pom 加 jackson-databind compile（SSE controller 解析 envelope JSON）。不改 V8 migration
      （只 read resume_stream）、不改 catalog、不改其他 contracts、不改 modelruntime/safety/adapters。
      C3 卡：requiredSkills task-delivery-flow + task-intake + contract-change(1.0.0)、
      independentReview required + 结构化 reviewers 数组（C3 不要求 humanApproval）。
independentReview: required
reviewers:
  - id: task0184_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 7bca79c98cc3ae1e9bdc3326220f769519333191
    evidencePath: docs/evidence/TASK-0184/review-r1.md
    reason: "R1 完整复核 PASS（candidate 回填）：C3 contract-change 先改契约真源（resume 段补 endpoint）+ OpenAPI 同步无漂移；controller 5 disposition 全映射 + fail-closed stream.denied 不披露 + 建连前后错误分离 + BadSqlGrammar re-throw 503；INV-RT-001/TX-001/GEN-003 保持；context-lock 44 inputs 钉 base 1879ab7 + ledger 5 字段完整 + nextAction 三处 sha256 bd27fbcc 一致；forbiddenPaths 精确未越界。"
    candidateTree: 1649713c798b038c50879dcae210b160ebebf3a6
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion
> 纵切的 realtime SSE resume 端点卡（TASK-0021 realtime 契约纵切），承接 TASK-0183 闭环后的
> nextAction，沿用 `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），
> 与 TASK-0173..0183 同属 idle DRAFT 治理例外，不进 backlog。**触碰 C3 保护路径**
> `specs/contracts/**`（realtime-contract.yaml resume 段补 endpoint，contract-change skill 1.0.0 +
> independentReview required，C3 不要求 humanApproval），并通过 openapi_tool generate 重建
> `specs/openapi/dist/**`（非 protected-path，随契约同步）。不触碰 catalog/generated、migration、
> safety、memory、modelruntime 或其他 contracts。

## 背景与用户可观察目标

TASK-0182 交付了 realtime ticket HTTP 端点（POST /api/v1/realtime/tickets，mint 单次短期 resume
ticket）与三个 realtime persistence bean 的 wire（RealtimeTicketRepository / RealtimeResumeService /
RealtimeEventRepository）。但 SSE resume 端点（消费 ticket + 调 resume_stream 续传）当时因契约
resume 段无 endpoint 字段、且需 C3 contract-change 而拆到本卡。

**契约缺口（代码核实）**：`specs/contracts/realtime-contract.yaml` resume 段（L20-32）定义了
`cursor: eventSeq`、`epoch: streamEpoch`、`sseHeader: Last-Event-ID`、5 种 dispositions
（RESUMED / TERMINAL_SNAPSHOT / GAP_EXPIRED / RESET_REQUIRED / NOT_FOUND_OR_FORBIDDEN）、
`gapEvent: stream.gap`、`resetEvent: stream.reset`、`snapshotEndpoint`，但**没有 endpoint 字段**
（resume 端点 path 在契约和 OpenAPI 均未命名）→ 必须先改契约补 endpoint，触发 C3 contract-change。

**已就绪底座（不改）**：
- V8 `vc.resume_stream(owner, generation, streamEpoch, afterSeq)` → 5 种 disposition 状态机
  （SQL 层由 infra/db tests 19-25/49/50/61 全覆盖）。
- V8 `vc.consume_realtime_ticket`（9 参含 secret，校验 sha256 secret + 七元组 + single-use + 45s TTL）。
- `RealtimeResumeService.resume()` / `readSnapshot()` 与 `RealtimeTicketRepository.consume()` 已实现。
- 三个 realtime bean 已在 `AuthDataSourceConfig`（L321-334）wire 为 `@ConditionalOnProperty(datasource-enabled)`。

用户可观察结果（本卡完成后）：

- **契约完整**：realtime-contract.yaml resume 段有 `endpoint`、`ticketBinding`、`ticketBoundTo`、
  `deniedEvent` 字段；OpenAPI 源同步 `GET /api/v1/realtime/streams/{generationId}`（text/event-stream）
  + `RealtimeStreamEvent` schema，generate 重建 dist 无漂移。
- **SSE 端点可用**：`GET /api/v1/realtime/streams/{generationId}` 消费单次 ticket + 调 resume_stream，
  5 种 disposition 全映射为 SSE 事件；ticket 失败 / 越权 fail closed 为 `stream.denied`（不披露存在）。
- **测试**：12 项 standalone MockMvc（asyncDispatch）覆盖 RESUMED / TERMINAL_SNAPSHOT / GAP_EXPIRED /
  RESET_REQUIRED / NOT_FOUND_OR_FORBIDDEN / ticket 失败 / Last-Event-ID cursor / 4 项 400 / BadSqlGrammar re-throw。

## 范围内

1. **`specs/contracts/realtime-contract.yaml` resume 段**：补 `endpoint: GET /api/v1/realtime/streams/{generationId}`、
   `ticketBinding: query`、`ticketBoundTo: [ticketId, secret, sessionId, origin, streamEpoch]`、
   `deniedEvent: stream.denied`（ticket 失败/越权统一 fail closed 不披露）。
2. **`specs/openapi/virtual-companion.yaml`**：加 `GET /api/v1/realtime/streams/{generationId}`
   （text/event-stream；GenerationId path + ticketId/secret/sessionId/origin/streamEpoch query required +
   Last-Event-ID header optional；200 text/event-stream + 400 INVALID_REQUEST + 401）+ `RealtimeStreamEvent`
   schema（event/id/data）；`openapi_tool.py generate` 重建 `specs/openapi/dist/**`。
3. **`service/apps/runtime/.../realtime/web/RealtimeStreamController.java`**（新）：`@RestController` +
   `@ConditionalOnProperty(datasource-enabled)`，注入 RealtimeTicketRepository + RealtimeResumeService；
   `@GetMapping(produces=text/event-stream)` 返回 SseEmitter：parse path/query/Last-Event-ID → 400 if
   malformed → consume ticket（BadSqlGrammar re-throw 503；其他 RuntimeException → stream.denied）→
   resume → 按 disposition 发事件（RESUMED/TERMINAL_SNAPSHOT 发 durable events，逐个 id=eventSeq；
   GAP_EXPIRED→stream.gap；RESET_REQUIRED→stream.reset；NOT_FOUND_OR_FORBIDDEN→stream.denied）→ complete。
4. **`service/apps/runtime/pom.xml`**：显式声明 `jackson-databind` compile（原仅经 jjwt-jackson 以
   runtime scope 传递；SSE controller 在 compile 期解析 envelope JSON，提升为 compile，版本由 Boot BOM 管理）。
5. **`RealtimeStreamControllerTest.java`**（新，12 项）：standalone MockMvc + asyncDispatch，5 种
   disposition + ticket 失败 + Last-Event-ID cursor + 4 项 400 + BadSqlGrammar re-throw。
6. 终态治理闭环：runtime mvn test 全绿 + openapi diff PASS + git diff --check exit 0 + 结构化
   review-r1 + Evidence/Handoff + 单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **改 V8 migration 或任何 `**/db/migration/**`**（resume_stream 只 read，SQL 状态机不动）。
- **改 specs/contracts/ 其他契约、catalog、generated**（protected）。
- **改 service/modules、adapters、safety、memory、modelruntime、platform/persistence**（protected 或
  非本卡；realtime persistence 已实现，本卡只消费）。
- **H5 端 SSE 消费实现**（本卡只交付服务端 SSE 端点；H5 Fetch-SSE 客户端是 TASK-0026 范围）。
- **长连接订阅模式**（本卡是断线续传当前积压的一次性 resume，resume_stream 返回积压后 complete，
  非持续推送）。
- **doctor / canonical precheck / 完整 unittest discover**（Owner 2026-08-13 策略：跳过长检查只完成
  任务；Evidence 如实标注 deferred，不标 PASS）。

## 输入和前置条件

- Base `1879ab7` = TASK-0183 ACCEPTED terminal（已 push、HEAD==origin/main、0/0、clean；nextAction
  三处 sha256 `e49a7c2b...` 一致；doctor 绿、ledger 0 errors）。
- DRAFT 前已复核：realtime-contract.yaml resume 段（L20-32 缺 endpoint）；V8 resume_stream（L597-690，
  5 种 disposition）+ consume_realtime_ticket（L532-587，9 参）；RealtimeResumeService.resume（L33）+
  RealtimeTicketRepository.consume（L64）；AuthDataSourceConfig realtime bean wire（L321-334）；
  RealtimeTicketController（0182 controller 模板）+ RealtimeTicketControllerTest（0182 MockMvc 模板）；
  RuntimeApiExceptionHandler（IllegalArgumentException→400 / ResourceNotFoundException→404）；
  ResumeResult/StreamSnapshot record；Spring Boot 4.1.0 + spring-boot-starter-webmvc（servlet stack，
  非 webflux）→ SseEmitter；jackson-databind 经 jjwt-jackson runtime scope 传递（compile 期不可见）。
- context lock 输入钉在 Base（44 inputs = 43 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint `2aebe476...`
  由复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0183 `4deb540c...` 通过，再生 0184）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。JDK 25：
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`。本卡不碰 DB（run-rls SKIP）。

## Harness 契约与治理边界

- 触碰 `specs/contracts/**`（protected-paths C3，requiredSkill contract-change 1.0.0 +
  independentReview required；C3 **不要求 humanApproval**）。
- contract-change skill 1.0.0 要求：READY 列出 contract-change@1.0.0 + 生产者/消费者/兼容/失败语义/
  不变量；先改唯一 Contract 真源再同步实现/测试；独立 Reviewer 从失败场景复核。本卡先改
  realtime-contract.yaml resume 段，再同步 OpenAPI + controller + test，符合"先契约后实现"。
- `specs/openapi/**` 非 protected-path（OpenAPI 源 + dist 随契约同步，generate 保持单源一致）。
- `INV-RT-001`（client 只推进最后连续序号、gap 停止拼接、不伪造缺失 delta）由 resume_stream 的
  envelope 编码 + controller 逐个 id=eventSeq 发送保持；`INV-TX-001`/`INV-GEN-003`（chat.completed
  只在事务提交后可见）由 TERMINAL_SNAPSHOT 路径保持（resume_stream 只返回 committed 事件）。
- 不改 V8 migration、catalog、generated、其他 contracts、modelruntime/safety——均 forbiddenPaths。

## 状态机和失败行为

- 建连前：参数 malformed/missing（path generationId 非数字、query 缺失/非正、Last-Event-ID 负）→
  IllegalArgumentException → RuntimeApiExceptionHandler → 400 INVALID_REQUEST。
- 建连后 ticket consume：BadSqlGrammarException（schema 不可用）→ re-throw（全局 advice 503）；
  其他 RuntimeException（secret 错/过期/重放/绑定不匹配）→ 单个 `stream.denied` + complete（不披露）。
- resume disposition：RESUMED/TERMINAL_SNAPSHOT → 发 durable events（id=eventSeq）+（TERMINAL_SNAPSHOT
  先发 snapshot）；GAP_EXPIRED → `stream.gap`；RESET_REQUIRED → `stream.reset`；
  NOT_FOUND_OR_FORBIDDEN → `stream.denied`；default → `stream.denied`。全部 complete。
- resume_stream 对 NOT_FOUND_OR_FORBIDDEN 返回 disposition（不抛异常），故越权生成走 disposition 路径。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆/业务数据（realtime SSE 传输层）。安全边界：consume_realtime_ticket 校验
sha256 secret + 七元组 + single-use + 45s TTL，任何失败 fail closed（stream.denied 不披露存在）；
owner 从 server-verified principal 取（不从 query），owner GUC 由上游 owner-injection filter 绑定，
SD 调用在 server-trusted 租户上下文；transport 服务端固定 FETCH_SSE（不从 query）；secret 是 45s
单次短期凭据（非 long-lived token），`longLivedTokenInRealtimeQueryForbidden` 只禁 long-lived，不冲突，
配 access log 脱敏。

## 验收标准

1. `realtime-contract.yaml` resume 段补 `endpoint`/`ticketBinding`/`ticketBoundTo`/`deniedEvent`。
2. `specs/openapi/virtual-companion.yaml` 加 `GET /api/v1/realtime/streams/{generationId}`（text/event-stream
   + GenerationId/ticketId/secret/sessionId/origin/streamEpoch/Last-Event-ID 参数 + 200/400/401）+
   `RealtimeStreamEvent` schema；`openapi_tool.py generate` 重建 dist，`openapi_tool.py diff` PASS。
3. `RealtimeStreamController`：consume ticket（BadSqlGrammar re-throw / 其他 → stream.denied）→
   resume → 5 种 disposition 全映射 SSE 事件 → complete；400 参数校验在建连前。
4. `RealtimeStreamControllerTest`（12 项）：5 种 disposition + ticket 失败 + Last-Event-ID cursor +
   4 项 400 + BadSqlGrammar re-throw，全 PASS。
5. `runtime mvn test`：332 tests（320 既有 + 12 新增），0 failures。
6. `git diff --check` exit 0。
7. Evidence 如实记录；doctor / canonical precheck / 完整 unittest deferred per Owner（不标 PASS），
   policy 测试卡住、authorizationCommit 占位符记 knownRisk。
8. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（runtime mvn test 一次；openapi_tool diff 一次；
同一无参 `git diff --check` 一次）。run-rls（69 项）SKIP：不改 V8 migration（只 read resume_stream），
无 DB 回归风险。doctor / canonical precheck / 完整 unittest discover 按 Owner 策略 deferred。

## 回滚或前向修复

- 若 runtime mvn test 暴露 controller/test 问题：最多 1 fix batch 修 controller/test/pom。
- 若 openapi diff 报漂移：重新 generate 重建 dist（不手改生成物）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 V8 migration 或 resume_stream 状态机：立即停止（超出本卡授权，需新卡）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（0170-0183 产物、其他 contracts、catalog、
  generated、migration、safety/memory/modelruntime、.harness 真源、scripts/skills/ci、其他 service java）。
- runtime mvn test / openapi diff / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0184/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0184.json`。
