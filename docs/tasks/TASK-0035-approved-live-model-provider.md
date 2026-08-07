# TASK-0035：单一获批真实模型供应商受控接入（硬决策闸门）

```yaml
taskId: TASK-0035
state: IN_PROGRESS
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 479a03e830f1e6c964deea820ba8b65d40ea07e0d72af957c6fa74e35a6b89d2
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: ef3891c3fb90dde886cd9e9268bd11504037fffd
contextFingerprint: 60ef5dfed42d00e38b8ec68679e707d3ee052832c47ae81ebf2883f8eaff3028
contextLock: docs/tasks/context/TASK-0035.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: 1e92c520c837da89509660c9d9aeb0bb11d47e56
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
  surfaceId: TASK_0035_APPROVED_LIVE_MODEL_PROVIDER
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/service-modes.yaml
  - specs/generated/catalog.snapshot.json
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - service/adapters/model-openai/**
  - service/adapters/model-anthropic/**
  - service/modules/modelruntime/**
  - service/modules/safety/**
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ProviderDeploymentRecord.java
  - service/apps/runtime/**
  - infra/db/run-rls-tests.sh
  - docs/tasks/TASK-0011-openai-chat-completions-offline-adapter.md
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/evidence/TASK-0011/evidence-pack.json
  - docs/evidence/TASK-0033/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/tasks/context/TASK-0035.context-lock.yaml
  - docs/evidence/TASK-0035/**
  - docs/handoffs/TASK-0035.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/adapters/model-openai/**
  - service/adapters/model-anthropic/**
  - service/modules/modelruntime/**
  - service/apps/runtime/**
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
  - infra/**
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
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
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - scripts/dev/**
  - skills/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - docs/source/**
  - docs/decisions/**
  - service/modules/safety/**
  - service/modules/memory/**
  - service/platform/catalog/**
  - service/tests/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - frontend/src/domain/**
  - frontend/src/pages/chat/**
  - frontend/src/pages/memory/**
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
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0035 真实供应商受控接入（GATE-LIVE-MODEL-PROVIDER
      APPROVED：获批供应商集 {OpenAI, Anthropic} 两家，具体模型/API 地址/供应商名称/
      凭据由运行期配置手动指定、不硬编码；凭据经 Docker secret/密钥文件注入；区域由配置
      端点决定、供应商标准开发者条款；Persona 用 Gentle Listener；Alpha 安全政策 7 条
      全部落在既有 Guard/Safety/Quota 约束）。外发仅获批部署可外发、凭据不进仓库/日志/
      业务类型。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0035
  - bash -c "cd service && mvn -o -pl service/apps/runtime -am test"
  - bash infra/db/run-rls-tests.sh
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。本卡措辞经 Owner amendment `task-0035-owner-align-provider-set` 对齐获批供应商集 {OpenAI, Anthropic}（DRAFT 阶段应用）。

## 背景与用户可观察目标

在 GATE-LIVE-MODEL-PROVIDER（2026-08-07 APPROVED）决策基础上，把获批真实供应商部署（具体模型/API 请求地址/供应商名称/凭据由运行期配置手动指定）接入外发路径，并保持 Registry、Authorization Guard、安全流水线、Quota 与审计边界。用户可观察：已获批部署可经真实供应商外发，真实外发故障/撤销/配额/安全失败全部关闭且不伪造；凭据不进入仓库、日志或业务类型。

## 范围内

- 获批真实供应商部署（Provider/Model/Region/Contract/Credential，由运行期配置手动指定、不硬编码）接线：运行期配置驱动的真实部署供给、外发路径启用、故障/撤销/配额/安全失败隔离与审计。
- Alpha Persona（Gentle Listener）、安全政策、审计、配额和故障隔离。
- 凭据经 Docker secret/密钥文件注入，读取即用，不落仓库/日志/业务类型。

## 明确范围外

- 未获批真实供应商、Beta、公开注册和真实支付；
- 猜测供应商、模型、凭据、区域、合同、Persona 或安全政策；
- 绕过 Registry、Authorization Guard、安全流水线或 Quota；
- 修改既有 SafetyGate/安全分类器逻辑、memory、catalog/generated 契约或 harness。

## 输入和前置条件

- baseCommit = ef3891c（TASK-0034 closure + harness 修复）。Context Lock 绑定 readAllowlist 在 baseCommit 的 SHA-256。
- 依赖 TASK-0020（安全流水线）、TASK-0030（H5 记忆）、TASK-0032（ZERO_LLM/配额/恢复）、TASK-0033（Anthropic 离线合同）、TASK-0034（身份）均已 ACCEPTED；硬闸门 GATE-LIVE-MODEL-PROVIDER 已 APPROVED。
- 既有 Registry（InMemoryProviderRegistry + JdbcProviderDeploymentRepository）、Authorization Guard、SafetyGate、QuotaLedger、model-openai/model-anthropic 离线合同适配器为实现参照。
- 真实凭据经批准渠道（Docker secret/密钥文件）注入，不写入仓库、日志、业务类型、OpenAPI 或 catalog。

## API / 事件 / 数据契约

- 运行期配置驱动获批部署供给（provider_deployment 表既有契约，不新增错误码/端点除非必要）；外发路径经既有 Generation/Realtime/Outbox 契约。
- 审计：provider_attempt + usage + realtime_event 既有链记录真实外发；失败/撤销/配额不足失败关闭且不伪造。
- 未获批供应商/部署不可外发（Registry 拒绝）；SafetyGate 非 adequate 不外发；Quota 超限/NO_CAPACITY 失败关闭。

## 权限、RLS 和数据处理要求

- 真实凭据为平台机密：仅经批准渠道注入，仓库内零明文凭据；凭据不进入日志、URL、模型上下文、OpenAPI 响应、catalog 或 generated 产物。
- 数据区域由配置端点决定（供应商默认区域），采用供应商标准开发者条款；Alpha 内部受控测试数据量小。
- 不削弱 INV-TENANT-001（owner 隔离）、INV-AUTH-001（请求与执行授权快照绑定）、INV-COST-001（无付费软件前置依赖）。

## 状态机和失败行为

- 真实外发故障（连接/超时/撤销/供应商错误）全部失败关闭并映射到既有错误语义；取消/超时/撤销不伪造终态。
- 配额不足/NO_CAPACITY → 失败关闭；ZERO_LLM 固定降级路径保持。
- 未获批供应商/部署、未授权、安全不 adequate → 一律不 ALLOW、不外发。

## 模型、Prompt、记忆和安全边界

- 不修改 SafetyGate/Quota/Registry 逻辑的安全属性；Persona 采用 Gentle Listener 获批内容。
- 外发内容不进入记忆候选（记忆由 TASK-0027/0028 既有路径处理，本任务不修改）。
- 本任务不猜默认供应商/模型/凭据/区域/合同——全部按闸门已批准方案与运行期配置执行。

## 验收标准

1. 仅获批部署可外发且凭据不进入仓库、日志或业务类型；真实外发故障、撤销、区域、合同和安全失败全部关闭。
2. 运行期配置驱动的获批部署供给可用：获批部署可经 Registry 供给，未获批/未知供应商部署不可供给。
3. 真实外发路径经 Authorization Guard 双授权 + SafetyGate adequate + Quota 配额校验通过才外发；任一不满足失败关闭且不伪造。
4. 凭据不进入仓库、日志、业务类型、OpenAPI 或 catalog（审计验证零明文凭据）。
5. Maven runtime + modelruntime + adapters 测试绿；harness unittest 绿；openapi validate/diff PASS；precheck PASS；git diff --check 干净。
6. 未获批部署/供应商外发被拒；SafetyGate 非 adequate 不外发；Quota 超限/NO_CAPACITY 失败关闭（集成/单测可复测）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准；每条记录状态、退出码、验证提交、产物哈希或无产物理由；同一条 `git diff --check` 只执行一次。precheck 已含正式 Doctor，不重复列 standalone Doctor。

## 回滚或前向修复

- 实现只增不改既有安全/路由语义；失败测试先修测试或实现，最多 1 个 fix batch。
- 若 READY 后 Owner 需修订条款或增加精确写路径：先登记 Backlog authorizationAmendments 强类型合同，再在卡 `scopeAmendments` 追加 Hash 绑定投影（单父原子治理提交）。
- 前向：本卡完成后 nextPromotable 为 TASK-0036（Technical Alpha 总验收）。

## 停止条件

- context/approval/Skill/白名单/候选身份/Reviewer/canonical/CI/远端复核任一失败关闭即停止推进并转 BLOCKED。
- hardFuseWallMinutes=90 停止实现/修复/Reviewer/canonical/CI；仍活动则只允许 closure-only overrun（Evidence/Handoff、pre-closure、terminal commit、push），记录时长与根因。
- R1 阻塞性发现（P0/P1/AC 违反/不变量违反）进入最多 1 个 fix batch，R2 只做 finding-closure + delta + adjacent risk + 新 P0/P1；禁止第三轮 review。

## Evidence Pack

输出到 `docs/evidence/TASK-0035/`（evidence-pack.json、pre-closure-request、review-r1/r2.md），并生成 `docs/handoffs/TASK-0035.json`（headCommit= 实现候选提交、completed/remaining/knownRisks/nextAction，nextAction 与 project-state 逐字一致）。
