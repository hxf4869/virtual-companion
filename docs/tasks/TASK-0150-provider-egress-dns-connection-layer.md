# TASK-0150：Provider DNS/连接层威胁边界（P3 DNS 重绑定防护纵深）

```yaml
taskId: TASK-0150
state: ACCEPTED
terminalStateReason: >-
  Provider DNS/连接层威胁边界完成并验证：EgressDnsGuard（modelruntime/port，C3 protected）
  连接层解析结果类别校验（IPv4 0/8、10/8、100.64/10 CGNAT/metadata、127/8、169.254/16、
  172.16/12、192.168/16、224/4+；IPv6 ::1、fe80::/10、fc00::/7、::、::ffff: 内嵌阻断 IPv4），
  任一阻断地址失败关闭，127.0.0.1 字面放行，空解析/解析失败 fail-closed，错误消息不泄露；
  接入 OpenAiChatCompletionsSession/AnthropicMessagesSession 发送路径（sendAsync 前），
  normalizeFailure 新增 IAE→MalformedResponse 分支。R1 FAIL（1 P1 证据缺口）→ 一个允许 fix
  batch（Session public final + public guard 注入构造 + 两个 BoundaryContractTest
  rejectingEgressGuardNeverOpensAConnection CountingHttpClient 零调用断言 + CGNAT/IPv4-mapped
  边界测试 + 删除误加 import）→ R2 PASS（无新 P0/P1）。唯一 Precheck 7/7 PASS（doctor 705068
  checks）、唯一根级 Maven verify BUILD SUCCESS（15 模块）、唯一 git diff --check PASS 在候选
  48a9179/720fa7c；remote exact-SHA 如实非 PASS（dispatchCount=0），本卡只声明 READY 冻结的
  LOCAL_EXACT_TREE_FALLBACK。
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
baseCommit: 74a80b92c61eb3a3110a9ea55622f4cde1612a6f
contextFingerprint: 277a6674a40869ef5fb3db71f87856cc742653e66b1e5379479ad2822486df20
authorizationCommit: 8e2cbfdca72a5efcbe5de0df13d2be4596908a9c
contextLock: docs/tasks/context/TASK-0150.context-lock.yaml
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
  surfaceId: TASK_0150_PROVIDER_EGRESS_DNS_CONNECTION_LAYER
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0108-provider-egress-security.md
  - docs/tasks/context/TASK-0108.context-lock.yaml
  - docs/evidence/TASK-0108/evidence-pack.json
  - docs/evidence/TASK-0108/review-r1.md
  - docs/handoffs/TASK-0108.json
  - docs/tasks/TASK-0132-provider-egress-hostname-case-normalization.md
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - docs/evidence/TASK-0132/evidence-pack.json
  - docs/evidence/TASK-0132/pre-closure-request.json
  - docs/evidence/TASK-0132/review-r1.md
  - docs/handoffs/TASK-0132.json
  - docs/evidence/TASK-0149/evidence-pack.json
  - docs/handoffs/TASK-0149.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/contracts/model-protocol-contract.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicy.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicyTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - pom.xml
  - service/modules/modelruntime/pom.xml
  - service/adapters/model-openai/pom.xml
  - service/adapters/model-anthropic/pom.xml
  - service/tests/openai-chat-completions-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/pom.xml
writeAllowlist:
  - docs/tasks/TASK-0150-provider-egress-dns-connection-layer.md
  - docs/tasks/context/TASK-0150.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0150/**
  - docs/handoffs/TASK-0150.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/EgressDnsGuard.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/EgressDnsGuardTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/TASK-0141-*
  - docs/tasks/TASK-0142-*
  - docs/tasks/TASK-0143-*
  - docs/tasks/TASK-0144-*
  - docs/tasks/TASK-0145-*
  - docs/tasks/TASK-0146-*
  - docs/tasks/TASK-0147-*
  - docs/tasks/TASK-0148-*
  - docs/tasks/TASK-0149-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - docs/tasks/context/TASK-0145.context-lock.yaml
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - docs/tasks/context/TASK-0148.context-lock.yaml
  - docs/tasks/context/TASK-0149.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/evidence/TASK-0142/**
  - docs/evidence/TASK-0143/**
  - docs/evidence/TASK-0144/**
  - docs/evidence/TASK-0145/**
  - docs/evidence/TASK-0146/**
  - docs/evidence/TASK-0147/**
  - docs/evidence/TASK-0148/**
  - docs/evidence/TASK-0149/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/handoffs/TASK-0142.json
  - docs/handoffs/TASK-0143.json
  - docs/handoffs/TASK-0144.json
  - docs/handoffs/TASK-0145.json
  - docs/handoffs/TASK-0146.json
  - docs/handoffs/TASK-0147.json
  - docs/handoffs/TASK-0148.json
  - docs/handoffs/TASK-0149.json
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicy.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicyTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/tests/model-protocol-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - "**/db/migration/**"
  - "service/**/safety/**"
  - "service/**/memory/**"
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0108/evidence-pack.json
  - docs/evidence/TASK-0132/evidence-pack.json
  - docs/handoffs/TASK-0108.json
  - docs/handoffs/TASK-0132.json
requiredInvariants:
  - INV-AUTH-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-09/08-10 长线授权按 docs/evidence/TASK-0109/zcode-remediation-handoff.md 串行
      处理剩余审计项；2026-08-11 交接 §7 明确 Provider DNS/连接层威胁边界为剩余唯一"独立可晋级"
      调查项（无需 Owner 决策），建议下一张卡。TASK-0108 Handoff knownRisks 明示"allowlist 内
      hostname 的 DNS 重绑定边界（纯词法校验不解析 DNS，HttpClient 侧解析，后续 egress/DNS 层
      策略卡承接）"。本卡范围 = 连接层解析结果校验（DNS 重绑定防护纵深）：EgressDnsGuard 校验
      host 解析的全部 IP 地址类别，任一阻断地址即失败关闭拒绝连接，127.0.0.1 字面 loopback 放行，
      不改变 ProviderEgressPolicy 既有词法语义；TLS hostname verification 为第一道防线并保持默认。
      本卡无 Owner gate 数值（阈值沿用 TASK-0108 已批准的地址类别集合）；新增
      service/**/modelruntime/**/port/**（protected glob C3 → model-routing-change + 独立
      Reviewer）。P2-27/P2-25/DB Owner gates 决策请求已提交且与卡无依赖；工程细节按长线授权由
      实施者决定并如实记录；禁止历史改写和伪造 PASS。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用任何跨卡 Reviewer
      或命令 PASS。
independentReview: required
reviewers:
  - id: task0150_r1
    kind: independent-review-gate
    verdict: FAIL
    reviewedCommit: 633090e
    candidateTree: 5a50f6209c27d5213d72671c75cc2defa8cfd9ed
    evidencePath: docs/evidence/TASK-0150/review-r1.md
    reason: 1 blocking P1 (acceptance criterion 2 lacked test evidence; no Session injection seam). Static control-flow confirmed property holds; evidence/scope gap.
  - id: task0150_r2
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 48a9179
    candidateTree: 720fa7c101baa32890d8c1c451149b0682b87be6
    evidencePath: docs/evidence/TASK-0150/review-r2.md
    reason: R1 P1 closed; R1 P3 closed; no new P0/P1; delta scope compliant; production path semantics zero drift.
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0150
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。Provider DNS/连接层
> 威胁边界是 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` 与 2026-08-11 交接 §7
> 登记的独立调查项（TASK-0108 Handoff P3 残余：allowlist 内 hostname 的 DNS 重绑定边界）。

