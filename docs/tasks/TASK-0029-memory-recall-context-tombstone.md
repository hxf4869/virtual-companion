# TASK-0029：跨会话召回、Context 注入与删除墓碑

```yaml
taskId: TASK-0029
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
planningContractHash: 750a1b4f507c6c9b7113208cf68aa57688ae5be825f58c647a83af98d6667f64
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 2c4237687431a4421cdfd93c49593712d77be872
authorizationCommit: 52140e5d8d5ec2d26a860ac3b54c1db8ba790903
contextFingerprint: 6f1b4c05bfb74e97685f23d85e61bdeb9a92a250593ae4f7d3081d833b908fa6
contextLock: docs/tasks/context/TASK-0029.context-lock.yaml
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
  surfaceId: TASK_0029_MEMORY_RECALL_CONTEXT_TOMBSTONE
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
  - docs/tasks/TASK-0029-memory-recall-context-tombstone.md
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
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/32_memory_confirmation_path_only.sql
  - infra/db/tests/33_memory_cross_isolation_fail_closed.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/36_memory_idempotency.sql
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0028/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0029-memory-recall-context-tombstone.md
  - docs/tasks/context/TASK-0029.context-lock.yaml
  - docs/evidence/TASK-0029/**
  - docs/handoffs/TASK-0029.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - infra/db/tests/37_memory_recall_scope_budget.sql
  - infra/db/tests/38_memory_recall_tombstone_determinism.sql
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
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
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
  - python scripts/harness/precheck.py --task TASK-0029
  - bash infra/db/run-rls-tests.sh
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
reviewers:
  - id: task0029_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: e45975976fc5ac074c509a67cf34ae5043f19bff
    evidencePath: docs/evidence/TASK-0029/review-r1.md
    reason: R1 PASS (no P0/P1). AC1 (deterministic recall/tombstone/reindex) — recall is a pure SELECT, status='ACCEPTED' AND deleted_at IS NULL, ORDER BY scope,created_at,id (total order via per-owner id), no volatile fns; tombstone structural (no vector/matview/cache to revive); test 38 covers delete-then-recall + determinism. AC2 (cross-session injects only current Owner/Relationship confirmed memory) — predicate (owner,relationship); RELATIONSHIP cross-conversation; SESSION only for bound conversation (OR parenthesized, no leak); cross-owner/cross-relationship empty; unconfirmed never recalled. Budget clamp LEAST(GREATEST(x,1),100) verified; LIMIT after ORDER BY. SECURITY DEFINER SET search_path=vc,public, REVOKE PUBLIC + GRANT vc_api, set_config before table access. INV-MEM-001/002 unweakened. Write scope clean (SQL-only). One non-blocking P2 (test 38 asserted SET not ORDER) — closed by fix batch d734723 (test-only, V13 byte-identical) and R2.
    candidateTree: dc0195069b1fa25bc05f85774f6b7b8943df076f
    budget:
      maximumMinutes: 15
      elapsedSeconds: 261
      hardLimitReached: false
  - id: task0029_r2
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: d734723ce772f21fc02ff8f71bd56ee93a71f0f2
    evidencePath: docs/evidence/TASK-0029/review-r2.md
    reason: R2 finding-closure PASS. R1 P2 closed — test 38 now uses WITH ORDINALITY to aggregate in the function's own emission order and compares ordered arrays, so flipping/removing V13 ORDER BY would FAIL; test 37 budget=1 pins the kept row (rel-1) proving LIMIT-after-ORDER BY. git diff e459759 d734723 -- service/ empty (V13 byte-identical, test-only delta). No new P0/P1/P2. Candidate d734723 acceptable for closure.
    candidateTree: c38a62107612afb079dbf933dfe0062f60edc120
    budget:
      maximumMinutes: 15
      elapsedSeconds: 89
      hardLimitReached: false
independentReview: required
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0029 跨会话召回、Context 注入与删除墓碑（database-migration C4，单一 protected
      skill surface）。新建 V13 前向迁移 service/platform/persistence/src/main/resources/db/migration/V13。新增
      SECURITY DEFINER 函数 recall_memory(owner, relationship_id, conversation_id, max_entries)——确定性召回
      status='ACCEPTED' 且 deleted_at IS NULL 的 owned 记忆：RELATIONSHIP scope 跨 Conversation 召回，SESSION
      scope 仅在提供 conversation_id 时为该会话召回；来源分组（scope 对应 ContextSourceKind 的
      RELATIONSHIP_MEMORY/SESSION_MEMORY）+ 确定性排序（scope, created_at, id）+ 预算 LIMIT 钳制 [1,100]
      （对应 ContextBudget entries 上限，token 精确预算留给运行时消费方）。删除墓碑与传播经 WHERE deleted_at IS NULL
      结构性排除——无独立向量/缓存存储可复活（forbidden「删除数据通过向量或缓存复活」trivially 满足，本卡不引入
      向量存储，recall 读 live 表）。跨 owner/跨 relationship 返回空（存在性隐藏，INV-TENANT-001）；未确认候选
      （PENDING_CONFIRMATION/REJECTED/PROPOSED）与已删除记忆永不召回。沿用范式（set_config 绑 owner_user_id、
      out_ 前缀 RETURNS TABLE、SET search_path=vc,public、REVOKE PUBLIC 仅 GRANT vc_api、FORCE RLS 已由 V2 覆盖）。
      INV-MEM-001（canonical 为 PG 真源、模型只产候选）与 INV-MEM-002（所有候选需确认）不被弱化——recall 纯只读
      ACCEPTED，绝不产候选或改 status，不触碰确认门禁。complexityGate 无 split（仅 AUTHORIZATION 面，
      distinctCrossRiskSurfaces=1）。不修改已执行迁移 V1 至 V12（V13 纯前向新增只读函数，不改表结构/权限回收集合），
      不触碰 specs/catalog、specs/generated、specs/contracts、specs/openapi、service Java 与 pom、frontend（纯 DB 卡）。
      满足接受条件——删除前后召回/墓碑/确定性可测、跨会话只注入当前 Owner/Relationship 的已确认记忆。
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在 TASK-0027/0028 的 Canonical Memory 之上，提供跨 Conversation 的确定性召回读取路径：仅已确认（ACCEPTED）记忆可被召回、按 ContextPlan 来源（RELATIONSHIP/SESSION）与预算筛取、删除墓碑与传播（已删除记忆永不召回）。该读取路径是 ContextPlan 注入（SESSION_MEMORY/RELATIONSHIP_MEMORY）的真源数据；确定性，跨 owner/relationship/未确认/已删除全失败关闭或空。

## 范围内

- V13 前向迁移新增 SECURITY DEFINER 函数 `recall_memory(owner, relationship_id, conversation_id, max_entries)`：返回 owned 非删除且 status='ACCEPTED' 的记忆；RELATIONSHIP scope 记忆跨 Conversation 召回，SESSION scope 记忆仅在提供 conversation_id 时为该会话召回；来源（scope）分组 + 确定性排序（scope, created_at, id）；预算 LIMIT 钳制 [1,100]；FOR UPDATE 不需要（纯读，但谓词隔离）；跨 owner/跨 relationship 返回空（存在性隐藏）。
- 删除墓碑与传播：recall_memory 经 WHERE deleted_at IS NULL 结构性排除已删除记忆——无独立向量/缓存存储可复活（forbidden 满足）；删除前后召回确定性可测。
- 来源与预算：recall_memory 的 scope 过滤对应 ContextSourceKind（RELATIONSHIP_MEMORY/SESSION_MEMORY），LIMIT 对应 ContextBudget 的 entries 预算（token 精确预算留给运行时消费方，本卡提供确定性 entries 上限）。
- SQL 测试 37（召回 ACCEPTED-only/budget/scope/跨 owner+跨 relationship 隔离/未确认不召回）+ 38（墓碑/删除传播/确定性——删除前后召回一致且排除已删除、同输入同输出）。
- 不改表结构、不改权限回收集合（runtime 角色仍无 memory_item/memory_evidence 直接 DML）；canonical 确认门禁与 INV-MEM-001/002 不弱化（recall 只读 ACCEPTED，绝不产候选或改 status）。

## 明确禁止

- 召回未确认候选（PENDING_CONFIRMATION/REJECTED/PROPOSED）或已删除记忆；
- 删除数据经向量或缓存复活（本卡不引入向量存储；recall 读 live 表）；
- 召回绕过 ContextPlan 来源、预算或所有权（跨 owner/relationship 必须空/失败关闭）；
- 修改已执行迁移 V1–V12；给运行角色恢复直接 DML 或 BYPASSRLS；
- 改动 specs/catalog、specs/generated、specs/contracts、specs/openapi、service Java/pom、frontend（纯 DB 卡，无 OpenAPI/Java/catalog 改动）；
- 在 Alpha 启用 ACCOUNT_PRIVATE/ACCOUNT_SHARED。

## 依赖与决策闸门

- 依赖：TASK-0019、TASK-0028（均 ACCEPTED）；
- 无独立硬决策闸门。

## 验收

- 删除前后召回、墓碑和索引重建具有确定性测试（test 38：删除前召回含该记忆，删除后召回排除它且其余结果与顺序不变；同输入同输出）；
- 跨会话只注入当前 Owner/Relationship 的已确认记忆（test 37：recall 仅返回 status='ACCEPTED' 的 owned + relationship-scoped 记忆，跨 owner/relationship 空，未确认/已删除不召回，budget LIMIT 生效）。

## 晋级规则

TASK-0019、TASK-0028 ACCEPTED、仓库空闲且 Backlog 顺序允许后，才创建唯一 DRAFT。
