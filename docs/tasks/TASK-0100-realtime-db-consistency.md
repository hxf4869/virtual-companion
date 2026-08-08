# TASK-0100：Realtime DB 一致性（P2-07 + P2-08 + P2-09 + P2-11）

```yaml
taskId: TASK-0100
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
targetSkillVersions: {}
baseCommit: 760743318a1153327373473fd3b7f3decfcae7a2
authorizationCommit: ""
contextFingerprint: e6d7de8572ced41c7fc1154677974ec947b20bfcd840b9f5aea46ef3ff748f8a
contextLock: docs/tasks/context/TASK-0100.context-lock.yaml
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
  surfaceId: TASK_0100_REALTIME_DB_CONSISTENCY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
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
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/TASK-0099-refresh-rotation-single-successor.md
  - skills/database-migration/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - scripts/harness/catalog_tool.py
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/realtime-events.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - infra/db/run-rls-tests.sh
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/20_resume_resumed_contiguous_cursor.sql
  - infra/db/tests/21_resume_gap_expired_window.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/24_resume_not_found_or_forbidden.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/30_generation_cancel.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
writeAllowlist:
  - docs/tasks/TASK-0100-realtime-db-consistency.md
  - docs/tasks/context/TASK-0100.context-lock.yaml
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/49_realtime_seq_concurrent.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0100/**
  - docs/handoffs/TASK-0100.json
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
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/TASK-0025-chat-generation-history-api.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/TASK-0099-refresh-rotation-single-successor.md
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
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
  - specs/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
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
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/apps/**
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
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
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
  - specs/catalog/realtime-events.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/TASK-0099-refresh-rotation-single-successor.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-GEN-003
  - INV-TX-001
  - INV-RT-001
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
      Owner 按 2026-08-08 审计交接工作包 7 分配 Realtime DB 一致性合并卡（P2-07
      Realtime sequence 并发丢更新/唯一键冲突 + P2-08 Durable Realtime 接受任意
      event type + P2-09 终态事件固定 epoch 1/seq 0 + P2-11 Cancel 不原子产生
      chat.cancelled）：V8 append/advance 原子 seq 分配、catalog-backed CHECK +
      窄函数事件类型约束、finalize/terminalize/cancel 终态事务统一走 stream
      allocator 原子分配、cancel 同事务写 durable chat.cancelled；并发/约束/终态
      epoch-seq 测试。工作包 6（P1-04+P1-05+P2-29+风险 9）等待 Owner 决策，
      本卡为决策前可独立推进的下一候选（TASK-0099 nextAction 已注明）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 批准 TASK-0100 修改 `**/db/migration/**` 保护路径（C4）：V7/V8/V10/V15
      原地修复——realtime_event 增加 catalog 事件类型 CHECK、append/advance 原子
      UPDATE RETURNING、新增 append_terminal_event 窄函数（仅 Owner 可执行）、
      finalize/terminalize/cancel 终态事件统一 allocator、cancel 原子写
      chat.cancelled。database-migration skill 1.0.0 的"不得修改已执行迁移"约束
      在本卡不构成阻塞：仓库迁移只应用于一次性合成容器（SYNTHETIC_ONLY/
      TEMPORARY_VOLUME_ONLY，runner 每次全新容器应用全量迁移），无持久环境、无
      Flyway checksum 历史可违反（TASK-0098/0099 先例）。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0100
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095/0096/0097/0098/0099 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0100 起）。迁移原地修改的授权依据：审计报告 P2-07/08/09/11 明确列出 V8/V7/V10/V15 为修复路径，Owner 交接工作包 7 逐字指示修复这些文件；specs/catalog/realtime-events.yaml 本卡不改（CHECK 约束静态镜像其 durable 子集，precheck catalogDrift 保持 PASS）。

## 背景与用户可观察目标

审计确认 Realtime 持久化存在四个缺陷：

1. **P2-07**：`append_realtime_event` 与 `advance_realtime_seq`（V8:223-285）都先读 `next_seq` 再写，没有锁或原子 UPDATE。并发 append 会拿到相同 sequence 使一方唯一键失败；并发 advance 可能只增加一次（丢更新）。
2. **P2-08**：append 只检查 event type 非空，表没有 catalog-backed CHECK。调用者可在非终态 generation 写 `chat.completed`，或持久化 `foo`、`chat.delta` 等不允许的事件（realtime-events.yaml 中 durable: false 的事件不应落库；终态事件只能由对应终态事务产生）。
3. **P2-09**：finalize/terminalize 插入事件时省略 `stream_epoch/event_seq` 使用默认 `1/0`，不更新 stream high-water。已有 events 或 reset 后，终态事件拥有错误 epoch/sequence，resume 顺序与 gap 判断不可信。
4. **P2-11**：cancel 只更新状态，没有写 durable `chat.cancelled`。客户端只能依赖 snapshot，无法按 Realtime contract 收到终态事件。

本卡完成后，用户能观察到：并发 append/advance 的 event_seq 严格唯一递增、无丢更新、无唯一键冲突；`realtime_event` 只接受 catalog durable 事件类型（`foo`/`chat.delta`/终态类型错位一律失败关闭）；finalize/terminalize/cancel 的终态事件在**同一事务**内从统一 allocator 原子分配真实 epoch/seq 并推进 stream high-water（已有事件与 reset 后的顺序、resume 与 gap 判断正确）；取消后的 generation 通过 resume/snapshot 可收到 durable `chat.cancelled`。

## 范围内

- **V8 `realtime_resume_ticket_gap_reset_snapshot`**：
  - `vc.realtime_event` 增加 catalog-backed CHECK `realtime_event_type_catalog`：`event_type` 必须是 `specs/catalog/realtime-events.yaml` 中 `durable: true` 的 9 个 code（chat.accepted/completed/cancelled/blocked/failed、safety.notice、service.mode.changed、memory.candidate.created、memory.candidate.confirmation_required）——非 durable（chat.delta/chat.replace/stream.*）与任意字符串（foo）无法落库。
  - `append_realtime_event`（P2-07+P2-08 窄函数）：事件类型校验改为**拒绝非 durable 与终态类型**（终态事件只能由终态事务产生）；seq 分配改为单条原子 `UPDATE vc.realtime_stream SET next_seq = next_seq + 1, updated_at = now() WHERE ... AND stream_epoch = p_stream_epoch RETURNING next_seq`（行锁 + epoch 谓词同时关闭并发丢更新与 reset 竞态，NOT FOUND 失败关闭）；移除读后写窗口。
  - `advance_realtime_seq`（P2-07）：改为原子 `UPDATE ... SET next_seq = next_seq + p_count RETURNING next_seq`。
  - 新增 `vc.append_terminal_event(owner, gen, event_type, payload)` 窄函数：只接受终态类型（chat.completed/cancelled/blocked/failed），ensure stream + 原子 seq 分配 + 以当前 stream epoch 插入 PENDING 事件；`REVOKE EXECUTE FROM PUBLIC` 且**不 GRANT 给 vc_api**（只有 SECURITY DEFINER 终态函数可调用——终态事件只能由对应终态事务产生）。
- **V7 `finalize_generation`（P2-09）**：内联 realtime_event INSERT 替换为 `vc.append_terminal_event(..., 'chat.completed', payload)`（status UPDATE winner 之后调用，同事务原子分配真实 epoch/seq）。
- **V15 `terminalize_generation`（P2-09）**：内联 INSERT 替换为 `vc.append_terminal_event(..., p_event_type, COALESCE(p_payload,'{}'::jsonb))`；删除不再使用的 v_row_id 局部变量。
- **V10 `cancel_generation`（P2-11）**：状态双跳更新后同事务 `vc.append_terminal_event(..., 'chat.cancelled', jsonb_build_object('generation_id', p_generation_id))`——durable 终态事件 + 原子 sequence + stream high-water。
- **测试**：
  - 新增 `49_realtime_seq_concurrent.sql`（P2-07）：dblink 双会话并发 append 同一 generation——两者都成功、event_seq 严格唯一（1/2）、2 条事件落库、stream next_seq=3；并发 advance（各 +2）——next_seq 总共 +4 无丢更新。
  - 新增 `50_realtime_event_catalog.sql`（P2-08/09/11）：append `foo`/`chat.delta`/`chat.completed`（非终态 generation）均失败关闭；直接 INSERT `foo`/`chat.delta` 触发 CHECK；cancel 同事务写 PENDING chat.cancelled（真实 epoch/seq、next_seq 推进、重复 cancel 失败且不写第二条事件）；finalize/terminalize 事件 epoch/seq 正确；reset 后终态事件落入新 epoch 且 resume 顺序正确。
  - 更新 `23_resume_terminal_snapshot.sql`（P2-09）：头部注释与断言改为 allocator 语义（chat.completed 获得真实 eventSeq=2，不再默认 0），并断言 stream next_seq 推进。
  - 更新 `42_terminal_event_atomic.sql`（P2-08/09）：追加断言 terminalize 事件 epoch=1/seq=1 且 next_seq 推进、append 非 durable/终态类型拒绝。
  - 更新 `45_finalize_cancel_concurrent.sql`（P2-11）：cancel 获胜方现在写 1 条 durable chat.cancelled（原断言"零 realtime 事件"改为"恰好 1 条 chat.cancelled、0 条 chat.completed"）。
- 既有套件无回归：01-48 全部保持 PASS（重点 16/17 原子 finalize/故障注入、20-25 resume 套件、30 cancel、41/42 终态、44/46 并发计数断言）。

## 明确范围外

- 不修 P1-04/P1-05/P2-29/条件风险 9（租户与 DB 权限架构，等待 Owner 决策）、P1-07/08/09（前端）、P2-13（admin seed）、P2-12（JDBC snapshot store）、P1-10/P2-28（DB CI job 与 readiness 竞态）、P3-05/06 等其余审计项。
- 不改 `specs/catalog/realtime-events.yaml`、`specs/contracts/**`、`scripts/harness/catalog_tool.py`、生成物 `specs/generated/**`（CHECK 约束静态镜像 durable 子集；catalogDrift gate 保持 PASS）。
- 不改 GRANT/REVOKE/RLS 既有语义（append_terminal_event 的"仅 Owner 可执行"是新增窄函数的新授权边界，不改变既有函数授权）；不给任何角色 BYPASSRLS。
- 不改 Java 代码、`RealtimeEventRepository`/`RealtimeEventRecord`、run-rls-tests.sh、`.harness/**`（除 project-state/task-ledger 生命周期字段）。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。

## 输入和前置条件

- Base Commit 固定为 `760743318a1153327373473fd3b7f3decfcae7a2`（TASK-0099 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0100 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- DB 验证在 OrbStack Docker（`pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0`，与 `infra/db/run-rls-tests.sh` 冻结一致）内执行：全新容器应用 V1-V15 全量迁移 + 全部 SQL 测试（01-50）；dblink 扩展可用性已由 TASK-0098 44-48 实测。
- 本卡触碰 `**/db/migration/**`（C4 保护路径）：使用 `database-migration` skill 1.0.0、Owner 人工批准（humanApprovals 已预填）、独立 Reviewer。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供（`~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀解析）。
- 每次 doctor/precheck 使用干净 `TMPDIR=$(mktemp -d ...)`，避免旧 receipt 命中。

## API / 事件 / 数据契约

- `vc.append_realtime_event` 签名不变（`(bigint, bigint, bigint, text, jsonb)` → bigint）；语义：仅接受 catalog durable 且非终态的事件类型；event_seq 由原子 UPDATE 分配（严格递增、无丢更新）；epoch 不匹配（含 reset 竞态）失败关闭。
- `vc.advance_realtime_seq` 签名不变；语义：原子 `next_seq + p_count`。
- 新增 `vc.append_terminal_event(bigint, bigint, text, jsonb)` → bigint：仅终态类型、仅 SECURITY DEFINER 终态函数可执行（REVOKE PUBLIC，不 GRANT vc_api）。
- `vc.finalize_generation`/`vc.terminalize_generation`/`vc.cancel_generation` 签名与返回结构不变；语义新增：终态 realtime_event 在同一事务内经统一 allocator 获得真实 stream_epoch/event_seq，stream high-water 同步推进。
- `vc.realtime_event` 新增 CHECK `realtime_event_type_catalog`（9 个 durable code）；`resume_stream`/`read_generation_snapshot` 返回内容不变（终态事件现在携带真实 epoch/seq 且包含 chat.cancelled）。
- 无 OpenAPI/Java/前端契约变更。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据、凭据或外部服务；DB 数据仅为合成 fixture；容器临时（`--rm`、匿名 volume、无 host 端口绑定），与 backlog `testPolicies.database` 一致。
- 所有既有函数保持 `SECURITY DEFINER SET search_path = vc, public` + `set_config('vc.owner_user_id', ...)` 绑定上下文；不改任何既有 GRANT/REVOKE/RLS policy；不给任何角色 BYPASSRLS。
- 新增 `append_terminal_event`：SECURITY DEFINER、REVOKE PUBLIC、不 GRANT——只有同为 SECURITY DEFINER 的终态函数（以迁移 Owner 身份执行）能调用，vc_api 不能直接制造终态事件。
- 锁顺序保持全局一致：generation 行锁先于 stream 行锁（finalize/terminalize/cancel 持 generation 锁后调用 allocator），无新死锁路径。

## 状态机和失败行为

- 并发 append：两会话原子 UPDATE 串行化于 stream 行锁，各自拿到唯一递增 seq；失败仅可能是 epoch 不匹配（NOT FOUND → raise，整体回滚）。
- 并发 advance：`next_seq + p_count` 原子累加，无丢更新。
- 事件类型失败：append 收到非 durable（chat.delta/chat.replace/stream.*/foo）或终态类型（chat.completed/cancelled/blocked/failed）→ raise 失败关闭；直接 INSERT 非 durable 类型 → CHECK 约束失败；append_terminal_event 收到非终态类型 → raise。
- 终态事务：finalize/terminalize/cancel 在持 generation 行锁的同一事务内分配 seq、写 PENDING 终态事件、推进 high-water——任一失败整体回滚（INV-TX-001）；重复/并发 cancel 仍幂等唯一（TASK-0098 45 语义保持，且不产生第二条 chat.cancelled）。
- reset 竞态：append 的原子 UPDATE 带 `stream_epoch = p_stream_epoch` 谓词，reset 提交后旧 epoch append 匹配零行 → 失败关闭（不写错 epoch 事件）。
- 任一 DB 测试失败即保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095/0097/0098/0099 先例），本地等价验证（全新容器全量迁移 + 全部 SQL 套件）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆或 SafetyGate；不引入新依赖、SaaS 或付费运行时。
- 事件 payload 不含凭据/敏感数据（与既有 chat.completed 载荷一致，仅 generation_id/assistant_message_id/reason 等结构性字段）。