## 背景与用户可观察目标

2026-08-11 调查（当前 HEAD 74a80b92 复现）确认：

- `ProviderEgressPolicy`（TASK-0108/0132 ACCEPTED）只做**纯词法**校验：host 字符串必须命中
  allowlist（api.openai.com / api.anthropic.com）或 127.0.0.1 loopback、https + 443、字面 IPv4
  阻断私网/link-local/metadata/CGNAT 等类别、IPv6 字面拒绝；**明确不解析 DNS、不校验连接层实际
  解析结果**（TASK-0108 Handoff knownRisks 记录此设计边界，指出 HttpClient 侧解析为后续
  egress/DNS 策略卡承接点）。
- 连接层现状：`OpenAiChatCompletionsSession`/`AnthropicMessagesSession` 使用默认
  `HttpClient.newBuilder()`（followRedirects=NEVER、HTTP_1_1），经 JVM 系统 resolver 解析 host，
  无连接层 IP 类别校验。TLS hostname verification（Java HttpClient 默认开启）是第一道防线：内网
  服务器无法出示 api.openai.com/api.anthropic.com 的有效证书，数据不会泄露；但 **TLS 握手前的
  TCP 连接仍会到达解析出的任意地址**——allowlist 内 hostname 若遭 DNS 重绑定/污染指向私网或
  metadata 地址，会产生内网端口探测与时序侧信道。
- service 中 DNS 解析使用面仅两个 adapter 的 HttpClient（grep 无其他 InetAddress 使用）。

用户可观察结果：即使 allowlist host 的 DNS 被重绑定到阻断类别地址（私网/loopback/link-local/
metadata/CGNAT/组播/保留），出站路径在发起连接前失败关闭，不发 TCP 连接；127.0.0.1 loopback
离线契约测试行为不变；合法公网解析正常外发。

## 范围内

