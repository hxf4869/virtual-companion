# TASK-0118：Anthropic maxTokens 私有成本上限

```yaml
taskId: TASK-0118
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
baseCommit: f77198abd1514b1414b1999e48c3dc8fc4a6bb94
authorizationCommit: ""
contextFingerprint: a8cf6143b276fa1e747cb5b382efbf11078540d1c1c7ebecaaba8fdd6a4696c4
contextLock: docs/tasks/context/TASK-0118.context-lock.yaml
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
  surfaceId: TASK_0118_ANTHROPIC_MAX_TOKENS_CEILING
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
  - docs/evidence/TASK-0109/evidence-pack.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0113/evidence-pack.json
  - docs/evidence/TASK-0113/review-r1.md
  - docs/evidence/TASK-0114/evidence-pack.json
  - docs/evidence/TASK-0114/review-r1.md
  - docs/evidence/TASK-0117/evidence-pack.json
  - docs/evidence/TASK-0117/review-r1.md
  - docs/evidence/TASK-0117/review-r2.md
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0117.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0117.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/BoundedInputStreamTest.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/SseDecoderTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsCodec.java
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReader.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisionerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ModelProviderPropertiesBindingTest.java
  - service/modules/modelruntime/pom.xml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/AdapterFailure.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/SizeLimits.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/model-protocol-contract-tests/pom.xml
  - service/tests/model-protocol-contract-tests/src/test/java/com/virtualcompanion/modelprotocol/contract/ModelProtocolBoundaryContractTest.java
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0118-anthropic-max-tokens-ceiling.md
  - docs/tasks/context/TASK-0118.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0118/**
  - docs/handoffs/TASK-0118.json
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfigTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisionerTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesMaxTokensContractTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/tasks/TASK-0110-provider-response-early-limits.md
  - docs/tasks/TASK-0111-auth-input-hygiene.md
  - docs/tasks/TASK-0112-auth-input-hygiene.md
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/tasks/TASK-0115-streaming-utf8-accumulator.md
  - docs/tasks/TASK-0116-openai-stream-backpressure.md
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-0110.context-lock.yaml
  - docs/tasks/context/TASK-0111.context-lock.yaml
  - docs/tasks/context/TASK-0112.context-lock.yaml
  - docs/tasks/context/TASK-0113.context-lock.yaml
  - docs/tasks/context/TASK-0114.context-lock.yaml
  - docs/tasks/context/TASK-0115.context-lock.yaml
  - docs/tasks/context/TASK-0116.context-lock.yaml
  - docs/tasks/context/TASK-0117.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-0110/**
  - docs/evidence/TASK-0111/**
  - docs/evidence/TASK-0112/**
  - docs/evidence/TASK-0113/**
  - docs/evidence/TASK-0114/**
  - docs/evidence/TASK-0115/**
  - docs/evidence/TASK-0116/**
  - docs/evidence/TASK-0117/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-0110.json
  - docs/handoffs/TASK-0111.json
  - docs/handoffs/TASK-0112.json
  - docs/handoffs/TASK-0113.json
  - docs/handoffs/TASK-0114.json
  - docs/handoffs/TASK-0115.json
  - docs/handoffs/TASK-0116.json
  - docs/handoffs/TASK-0117.json
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
  - service/modules/**
  - service/platform/**
  - service/adapters/model-openai/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicCodecException.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/BoundedInputStream.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/ImmediateTerminalSession.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/SseDecoder.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/BoundedInputStreamTest.java
  - service/adapters/model-anthropic/src/test/java/com/virtualcompanion/modelanthropic/SseDecoderTest.java
  - service/apps/runtime/src/main/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ModelProviderPropertiesBindingTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReaderTest.java
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBackpressureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/model-protocol-contract-tests/**
  - service/tests/openai-chat-completions-contract-tests/**
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
  - docs/tasks/TASK-0109-model-request-size-limits.md
  - docs/evidence/TASK-0109/evidence-pack.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0109.json
  - docs/tasks/TASK-0113-provider-response-limits-revalidation.md
  - docs/evidence/TASK-0113/evidence-pack.json
  - docs/evidence/TASK-0113/review-r1.md
  - docs/handoffs/TASK-0113.json
  - docs/tasks/TASK-0114-anthropic-response-side-limits.md
  - docs/evidence/TASK-0114/evidence-pack.json
  - docs/evidence/TASK-0114/review-r1.md
  - docs/handoffs/TASK-0114.json
  - docs/tasks/TASK-0117-anthropic-stream-backpressure.md
  - docs/evidence/TASK-0117/evidence-pack.json
  - docs/evidence/TASK-0117/review-r1.md
  - docs/evidence/TASK-0117/review-r2.md
  - docs/handoffs/TASK-0117.json
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
      TASK-0117 Handoff 与 project-state 的唯一下一动作逐字指定创建 TASK-0118，为 Anthropic
      maxTokens 冻结私有上限；本卡不追溯改写历史任务。
  - scope: anthropic-max-tokens-private-ceiling
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 长线授权明确把其余工程数值、拆卡、实现与验证细节交由 Codex 按机器真源、现有模式和
      最小风险原则决定。本卡冻结独立 Anthropic 私有应用成本上限 8192：它与已接受 OpenAI 私有上限
      对齐但不复用其常量，不声称是所有 Anthropic 模型的能力上限，也不静默截断。Anthropic 官方
      Messages/Models 文档显示 max_tokens 是请求字段且模型输出能力不同；外部 provenance 为
      https://platform.claude.com/docs/en/api/messages/create、https://platform.claude.com/docs/en/api/models
      与 https://platform.claude.com/docs/en/about-claude/models/overview，访问日期 2026-08-09。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: codex-audit-fix-20260809
    evidence: >-
      Owner 要求长线不中断推进；TASK-0102/TASK-0108 已记录同一配额周期 includedMinutes=usedMinutes=2000、
      paidBudgetUsd=0、stopUsageEnabled=true、dispatchCount=0，TASK-0110 exact-SHA run 31286798584
      在无 runner、零 step 状态终止；TASK-0112 至 TASK-0117 已按同一 READY 冻结 fallback 合规
      ACCEPTED。本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实为非 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0118
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime,service/adapters/model-anthropic,service/tests/anthropic-messages-contract-tests,service/tests/model-protocol-contract-tests -am test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 已核对未占用。TASK-0117
> 已在当前 Base ACCEPTED 并把 TASK-0118 冻结为唯一下一动作。本卡从其终态提交重新冻结 Context，
> 以独立候选 Commit/Tree、Reviewer 和本地 exact-tree channel 关闭 Anthropic maxTokens 无私有上限风险。

## 背景与用户可观察目标

Anthropic runtime deployment 的 `maxTokens` 当前只要求正值，随后原样进入 Messages 请求。错误或恶意配置
可以把该值设为极大整数，在请求发出前没有应用级成本/资源上界；Provider 是否接受及实际模型能力又随模型
而异，不能把 Provider 的动态限制当成本地防线。

完成本卡后，启用的 Anthropic deployment 只接受 `1..8192`，超界配置在构造 Provider adapter 前失败；
request codec 在生成 JSON 前再次复核相同私有上限。合法边界按原值发送，非法值不静默截断且不会触发 HTTP。

## 范围内

- 在 package-private `AnthropicMessagesConfig` 冻结独立常量 `8192` 与单一校验入口；构造时只接受
  `1..8192`，对 0、负值、8193 和 `Integer.MAX_VALUE` 抛出确定性 `IllegalArgumentException`。
- `AnthropicMessagesCodec.encodeRequest` 在写入 JSON `max_tokens` 前复用同一校验，作为 config 之后的
  defense-in-depth；非法值必须在构造 request body/HTTP dispatch 前失败，不做 clamp、取模或替换默认值。
- 保持 `ApprovedModelProviderProvisioner` 生产调用链不变，以其现有构造 config 的位置证明启用 deployment
  的非法配置在 adapter 注册前 fail-fast；补充 runtime test 覆盖 8193/`Integer.MAX_VALUE`、未注册和无网络。
- 新增 config 单元测试与 Anthropic Messages contract test，覆盖 1、8192、8193、0、负值、
  `Integer.MAX_VALUE`、JSON 原值、成功回归和零 HTTP 外发。

## 明确范围外

- 不修改 TASK-0109 至 TASK-0117 的 Card、Context、Evidence、Review 或 Handoff，不重判历史结果。
- 不修改 `ModelProviderProperties`、`ApprovedModelProviderProvisioner` 生产代码、ModelProtocolRequest、
  SizeLimits、OpenAI 常量/codec、Provider allowlist、公开 API/OpenAPI/Catalog、数据库、前端或 CI。
- 8192 是本应用的 Anthropic 私有成本/资源上限，不是跨所有 Anthropic 模型的通用能力证明；不引入
  Models API 动态查询、按模型 capability map、Provider 元数据缓存或更低的模型特定上限。
- 不支持 `max_tokens=0` 的 cache-warmup 语义；本仓库既有正值不变量保持不变。连续 comment/empty-data
  frame 的连接级累计 raw byte budget 继续作为后续独立卡。

## 输入和前置条件

Base 是 TASK-0117 ACCEPTED 终态 `f77198abd1514b1414b1999e48c3dc8fc4a6bb94`，与 `origin/main`
0/0 且工作树干净。Context Lock 绑定该 Base 的机器真源、TASK-0109/0113/0114/0117 已接受边界证据、
Anthropic config/codec/runtime provisioning 调用链、OpenAI 已接受私有上限参照、相关 contract tests 与 Skill。

官方 Anthropic 文档仅作为 2026-08-09 外部研究 provenance：Messages API 暴露 `max_tokens`，而 Models/
model overview 显示不同模型具有不同输出能力。因此本卡选择保守的应用成本上限，不把外部文档归档为机器真源。

## API / 事件 / 数据契约

- 不改变公开请求、响应、事件或配置字段；`vc.model-providers.deployments[*].max-tokens` 继续绑定为 `int`。
- Anthropic 私有有效域精确为整数闭区间 `[1, 8192]`；构造 config 与编码 request body 使用同一规则。
- 合法值 1 和 8192 必须在 JSON 中分别编码为数值 `1`、`8192`；既有 1024/2048 fixture 不变。
- 非法值不得变成 8192、默认值或其他合法数值；失败中不得包含 API key、prompt、schema 或用户内容。
- OpenAI 的 `SizeLimits.MAX_OPENAI_OUTPUT_TOKENS` 不复用、不改名；Anthropic 上限保持 adapter 私有。

## 权限、RLS 和数据处理要求

不修改租户、RLS、凭据读取、日志或数据库。runtime test 使用 synthetic secret 和受控 registry；contract test
使用计数 HttpClient/本地 mock，不访问真实 Provider，不记录真实 Token、联系人或用户数据。

## 状态机和失败行为

- master provider 开关关闭时仍不读 secret、不创建 adapter，非法未启用 deployment 不应引入新的启动失败。
- 启用 Anthropic deployment 时，secret 与现有字段校验后构造 config；`maxTokens` 超界立即抛出，registry
  中不得留下该 adapter，尚未创建 session 或 HTTP request。
- config 构造成功后，codec 在 JSON 写入前重验；若内部不变量被破坏则归一化为既有 codec/adapter 失败，
  不触发 HTTP。合法请求沿用既有 timeout、cancel、streaming、terminal 与 body-close 状态机。
- 校验不做 silent clamp，且所有边界比较使用整数比较，不发生加一溢出。

## 模型、Prompt、记忆和安全边界

不改变批准的 Provider/模型路由、messages、schema、memory、safety、authorization fence、quota 或 retry。
8192 只约束 Anthropic adapter 请求的输出 token 预算，是独立私有应用策略，不扩大任何模型或租户权限。

## 验收标准

1. `AnthropicMessagesConfig` 冻结独立私有上限 8192；1 和 8192 构造成功，0、负值、8193 与
   `Integer.MAX_VALUE` 在 config 构造时确定性失败，错误不含 secret/prompt/schema。
2. codec 在写 `max_tokens` 前复用同一校验；1、8192、1024、2048 的 request JSON 保留原数值，
   不 clamp、不使用字符串；非法内部值不能进入可 dispatch 的 request body。
3. 启用 Anthropic deployment 的 `maxTokens=8193` 和 `Integer.MAX_VALUE` 使 provisioning 在 adapter 注册
   前失败，registry 为空且 HTTP 发送计数为 0；8192 正常注册。master-off/disabled 语义保持原状。
4. Anthropic contract test 对合法边界可完成既有成功流；非法构造/请求均在网络前失败，受控 HttpClient
   计数为 0，binding、sequence、Usage 和唯一 terminal 既有语义不退化。
5. 生产代码仅修改 Anthropic config/codec；测试仅新增 config test、修改 runtime provisioner test 并新增
   maxTokens contract test。ModelProtocol、SizeLimits、OpenAI、runtime 生产、specs、数据库、前端和 CI 无变更。
6. 定向 reactor、根级 Maven verify、canonical precheck 与唯一无参数 `git diff --check` 均在独立
   Reviewer PASS 后绑定同一冻结候选 Commit/Tree 并真实 PASS；远端保持非 PASS，不冒充本地结果。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。实现期间允许用精确 `-Dtest` 子集迭代；正式定向 reactor、
根级 Maven、canonical 和无参数 `git diff --check` 各执行一次，不重复 canonical 已包含的子命令。
所有结果记录真实退出码、完整候选 Commit/Tree、环境与 stdout/stderr 哈希。

## 回滚或前向修复

候选冻结前可在唯一 fix batch 内前向修复；不得改成 silent clamp、复用 OpenAI 常量、放宽为无上限、删除
测试、增加 skip 或吞退出码。候选冻结后 Reviewer 发现阻塞项时，按最多一个 fix batch、最多 R2 处理；
需修改公开协议、模型路由或越界文件则失败关闭并创建永久 replacement。

## 停止条件

- 需要修改 writeAllowlist 外路径、公开协议、SizeLimits、OpenAI、runtime 生产代码、数据库或 CI。
- 需要把 8192 改成 Provider 通用能力声明，引入 Models API/新依赖，或改变 disabled/master-off/secret 语义。
- READY Doctor、Reviewer、canonical、exact-tree 或 pre-closure 任一非 PASS，或触发 90 分钟 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0118/` 与 `docs/handoffs/TASK-0118.json`；记录候选身份、R1/R2、1/8192/8193/
`Integer.MAX_VALUE` 边界、config/codec/runtime/HTTP dispatch 矩阵、正式门禁、远端非 PASS 与本地
exact-tree 限定覆盖。终态只用单父原子提交更新任务卡、Project State、Task Ledger、Evidence 与 Handoff，
随后 push、fetch 并验证 `HEAD...origin/main` 为 0/0。Handoff 必须保留跨 frame raw budget 与其余审计风险，
并给出与 `project-state.nextAction` 逐字一致的唯一下一动作。
