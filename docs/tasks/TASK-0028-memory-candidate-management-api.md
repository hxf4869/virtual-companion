# TASK-0028：记忆候选、确认、修改、删除与来源 API

```yaml
taskId: TASK-0028
state: ACCEPTED
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
planningContractHash: 3c213cd4b8666ab1cf810df1be337aa02e7c4ab3bc08f528400e8324bce42e68
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 2a715085d0f55104fda7af40001fcf7c0d256e7e
authorizationCommit: 730caf24127228774a0d11716c4ba478c7b9e90d
contextFingerprint: 86b39ff3da96e76e640d9fd3a245f6806cd0da39606d4a16b6db3eb9526471d8
contextLock: docs/tasks/context/TASK-0028.context-lock.yaml
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
  riskClass: C4
  surfaceId: TASK_0028_MEMORY_CANDIDATE_MANAGEMENT_API
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
  - docs/tasks/TASK-0028-memory-candidate-management-api.md
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
  - specs/catalog/memory-item-statuses.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/32_memory_confirmation_path_only.sql
  - infra/db/tests/33_memory_cross_isolation_fail_closed.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - scripts/harness/catalog_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - specs/generated/openapi/catalog-schemas.yaml
  - docs/evidence/TASK-0027/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0028-memory-candidate-management-api.md
  - docs/tasks/context/TASK-0028.context-lock.yaml
  - docs/evidence/TASK-0028/**
  - docs/handoffs/TASK-0028.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/36_memory_idempotency.sql
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
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
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
  - python scripts/harness/precheck.py --task TASK-0028
  - bash infra/db/run-rls-tests.sh
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers:
  - id: task0028_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 50b1543fca95d7e6b7d6919e3f3616d1a26ca0eb
    evidencePath: docs/evidence/TASK-0028/review-r1.md
    reason: R1 PASS (no P0/P1). AC1 (canonical gate intact) — update_memory SET clause is summary-only (never status, no INSERT); create_memory_candidate still hardcodes PENDING_CONFIRMATION; confirm remains sole ACCEPTED path; no V12 change restores direct DML (INV-MEM-001/002 unweakened). AC2 (fail-closed + contract tests) — update/delete/list_evidence echo only caller values on foreign/absent id; list_memory_evidence empty for foreign/absent/deleted (indistinguishable from no-evidence); delete_memory idempotency matches V11 documented intent (owned already-deleted -> TRUE via FOR UPDATE existence check; foreign/absent -> raise; no TOCTOU); cross-owner/cross-relationship covered by tests 33/35; confirm/modify/delete/duplicate-request/unauthorized all tested (32/34/35/36). All 3 functions SECURITY DEFINER SET search_path=vc,public, REVOKE PUBLIC + GRANT vc_api, out_ prefix; CREATE OR REPLACE preserves delete_memory ACL. OpenAPI 8 endpoints match function behavior; MEMORY_* codes reused (zero catalog change); snapshot SHA matches source. SQL suite independently re-run 36/36. Non-blocking P2 (vacuous negative assertions in 35/36 — guards verified correct, defense-in-depth on cross-owner, same V11 32/33 pattern) + P3 (no 400-class code for validation failures — out of scope, matches V11, card forbids new codes) documented, no bearing/safety weakening, no fix batch.
    candidateTree: 1ea87ef8776f6cf15acaf56fdd3dabcd27c7e14d
    budget:
      maximumMinutes: 15
      elapsedSeconds: 278
      hardLimitReached: false
independentReview: required
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0028 记忆候选、确认、修改、删除与来源 API（database-migration C4，单一 protected
      skill surface）。新建 V12 前向迁移 service/platform/persistence/src/main/resources/db/migration/V12。新增两个
      SECURITY DEFINER 函数——update_memory（编辑 owned 非删除记忆的 summary，状态无关、绝不改 status，保留
      canonical 仅确认路径门禁；FOR UPDATE；foreign/absent/deleted raise 不披露存在性；天然幂等）与 list_memory_evidence
      （返回 owned 非删除记忆的来源 Evidence 行；foreign/absent/deleted 返回空与无证据不可区分）。CREATE OR REPLACE
      vc.delete_memory 使其匹配 V11 注释自称的「Idempotent on already-deleted rows」——owned 且已删除返回 true，
      foreign/absent 仍 raise 不披露存在性（修正 V11 文档/实现不一致；跨 owner 隔离不变，test 33 仍通过）。两个新函数
      沿用范式（set_config 绑 owner_user_id、out_ 前缀 RETURNS TABLE、SET search_path=vc,public、REVOKE PUBLIC 仅
      GRANT vc_api、FORCE RLS 已由 V2 覆盖）。OpenAPI 端点 createMemoryCandidate（模型入口只产 PENDING_CONFIRMATION）
      /list/get/confirm/reject/update/delete/list-evidence 复用既有 ErrorEnvelope/ErrorCode（MEMORY_CONFIRMATION_REQUIRED
      与 MEMORY_FORBIDDEN_CONTENT 已存在，零 catalog/generated 改动，不新增 protected surface）。SQL 测试 35（update+evidence
      新能力与跨 owner/跨 relationship 隔离）、36（幂等与重复请求语义），更新 test 34 的 re-delete 断言为 owner 范围幂等 true。
      INV-MEM-001（canonical 为 PG 真源、模型只产候选）与 INV-MEM-002（所有候选需确认）不被弱化——update_memory 不改 status，
      create 仍硬编码 PENDING_CONFIRMATION，confirm 仍唯一 ACCEPTED 路径，REVOKE 直接 DML 不回收。跨 owner/跨 relationship/
      缺上下文经 RLS + 显式谓词失败关闭 → NOT_FOUND_OR_FORBIDDEN（存在性隐藏，INV-TENANT-001）。complexityGate 无 split
      （仅 AUTHORIZATION 面，distinctCrossRiskSurfaces=1）。不修改已执行迁移 V1 至 V11（V12 仅前向新增 + delete CREATE OR REPLACE，
      不改表结构/权限回收集合），不触碰 specs/catalog、specs/generated、specs/contracts、service Java 与 pom、frontend（纯 DB +
      OpenAPI 契约卡）。满足接受条件——候选仅确认进入 canonical、修改/删除幂等、确认/修改/删除/重复请求/越权均有合同测试。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在 TASK-0027 的 Canonical Memory 持久化之上，提供记忆候选的确认、用户修改、来源 Evidence 读取与幂等删除 API：把 V11 的 SECURITY DEFINER 生命周期函数补全为可契约化的 HTTP 表面，并补齐 V11 缺失的「用户编辑内容」与「读取来源证据」两条经函数的访问路径，使所有模型提取候选仍只能经确认进入 canonical，且删除/编辑具备幂等与失败关闭语义。

## 范围内

- V12 前向迁移新增 SECURITY DEFINER 函数：`update_memory`（编辑 owned 非删除记忆的 summary，状态无关、不改 status，保留 canonical 确认门禁；FOR UPDATE；foreign/absent/deleted raise 不披露存在性；天然幂等）；
- V12 新增 `list_memory_evidence`（返回 owned 非删除记忆的来源 Evidence 行；foreign/absent/deleted 返回空，与无证据不可区分）；
- V12 `CREATE OR REPLACE vc.delete_memory` 使其实现匹配 V11 注释自称的「Idempotent on already-deleted rows」——owned 且已删除返回 true；foreign/absent 仍 raise 不披露存在性（修正 V11 文档/实现不一致；跨 owner 隔离不变，test 33 仍通过）；
- OpenAPI 端点：候选创建（createMemoryCandidate，模型入口只产 PENDING_CONFIRMATION）、list、get、confirm、reject、update（用户编辑）、delete（幂等）、list-evidence，复用既有 ErrorEnvelope/ErrorCode（MEMORY_CONFIRMATION_REQUIRED/MEMORY_FORBIDDEN_CONTENT 已存在，零 catalog 改动）；
- SQL 测试 35（update + evidence 新能力与跨隔离）、36（幂等与重复请求语义）；更新 test 34 的 re-delete 断言为幂等 true（owner 范围；foreign 仍 raise 由 test 33 覆盖）；
- 跨 owner/跨 relationship/缺上下文经 RLS + 显式谓词失败关闭 → NOT_FOUND_OR_FORBIDDEN（存在性隐藏，INV-TENANT-001）；
- 两个新函数沿用范式（set_config 绑 owner_user_id、out_ 前缀 RETURNS TABLE、SET search_path=vc,public、REVOKE PUBLIC 仅 GRANT vc_api）。

## 明确禁止

- 模型输出直接写 Canonical Memory（ACCEPTED）——仅确认路径可创建；update_memory 不得改 status；
- 修改已执行迁移 V1–V11（V12 仅前向新增 + delete 的 CREATE OR REPLACE，不改表结构/权限回收集合）；
- 给运行角色恢复 memory_item/memory_evidence 的直接 DML，或新增 BYPASSRLS；
- 改动 specs/catalog、specs/generated、specs/contracts、specs/openapi/dist 之外的手编生成物；
- 新增 catalog 错误码或 service Java/pom（纯 DB + OpenAPI 契约卡，无 Java 层）；
- 在 Alpha 启用 ACCOUNT_PRIVATE/ACCOUNT_SHARED。

## 依赖与决策闸门

- 依赖：TASK-0020、TASK-0025、TASK-0027（均 ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- 所有模型提取候选仍只能经 create_memory_candidate 产 PENDING_CONFIRMATION，且经 confirm_memory_candidate 唯一进入 ACCEPTED（V11 已结构化强制，V12 不弱化；test 32 回归）；
- update_memory 仅改 summary 不改 status，可编辑 PENDING_CONFIRMATION 与 ACCEPTED（非删除），foreign/absent/deleted/跨 owner/跨 relationship 均失败关闭不披露存在性；
- list_memory_evidence 返回 owned 非删除记忆的证据链，foreign/absent/跨 owner 返回空（与无证据不可区分）；
- delete_memory 对 owned 已删除幂等返回 true，foreign/absent raise 不披露存在性；
- 确认、修改、删除、重复请求与越权均有 SQL 合同测试覆盖（test 34 更新 + 35/36 新增）；
- OpenAPI 契约 validate + diff --fail-on-drift PASS（生成物与契约一致，无手编生成物）。

## 晋级规则

TASK-0020、TASK-0025、TASK-0027 ACCEPTED、仓库空闲且 Backlog 顺序允许后，才创建唯一 DRAFT。
