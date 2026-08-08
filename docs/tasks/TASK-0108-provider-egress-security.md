# TASK-0108：Provider egress 安全（P2-05 secret 路径穿越 + endpoint/egress allowlist）

```yaml
taskId: TASK-0108
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
baseCommit: df85ece8eb86774ba536e8f349fb8f7a5e44515f
authorizationCommit: ""
contextFingerprint: 5d747605f8c43f77624e71e4ee1500c62e86dd56b12fee1e72a71bd448a109e9
contextLock: docs/tasks/context/TASK-0108.context-lock.yaml
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
  surfaceId: TASK_0108_PROVIDER_EGRESS_SECURITY
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
  - docs/handoffs/TASK-0107.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/model-routing-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/model-protocol-contract.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviders.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReader.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfigTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisionerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ModelProviderPropertiesBindingTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReaderTest.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolAdapter.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ModelProtocolSession.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
writeAllowlist:
  - docs/tasks/TASK-0108-provider-egress-security.md
  - docs/tasks/context/TASK-0108.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0108/**
  - docs/handoffs/TASK-0108.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicy.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/port/ProviderEgressPolicyTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReader.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ProviderSecretReaderTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisionerTest.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/guard/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/execution/**
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/guard/**
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesAdapter.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesCodec.java
  - service/adapters/model-anthropic/src/main/java/com/virtualcompanion/modelanthropic/AnthropicMessagesSession.java
  - "service/adapters/model-fake/**"
  - "service/adapters/model-failure/**"
  - "service/tests/model-protocol-contract-tests/**"
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiContractTestSupport.java
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/MockOpenAiServer.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicContractTestSupport.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
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
      delivery-policy complexityGate 评估（P2-01/02/05/06+风险 5/6/7 合计
      estimatedWallMinutes > 90 且跨 modelruntime C3/contract C3/db-migration C4
      多风险面）按 Owner 建议拆为多张串行卡；本卡为第二张 P2-05 Provider
      egress 安全（ProviderSecretReader secret 路径穿越——basename/root
      containment/文件大小与权限限制 + OpenAiChatCompletionsConfig/
      AnthropicMessagesConfig endpoint 校验——https 强制 + approved host/port
      egress allowlist + 阻断 loopback/私网/link-local/metadata 地址 +
      Provisioner 接线与测试）。egress allowlist 采用交接文档推荐候选方案 A
      （默认 allowlist = {https://api.openai.com:443, https://api.anthropic.com:443}
      + 127.0.0.1 loopback http/https 任意端口供离线 mock-server 契约测试；
      拒绝 http 明文（非 loopback）、未获批 host、私网/link-local/metadata
      字面 IP；策略类可注入，生产 Provisioner 走默认严格策略）——AskUserQuestion
      无应答，按 Owner 既有建议（continue6 候选方案 A 标注推荐）推进，Handoff
      登记待 Owner 确认。本卡新增 service/**/modelruntime/**/port/**
      ProviderEgressPolicy（protected glob C3，model-routing-change skill +
      独立 Reviewer）；不触碰 specs/** 与 **/db/migration/**（forbiddenPaths）。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0108
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095..0107 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0108 起）。工作包 12 按 delivery-policy complexityGate 拆为多张串行卡（TASK-0107 协议正确性已 ACCEPTED），本卡为第二张 P2-05；本卡单风险面（provider 安全边界，AUTHORIZATION），estimatedWallMinutes 85（<90）不触发拆卡。触碰 `service/**/modelruntime/**`（port/** 新增 ProviderEgressPolicy，protected glob C3 → model-routing-change + 独立 Reviewer）；humanApprovals 已预填 Owner 分配记录与 egress 决策采用说明。

## 背景与用户可观察目标

2026-08-08 审计确认 P2-05 Provider 侧两个安全缺陷：

1. **secret 路径穿越**：`ProviderSecretReader.java:51-63` 的 `secretRoot.resolve(secretName)` 未 normalize/containment——配置可用 `../`（或绝对路径）读取其他进程可读文件，形成文件读取与密钥外送。
2. **任意 endpoint/HTTP**：`OpenAiChatCompletionsConfig.java:48-69` 与 `AnthropicMessagesConfig.java:69-91` 允许任意 http/https host；adapter 把读到的值作为凭据发送。若配置边界受损，可形成 SSRF 与密钥外送。

用户可观察结果：非法 secret 引用（含路径分隔符/`..`/绝对路径）与非法 endpoint（http 明文非 loopback、未获批 host、私网/link-local/metadata 字面 IP、非 approved port）在 Provisioner 接线时失败关闭；合法配置（默认 allowlist + 127.0.0.1 loopback 测试面）行为不变。

## 范围内

- `ProviderSecretReader` 加固：secretName 必须是纯 basename（不含路径分隔符/`.`/`..`）；解析后路径 normalize 必须仍位于 secretRoot 内（root containment）；secret 文件必须是 regular file、大小 ≤ 64 KiB、Unix 权限拒绝 group/other 可写（凭据防篡改）；失败语义仍为 fail-closed `IllegalStateException`。
- 新增 `ProviderEgressPolicy`（`service/modules/modelruntime/.../port/`，C3 protected）：校验 endpoint URI——https 强制（loopback 允许 http）、host 必须在 approved allowlist、非 loopback 端口必须为 443、阻断私网/loopback（除明确允许的 127.0.0.1）/link-local/metadata/CGNAT 字面 IP 与未获批 host；默认 allowlist = {api.openai.com, api.anthropic.com, 127.0.0.1}；策略可注入（测试自定义），默认实例为严格策略。
- `OpenAiChatCompletionsConfig`/`AnthropicMessagesConfig` 构造接入 `ProviderEgressPolicy`（保留 http(s)+host+path+userinfo 既有校验语义；`http://127.0.0.1` 既有契约测试正例继续通过）。
- `ApprovedModelProviderProvisioner` 接线验证：非法 endpoint/secret 的部署在 provision 时失败关闭（测试覆盖）。
- 测试：`ProviderSecretReaderTest` 增加穿越/大小/权限负例；新增 `ProviderEgressPolicyTest`；OpenAI/Anthropic Boundary 契约测试增加 egress 负例。

## 明确范围外

- P2-06（模型请求/响应尺寸与成本上限）：数值需 Owner 确认，留后续卡（工作包 12 第三张）。
- 条件风险 6/7（db/migration C4）、DNS 解析层 egress 策略（本卡做 host 字符串/字面 IP 层校验，不引入 DNS 解析依赖）、真实 Provider 接线（TASK-0035 闸门）、controller/dispatcher 接线（TASK-0093）。
- 不触碰 `service/**/modelruntime/**` 的 contract|execution|guard|authorization|registry|routing（forbiddenPaths 只读）；不触碰 adapter 其他文件、specs/**、db migration、前端、身份、记忆、安全模块。

## 输入和前置条件

Context Lock 输入全部使用 Base Commit `df85ece` 中的仓库相对路径；算法 `SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1`。相关输入：`ProviderSecretReader`/`ApprovedModelProviderProvisioner`/`ModelProviderProperties`/`ApprovedModelProviderConfig`、`OpenAiChatCompletionsConfig`/`AnthropicMessagesConfig` 与各自 adapter、`ModelProtocolAdapter`/`ModelProtocolSession`（port 接口）、OpenAI/Anthropic Boundary 契约测试与 Support（mock loopback http）、`specs/contracts/model-protocol-contract.yaml`。egress 默认值来自 Owner 交接文档推荐方案 A（见 humanApprovals）。

## API / 事件 / 数据契约

- `ProviderEgressPolicy`（新，public final，modelruntime/port 包）：`public static ProviderEgressPolicy defaults()` 与 `public void requireAllowed(URI endpoint)`（违规抛 `IllegalArgumentException`，消息不泄露凭据/内部细节）；构造可传自定义 approved host 集合（测试用）。
- `OpenAiChatCompletionsConfig`/`AnthropicMessagesConfig` 构造签名不变（内部 apply 默认策略），既有 public API 不变。
- `ProviderSecretReader.readSecret(String)` 签名与失败类型不变（`IllegalArgumentException`/`IllegalStateException` 语义按卡内验收细化）。
- 不改变 `ModelProtocolEvent`/`ModelPayload`/binding/授权快照结构；INV-AUTH-001 的执行快照匹配逻辑不改变。

## 权限、RLS 和数据处理要求

- 无数据库变更；凭据仍只经受控通道读取，不进入仓库、日志、业务类型或 API 响应（`toString()` 保持 redacted）。
- secret 文件权限校验只在支持 POSIX 权限的平台上启用（Windows 跳过，权限语义不适用）；校验为只读检查，不修改文件权限。
- 本卡修改路径：`service/modules/modelruntime/**/port/ProviderEgressPolicy*`（C3 protected）+ `service/adapters/model-openai|model-anthropic/**/…Config.java` + `service/apps/runtime/**/modelproviders/ProviderSecretReader.java` + 对应测试，均在 writeAllowlist。

## 状态机和失败行为

- Provisioner 接线失败关闭：任何 deployment 的 secret 引用非法（穿越/超限/权限不安全）或 endpoint 非法（协议/host/port/地址类别）→ provision 抛异常，注册表不产生部分接线结果。
- Config 构造失败关闭：非法 endpoint 在构造时即拒绝（`IllegalArgumentException`），不发出任何网络请求。
- Secret 读取失败语义：未知 secret/非法引用/不可读文件 → `IllegalStateException`（fail-closed，绝不回退空白或猜测默认值）；blank/null 参数 → `IllegalArgumentException`/`NullPointerException`。
- 不改变 LiveModelInvoker 事件循环与 fence 语义（TASK-0107 闭环物）。

## 模型、Prompt、记忆和安全边界

- 不改变 Prompt/Persona/模型名注入；egress 校验只作用于 adapter 出站配置边界。
- 记忆（memory）、安全（safety）、db migration 路径 forbiddenPaths 内不触碰。
- 阻断面：http 明文（非 loopback）、私网 10/8、172.16/12、192.168/16、loopback 127/8（除 127.0.0.1 明确允许）、link-local 169.254/16（含 169.254.169.254 metadata）、CGNAT/metadata 100.64/10（含 100.100.100.200）、组播/保留段、IPv6 ::1/fe80::/10/fc00::/7 与 ::ffff: 映射（如字面提供）。

## 验收标准

1. `ProviderSecretReader`：`../secret`、`a/../secret`、`/abs/path`、`dir/name`、`.`、`..` 均拒绝（IllegalArgumentException）；含路径分隔符拒绝；文件大小 > 64 KiB 拒绝；Unix 上 group/other 可写文件拒绝；normalize 后逃逸 secretRoot 拒绝；正常文件读取与换行剥离保持通过（既有 5 个测试不回归）。
2. `ProviderEgressPolicy`：默认 allowlist 下 `https://api.openai.com/v1/chat/completions`、`https://api.anthropic.com/v1/messages` 通过；`http://127.0.0.1:9/...`（loopback http 任意端口）通过；`http://api.openai.com/...`（明文）、`https://evil.example.com/...`（未获批）、`https://192.168.1.5/...`/`https://10.0.0.1/...`/`https://172.16.0.1/...`（私网）、`https://169.254.169.254/...`（link-local/metadata）、`https://100.100.100.200/...`（metadata）、`https://api.openai.com:8443/...`（非 443）、`https://127.0.0.2/...`（非获批 loopback 段）均拒绝；错误消息不含凭据。
3. Config 接线：`OpenAiChatCompletionsConfig`/`AnthropicMessagesConfig` 对上述非法 endpoint 构造即抛 `IllegalArgumentException`；既有合法正例（含 `http://127.0.0.1` 契约测试）全部保持通过；既有 OpenAI/Anthropic Boundary 契约测试 100% 通过（无 skip）。
4. Provisioner 接线：非法 endpoint 或非法 secret 引用的 deployment → provision 抛异常（fail-closed）；合法 deployment 照常接线（既有 Provisioner 测试不回归）。
5. 新增/修改测试全部通过；`git diff --check` 干净；根级 Maven `verify`（docker JDK 25 + vc-maven-cache）BUILD SUCCESS；canonical precheck 5/5 PASS；独立 Reviewer（C3）R1 PASS（阻塞 P0/P1 为零）。
6. 定向测试（-pl 含 modelruntime + apps/runtime + model-openai + model-anthropic + 两个 contract-tests 模块，-am）BUILD SUCCESS（含 model-protocol-contract-tests 编译面）。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；根级 Maven verify（docker JDK 25，vc-maven-cache）是任务特有后端门禁（precheck 不含 Maven），只运行一次并记录真实 BUILD SUCCESS/FAILURE；`git diff --check` 只运行一次。定向模块测试在迭代中运行（不冻结为 Evidence 命令）。所有命令记录真实状态、退出码、验证 Commit/Tree、容器/解释器与环境身份。远程 CI 因 Actions 配额耗尽（resetDate 2026-08-01 周期）如实记录非 PASS（passClaimed=false），本地等价验证为备用通道（Owner 既有授权）。

## 回滚或前向修复

- 修复采用最小实现与测试变更；若根级 verify 失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 无持久数据变更（无迁移）；回滚 = 修正文件后重跑根级 verify 与 precheck。
- READY 后如需增加路径或改变条款（如 Owner 修订 egress allowlist 数值），只能停止并走 Backlog 强类型 Owner amendment。

## 停止条件

- Context、批准、Skill、allowlist、候选身份、Reviewer、canonical、CI 或远端验证失败时停止晋级（fail closed）。
- 发现需要修改 writeAllowlist 外路径（如 contract yaml、db migration、其他 adapter）时停止并询问 Owner。
- 达到 hardFuseWallMinutes 90 时停止实现与复核，仅允许 closure-only 收尾（Evidence/Handoff/pre-closure/终态提交/push/远端 0/0）。
- Owner 若修订 egress allowlist 默认值（当前采用方案 A），先停下按 amendment 流程处理。
- P2-06/风险 6/7 不纳入本卡；如 Owner 要求本卡承担，先停下重建范围。

## Evidence Pack

输出到 `docs/evidence/TASK-0108/`，并生成 `docs/handoffs/TASK-0108.json`。
