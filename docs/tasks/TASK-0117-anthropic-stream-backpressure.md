# TASK-0117：Anthropic 流式事件有界队列与可取消背压

```yaml
taskId: TASK-0117
state: READY
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 714fcd328c88d2977b58619090f72f5be85e9a48
authorizationCommit: ""
contextFingerprint: b3dc4e598b3f4c095da6da0de41237c1e916a1e581a92594a030879f684fe742
contextLock: docs/tasks/context/TASK-0117.context-lock.yaml
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
  riskClass: C3
  surfaceId: TASK_0117_ANTHROPIC_STREAM_BACKPRESSURE
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 85
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
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
  - AGENTS.md
  - CLAUDE.md
  - docs/evidence/TASK-0114/evidence-pack.json
  - docs/evidence/TASK-0114/review-r1.md
  - docs/evidence/TASK-0115/evidence-pack.json
  - docs/evidence/TASK-0115/review-r1.md
  - docs/evidence/TASK-0116/evidence-pack.json
  - docs/evidence/TASK-0116/review-r1.md
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0115.json
  - docs/handoffs/TASK-0116.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/tasks/TASK-0116-openai-stream-backpressure.md
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - docs/tasks/context/TASK-0116.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/BoundedInputStream.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/ImmediateTerminalSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/SseDecoder.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/StopReason.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/model-protocol-contract-tests/pom.xml
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/FailureModelProtocolAdapterContractTest.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/FakeModelProtocolAdapterContractTest.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolBoundaryContractTest.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolTestSupport.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBackpressureContractTest.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/tasks/context/TASK-0117.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0117/**
  - docs/handoffs/TASK-0117.json
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/tasks/TASK-0116-openai-stream-backpressure.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - docs/tasks/context/TASK-0116.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/evidence/TASK-0113/**
  - docs/evidence/TASK-0114/**
  - docs/evidence/TASK-0115/**
  - docs/evidence/TASK-0116/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0115.json
  - docs/handoffs/TASK-0116.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - infra/**
  - frontend/**
  - scripts/**
  - skills/**
  - requirements-harness.txt
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/tasks/task-card-template.md
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
  - "**/db/migration/**"
  - .mvn/**
  - service/apps/**
  - service/platform/**
  - service/adapters/model-openai/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/BoundedInputStream.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/ImmediateTerminalSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/SseDecoder.java
  - service/adapters/model-anthropic/src/test/**
  - service/modules/modelruntime/**
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/model-protocol-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
  - service/tests/generation-contract-tests/**
  - service/tests/memory-contract-tests/**
  - service/tests/safety-contract-tests/**
  - pom.xml
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
  - skills/model-routing-change/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/evidence/TASK-0114/evidence-pack.json
  - docs/evidence/TASK-0114/review-r1.md
  - docs/handoffs/TASK-0114.json
  - docs/tasks/TASK-0116-openai-stream-backpressure.md
  - docs/evidence/TASK-0116/evidence-pack.json
  - docs/evidence/TASK-0116/review-r1.md
  - docs/handoffs/TASK-0116.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-003
  - INV-AUTH-001
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 明确要求 Codex 接管全部后续审计修复并“不用询问我，作为长线任务跑下去”。
      TASK-0116 Handoff 与 project-state 的唯一下一动作逐字指定创建 TASK-0117，为 Anthropic streaming
      session 引入与 TASK-0116 等价的有界事件队列与可取消 backpressure；本卡不追溯改写历史任务。
  - scope: anthropic-stream-backpressure-capacity
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 长线授权明确将其余工程数值、拆卡、实现与验证细节交由 Codex 按机器真源、现有模式和
      最小风险原则决定；TASK-0116 已独立验收 64 个待消费 OutputDelta、3 个成功控制事件保留位和
      67 个事件引用绝对上界。本卡对 Anthropic 冻结同一私有上界，不进入公开配置或协议字段。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=usedMinutes=2000、
      paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110 exact-SHA run 31286798584
      在无 runner、零 step 状态终止；TASK-0112 至 TASK-0116 已按同一 READY 冻结 fallback 合规
      ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实为非 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0117
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests,service/tests/model-protocol-contract-tests -am test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。TASK-0116
> 已在当前 Base ACCEPTED 并把 TASK-0117 冻结为唯一下一动作。本卡从其终态提交重新冻结 Context，
> 以独立候选 Commit/Tree、Reviewer 和本地 exact-tree channel 关闭 Anthropic 无界事件队列。

## 背景与用户可观察目标

`AnthropicMessagesSession` 当前使用无容量参数的 `LinkedBlockingQueue`。Provider 可将合法输出拆成大量
微小 `text_delta`，而调用方消费更慢或暂时不调用 `next()`；即使单事件、raw response 与累计输出字节
均受限，解析线程仍能创建大量事件对象并持续排队，造成单请求内存放大并被并发请求叠加。

完成本卡后，Anthropic session 最多缓冲 64 个待消费 `OutputDelta`，并固定保留最多 3 个成功控制事件
位置。解析线程在容量边界释放状态锁等待；消费、cancel、timeout 与 close 均能唤醒它，body 最终关闭，
唯一终态不会因队列满而丢失或死锁，terminal 冻结后不再读取已缓冲的 late provider frame。

## 范围内

- 仅在 package-private `AnthropicMessagesSession` 内以 `ArrayDeque` 和同一 `stateLock` 实现有界
  producer/consumer：最多 64 个待消费 OutputDelta；structured/non-stream 成功批次最多再加入 final
  delta、UsageReported、AttemptEos 三个事件，绝对上界 67。
- `emitText` 在第 65 个待消费 delta 入队前等待；等待必须释放 `stateLock`，consumer 每次移除事件后
  `notifyAll`，不得 busy-spin、轮询睡眠或另起无界缓冲。
- terminal arbitration、sequence 分配和队列修改继续由同一锁串行化；failure/cancel 只需一个保留位置，
  success 最多使用三个，任何终态设置都必须唤醒被背压阻塞的 parser。
- `onStreamEvent` 在 terminal 冻结后立即返回 false；text delta 只有实际入队后才 mark first content，
  structured partial、ping 与 provider control frame 也不得在 terminal 后继续读取或累积。
- cancel/close/total-timeout 在满容量时有界返回，关闭 response body、取消 future、interrupt parser/worker；
  已接受事件保持顺序，terminal 最后且唯一，terminal 后 `next()` 永久 empty。
- 新增独立 Anthropic contract test 文件，以受控内存 HttpClient/InputStream 覆盖容量、一进一出恢复、满载
  cancel、满载 timeout、structured late-frame fence、body close、唯一终态、连续序列与成功回归。

## 明确范围外

- 不修改 TASK-0109 至 TASK-0116 的 Card、Context、Evidence、Review 或 Handoff，不重判历史结果。
- 不修改 ModelProtocolSession/Event、SizeLimits、公开 API/OpenAPI/Catalog、Anthropic config/codec/adapter/
  SSE parser、Provider 路由、授权、quota/retry、数据库、前端或 CI。
- 不修改累计 output、单 SSE event、raw response body、timeout 或 token 数值；64/3 只是 session 私有
  内存背压上界，不进入公开请求/响应或 runtime 配置。
- 不解决 Anthropic `maxTokens` provider-safe ceiling、连续 comment/empty-data frame 的连接级累计 raw
  byte budget，或 OpenAI 既有实现；这些风险继续拆分为后续独立卡。
- 不保证调用方永不停止消费时 session 可以成功完成；它必须保持内存有界，并由既有 total timeout 或
  显式 cancel 产生唯一失败/取消终态。

## 输入和前置条件

Base 是 TASK-0116 ACCEPTED 终态 `714fcd328c88d2977b58619090f72f5be85e9a48`，与 `origin/main`
0/0 且工作树干净。Context Lock 绑定该 Base 的机器真源、TASK-0114 至 TASK-0116 已接受边界证据、
模型协议合同、当前 Anthropic session/decoder/Invoker 调用链、相关 contract tests 与已接受 OpenAI 实现。

当前 session 由 worker virtual thread 等待 response 和 parser virtual thread；`next()` 是唯一 consumer。
现有 terminal arbitration 已由 `stateLock` 串行，但 unbounded queue 让 producer 不受 consumer 速度约束。

## API / 事件 / 数据契约

- 不改变 `ModelProtocolSession` 接口或事件 wire contract；输出事件 sequence 从 0 连续递增，完整 binding
  不变，Usage 至多一次，terminal 恰好一次且最后，terminal 后 `next()` 返回 empty。
- 64 是“尚未被 `next()` 移除的 streaming text OutputDelta”上限；parser 可持有当前已 decode 但尚未入队
  的一个 text delta。structured streaming 在 parser 内聚合，完成时原子加入 final delta、Usage 与 EOS。
- Anthropic 的 message_start、content block start/stop、message_delta、ping 与 message_stop 均不直接占用
  ModelProtocol 队列位置；text success 批次为 Usage/EOS 两项，structured/non-stream 最多三项。
- consumer 移除事件即释放一个缓冲位置；不要求下游处理完成确认。Provider socket/HTTP 缓冲不属于
  Java 事件队列，但 parser 在容量处不得继续 decode 后续 SSE event。
- 背压等待不是 Provider failure；只在既有 total timeout 到期时归一化为 `Timeout(TOTAL)`，显式取消仍为
  `AttemptCancelled`，I/O 中断或断开沿用既有失败映射。

## 权限、RLS 和数据处理要求

不修改租户、RLS、凭据、日志或数据库。队列和测试不得记录 provider content、prompt、schema、token、
真实联系人或用户数据；测试全部使用 synthetic bytes 和受控内存 HttpClient，不触发真实网络。

## 状态机和失败行为

- producer：若 terminal 未冻结且已有 64 个待消费 OutputDelta，则在 `stateLock.wait()` 上阻塞；被唤醒后
  必须重新检查 terminal 与容量，只有成功入队才分配 sequence 并标记 first content。
- consumer：等待空队列时可被 interrupt；中断恢复 interrupt flag、触发 cancel，并最终只观察合法顺序的
  已接受事件与唯一取消终态。每次 dequeue 后通知 producer。
- success：under lock 预检容量、冻结 terminal、原子加入最多 final delta、Usage、EOS 并通知全部等待者；
  保留的 3 个位置保证不因容量边界失败。
- failure/cancel：under lock 冻结唯一 terminal、加入单个终态并通知全部等待者；随后 lock 外 abort I/O，
  满队列时不得等待 consumer 才能返回。
- terminal 冻结后任何 `onStreamEvent` 立即停止 decoder；body close 和 thread interrupt 必须幂等。

## 模型、Prompt、记忆和安全边界

不改变模型选择、messages/schema/maxTokens、streaming request、memory、safety、授权 fence、quota 或重试。
背压只约束已标准化事件的进程内暂存数量，不成为新的网络、持久化或日志边界。

## 验收标准

1. 生产实现不再创建无界 `LinkedBlockingQueue`；无 consumer 的 streaming text flood 最多缓冲 64 个
   OutputDelta，parser 在尝试提交第 65 个时停止 decode 后续 event，绝对队列上界为 67。
2. consumer 每取走一个 OutputDelta，producer 至多继续提交一个；持续消费后全部 delta、Usage、EOS
   顺序完整、sequence 连续且 binding 不变，不丢失、不重复、不重排。
3. 队列已满时 `cancel()` 和 `close()` 在 1 秒内返回，关闭 body、停止 parser；随后 drain 得到已接受
   delta 后唯一 AttemptCancelled，terminal 后 `next()` 永久 empty，重复 cancel/close 幂等。
4. 队列已满且 consumer 停止时，既有 total timeout 在预算内冻结唯一 `AttemptFailed(Timeout(TOTAL))`、
   关闭 body 并唤醒 parser；恢复 drain 不死锁，无 Usage/EOS 或 late delta。
5. `next()` 空队列等待被 interrupt 时保留 interrupt flag、触发唯一取消终态且不遗留线程；terminal 冻结后
   text/structured/control frame 均停止读取，受控 structured sentinel 保持未读。
6. structured streaming 与 non-stream success 原子容纳 final delta、Usage、EOS 三事件；failure/cancel 终态
   不依赖空闲 output slot，provider control frame 不占 queue sequence，所有路径 body 最终关闭。
7. 生产代码只修改 Anthropic session；测试只新增独立 backpressure contract 文件。OpenAI、modelruntime、
   SizeLimits、specs、runtime app、数据库、前端和 CI 无变更，全部候选路径位于 writeAllowlist。
8. 定向 reactor、根级 Maven verify、canonical precheck 与唯一无参数 `git diff --check` 均在独立
   Reviewer PASS 后绑定同一冻结候选 Commit/Tree 并真实 PASS；远端保持非 PASS，不冒充本地结果。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。实现期间允许用精确 `-Dtest` 子集迭代；正式定向
reactor、根级 Maven、canonical 和无参数 `git diff --check` 各执行一次，不重复 canonical 已包含的
子命令。所有结果记录真实退出码、完整候选 Commit/Tree、环境与 stdout/stderr 哈希。

## 回滚或前向修复

候选冻结前可在唯一 fix batch 内前向修复；不得改回无界队列、丢弃已接受事件、抢占/覆盖 terminal、
吞中断、busy-spin、删除测试、增加 skip，或通过放宽 timeout/输出限制制造 PASS。候选冻结后 Reviewer
发现阻塞项时，按最多一个 fix batch、最多 R2 处理；需新增公开配置、修改协议或越界文件则失败关闭并
创建永久 replacement。

## 停止条件

- 需要修改 writeAllowlist 外路径、公开协议、SizeLimits、Anthropic config/codec/adapter/SSE parser、
  OpenAI、runtime app、数据库或 CI。
- 需要改变 Provider 路由、授权、quota/retry、输出/token/timeout 数值，或引入新运行时依赖/线程池。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS，或触发 90 分钟 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0117/` 与 `docs/handoffs/TASK-0117.json`；记录候选身份、R1/R2、容量与
producer/consumer race matrix、cancel/timeout/body-close、structured late-frame fence、正式门禁、远端
非 PASS 与本地 exact-tree 限定覆盖。终态只用单父原子提交更新任务卡、Project State、Task Ledger、
Evidence 与 Handoff，随后 push、fetch 并验证 `HEAD...origin/main` 为 0/0。Handoff 必须保留 Anthropic
maxTokens ceiling、跨 frame raw budget 与其余审计风险，并给出与 `project-state.nextAction` 逐字一致的唯一下一动作。
