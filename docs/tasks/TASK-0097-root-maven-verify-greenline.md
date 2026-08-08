# TASK-0097：根级 Maven verify 与后端 CI 转绿（P1-02）

```yaml
taskId: TASK-0097
state: IN_PROGRESS
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
baseCommit: 9bf02d23438860c0c75db78ec3dfec8112307199
authorizationCommit: "f406e3c047c10f406af69362c902d7a7f469d44c"
contextFingerprint: 1df0d1053e6193cd89ecc45e946a161f0068f24de39df0d1e13fb2841eb2b10c
contextLock: docs/tasks/context/TASK-0097.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0097_ROOT_MAVEN_VERIFY_GREENLINE
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: PRIMARY_REMOTE_EXACT_SHA, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - pom.xml
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
  - .github/workflows/ci.yml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/evidence/TASK-0035/evidence-pack.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - service/apps/runtime/pom.xml
  - service/tests/openai-chat-completions-contract-tests/pom.xml
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsAdapter.java
  - service/adapters/model-openai/src/main/java/com/virtualcompanion/modelopenai/OpenAiChatCompletionsConfig.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ModelProviderProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderProvisioner.java
writeAllowlist:
  - docs/tasks/TASK-0097-root-maven-verify-greenline.md
  - docs/tasks/context/TASK-0097.context-lock.yaml
  - service/tests/openai-chat-completions-contract-tests/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsBoundaryContractTest.java
  - service/tests/anthropic-messages-contract-tests/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesBoundaryContractTest.java
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0097/**
  - docs/handoffs/TASK-0097.json
forbiddenPaths:
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
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .github/**
  - ci/**
  - scripts/harness/**
  - skills/**
  - docs/schemas/**
  - docs/planning/**
  - docs/source/**
  - docs/decisions/**
  - docs/evidence/TASK-0035/**
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - pom.xml
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/**
  - service/adapters/**
  - service/modules/**
  - service/platform/**
  - service/tests/**/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsSuccessContractTest.java
  - service/tests/**/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsFailureContractTest.java
  - service/tests/**/src/test/java/com/virtualcompanion/modelopenai/contract/OpenAiChatCompletionsTimeoutCancellationContractTest.java
  - service/tests/**/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesSuccessContractTest.java
  - service/tests/**/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesFailureContractTest.java
  - service/tests/**/src/test/java/com/virtualcompanion/modelanthropic/contract/AnthropicMessagesTimeoutCancellationContractTest.java
  - frontend/**
  - specs/**
  - infra/**
  - db/**
  - deploy/**
  - ops/**
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
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 2 正式分配 P1-02 构建绿线任务并确认继续执行：
      更新过期 contract test 语义（默认关闭/无默认凭据/approved-only provision），
      根级 Maven verify 与 GitHub backend job 转绿。范围覆盖 OpenAI 与 Anthropic 两个
      同类 boundary contract test（根级 verify 复现两者均含过期断言）。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0097
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是由 repository-owner 于 2026-08-08 按审计交接工作包 2（构建绿线 P1-02）正式分配的独立任务；只修 P1-02，不触碰其他审计项。根级 verify 复现确认 OpenAI 与 Anthropic 两个 boundary contract test 均含同类过期断言（Maven 在首个失败模块停止，因此审计报告仅列出 OpenAI 位置）。

## 背景与用户可观察目标

审计确认：根级 `./mvnw verify` 在锁定 JDK 25 环境下失败。复现显示失败点有两个（Maven 在 OpenAI 模块首个失败处停止，Anthropic 模块同类断言随后暴露）：
- `OpenAiChatCompletionsBoundaryContractTest.adapter_has_no_default_real_endpoint_environment_or_runtime_wiring:282`
- `AnthropicMessagesBoundaryContractTest.adapter_has_no_default_real_endpoint_environment_or_runtime_wiring:315`

两者均断言 runtime POM 不得依赖 provider adapter（`virtual-companion-model-openai` / `virtual-companion-model-anthropic`），但 TASK-0035 已把 OpenAI/Anthropic adapter 合法接入 runtime。`.github/workflows/ci.yml` 的 backend job 正是根级 verify，因此 main 的后端 CI gate 可复现为红。

本卡完成后，用户能观察到：根级 Maven verify 全绿；GitHub backend job 真实转绿；过期的"runtime 不得依赖 provider adapter"语义被替换为真正需要验证的边界——provider 默认关闭、无默认 endpoint/secret、只有 approved 配置才 provision。

## 范围内

- 仅更新两个 boundary contract test 的 `adapter_has_no_default_real_endpoint_environment_or_runtime_wiring` 测试语义（OpenAI 与 Anthropic 同类）：
  - 删除 "runtime POM 不得依赖 model adapter" 的过期断言，改为证明 runtime POM 允许（并声明）approved provider adapter 依赖；
  - 保持并强化 "无默认 endpoint/secret"：runtime application.yaml 与 provisioner 源码不得硬编码 `api.openai.com`/`api.anthropic.com`、`sk-`、`http(s)://` 字面量；
  - 证明 provider 默认关闭：runtime application.yaml 的 `model-providers.enabled` 默认 `${VC_MODEL_PROVIDERS_ENABLED:false}`；
  - 证明只有 approved 配置才 provision：provisioner 源码只有在 per-deployment `enabled()` 为 true 时才构建 adapter。