## 验收标准

1. **P2-07 并发唯一递增**：两独立 DB session 并发 append 同一 generation，双方都成功且 event_seq 严格唯一（{1,2}），2 条事件落库，stream next_seq=3；两会话并发 advance（各 +2）后 next_seq 较起点 +4（无丢更新、无唯一键冲突）。
2. **P2-08 catalog 约束**：`realtime_event_type_catalog` CHECK 存在且覆盖 realtime-events.yaml 的 9 个 durable code；append `foo`/`chat.delta`/`chat.completed`（非终态 generation）全部失败关闭；直接 INSERT `foo`/`chat.delta` 触发 CHECK 失败；append_terminal_event 只接受终态类型且 vc_api 无 EXECUTE。
3. **P2-09 终态事件真实 epoch/seq**：finalize 的 chat.completed 与 terminalize 的 chat.failed/chat.blocked 在同一事务内获得真实 event_seq（已有事件后为 next_seq 原值，非 0）与正确 stream_epoch；stream next_seq 同步推进；reset 后终态事件落入新 epoch 且 resume 顺序/TERMINAL_SNAPSHOT 正确（更新 23/42 断言）。
4. **P2-11 cancel 原子 chat.cancelled**：cancel 同事务写恰好 1 条 PENDING `chat.cancelled`（真实 epoch/seq），status=CANCELLED；重复 cancel 失败且不产生第二条事件；finalize/cancel 并发（45）中 cancel 获胜方留下 1 条 chat.cancelled、0 条 chat.completed。
5. **既有套件无回归**：`run-rls-tests.sh` 在全新容器应用 V1-V15 全量迁移后 01-48 全部 PASS（重点 16/17/20-25/30/41/42/44/46），新增 49/50 全部 PASS（脚本自动拾取）。
6. **catalogDrift 保持 PASS**：`specs/catalog/realtime-events.yaml` 与生成物未改，precheck 内 catalogValidate/catalogDrift 通过。
7. **交付闭环**：Diff 仅含 writeAllowlist；canonical Precheck 全 PASS；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`bash infra/db/run-rls-tests.sh` 是任务特有 DB 门禁（precheck 不含 DB 套件），只运行一次；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/容器与环境身份。

## 回滚或前向修复

- 修复采用最小迁移与测试变更；若 DB 套件在修复后仍有失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 迁移在全新容器内重放，天然可重试；无持久数据、无 Flyway checksum 历史，回滚 = 修正文件后重跑全新容器。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C4；若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 run-rls-tests.sh 结构、其余迁移、Java、specs/catalog、catalog_tool.py、`.harness/task-backlog.yaml` 等）时立即停止并询问 Owner。
- dblink 双会话并发测试无法在冻结镜像上确定性执行（如扩展不可用、交错不可复现）时停止并询问 Owner，不得降级为仅串行断言或加 skip。
- 需要触碰 `record_provider_attempt`/`record_quota_release`、identity（V14）、memory（V11-V13）、cookie/CSRF 方案（P1-09）或任何 P2-07/08/09/11 范围外功能时停止并报告。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0100/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0100.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、容器/解释器、环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。
