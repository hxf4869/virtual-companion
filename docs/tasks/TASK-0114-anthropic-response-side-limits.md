# TASK-0114：Anthropic Provider 响应侧有界解析与输出限制

```yaml
taskId: TASK-0114
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
baseCommit: e4937f2465dfcef5b6f06aea0fdb4dda5a0bc4d9
authorizationCommit: "2d3089b28e56637a9c23eaf430039b51c31cda60"
contextFingerprint: 2a603e307a2537dd0691462206d4934dc9e5430934aa29729603bab6dbd9aa4a
contextLock: docs/tasks/context/TASK-0114.context-lock.yaml
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
  surfaceId: TASK_0114_ANTHROPIC_RESPONSE_SIDE_LIMITS
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
  - docs/evidence/TASK-0113/evidence-pack.json
  - docs/evidence/TASK-0113/review-r1.md
  - docs/handoffs/TASK-0113.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/ImmediateTerminalSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/SseDecoder.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/BoundedInputStream.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/SseDecoder.java
  - service/adapters/model-openai/src/test/java/com/virtualcompanion/modelopenai/BoundedInputStreamTest.java
  - service/adapters/model-openai/src/test/java/com/virtualcompanion/modelopenai/SseDecoderTest.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
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
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0114/**
  - docs/handoffs/TASK-0114.json
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/BoundedInputStream.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/SseDecoder.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/BoundedInputStreamTest.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/SseDecoderTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/evidence/TASK-0113/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0113.json
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
  - service/modules/modelruntime/**
  - service/adapters/model-openai/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/ImmediateTerminalSession.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/model-protocol-contract-tests/**
  - service/tests/generation-contract-tests/**
  - service/tests/memory-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
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
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/evidence/TASK-0113/evidence-pack.json
  - docs/evidence/TASK-0113/review-r1.md
  - docs/handoffs/TASK-0113.json
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
      TASK-0113 Handoff 与 project-state 的唯一下一动作逐字指定创建 TASK-0114，独立处理
      Anthropic response-side limits；本卡不追溯改写任何历史任务。
  - scope: anthropic-response-side-limits
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 长线授权允许 Codex 基于机器真源和最小风险原则决定工程数值。TASK-0113 已接受并冻结
      provider-neutral 的组合 SSE data payload 1 MiB、累计 UTF-8 输出 1 MiB 与 non-stream raw body
      8 MiB；本卡仅让 Anthropic adapter 复用这些既有常量，不新增或修改数值。Anthropic maxTokens
      上限、跨 frame raw budget 与 queue/backpressure 不在本卡，不宣称成本和背压风险全部关闭。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=usedMinutes=2000、
      paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110 exact-SHA run 31286798584
      在无 runner、零 step 状态终止；TASK-0112 与 TASK-0113 已按同一 READY 冻结 fallback 合规
      ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实为非 PASS。
independentReview: required
reviewers:
  - id: task0114_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 4c7ad4a272b32c331da69fca2c52884f22be47b3
    evidencePath: docs/evidence/TASK-0114/review-r1.md
    reason: 'R1 完整矩阵复核 PASS：候选 Commit/Tree、Context、逐父授权与 writeAllowlist 一致；8 MiB non-stream raw body、1 MiB SSE payload/物理行、严格 UTF-8、累计 output、跨 delta surrogate、early-stop、cancel/body-close 均满足验收；P0/P1/P2/P3 为零。'
    candidateTree: 632da5e009b86a5d39b8d8362d319936b6af0c63
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0114
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime,service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests,service/tests/model-protocol-contract-tests -am test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。TASK-0113
> 已在当前 Base ACCEPTED 并把 Anthropic response-side limits 冻结为唯一下一动作。本卡从其终态提交重新
> 冻结 Context，以独立候选 Commit/Tree、Reviewer 和本地 exact-tree channel 关闭 Anthropic 缺口。

## 背景与用户可观察目标

当前获批 Anthropic Messages adapter 会在 non-stream 路径把任意大小 response body 直接交给 Jackson，
在 streaming 路径用 `BufferedReader.readLine` 和 `String.join` 无界读取/聚合 SSE，并在 adapter emit/append
前不限制累计输出。完成本卡后，Anthropic 响应在物化、事件 dispatch 和输出 emit 之前分别受既有原始
字节/UTF-8 上限保护；超限和畸形响应稳定失败关闭，取消或失败都能关闭 response body。

## 范围内

- 在 Anthropic adapter 内新增 package-private `BoundedInputStream`，在 Jackson `readTree` 前用
  `SizeLimits.MAX_NON_STREAM_RESPONSE_BODY_BYTES` 限制原始响应。
- 以逐 raw byte 的有界 parser 替换 Anthropic `BufferedReader.readLine`/列表/`String.join`；保持
  `data:` 多行组合、显式 `event:` 行、comment heartbeat、CR/LF/CRLF、空行和 EOF 的既有语义。
- 组合 `data` payload 以原始 bytes 计数，多行间插入 LF 计入 1 MiB；固定 framing 不计入 payload；
  data/event/comment 物理行均独立有界，首个违规 byte 即停止读取。
- 在 data event dispatch 前执行严格 UTF-8 解码；malformed/unmappable data 不允许 replacement 后继续。
- 在 non-stream payload 产生后、streaming text emit 或 structured partial append 前，按 UTF-8 bytes 检查
  `SizeLimits.MAX_TOTAL_OUTPUT_BYTES`；one-over 不 emit/append 违规内容，不产生 Usage/EOS。
- 补 direct parser/stream 单测和 Anthropic contract tests，覆盖 exact/one-over、非 BMP、invalid UTF-8、
  early-stop、无 partial success、session cancel 与 body close。

## 明确范围外

- 不修改 TASK-0109 至 TASK-0113 的卡、Context、Evidence、Review 或 Handoff，也不重判历史结果。
- 不修改 OpenAI、modelruntime 常量或公共协议、OpenAPI/Catalog、runtime 配置、controller、dispatcher、
  persistence、数据库、前端、CI 或 Provider 凭据/路由。
- 不为 Anthropic `maxTokens` 新增或猜测上限；现有仅 `>0` 的成本风险保留给独立后续卡。
- 不解决 OpenAI/Anthropic 无界事件 queue/backpressure；不新增跨连续 comment/empty-data frame 的累计
  raw SSE 总预算；物理行与单个组合 data event 有界不等于全连接背压。
- 不要求 non-stream 最终 payload 1 MiB 检查早于受 8 MiB raw fence 保护的 JSON 物化；early-stop 证明
  限定为 raw-body fence、SSE physical/event fence 和 streaming emit/append 前检查。

## 输入和前置条件

Base 是 TASK-0113 ACCEPTED 终态 `e4937f2465dfcef5b6f06aea0fdb4dda5a0bc4d9`，与 `origin/main`
0/0 且工作树干净。Context Lock 仅绑定该 Base 中的机器真源、TASK-0113 的已接受边界/Reviewer 证据、
模型协议合同、当前 Anthropic/OpenAI 参考实现、POM 和相关测试；不依赖历史聊天或仓库外文件。

当前 Base 已确认 Anthropic 是获批且运行时可接线的 Provider。`SizeLimits` 中 1 MiB event、1 MiB output
与 8 MiB non-stream body 是 provider-neutral 常量；本卡不修改常量、Anthropic request config 或公开 API。

## API / 事件 / 数据契约

- `SseDecoder` 和 `BoundedInputStream` 保持 adapter 内部 package-private，不引入新的运行时依赖。
- `event:` 行仍被忽略，因为 JSON `type` 是真实事件判别；comment heartbeat 仍被忽略。二者必须受物理行
  raw-byte 上限，但只有要 dispatch 的组合 data payload 必须先严格 UTF-8 解码。
- 组合 data payload 多行之间插入一个 LF 并计入 1 MiB；`data: `、`event: `、CR/LF 和空行不挤占
  payload 预算。单物理 data/event 行可额外容纳其固定 ASCII framing，comment 无 framing 豁免。
- non-stream body exact 8 MiB 可进入 Jackson；one-over 最多读到第 8 MiB+1 个 byte 后失败。

## 权限、RLS 和数据处理要求

不修改租户、RLS、凭据、日志或数据库。错误不得包含 provider body、prompt、schema、token、凭据或异常原文；
raw/event/output 超限与畸形 UTF-8 统一观察为既有非敏感 `AdapterFailure.MalformedResponse`。

## 状态机和失败行为

- raw body、SSE physical/event 或累计输出 one-over，以及 invalid UTF-8/framing/JSON，均关闭 response body，
  停止解析，不产生 UsageReported 或 AttemptEos。
- SSE event 在 byte budget 与严格 UTF-8 全部通过前不得 dispatch；overflow/invalid event 不产生该事件的
  OutputDelta。先前已完整合法 emit 的 delta 不能被晚到失败改写为 success。
- streaming text 与 structured partial 在累计 UTF-8 计数通过后才能 emit/append；non-stream 最终 payload
  也必须在 Usage/EOS 前检查 1 MiB。
- cancel/close 保持幂等；取消要关闭当前 body 并中止 parser，晚到 bytes/events 不能改变唯一终态。

## 模型、Prompt、记忆和安全边界

请求侧消息/schema 限制、模型路由、授权 snapshot、Provider Attempt、quota/retry/timeout 与 Provider EOS
语义均不变。任何测试只使用合成数据与 loopback/custom HttpClient，不触发真实网络或付费 Provider。

## 验收标准

1. `SizeLimits` 精确保持组合 SSE data payload 1 MiB、累计输出 1 MiB、non-stream raw body 8 MiB；
   Anthropic adapter 复用常量且不修改 modelruntime、公开协议或请求数值。
2. `BoundedInputStream` direct tests 覆盖单字节、bulk 非零 offset/哨兵、skip/available、exact EOF、
   one-over 单 probe、mark/reset 禁用；底层 bulk request 不跨过 remaining fence。
3. Anthropic SSE 单行/多行 data 的 ASCII 与非 BMP exact 1 MiB 通过；one-over 在首个违规 byte 停止；
   插入 LF 计预算，framing 不计；data/event/comment 物理行 exact/one-over 均有 direct evidence。
4. CR/LF/CRLF、EOF、empty data、comment heartbeat 与显式 event 行兼容语义不回归；unknown field 仍失败。
5. malformed UTF-8 data 在 consumer dispatch 前失败为唯一 MalformedResponse，不产生该 event 的
   OutputDelta、Usage 或 EOS，并关闭 body；错误文本不含 provider data。
6. non-stream exact 8 MiB 可解析并关闭；one-over 只读取 8 MiB+1、Jackson 不能先无界物化，失败为
   MalformedResponse 且无 Output/Usage/EOS；含非 BMP 的 raw body 仍按 encoded bytes 计数。
7. streaming text、structured partial 与 non-stream 最终 payload 的累计 UTF-8 output exact 1 MiB 通过；
   one-over 在 emit/append 或成功终态前失败，不产生违规 delta、Usage/EOS，body 最终关闭。
8. session cancel 在取得合法 delta 后仍立即关闭 body并产生唯一取消终态；raw/SSE overflow 的 tracking
   input 证明 sentinel 未读取。既有 Anthropic success/failure/timeout/structured tests 全部通过。
9. TASK-0109 至 TASK-0113 历史、OpenAI、modelruntime、specs、runtime app、数据库、前端和 CI 无变更；
   所有候选路径都在 writeAllowlist，queue/backpressure/maxTokens 风险未被错误宣称关闭。
10. 定向 reactor、根级 Maven verify、canonical precheck 与唯一无参数 `git diff --check` 均在独立
    Reviewer PASS 后绑定同一冻结候选 Commit/Tree 并真实 PASS；远端保持非 PASS，不冒充本地结果。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。实现期间允许用精确 `-Dtest` 子集迭代；正式定向 reactor、
根级 Maven、canonical 和无参数 `git diff --check` 各执行一次，不重复 canonical 已包含的子命令。所有
结果记录真实退出码、完整候选 Commit/Tree、环境与 stdout/stderr 哈希。

## 回滚或前向修复

候选冻结前可在唯一 fix batch 内前向修复；不得放宽上限、吞异常、默认替换畸形 UTF-8、删除测试或扩展
读取来制造 PASS。候选冻结后 Reviewer 发现阻塞项时，按最多一个 fix batch、最多 R2 处理；出现新的结构性
P0/P1 或需越界修改则失败关闭并创建永久 replacement。

## 停止条件

- 需要修改 writeAllowlist 外路径、协议真源、OpenAI/modelruntime/runtime app、queue/backpressure 或 maxTokens。
- 需要改变 1 MiB/1 MiB/8 MiB 数值、模型路由、授权、quota、终态、数据库或公开 API。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS，或触发 90 分钟 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0114/` 与 `docs/handoffs/TASK-0114.json`；记录候选身份、R1/R2、exact/one-over、
early-stop/body-close 测试、正式门禁、远端非 PASS 与本地 exact-tree 限定覆盖。终态只用单父原子提交更新
任务卡、Project State、Task Ledger、Evidence 与 Handoff，随后 push、fetch 并验证
`HEAD...origin/main` 为 0/0。Handoff 必须保留 Anthropic maxTokens 与 OpenAI/Anthropic 无界事件
queue/backpressure 为未关闭风险，并给出与 `project-state.nextAction` 逐字一致的唯一下一动作。