- 新增 `EgressDnsGuard`（`service/modules/modelruntime/.../port/`，protected glob C3）：
  - `public static EgressDnsGuard defaults()`（严格默认实例）与
    `public void requireAllowedResolution(String host, InetAddress[] resolved)`；
  - 类别校验（与 ProviderEgressPolicy 的阻断集合一致）：IPv4 0/8 any-local、10/8 私网、
    100.64/10 CGNAT/metadata、127/8 loopback、169.254/16 link-local/metadata、172.16/12 私网、
    192.168/16 私网、224/4+ 组播/保留/广播；IPv6 ::1 loopback、fe80::/10 link-local、
    fc00::/7 ULA、::ffff: IPv4-mapped 内嵌类别；**任一解析地址属于阻断类别 → 拒绝**
    （fail-closed，`IllegalArgumentException`，错误消息不含 host/地址细节）；
  - 空地址数组/解析失败（UnknownHostException 语义）→ fail-closed 拒绝，不猜测不放行；
  - 127.0.0.1 字面 loopback host：不解析直接放行（保离线契约测试）；
  - 校验为纯函数（地址数组注入），不持有 DNS 解析依赖，可确定性单测。
- Session 接线：`OpenAiChatCompletionsSession`/`AnthropicMessagesSession` 在发送路径
  （sendAsync 之前）调用 guard（默认 `defaults()`；构造可选注入 guard 便于测试）——对
  `httpRequest.uri()` 的 host 解析全部地址并校验，拒绝时不调用 sendAsync、不建立连接；
  loopback 字面（127.0.0.1）跳过解析直接放行。HttpClient 构造方式不变（仍注入式、
  followRedirects=NEVER），不改 adapter/config/codec。
- 测试：
  - `EgressDnsGuardTest`：IPv4/IPv6 类别矩阵（每类阻断地址 + 公网放行）、多地址任一阻断拒绝、
    空数组/解析失败 fail-closed、127.0.0.1 放行、错误消息不泄露。
  - 契约测试扩展：guard 拒绝解析（注入拒绝 guard）时 CountingHttpClient 零调用（不发起连接）；
    合法 host 正常发送；既有 OpenAI/Anthropic Boundary 契约测试（127.0.0.1 loopback mock）
    100% 通过（无 skip）。
  - 迭代定向测试（-pl modelruntime + model-openai + model-anthropic + 两个 contract-tests，-am；
    modelruntime 变更含 service/tests/model-protocol-contract-tests 编译面）。
- 根级 Maven verify（docker JDK 25 + vc-maven-cache）真实 BUILD SUCCESS；唯一 Precheck 7/7 PASS；
  唯一无参数 `git diff --check` PASS；C3 独立 Reviewer R1 PASS（阻塞 P0/P1 为零）；Evidence/Handoff、
  pre-closure、单父 `[skip ci]` 终态提交、push、fetch `0/0` clean、post-terminal Doctor。
- Handoff 登记：TASK-0108 knownRisks 的 DNS 重绑定边界由本卡关闭；TLS hostname verification
  作为第一道防线的事实记录。

## 明确范围外

- 不改 `ProviderEgressPolicy` 既有词法语义与测试（只读）；不引入 DNS 解析服务/依赖；不改
  HttpClient 构造、adapter/config/codec 与 ModelProtocolAdapter/ModelProtocolSession 接口。
- 不做 region/contract 校验（ExecutionAuthorizationGuard/授权快照层面，TASK-0107/0144/0146
  已覆盖）；不处理 provider-attempt 的 DB schema 强约束（条件风险 6，`**/db/migration/**` C4）。
