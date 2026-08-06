# TASK-0024：Relationship 与唯一活跃 Companion

```yaml
taskId: TASK-0024
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
planningContractHash: 2a0256e62e24d35d443b1a3237f7241d6de92429a1ff36fd3e62792f04f05a63
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 752d682fc2c79d93d011c532f1be705248755283
contextFingerprint: b3d5ef029b0d721956c41b6dfdaefaed57912c9dfd33748c4d6173744378cc33
contextLock: docs/tasks/context/TASK-0024.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: c6342c4ed1e1a300ff9bc3706c5f89dfa7378ab4
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
  surfaceId: TASK_0024_RELATIONSHIP_ACTIVE_COMPANION
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
  - docs/tasks/TASK-0024-relationship-active-companion.md
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
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - scripts/harness/catalog_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - specs/generated/openapi/catalog-schemas.yaml
  - docs/evidence/TASK-0023/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0024-relationship-active-companion.md
  - docs/tasks/context/TASK-0024.context-lock.yaml
  - docs/evidence/TASK-0024/**
  - docs/handoffs/TASK-0024.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - infra/db/tests/26_relationship_active_limit_enforced.sql
  - infra/db/tests/27_relationship_unique_index_guard.sql
  - infra/db/tests/28_relationship_not_found_or_forbidden.sql
  - infra/db/tests/29_relationship_lifecycle_activate_deactivate.sql
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
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0024
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
    approvedAt: "2026-08-06"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0024 Relationship 与唯一活跃 Companion（database-migration C4，单一 protected
      skill surface）：新建 V9 前向迁移 service/platform/persistence/src/main/resources/db/migration/V9，在
      vc.relationship 上增加 partial unique index (owner_user_id) WHERE active 作为 activeCompanionLimit=1 的
      唯一权威不变量（READ COMMITTED 下串行化并发 INSERT/UPDATE）；新增 5 个 SECURITY DEFINER 生命周期函数
      create_relationship/get_relationship/list_relationships/activate_relationship/deactivate_relationship，按
      V8 范式（advisory lock 序列化同 owner create/activate 避免 unique_violation、out_ 前缀 RETURNS TABLE、
      set_config 绑定 current_owner_id、REVOKE PUBLIC 仅 GRANT EXECUTE TO vc_api、新表 FORCE RLS），不新增运行
      角色、不给 BYPASSRLS、不靠应用 WHERE 代替数据库所有权约束；越权 get/activate 经 FORCE RLS 返回空实现
      NOT_FOUND_OR_FORBIDDEN（存在性隐藏，INV-TENANT-001）。OpenAPI specs/openapi/virtual-companion.yaml 新增
      Relationship 端点与 schema，复用既有 ErrorEnvelope/ErrorCode（不新增错误码），重跑 scripts/dev/openapi_tool.py
      生成 specs/openapi/dist 并通过 diff --fail-on-drift。不修改已执行迁移 V1 至 V8，不触碰 specs/contracts、
      specs/catalog、specs/generated、service Java 与 pom；complexityGate 无 split（仅 AUTHORIZATION 面，
      distinctCrossRiskSurfaces=1）。满足接受条件：并发创建仍最多一个活跃 Companion、越权查询统一 NOT_FOUND_OR_FORBIDDEN。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

实现 Relationship 所有权和每个用户唯一活跃 Companion 的 Alpha 约束（activeCompanionLimit=1）。

## 范围内

- 新建 V9 前向迁移：在 `vc.relationship` 上增加 `active` 部分唯一索引（每 owner 最多一个活跃关系，唯一权威不变量），并增加 Relationship 生命周期的 SECURITY DEFINER 函数（create/get/list/activate/deactivate）；
- 并发创建仍最多一个活跃 Companion：部分唯一索引在 READ COMMITTED 下串行化并发 INSERT/UPDATE，advisory lock 使 create/activate 返回干净结果；
- 复合所有权与存在性隐藏：越权查询统一 `NOT_FOUND_OR_FORBIDDEN`（FORCE RLS 隔离 + SECURITY DEFINER 函数 scope 到 `vc.current_owner_id()`）；
- API 契约：在 OpenAPI 单一真源中新增 Relationship 端点与 schema，复用既有 `ErrorEnvelope`/`ErrorCode`（不新增错误码、不触碰 catalog/generated），重跑确定性生成器并通过漂移门禁。

## 明确禁止

- 多角色、多活跃 Companion 和恋爱模式；
- 跨 Owner 关系引用；
- 绕过唯一活跃 Companion 约束；
- 修改已执行迁移 V1–V8；
- 给运行角色 BYPASSRLS 或仅靠应用 WHERE 代替数据库所有权约束；
- 新增 catalog 错误码或改动 specs/contracts、specs/catalog、specs/generated；
- 实现代码反向覆盖 OpenAPI 或手改生成物。

## 依赖与决策闸门

- 依赖：TASK-0015、TASK-0023（均 ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- 并发创建仍最多一个活跃 Companion（部分唯一索引 + 顺序冲突测试证明：同 owner 第二个 active 插入被拒绝，不同 owner 各自允许，inactive 不冲突）；
- 越权查询统一 `NOT_FOUND_OR_FORBIDDEN`（跨 owner get/activate 返回空/不披露存在性）；
- V9 全部 SECURITY DEFINER 函数 revoke PUBLIC、仅 grant vc_api，新对象 FORCE RLS；
- OpenAPI 生成字节稳定且漂移门禁失败关闭。

## 晋级规则

只有 TASK-0015、TASK-0023 已 ACCEPTED 且本卡按 Backlog 执行顺序可晋级时，才动态锁定迁移与精确命令。
