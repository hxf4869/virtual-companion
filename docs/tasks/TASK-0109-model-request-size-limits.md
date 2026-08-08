# TASK-0109：模型请求/响应尺寸与成本上限（P2-06 三层上限 + OpenAI max_tokens）

```yaml
taskId: TASK-0109
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
baseCommit: 7b3c11415488988ddab20e3b30624e5d686dd2f8
authorizationCommit: ""
contextFingerprint: 17e6c47e55eeff5c3875f5425ee30305609aecfc4d82b5c02db451eb4201cae8
contextLock: docs/tasks/context/TASK-0109.context-lock.yaml
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
  surfaceId: TASK_0109_MODEL_SIZE_COST_LIMITS
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
  - docs/handoffs/TASK-0108.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/model-protocol-contract.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ContractChecks.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/StopReason.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolBoundaryContractTest.java
writeAllowlist:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0109/**
  - docs/handoffs/TASK-0109.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ProtocolMessage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/**
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-anthropic/**
  - "service/adapters/model-fake/**"
  - "service/adapters/model-failure/**"
  - "service/tests/model-protocol-contract-tests/**"
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/CountingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/NeverCompletingHttpClient.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsFailureContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
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
    sourceThreadId: zcode-audit-fix-20260809
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 12（Provider）分配本卡：工作包 12 经
      delivery-policy complexityGate 评估拆为多张串行卡；本卡为第三张 P2-06
      模型请求/响应尺寸与成本上限（HTTP/domain/adapter 三层独立上限，超限
      主动 cancel 并归一化失败；OpenAI 请求显式设置输出 token 上限）。
      尺寸/成本上限数值经 AskUserQuestion 由 Owner 确认采用交接文档候选
      方案 A：消息数 ≤64、单条消息 ≤64 KiB、结构化 schema ≤16 KiB、单流
      事件 ≤1 MiB、累计输出 ≤1 MiB、OpenAI max_tokens ≤8192（本卡按此
      数值实现，无需 amendment）。本卡触碰 service/**/modelruntime/**
      的 contract/execution（protected glob C3，model-routing-change skill
      + 独立 Reviewer）+ service/adapters/model-openai 的 Codec/Session；
      不触碰 specs/** 与 **/db/migration/**（forbiddenPaths）。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0109
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0108 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0109 起）。工作包 12 按 delivery-policy complexityGate 拆为多张串行卡（TASK-0107 协议正确性、TASK-0108 egress 安全已 ACCEPTED），本卡为第三张 P2-06；本卡单风险面（provider 尺寸/成本边界，AUTHORIZATION），estimatedWallMinutes 85（<90）不触发拆卡。触碰 `service/**/modelruntime/**`（contract/execution，protected glob C3 → model-routing-change + 独立 Reviewer）；humanApprovals 已预填 Owner 分配记录与 P2-06 数值决策（方案 A）。

## 背景与用户可观察目标

2026-08-08 审计确认 P2-06：模型请求/响应缺少尺寸和成本上限——消息数、内容、结构化 schema、
单事件、累计输出均无明确上限；OpenAI 请求也未显式设置输出 token 上限。恶意输入/provider 或高并发
可耗尽堆、线程和供应商额度。审计要求：在 HTTP、domain、adapter 三层设置独立上限，超限主动 cancel
并归一化失败。

用户可观察结果：超限请求在构造/编码阶段即失败关闭（不发出网络请求）；超限响应（单事件/累计输出）
在消费阶段失败关闭（不污染输出与计费）；OpenAI 请求显式携带 max_tokens=8192 上限；合法流量行为
不变（既有契约测试全绿）。

## 范围内

- 新增 `SizeLimits`（modelruntime/contract，集中上限常量）：`MAX_MESSAGES=64`、
  `MAX_MESSAGE_BYTES=64*1024`、`MAX_SCHEMA_BYTES=16*1024`、`MAX_STREAM_EVENT_BYTES=1024*1024`、
  `MAX_TOTAL_OUTPUT_BYTES=1024*1024`、`MAX_OPENAI_OUTPUT_TOKENS=8192`（Owner 已确认方案 A 数值）。
- domain 层（构造即拒绝）：`ProtocolMessage` content UTF-8 字节 ≤ MAX_MESSAGE_BYTES；
  `LiveInvocationRequest` 消息数 ≤ MAX_MESSAGES；`ModelProtocolRequest` 结构化 schema
  （ResponseMode.StructuredJson.jsonSchema）≤ MAX_SCHEMA_BYTES。
- adapter 层（编码/消费）：`OpenAiChatCompletionsCodec.encodeRequest` 显式设置 `max_tokens`
  = MAX_OPENAI_OUTPUT_TOKENS（OpenAI 请求输出 token 上限）+ schema 大小复核；
  `OpenAiChatCompletionsSession` 流式单事件（SSE data）≤ MAX_STREAM_EVENT_BYTES、累计输出
  （文本/结构化累积）≤ MAX_TOTAL_OUTPUT_BYTES，非流完成内容 ≤ MAX_TOTAL_OUTPUT_BYTES；超限
  → OpenAiCodecException 归一化失败关闭（Session 既有失败路径）。
- `LiveModelInvoker`（execution，审计 :168 处）：domain 输出兜底——builder 累计长度 >
  MAX_TOTAL_OUTPUT_BYTES → 失败关闭（MalformedResponse + ALL_FAILURE 额度释放 +
  NON_RETRYABLE_FAILED audit，复用 fenceViolationOutcome 同构路径）。
- 测试：`ModelProtocolContractValueTest`/`LiveModelInvokerTest` 增加上限负例与兜底用例；
  OpenAI Boundary 契约测试增加请求侧上限负例（消息数/单条/schema）与 max_tokens 断言、
  Session 单事件/累计输出上限负例（流式 mock 超限 chunk）。

## 明确范围外

- Provider egress allowlist（TASK-0108 已闭环）、P2-01/P2-02 协议 fence（TASK-0107 已闭环）、
  条件风险 6/7（db/migration C4）、P2-03/04/13（Auth，工作包 13）。
- Anthropic adapter 的尺寸上限（审计位置未点名；Anthropic 已有 maxTokens>0 校验，本卡不做
  Anthropic 输出上限——记入 Handoff 待后续评估）。
- 真实 Provider 接线（TASK-0035 闸门）、controller/dispatcher 接线（TASK-0093）。
- 不触碰 `service/**/modelruntime/**` 的 guard|authorization|registry|routing|port（forbiddenPaths
  只读）；不触碰 adapter 其他文件、specs/**、db migration、前端、身份、记忆、安全模块。

## 输入和前置条件

Context Lock 输入全部使用 Base Commit `7b3c114` 中的仓库相对路径；算法
`SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1`。相关输入：`ProtocolMessage`/`ModelProtocolRequest`/
`LiveInvocationRequest`/`LiveModelInvoker`/`ModelProtocolEventFence`（TASK-0107 闭环物）、
`OpenAiChatCompletionsCodec`/`Session`/`Adapter`/`Config`（TASK-0108 egress 已接线）、
`OpenAiContractTestSupport`/Boundary/Success 契约测试、`specs/contracts/model-protocol-contract.yaml`。
上限数值来自 Owner 确认的方案 A（见 humanApprovals）。

## API / 事件 / 数据契约

- `SizeLimits`（新，public final，modelruntime/contract）：静态常量 + `requireWithin`/校验辅助
  （错误消息不含凭据/内容）。
- `ProtocolMessage`/`LiveInvocationRequest`/`ModelProtocolRequest` 构造语义不变（失败类型
  IllegalArgumentException，fail-closed）；超限消息不泄漏内容本身。
- `OpenAiChatCompletionsCodec.encodeRequest` 输出新增 `"max_tokens": 8192`（请求体变化）；
  契约测试须断言该字段存在且数值正确。
- 流式超限（单事件 >1 MiB 或累计 >1 MiB）与非流内容超限 → `OpenAiCodecException` → Session
  失败关闭（`AttemptFailed` MalformedResponse，既有路径）；Invoker 兜底超限 → 失败关闭同
  fence 违规语义。
- 不改变 `ModelProtocolEvent`/`ModelPayload`/binding/授权快照结构；INV-AUTH-001 语义不改变。

## 权限、RLS 和数据处理要求

- 无数据库变更；无凭据读取；请求/响应文本仍不进入业务类型（ProviderAttemptAudit 只携带身份与
  结果）。
- 尺寸校验为纯内存计算（UTF-8 字节长度/元素计数），不新增外部依赖。
- 本卡修改路径：`service/modules/modelruntime/**/contract|execution`（C3 protected）+
  `service/adapters/model-openai/**/Codec|Session` + openai 契约测试（Boundary/Success 两文件），
  均在 writeAllowlist。

## 状态机和失败行为

- 请求侧：`ProtocolMessage`/`LiveInvocationRequest`/`ModelProtocolRequest` 构造时超限 →
  IllegalArgumentException（fail-closed，请求绝不发出）。
- 编码侧：schema 超限或 max_tokens 无法设置 → `OpenAiCodecException` → adapter open() 返回
  ImmediateTerminalSession.failed（MalformedResponse），零网络调用。
- 输出侧：单事件/累计输出超限 → OpenAiCodecException → Session terminateFailed；Invoker 兜底
  累计超限 → 失败关闭（MalformedResponse + ALL_FAILURE + NON_RETRYABLE_FAILED）。
- 合法流（既有契约测试）行为不变：不误伤正常 chunk/事件序列。

## 模型、Prompt、记忆和安全边界

- 不改变 Prompt/Persona 内容与模型名注入；max_tokens 为 OpenAI 请求输出上限（成本/资源护栏）。
- 记忆（memory）、安全（safety）、db migration 路径 forbiddenPaths 内不触碰。
- 上限数值为 Owner 确认值（方案 A）；如 Owner 后续修订数值，走 amendment 流程。

## 验收标准

1. `SizeLimits` 常量与 Owner 确认数值一致（消息数 64、单条 64 KiB、schema 16 KiB、单事件 1 MiB、
   累计输出 1 MiB、max_tokens 8192）。
2. `ProtocolMessage`：content UTF-8 字节 > 64 KiB 构造抛 IllegalArgumentException；边界值（恰好
   64 KiB）通过。`LiveInvocationRequest`：消息数 > 64 抛 IllegalArgumentException；边界 64 通过。
   `ModelProtocolRequest`：StructuredJson schema > 16 KiB 抛 IllegalArgumentException。
3. `OpenAiChatCompletionsCodec.encodeRequest`：请求体含 `"max_tokens":8192`（Success 契约测试
   断言）；schema > 16 KiB 抛 OpenAiCodecException（Boundary 契约测试负例）。
4. `OpenAiChatCompletionsSession`：流式单事件 data > 1 MiB → 失败关闭（AttemptFailed
   MalformedResponse）；累计输出 > 1 MiB → 失败关闭；非流完成内容 > 1 MiB → 失败关闭
   （Boundary/契约测试负例，mock 超限 chunk/body）。
5. `LiveModelInvoker`：ScriptedAdapter 发出累计 > 1 MiB 的 OutputDelta 序列 → 失败关闭
   （MalformedResponse + 额度释放 + NON_RETRYABLE_FAILED），不产生部分输出（LiveModelInvokerTest
   新用例）。
6. 既有 OpenAI Success/Boundary/Timeout 契约测试、modelruntime 既有测试全部通过（无 skip）；
   `git diff --check` 干净；根级 Maven `verify`（docker JDK 25 + vc-maven-cache）BUILD SUCCESS；
   canonical precheck 5/5 PASS；独立 Reviewer（C3）R1 PASS（阻塞 P0/P1 为零）。
7. 定向测试（-pl 含 modelruntime + model-openai + openai-chat-completions-contract-tests +
   model-protocol-contract-tests 编译面，-am）BUILD SUCCESS。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；根级 Maven verify
（docker JDK 25，vc-maven-cache）是任务特有后端门禁（precheck 不含 Maven），只运行一次并记录真实
BUILD SUCCESS/FAILURE；`git diff --check` 只运行一次。定向模块测试在迭代中运行（不冻结为 Evidence
命令）。所有命令记录真实状态、退出码、验证 Commit/Tree、容器/解释器与环境身份。远程 CI 因 Actions
配额耗尽（resetDate 2026-08-01 周期）如实记录非 PASS（passClaimed=false），本地等价验证为备用通道
（Owner 既有授权）。

## 回滚或前向修复

- 修复采用最小实现与测试变更；若根级 verify 失败，先确认失败集合是否超出本卡范围，超范围即停止
  并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新
  P0/P1，禁止第三轮。
- 无持久数据变更（无迁移）；回滚 = 修正文件后重跑根级 verify 与 precheck。
- READY 后如需增加路径或改变条款（如 Owner 修订上限数值），只能停止并走 Backlog 强类型 Owner
  amendment。

## 停止条件

- Context、批准、Skill、allowlist、候选身份、Reviewer、canonical、CI 或远端验证失败时停止晋级
  （fail closed）。
- 发现需要修改 writeAllowlist 外路径（如 contract yaml、db migration、Anthropic adapter、其他
  contract test）时停止并询问 Owner。
- 达到 hardFuseWallMinutes 90 时停止实现与复核，仅允许 closure-only 收尾（Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0）。
- Owner 若修订上限数值，先停下按 amendment 流程处理。
- 条件风险 6/7 与 Anthropic 输出上限不纳入本卡；如 Owner 要求本卡承担，先停下重建范围。

## Evidence Pack

输出到 `docs/evidence/TASK-0109/`，并生成 `docs/handoffs/TASK-0109.json`。
