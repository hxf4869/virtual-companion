# TASK-0033：Anthropic Messages 离线 HTTP/SSE 合同

```yaml
taskId: TASK-0033
state: ACCEPTED
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: c7e68492daceb7992efedb52a221e93b3a405a34582a5983c22bcbb0a375f4c3
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: cf29d26e9943dc80da2c35401e43c14f3945c827
authorizationCommit: 4bb70937c011a86c17316b2de57b42973811a5e7
contextFingerprint: c91d42b66d19fa7282d659d4d049f7966135278cb526d93d3d263d4d849cb46c
contextLock: docs/tasks/context/TASK-0033.context-lock.yaml
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
  surfaceId: TASK_0033_ANTHROPIC_MESSAGES_OFFLINE_CONTRACT
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/risk-levels.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ModelProtocol.java
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/tasks/TASK-0011-openai-chat-completions-offline-adapter.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/decisions/0001-v031-technology-and-transport-baseline.md
  - docs/architecture/repository-structure.md
  - docs/evidence/TASK-0011/evidence-pack.json
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - pom.xml
  - requirements-harness.txt
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolCapabilities.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/StopReason.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/ImmediateTerminalSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiCodecException.java
  - service/tests/openai-chat-completions-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/CountingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/NeverCompletingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsFailureContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/tasks/context/TASK-0033.context-lock.yaml
  - docs/evidence/TASK-0033/**
  - docs/handoffs/TASK-0033.json
  - pom.xml
  - service/adapters/model-anthropic/**
  - service/tests/anthropic-messages-contract-tests/**
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .gitattributes
  - .github/**
  - ci/**
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
  - docs/architecture/**
  - docs/decisions/**
  - docs/engineering/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
  - specs/**
  - frontend/**
  - deploy/**
  - ops/**
  - db/**
  - infra/**
  - service/apps/**
  - service/platform/**
  - service/modules/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-openai/**
  - service/tests/model-protocol-contract-tests/**
  - service/tests/generation-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
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
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/generation-states.yaml
  - scripts/harness/doctor.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-AUTH-001
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0033 以 loopback mock-server 实现 Anthropic Messages 非流与
      SSE 离线 Adapter 合同。新增 service/adapters/model-anthropic（镜像 TASK-0011 OpenAI
      adapter 单请求 Session、Codec、三段超时、终态唯一、迟到事件丢弃范式，仅替换为
      Anthropic Messages 形状）与 service/tests/anthropic-messages-contract-tests 覆盖 14 项
      requiredContractTests；根 pom 注册两模块。每 session 单 HttpClient.sendAsync、仅
      ExternalAttemptBinding、脱敏、零真实外发、无重试或路由或业务状态真源。
      model-routing-change 为 independentReview（非 humanApproval）保护路径，由独立 R1
      复核。不读取真实 Anthropic 凭据或访问真实供应商，不触 catalog、contract、modelruntime
      改动（ANTHROPIC_MESSAGES 已声明）。
independentReview: required
reviewers:
  - id: task0033_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 0987f8b0372802cda2a59fba862361cf222ab64f
    evidencePath: docs/evidence/TASK-0033/review-r1.md
    reason: >-
      R1 PASS (no P0/P1/P2) on candidate 0987f8b. All 12 ACs pass with direct
      test evidence and all 14 requiredContractTests covered by 26 @Test methods
      across 4 classes; 8 invariants hold. Faithful mirror of TASK-0011 OpenAI
      adapter single-request Session/Codec/three-phase-timeout/single-terminal/
      late-fence/desensitization pattern with correct Anthropic Messages
      substitution. Write scope clean (21 files in writeAllowlist, no forbidden).
      Three non-blocking P3 (safeSum stream/non-stream divergence both safe;
      StructuredJson syntax-only per spec; SseDecoder strict id/retry rejection
      by design); no fix batch needed.
    candidateTree: c2669d533eac0b6e9e0d8fe0c630754c3cba89da
    budget:
      maximumMinutes: 15
      elapsedSeconds: 720
      hardLimitReached: false
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0033
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 背景与用户可观察目标

机器真源已经把 `ANTHROPIC_MESSAGES`（`/v1/messages`，SSE）与 `OPENAI_CHAT_COMPLETIONS` 并列为 Technical Alpha 允许的两个主协议，并要求两个主协议 adapter 均通过本地 mock-server 离线合同测试（`offlineContractRequirement`）。TASK-0011 已交付 OpenAI Chat Completions 侧 adapter 与 14 项合同测试；本任务在不接入 Runtime、不读取真实凭据、不访问公网的前提下，新增一个只依赖 JDK 25、项目已管理 Jackson 3 和现有 `modelruntime` 端口的 Anthropic Messages Adapter，并以仅绑定 `127.0.0.1:0` 的 JDK `HttpServer` 建立可复验合同基线，使 `model-protocol-contract` 的两个主协议均具备完整、单请求、loopback、脱敏、失败关闭的自动化合同覆盖。

## 范围内

- 新增 `service/adapters/model-anthropic`，实现固定 `/v1/messages` 的非流式 JSON 与流式 SSE 映射，镜像 TASK-0011 的单请求 Session/Codec/三段超时/终态唯一/迟到事件丢弃范式，仅替换为 Anthropic Messages 协议形状；
- 新增 `service/tests/anthropic-messages-contract-tests`，使用 JDK `HttpServer` 和合成 Token/正文进行离线合同测试，覆盖 `model-protocol-contract.requiredContractTests` 的全部 14 项；
- 根 `pom.xml` 只登记上述两个模块，Runtime 不依赖新 Adapter；
- 每个合法 Session 恰好调用一次 JDK `HttpClient.sendAsync`，无重试、路由、fallback 或跨 Attempt 拼接；
- 只接受完整 `ExternalAttemptBinding`；确定性 Binding 或构造后仍非法的请求零网络失败关闭；
- 请求固定 `POST /v1/messages`、JSON Content-Type、`x-api-key` Header、`anthropic-version` Header、模型、供应商中立 messages（`system` 为顶层字段，`messages` 仅 `user`/`assistant`）、必需的 `max_tokens` 与 `stream`；
- 非流响应解析 `content` 数组首个 `text` 块、`stop_reason` 与 `usage`（`input_tokens`/`output_tokens`）；流式按 Anthropic SSE 事件序列解析；
- 显式区分 Connect、First Token、Total 三段超时，取消和关闭幂等；
- 终态唯一，终态后所有迟到字节、异步回调和事件均丢弃；
- 非流与 SSE 都把完整输入 Binding 原样映射到连续 sequence 事件；
- 文本流逐 Delta 输出；结构化流先聚合并验证 JSON，成功时只发一个 `StructuredJson`；
- 只有合法 `stop_reason`、完整 Usage 和 `message_stop` 全部出现后才发 Attempt EOS；
- 新代码不记录请求 Header、Token、正文、授权快照或响应正文，Adapter/配置/Session 的 `toString` 不包含这些数据。

## 明确范围外

- 真实 Anthropic 凭据、公网调用、真实域名、真实模型准入、环境变量、API Key、代理、DNS 或任何非 loopback 测试连接；
- Runtime、API、Worker、Conversation、数据库、RLS、Provider Registry、路由、降级、重试、Quota、安全政策或最终化接线；
- OpenAI Responses API、Spring AI、Anthropic SDK 或第二套模型端口；
- Anthropic 批量、文件、嵌入、Vision 多模态内容块、工具调用的执行语义（工具调用型终止仅映射为 `UNKNOWN` stop reason，不执行工具）；
- 修改 Catalog、Contract、生成物、`modelruntime`、OpenAI/Fake/Failure Adapter、现有合同测试、Runtime、前端、数据库、部署、CI、Harness 或 Agent/Skill 规则；
- 把 Provider EOS 解释为 Generation 完成，或把 Adapter 输出写成 Canonical Memory。

## 输入和前置条件

- Base Commit 为 TASK-0032 ACCEPTED 终态 `cf29d26e9943dc80da2c35401e43c14f3945c827`，与 `origin/main` 同步且工作区干净；
- `ModelProtocolAdapter`、`ModelProtocolSession`、完整 `ExternalAttemptBinding`、供应商中立消息/响应模式、三段 `TimeoutBudget`、归一化 Event/Failure 与 Fence Gate 已存在且本任务禁止修改；
- 生成 Catalog 的 `ModelProtocol.ANTHROPIC_MESSAGES` 与 `model-protocol-contract.ANTHROPIC_MESSAGES`（`/v1/messages`，`alphaAllowed`）已登记，本任务不新增或修改协议族；
- Anthropic Messages 官方参考确认当前端点为 `POST /v1/messages`，鉴权使用 `x-api-key` 与 `anthropic-version` Header，`system` 为顶层字段，`max_tokens` 必需，流式事件为 `message_start`/`content_block_start`/`content_block_delta`/`content_block_stop`/`message_delta`/`message_stop`/`ping`，`stop_reason` 与累积 `usage` 在 `message_delta` 提供；
- 本任务只锁定当前 Messages 合同所需字段，不引入批处理、Vision 或工具执行；
- 使用项目固定 Temurin JDK 25，不改变主机系统 Java。

## API / 事件 / 数据契约

- Adapter `protocol()` 固定返回生成 Catalog 的 `ModelProtocol.ANTHROPIC_MESSAGES`；
- Adapter 声明 `STREAMING` 与 `STRUCTURED_OUTPUT`，只从供应商专用构造配置读取 endpoint、合成/本地 Key、`anthropic-version` 与模型名；
- 合法请求 body：
  - `model` 为 Adapter 配置；
  - `messages` 只映射 `SYSTEM`→顶层 `system` 字符串（若存在 SYSTEM 消息）、`USER`/`ASSISTANT`→`messages` 数组项的 `role` 与文本 `content`；
  - `max_tokens` 为必需正整数（由配置提供合成值）；
  - `stream` 与中立请求一致；
  - 结构化请求以 Anthropic 工具/JSON 等价方式请求结构化输出；当请求声明 `StructuredJson` 时，Adapter 聚合文本并在 JSON 语法校验通过后只发一个 `StructuredJson`；
- 非流式 200 只接受 JSON Content-Type、`content` 数组含且仅含首个 `type:"text"` 块的 `text`、合法 `stop_reason` 和完整 `usage`，依次输出一个 Payload、Usage、EOS；
- SSE 200 只接受 `text/event-stream`，decoder 支持 UTF-8、CRLF/LF、注释（`:` 前缀的 `ping`/`event` 之外忽略行）和多 `data:` 行，按事件 `type` 拼接 `data` JSON；拒绝非法事件类型、非法 JSON、缺 `message_start`/`message_stop`、缺 `stop_reason`、缺 Usage 或重复终止；
- SSE 文本 Delta 按 `content_block_delta` 中 `delta.text` 到达顺序映射；Usage 在 `message_delta` 映射（`input_tokens` 取自 `message_start.message.usage`，`output_tokens` 取自 `message_delta.usage`）；`message_stop` 后映射 EOS；
- 结构化流在 `message_stop` 前不暴露局部 JSON，完成后只发一个 `StructuredJson`、Usage、EOS；
- `stop_reason` 映射：`end_turn`/`stop_sequence` → `STOP`，`max_tokens` → `LENGTH`，`tool_use` 型终止 → `UNKNOWN`；其他值失败关闭；
- 429 映射 `RateLimited`，5xx 映射 `UpstreamUnavailable`，解析/Content-Type/协议错误映射 `MalformedResponse`；
- Connect、First Token、Total 到期分别映射对应 `AdapterFailure.TimeoutPhase`，超时后取消唯一 HTTP 操作并封闭事件流；
- 全部事件携带输入完整 Binding，sequence 从 0 连续增长，终态后 `next()` 永远为空。

## 权限、RLS 和数据处理要求

- `ExternalAttemptBinding` 缺 Owner 元组、Attempt ID、Fence 或任一授权快照时由现有值对象拒绝；Adapter 不补默认值；
- `DeterministicSourceBinding`、不支持的 endpoint/request/capability 在调用 `HttpClient` 前失败；
- Authorization Snapshot 只随内部 Binding 事件返回，不写入外部请求 Header/Body；
- 合同测试只使用 `127.0.0.1:0`、合成 Key、合成模型名与合成消息，不读取环境变量或 Secret；
- 新代码没有日志语句，不把 Key、Authorization Header、Prompt、响应正文或授权快照放入异常消息和新类型 `toString`；
- 不写数据库、不改变授权、不结算配额、不创建真实 `provider_attempt` 记录。

## 状态机和失败行为

- 合法 Session 创建时只发起一次请求；任何 HTTP/解析/超时失败都直接形成唯一归一化终态，不重试或 fallback；
- 获取响应头前的连接阶段受 Connect 与 Total 上限共同约束；响应头后直到首个非空 Provider 内容受 First Token 与 Total 上限共同约束；之后只受剩余 Total 上限约束；
- 取消可发生在连接、首 Token、流式中途或终态后；前 3 种只产生一个 `AttemptCancelled`，终态后为空操作；
- 终止仲裁串行化 sequence 与终态；超时、取消、解析失败、正常 EOS 竞争时只有首个终态可见；
- Parser/HttpClient 在终态后产生的迟到数据、异常或回调不得进入事件队列；
- 流式缺 `stop_reason`、Usage 或 `message_stop` 不得发 EOS；已发文本前缀可以保留，但最终必须为失败；
- 结构化输出只有完整 JSON 验证通过才可作为一个 Payload 发出，局部或非法 JSON 不得泄露为 Text Delta。

## 模型、Prompt、记忆和安全边界

- 不调用真实模型，不读取本机凭据，不使用真实域名、真实用户数据或供应商 SDK；
- Adapter 只做协议转换与失败归一化，不决定 Provider、模型准入、区域、合同、路由、重试、fallback 或业务安全策略；
- Prompt 只在内存中序列化到唯一 loopback 请求，不持久化、不记录日志、不进入 Evidence；
- Provider Session 和输出都不是 Canonical Truth，EOS 只终止当前 Attempt；
- 不引入付费软件、企业功能、托管 SaaS、Docker 或外部服务作为构建/测试前提。

## 验收标准

1. 根 Maven 聚合新增且仅新增 Anthropic Adapter 与独立合同测试模块，依赖方向为 tests → model-anthropic → modelruntime → catalog；Runtime classpath 不含新 Adapter。
2. Adapter 仅接受完整 `ExternalAttemptBinding`，确定性 Binding 形成 `UnsupportedBinding` 且 mock-server 请求计数为 0。
3. 每个合法 Session 的 `HttpClient.sendAsync` 调用计数恰为 1；429、5xx、超时、解析失败和取消均无重试、路由或 fallback。
4. 请求合同逐项断言 method、`/v1/messages`、Content-Type、`x-api-key` Header、`anthropic-version` Header、model、`system`/`messages`、`max_tokens`、`stream`；授权快照不进入请求。
5. 机器真源 14 项 `non_stream_success`、`sse_stream_success`、`unicode_and_long_text`、`usage_mapping`、`finish_or_stop_reason_mapping`、`429_mapping`、`5xx_mapping`、`connect_timeout`、`first_token_timeout`、`total_timeout`、`malformed_event`、`cancellation`、`late_token_fence`、`structured_output_when_claimed` 全部由本模块离线测试覆盖。
6. 非流与 SSE 都保留完整 Binding、从 0 连续 sequence、恰好一个末尾终态；终态后的 late token/late callback 被丢弃。
7. SSE 只有在合法 stop reason、Usage 与 `message_stop` 全部到齐后才 EOS；非法 Content-Type/JSON/SSE、缺 `message_stop`、缺 Usage、重复终止或非法事件类型均失败关闭。
8. 结构化非流/流式都只输出一个经 JSON 语法验证的 `StructuredJson`；结构化流不输出中间 Text Delta。
9. Connect、First Token、Total 三段超时分别形成正确 TimeoutPhase；取消/关闭幂等，且不会被迟到成功覆盖。
10. 新代码无日志依赖或日志语句；Adapter、配置、Session 与归一化失败的字符串表示不包含合成 Key、正文或授权快照；异常不携带响应正文。
11. 所有 mock-server 都仅绑定 `127.0.0.1:0`，测试不读取环境变量、真实 Key、真实域名、Docker 或公网；零真实外发有自动断言。
12. Catalog/Contract/modelruntime、Conversation、Safety、OpenAI/Fake/Failure、OpenAI 合同测试、Runtime、Frontend、DB、Deploy、CI、Harness 和 Agent/Skill 规则保持未修改。
13. 固定 JDK 25 下目标 Maven verify、完整 Harness 测试、canonical Precheck 与 `git diff --check` 全部 PASS。
14. 未参与实现的独立 Reviewer 绑定精确实现 Commit 与 Git Tree 复核通过（C3 independentReview 保护路径）。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。canonical Precheck 已包含正式 Doctor、Catalog validate/drift、付费依赖与 Beta Gate，不再额外安排相同终态快照上的 standalone Doctor/Catalog 命令；目标模块的 Maven 合同测试作为受影响模块测试在 Evidence Pack 中记录真实执行、退出码与提交 SHA。Maven 命令执行时只为该进程指定项目固定 Temurin JDK 25。

Evidence Pack 还必须分别记录 14 项离线合同覆盖、请求计数/loopback 断言、独立 Reviewer，以及真实 Provider、凭据、区域、合同、Runtime 外发、Alpha live、Beta、支付和安全政策为 `NOT_RUN`。

## 回滚或前向修复

本任务不含数据库、外部资源或 Runtime 接线。失败时只在新 Adapter、合同测试模块和根 POM 内前向修复；不得通过修改 `modelruntime`、Catalog/Contract、删除失败测试、放宽 Binding/终态条件或引入真实网络制造通过。若现有端口不足，记录 BLOCKED 并由 Owner 另开受保护 Contract/modelruntime 任务。

## 停止条件

- 必须修改 Catalog、Contract、生成物、`modelruntime`、Conversation、Safety、OpenAI/Fake/Failure、Runtime、CI、Harness、Agent 或 Skill 才能实现；
- 需要选择真实 Provider、模型、Key、域名、区域、合同、价格、路由、重试、fallback、Runtime 外发或安全政策；
- 需要访问非 loopback 网络、环境 Secret、Docker、数据库或外部服务；
- 无法证明每 Session 单请求、完整 Binding、三段超时、终态唯一、迟到事件丢弃或缺 Usage/`message_stop` 时不 EOS；
- 独立 Reviewer 发现 P0/P1，或 R2 后仍有新 P0/P1。

## Evidence Pack

输出到 `docs/evidence/TASK-0033/`，并生成 `docs/handoffs/TASK-0033.json`。C3 实现必须由未参与修改的独立 Reviewer 绑定精确实现 Commit 与 Git Tree 复验。
