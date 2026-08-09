# TASK-0128：Anthropic Tool-Use 协议一致性

```yaml
taskId: TASK-0128
state: REJECTED
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
baseCommit: 2febf109eacb692096bbcae1baf15cc12138d2d0
authorizationCommit: 2dd3877079a48fbb7779f834199cbbfcf705a0f0
contextFingerprint: 40d8fae46a1197d2705954d15fc2d2e91f7df937f38dc265f07b73ffed437f24
contextLock: docs/tasks/context/TASK-0128.context-lock.yaml
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
  surfaceId: TASK_0128_ANTHROPIC_TOOL_USE_PROTOCOL_CONSISTENCY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
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
  - docs/evidence/TASK-0107/evidence-pack.json
  - docs/evidence/TASK-0107/review-r1.md
  - docs/evidence/TASK-0107/review-r2.md
  - docs/evidence/TASK-0127/evidence-pack.json
  - docs/handoffs/TASK-0107.json
  - docs/handoffs/TASK-0127.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0107-model-protocol-correctness.md
  - docs/tasks/TASK-0127-technical-alpha-capability-truth.md
  - docs/tasks/context/TASK-0107.context-lock.yaml
  - docs/tasks/context/TASK-0127.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0128-anthropic-tool-use-protocol-consistency.md
  - docs/tasks/context/TASK-0128.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0128/**
  - docs/handoffs/TASK-0128.json
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/TASK-0121-*
  - docs/tasks/TASK-0122-*
  - docs/tasks/TASK-0123-*
  - docs/tasks/TASK-0124-*
  - docs/tasks/TASK-0125-*
  - docs/tasks/TASK-0126-*
  - docs/tasks/TASK-0127-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - docs/tasks/context/TASK-0123.context-lock.yaml
  - docs/tasks/context/TASK-0124.context-lock.yaml
  - docs/tasks/context/TASK-0125.context-lock.yaml
  - docs/tasks/context/TASK-0126.context-lock.yaml
  - docs/tasks/context/TASK-0127.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/evidence/TASK-0121/**
  - docs/evidence/TASK-0122/**
  - docs/evidence/TASK-0123/**
  - docs/evidence/TASK-0124/**
  - docs/evidence/TASK-0125/**
  - docs/evidence/TASK-0126/**
  - docs/evidence/TASK-0127/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - docs/handoffs/TASK-0121.json
  - docs/handoffs/TASK-0122.json
  - docs/handoffs/TASK-0123.json
  - docs/handoffs/TASK-0124.json
  - docs/handoffs/TASK-0125.json
  - docs/handoffs/TASK-0126.json
  - docs/handoffs/TASK-0127.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/**
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
  - service/platform/**
  - service/apps/**
  - service/modules/**
  - service/adapters/model-openai/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/test/**
  - service/tests/model-protocol-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
  - service/tests/generation-contract-tests/**
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesMaxTokensContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesRawBudgetContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - frontend/**
  - infra/**
  - .mvn/**
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
  - specs/contracts/model-protocol-contract.yaml
  - docs/tasks/TASK-0107-model-protocol-correctness.md
  - docs/evidence/TASK-0107/review-r1.md
  - docs/evidence/TASK-0107/review-r2.md
  - docs/handoffs/TASK-0107.json
  - docs/evidence/TASK-0127/evidence-pack.json
  - docs/handoffs/TASK-0127.json
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-AUTH-001
  - INV-GEN-003
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 恢复当前长线 goal 并要求 Codex 按当前思考深度、不启用 fast、不逐项询问地继续审计修复；
      TASK-0127 已 ACCEPTED、推送且远端 0/0，其 Handoff 与 project-state 唯一 nextAction 指向 TASK-0128。
  - scope: anthropic-tool-use-protocol-consistency
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 长线授权要求串行处理审计与 Reviewer 遗留项。TASK-0107 R2 明确登记 tool_use name 未与
      请求 schemaName 对齐、content_block_stop index 未与 start 交叉校验以及混合非流组合测试缺口；
      TASK-0127 唯一 nextAction 要求本卡以协议错误 fail-closed 并补 contract tests。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。TASK-0112 至
      TASK-0127 已按同一 fallback 合规闭环；本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端如实非 PASS。
independentReview: required
reviewers:
  - id: task0128_r2
    kind: independent-review-gate
    verdict: TIMEOUT
    reviewedCommit: a18c5d8d7e3f2860fbae02147ce73429b6dbb5d9
    evidencePath: docs/evidence/TASK-0128/review-r2-timeout.md
    reason: >-
      R2 在 15 分钟 Reviewer 硬上限到达时没有可用终态输出；wait_agent 返回 timed_out=true。
      随后才由 list_agents 观察到的 PASS 文本属于 late output，不可倒推为期限内 PASS，因此停止晋级并
      以 TIMEOUT 关闭本卡。
    candidateTree: 3f759478734261db431731994879c8f0df5c8ade
    budget: {maximumMinutes: 15, elapsedSeconds: 900, hardLimitReached: true}
    interruption:
      terminalOutputReceived: false
      observedStatus: WAIT_AGENT_TIMEOUT_THEN_LATE_PASS_TEXT
      action: QUARANTINE_LATE_OUTPUT_AND_REJECT_TASK
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0128
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests -am -Dtest=AnthropicMessagesSuccessContractTest,AnthropicMessagesFailureContractTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡不在 Backlog 中，因此不写 `planningBacklog` 或 `planningContractHash`。只在 Anthropic adapter
> 解析/会话与精确 contract-test 白名单内前向修复，不改 TASK-0107 历史。

## 背景与用户可观察目标

TASK-0107 已接入 Anthropic 真实 tool-use，但其 R2 留下三个 P3：非流与流式 structured response 均未校验
provider 返回的 tool name 是否等于请求 `schemaName`；`content_block_start` 的 index 被丢弃，stop index
虽解析却未交叉校验；混合 text + tool_use 的非流组合缺少直接测试。相同遗漏还使 delta index 未被绑定到
当前 block，攻击性或损坏的 SSE 可以把不同 block 的片段错误拼接。

完成后，forced structured tool-use 只有在 name 与请求精确一致、start/delta/stop index 属于同一已打开
block 时才产生 StructuredJson/Usage/EOS；任何 name/index 违例固定转换为 `MalformedResponse`，不产生
structured output、usage 或 EOS。普通 text 与合法多 text block 行为保持。

## 范围内

- 非流 decode 保留 tool_use name 与 input，并在 structured session 对 name 与 `schemaName` 精确比较。
- 流式 decode 保留 content block start/delta/stop index；tool_use start 同时保留 name。
- Session 在消费 delta、stop 和 structured completion 前验证 open block index/name，拒绝多 structured block。
- 增加错误 name、start/delta/stop index mismatch、混合 text+tool_use 以及合法多 text/structured success 测试。

## 明确范围外

- 不改 provider endpoint、credential、model/max_tokens、body/event/output 上限、timeout/backpressure 或取消语义。
- 不改 provider-neutral contract、OpenAI adapter、routing/registry/quota/authorization、generation finalization。
- 不改 OpenAPI/Catalog/Contract、数据库、runtime、frontend、CI/Harness、依赖或生成物。
- 不修改 TASK-0107/TASK-0127 或任何历史 Task/Evidence/Handoff。

## 输入和前置条件

- Base 是 TASK-0127 已推送、远端 0/0 且 post-terminal Doctor PASS 的终态提交
  `2febf109eacb692096bbcae1baf15cc12138d2d0`。
- Context Lock 固定 Base 中 61 个治理、协议、实现与测试输入；TASK-0107 R1/R2 是遗留 finding 真源。
- 不调用真实 Anthropic；所有 contract tests 使用 loopback synthetic server 与合成协议帧。

## API / 事件 / 数据契约

不改变公开 API 或 provider-neutral event 类型。合法响应仍输出既有 `OutputDelta -> UsageReported -> AttemptEos`
序列；协议违例仍使用既有单一 `AttemptFailed(MalformedResponse)`，不新增错误枚举或状态。

## 权限、RLS 和数据处理要求

不触碰数据库/RLS。tool name 只与请求中已批准的 `schemaName` 比较，不写日志、不回显 provider 原文；
错误响应不进入下游 generation/finalization。

## 状态机和失败行为

- structured 非流必须恰有一个 tool_use，name 精确匹配且 input 是有效 JSON。
- structured 流必须 start -> 同 index input_json_delta* -> 同 index stop -> message delta/stop；name 精确匹配。
- text 流的 delta/stop 同样绑定 open index；不匹配时允许已发送 text delta 保持历史事实，但必须以
  `AttemptFailed(MalformedResponse)` 终止且不得产生 Usage/EOS。
- ignored ping、合法多个顺序 text block、大小/timeout/backpressure/cancel 的现有语义不变。

## 模型、Prompt、记忆和安全边界

不改 Prompt、Memory 或请求 schema 内容；仅验证 provider 回包没有越出请求声明的结构化工具和 block 边界。
无真实网络、凭据、模型输出或付费能力。

## 验收标准

1. 非流 structured wrong/missing/blank tool name 均产生单一 MalformedResponse；匹配 name 成功，混合 text
   prelude + matching tool_use 仍只输出 structured input。
2. 流式 structured wrong name、delta index mismatch、stop index mismatch、第二 tool block 均在结构化输出前
   失败且无 Usage/EOS；合法帧保持三事件 success batch。
3. text stream 的 start/delta/stop index 匹配；错 index 终态失败且不伪造 Usage/EOS，合法多 block 不回归。
4. Codec 对 start/delta/stop 的 index 使用 non-negative integer 校验；tool_use name 非空，text block 不要求 name。
5. provider 配置、上限、timeout/backpressure/cancel、ModelProtocol contract、OpenAI、数据库/specs 零 diff。
6. R1 对完整 protocol matrix、failure timing、adjacent risks、scope 与 P0/P1/P2/P3 给结构化终态。
7. frozen Precheck、targeted reactor、root JDK-25 verify 与唯一无参数 `git diff --check` 在同一 clean candidate
   按顺序各执行一次并 PASS。
8. Evidence/Handoff、单父终态提交、push/fetch、HEAD==origin/main、0/0 与 post-terminal Doctor PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前只运行有界 Success/Failure contract
迭代测试；正式 Precheck、targeted reactor、root verify 与无参数 diff check 各一次。远端 exact-SHA 继续
真实非 PASS，本地 fallback 只覆盖记录的候选 Commit/Tree、环境和输出哈希。

## 回滚或前向修复

- 候选前只在五个业务/测试白名单路径内前向修复；不改历史或放宽协议。
- Reviewer 范围内 P2/P3 最多一批修复并进入 R2；P0/P1、需改 provider-neutral contract 或第二批则 REJECTED。
- 终态后缺陷使用新永久 Task ID，不 amend/reset/rebase/squash。

## 停止条件

- 必须修改 provider-neutral contract、spec、网络/config、数据库或其他 forbidden path 才能闭合。
- 无法在不改变合法 text/structured output 次序下拒绝 name/index mismatch。
- Reviewer R2 后仍有 P0/P1 或范围内未闭合 P2，需第二 fix batch/R3，或达到 hard fuse。
- 任一 formal/pre-closure/push/remote 复核非 PASS。

## Evidence Pack

输出 `docs/evidence/TASK-0128/` 与 `docs/handoffs/TASK-0128.json`，绑定 Base、Context、候选 Commit/Tree、
Reviewer、精确命令与哈希、local/remote 渠道、delivery timing 和唯一 nextAction；终态原子更新 Task、
Project State、Ledger、Evidence/Handoff，以 `[skip ci]` 单父提交推送并复核远端。
