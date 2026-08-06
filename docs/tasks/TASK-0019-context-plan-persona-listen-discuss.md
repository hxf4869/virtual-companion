# TASK-0019：ContextPlan、人格结构、LISTEN/DISCUSS

```yaml
taskId: TASK-0019
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 23fd5b119c7d25a3da9597169ad1a06d55972f6bd08ac38122e42ddb1131310f
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: da045605cff70461406eb5cbc218bba049afeb4a
authorizationCommit: ""
contextFingerprint: 6c9553ff0918886b3b2b78a9fd2964080cdc53c708fd2ce48ee130ce974239eb
contextLock: docs/tasks/context/TASK-0019.context-lock.yaml
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
  surfaceId: TASK_0019_CONTEXT_PLAN_PERSONA_LISTEN_DISCUSS
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
reviewers: []
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
  - docs/tasks/TASK-0019-context-plan-persona-listen-discuss.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ServiceMode.java
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - requirements-harness.txt
  - pom.xml
  - service/modules/conversation/pom.xml
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/CandidateContentAddress.java
  - docs/evidence/TASK-0018/evidence-pack.json
writeAllowlist:
  - docs/tasks/TASK-0019-context-plan-persona-listen-discuss.md
  - docs/tasks/context/TASK-0019.context-lock.yaml
  - docs/evidence/TASK-0019/**
  - docs/handoffs/TASK-0019.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/InteractionMode.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/ContextSourceKind.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/ContextBudget.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/ContextEntry.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/ContextPlan.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/InteractionModeSelector.java
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/contextplan/PersonaSkeleton.java
  - service/modules/conversation/src/test/java/com/virtualcompanion/conversation/contextplan/ContextPlanTest.java
  - service/modules/conversation/src/test/java/com/virtualcompanion/conversation/contextplan/InteractionModeSelectorTest.java
  - service/modules/conversation/src/test/java/com/virtualcompanion/conversation/contextplan/PersonaSkeletonTest.java
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
  - skills/**
  - specs/**
  - frontend/**
  - deploy/**
  - ops/**
  - docs/source/**
  - service/adapters/**
  - service/apps/**
  - service/platform/**
  - service/modules/modelruntime/**
  - service/modules/conversation/src/main/java/com/virtualcompanion/conversation/generation/**
  - service/modules/conversation/src/test/java/com/virtualcompanion/conversation/generation/**
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/01_cross_user_read_denied.sql
  - infra/db/tests/02_cross_relationship_reference_denied.sql
  - infra/db/tests/03_cross_conversation_reference_denied.sql
  - infra/db/tests/04_stale_worker_fence_denied.sql
  - infra/db/tests/05_missing_context_fail_closed.sql
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - infra/db/tests/07_claim_binds_context.sql
  - infra/db/tests/08_expired_lease_zero_write.sql
  - infra/db/tests/09_wrong_token_zero_write.sql
  - infra/db/tests/10_stale_fence_zero_write.sql
  - infra/db/tests/11_missing_context_zero_write.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - db/**
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
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - specs/catalog/product-scope.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-MEM-001
  - INV-MEM-002
  - INV-TENANT-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals: []
independentReview: required
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0019
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立供应商中立 ContextPlan、结构化人格和 LISTEN/DISCUSS 交互意图。

## 范围内

- ContextPlan 结构、来源标记和预算；
- gentle-listener 人格骨架及 LISTEN/DISCUSS 确定性选择。

## 明确禁止

- 把 Provider session 当作记忆真源；
- 模型输出直接成为 Canonical Memory；
- 在本任务猜测最终真实 Persona 内容。

## 依赖与决策闸门

- 依赖：TASK-0013、TASK-0017；
- 无独立硬决策闸门。

## 验收

- Context 顺序、预算、来源和模式选择可确定性复测；
- 人格结构不包含供应商专属字段。

## 晋级规则

全部依赖 ACCEPTED 且 Backlog 顺序允许时，才创建唯一 DRAFT；具体依赖与精确命令在该时点锁定。