- 不处理 P2-25/P2-27/数据库 Owner gates（P1-04/05、P1-11、P2-03、P2-13、P2-29）与
  RISK-01..11；不触碰 specs/**、frontend/**、infra/**、.harness/**、scripts/**、skills/**。

## 输入和前置条件

Context Lock 输入全部使用 Base Commit `74a80b92` 中的仓库相对路径；算法
`SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1`；fingerprint `277a6674…`（62 输入）。本卡
context lock 的 provenance 条目带 `provenanceOnly: true`（Owner 授权 hash
`cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`）。Base 为 TASK-0149
单父 ACCEPTED terminal，已 push、`HEAD...origin/main=0/0`、工作树 clean、post-terminal Doctor
PASS（846840 checks）。

## API / 事件 / 数据契约

- `EgressDnsGuard`（新，public final，modelruntime/port 包）：`defaults()` 与
  `requireAllowedResolution(String, InetAddress[])`；拒绝抛 `IllegalArgumentException`，消息不
  泄露 host/地址/凭据。
- `OpenAiChatCompletionsSession`/`AnthropicMessagesSession` 构造：保留既有构造签名，新增可选
  guard 参数构造（默认 `EgressDnsGuard.defaults()`）；对外 public API 不变。
- 不改变 `ModelProtocolEvent`/`ModelPayload`/binding/授权快照结构与任何事件语义；
  INV-AUTH-001 执行快照匹配逻辑不改变。

## 权限、RLS 和数据处理要求

- 无数据库变更、无迁移；无凭据读取变化（凭据仍只经受控通道，不进仓库/日志/业务类型）。
- 本卡修改路径：`service/modules/modelruntime/**/port/EgressDnsGuard*`（C3 protected →
  model-routing-change + 独立 Reviewer）+ 两个 adapter 的 Session.java + 两个 contract-tests
  的 BoundaryContractTest，全部在 writeAllowlist；其余 modelruntime 子包与 adapter 文件
  forbiddenPaths 只读。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。DRAFT 提交后先跑 DRAFT
检查点 Doctor，再请求 READY 授权；READY Doctor 真实 PASS 后进入实现；READY 后不得修改任务卡
正文或不可变元数据（含 independentReview）。任何正式门禁非 PASS 或候选身份变化：立即停止
promotion，如实 REJECTED（保留失败历史与 Evidence），按失败根因创建新卡从 DRAFT 起修正范围
（若 REJECTED 根因是卡缺受保护路径 Skill 导致 closure 死锁，向 Owner 请求 reset 摘除未推送链
授权，参考 TASK-0145→0146）。

## 验收标准

1. `EgressDnsGuard` 单元测试全绿：每类阻断地址（IPv4 0/8、10/8、100.64/10、127/8、
   169.254/16、172.16/12、192.168/16、224/4+；IPv6 ::1、fe80::/10、fc00::/7、
   ::ffff: 内嵌阻断）拒绝；公网地址放行；多地址任一阻断拒绝；空数组/解析失败 fail-closed；
   127.0.0.1 字面放行；错误消息不含 host/地址细节。
2. Session 接线：guard 拒绝时 sendAsync 零调用（CountingHttpClient 计数 0，不建立连接）；
   合法 host 正常发送；loopback 字面契约正例全部通过。
3. 既有 OpenAI/Anthropic Boundary 契约测试 100% 通过（无 skip）；定向测试 6 模块 BUILD
   SUCCESS（含 model-protocol-contract-tests 编译面）。
4. 根级 Maven verify（docker JDK 25 + vc-maven-cache）真实 BUILD SUCCESS（只运行一次并记录
   真实退出码与耗时）。
5. 唯一正式 Precheck 7/7 全命令 PASS（tee 保存输出取 sha256 入 Evidence）；唯一无参数
   `git diff --check` PASS（输出空，sha256 e3b0c44…）。
6. C3 独立 Reviewer R1 PASS（阻塞 P0/P1 为零；review-r1.md 只读审阅，全部门禁后随终态提交
   写入）；pre-closure PASS；单父 `[skip ci]` 终态提交；push 后 fetch 断言 `HEAD==origin/main`、
   tree 一致、`0/0`、clean；remote exact-SHA 如实非 PASS（dispatchCount=0）；
   LOCAL_EXACT_TREE_FALLBACK 按卡冻结声明；post-terminal Doctor 在最新终态通过，历史制品
   byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。Canonical Precheck 只运行一次；根级 Maven verify
（docker JDK 25，vc-maven-cache）是任务特有后端门禁（precheck 不含 Maven），只运行一次并记录
真实 BUILD SUCCESS/FAILURE；`git diff --check` 只运行一次。定向模块测试在迭代中运行（不冻结
为 Evidence 命令）。所有命令记录真实状态、退出码、验证 Commit/Tree、容器/解释器与环境身份。
远程 CI 因 Actions 配额耗尽（includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
stopUsageEnabled=true、dispatchCount=0）如实记录非 PASS（passClaimed=false），本地等价验证为
READY 冻结的备用通道。

## 回滚或前向修复

- 修复采用最小实现与测试变更；若根级 verify 失败，先确认失败集合是否超出本卡范围，超范围即
  停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新
  P0/P1，禁止第三轮。
- 无持久数据变更（无迁移）；回滚 = 修正文件后重跑定向测试、根级 verify 与 precheck。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment。

## 停止条件

- Context、批准、Skill、allowlist、候选身份、Reviewer、canonical、CI 或远端验证失败时停止晋级
  （fail closed）。
- 发现需要修改 writeAllowlist 外路径（如 ProviderEgressPolicy 语义、db migration、其他 adapter
  文件）时停止并询问 Owner。
- 达到 hardFuseWallMinutes 90 时停止实现与复核，仅允许 closure-only 收尾（Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0）。
- P2-27/P2-25/DB Owner gates 与本卡无依赖；如 Owner 要求本卡承担，先停下重建范围。

## Evidence Pack

输出到 `docs/evidence/TASK-0150/`（evidence-pack.json、pre-closure-request.json、review-r1.md），
并生成 `docs/handoffs/TASK-0150.json`。
