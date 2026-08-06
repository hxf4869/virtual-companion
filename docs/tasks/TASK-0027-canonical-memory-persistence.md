# TASK-0027：Canonical Memory 持久化与所有权隔离

```yaml
taskId: TASK-0027
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
planningContractHash: 1dbb31ed0f2b244d6b2b0ae13a753f7b2a43fd809eab052b804cc6176b3db27f
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 998b3125f77d4ce85068714d2ca17e55bc459b67
contextFingerprint: 598c274a68c51ebd268e07706f53d6dd8ac8ad5c785fc4f4e5dc4a11e1c0787f
contextLock: docs/tasks/context/TASK-0027.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: bf4df3724fd7ef4b4beedaeee7985d16c5ee3f35
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
  surfaceId: TASK_0027_CANONICAL_MEMORY_PERSISTENCE
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
  - docs/tasks/TASK-0027-canonical-memory-persistence.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/memory-scopes.yaml
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/28_relationship_not_found_or_forbidden.sql
  - infra/db/tests/30_generation_cancel.sql
  - specs/generated/openapi/catalog-schemas.yaml
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0026/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0027-canonical-memory-persistence.md
  - docs/tasks/context/TASK-0027.context-lock.yaml
  - docs/evidence/TASK-0027/**
  - docs/handoffs/TASK-0027.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - infra/db/tests/32_memory_confirmation_path_only.sql
  - infra/db/tests/33_memory_cross_isolation_fail_closed.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
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
  - specs/openapi/**
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
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
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
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-MEM-001
  - INV-MEM-002
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0027
  - bash infra/db/run-rls-tests.sh
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
      长线执行 Owner 授权 TASK-0027 Canonical Memory 持久化与所有权隔离（database-migration C4，单一 protected
      skill surface）：新建 V11 前向迁移 service/platform/persistence/src/main/resources/db/migration/V11。ALTER
      vc.memory_item 增补 conversation_id（SESSION scope 必需，FK→conversation ON DELETE CASCADE）+ deleted_at
      软删除时间戳 + status 默认值对齐 catalog alphaModelCandidateInitialStatus=PENDING_CONFIRMATION + CHECK
      （scope='SESSION' 要求 conversation_id NOT NULL）。新增 SECURITY DEFINER 生命周期函数：create_memory_candidate
      （仅插入 PENDING_CONFIRMATION 候选 + memory_evidence 证据链，校验 scope ∈ {SESSION,RELATIONSHIP}、SESSION 需
      conversation_id、拒绝 ACCOUNT_PRIVATE/ACCOUNT_SHARED；模型输出只产候选，INV-MEM-001/002）、confirm_memory_candidate
      （PENDING_CONFIRMATION→ACCEPTED 的唯一确认路径——canonical memory 只能由此创建有效记录）、reject_memory_candidate
      （→REJECTED）、delete_memory（deleted_at 软删除）、list_memory（relationship 范围 + 默认排除已删除）、get_memory。
      为强制 INV-MEM-001（模型输出只产候选、canonical 仅确认路径），REVOKE memory_item/memory_evidence 的 INSERT/UPDATE/DELETE
      于运行角色，所有写经 SECURITY DEFINER 函数（CASCADE 完整性不受影响）。沿用 V8/V9/V10 范式（set_config 绑 current_owner_id、
      out_ 前缀 RETURNS TABLE、SET search_path=vc,public、REVOKE PUBLIC 仅 GRANT vc_api、FORCE RLS 已由 V2 覆盖）。
      跨 owner/跨 relationship/缺上下文经 RLS + 显式谓词失败关闭→NOT_FOUND_OR_FORBIDDEN（存在性隐藏，INV-TENANT-001）。
      不修改已执行迁移 V1 至 V10，不触碰 specs/contracts、specs/catalog、specs/openapi、specs/generated、service Java 与 pom、
      frontend（纯 DB 卡，无 OpenAPI/Java/catalog 改动）；complexityGate 无 split（仅 AUTHORIZATION 面，
      distinctCrossRiskSurfaces=1）。满足接受条件：canonical memory 只能经确认路径创建有效记录；跨用户/跨关系/缺上下文均失败关闭。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立 PostgreSQL Canonical Memory、证据来源、作用域和复合所有权隔离。

## 范围内

- V11 迁移：ALTER `vc.memory_item`（+ conversation_id for SESSION、+ deleted_at 软删除、status 默认值对齐 PENDING_CONFIRMATION、SESSION⇒conversation_id CHECK）；
- Canonical Memory 生命周期 SECURITY DEFINER 函数：create_memory_candidate（仅 PENDING_CONFIRMATION 候选 + 证据链）、confirm_memory_candidate（唯一 ACCEPTED 确认路径）、reject_memory_candidate、delete_memory（软删除）、list_memory、get_memory；
- REVOKE memory_item/memory_evidence 直接写权限于运行角色 → 强制所有写经函数（INV-MEM-001：模型输出只产候选；canonical 仅确认路径）；
- FORCE RLS（V2 已覆盖）、证据链（memory_evidence）、删除状态（deleted_at）；
- 跨 owner/跨 relationship/缺上下文失败关闭 → NOT_FOUND_OR_FORBIDDEN。

## 明确禁止

- 模型输出直接写 Canonical Memory（ACCEPTED）——仅确认路径可创建；
- 跨 Relationship 读取或引用；
- 在 Alpha 启用 ACCOUNT_PRIVATE 或 ACCOUNT_SHARED；
- 修改已执行迁移 V1–V10；
- 给运行角色 BYPASSRLS 或新增 catalog 错误码 / 改动 specs 契约。

## 依赖与决策闸门

- 依赖：TASK-0016、TASK-0024（均 ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- Canonical Memory 只有确认路径（confirm_memory_candidate）可创建有效（ACCEPTED）记录；模型输出只产 PENDING_CONFIRMATION 候选；
- 跨用户、跨关系和缺上下文均失败关闭（get/list 返回空、confirm/delete foreign raise、缺上下文匹配 0 行）。

## 晋级规则

TASK-0016、TASK-0024 ACCEPTED、仓库空闲且 Backlog 顺序允许后，才创建唯一 DRAFT。
