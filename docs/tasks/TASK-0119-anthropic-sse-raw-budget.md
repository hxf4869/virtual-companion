# TASK-0119：Anthropic SSE 连接级原始字节预算

```yaml
taskId: TASK-0119
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
baseCommit: d112171e504ce86d8aa0e46cbd24cfc33559337e
authorizationCommit: ""
contextFingerprint: ea364625ff88eab52cde5e31df3db5f7ccdc0bed2c2fc9a0c01fa8fb005a4946
contextLock: docs/tasks/context/TASK-0119.context-lock.yaml
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
  surfaceId: TASK_0119_ANTHROPIC_SSE_RAW_BUDGET
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
  - docs/evidence/TASK-0117/evidence-pack.json
  - docs/evidence/TASK-0117/review-r1.md
  - docs/evidence/TASK-0117/review-r2.md
  - docs/evidence/TASK-0118/evidence-pack.json
  - docs/evidence/TASK-0118/review-r1.md
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0115.json
  - docs/handoffs/TASK-0117.json
  - docs/handoffs/TASK-0118.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/tasks/TASK-0118-anthropic-max-tokens-ceiling.md
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - docs/tasks/context/TASK-0117.context-lock.yaml
  - docs/tasks/context/TASK-0118.context-lock.yaml
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
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/BoundedInputStreamTest.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/SseDecoderTest.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/model-protocol-contract-tests/pom.xml
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolBoundaryContractTest.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0119-anthropic-sse-raw-budget.md
  - docs/tasks/context/TASK-0119.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0119/**
  - docs/handoffs/TASK-0119.json
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/SseDecoder.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/SseDecoderTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesRawBudgetContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/tasks/TASK-0116-openai-stream-backpressure.md
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/tasks/TASK-0118-anthropic-max-tokens-ceiling.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - docs/tasks/context/TASK-0116.context-lock.yaml
  - docs/tasks/context/TASK-0117.context-lock.yaml
  - docs/tasks/context/TASK-0118.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/evidence/TASK-0113/**
  - docs/evidence/TASK-0114/**
  - docs/evidence/TASK-0115/**
  - docs/evidence/TASK-0116/**
  - docs/evidence/TASK-0117/**
  - docs/evidence/TASK-0118/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0115.json
  - docs/handoffs/TASK-0116.json
  - docs/handoffs/TASK-0117.json
  - docs/handoffs/TASK-0118.json
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
  - service/modules/**
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
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/BoundedInputStreamTest.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfigTest.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesMaxTokensContractTest.java
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
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/evidence/TASK-0115/evidence-pack.json
  - docs/evidence/TASK-0115/review-r1.md
  - docs/handoffs/TASK-0115.json
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/evidence/TASK-0117/evidence-pack.json
  - docs/evidence/TASK-0117/review-r1.md
  - docs/evidence/TASK-0117/review-r2.md
  - docs/handoffs/TASK-0117.json
  - docs/tasks/TASK-0118-anthropic-max-tokens-ceiling.md
  - docs/evidence/TASK-0118/evidence-pack.json
  - docs/evidence/TASK-0118/review-r1.md
  - docs/handoffs/TASK-0118.json
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
      TASK-0118 Handoff 与 project-state 的唯一下一动作逐字指定创建 TASK-0119，为 Anthropic SSE
      冻结连接级累计 raw byte budget；本卡不追溯改写历史任务。
  - scope: anthropic-sse-stream-raw-byte-budget
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 长线授权明确把其余工程数值、拆卡、实现与验证细节交由 Codex 按机器真源、现有模式和
      最小风险原则决定。本卡独立冻结 Anthropic streaming 全连接 8388608 bytes raw budget，与
      TASK-0114 已接受的 non-stream 8 MiB raw-body 数值对齐但不复用或修改其公共常量；所有实际读取的
      data/event/comment/framing/CR/LF/空行字节从连接开始累计且永不按 frame、control 或合法 data 重置。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=usedMinutes=2000、
      paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110 exact-SHA run 31286798584
      在无 runner、零 step 状态终止；TASK-0112 至 TASK-0118 已按同一 READY 冻结 fallback 合规
      ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实为非 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0119
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests,service/tests/model-protocol-contract-tests -am test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。TASK-0118
> 已在当前 Base ACCEPTED 并把 TASK-0119 冻结为唯一下一动作。本卡从其终态提交重新冻结 Context，
> 以独立候选 Commit/Tree、Reviewer 和本地 exact-tree channel 关闭 Anthropic streaming raw 输入放大。

## 背景与用户可观察目标

Anthropic streaming response 当前只有单物理行和单个组合 data event 的 1 MiB 上限；每个换行或 dispatch
都会重置局部计数。Provider 可持续发送合法短 comment、blank、event-only 或 ping data frame，不产生 output
或队列事件，在 total timeout 前持续消耗网络、逐字节解析 CPU、response socket 和虚拟线程；并发请求会放大。

完成本卡后，每条 Anthropic SSE 连接从首个实际读取 byte 起拥有不可重置的 8 MiB raw budget。所有字段、
payload、framing 与换行都计数；exact 可完成，首个 one-over byte 在解析/dispatch 前失败为唯一
MalformedResponse，body 关闭且不读取 sentinel。合法 SSE、取消、timeout 与既有事件/输出边界保持。

## 范围内

- 为 package-private `SseDecoder.decode` 增加显式 `maximumRawBytes` 参数，必须为正 `long`；在每次成功
  `input.read()` 后、处理该 byte 前累计整个连接的 raw bytes，精确允许 8388608，读取第 8388609 个 byte
  时抛无详情 `AnthropicCodecException`，不处理该违规 byte，底层最多读取 budget+1。
- raw 预算计入 `data:`、`event:`、comment、JSON/control payload、字段 framing、CR、LF、CRLF、空行、
  blank frame 和 EOF 前所有真实 bytes；不按物理行、事件 dispatch、有效 data、ping 或任何进展信号重置。
- `AnthropicMessagesSession` 冻结 adapter-private `8 * 1024 * 1024` streaming raw 常量并传给 decoder；
  不修改或复用名为 non-stream 的 `SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES`。
- 扩展 direct decoder tests，以小预算精确证明 comment/blank/event-only/empty-data、CR/LF/CRLF、合法 data 后
  继续累计、unknown `id:`/`retry:` 既有 fail-closed，以及 exact/one-over/sentinel 行为。
- 新增独立 contract test，以受控 InputStream/HttpClient 覆盖生产 8 MiB exact 成功、one-over early stop、
  ping/control/no-output flood、不 reset、MalformedResponse、body close、唯一终态、cancel/timeout 和无 late event。

## 明确范围外

- 不修改 TASK-0109 至 TASK-0118 的 Card、Context、Evidence、Review 或 Handoff，不重判历史结果。
- 不修改 BoundedInputStream、SizeLimits/modelruntime、公开协议、OpenAI/fake/failure adapter、Anthropic
  Config/Codec/Adapter/maxTokens、Provider 路由、runtime app、数据库、前端或 CI。
- 不改变单个组合 data payload 1 MiB、物理行 1 MiB、累计 output 1 MiB、事件队列 64/67、non-stream
  raw body 8 MiB、token 8192 或 timeout 数值；raw budget 是额外的连接级输入 fence。
- 不把空 `data:` frame 改成 heartbeat：decoder 仍可 dispatch 空字符串，session codec 会立即把空 JSON
  判为 malformed。`id:`/`retry:` 仍是未知字段并 fail closed，不扩展 SSE 兼容字段。
- OpenAI SSE 存在同类全连接 raw budget 缺口，必须在本卡之后以独立永久卡修复，不在本卡跨 Provider 扩围。

## 输入和前置条件

Base 是 TASK-0118 ACCEPTED 终态 `d112171e504ce86d8aa0e46cbd24cfc33559337e`，与 `origin/main`
0/0 且工作树干净。Context Lock 绑定该 Base 的机器真源、TASK-0114/0115/0117/0118 已接受边界证据、
当前 Anthropic raw decoder/session/contract tests、modelruntime 限制与精确 Skill，不依赖历史聊天。

现有 first-token/total timeout 提供时间边界但不是 byte 边界；TASK-0114 的单行/单 event fence 和 TASK-0117
的事件队列背压均不观察被忽略的 raw frames。本卡数值由 Owner 长线工程决策授权独立冻结，不从历史卡继承。

## API / 事件 / 数据契约

- `SseDecoder` 仍是 adapter 内部类型；新参数只在 package 内调用，不改变 ModelProtocol/OpenAPI/Catalog。
- `maximumEventBytes` 继续只限制组合 data payload与物理行；`maximumRawBytes` 独立限制整个 input stream。
- raw 计数使用 `long`，不通过 `remaining + 1` 计算，不溢出；exact budget 后允许 EOF，只有真实读取到
  下一 byte 才 one-over。违规 byte 不进入 line/event buffer，不调用 consumer。
- 合法 data、显式 event、comment、ping、CR/LF/CRLF 和 EOF 语义不变；raw budget 不关心 frame 是否有效、
  是否产生 ModelProtocol event 或是否被 consumer 忽略。
- 已在 budget 内完整接受的 OutputDelta 可保留；overflow 自身不产生 delta/Usage/EOS，失败 terminal 唯一且最后。

## 权限、RLS 和数据处理要求

不修改租户、RLS、凭据、日志或数据库。错误统一为无详情 `AdapterFailure.MalformedResponse`，不得包含 raw
comment/ping/body、prompt、schema、API key、token、真实联系人或用户数据；测试仅用 synthetic bytes。

## 状态机和失败行为

- decoder 在 `input.read()` 返回一个真实 byte 后先验证全连接计数，再进入既有 CRLF、line parser 和 event
  buffer；EOF 不占 budget，exact EOF 正常收束，one-over byte 只作为违规 probe 被读取一次。
- raw overflow 抛 `AnthropicCodecException`，由 session 归一化为唯一 MalformedResponse；worker finally
  关闭 body，失败路径中止 parser，不产生 Usage/EOS 或成功 terminal。
- 取消/close 与 total/first-token timeout 继续 first-wins；它们关闭 body、中断 parser/worker，并保证
  budget race 不覆盖已冻结 terminal。terminal 后 decoder consumer 返回 false，不读取 late frame。
- 普通 transport `IOException` 仍映射 Disconnected；不得用通用 BoundedInputStream overflow 把本地策略
  错误伪装成断连或可重试失败。

## 模型、Prompt、记忆和安全边界

不改变模型选择、messages/schema、maxTokens、memory、safety、authorization fence、quota、retry 或 Provider EOS。
8 MiB 是 Anthropic adapter 私有运维输入上界，不是 SSE/Anthropic 协议能力声明，也不扩大模型权限。

## 验收标准

1. 生产路径只在 Anthropic `SseDecoder` 与 session 增加不可重置的 8388608-byte 全连接 raw fence；
   `SizeLimits`、BoundedInputStream、OpenAI、公开协议与既有 token/output/event/queue/timeout 数值不变。
2. direct decoder 以小预算覆盖纯 comment、blank、event-only、empty-data、合法 ping/data 混合；data dispatch
   前后均不重置，LF、CR 与 CRLF 的每个真实 byte 计入，exact 通过，one-over 只读取 budget+1 且不读 sentinel。
3. production budget 下，8 MiB exact 的合法完整 SSE 产生原有 Output/Usage/EOS；one-over 在违规 byte
   处理前产生唯一 MalformedResponse，tracking body 证明读取上界、body close、无违规 delta/Usage/EOS。
4. comment/blank/event-only/ping flood 均不能绕过 raw budget；空 data 继续在首次 dispatch 后按空 JSON
   malformed，`id:`/`retry:` 继续未知字段 fail closed，单行/单 event/strict UTF-8 语义不回归。
5. 合法 delta 后的 raw flood 证明预算不 reset；先前 delta 顺序、binding、sequence 保持，失败 terminal
   唯一且最后，terminal 后 `next()` 永久 empty，late sentinel 未读取。
6. 持续 raw 输入或阻塞 body 下的 cancel/close、first-token timeout 和已有 content 后 total timeout 有界完成，
   body 关闭、线程停止、terminal first-wins；重复 cancel/close 幂等且无 late event。
7. 既有 normal/structured streaming、非 BMP/multiline/CRLF、boundary、backpressure、failure、timeout 与
   maxTokens 合同全部回归；所有候选路径位于 writeAllowlist，不访问真实 Provider。
8. 定向 reactor、根级 Maven verify、canonical precheck 与唯一无参数 `git diff --check` 均在独立
   Reviewer PASS 后绑定同一冻结候选 Commit/Tree 并真实 PASS；远端保持非 PASS，不冒充本地结果。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。实现期间允许用精确 `-Dtest` 子集迭代；正式定向 reactor、
根级 Maven、canonical 和无参数 `git diff --check` 各执行一次，不重复 canonical 已包含的子命令。
所有结果记录真实退出码、完整候选 Commit/Tree、环境与 stdout/stderr 哈希。

## 回滚或前向修复

候选冻结前可在唯一 fix batch 内前向修复；不得增加 reset、把 overflow 映射为 Disconnected、放宽到无上限、
复用 non-stream 命名常量、删除测试、增加 skip 或吞退出码。候选冻结后 Reviewer 发现阻塞项时，按最多一个
fix batch、最多 R2 处理；需修改公共常量/协议、OpenAI 或越界文件则失败关闭并创建永久 replacement。

## 停止条件

- 需要修改 writeAllowlist 外路径、BoundedInputStream、SizeLimits/modelruntime、公开协议、OpenAI、runtime、
  数据库或 CI。
- 需要改变 8 MiB、event/output/queue/token/timeout 数值，按 frame/data 重置预算，或扩大 SSE 字段兼容。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS，或触发 90 分钟 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0119/` 与 `docs/handoffs/TASK-0119.json`；记录候选身份、R1/R2、8 MiB exact/
one-over、各 framing/line-ending/control 计数、no-reset、budget+1/sentinel、MalformedResponse、body close、
cancel/timeout/late-event、正式门禁、远端非 PASS 与本地 exact-tree 限定覆盖。终态只用单父原子提交更新
任务卡、Project State、Task Ledger、Evidence 与 Handoff，随后 push、fetch 并验证远端 0/0。Handoff 必须
保留 OpenAI 同类 raw budget 与其余审计风险，并给出与 `project-state.nextAction` 逐字一致的唯一下一动作。
