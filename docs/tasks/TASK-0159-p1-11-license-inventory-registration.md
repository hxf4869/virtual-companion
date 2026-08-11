# TASK-0159：P1-11 license gate 补登记（TASK-0155 replacement）

```yaml
taskId: TASK-0159
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
targetSkillVersions: {}
baseCommit: b748daf162527e129969d00a217ed05fb264a537
authorizationCommit: "58bf69d04244ed3cd67888740b4363a5ae1cd6a8"
contextFingerprint: 84c08c8fa209b9984cc21325d91f97803f405a78f9dc5b7a12b7d6d76f0146e9
contextLock: docs/tasks/context/TASK-0159.context-lock.yaml
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
  surfaceId: TASK_0159_P1_11_LICENSE_INVENTORY_REGISTRATION
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 30
  estimatedWallMinutes: 70
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0159
  - python scripts/harness/tests/test_harness.py
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0155/evidence-pack.json
  - docs/evidence/TASK-0155/review-r1.md
  - docs/handoffs/TASK-0155.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0155-p1-11-migrator-runtime-separation-and-schema-readiness.md
  - docs/tasks/task-card-template.md
  - infra/db/tests/56_runtime_role_cannot_migrate.sql
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - scripts/harness/check_licenses.py
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandler.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/ProductionProfileFailClosedTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthExceptionHandlerTest.java
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0159-p1-11-license-inventory-registration.md
  - docs/tasks/context/TASK-0159.context-lock.yaml
  - .harness/license-inventory.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0159/**
  - docs/handoffs/TASK-0159.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/TASK-0141-*
  - docs/tasks/TASK-0142-*
  - docs/tasks/TASK-0143-*
  - docs/tasks/TASK-0144-*
  - docs/tasks/TASK-0145-*
  - docs/tasks/TASK-0146-*
  - docs/tasks/TASK-0147-*
  - docs/tasks/TASK-0148-*
  - docs/tasks/TASK-0149-*
  - docs/tasks/TASK-0150-*
  - docs/tasks/TASK-0151-*
  - docs/tasks/TASK-0152-*
  - docs/tasks/TASK-0153-*
  - docs/tasks/TASK-0154-*
  - docs/tasks/TASK-0155-*
  - docs/tasks/TASK-0156-*
  - docs/tasks/TASK-0157-*
  - docs/tasks/TASK-0158-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - docs/tasks/context/TASK-0145.context-lock.yaml
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - docs/tasks/context/TASK-0148.context-lock.yaml
  - docs/tasks/context/TASK-0149.context-lock.yaml
  - docs/tasks/context/TASK-0150.context-lock.yaml
  - docs/tasks/context/TASK-0151.context-lock.yaml
  - docs/tasks/context/TASK-0152.context-lock.yaml
  - docs/tasks/context/TASK-0153.context-lock.yaml
  - docs/tasks/context/TASK-0154.context-lock.yaml
  - docs/tasks/context/TASK-0155.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/evidence/TASK-0142/**
  - docs/evidence/TASK-0143/**
  - docs/evidence/TASK-0144/**
  - docs/evidence/TASK-0145/**
  - docs/evidence/TASK-0146/**
  - docs/evidence/TASK-0147/**
  - docs/evidence/TASK-0148/**
  - docs/evidence/TASK-0149/**
  - docs/evidence/TASK-0150/**
  - docs/evidence/TASK-0151/**
  - docs/evidence/TASK-0152/**
  - docs/evidence/TASK-0153/**
  - docs/evidence/TASK-0154/**
  - docs/evidence/TASK-0155/**
  - docs/evidence/TASK-0156/**
  - docs/evidence/TASK-0157/**
  - docs/evidence/TASK-0158/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/handoffs/TASK-0142.json
  - docs/handoffs/TASK-0143.json
  - docs/handoffs/TASK-0144.json
  - docs/handoffs/TASK-0145.json
  - docs/handoffs/TASK-0146.json
  - docs/handoffs/TASK-0147.json
  - docs/handoffs/TASK-0148.json
  - docs/handoffs/TASK-0149.json
  - docs/handoffs/TASK-0150.json
  - docs/handoffs/TASK-0151.json
  - docs/handoffs/TASK-0152.json
  - docs/handoffs/TASK-0153.json
  - docs/handoffs/TASK-0154.json
  - docs/handoffs/TASK-0155.json
  - docs/handoffs/TASK-0156.json
  - docs/handoffs/TASK-0157.json
  - docs/handoffs/TASK-0158.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
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
  - scripts/harness/**
  - .github/workflows/**
  - specs/**
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/**
  - frontend/**
  - service/platform/persistence/src/main/resources/db/migration/**
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
  - infra/db/tests/11_zero_write_on_missing_context.sql
  - infra/db/tests/12_coordinator_reads_only_metadata.sql
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/14_idempotent_receive_no_duplicate_message.sql
  - infra/db/tests/15_cross_owner_generation_reference_denied.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/20_resume_resumed_contiguous_cursor.sql
  - infra/db/tests/21_resume_gap_expired_window.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/24_resume_not_found_or_forbidden.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/26_relationship_active_limit_enforced.sql
  - infra/db/tests/27_relationship_unique_active_companion.sql
  - infra/db/tests/28_relationship_not_found_or_forbidden.sql
  - infra/db/tests/29_relationship_lifecycle_activate_deactivate.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/31_message_history_pagination.sql
  - infra/db/tests/32_memory_confirmation_path_only.sql
  - infra/db/tests/33_memory_cross_isolation_fail_closed.sql
  - infra/db/tests/34_memory_lifecycle_evidence_scope.sql
  - infra/db/tests/35_memory_edit_evidence.sql
  - infra/db/tests/36_memory_idempotency.sql
  - infra/db/tests/37_memory_recall_scope_budget.sql
  - infra/db/tests/38_memory_recall_tombstone_determinism.sql
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - infra/db/tests/49_realtime_seq_concurrent.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
  - infra/db/tests/53_role_attributes_fail_closed.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - infra/db/tests/56_runtime_role_cannot_migrate.sql
  - .mvn/**
  - pom.xml
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
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0155.json
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
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 决议 TASK-0155（P1-11 migrator/runtime 分离 + 503 readiness）因 license gate
      流程性遗漏（spring-boot-starter-flyway 未登记 license-inventory.yaml）如实 REJECTED 后，授权本
      replacement 卡 TASK-0159 以 TASK-0155 REJECTED terminal（b748daf）为 Base 承接相同已全绿实现：
      登记新 Maven 直接依赖 spring-boot-starter-flyway (Apache-2.0) 到 .harness/license-inventory.yaml，
      重跑 canonical precheck（licenseCheck PASS）+ 完整 Harness unittest（C4 protected 内容变更）+
      独立 R1 复核（C4 必须）+ Evidence/Handoff/pre-closure/单父 [skip ci] 终态/push/远端 0/0。本卡
      不重复 TASK-0155 的实现（pom/yaml/Java/SQL 已在 Base，24 单测/RLS 56/56/Maven verify BUILD
      SUCCESS/e2e 全绿证据保留在 TASK-0155 evidence），只补登记依赖 + 跑门禁；工程细节按长线授权
      决定并如实记录；禁止历史改写与伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 授权本卡触碰 C4 protected path .harness/license-inventory.yaml（.harness/** →
      harness-change 1.1.7 + humanApproval + 独立 Reviewer）。改动为最小数据行追加：在 mavenDirectDependencies
      增 spring-boot-starter-flyway (Apache-2.0)，与既有 spring-boot-starter-* 与 flyway-core 同族；不改
      check_licenses.py 逻辑、license-policy.yaml allowlist（Apache-2.0 已允许）、ci.yml 或任何其他治理
      文件；不放宽 license 策略或新增例外。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers:
  - id: task0159_r1
    kind: independent-review-gate
    verdict: null
    reviewedCommit: null
    candidateTree: null
    evidencePath: docs/evidence/TASK-0159/review-r1.md
    reason: ""
terminalStateReason: ""
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 TASK-0155（P1-11）
> 的 replacement 卡：TASK-0155 实现已全绿但 canonical precheck licenseCheck 阻塞（新依赖未登记
> license-inventory），经 Owner 决议 REJECTED 后由本卡承接相同实现并补登记依赖。

## 背景与用户可观察目标

TASK-0155（P1-11 migrator/runtime 分离 + 503 readiness）实现已全部通过验证（24 单测、RLS 56/56、
根级 Maven verify BUILD SUCCESS、手动 e2e 空库 503/迁移 UP 全绿），但 R1 独立复核发现唯一 canonical
precheck 阻塞（P0）：`service/apps/runtime/pom.xml` 新增的 `org.springframework.boot:spring-boot-starter-flyway`
未登记在 `.harness/license-inventory.yaml` → licenseCheck FAIL。该文件为 forbiddenPath + C4 protected，
TASK-0155 候选身份无法自修；amendment 机制亦无法授权（doctor 硬校验 addedWriteAllowlist 与 forbiddenPaths
零冲突，且 READY 后 forbiddenPaths 不可改）。Owner 2026-08-12 决议：TASK-0155 如实 REJECTED，本卡
TASK-0159 以 REJECTED terminal（b748daf）为 Base 承接相同实现，仅补登记依赖后重跑全部门禁。

用户可观察结果：spring-boot-starter-flyway（Apache-2.0，与既有 spring-boot-starter-* 与 flyway-core
同族）登记入 license-inventory.yaml mavenDirectDependencies；canonical precheck licenseCheck PASS
（8/8）；完整 Harness unittest PASS（license 测试读真实 inventory 验证登记正确）；TASK-0155 实现的
P1-11 行为（migrator/runtime 分离 + schema readiness gate + 缺 schema → 503）随 Base 进入主分支并
随本卡 ACCEPTED 正式落地。

## 范围内

1. `.harness/license-inventory.yaml`：在 `mavenDirectDependencies` 的 Spring Boot starters 段追加一行
   `- groupId: org.springframework.boot / artifactId: spring-boot-starter-flyway / licenseFamily: Apache-2.0`
   （与 spring-boot-starter-actuator/jdbc/security/test/validation/webmvc 同族同格式）。不改其他段、
   不改 license-policy.yaml allowlist（Apache-2.0 已允许）、不改 check_licenses.py、不改 ci.yml。
2. 终态治理闭环：canonical precheck（licenseCheck PASS）+ 完整 Harness unittest + 独立 R1 + Evidence/
   Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不重复 TASK-0155 的任何实现（pom/yaml/Java/SQL 已在 Base b748daf，本卡 writeAllowlist 不含它们；
  service/apps/** 全部 forbidden）。
- 不改 license 策略、allowlist、例外、到期、check_licenses.py 逻辑或 ci.yml。
- 不动其他 .harness/* 治理文件（除 project-state/task-ledger 终态更新）。
- 不处理 P2-03/P2-27/RISK-09（后续 TASK-0156/0157/0158）。

## 输入和前置条件

- Base `b748daf162527e129969d00a217ed05fb264a537` = TASK-0155 REJECTED terminal（已 push、0/0、clean；
  pre-closure Doctor PASS 883734 checks）。Base tree 已含 TASK-0155 全部实现（pom.xml starter-flyway、
  application.yaml flyway 块、AuthDataSourceConfig、SchemaReadinessHealthIndicator、AuthExceptionHandler、
  3 测试类、test 56）。
- 本卡 context lock 45 输入钉在 Base；provenance 条目 owner-authorization://longline-2026-08-09
  provenanceOnly（沿用 hash cc0f91c1…）。
- 受控 Python：PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH。
- 关键事实（已核实）：scripts/harness/tests/test_harness.py 不硬编码 inventory 数量
  （test_license_check_passes_on_current_inventory 读真实文件并运行 check_licenses.py）→ 加一行
  starter-flyway 不破坏 harness unittest；canonical precheck licenseCheck 子命令即功能验证。

## 权限、RLS 和数据处理要求

不涉及数据库/RLS/用户数据。license-inventory 为治理元数据；Apache-2.0 已在 license-policy allowlist。

## 状态机和失败行为

- 实现 = 单行数据追加；licenseCheck 扫描 runtime pom 的 starter-flyway 现在命中 inventory → PASS。
- 完整 Harness unittest PASS（license 测试 + 全部 doctor/fingerprint/catalog 等 261+ tests 无回归）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 90min → closure-only overrun。

## 验收标准

1. `.harness/license-inventory.yaml` mavenDirectDependencies 含
   `org.springframework.boot:spring-boot-starter-flyway / Apache-2.0`，格式与既有 starter 一致。
2. 唯一 canonical precheck 8/8 PASS（licenseCheck PASS）。
3. 完整 Harness unittest PASS（261+ tests，含 test_license_check_passes_on_current_inventory）。
4. 唯一无参数 `git diff --check` PASS（输出空）。
5. R1 独立复核 PASS（C4 必须；0 P0/P1/P2）。
6. 终态 pre-closure PASS、单父 [skip ci] 提交、push 后 HEAD==origin/main、0/0、clean；remote exact-SHA
   如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
7. TASK-0155 实现的 P1-11 行为保持（Base 已含，本卡不改）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 只跑一次；完整 Harness unittest 一次；
同一条无参数 `git diff --check` 只执行一次）。

## 回滚或前向修复

若 R1 发现阻塞：最多 1 fix batch → R2；否则如实 REJECTED 并以新卡承接（本卡已是 replacement，再
replacement 需 Owner 授权）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（含 service/apps/**、其他 .harness/* 治理文件）。
- 正式 Precheck / Harness unittest / diff check / pre-closure 任一非 PASS。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0159/`（evidence-pack.json、review-r1.md、pre-closure-request.json），
并生成 `docs/handoffs/TASK-0159.json`。
