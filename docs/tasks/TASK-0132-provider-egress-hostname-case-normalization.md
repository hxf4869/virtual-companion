# TASK-0132：Provider Egress Hostname 大小写规范化

```yaml
taskId: TASK-0132
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
baseCommit: f5e0e5fb9ad73eea2dff5c444bd27730c62d640c
authorizationCommit: 79b4253f7857173177714da6d9cb5ac812394c86
contextFingerprint: c2bf05f6e57ec1dd9dc8e4d0e12fd35d239c1477bb5f3e9d76395d7ce871b5fe
contextLock: docs/tasks/context/TASK-0132.context-lock.yaml
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
  surfaceId: TASK_0132_PROVIDER_EGRESS_HOSTNAME_CASE_NORMALIZATION
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
  - docs/evidence/TASK-0108/evidence-pack.json
  - docs/evidence/TASK-0108/review-r1.md
  - docs/evidence/TASK-0131/evidence-pack.json
  - docs/evidence/TASK-0131/review-r1.md
  - docs/handoffs/TASK-0108.json
  - docs/handoffs/TASK-0131.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0108-provider-egress-security.md
  - docs/tasks/TASK-0131-anthropic-nonstream-duplicate-tool-use-test.md
  - docs/tasks/context/TASK-0108.context-lock.yaml
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicy.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicyTest.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0132-provider-egress-hostname-case-normalization.md
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0132/**
  - docs/handoffs/TASK-0132.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicy.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicyTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-0130-*
  - docs/tasks/TASK-0131-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-0130/**
  - docs/evidence/TASK-0131/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-0130.json
  - docs/handoffs/TASK-0131.json
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
  - service/adapters/**
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/**
  - service/tests/model-protocol-contract-tests/**
  - service/tests/generation-contract-tests/**
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
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - docs/tasks/TASK-0108-provider-egress-security.md
  - docs/evidence/TASK-0108/review-r1.md
  - docs/handoffs/TASK-0108.json
  - docs/tasks/TASK-0131-anthropic-nonstream-duplicate-tool-use-test.md
  - docs/evidence/TASK-0131/evidence-pack.json
  - docs/handoffs/TASK-0131.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicy.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicyTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
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
      Owner 恢复当前长线 goal，要求 Codex 不启用 fast 且不中断地继续全部审计修复；TASK-0131
      已 ACCEPTED、推送并远端 0/0，其 Handoff 与 project-state 的唯一 nextAction 精确指向本任务。
  - scope: provider-egress-hostname-case-normalization
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求按审计逐项修复。当前 HEAD 以 JDK 21 URI 复现 getHost 保留输入大小写，现有小写
      allowlist 会误拒合法供应商 hostname 变体；本卡只做 Locale.ROOT 词法规范化和三层回归测试。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用历史 Reviewer 或命令 PASS。
independentReview: required
reviewers:
  - id: task0132_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 79274b7196dbf5d82126b5055df8da9fcafea767
    evidencePath: docs/evidence/TASK-0132/review-r1.md
    reason: 'R1 完整复核 PASS：endpoint host 与 custom approvedHosts 均以 Locale.ROOT 规范化；策略层、OpenAI、Anthropic 的合法大小写变体与未获批 host 负例覆盖完整，scheme/port/IP/loopback/DNS 边界未扩大。Base 后业务 diff 精确为四个授权路径，候选 P0/P1/P2/P3=0。'
    candidateTree: 9d3316736da30a572ad6a83e8bd79340784d8500
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0132
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime,service/adapters/model-openai,service/adapters/model-anthropic,service/tests/openai-chat-completions-contract-tests,service/tests/anthropic-messages-contract-tests -am -Dtest=ProviderEgressPolicyTest,OpenAiChatCompletionsBoundaryContractTest,AnthropicMessagesBoundaryContractTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡不在 Backlog 中，因此不写 `planningBacklog` 或 `planningContractHash`。本卡只关闭
> TASK-0108 R1 P3-01，不把 DNS 解析/重绑定边界并入同一交付。

## 背景与用户可观察目标

TASK-0108 建立 Provider endpoint 词法 egress allowlist。其独立 R1 发现 `URI.getHost()` 保留输入大小写，
而当前集合使用小写精确匹配，因此 `https://API.OpenAI.com/...` 和 Anthropic 的混合大小写合法 URI
被误拒。当前 JDK 21 复核已重现该行为。目标是遵循 DNS hostname 大小写不敏感语义，同时保持未获批
host、地址类别、scheme 和 port 的 fail-closed 边界不变。

