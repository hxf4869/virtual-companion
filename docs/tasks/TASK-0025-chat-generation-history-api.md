# TASK-0025：Chat、Generation、History API

```yaml
taskId: TASK-0025
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  database-migration: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 9bf68f30450b35a9e6bec6bb0618c552f1326692b14c2d2174e18bf9a281b572
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 84ca885cca1368e1c7d6b079aef88b914397f6e8
contextFingerprint: 54c89a7705b80a4d3ce5de68ec8406e404a30980a192cb01817b27f9e4eca165
contextLock: docs/tasks/context/TASK-0025.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: 8d95a3a49d67cbf8237c914297ea5b558f46579d
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
  riskClass: C4
  surfaceId: TASK_0025_CHAT_GENERATION_HISTORY_API
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
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
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/message-states.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/28_relationship_not_found_or_forbidden.sql
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - scripts/harness/catalog_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - specs/generated/openapi/catalog-schemas.yaml
  - docs/evidence/TASK-0024/evidence-pack.json
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/GenerationStateRules.java
writeAllowlist:
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/context/TASK-0025.context-lock.yaml
  - docs/evidence/TASK-0025/**
  - docs/handoffs/TASK-0025.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/31_message_history_pagination.sql
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
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
  - frontend/**
  - deploy/**
  - ops/**
  - docs/source/**
  - docs/decisions/**
  - service/adapters/**
  - service/apps/**
  - service/modules/**
  - service/platform/catalog/**
  - service/tests/**
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/**
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
  - skills/database-migration/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-GEN-001
  - INV-GEN-003
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0025
  - bash infra/db/run-rls-tests.sh
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers: []
independentReview: required
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0025 Chat/Generation/History API（database-migration C4，单一 protected
      skill surface）：新建 V10 前向迁移 service/platform/persistence/src/main/resources/db/migration/V10，
      新增 cancel_generation SECURITY DEFINER 函数（仅允许可取消非终态 generation——CREATED/INPUT_REVIEW/
      QUEUED/IN_PROGRESS/WAITING_FOR_CAPACITY/FINAL_REVIEW——经 catalog 双跳 CANCEL_REQUESTED→CANCELLED 转
      终态；COMMITTING 与终态拒绝；跨 owner 不披露存在性映射 NOT_FOUND_OR_FORBIDDEN）与 list_messages
      SECURITY DEFINER keyset 分页函数（按 (owner_user_id, id) 稳定排序 + after_id 游标 + 上限，复合所有权
      强制 conversation 属同 owner）。沿用 V8/V9 范式（set_config 绑 current_owner_id、out_ 前缀 RETURNS TABLE、
      SET search_path=vc,public、REVOKE PUBLIC 仅 GRANT vc_api、FORCE RLS 已由 V2 覆盖）。不新增运行角色、不给
      BYPASSRLS、不靠应用 WHERE 代替数据库所有权约束。OpenAPI specs/openapi/virtual-companion.yaml 新增
      Chat 发送（复用既有 receive_generation 幂等）、Generation 取消/snapshot（复用 read_generation_snapshot）、
      Message 分页历史端点与 schema，复用既有 ErrorEnvelope/ErrorCode 不新增错误码；重跑 scripts/dev/openapi_tool.py
      生成 specs/openapi/dist 并通过 diff --fail-on-drift。另修正 infra/db/run-rls-tests.sh 的迁移应用顺序为
      version sort（sort -V），使首个双位数版本 V10 正确排在 V9 之后（既有字典序 sort 在 V10 处把 V10 排到
      V1 之前导致 schema 未建即失败；属未保护测试基建的必要一行修复，不改任何迁移或 protected 路径）。
      不修改已执行迁移 V1 至 V9，不触碰 specs/contracts、
      specs/catalog、specs/generated、service Java 与 pom；complexityGate 无 split（仅 AUTHORIZATION 面，
      distinctCrossRiskSurfaces=1）。满足接受条件：OpenAPI 契约与生成 Client 无漂移、幂等/取消/分页/越权测试全绿。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以生成契约提供 Chat 接收、Generation 状态和历史读取 API。

## 范围内

- 幂等发送（复用 `vc.receive_generation`）、取消（新建 `vc.cancel_generation`）、Generation snapshot（复用 `vc.read_generation_snapshot`）和分页历史（新建 `vc.list_messages` keyset 分页）；
- 服务端所有权谓词与统一错误语义（`NOT_FOUND_OR_FORBIDDEN` 跨 owner 存在性隐藏）；
- OpenAPI 契约新增对应端点与 schema，复用既有 `ErrorEnvelope`/`ErrorCode`，生成 Client 无漂移。

## 明确禁止

- 客户端 `owner_user_id` 成为授权依据；
- 历史 API 暴露跨用户资源存在性；
- 公开注册、真实账号、WebSocket 或主动消息；
- 修改已执行迁移 V1–V9；
- 给运行角色 BYPASSRLS 或仅靠应用 WHERE 代替数据库所有权约束；
- 新增 catalog 错误码或改动 specs/contracts、specs/catalog、specs/generated；
- 实现代码反向覆盖 OpenAPI 或手改生成物。

## 依赖与决策闸门

- 依赖：TASK-0021、TASK-0023、TASK-0024（均 ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- OpenAPI 合同、实现（生成 Client）和生成 Client 无漂移；
- 幂等（既有 receive_generation 测试 13/14）、取消、分页和越权测试全部通过。

## 晋级规则

只有 TASK-0021、TASK-0023、TASK-0024 已 ACCEPTED 且本卡按 Backlog 执行顺序成为首个可晋级项时，才动态锁定迁移与精确命令。
