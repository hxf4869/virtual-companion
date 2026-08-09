# TASK-0110：永久修复 Provider 响应读取阶段上限（替代 TASK-0109）

```yaml
taskId: TASK-0110
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
baseCommit: 717582ec8f0bba5c81ebdc8cb2b535974ce281f0
authorizationCommit: ""
contextFingerprint: 71fcdebba70f312f721722834956caafbb26d366a60132668fde8d6b10108aa3
contextLock: docs/tasks/context/TASK-0110.context-lock.yaml
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
  surfaceId: TASK_0110_PROVIDER_RESPONSE_EARLY_LIMITS
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 85
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: PRIMARY_REMOTE_EXACT_SHA, profile: precheck}
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
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/evidence/TASK-0109/evidence-pack.json
  - docs/evidence/TASK-0109/review-r1.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0109.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiCodecException.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/CountingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/NeverCompletingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsFailureContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
writeAllowlist:
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0110/**
  - docs/handoffs/TASK-0110.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/BoundedInputStream.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - ".github/**"
  - "ci/**"
  - requirements-harness.txt
  - "scripts/**"
  - "skills/**"
  - "docs/schemas/**"
  - docs/tasks/task-card-template.md
  - "docs/source/**"
  - "docs/decisions/**"
  - "docs/planning/**"
  - "specs/**"
  - "**/db/migration/**"
  - "service/**/safety/**"
  - "service/**/memory/**"
  - "service/modules/conversation/**"
  - "service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/**"
  - "service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**"
  - "service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/**"
  - "service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**"
  - "service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**"
  - "service/adapters/model-anthropic/**"
  - "service/adapters/model-fake/**"
  - "service/adapters/model-failure/**"
  - "service/apps/**"
  - "service/tests/model-protocol-contract-tests/**"
  - "frontend/**"
  - "infra/**"
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
  - skills/model-routing-change/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-AUTH-001
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
      Owner 在当前 Codex 会话明确要求 Codex 接管审计与修复，并要求“不用询问我，作为长线任务跑下去”。
      该授权接受 TASK-0109 R1 FAIL 后使用永久 replacement 前向修复，保留原六个上限：消息数 64、
      单消息 64 KiB、schema 16 KiB、单 SSE 事件 1 MiB、累计输出 1 MiB、OpenAI
      max_tokens 8192；非流原始 HTTP body 采用 8 MiB。其余工程风险按现有语义保守处理，
      无需逐项回问，但不得在本卡引入未经独立验证的跨 Provider queue/backpressure、schemaName
      或总编码请求体契约，也不得越过治理、凭据或人工专属批准。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0110
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是 TASK-0109 的永久 replacement。TASK-0109 的候选与 R1 FAIL、重复 `git diff --check`
> 事实和预算记录保持不可变；本卡从其 REJECTED 终态提交重新授权，不复用旧卡 PASS 或候选身份。

## 背景与用户可观察目标

TASK-0109 已加入 domain、adapter 和 invoker 的首版大小上限，但 R1 证明 SSE 在
`BufferedReader.readLine`/`ArrayList`/`String.join` 后才检查，非流 JSON 在 Jackson 完整建树后才检查。
恶意 Provider 仍可在上限触发前占用无界内存，因此旧卡按 REJECTED 保留。

本卡完成后，Provider 字节会在读取/组帧阶段被限制：非流原始 body 超过 8 MiB 时最多读取到上限后的
第一个字节即停止；SSE 物理行和组合 data event 超过 1 MiB 时同样 early-stop；超限统一失败关闭、关闭
response body，并且 invoker 兜底显式取消通用 session。合法边界请求和响应保持兼容。

## 范围内

- `SizeLimits` 保留 TASK-0109 的六项数值，并新增非流 raw body 8 MiB 上限。
- 新增 package-private `BoundedInputStream`：所有读取 API 最多向底层请求剩余字节；在达到上限时只额外
  探测一个字节以区分 exact EOF 与 over-limit，然后抛出无 body 的受控 I/O 失败。
- 重写 `SseDecoder` 为有界字节读取/组帧：支持 LF/CRLF/CR，限制物理行和组合 data event，避免
  `readLine`、无界 `ArrayList` 和 `String.join`；超限后不继续消费底层流。
- `OpenAiChatCompletionsSession` 在 Jackson 前包装非流 body，并向 SSE decoder 传入显式字节上限；
  所有超限归一化为 `AttemptFailed(MalformedResponse)`，关闭 body，禁止 EOS/Usage 成功终态。
- `LiveModelInvoker` 在 protocol fence 或累计输出兜底失败时先显式 `session.cancel()`，再释放 ALL_FAILURE
  quota、记录 NON_RETRYABLE_FAILED audit 并丢弃部分输出。
- 使用 Boundary 测试内可计数、可在越界后抛错的合成 `HttpClient/InputStream` 证明 early-stop；补
  exact-limit、one-over、超大 comment/多行 data、CRLF、关闭 body 和显式 cancel 回归测试。

## 明确范围外

- 不修改 TASK-0109 的卡片、Context、Evidence、Review、Handoff 或任何历史提交。
- 不修改 OpenAI endpoint/egress/credential 策略（TASK-0108 已闭环），不接入真实 Provider，不读取真实 Key。
- 不修改 Anthropic、协议真源、生成/Realtime controller、dispatcher、持久化、数据库 migration、前端或 CI。
- 不把 raw body 上限扩展为通用 HTTP 网关上传限制；认证 API 与其他 Provider 的请求/响应上限另卡处理。
- 不在本卡解决 OpenAI/Anthropic 无界事件队列与 queue/backpressure 语义；该跨 Provider 风险另建任务。
- 不在本卡新增 provider-neutral `schemaName` 上限或总 encoded request body 预算；两者需要独立契约、
  跨 Provider 调用链和测试，作为后续审计修复项保留。

## 输入和前置条件

Base 是 TASK-0109 的 REJECTED 终态 `717582e`；仓库在 DRAFT 前为 `main...origin/main 0/0` 且无活动任务。
Context Lock 只绑定 Base Commit 中的仓库相对路径，并包含 TASK-0109 的失败证据和相关调用链。

## API / 事件 / 数据契约

- 原有六项公开常量保持不变；新增 `MAX_NON_STREAM_RESPONSE_BODY_BYTES=8*1024*1024`。
- Adapter 对 Provider 越界统一产生 `AdapterFailure.MalformedResponse`；不暴露响应 body、字段、凭据或 URL。
- 不改变 `ModelProtocolEvent`、binding、sequence、usage、stop reason 或路由契约。

## 权限、RLS 和数据处理要求

不触碰数据库/RLS。合成测试只使用离线内存流或 loopback，不访问公网；Evidence 和日志不得包含 Provider body、
token、真实联系人或用户数据。

## 状态机和失败行为

- exact limit 允许；第一个 over-limit 字节立即失败，底层读取计数不得超过 `limit + 1`。
- 超限 session 只排队一次 `AttemptFailed(MalformedResponse)`，不得排队 `AttemptEos` 或成功 usage。
- `abortIo` 关闭 response body 并中断 parser/worker；重复 cancel/close 保持幂等。
- invoker 发现 fence/累计输出违规时显式 cancel；部分 output 不进入结果，quota 按 ALL_FAILURE 恢复。

## 模型、Prompt、记忆和安全边界

保持 provider-neutral 上限与已批准 OpenAI max_tokens；不把套餐绑定模型，不改变 Prompt/Persona/Memory，
不引入付费/SaaS-only 运行时。所有失败消息保持 body-free。

## 验收标准

1. TASK-0109 六项常量逐值不变；新增 8 MiB raw body 常量有精确测试。
2. 非流合法 JSON body 在 exact 8 MiB 可完成；one-over 在 Jackson 完整物化前失败，底层最多读取 8 MiB+1，
   response body 被关闭，输出仅含一次 MalformedResponse terminal。
3. SSE 单物理行、comment、单行 data 和多行组合 data 的 one-over 均在 1 MiB+1 以内停止读取；exact event、
   CRLF 和合法 multiline data 行为保持通过。
4. invoker 累计输出或 fence 违规会调用 `session.cancel()` 至少一次，输出不含部分内容，quota、audit、
   realtime failure 语义与 TASK-0109 保持一致。
5. 受影响模块定向测试通过；R1 独立评审 PASS 后，canonical、根级 JDK-25 Maven verify、唯一
   `git diff --check` 与 PRIMARY_REMOTE_EXACT_SHA 在同一冻结 Commit/Tree 上真实通过。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。迭代仅运行受影响 Maven reactor；候选冻结后先独立 Reviewer，
Reviewer PASS 后 canonical、根级 Maven 与 `git diff --check` 各执行一次。不得把 TASK-0109 的运行或 targeted
结果复用为本卡 PASS；远端只接受同一 exact SHA。

## 回滚或前向修复

未提交实现可在允许路径内前向修正。候选提交后若 R1 有阻塞项，只允许一个 fix batch 与 R2；R2 新 P0/P1、
范围不足、身份变化或 hard fuse 到达时以 REJECTED 原子关闭并创建新永久 ID，不重写本卡或 TASK-0109 历史。

## 停止条件

- Context、Base、Owner 授权、writeAllowlist、候选 Commit/Tree 或 failure 语义不一致立即停止。
- 需要修改 `specs/**`、其他 Provider、HTTP 网关、migration、CI 或 forbidden path 时停止并拆新卡。
- early-stop 测试无法证明底层消费上界、超限仍先完整物化、出现内容泄漏或部分成功时不得进入 Reviewer PASS。
- 达到 90 分钟 hard fuse 后只允许 Evidence/Handoff、pre-closure、终态提交、push 与远端 0/0。

## Evidence Pack

输出到 `docs/evidence/TASK-0110/`，Handoff 为 `docs/handoffs/TASK-0110.json`；完整记录 DRAFT/READY/
IN_PROGRESS/candidate/reviewer/canonical/root Maven/remote/closure 的真实身份、退出码、耗时与非 PASS。
