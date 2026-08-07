# TASK-0090：生成终态持久化与审计落库（SQL/持久化侧）

```yaml
taskId: TASK-0090
state: READY
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
baseCommit: fd3b6f37c3dafc62b825d3c6cc4b23f13c098070
authorizationCommit: "a01932b5802f7459091bf04c373e05efaec8e5ea"
contextFingerprint: 89c380043ff3fbc8dc2fc9fba905796521949f16c18cc5c781dee31266546ba4
contextLock: docs/tasks/context/TASK-0090.context-lock.yaml
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
  surfaceId: TASK_0090_GENERATION_TERMINAL_PERSISTENCE
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
  - pom.xml
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - specs/catalog/generation-states.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/generated/java/com/virtualcompanion/catalog/ProviderAttemptStatus.java
  - specs/generated/java/com/virtualcompanion/catalog/GenerationState.java
  - specs/generated/java/com/virtualcompanion/catalog/RealtimeEventType.java
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
  - infra/db/run-rls-tests.sh
  - infra/db/tests/13_idempotent_receive_same_generation_id.sql
  - infra/db/tests/16_atomic_finalize_commits_all.sql
  - infra/db/tests/17_fault_injection_rolls_back_all.sql
  - infra/db/tests/18_provider_eos_cannot_complete.sql
  - infra/db/tests/19_realtime_ticket_single_use_ttl_hash.sql
  - infra/db/tests/22_resume_reset_required_epoch.sql
  - infra/db/tests/23_resume_terminal_snapshot.sql
  - infra/db/tests/25_realtime_event_rls_owner_isolation.sql
  - infra/db/tests/30_generation_cancel.sql
  - docs/tasks/TASK-0018-finalization-usage-quota-outbox.md
  - docs/tasks/TASK-0021-fetch-sse-resume-gap-reset-snapshot.md
  - docs/tasks/TASK-0032-zero-llm-quota-failure-recovery.md
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/evidence/TASK-0035/evidence-pack.json
  - docs/evidence/TASK-0035/review-r1.md
  - docs/evidence/TASK-0035/review-r2.md
  - docs/handoffs/TASK-0035.json
  - docs/handoffs/TASK-0032.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/ProviderAttemptAudit.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/OwnershipTuple.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptOutcome.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/LiveAttemptTerminal.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
writeAllowlist:
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/context/TASK-0090.context-lock.yaml
  - docs/evidence/TASK-0090/**
  - docs/handoffs/TASK-0090.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - infra/db/tests/**
  - docs/planning/continuation-handover-20260808.md
  - docs/planning/TASK-0090-outbound-lifecycle-wiring.md
  - docs/planning/TASK-0091-provider-deployment-persistence.md
  - docs/planning/TASK-0092-h5-auth-transport-completion.md
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/harness/**
  - scripts/dev/**
  - skills/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - docs/source/**
  - docs/decisions/**
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
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - specs/openapi/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/**
  - service/platform/catalog/**
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
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - infra/db/run-rls-tests.sh
  - frontend/**
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
  - specs/contracts/database-ownership-contract.yaml
  - scripts/harness/doctor.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/planning/TASK-0090-outbound-lifecycle-wiring.md
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-COST-001
  - INV-GEN-003
  - INV-TX-001
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: continuation-handover-20260808
    evidence: >-
      Owner 批准 TASK-0090（延续单卡，SQL/持久化侧）新建 V15 迁移：provider_attempt
      审计表（复合所有权 + FORCE RLS，无凭据/内容列，status 对齐 ProviderAttemptStatus
      枚举）与 SECURITY DEFINER 落库/终态函数（record_provider_attempt、
      terminalize_generation 终态转移 + 终态 realtime_event 原子写、insert_generation_candidate、
      record_quota_release），仅授 vc_api；不改 V1-V14、不改既有角色/RLS 语义、不触碰
      Runtime 上下文无 DB 约束。范围外：Java 运行时编排（TASK-0093）、Beta、公开注册、真实支付。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0090
  - bash infra/db/run-rls-tests.sh
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine mvn -o -pl service/apps/runtime -am test
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0080-0088 先例），不写 planningBacklog/planningContractHash；与 TASK-0093（运行时编排侧）由 Owner 于 2026-08-08 拆分自原 TASK-0090 设计文档。baseCommit 取 TASK-0036 terminal boundary（fd3b6f3），docs/planning 设计文档提交（99ae379/ce55619）为任务历史内输入（见 writeAllowlist）。

## 背景与用户可观察目标

TASK-0035 的 LiveModelInvoker 已能产出 `LiveAttemptOutcome`（含 ProviderAttemptAudit/TokenUsage/realtimeEventType），但无生产调用入口，且 `provider_attempt` 表不存在、终态 SQL 转移缺失。本卡交付 SQL/持久化侧底座：真实外发审计（provider_attempt）、终态转移与终态实时事件原子落库（INV-TX-001）、finalize 前置的 candidate 落库、失败路径 quota RELEASE 行——供 TASK-0093 运行时编排侧消费，形成可运行的端到端闭环。

## 范围内

- 新建 `V15__provider_attempt_terminal_transitions.sql`：
  - `vc.provider_attempt` 表：复合主键 `(owner_user_id, id)`、`generation_id` 复合 FK、`provider_id`、`supplier_name`、`status`（CHECK 对齐 `ProviderAttemptStatus` 枚举 11 值）、`created_at`；FORCE RLS + owner_isolation；**无凭据/请求体/响应文本列**。
  - SECURITY DEFINER 函数（统一 `SET search_path=vc,public` + `set_config('vc.owner_user_id',...)` + REVOKE PUBLIC + GRANT EXECUTE TO vc_api，对齐 V6-V10 模式）：
    - `record_provider_attempt`：按 `ProviderAttemptAudit` 字段落库一条审计行。
    - `terminalize_generation`：把可终态化的非终态 generation 原子推进到 `FAILED_FINAL` / `OUTPUT_BLOCKED` / `COMPLETED_FALLBACK`（FOR UPDATE 锁行；校验 catalog 合法 from 状态；终态 generation 拒绝再推进），同一事务原子写对应终态 realtime_event（chat.failed / chat.blocked / chat.completed 语义，事件类型与终态一致，INV-TX-001）。CANCELLED 双跳保持走 V10 `cancel_generation`，本函数不接受 CANCELLED。
    - `insert_generation_candidate`：finalize 前置的 candidate 落库（返回 candidate id，遵守 `generation_candidate_one_final` 部分唯一约束，INV-GEN-002）。
    - `record_quota_release`：失败/降级路径落 `quota_ledger_entry` RELEASE 行（kind CHECK 既有）。
- 新增 RLS 测试（`infra/db/tests/` 下 40-43 号段，run-rls-tests.sh 自动拾取）：provider_attempt 落库与跨租户拒绝、终态转移合法/非法、终态 realtime_event 原子性与终态拒绝 append、candidate 落库 + quota RELEASE 行。

## 明确范围外

- Java 运行时编排（controller/service/终态映射/realtime HTTP 端点）→ TASK-0093。
- 修改 V1-V14 任意迁移、角色、RLS 策略与既有函数语义。
- modelruntime/runtime/adapters/frontend 任何代码。
- Beta、公开注册、真实支付与 Technical Alpha 之外能力。

## 输入和前置条件

- baseCommit = fd3b6f3（TASK-0036 terminal boundary；docs/planning 设计提交在其后为任务历史输入）。Context Lock 绑定 readAllowlist 在 baseCommit 的 SHA-256。
- 依赖：TASK-0035（ProviderAttemptAudit/审计链）、TASK-0032（QuotaLedger/GenerationRecovery 语义）、TASK-0018（finalize/SETTLE/outbox）、TASK-0021（V8 realtime）、TASK-0025（V10 cancel）。全部 ACCEPTED。
- 模式参照：V2（复合所有权/FORCE RLS）、V6（receive_generation）、V7（finalize_generation 原子结算）、V8（append/reissue/resume）、V10（cancel 双跳）与 `infra/db/tests/16-25/30` 测试写法。

## API / 事件 / 数据契约

- 函数签名（TASK-0093 消费侧契约）：`record_provider_attempt(p_owner bigint, p_generation bigint, p_provider_id text, p_supplier_name text, p_status text) RETURNS TABLE(out_id bigint, out_owner bigint)`；`terminalize_generation(p_owner bigint, p_generation bigint, p_to_status text, p_event_type text, p_payload jsonb DEFAULT '{}') RETURNS text`；`insert_generation_candidate(p_owner bigint, p_generation bigint, p_content text, p_is_final boolean DEFAULT false) RETURNS TABLE(out_candidate_id bigint)`；`record_quota_release(p_owner bigint, p_generation bigint, p_quota_amount integer, p_reason text) RETURNS TABLE(out_entry_id bigint)`。
- 终态 realtime_event 事件类型只允许 chat.completed / chat.cancelled / chat.blocked / chat.failed 语义；`append_realtime_event` 对终态 generation 的拒绝保持不变（INV-GEN-003）。

## 权限、RLS 和数据处理要求

- provider_attempt 与既有终态表同样 FORCE RLS + owner_isolation；函数 SECURITY DEFINER 绑定 `vc.owner_user_id`，无 BYPASSRLS 角色。
- 无凭据、无请求/响应内容列；审计链只记录身份与结果（TASK-0035 验收）。
- 仅合成数据、一次性临时容器（run-rls-tests.sh 既有机制）。

## 状态机和失败行为

- 终态转移遵守 `specs/catalog/generation-states.yaml`：FAILED_FINAL（from IN_PROGRESS/WAITING_FOR_CAPACITY/COMMITTING）、OUTPUT_BLOCKED（from FINAL_REVIEW）、COMPLETED_FALLBACK（from COMMITTING）；非法 from 状态与已终态 generation 一律 RAISE（失败关闭）。
- CANCELLED 双跳（CANCEL_REQUESTED -> CANCELLED）仅走 V10；terminalize_generation 不接受 CANCELLED。
- 终态 realtime_event 与状态变更同一事务（INV-TX-001），先事件后终态/先终态后事件均不可能出现分离状态。

## 模型、Prompt、记忆和安全边界

- 不修改 SafetyGate/记忆/catalog 契约；本卡不引入任何模型调用、Prompt 或记忆写入。
- 凭据零接触：新表/函数均无凭据参数。

## 验收标准

1. 全新 DB 应用 V1-V15 成功；RLS 套件全量（39 既有 + 新增）PASS——新测试覆盖 provider_attempt 落库、跨租户拒绝、终态转移、终态事件原子性、candidate 落库、quota RELEASE。
2. `record_provider_attempt` 正确落库且 owner 隔离（跨租户访问拒绝）；表无凭据/内容列。
3. `terminalize_generation` 对合法 from 状态推进成功并原子写对应终态 realtime_event；非法 from/已终态/直接 CANCELLED 一律失败；终态 generation 上 `append_realtime_event` 继续拒绝。
4. `insert_generation_candidate` 落库 candidate（is_final=true 时遵守单终态候选唯一约束）；`record_quota_release` 落 RELEASE 行（kind 校验通过）。
5. 验证全绿：precheck PASS、Maven 全模块回归 0 失败、harness unittest PASS、`git diff --check` 干净。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准；每条记录状态、退出码、验证提交、产物哈希或无产物理由；同一条 `git diff --check` 只执行一次。precheck 已含正式 Doctor，不重复列 standalone Doctor。

## 回滚或前向修复

- 纯增量迁移（V15 新建表/函数，不改既有对象）；失败先修测试或实现，最多 1 个 fix batch。
- 若 READY 后 Owner 需修订条款：先登记 Backlog authorizationAmendments 强类型合同，再在卡 `scopeAmendments` 追加 Hash 绑定投影（单父原子治理提交）。
- 前向：本卡完成后 TASK-0093（运行时编排侧）消费本卡函数；TASK-0091（provider_deployment 持久化）独立可并行。

## 停止条件

- context/approval/Skill/白名单/候选身份/Reviewer/canonical/CI/远端复核任一失败关闭即停止推进并转 BLOCKED。
- hardFuseWallMinutes=90 停止实现/修复/Reviewer/canonical/CI；仍活动则只允许 closure-only overrun（Evidence/Handoff、pre-closure、terminal commit、push），记录时长与根因。
- R1 阻塞性发现（P0/P1/AC 违反/不变量违反）进入最多 1 个 fix batch，R2 只做 finding-closure + delta + adjacent risk + 新 P0/P1；禁止第三轮 review。

## Evidence Pack

输出到 `docs/evidence/TASK-0090/`（evidence-pack.json、pre-closure-request、review-r1/r2.md），并生成 `docs/handoffs/TASK-0090.json`（headCommit= 实现候选提交、completed/remaining/knownRisks/nextAction，nextAction 与 project-state 逐字一致）。