## 范围内

- 在 `ProviderEgressPolicy` 中以 `Locale.ROOT` 规范化 hostname 与自定义 approved host 集后比较。
- 策略单测增加 OpenAI uppercase、Anthropic mixed-case 与自定义 allowlist 大小写正例。
- OpenAI 与 Anthropic Boundary contract tests 各增加供应商大小写正例及未获批大小写负例。
- 完成独立 Reviewer、冻结候选正式门禁与终态闭环。

## 明确范围外

- 不解析 DNS、不开连接，不实现 DNS pinning、重绑定防护或 resolved-address 分类。
- 不改 endpoint path、scheme/port 规则、loopback 特例、IPv4/IPv6 分类、TLS 或 secret 处理。
- 不改 Config、Adapter、Session、Codec、模型、Prompt、Memory、数据库、OpenAPI、frontend、CI/Harness。
- 不改 TASK-0108、TASK-0131 或任何其他历史 Card/Context/Evidence/Review/Handoff。

## 输入和前置条件

- Base `f5e0e5fb9ad73eea2dff5c444bd27730c62d640c` 是 TASK-0131 ACCEPTED 单父终态，已 push、fetch、
  `HEAD...origin/main=0/0`、clean 且 post-terminal Doctor PASS。
- Context Lock 固定治理、原始 TASK-0108 finding、即时 Handoff、策略实现和三层测试输入。
- 本任务不调用任何真实 Provider 或 DNS 服务。

## API / 事件 / 数据契约

不改变公开 API、事件或数据格式。`ProviderEgressPolicy` 的 public 构造和 `requireAllowed(URI)` 签名保持；
仅使 hostname 与 approved host 比较符合大小写不敏感语义。

## 权限、RLS 和数据处理要求

不触碰数据库/RLS/用户数据。所有测试 URI 与凭据均为 synthetic 值，不产生外部网络请求。

## 状态机和失败行为

- 先保留 host/scheme/port/address-category 的现有拒绝顺序与消息边界。
- 仅在 host 与 allowlist 比较前使用 `Locale.ROOT` 小写规范化。
- 未获批 host 即使使用 uppercase/mixed-case 仍必须抛 `IllegalArgumentException`。

## 模型、Prompt、记忆和安全边界

不改模型路由、供应商绑定、Prompt、Memory 或授权快照。DNS 重绑定风险保持显式未关闭，下一张独立卡评估。

## 验收标准

1. 默认策略接受 OpenAI uppercase 和 Anthropic mixed-case hostname，仍只接受既有 path/scheme/port 规则。
2. 自定义 approved host 集与输入 hostname 均按 `Locale.ROOT` 规范化，不受 JVM 默认 locale 影响。
3. 策略层及两个 Config contract 层均证明合法大小写变体通过，未获批大小写 host 继续失败关闭。
4. Base 后仅四个授权生产/测试路径和本卡治理制品发生 diff；Config、Adapter、历史制品与 forbidden paths 零 diff。
5. 独立 Reviewer 的 P0/P1/P2=0；任何真实缺陷最多一个 fix batch 和 R2，禁止 R3。
6. frozen Precheck、targeted 三层测试、root JDK-25 verify 与唯一无参数 `git diff --check` 在同一 clean
   candidate 按顺序各执行一次并 PASS。
7. terminal closure、push/fetch、HEAD==origin/main、0/0、clean 和 post-terminal Doctor 全部 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前不运行正式门禁；历史 Reviewer 和命令
结果不得复用。

## 回滚或前向修复

- 当前 Base 是唯一前向起点，不重写 TASK-0108 或 TASK-0131 历史。
- 若需要 DNS 解析、连接层或 adapter/config 生产改动，停止并使用新的永久 Task ID 授权。
- 终态后缺陷使用新永久任务，不 amend/reset/rebase/squash。

## 停止条件

- 需要修改四个业务/测试路径之外的实现，或触碰任一 forbidden path。
- Reviewer 15 分钟内无终态、R2 后仍有 P0/P1/P2、需要第二 fix batch/R3。
- 任一 formal/pre-closure/push/remote 复核非 PASS，或达到 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0132/` 与 `docs/handoffs/TASK-0132.json`，绑定候选 Commit/Tree、Reviewer、
精确命令、local/remote 渠道与 timing；终态原子更新 Card/Project State/Ledger/Evidence/Handoff，使用
`[skip ci]` 单父提交推送并复核远端。
