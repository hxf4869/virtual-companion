# TASK-0036：Technical Alpha 隔离、安全、记忆、故障与指标总验收

```yaml
taskId: TASK-0036
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 38565c9e43e311a021470e179659170858f69a4d63b596b0ecfc9bbbf6554a27
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: b515364208a8f3b6e204d9025eddc053118ad14a
contextFingerprint: ebce1cea3c21fb712ddf7a94d43361d0750b730c791fa1e188a03602bc753eac
contextLock: docs/tasks/context/TASK-0036.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: "0f853e6eea08569f1d1e3eef1fef2d948e213c23"
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
  riskClass: C2
  surfaceId: TASK_0036_TECHNICAL_ALPHA_TOTAL_ACCEPTANCE
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 90
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
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/decisions/0001-v031-technology-and-transport-baseline.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/decisions/0004-identity-session-boundary.md
  - docs/tasks/TASK-0026-h5-offline-chat-stream-recovery.md
  - docs/tasks/TASK-0030-h5-memory-management.md
  - docs/tasks/TASK-0032-zero-llm-quota-failure-recovery.md
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/TASK-0035-approved-live-model-provider.md
  - docs/evidence/TASK-0026/evidence-pack.json
  - docs/evidence/TASK-0026/review-r1.md
  - docs/evidence/TASK-0030/evidence-pack.json
  - docs/evidence/TASK-0030/review-r1.md
  - docs/evidence/TASK-0032/evidence-pack.json
  - docs/evidence/TASK-0032/review-r1.md
  - docs/evidence/TASK-0032/review-r2.md
  - docs/evidence/TASK-0034/evidence-pack.json
  - docs/evidence/TASK-0034/review-r1.md
  - docs/evidence/TASK-0034/review-harness-fixes-r1.md
  - docs/evidence/TASK-0035/evidence-pack.json
  - docs/evidence/TASK-0035/review-r1.md
  - docs/evidence/TASK-0035/review-r2.md
  - docs/handoffs/TASK-0026.json
  - docs/handoffs/TASK-0030.json
  - docs/handoffs/TASK-0032.json
  - docs/handoffs/TASK-0034.json
  - docs/handoffs/TASK-0035.json
  - specs/catalog/age-states.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/data-categories.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/memory-candidate-statuses.yaml
  - specs/catalog/memory-item-statuses.yaml
  - specs/catalog/memory-scopes.yaml
  - specs/catalog/message-states.yaml
  - specs/catalog/model-protocols.yaml
  - specs/catalog/processing-purposes.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/provider-attempt-statuses.yaml
  - specs/catalog/realtime-events.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/route-decision-statuses.yaml
  - specs/catalog/safety-classifier-outcomes.yaml
  - specs/catalog/service-modes.yaml
  - specs/generated/catalog.snapshot.json
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/beta-gate-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/finalization-contract.yaml
  - specs/contracts/generation-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/contracts/license-cost-boundary-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/contracts/safety-fail-closed-contract.yaml
  - specs/contracts/worker-lease-contract.yaml
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - infra/db/run-rls-tests.sh
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/TechnicalAlphaCapabilities.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/TechnicalBaselineProperties.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/CatalogSnapshotLoader.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/BaselineControllerTest.java
  - frontend/package.json
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
writeAllowlist:
  - docs/tasks/TASK-0036-technical-alpha-acceptance.md
  - docs/tasks/context/TASK-0036.context-lock.yaml
  - docs/evidence/TASK-0036/**
  - docs/handoffs/TASK-0036.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
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
  - docs/decisions/**
  - requirements-harness.txt
  - scripts/harness/**
  - scripts/dev/**
  - skills/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - docs/source/**
  - service/modules/safety/**
  - service/modules/memory/**
  - service/platform/catalog/**
  - service/tests/**
  - service/adapters/model-fake/**
  - service/adapters/model-failure/**
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
  - frontend/src/domain/**
  - frontend/src/pages/chat/**
  - frontend/src/pages/memory/**
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-MEM-001
  - INV-MEM-002
  - INV-GEN-003
  - INV-TX-001
  - INV-COST-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-authorization
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0036 Technical Alpha 总验收（criticalPath 终点，只读验收
      矩阵：跨租户/授权撤销/安全失败/记忆删除/故障恢复/协议/指标/审计 8 域矩阵真实执行 +
      5 张依赖卡终态 Evidence 可追溯 + Alpha 禁止能力保持关闭验证 + P0/P1/P2 闭环处置）。
      范围外：Beta、公开注册、真实支付与 Technical Alpha 之外能力；不得用 NOT_RUN/失败/
      合成 PASS 替代真实验收。写入仅限任务卡、Context Lock、docs/evidence/TASK-0036/**、
      docs/handoffs/TASK-0036.json、project-state、task-ledger。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0036
  - wsl.exe -d Ubuntu-24.04 -u root -- bash -c 'docker run --rm -v /mnt/g/ai/hxf/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine mvn -o -pl service/apps/runtime -am test'
  - wsl.exe -d Ubuntu-24.04 -u root -- bash -c 'cd /mnt/g/ai/hxf/virtual-companion && bash infra/db/run-rls-tests.sh'
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - bash -c "cd frontend && npx vitest run"
  - bash -c "cd frontend && npx vue-tsc --noEmit"
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 背景与用户可观察目标

Technical Alpha 进入总验收（criticalPath 终点）。用户可观察：仓库以单一真实验收矩阵证明 5 张依赖卡（H5 流式恢复 TASK-0026、H5 记忆管理 TASK-0030、ZERO_LLM/配额/故障恢复 TASK-0032、成熟身份 TASK-0034、获批真实供应商 TASK-0035）的终态 Evidence 全部可追溯且矩阵真实通过；Technical Alpha 禁止能力（真实支付/公开注册/Beta/语音/图像/WebSocket/默认 Beta 生成）保持关闭；P0/P1/P2 发现全部闭环或明确处置。本任务不实现业务代码，产出总验收矩阵报告与证据。

## 范围内

- 跨租户、授权撤销、安全失败、记忆删除和故障恢复矩阵：执行 RLS 39 项 SQL 矩阵 + Maven 全模块测试 + 前端 vitest/vue-tsc + openapi validate/diff + harness unittest，逐项绑定 PASS 与证据引用。
- 指标、审计、性能基线和 Alpha 发布证据：审计链（provider_attempt/usage/realtime_event）、运行期基线端点（/api/internal/baseline 禁止能力关闭）、5 张依赖卡终态 Evidence 逐卡追溯至提交。
- P0/P1/P2 闭环处置表：枚举 5 卡 R1/R2 全部发现，标注 CLOSED（fix batch 验证）/非阻塞处置（review PASS + deferral 理由），P0/P1 必须为零。
- Alpha 禁止能力关闭验证：capabilityGates（realPayment FORBIDDEN、realUserBeta BLOCKED）+ paid-feature-denylist + beta duty roster gate + product-scope 能力开关 + BaselineControllerTest。

## 明确范围外

- Beta、公开注册、真实支付和 Technical Alpha 之外能力。
- 依赖或硬闸门未满足时宣称 Alpha 完成。
- 用 NOT_RUN、失败或合成 PASS 替代真实验收。
- 实现或修复业务代码（上游 streaming/finalization 接线、provider_deployment 持久化、QuotaLedger 持久化、H5 transport 接线均属后续任务）；本卡只验收、不修复。

## 输入和前置条件

所有输入为 Base Commit `b515364208a8f3b6e204d9025eddc053118ad14a` 的仓库相对路径（见 Context Lock）。外部资料只记录 provenance，不写入可复验路径。前置条件：5 张依赖卡全 ACCEPTED 且推送；两闸门 APPROVED；仓库空闲；本卡按 Backlog 执行顺序首个可晋级。

## API / 事件 / 数据契约

总验收矩阵覆盖的真实契约：database-ownership-contract（跨租户 RLS）、identity-session-boundary-contract（授权撤销）、safety-fail-closed-contract（安全失败）、generation/finalization-contract（故障恢复终态）、realtime-contract（协议恢复）、model-protocol-contract（离线协议）、beta-gate-contract / license-cost-boundary-contract（禁止能力关闭）。审计链契约：provider-attempt-statuses、route-decision-statuses、generation-states、realtime-events、memory-scopes、error-codes。

## 权限、RLS 和数据处理要求

验收矩阵验证 INV-TENANT-001（RLS 跨租户 fail-closed）、INV-AUTH-001（外发绑定授权快照）、INV-MEM-001/002（canonical 记忆 + 确认）、INV-GEN-003/INV-TX-001（终态原子性）、INV-COST-001（付费前置禁止）。本卡自身只读数据，不落库、不改数据、不接触生产凭据；写路径仅 docs 治理文件。

## 状态机和失败行为

本卡无业务状态机；验收矩阵逐项记录执行结果（PASS/FAIL/NOT_RUN/TIMEOUT），任一 P0/P1 或矩阵项 FAIL 即整体 BLOCKED 不得宣称 Alpha 完成；证据只绑定真实执行与精确 SHA，失败/取消/超时/NOT_RUN 永不转为 PASS。矩阵中 NOT_RUN 或未覆盖平台如实记录，不视为覆盖。

## 模型、Prompt、记忆和安全边界

验收验证模型边界：真实外发仅获批部署、凭据不进仓库/日志/业务类型（TASK-0035 审计链）；ZERO_LLM 固定降级不伪造 provider_attempt（TASK-0032）；canonical 记忆仅 ACCEPTED、模型输出只产生候选（TASK-0027/0028/0030，INV-MEM-001/002）。本卡不接触模型、凭据或安全代码。

## 验收标准

- AC1：5 张依赖卡（TASK-0026/0030/0032/0034/0035）终态 Evidence（evidence-pack + review + handoff）全部存在且可追溯至其 headCommit，追溯表逐卡列出。
- AC2：总验收矩阵真实执行并全绿：RLS 39/39、Maven runtime 全模块测试 0 失败、frontend vitest + vue-tsc 0 失败、openapi validate + diff PASS、harness unittest 0 失败、precheck（doctor+catalog+paid+beta）PASS。
- AC3：Alpha 禁止能力保持关闭：project-state realPayment=FORBIDDEN / realUserBeta=BLOCKED / businessImplementation=BLOCKED；paid-feature-check 无付费运行时前置；beta duty roster gate 保持生成关闭；BaselineControllerTest 断言受限能力全 false；product-scope paymentEnabled/publicRegistrationEnabled/betaGenerationEnabledByDefault=false。
- AC4：P0/P1 为零（5 卡 R1/R2 均 PASS），P0/P1/P2 闭环处置表逐项标注 CLOSED 或非阻塞处置（附 review 证据与理由）；无未处置 P2。
- AC5：性能/指标基线如实记录：审计链测试 + Maven 测试计数 + RLS 39 + 运行期基线端点断言；未存在的能力如实标记 N/A，不编造性能数据。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准；每条记录状态、退出码、验证提交、产物哈希或无产物理由；同一条 `git diff --check` 只执行一次。precheck 已含正式 Doctor，不重复列 standalone Doctor。

## 回滚或前向修复

总验收为只读矩阵；如矩阵发现 P0/P1 或禁止能力开启，不得修复业务代码（超出本卡范围），应如实记录并 BLOCKED，交由 Owner 安排后续修复卡。交付制品（任务卡/Context Lock/evidence/handoff）若发现错误，仅允许在前向修复提交中修正 docs 内容，不重写历史。

## 停止条件

- BLOCKED：任一依赖终态 Evidence 缺失/不可追溯、矩阵任一必需项 FAIL、禁止能力开启、P0/P1 存在、硬闸门未满足。
- 预算 fuse：按 task-delivery-policy budgets 的 hardFuseWallMinutes/candidateDeadlineMinutes/maximumFixBatches/maximumReviewRounds 停止，不做实现。
- OWNER_GATE：Owner 要求暂停总验收或改变范围时停止。

## Evidence Pack

输出到 `docs/evidence/TASK-0036/`：`evidence-pack.json` + `technical-alpha-acceptance.md`（总验收矩阵报告）+ `review-r1.md`（独立复核）+ 如有 fix batch 追加 `review-r2.md`；并生成 `docs/handoffs/TASK-0036.json`。
