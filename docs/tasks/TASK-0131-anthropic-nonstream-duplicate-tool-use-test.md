# TASK-0131：Anthropic 非流重复 Tool-Use Contract Test

```yaml
taskId: TASK-0131
state: IN_PROGRESS
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
baseCommit: e4c90d168f02541771bf9c016fdd47f8ac5706aa
authorizationCommit: dc32bfb7f05d0f3a7bfbc8f16e111f8cc7217b96
contextFingerprint: b01c848205b29c4396858cc11c674472ab96a98ffa07481700acba01a243740b
contextLock: docs/tasks/context/TASK-0131.context-lock.yaml
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
  surfaceId: TASK_0131_ANTHROPIC_NONSTREAM_DUPLICATE_TOOL_USE_CONTRACT_TEST
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 45
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
  - docs/evidence/TASK-0128/evidence-pack.json
  - docs/evidence/TASK-0128/review-r1.md
  - docs/evidence/TASK-0128/review-r2-timeout.md
  - docs/evidence/TASK-0129/evidence-pack.json
  - docs/evidence/TASK-0129/review-r1.md
  - docs/evidence/TASK-0130/evidence-pack.json
  - docs/evidence/TASK-0130/review-r1.md
  - docs/handoffs/TASK-0107.json
  - docs/handoffs/TASK-0127.json
  - docs/handoffs/TASK-0128.json
  - docs/handoffs/TASK-0129.json
  - docs/handoffs/TASK-0130.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0107-model-protocol-correctness.md
  - docs/tasks/TASK-0127-technical-alpha-capability-truth.md
  - docs/tasks/TASK-0128-anthropic-tool-use-protocol-consistency.md
  - docs/tasks/TASK-0129-anthropic-tool-use-protocol-replacement.md
  - docs/tasks/TASK-0130-anthropic-tool-use-protocol-replacement.md
  - docs/tasks/context/TASK-0107.context-lock.yaml
  - docs/tasks/context/TASK-0127.context-lock.yaml
  - docs/tasks/context/TASK-0128.context-lock.yaml
  - docs/tasks/context/TASK-0129.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
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
  - docs/tasks/TASK-0131-anthropic-nonstream-duplicate-tool-use-test.md
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0131/**
  - docs/handoffs/TASK-0131.json
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
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
  - docs/tasks/TASK-0128-*
  - docs/tasks/TASK-0129-*
  - docs/tasks/TASK-0130-*
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
  - docs/tasks/context/TASK-0128.context-lock.yaml
  - docs/tasks/context/TASK-0129.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
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
  - docs/evidence/TASK-0128/**
  - docs/evidence/TASK-0129/**
  - docs/evidence/TASK-0130/**
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
  - docs/handoffs/TASK-0128.json
  - docs/handoffs/TASK-0129.json
  - docs/handoffs/TASK-0130.json
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
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/test/**
  - service/tests/model-protocol-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
  - service/tests/generation-contract-tests/**
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesMaxTokensContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesRawBudgetContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
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
  - docs/evidence/TASK-0107/review-r2.md
  - docs/tasks/TASK-0128-anthropic-tool-use-protocol-consistency.md
  - docs/evidence/TASK-0128/evidence-pack.json
  - docs/evidence/TASK-0128/review-r1.md
  - docs/evidence/TASK-0128/review-r2-timeout.md
  - docs/handoffs/TASK-0128.json
  - docs/tasks/TASK-0129-anthropic-tool-use-protocol-replacement.md
  - docs/tasks/context/TASK-0129.context-lock.yaml
  - docs/evidence/TASK-0129/evidence-pack.json
  - docs/evidence/TASK-0129/review-r1.md
  - docs/handoffs/TASK-0129.json
  - docs/tasks/TASK-0130-anthropic-tool-use-protocol-replacement.md
  - docs/tasks/context/TASK-0130.context-lock.yaml
  - docs/evidence/TASK-0130/evidence-pack.json
  - docs/evidence/TASK-0130/review-r1.md
  - docs/handoffs/TASK-0130.json
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
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确恢复当前长线 goal，要求 Codex 在不启用 fast、不逐项询问的前提下继续全部审计修复；
      TASK-0130 已 ACCEPTED、推送并远端 0/0，其 R1 P3-01、Handoff 与 project-state 唯一 nextAction
      精确指向本补测任务。
  - scope: anthropic-tool-use-protocol-replacement
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 长线授权要求 P2/P3 均修复或正式限期接受。TASK-0130 R1 确认非流第二个 tool_use 的生产
      分支已正确 fail-closed，但缺少直接 contract test；本卡只补该单一测试，不改变生产协议语义。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0130 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0131
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests -am -Dtest=AnthropicMessagesFailureContractTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡不在 Backlog 中，因此不写 `planningBacklog` 或 `planningContractHash`。本卡只关闭
> TASK-0130 R1 P3-01 的直接测试覆盖缺口，不扩展 Anthropic 生产协议实现。

## 背景与用户可观察目标

TASK-0130 已在有效候选上证明 Anthropic tool name/index 协议修复正确并 ACCEPTED。独立 R1 发现唯一 P3：
非流 structured 响应在同一 `content` 数组出现第二个 `tool_use` 时，Codec 已拒绝，但 contract tests
没有直接构造该场景。用户可观察目标是把该 fail-closed 行为固定为回归合同：唯一 MalformedResponse，
且不泄漏 OutputDelta、Usage 或 EOS。

## 范围内

- 只修改 `AnthropicMessagesFailureContractTest`。
- 直接构造含两个合法命名 `tool_use` block 的非流 JSON 响应。
- 使用 structured non-stream 请求，断言唯一 MalformedResponse、无 OutputDelta/Usage/EOS。
- 完成独立 Reviewer、冻结候选正式门禁与终态闭环。

## 明确范围外

- 不改 Codec、Session、Adapter、Config、endpoint、credential、model/max_tokens 或任何生产代码。
- 不改 stream 语义、name/index 规则、body/event/output 上限、timeout/backpressure/cancel。
- 不改 provider-neutral contract、OpenAI、routing/registry/quota、数据库、OpenAPI、frontend、CI/Harness。
- 不改 TASK-0128 至 TASK-0130 或任何其他历史 Card/Context/Evidence/Review/Handoff。

## 输入和前置条件

- Base `e4c90d168f02541771bf9c016fdd47f8ac5706aa` 是 TASK-0130 ACCEPTED 单父终态，已 push、fetch、
  `HEAD...origin/main=0/0` 且 post-terminal Doctor PASS。
- Context Lock 固定 77 个治理、历史、协议、实现与测试输入。
- 不调用真实 Anthropic；测试只使用 loopback synthetic server。

## API / 事件 / 数据契约

不改变任何 API 或事件类型。重复非流 tool block 继续映射为唯一
`AttemptFailed(MalformedResponse)`，并且不产生 OutputDelta、UsageReported 或 AttemptEos。

## 权限、RLS 和数据处理要求

不触碰数据库/RLS。synthetic provider body 不含真实凭据、联系人、用户或模型数据。

## 状态机和失败行为

- 第一个合法 matching-name tool_use 只保存在 Codec 局部解析状态。
- 第二个 tool_use 在 Message 构造、Session output validation 与成功完成前抛出协议错误。
- 测试必须证明失败终态唯一且前面没有公开输出事件。

## 模型、Prompt、记忆和安全边界

不改 Prompt、Memory、schema 内容、provider 配置或网络边界；只固定离线非流解析失败合同。

## 验收标准

1. 新测试直接构造同一非流 `content` 数组中的两个 `tool_use` block，两个 name 均匹配请求 schemaName。
2. structured non-stream session 结果恰好一个 AttemptFailed(MalformedResponse)。
3. 结果不包含 OutputDelta、UsageReported 或 AttemptEos，且请求只发送一次。
4. Base 后生产代码、Support/Success tests、TASK-0128 至 TASK-0130 历史制品和所有 forbidden paths 零 diff。
5. 独立 Reviewer 的 P0/P1/P2=0；任何真实缺陷最多一个 fix batch 和 R2，禁止 R3。
6. frozen Precheck、targeted Failure contract test、root JDK-25 verify 与唯一无参数 `git diff --check`
   在同一 clean candidate 按顺序各执行一次并 PASS。
7. terminal closure、push/fetch、HEAD==origin/main、0/0、clean 和 post-terminal Doctor 全部 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前不运行正式门禁；TASK-0130 的
Reviewer 和命令结果不得复用。

## 回滚或前向修复

- 不回滚或改写 TASK-0130；当前 Base 是唯一前向起点。
- 若测试暴露生产行为与已审查分支不一致，需要生产改动时停止并以新永久任务授权，不在本测试卡扩权。
- 终态后缺陷使用新永久 Task ID，不 amend/reset/rebase/squash。

## 停止条件

- 需要修改 Failure contract test 之外的业务/测试路径，或触碰任一 forbidden path。
- Reviewer 15 分钟内无终态、R2 后仍有 P0/P1/P2、需要第二 fix batch/R3。
- 任一 formal/pre-closure/push/remote 复核非 PASS，或达到 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0131/` 与 `docs/handoffs/TASK-0131.json`，绑定候选 Commit/Tree、Reviewer、
精确命令、local/remote 渠道与 timing；终态原子更新 Card/Project State/Ledger/Evidence/Handoff，以
`[skip ci]` 单父提交推送并复核远端。
