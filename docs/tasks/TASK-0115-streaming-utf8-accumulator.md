# TASK-0115：流式输出跨 Delta UTF-8 累计修复

```yaml
taskId: TASK-0115
state: DRAFT
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
baseCommit: ffc838cad053873d3fca2668de4e039475823c7c
authorizationCommit: ""
contextFingerprint: f39dbd9d7131cea9e72f11aad5c561a6660db446dcc26df543e25c3b52bbe0b8
contextLock: docs/tasks/context/TASK-0115.context-lock.yaml
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
  surfaceId: TASK_0115_STREAMING_UTF8_ACCUMULATOR
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
  - docs/evidence/TASK-0113/evidence-pack.json
  - docs/evidence/TASK-0113/review-r1.md
  - docs/evidence/TASK-0114/evidence-pack.json
  - docs/evidence/TASK-0114/review-r1.md
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/BoundedInputStream.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/ImmediateTerminalSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiCodecException.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/AdapterLocator.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptTerminal.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/ProviderAttemptAudit.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RecoveryScenario.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/model-protocol-contract-tests/pom.xml
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/FailureModelProtocolAdapterContractTest.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/FakeModelProtocolAdapterContractTest.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolBoundaryContractTest.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolTestSupport.java
  - service/tests/openai-chat-completions-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/CountingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/NeverCompletingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsFailureContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0115/**
  - docs/handoffs/TASK-0115.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/Utf8ByteAccumulator.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/Utf8ByteAccumulatorTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/evidence/TASK-0113/**
  - docs/evidence/TASK-0114/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
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
  - service/adapters/model-anthropic/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/BoundedInputStream.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/ImmediateTerminalSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiCodecException.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/adapters/model-openai/src/test/**
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/InMemoryAdapterLocatorTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/tests/openai-chat-completions-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/CountingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/NeverCompletingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsFailureContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/model-protocol-contract-tests/**
  - service/tests/anthropic-messages-contract-tests/**
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
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/evidence/TASK-0113/evidence-pack.json
  - docs/evidence/TASK-0113/review-r1.md
  - docs/handoffs/TASK-0113.json
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/evidence/TASK-0114/evidence-pack.json
  - docs/evidence/TASK-0114/review-r1.md
  - docs/handoffs/TASK-0114.json
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
      TASK-0114 Handoff 与 project-state 的唯一下一动作逐字指定创建 TASK-0115，修复 OpenAI adapter
      与 LiveModelInvoker 的跨 delta Unicode surrogate 计数；本卡不追溯改写历史任务。
  - scope: streaming-utf8-accumulator
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      TASK-0113 与 TASK-0114 已接受并冻结 provider-neutral 的累计 UTF-8 输出 1 MiB 上限。
      本卡仅修复分块边界计数，复用 SizeLimits.MAX_TOTAL_OUTPUT_BYTES，不新增或修改工程数值、
      Provider 路由、授权、quota、重试或公开协议。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=usedMinutes=2000、
      paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110 exact-SHA run 31286798584
      在无 runner、零 step 状态终止；TASK-0112 至 TASK-0114 已按同一 READY 冻结 fallback 合规
      ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实为非 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0115
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime,service/adapters/model-openai,service/tests/openai-chat-completions-contract-tests,service/tests/model-protocol-contract-tests -am test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。TASK-0114
> 已在当前 Base ACCEPTED 并把 TASK-0115 冻结为唯一下一动作。本卡从其终态提交重新冻结 Context，
> 以独立候选 Commit/Tree、Reviewer 和本地 exact-tree channel 关闭跨 delta UTF-8 计数绕过。

## 背景与用户可观察目标

OpenAI streaming adapter 与 provider-neutral LiveModelInvoker 都按单个 delta 独立调用
`SizeLimits.utf8Bytes`。如果 high surrogate 位于前一 delta 末尾、low surrogate 位于下一 delta
开头，两个孤立 replacement byte 会被累计为 2 字节，而拼接后的合法非 BMP 码点实际编码为 4 字节。
攻击者或异常 Provider 可利用一个或多个跨 delta pair 让真实聚合输出越过 1 MiB，却仍产生成功终态。

完成本卡后，两层都按“已接受 delta 的逻辑拼接结果”状态化计数；首个 one-over delta 在 emit/append 前
失败关闭，OpenAI 不产生违规 delta、Usage 或 EOS，LiveModelInvoker 取消 session、丢弃 partial output、
释放 quota 并记录既有非重试失败。

## 范围内

- 在 modelruntime contract 包新增 provider-neutral `Utf8ByteAccumulator`，以固定 maximum 维护
  已接受 UTF-8 bytes 与尾随 high-surrogate 状态，提供原子 `tryAppend(String)` 和只读 `bytes()`。
- 累计语义必须等价于对所有已接受 chunk 按顺序拼接后调用 `SizeLimits.utf8Bytes`；跨边界 high/low
  pair 补足 2 字节，空 chunk 不清除尾随状态，拒绝不修改任何状态。
- OpenAI streaming text 与 structured partial 在 mark/emit/append 前使用累计器；one-over 统一为既有
  `MalformedResponse`，关闭 body，且不产生 offending delta、Usage 或 EOS。
- LiveModelInvoker 在 append 到响应 builder 前使用同一累计器；one-over 显式 cancel，返回既有
  fail-closed outcome、ZERO_LLM fallback、ALL_FAILURE quota recovery 与 NON_RETRYABLE_FAILED audit。
- 新增 direct utility、OpenAI contract 与 LiveModelInvoker tests，覆盖同 delta/跨 delta exact/one-over、
  多个 split pair、空 chunk 和畸形/孤立 surrogate 组合，以及成功与失败终态副作用。

## 明确范围外

- 不修改 TASK-0109 至 TASK-0114 的 Card、Context、Evidence、Review 或 Handoff，也不重判历史结果。
- 不修改 `SizeLimits` 常量、`utf8Bytes(String)` 完整字符串语义、ModelProtocol 事件类型、公开
  API/OpenAPI/Catalog、Provider 路由、授权 snapshot、quota/retry/timeout、数据库、前端或 CI。
- 不迁移已经正确的 Anthropic 私有边界计数；其实现与 contract tests 只作为 Base reference。
- 不解决 Anthropic maxTokens ceiling、OpenAI/Anthropic 无界事件 queue/backpressure，或连续
  comment/empty-data frame 的连接级累计 raw budget；这些风险继续拆分为后续独立卡。
- 不把 Java 字符串中的孤立 surrogate 当作 raw provider UTF-8；SSE decoder 的严格 raw UTF-8
  fail-closed 语义保持不变，本卡验证的是已解码 chunk 的聚合计数。

## 输入和前置条件

Base 是 TASK-0114 ACCEPTED 终态 `ffc838cad053873d3fca2668de4e039475823c7c`，与
`origin/main` 0/0 且工作树干净。Context Lock 只绑定该 Base 中的机器真源、TASK-0113/TASK-0114
已接受证据、模型协议合同、当前 OpenAI/modelruntime 调用链、Anthropic 正确参考和相关测试，不依赖历史聊天。

`SizeLimits.MAX_TOTAL_OUTPUT_BYTES` 保持 1 MiB。当前 `SizeLimits.utf8Bytes` 对完整字符串正确：
合法 surrogate pair 为 4 字节，孤立 surrogate 匹配 JDK UTF-8 encoder 的 1-byte replacement。
缺陷只在逐 chunk 相加遗漏跨边界配对差额。

## API / 事件 / 数据契约

- `Utf8ByteAccumulator` 是 modelruntime 内部 provider-neutral Java 类型，不改变 ModelProtocol
  YAML 或事件 wire contract；构造 maximum 必须非负，null chunk 失败，`bytes()` 始终非负且不超 maximum。
- `tryAppend` 成功后状态等于加入该 chunk 后的逻辑拼接；失败返回 false 且 bytes、尾随 surrogate
  状态均保持原值，调用方不得在失败后提交 chunk。
- text 和 structured chunk 使用完全相同的 byte accounting；状态只与 chunk 顺序和字符内容有关，
  不与 Provider、事件 sequence、usage 或 stop reason 耦合。
- 不记录内容、字符、Provider body 或异常原文；错误继续使用无敏感字段的 `MalformedResponse`。

## 权限、RLS 和数据处理要求

不修改租户、RLS、凭据、日志或数据库。所有测试使用内存脚本或 loopback/custom HttpClient，
不触发真实网络或付费 Provider。错误与 Evidence 不保存 synthetic 大 payload，只保存命令输出哈希和摘要。

## 状态机和失败行为

- OpenAI adapter 的 offending delta 在累计器成功前不得 mark first content、emit text 或 append
  structured partial；overflow 后只产生唯一 AttemptFailed(MalformedResponse)，无 UsageReported/AttemptEos。
- LiveModelInvoker 的 offending delta 在累计器成功前不得 append builder；overflow 必须显式
  `session.cancel()` 并沿既有 fence violation outcome 释放 quota、清除 partial response 和记录失败 audit。
- exact limit 正常接受；随后 Usage/EOS、响应、audit 和 quota 行为不回归。
- malformed raw UTF-8、重复终态、wrong binding、terminalless session 与显式 cancel 的既有失败语义不变。

## 模型、Prompt、记忆和安全边界

不改变 prompt/message/schema/request 限制、model output token request、memory、safety、授权 fence 或
Provider admission。累计器只接收已由 adapter codec 解码的 Java String，不成为新的网络、日志或持久化边界。

## 验收标准

1. `SizeLimits.MAX_TOTAL_OUTPUT_BYTES` 与 `SizeLimits.utf8Bytes` 保持不变；新增累计器对任意已接受
   chunk 序列的 `bytes()` 等于完整拼接字符串的 `utf8Bytes`，拒绝时状态不变。
2. direct tests 覆盖 ASCII/非 BMP 同 chunk exact 与 one-over、high/low 跨 chunk exact 与 one-over、
   多个 split pair、high 后空 chunk 再 low、孤立 high/low、high 后 ASCII、连续 high 和 null/负 maximum。
3. OpenAI streaming text 的 split pair exact 1 MiB 正常 Output/Usage/EOS；one-over 在违规 delta 前失败，
   不产生该 delta、Usage/EOS，body 关闭且后续 sentinel 不被读取。
4. OpenAI structured streaming 使用相同累计器；跨 delta one-over 不 append 成功终态，只有
   MalformedResponse，现有 structured JSON 成功路径保持通过。
5. LiveModelInvoker text 与 structured output 的跨 delta exact 成功聚合；one-over 显式 cancel，
   response 为 ZERO_LLM fallback、failure 为 MalformedResponse、audit 为 NON_RETRYABLE_FAILED，
   quota 按 ALL_FAILURE 恢复且无 partial response/usage。
6. 多个跨 delta pair 不能产生累计漂移；空 delta 不清除 pending high surrogate；孤立或畸形 surrogate
   的累计值与完整拼接 `SizeLimits.utf8Bytes` 精确一致，不以 replacement 绕过上限。
7. OpenAI adapter、LiveModelInvoker 和累计器之外无生产代码变更；Anthropic、SizeLimits、specs、
   runtime app、数据库、前端与 CI 无变更，所有候选路径均位于 writeAllowlist。
8. 定向 reactor、根级 Maven verify、canonical precheck 与唯一无参数 `git diff --check` 均在独立
   Reviewer PASS 后绑定同一冻结候选 Commit/Tree 并真实 PASS；远端保持非 PASS，不冒充本地结果。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。实现期间允许用精确 `-Dtest` 子集迭代；正式定向
reactor、根级 Maven、canonical 和无参数 `git diff --check` 各执行一次，不重复 canonical 已包含的
子命令。所有结果记录真实退出码、完整候选 Commit/Tree、环境与 stdout/stderr 哈希。

## 回滚或前向修复

候选冻结前可在唯一 fix batch 内前向修复；不得放宽上限、吞异常、删除测试、增加 skip、把最终
聚合复查替代 emit/append 前检查，或在失败后继续消费/提交 delta。候选冻结后 Reviewer 发现阻塞项时，
按最多一个 fix batch、最多 R2 处理；新的结构性 P0/P1 或需越界修改则失败关闭并创建永久 replacement。

## 停止条件

- 需要修改 writeAllowlist 外路径、公开协议、SizeLimits 数值/语义、Anthropic、runtime app、数据库或 CI。
- 需要改变 Provider 路由、授权、quota/retry/timeout、事件终态或引入新的付费/网络依赖。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS，或触发 90 分钟 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0115/` 与 `docs/handoffs/TASK-0115.json`；记录候选身份、R1/R2、
direct/adapter/invoker exact/one-over 和 surrogate 矩阵、正式门禁、远端非 PASS 与本地 exact-tree
限定覆盖。终态只用单父原子提交更新任务卡、Project State、Task Ledger、Evidence 与 Handoff，
随后 push、fetch 并验证 `HEAD...origin/main` 为 0/0。Handoff 必须保留 Anthropic maxTokens、
OpenAI/Anthropic queue/backpressure 与跨 frame raw budget 风险，并给出与
`project-state.nextAction` 逐字一致的唯一下一动作。
