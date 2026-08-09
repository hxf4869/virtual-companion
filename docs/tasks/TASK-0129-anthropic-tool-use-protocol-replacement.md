# TASK-0129：Anthropic Tool-Use 协议一致性 Replacement

```yaml
taskId: TASK-0129
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
baseCommit: 603402304b878d939c8381721ff9bc5082561780
authorizationCommit: bce01149fa4baabe90e8f2112a103e1f3936bf46
contextFingerprint: 31abce12955f5be0b2f11e0f18170468c2a236f48e546b5879dc6270a76b15cd
contextLock: docs/tasks/context/TASK-0129.context-lock.yaml
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
  surfaceId: TASK_0129_ANTHROPIC_TOOL_USE_PROTOCOL_REPLACEMENT
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 55
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
  - docs/handoffs/TASK-0107.json
  - docs/handoffs/TASK-0127.json
  - docs/handoffs/TASK-0128.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0107-model-protocol-correctness.md
  - docs/tasks/TASK-0127-technical-alpha-capability-truth.md
  - docs/tasks/TASK-0128-anthropic-tool-use-protocol-consistency.md
  - docs/tasks/context/TASK-0107.context-lock.yaml
  - docs/tasks/context/TASK-0127.context-lock.yaml
  - docs/tasks/context/TASK-0128.context-lock.yaml
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
  - docs/tasks/TASK-0129-anthropic-tool-use-protocol-replacement.md
  - docs/tasks/context/TASK-0129.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0129/**
  - docs/handoffs/TASK-0129.json
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
  - docs/tasks/TASK-0128-*
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
  - docs/evidence/TASK-0107/review-r2.md
  - docs/tasks/TASK-0128-anthropic-tool-use-protocol-consistency.md
  - docs/evidence/TASK-0128/evidence-pack.json
  - docs/evidence/TASK-0128/review-r1.md
  - docs/evidence/TASK-0128/review-r2-timeout.md
  - docs/handoffs/TASK-0128.json
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
      TASK-0128 已以 REJECTED 推送且远端 0/0，其 Handoff 与 project-state 唯一 nextAction 指向本 replacement。
  - scope: anthropic-tool-use-protocol-replacement
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 长线授权要求失败任务保留事实并以前向永久 replacement 继续。TASK-0128 的实现候选、R1 P3
      修复与 raw command 结果保留在 Base，但因 Reviewer 15 分钟硬上限 TIMEOUT 不可 ACCEPTED；本卡只在
      全新授权与预算下重新审查和验证同一协议修复，禁止继承旧 PASS。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0128 的本机结果。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0129
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests -am -Dtest=AnthropicMessagesSuccessContractTest,AnthropicMessagesFailureContractTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡不在 Backlog 中，因此不写 `planningBacklog` 或 `planningContractHash`。本卡是 TASK-0128 的永久
> replacement，只能前向采用 Base 已包含的实现并重新取得独立 Review/validation 证据，不改写旧任务。

## 背景与用户可观察目标

TASK-0128 已实现 Anthropic structured tool name 与 stream block index 一致性，并有完整 contract tests；
但它的 R2 在 15 分钟 Reviewer 硬上限到达时没有终态输出，随后出现的 late PASS 不可倒推为有效 PASS。
TASK-0128 因此正确 REJECTED。用户可观察目标保持不变：合法 Anthropic text/structured 回包继续成功；错误
tool name、跨 block delta/stop、第二 structured block 均 fail closed，且该行为这次由期限内独立 Reviewer
和同一 clean candidate 的完整正式门禁证明。

## 范围内

- 只读核验 Base 中 TASK-0128 已提交的两个 adapter 文件和三个 contract-test 文件。
- 冻结新 candidate Commit/Tree，取得新的期限内 C3 independent Reviewer 终态。
- 只有 Reviewer 发现真实范围内缺陷时，才允许在五个精确业务/测试路径内使用唯一 fix batch。
- Reviewer PASS 后按本卡精确顺序重新执行 Precheck、targeted reactor、root verify 和唯一 diff check。
- 生成全新的 TASK-0129 Evidence/Handoff、terminal commit、push/fetch 与远端 0/0 证据。

## 明确范围外

- 不继承 TASK-0128 Reviewer、formal command 或 local exact-tree 的 PASS；不改 TASK-0128 历史产物。
- 不改 provider endpoint、credential、model/max_tokens、body/event/output 上限、timeout/backpressure/cancel。
- 不改 provider-neutral contract、OpenAI、routing/registry/quota、数据库、OpenAPI/Catalog、frontend、CI/Harness。
- 不顺带处理 TASK-0108 egress hostname/DNS、Auth、DB 或其他审计项。

## 输入和前置条件

- Base `603402304b878d939c8381721ff9bc5082561780` 是 TASK-0128 REJECTED 单父终态，已 push、fetch、
  `HEAD...origin/main=0/0` 且 post-terminal Doctor PASS。
- Base 保留 TASK-0128 的实现与测试提交，不撤销、不复制 PASS、不重用时间锚或 Reviewer output。
- Context Lock 固定 67 个治理、历史、协议、实现与测试输入。
- 不调用真实 Anthropic；全部测试使用 loopback synthetic server。

## API / 事件 / 数据契约

不改变公开 API 或 provider-neutral event 类型。合法响应保持既有 `OutputDelta -> UsageReported -> AttemptEos`；
协议违例保持唯一 `AttemptFailed(MalformedResponse)`。本 replacement 不以文档声明替代实际代码/测试复核。

## 权限、RLS 和数据处理要求

不触碰数据库/RLS。tool name 只与已批准请求 schemaName 比较；错误 provider 内容不写日志、不回显、不进入
下游 finalization。

## 状态机和失败行为

- structured 非流恰有一个 matching-name tool_use，混合 text prelude 不成为输出。
- structured 流为 matching-name start -> 同 index delta* -> 同 index stop，第二 tool block 拒绝。
- text stream delta/stop 必须匹配 open index；先前已发 text 是历史事实，但错误 stop 终态为 MalformedResponse，
  无 Usage/EOS。
- Reviewer 未在 15 分钟内返回终态、任何正式命令非 PASS 或 candidate identity 改变时再次 REJECTED。

## 模型、Prompt、记忆和安全边界

不改 Prompt、Memory、schema 内容或 provider 配置；只重新证明 Base 中 provider 回包边界。无真实网络、凭据、
模型输出或付费能力。

## 验收标准

1. Reviewer 从 Base 代码独立复核完整 name/index/failure timing matrix，期限内给出结构化终态；P0/P1/P2=0。
2. 非流 wrong/missing/blank name、混合 text+tool_use、流式 wrong name/index/第二 block 与合法多 text block 均有直接测试。
3. start/delta/stop index 均为 non-negative integer，并与 open block 一致；structured 部分 JSON 失败前不泄漏。
4. TASK-0128 Card/Context/Evidence/Reviews/Handoff 与所有历史任务零 diff；provider 配置、limits、OpenAI、DB/specs 零 diff。
5. 若无需修复，Base 后业务/测试路径零 diff；若有真实 finding，只允许唯一 fix batch 并进入 R2，禁止 R3。
6. frozen Precheck、targeted reactor、root JDK-25 verify 与唯一无参数 `git diff --check` 在同一 clean candidate 按顺序各执行一次并 PASS。
7. Evidence/Handoff 如实区分本卡新证据与 TASK-0128 的 late/non-promotable 结果；remote 非 PASS 不冒充 local PASS。
8. terminal closure、push/fetch、HEAD==origin/main、0/0、clean 和 post-terminal Doctor 全部 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前不运行正式门禁；过去任务的任何 command
结果均不复用。长命令使用同一 PTY/session 等待真实退出码并保存输出哈希。

## 回滚或前向修复

- 不回滚或改写 TASK-0128；当前 Base 是唯一前向起点。
- Reviewer 无 finding 时不制造代码 diff；若有范围内 P2/P3，最多一个 fix batch 和 R2。
- 终态后缺陷使用新永久 Task ID，不 amend/reset/rebase/squash。

## 停止条件

- Reviewer 15 分钟内无终态、R2 后仍有 P0/P1/P2、需要第二 fix batch/R3。
- 必须修改 provider-neutral contract、config/limits/network、数据库、spec、Harness 或其他 forbidden path。
- 任一 formal/pre-closure/push/remote 复核非 PASS，或达到 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0129/` 与 `docs/handoffs/TASK-0129.json`，绑定新的候选 Commit/Tree、Reviewer、
精确命令、local/remote 渠道与 timing；终态原子更新 Card/Project State/Ledger/Evidence/Handoff，以
`[skip ci]` 单父提交推送并复核远端。
