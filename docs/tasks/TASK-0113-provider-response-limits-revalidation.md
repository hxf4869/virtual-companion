# TASK-0113：OpenAI Provider 响应上限重新验收与 UTF-8 边界加固

```yaml
taskId: TASK-0113
state: ACCEPTED
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
baseCommit: c91f325fa836f296463edad9197c25d78d8526ae
authorizationCommit: "148cff00ff9b6eb68e1416b2369ddaa4e3e8d962"
contextFingerprint: 5679311f069f4ea7508a8b940ea52bd59e050a310eb058eb18300d8f712a71cc
contextLock: docs/tasks/context/TASK-0113.context-lock.yaml
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
  surfaceId: TASK_0113_PROVIDER_RESPONSE_LIMITS_REVALIDATION
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
  - requirements-harness.txt
  - docs/evidence/TASK-0102/evidence-pack.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0110/evidence-pack.json
  - docs/evidence/TASK-0110/remote-exact-sha.json
  - docs/evidence/TASK-0110/review-r1.md
  - docs/evidence/TASK-0110/review-r2.md
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/evidence/TASK-0112/review-r1.md
  - docs/handoffs/TASK-0102.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0112.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/BoundedInputStream.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiCodecException.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
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
  - service/tests/model-protocol-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/pom.xml
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
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0113/**
  - docs/handoffs/TASK-0113.json
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/BoundedInputStream.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/adapters/model-openai/src/test/java/com/virtualcompanion/modelopenai/BoundedInputStreamTest.java
  - service/adapters/model-openai/src/test/java/com/virtualcompanion/modelopenai/SseDecoderTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/ModelProtocolContractValueTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - infra/**
  - frontend/**
  - scripts/**
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
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
  - service/apps/**
  - service/platform/**
  - service/adapters/model-anthropic/**
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiCodecException.java
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
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/evidence/TASK-0110/evidence-pack.json
  - docs/evidence/TASK-0110/review-r1.md
  - docs/evidence/TASK-0110/review-r2.md
  - docs/evidence/TASK-0110/remote-exact-sha.json
  - docs/handoffs/TASK-0110.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/handoffs/TASK-0112.json
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
      TASK-0112 Handoff 与 project-state 的唯一下一动作均指定由 TASK-0113 重新验收
      TASK-0110 Provider response early-limit；本卡不追溯改写 TASK-0110 的 REJECTED 历史。
  - scope: provider-response-limit-revalidation
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      沿用 Owner 已冻结的七项上限：消息数 64、单消息 UTF-8 64 KiB、schema UTF-8
      16 KiB、组合 SSE data payload 1 MiB、累计输出 1 MiB、OpenAI max_tokens 8192、
      非流 raw body 8 MiB。按长线授权采用最小风险前向加固：malformed UTF-8 必须失败关闭，
      并补齐非 BMP exact/one-over、BoundedInputStream 非零 offset、overflow 无 partial event
      和 cancel 关闭 body 的可执行证据；通用 invoker 的 terminalless/异常失败也显式
      cancel，不再假定 close 等价于 cancel；不改变既有数值。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=usedMinutes=2000、
      paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110 exact-SHA run 31286798584
      在无 runner、零 step 状态终止；TASK-0112 已用同一 READY 冻结 fallback 合规 ACCEPTED。
      本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实为非 PASS。
independentReview: required
reviewers:
  - id: task0113_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 383d78ddc0375263ab429a75c6aefa9d18364f5f
    evidencePath: docs/evidence/TASK-0113/review-r1.md
    reason: 'R1 完整矩阵复核 PASS：候选 Commit/Tree 与 writeAllowlist 一致，七项上限、严格 UTF-8、non-BMP exact/one-over、early-stop、body close 与 invoker 显式 cancel 均有可执行证据；未发现 P0/P1，Anthropic response limits 与无界事件队列继续作为明确范围外风险。'
    candidateTree: f7002943f45e7c74d671a35be4e7dab091d471c6
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0113
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime,service/adapters/model-openai,service/tests/openai-chat-completions-contract-tests,service/tests/model-protocol-contract-tests -am test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。TASK-0110
> 因 READY 冻结的远端 exact-SHA 非 PASS 而 REJECTED，其源码仍在 main，但任何历史 PASS 都不能复用。
> TASK-0113 从 TASK-0112 的终态提交重新冻结 Context，以新候选 Commit/Tree 和本地 exact-tree channel
> 独立验收，并用最小测试/UTF-8 加固形成可审阅的前向候选。

## 背景与用户可观察目标

TASK-0110 已把 OpenAI 非流响应限制在 Jackson 物化前的 8 MiB，并把 SSE 改为逐字节有界解析；其唯一
终态阻塞是 PRIMARY_REMOTE_EXACT_SHA 未获得 runner，而不是 R2、canonical 或本地测试失败。当前 main
保留该实现，但 REJECTED 任务不能作为 Accepted 证据。完成本卡后，当前 HEAD 上的七项上限、early-stop、
资源关闭和通用 invoker cancel 将由新的候选身份重新证明；malformed UTF-8 不再被替换字符静默接受。

## 范围内

- 重新核验并保持七项冻结上限，不重命名、不放宽、不调整数值。
- `BoundedInputStream` 必须对 `read()`、带非零 offset 的 bulk read、`skip`、`available` 和 exact EOF
  共享同一预算；超过非流 8 MiB 时最多读取一个 overflow probe，不能向底层请求跨过 fence 的 bulk 长度。
- `SseDecoder` 继续按 raw byte 逐字节解析：组合 `data` payload 计入多行间插入 LF，但不把固定
  `data: `、CR/LF、comment 或空行挤占 payload 预算；物理行仍独立有界。
- 对 UTF-8 使用严格 decoder，malformed/unmappable 输入归一化为 `MalformedResponse`，不替换后继续解析。
- 补非 BMP exact/one-over、单行/多行 payload、comment、CRLF/CR、EOF、invalid UTF-8、无 partial
  overflow event、body close/cancel 和 BoundedInputStream offset/哨兵测试。
- 重新核验 `OpenAiChatCompletionsSession` 在 raw body/event/output 超限时关闭 body、无 Usage/EOS；
  `LiveModelInvoker` 在 fence、累计输出、terminalless 或读取异常失败时显式 `session.cancel()`，最终结果
  不返回 partial output，不依赖 `close()` 恰好等价于 cancel。

## 明确范围外

- 不修改 TASK-0109/TASK-0110/TASK-0112 的卡、Context、Evidence、Review 或 Handoff，也不把其结果改写为 PASS。
- 不修改 Anthropic、协议真源、OpenAPI/Catalog、generation/realtime controller、dispatcher、持久化、数据库或前端；
  Anthropic 的非流/SSE/累计输出限制是已确认的下一张 C3 卡，不是被接受的延期。
- 不新增跨连续 comment/empty-data 的累计 raw SSE frame 总预算；本卡保留“物理行有界 + 组合 data
  payload 有界”语义。
- 不解决 OpenAI/Anthropic queue/backpressure、provider-neutral schemaName 或总 encoded request-body
  预算；它们继续作为独立后续风险。
- 不改变模型路由、授权 snapshot、Provider Attempt、quota、retry、timeout 或终态 finalization 语义。

## 输入和前置条件

Base 是 TASK-0112 ACCEPTED 终态 `c91f325fa836f296463edad9197c25d78d8526ae`，与 `origin/main`
0/0 且工作树干净。Context Lock 仅绑定该 Base 中的机器真源、TASK-0110 不可变失败证据、TASK-0112
fallback 先例、模型协议合同、当前实现、POM 和相关测试；不依赖历史聊天或仓库外文件。

当前 HEAD 取证同时确认 Anthropic adapter 仍存在无界 `readTree`、`BufferedReader.readLine`/事件聚合与
adapter-side 累计输出缺口。该路径不属于 TASK-0110 的授权历史，且需要新增多文件、多模块契约测试；为避免
跨 Provider 扩张使本卡越过 90 分钟 hard fuse，本卡只关闭 OpenAI replacement，终态 Handoff 必须把
Anthropic response-side limit 作为下一张永久 C3 卡的唯一动作，不能宣称产品级 P2-06 已全部关闭。

## API / 事件 / 数据契约

- 七项常量及 public modelruntime API 不变；不新增第三方运行时依赖。
- `SseDecoder` 仍是 adapter 内部实现；严格 UTF-8 只把原先可能替换后继续的畸形 provider bytes 改为
  fail-closed `OpenAiCodecException`，外部统一观察为 `AdapterFailure.MalformedResponse`。
- 组合 SSE data payload 上限以原始 UTF-8 bytes 计数；多行之间的一个 LF 计入 payload，framing 不计入。
- 非流 body 上限在 Jackson `readTree` 前生效；exact 8 MiB 允许解析，one-over 最多读到第 8 MiB+1 字节。

## 权限、RLS 和数据处理要求

不修改租户、RLS、凭据、日志或数据库。错误不得包含 provider body、prompt、schema、token、凭据或异常原文；
超限/畸形路径只产生既有非敏感 `MalformedResponse`。

## 状态机和失败行为

- raw body/event/output one-over、invalid UTF-8、framing/JSON 失败均关闭 body，终止解析，并且不产生
  UsageReported 或 AttemptEos。
- SSE event 在完整通过 byte/UTF-8 检查前不 dispatch；overflow/invalid event 不产生该 event 的 OutputDelta。
- Invoker 检测 fence/累计输出违规时必须显式 cancel session，恢复 quota，并返回非重试失败与
  ZERO_LLM fallback，不携带 partial output；session 无 terminal event 或 `next()` 抛出异常时同样先 cancel。
- 取消和 close 保持幂等；晚到 bytes/events 不能改变唯一终态。

## 模型、Prompt、记忆和安全边界

输入消息/schema/request 的既有上限只复核，不扩展 Prompt 或记忆语义；Provider EOS 仍不等于
`chat.completed`。任何测试不得触发真实网络或付费 Provider。

## 验收标准

1. 七项常量精确保持 64、64 KiB、16 KiB、1 MiB、1 MiB、8192、8 MiB，UTF-8 计数与既有请求验证不回归。
2. BoundedInputStream direct tests 覆盖单字节、bulk 非零 offset、前后哨兵、skip/available、exact EOF、
   one-over 单 probe、mark/reset 禁用；底层 bulk request 不越过 remaining。
3. SSE 单行/多行 `data` payload 的 ASCII 与非 BMP exact 1 MiB 通过；one-over 在首个违规 raw byte
   停止；多行插入 LF 计预算；CRLF、CR、comment、empty data、EOF 兼容语义不回归。
4. malformed UTF-8 在事件 dispatch 前失败为唯一 `MalformedResponse`，不产生该 event 的 OutputDelta、
   Usage 或 EOS，并关闭 body。
5. 非流 exact 8 MiB 可解析并关闭；one-over 只读取 8 MiB+1、失败为 Malformed、无 Usage/EOS，
   Jackson 不能先无界物化。
6. 累计输出 one-over、fence violation、terminalless 和 `next()` 异常失败都调用 session.cancel；Invoker
   返回 ZERO_LLM fallback、恢复 quota、不暴露 partial output，adapter/session 唯一终态与 body close/cancel 可观察。
7. TASK-0110/TASK-0112 历史、Anthropic、specs、数据库、前端和 CI 无变更；所有候选路径在 writeAllowlist。
8. 定向 reactor、根级 Maven verify、canonical precheck 与唯一 git diff --check 均在独立 Reviewer PASS
   后绑定同一冻结候选 Commit/Tree 并真实 PASS；远端保持非 PASS，不冒充本地结果。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。实现期间可用精确 `-Dtest` 子集迭代；正式定向 reactor、
根级 Maven、canonical 和无参数 `git diff --check` 各执行一次，不重复 canonical 已包含的子命令。所有
结果记录真实退出码、输出哈希、候选 Commit/Tree 和环境。

## 回滚或前向修复

候选冻结前可在唯一 fix batch 内前向修复；不得放宽上限、吞异常或删除测试来制造 PASS。候选冻结后
Reviewer 发现阻塞项时，按最多一个 fix batch、最多 R2 的策略处理；出现新的结构性 P0/P1 即失败关闭。

## 停止条件

- 需要修改 writeAllowlist 外路径、协议真源、Anthropic、queue/backpressure、schemaName 或 encoded request-body。
- 需要改变七项数值、模型路由、授权、quota、终态、数据库或公开 API。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS，或触发 90 分钟 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0113/` 与 `docs/handoffs/TASK-0113.json`；记录新候选身份、R1/R2、测试/门禁、
远端非 PASS 与本地 exact-tree 限定覆盖。终态只用单父原子提交更新卡、Project State、Task Ledger、
Evidence 与 Handoff，随后 push、fetch 并验证 `HEAD...origin/main` 为 0/0。
Handoff 的唯一下一动作必须是创建 Anthropic response-side limits C3 卡：在 JSON 物化前限制 raw body，
以有界字节 parser 替换无界 SSE `readLine`/聚合，在 adapter emit/append 前限制累计 UTF-8 输出，并补
exact/one-over、Unicode、early-stop、cancel/body-close 合同测试；OpenAI/Anthropic 无界事件队列与
backpressure 仍需再拆独立契约任务。
