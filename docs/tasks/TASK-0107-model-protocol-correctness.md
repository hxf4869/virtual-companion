# TASK-0107：模型协议正确性（P2-01 protocol event fence + P2-02 Anthropic tool use + 条件风险 5）

```yaml
taskId: TASK-0107
state: ACCEPTED
terminalStateReason: >-
  P2-01+P2-02+条件风险 5 完成并验证：LiveModelInvoker 应用 ModelProtocolEventFence
  （binding/sequence 严格连续/重复 usage/EOS 内容校验，FenceViolation 失败关闭 +
  额度释放 + NON_RETRYABLE_FAILED）；Anthropic 真实 tool-use 协议（非流 tool_use
  block + 流式 input_json_delta 累积，结构化输出经 tool_use input 提取并
  requireStructuredJson 验证，非结构化拒绝 tool_use/input_json_delta）；EOS 无内容
  不产生 CHAT_COMPLETED（INV-GEN-003，RealtimeEventType.CHAT_FAILED 断言）。
  根级 Maven verify BUILD SUCCESS；canonical precheck 5/5 PASS（doctor 463986
  checks）；定向测试 modelruntime 113/113 + anthropic 30/30 +
  model-protocol-contract-tests 28/28；R1 FAIL（P1-01 静态 fence API 兼容）→ fix
  batch bf4231e → R2 PASS；remote CI 因 Actions 配额耗尽如实记录非 PASS
  （UNKNOWN_NOT_RUN，passClaimed=false），本地等价验证为备用通道（Owner 既有授权）。
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
baseCommit: 5a0490cca34230fae7b575814c7c18d84a7da9e0
authorizationCommit: "6fb308e499cd9d947de882136b314b74d527c6f8"
contextFingerprint: 303981ae0e745098c11969ece0e23d89c33d30d5e0f8465e01a95a57d388d91e
contextLock: docs/tasks/context/TASK-0107.context-lock.yaml
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
  surfaceId: TASK_0107_MODEL_PROTOCOL_CORRECTNESS
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
  - docs/handoffs/TASK-0106.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/InvocationBinding.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelPayload.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolEvent.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ModelProtocolRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/ResponseMode.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/StopReason.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TimeoutBudget.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/TokenUsage.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveInvocationRequest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/ScriptedAdapter.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFenceTest.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
writeAllowlist:
  - docs/tasks/TASK-0107-model-protocol-correctness.md
  - docs/tasks/context/TASK-0107.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0107/**
  - docs/handoffs/TASK-0107.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveModelInvoker.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFence.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/LiveModelInvokerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/ModelProtocolEventFenceTest.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/**
  - "service/adapters/model-openai/**"
  - "service/adapters/model-fake/**"
  - "service/adapters/model-failure/**"
  - "service/apps/**"
  - "service/platform/**"
  - "service/tests/model-protocol-contract-tests/**"
  - "service/tests/openai-chat-completions-contract-tests/**"
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/CountingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/NeverCompletingHttpClient.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/MockAnthropicServer.java
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
  - specs/contracts/finalization-contract.yaml
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
    sourceThreadId: zcode-audit-fix-20260809
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 12（Provider）分配本卡：工作包 12 经
      delivery-policy complexityGate 评估（P2-01/02/05/06+风险 5/6/7 合计
      estimatedWallMinutes > 90 且跨 modelruntime C3/contract C3/db-migration C4
      多风险面）按 Owner 建议拆为多张串行卡；本卡为第一张协议正确性卡
      （P2-01 LiveModelInvoker 应用 protocol event fence + P2-02 Anthropic
      structured output 真实 tool-use 协议解析 + 条件风险 5 EOS≠completed
      语义验证）。P2-05（provider egress allowlist 需 Owner 决策）、P2-06
      （尺寸/成本上限数值需 Owner 确认）、条件风险 6/7（db/migration C4 +
      database-migration skill + humanApproval）不纳入本卡，留后续卡并在
      Handoff 登记。本卡不触碰 specs/** 与 **/db/migration/**（forbiddenPaths）。
      modelruntime C3 保护路径（model-routing-change skill）需独立 Reviewer。
independentReview: required
reviewers:
  - id: task0107_r1
    kind: independent-review-gate
    verdict: FAIL
    reviewedCommit: 5d054d55874d20b040652df17877ea676adbf34d
    evidencePath: docs/evidence/TASK-0107/review-r1.md
    reason: >-
      R1 完整矩阵复核发现 1 个阻塞 P1-01（ModelProtocolEventFence 静态
      accept(expected, candidate) 移除破坏 model-protocol-contract-tests
      编译）；其余 P2-01/P2-02 实现与断言真实、范围合规；fix batch bf4231e
      关闭 P1-01。
    candidateTree: f661551da3933620a4cace7f37a1067d78448cc5
  - id: task0107_r2
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: bf4231e49024c391c01bd9e8e28883942cc8d364
    evidencePath: docs/evidence/TASK-0107/review-r2.md
    reason: >-
      R2 delta 复核 PASS：P1-01 关闭（静态 accept 恢复）、P2-01 混合 block
      累积 + 多 text 测试、P2-02 流式负路径测试；无新 P0/P1/P2；残留 P3
      （tool_use name 运行时一致性、ContentBlockStop index 交叉校验）记入
      Handoff。
    candidateTree: 4ab775609fea0946558a9030e4f09352834c724c
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0107
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0106 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0107 起）。工作包 12 按 delivery-policy complexityGate（estimatedWallMinutes > 90、跨风险面、P2-05/P2-06 需 Owner 决策）拆为多张串行卡，本卡为第一张协议正确性卡；C3（service/**/modelruntime/** 触发 model-routing-change + 独立复核），humanApprovals 已预填 Owner 分配记录。

## 背景与用户可观察目标

2026-08-08 审计确认三个模型协议正确性缺陷/风险：

1. **P2-01**：`LiveModelInvoker` 直接消费 adapter events，没有调用已有 `ModelProtocolEventFence`，也未统一校验 binding、sequence、重复 usage、EOS 内容。迟到或错误 adapter event 可污染当前输出和计费。当前没有生产 consumer，但接线前必须复用 fence/reducer，并增加错 binding、乱序、重复 usage、EOS 无内容测试。
2. **P2-02**：`AnthropicMessagesCodec` 请求声明 `tools` 和强制 `tool_choice`，但非流响应只读首个 `text` block，流响应只读 `text_delta`；真实 tool use 返回 `tool_use` content block，流式参数通过 `input_json_delta` 形成。现有测试用 text block，不能证明 structured output。应解析真实协议并验证 tool name/schema，或在实现完成前停止宣称该 capability。
3. **条件风险 5**：Provider EOS 到最终安全审查尚未生产接线。`LiveModelInvoker` success 不能直接等价 `chat.completed`；真实外发必须经过 `FINAL_REVIEW`、最终安全审查和原子 finalize（INV-GEN-003）。生产接线依赖 TASK-0093（controller/dispatcher）；本卡验证并固定 EOS 语义契约。

用户可观察结果：模型协议层的 event 消费失败关闭（错 binding/乱序/重复 usage/EOS 无内容不再污染输出与计费）；Anthropic structured output 真实 tool-use 协议可解析并验证 tool name/schema；EOS≠completed 语义被测试固定。

## 范围内

- P2-01：`LiveModelInvoker.invokeExternal` 事件消费循环应用 `ModelProtocolEventFence`；`ModelProtocolEventFence` 扩展为有状态校验（binding 完整匹配、sequence 从 0 严格连续、重复 usage 拒绝、EOS 必须携带内容、terminal 后无事件）；`LiveModelInvokerTest`/`ModelProtocolEventFenceTest` 增加错 binding、乱序、重复 usage、EOS 无内容测试。
- P2-02：`AnthropicMessagesCodec.decodeMessage` 遍历 content blocks（text 累积 + tool_use 取 `input` JSON）；`decodeStreamEvent` 支持 `input_json_delta`（partial_json 累积）并跟踪 content_block index/type；`AnthropicMessagesSession` 结构化模式累积 input_json_delta；`AnthropicContractTestSupport` 增加真实 tool_use/input_json_delta mock；`AnthropicMessagesSuccessContractTest.structured_output_when_claimed` 改用真实 tool-use 结构并验证 tool name/schema。
- 条件风险 5：验证/固定 succeeded 语义（EOS 事件不产生 chat.completed；finalize 由 FinalizeGenerationService 的 FINAL_REVIEW→COMPLETED 事务负责，INV-GEN-003），并记录生产接线仍依赖 TASK-0093。

## 明确范围外

- P2-05（ProviderSecretReader 路径穿越 + endpoint/egress allowlist）：需 Owner egress allowlist 决策，留后续卡。
- P2-06（模型请求/响应尺寸与成本上限）：数值需 Owner 确认，留后续卡。
- 条件风险 6（V15 provider_attempt authorization snapshot 强约束）与风险 7（registry/quota ledger 持久化）：**/db/migration/** C4 + database-migration skill + humanApproval，留后续工作包。
- controller/dispatcher 生产接线（TASK-0093）、真实 Provider 接线、specs/contracts 或 specs/catalog 修改、db migration、前端、身份、记忆、安全模块。
- 不触碰 `service/modules/modelruntime/**/contract|authorization|registry|routing|port`（只读）与 adapter 其他文件。

## 输入和前置条件

Context Lock 输入全部使用 Base Commit `5a0490c` 中的仓库相对路径；算法 `SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1`。相关契约与实现：`specs/contracts/model-protocol-contract.yaml`（requiredContractTests 含 `structured_output_when_claimed`、`late_token_fence`）、`specs/contracts/finalization-contract.yaml`、`ModelProtocolEvent`（binding+sequence+terminal 语义）、`ModelProtocolEventFence`（现有 binding-only 校验）、`AnthropicMessagesSession`（StreamState 结构化累积）、`AnthropicContractTestSupport`（mock server 事件构造）。

## API / 事件 / 数据契约

- `ModelProtocolEvent`：`OutputDelta`/`UsageReported`/`AttemptEos`/`AttemptFailed`/`AttemptCancelled`，每个事件携带完整 binding 与单调 sequence（contract test 断言 contiguous）。本卡不改变事件结构。
- `ModelProtocolEventFence.accept(expected, candidate)`：保持静态签名兼容；有状态校验由新增的 fence 状态（sequence/usage/EOS 语义）承载，供 `LiveModelInvoker` 每次 attempt 持有。
- Anthropic 真实协议：非流 `content` 为 blocks 数组（`text` 与 `tool_use{name,input}`）；流式 `content_block_delta` 的 `delta.type=input_json_delta`（`partial_json` 片段累积成完整 input JSON）；`content_block_start` 声明 block type（结构化时 `tool_use` 的 `input` 从 `{}` 开始）。
- `ModelPayload.StructuredJson`/`TextChunk` 语义不变；结构化模式（`ResponseMode.StructuredJson`）下 Anthropic 侧输出通过 tool_use input 提取并 `requireStructuredJson` 验证，非结构化模式保持 text block 路径。
- 失败语义：任何协议不符（缺 block、非法 input JSON、序列违规、重复 usage、EOS 无内容）归一化为 `AnthropicCodecException`/失败关闭，不泄露 provider 细节。

## 权限、RLS 和数据处理要求

- 无数据库变更；无凭据读取；适配器请求/响应文本仍不进入业务类型（ProviderAttemptAudit 只携带身份与结果）。
- fence 校验 binding 与授权快照 provider 一致性（INV-AUTH-001 的执行快照匹配逻辑已存在于 LiveModelInvoker，本卡不改变授权决策流程）。
- 本卡修改路径：`service/modules/modelruntime/**/execution|guard`（C3 model-routing-change）+ `service/adapters/model-anthropic/**` + anthropic contract-tests（Success/Support 两文件），均在 writeAllowlist。

## 状态机和失败行为

- 事件消费循环：对每个事件先 fence（binding 完整匹配 + sequence 严格连续），再分派（OutputDelta 累积、UsageReported 至多一次、terminal 终止）。fence 拒绝 → MalformedResponse 失败关闭并释放额度（复用现有 ALL_FAILURE 路径）。
- EOS 语义：`AttemptEos` 仅终止 attempt；输出结果由 `LiveAttemptOutcome.succeeded` 携带，绝不直接等价 chat.completed（INV-GEN-003）；终态由 FinalizeGenerationService 的 FINAL_REVIEW 事务产生。
- 非流结构化响应含 `tool_use` 而缺 `text` 时：结构化模式取 tool_use input；非结构化模式拒绝（协议不符失败关闭）。
- 流式结构化：`content_block_start` 记录 block（text/tool_use）；`text_delta` 进文本、`input_json_delta` 进结构化累积；`content_block_stop` 结算当前 block；`message_stop` 前必须收到合法终结。

## 模型、Prompt、记忆和安全边界

- 不改变 Prompt/Persona 内容；不新增供应商硬编码模型名（model 仍由运行期配置注入）。
- SafetyGate/Authorization Guard/Quota 流程不改变；fence 仅加固 adapter event 边界。
- 记忆（memory 模块）与安全（safety 模块）路径 forbiddenPaths 内，不触碰。

## 验收标准

1. `LiveModelInvoker` 事件循环应用 fence：错 binding 事件被拒绝并失败关闭（MalformedResponse + 额度释放）；新增对应测试。
2. `ModelProtocolEventFence` 有状态校验：sequence 必须从 0 严格连续（乱序/跳跃/重复均拒绝）；`UsageReported` 至多一次（重复 usage 拒绝）；`AttemptEos` 前必须已有 OutputDelta（EOS 无内容拒绝）；terminal 后事件拒绝。`ModelProtocolEventFenceTest` 全部新用例通过。
3. Anthropic 非流：`decodeMessage` 对含 `tool_use{name,input}` block 的响应（结构化模式）返回 input JSON 并验证可解析；混合 text+tool_use blocks 按序累积文本。`AnthropicMessagesBoundaryContractTest`/`SuccessContractTest` 通过。
4. Anthropic 流式：`decodeStreamEvent` 对 `input_json_delta` 序列（content_block_start(tool_use) → input_json_delta 片段 → content_block_stop）累积完整 input JSON；`structured_output_when_claimed` 测试改用真实 tool-use 结构并断言 tool name/schema 与请求一致，streaming 与非流均通过。
5. 非结构化 Anthropic 响应含 tool_use 而无 text 时失败关闭（结构化模式外不泄漏 tool JSON 为文本）。
6. EOS 语义：`LiveAttemptOutcome.succeeded` 不产生 chat.completed（既有 `realtimeEventTypeNeverFabricatesCompletionOnDegradedPaths` 保持通过）；本卡增加/保持 EOS→FINAL_REVIEW 契约测试（FinalizeGenerationService FINAL_REVIEW 事务），证明 INV-GEN-003。
7. 根级 Maven `verify`（docker JDK 25 + vc-maven-cache）BUILD SUCCESS；canonical precheck 5/5 PASS；`git diff --check` 干净；独立 Reviewer（C3）R1 PASS（阻塞 P0/P1 为零）。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；根级 Maven verify（docker JDK 25，vc-maven-cache）是任务特有后端门禁（precheck 不含 Maven），只运行一次并记录真实 BUILD SUCCESS/FAILURE；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、容器/解释器与环境身份。远程 CI 因 Actions 配额耗尽（resetDate 2026-08-01 周期）如实记录非 PASS（passClaimed=false），本地等价验证为备用通道（Owner 既有授权）。

## 回滚或前向修复

- 修复采用最小实现与测试变更；若根级 verify 失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 无持久数据变更（无迁移）；回滚 = 修正文件后重跑根级 verify 与 precheck。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C3；若出现该需求应停止并询问 Owner）。

## 停止条件

- Context、批准、Skill、allowlist、候选身份、Reviewer、canonical、CI 或远端验证失败时停止晋级（fail closed）。
- 发现需要修改 writeAllowlist 外路径（如 contract yaml、db migration、其他 adapter）时停止并询问 Owner。
- 达到 hardFuseWallMinutes 90 时停止实现与复核，仅允许 closure-only 收尾（Evidence/Handoff/pre-closure/终态提交/push/远端 0/0）。
- P2-05/P2-06/风险 6/7 不纳入本卡；如 Owner 要求本卡承担，先停下重建范围。

## Evidence Pack

输出到 `docs/evidence/TASK-0107/`，并生成 `docs/handoffs/TASK-0107.json`。