- 在锁定 JDK 25/Maven 容器（maven:3.9-eclipse-temurin-25-alpine）内运行**根级**
  `./mvnw --batch-mode --no-transfer-progress verify`，必须 PASS（不得只跑 `-pl service/apps/runtime -am` 子图）。
- 推送候选后，GitHub backend job 在该 exact SHA 上真实绿。

## 明确范围外

- 不修 P1-03 及之后任何审计项；不修 P2-20 master fixture、Python canonical、CI workflow 结构（backend job 已正确执行根级 verify，无需修改 `.github/workflows/ci.yml`）。
- 不修改 provider adapter、runtime POM、application.yaml、provisioner 或任何产品代码；不修改 `.harness/task-backlog.yaml` 或任何 protected paths。
- 不删除测试、不加 skip、不吞退出码、不降低阈值、不把局部 reactor 结果冒充根级验证。
- 不改写历史 Evidence/Handoff/ADR。

## 输入和前置条件

- Base Commit 固定为 `9bf02d23438860c0c75db78ec3dfec8112307199`，DRAFT 创建前工作树干净、`activeTask: null`。
- Context Lock 只绑定 Base Commit 内的仓库相对路径；外部审计/交接文档仅作 provenance。
- 根级 verify 在 OrbStack Docker 容器（JDK 25/Maven 3.9）内执行；Maven 缓存 `vc-maven-cache` 复用既有 volume。
- 本卡不触碰 protected paths（C2）；为质量保证安排独立 Reviewer（R1），但按 C2 语义 R1/R2 轮次以 `maximumReviewRounds: 2` 为上限。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供。

## API / 事件 / 数据契约

- 不修改产品 API、事件、数据库或运行时契约。
- 测试只读源码/配置文件断言契约语义，不引入网络、凭据或外部服务。

## 权限、RLS 和数据处理要求

- 不接触用户数据、凭据、数据库或网络服务；Docker 仅使用 OrbStack。
- 测试不得打印或断言真实 secret；只断言源码/配置中不存在默认凭据字面量。

## 状态机和失败行为

- 根级 verify 任一测试失败即保持非零退出并如实记录；不得以模块级子图替代根级验证。
- 远端 backend job 未绿时 remote exact-SHA 记录为非 PASS（与 TASK-0095 相同的如实记录语义），不伪装 PASS。
- 候选冻结、Reviewer、canonical、pre-closure、终态提交与远端 0/0 按 task-delivery-flow 执行；任一失败按 lifecycle 失败关闭。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆或 SafetyGate；不引入新依赖、SaaS 或付费运行时。
- 不改 Maven 依赖树（根级 verify 必须证明当前依赖图可构建、可测试）。

## 验收标准

1. 删除过期断言后，OpenAI 与 Anthropic 两个 `adapter_has_no_default_real_endpoint_environment_or_runtime_wiring` 断言以下语义且全部 PASS：runtime POM 声明 approved adapter 依赖；runtime application.yaml 不含 `api.openai.com`/`api.anthropic.com`/`sk-` 且 `model-providers.enabled` 默认 `${VC_MODEL_PROVIDERS_ENABLED:false}`；provisioner 源码不含 `http(s)://`/`sk-` 且仅在 `!deployment.enabled()` 为 false 时继续 provision。
2. 锁定 JDK 25 容器内根级 `./mvnw --batch-mode --no-transfer-progress verify` PASS（不能只跑 `-pl service/apps/runtime -am`）。
3. 其余 contract/success/failure/timeout 测试保持 PASS；`OpenAiChatCompletionsBoundaryContractTest` 与 `AnthropicMessagesBoundaryContractTest` 全部 7 项各自 PASS。
4. 推送候选后 GitHub backend job 在该 exact SHA 上结论为 success。
5. Diff 仅含 writeAllowlist；canonical Precheck、定向验证、独立 Reviewer、远端复核全部如实记录。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；根级 Maven verify 是任务特有检查（precheck 不含 Maven），只运行一次；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/容器与环境身份。

## 回滚或前向修复

- 修复采用最小测试变更；若根级 verify 在修复后仍失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C2，amendment 修改 `.harness/task-backlog.yaml` 需要 C4 授权，若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 runtime POM、adapter、application.yaml、ci.yml 结构、Maven 依赖树、`.harness/task-backlog.yaml`）时立即停止并询问 Owner。
- 根级 verify 失败集合超出本卡范围（出现其他模块失败）时停止并报告。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0097/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0097.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、容器/解释器、环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。
