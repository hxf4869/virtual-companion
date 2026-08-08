# TASK-0098：Generation 终态并发修复（P1-03 + P2-10）

```yaml
taskId: TASK-0098
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  database-migration: "1.0.0"
  harness-change: "1.1.6"
targetSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
baseCommit: d33515946a5666ccc22075f9ae5b6d8b42711a1c
authorizationCommit: 56b6663d4328ee1f7cb3ccca255ba0a79d4879fb
contextFingerprint: b66c6e0aaef193ca39bbb5b49540e70904ed916de3d7cdfb299b811d58e3968e
contextLock: docs/tasks/context/TASK-0098.context-lock.yaml
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
  surfaceId: TASK_0098_GENERATION_FINALIZATION_TERMINAL_CONCURRENCY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 只授权一条精确一次性恢复链：唯一 pre-READY maintenance 边（8 个冻结
    路径）先建立 task0098PostTerminalTail 机器记录并接受 d335159 尾部锚，随后
    同一张卡才能以 baseCommit=d335159 通过普通 READY 门禁并实施 P1-03+P2-10；
    拆分会留下无法通过 base-anchor 校验的半卡。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01
  recordPath: docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_POST_TERMINAL_TAIL_ACCEPTANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - .harness/ci-execution-policy.yaml
    - .harness/skills.yaml
    - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - skills/harness-change/SKILL.md
    - skills/task-delivery-flow/SKILL.md
    - skills/task-intake/SKILL.md
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/catalog/generation-states.yaml
  - specs/catalog/realtime-events.yaml
  - specs/contracts/database-ownership-contract.yaml
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
writeAllowlist:
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0098/**
  - docs/handoffs/TASK-0098.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - skills/database-migration/SKILL.md
  - skills/memory-change/SKILL.md
  - skills/model-routing-change/SKILL.md
  - skills/safety-change/SKILL.md
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/evidence/TASK-0018/**
  - docs/evidence/TASK-0025/**
  - docs/evidence/TASK-0090/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - .harness/agent-entrypoints.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - specs/openapi/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/**
  - service/platform/catalog/**
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/main/java/**
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
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
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/20_resume_resumed_contiguous_cursor.sql
  - infra/db/tests/21_resume_gap_expired_window.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/24_resume_not_found_or_forbidden.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/26_relationship_active_limit_enforced.sql
  - infra/db/tests/27_relationship_unique_index_guard.sql
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
  - frontend/**
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
  - skills/database-migration/SKILL.md
  - specs/catalog/generation-states.yaml
  - specs/catalog/realtime-events.yaml
  - specs/contracts/database-ownership-contract.yaml
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-GEN-003
  - INV-TX-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 按 2026-08-08 审计交接工作包 4 正式分配 P1-03（Generation finalization
      终态并发）+ P2-10（Candidate 插入与终态转换 TOCTOU）合并卡：V7/V10/V15 终态转换
      共享 generation 行锁或条件 UPDATE winner、锁内复查状态、generation 级最终
      assistant message 幂等/唯一约束；两独立 DB session 覆盖 finalize/finalize、
      finalize/cancel、finalize/terminalize，证明唯一获胜、无重复 message/usage/quota/
      event/outbox、终态不可回写。接受在既有迁移文件（V7/V10/V15）上原地修复：本项目
      无任何持久环境执行过迁移（Technical Alpha SYNTHETIC_ONLY/TEMPORARY_VOLUME_ONLY，
      runner 每次全新容器应用全量迁移、无 Flyway checksum 历史）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 批准 TASK-0098 修改 `**/db/migration/**` 保护路径（C4）：V7
      finalize_generation 增加 generation 行锁 + 锁内复查 + 条件 UPDATE winner +
      message 表 generation_id 列与部分唯一索引；V15 insert_generation_candidate
      增加 generation 行锁 + 锁内复查；V10 cancel_generation 经审计确认已持有
      行锁且锁内复查（finalize/cancel 交错缺陷在 finalize 侧修复），预期无代码改动。
      database-migration skill 1.0.0 的"不得修改已执行迁移"约束在本卡不构成阻塞：
      仓库迁移只应用于一次性合成容器，无持久环境、无 Flyway checksum 历史可违反。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: "Owner 于 2026-08-08 按审计交接工作包 4 分配 P1-03+P2-10 并选择一次性维护记录方案（TASK-0073/0074/0075/0076 先例）：授权新增 ci-execution-policy 一次性记录 OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01，机器绑定接受 1696739→d335159（TASK-0097 canonical terminal 后的 project-state nextAction 对齐修复边，仅改 .harness/project-state.yaml，nextAction 与 TASK-0097 handoff 逐字一致）作为 TASK-0098 DRAFT 锚（baseCommit=d335159）；TASK-0098 声明 harness-change 1.1.6→1.1.7、task-delivery-flow 1.3.6→1.3.7、task-intake 1.2.6→1.2.7；维护边只允许 8 个冻结路径、一次性消费、不可复用、禁止历史改写/通用 override；落地后继续 P1-03+P2-10 终态并发修复。"
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0098
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095/0096/0097 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0098 起）。迁移原地修改的授权依据：审计报告 P1-03/P2-10 明确列出 V7/V10/V15 为修复路径，Owner 交接工作包 4 逐字指示修复这些文件。
>
> 本卡含唯一一次性 pre-READY maintenance 边（Owner 于 2026-08-08 选定方案）：`OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01` 机器绑定接受 TASK-0097 终态后的 project-state 对齐修复边 `1696739→d335159` 作为 DRAFT 锚（baseCommit=d335159），并把 harness-change/task-delivery-flow/task-intake 版本提升到 1.1.7/1.3.7/1.2.7；该边只允许 8 个冻结路径（见 `preReadyMaintenancePlan.exactPaths`），一次性消费、不可复用、禁止历史改写。

## 背景与用户可观察目标

审计确认 `finalize_generation`（V7）读取 `generation.status` 与候选时**没有 `FOR UPDATE`**，随后无条件写 selected candidate、插入 assistant message、设置 `COMPLETED`、记录 usage/quota/realtime/outbox。两个事务可以同时看到 `FINAL_REVIEW` 各自完成，产生两条最终 assistant message 与重复 usage/quota/event/outbox；另一个交错是 finalize 读取状态后暂停，cancel（V10）或 terminalize（V15）先提交，finalize 随后又把状态无条件改回 `COMPLETED`，覆盖 `CANCELLED`/`OUTPUT_BLOCKED` 等终态。`insert_generation_candidate`（V15）同样无锁读取 status，可向已终态 generation 插入迟到 candidate（P2-10 TOCTOU）。违反 `INV-GEN-002`（至多一条最终 assistant message）与 `INV-TX-001`（原子提交）。

本卡完成后，用户能观察到：任何并发交错下同一个 generation 恰好只有一个终态转换获胜；最终 assistant message、usage、quota SETTLE、chat.completed event、memory.extract outbox 各恰好一条且原子同事务；`CANCELLED`/`OUTPUT_BLOCKED`/`FAILED_FINAL` 等终态不会被迟到的 finalize 覆盖；终态 generation 无法再插入 candidate。

## 范围内

- **V7 `finalize_generation`（`service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql`）**：
  - 状态读取改为 `SELECT ... FOR UPDATE`（generation 行锁）；锁内复查 `status = 'FINAL_REVIEW'`；并复查 `assistant_message_id IS NULL`（终态幂等守卫，INV-GEN-002）。
  - 终态写入改为**条件 UPDATE winner**：`UPDATE vc.generation SET status='COMPLETED', assistant_message_id=... WHERE owner_user_id=... AND id=... AND status='FINAL_REVIEW'`，`NOT FOUND` 即失败关闭（在行锁下恒真，作为防御纵深）。
  - `vc.message` 增加可空列 `generation_id bigint` + 复合外键 `(owner_user_id, generation_id) REFERENCES vc.generation(owner_user_id, id) ON DELETE SET NULL`（与 `generation.assistant_message_id` 对偶，符合 database-ownership-contract 复合 FK 要求）；新增部分唯一索引 `message_generation_one_final ON vc.message (owner_user_id, generation_id) WHERE generation_id IS NOT NULL AND role = 'assistant'`——DB 级强制"每个 generation 至多一条最终 assistant message"（INV-GEN-002）。
  - finalize 插入 assistant message 时写入 `generation_id`。
  - 函数签名、返回结构、GRANT/REVOKE、`p_fault` 故障注入钩子保持不变（既有测试 16/17 继续有效）。
- **V15 `insert_generation_candidate`（`V15__provider_attempt_terminal_transitions.sql`）**：
  - status 读取改为 `SELECT ... FOR UPDATE`；锁内复查终态集合后插入（P2-10：终态后迟到 candidate 拒绝）。
- **V10 `cancel_generation`（`V10__generation_cancel_message_history.sql`）**：经审计确认已 `FOR UPDATE` + 锁内复查，finalize/cancel 交错缺陷在 finalize 侧修复；本卡预期不改该文件（writeAllowlist 保留授权以防实现中发现必须加固）。
- **新增 4 个双会话并发测试**（`infra/db/tests/44-47`，runner 自动拾取；两独立 DB session 使用 `dblink`——pgvector 镜像 `0.8.5-pg18` 已实测支持 `CREATE EXTENSION dblink`，远程连接以 `SET ROLE vc_api` 模拟两个 API 客户端）：
  - `44_finalize_finalize_concurrent.sql`：两个并发 finalize 同一 FINAL_REVIEW generation，恰好一个获胜。
  - `45_finalize_cancel_concurrent.sql`：finalize 在途（持锁阻塞）时 cancel 在锁内获胜，finalize 随后失败关闭且零残留。
  - `46_finalize_terminalize_concurrent.sql`：finalize 在途时 terminalize 获胜，finalize 失败关闭且零残留。
  - `47_candidate_terminal_toctou.sql`：candidate 插入在途时 terminalize 获胜，迟到 candidate 被拒绝（P2-10）。
- 定向复测既有 SQL 套件（01-43 全部保持 PASS；重点 13/14/16/17/30/41/42/43）。

## 明确范围外

- 不修 P1-04/P1-05（租户上下文与宽泛 DML 权限模型）、P1-06（refresh rotation）、P2-07/08/09/11（realtime 分配器/事件目录/终态事件 seq/chat.cancelled）、P1-10/P2-28（DB CI job 与 readiness 竞态）、P2-29（V1 危险 role 纠正）等其余审计项。
- 不改 `record_provider_attempt`、`record_quota_release`（V15 其余函数）、V8 `append_realtime_event`/`advance_realtime_seq`、V6 幂等接收、Java 代码、`infra/db/run-rls-tests.sh`（自动拾取新测试，无需改动）、`.harness/**`（除 project-state/task-ledger 生命周期字段）、`specs/**` 目录。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。
- 不给任何角色 BYPASSRLS；不改变 `vc_api`/`vc_worker`/`vc_job_coordinator`/`vc_dispatcher` 的 GRANT 集合与 RLS 策略语义。

## 输入和前置条件

- Base Commit 固定为 `d33515946a5666ccc22075f9ae5b6d8b42711a1c`（TASK-0097 canonical terminal commit `1696739` 之后的 post-terminal nextAction 对齐修复边，经 Owner 一次性维护记录 `OWNER-MAINT-20260808-TASK-0098-POST-TERMINAL-TAIL-01` 机器绑定接受为 DRAFT 锚），DRAFT 创建前工作树干净、`activeTask: null`。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- DB 验证在 OrbStack Docker（`pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0`，与 `infra/db/run-rls-tests.sh` 冻结一致）内执行：全新容器应用 V1-V15 全量迁移 + 全部 SQL 测试；dblink 扩展可用性已实测（探针 `CREATE EXTENSION dblink` + `dblink('SELECT 42')` 成功）。
- 本卡触碰 `**/db/migration/**`（C4 保护路径）：使用 `database-migration` skill 1.0.0、Owner 人工批准（humanApprovals 已预填）、独立 Reviewer。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供（`~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀解析）。
- 每次 doctor/precheck 使用干净 `TMPDIR=$(mktemp -d ...)`，避免旧 receipt 命中。

## API / 事件 / 数据契约

- `vc.finalize_generation` 签名与返回结构不变（`(bigint, bigint, bigint, text, text, bigint, bigint, numeric, text, integer, boolean, text)` → `TABLE(out_generation_id, out_assistant_message_id, out_finalized)`）；语义新增：仅持有 generation 行锁且锁内状态仍为 `FINAL_REVIEW`、`assistant_message_id` 为空时才可完成。
- `vc.insert_generation_candidate` 签名与返回不变；语义新增：仅持有 generation 行锁且锁内复查非终态时才插入。
- `vc.cancel_generation`、`vc.terminalize_generation` 签名与语义不变（已持锁 + 锁内复查）。
- `vc.message` 新增可空列 `generation_id`（仅 finalize 写入；user 消息与既有插入路径保持 NULL）+ 复合 FK（ON DELETE SET NULL）+ 部分唯一索引 `message_generation_one_final`。`list_messages`/`MessageRepository`/V6 幂等接收的显式列插入不受影响。
- realtime_event/outbox_event/usage/quota 表结构不变。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据、凭据或外部服务；DB 数据仅为合成 fixture；容器临时（`--rm`、匿名 volume、无 host 端口绑定），与 backlog `testPolicies.database` 一致。
- 所有函数保持 `SECURITY DEFINER SET search_path = vc, public` + `set_config('vc.owner_user_id', ...)` 绑定上下文；不改任何 GRANT/REVOKE/RLS policy；不给任何角色 BYPASSRLS。
- 新增列/索引不改变 `message` 的 FORCE RLS owner_isolation 语义。

## 状态机和失败行为

- 终态转换失败语义：未持有锁时等待锁；获得锁后复查失败（状态非预期、已终态、assistant_message_id 非空）即 `RAISE EXCEPTION` 并整体回滚，**零写入**（message/usage/quota/event/outbox 均不落库）。
- 行锁顺序全局一致（先 generation 后子表/候选行），无死锁新引入路径。
- 并发交错确定性：测试用"主会话持锁 + dblink 会话在途阻塞 + 主会话获胜提交"构造精确交错；finalize/finalize 用双异步发送证明恰好一个获胜。
- 任一 DB 测试失败即保持非零退出并如实记录；remote CI 在 Actions 配额恢复前如实记录非 PASS（TASK-0095/0097 先例），本地等价验证（全新容器全量迁移 + 全部 SQL 套件）为备用通道。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆或 SafetyGate；不引入新依赖、SaaS 或付费运行时。
- 不改变 provider_attempt 审计边界（无凭据/内容列）；memory.extract outbox 事件语义不变。

## 验收标准

1. **finalize/finalize 并发**：两个独立 DB session 同时 finalize 同一 `FINAL_REVIEW` generation，恰好一个返回 `out_finalized=true`，另一个失败关闭；终态 `COMPLETED`；`vc.message` 中 assistant 消息恰好 1 条（内容为获胜者）；`generation_usage` 恰好 1 行；`quota_ledger_entry` 的 `SETTLE` 恰好 1 行；`realtime_event` 的 `chat.completed` 恰好 1 条；`outbox_event` 的 `memory.extract.requested` 恰好 1 条；`generation_candidate` 的 `is_final` 恰好 1 行。
2. **finalize/cancel 交错**：finalize 在途（持锁阻塞）时 cancel 在锁内获胜提交；finalize 随后失败关闭；最终状态 `CANCELLED`；该 generation 零 message/usage/quota/event/outbox 残留；`chat.completed` 计数为 0。
3. **finalize/terminalize 交错**：finalize 在途时 terminalize（`FINAL_REVIEW -> OUTPUT_BLOCKED`/`chat.blocked`）获胜；finalize 失败关闭；最终状态 `OUTPUT_BLOCKED`；`chat.blocked` 恰好 1 条、`chat.completed` 为 0、其余零残留。
4. **P2-10 candidate TOCTOU**：candidate 插入在途（持锁阻塞）时 terminalize 获胜；迟到 candidate 被拒绝；`generation_candidate` 零新增；最终状态为 terminalize 的终态。
5. **终态不可回写**：`COMPLETED`/`CANCELLED`/`OUTPUT_BLOCKED` 之后再次 finalize/terminalize/cancel 均失败（既有测试 30/41/43 保持通过即证明）。
6. **既有套件无回归**：`run-rls-tests.sh` 在全新容器应用 V1-V15 全量迁移后，测试 01-43 全部 PASS（重点 13/14 幂等接收、16/17 原子 finalize 与故障注入、30 cancel、41/42/43 终态/candidate/quota），新增 44-47 全部 PASS（脚本自动拾取，无需改脚本）。
7. **DB 约束可复验**：`pg_get_indexdef('vc.message_generation_one_final')` 存在且语义为"每个 (owner_user_id, generation_id) 至多一条 role='assistant' 且 generation_id 非空的消息"；`vc.message.generation_id` 为可空 bigint 且复合 FK 存在。
8. **交付闭环**：Diff 仅含 writeAllowlist；canonical Precheck 5/5 PASS；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`bash infra/db/run-rls-tests.sh` 是任务特有 DB 门禁（precheck 不含 DB 套件），只运行一次；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/容器与环境身份。

## 回滚或前向修复

- 修复采用最小迁移与测试变更；若 DB 套件在修复后仍有失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 迁移在全新容器内重放，天然可重试；无持久数据、无 Flyway checksum 历史，回滚 = 修正文件后重跑全新容器。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C4；若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 run-rls-tests.sh 结构、其余迁移、Java、specs、`.harness/task-backlog.yaml` 等）时立即停止并询问 Owner。
- dblink 双会话并发测试无法在冻结镜像上确定性执行（如扩展不可用、交错不可复现）时停止并询问 Owner，不得降级为仅串行断言或加 skip。
- 需要触碰 V8 `append_realtime_event`/`advance_realtime_seq`、`record_provider_attempt`/`record_quota_release` 或任何 P1-03/P2-10 范围外功能时停止并报告。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0098/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0098.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、容器/解释器、环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。
