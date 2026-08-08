# TASK-0099：Refresh rotation 单后继修复（P1-06）

```yaml
taskId: TASK-0099
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
baseCommit: 60c00e1f5142ac7e6666cbeb91c7834c511ac1d9
authorizationCommit: "ed36e7f4fc4d51edd89c18d6c41ac258834bd8dc"
contextFingerprint: 405d22a997e09cbd0389f7be79d3e1dc2e53d86c6968a6f80dece4bd1c291aee
contextLock: docs/tasks/context/TASK-0099.context-lock.yaml
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
  surfaceId: TASK_0099_REFRESH_ROTATION_SINGLE_SUCCESSOR
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
  - docs/tasks/TASK-0003-identity-session-contract.md
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - infra/db/run-rls-tests.sh
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/RefreshTokens.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/JwtTokenService.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - skills/database-migration/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/error-codes.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0099-refresh-rotation-single-successor.md
  - docs/tasks/context/TASK-0099.context-lock.yaml
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0099/**
  - docs/handoffs/TASK-0099.json
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
  - docs/tasks/TASK-0003-identity-session-contract.md
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/**
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
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
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
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/41_generation_terminal_transitions.sql
  - infra/db/tests/42_terminal_event_atomic.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - infra/db/tests/44_finalize_finalize_concurrent.sql
  - infra/db/tests/45_finalize_cancel_concurrent.sql
  - infra/db/tests/46_finalize_terminalize_concurrent.sql
  - infra/db/tests/47_candidate_terminal_toctou.sql
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
  - specs/catalog/error-codes.yaml
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - docs/tasks/TASK-0003-identity-session-contract.md
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
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
      Owner 按 2026-08-08 审计交接工作包 5 正式分配 P1-06（Refresh rotation 修复）：
      V14 rotate 函数行锁/条件 UPDATE RETURNING 唯一 winner（revoked_at IS NULL
      AND expires_at > now()）；AuthService.refresh() 返回传给 rotate 的同一明文
      token、不得再调用创建第二 session 的 issueTokens()；并发 refresh 单 live
      successor、返回 token hash 等于 rotation 插入值、失败不遗留隐藏 session 的
      DB+服务层测试（DB 与服务层必须同卡闭环）。ID 自 TASK-0099 起核对未占用后分配。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-08"
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 批准 TASK-0099 修改 `**/db/migration/**` 保护路径（C4）：V14
      identity_refresh_token_rotate 增加 token 行锁（SELECT ... FOR UPDATE OF t）
      + 锁内 live 状态复查 + 条件 UPDATE winner（WHERE revoked_at IS NULL AND
      expires_at > now()），仅唯一获胜者插入新 token。database-migration skill
      1.0.0 的"不得修改已执行迁移"约束在本卡不构成阻塞：仓库迁移只应用于一次性
      合成容器（Technical Alpha SYNTHETIC_ONLY/TEMPORARY_VOLUME_ONLY，runner
      每次全新容器应用全量迁移），无持久环境、无 Flyway checksum 历史可违反
      （TASK-0098 先例）。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0099
  - bash infra/db/run-rls-tests.sh
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test -Dtest=AuthServiceTest -Dsurefire.failIfNoSpecifiedTests=false
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0095/0096/0097/0098 先例），不写 planningBacklog/planningContractHash；ID 已核对未占用（TASK-0099 起，ledger 无 0099 及以后条目）。迁移原地修改的授权依据：审计报告 P1-06 明确列出 `V14__identity_accounts_sessions.sql` 为修复路径，Owner 交接工作包 5 逐字指示修复该文件。

## 背景与用户可观察目标

审计确认 refresh rotation 存在两个缺陷（P1-06）：

1. **并发轮换可签发多个有效会话**：`vc.identity_refresh_token_rotate`（V14:220-234）先普通 SELECT 旧 token（无行锁），再无条件 UPDATE revoke（更新条件没有 `revoked_at IS NULL`，也没有行锁）。两个并发请求都能在旧 token 仍有效时通过检查；第二个事务等待 UPDATE 后仍继续插入自己的新 token，双方都获得有效会话。
2. **串行刷新也创建隐藏后继**：`AuthService.refresh()`（AuthService.java:103-120）生成 token A 传给 rotate 并插入 A 的 hash 后，第 119 行又调用 `issueTokens()` 生成 token B 并插入第二个 session，最终只把 B 返回给客户端。A 是未返回、不可达但仍有效的隐藏 session；若第二次签发失败，旧 token 已撤销、隐藏后继可能已落库，客户端却拿不到凭据。

本卡完成后，用户能观察到：并发 refresh 同一 token 恰好一个请求获胜并拿到新会话，败者失败关闭（AUTHENTICATION_REQUIRED）且零写入；每次刷新只产生一个 live successor；客户端拿到的明文 refresh token 的 sha256 正是 rotation 插入数据库的值；任何失败路径都不遗留隐藏 session。

## 范围内

- **V14 `identity_refresh_token_rotate`（`service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql`）**：
  - 状态读取改为带行锁的 `SELECT ... FOR UPDATE OF t`（仅锁 `identity_refresh_token` 行，join 的 `identity_account` 行不锁）；锁内复查 `revoked_at IS NULL AND expires_at > now()` 且账户 `ACTIVE`。
  - revoke 改为**条件 UPDATE winner**：`UPDATE ... SET revoked_at = now() WHERE token_hash = p_old_token_hash AND revoked_at IS NULL AND expires_at > now()`；`NOT FOUND` 即失败关闭返回（防御纵深，行锁下恒真）。
  - 仅唯一获胜者执行新 token INSERT；`RETURN QUERY` 账户行的返回结构、函数签名、GRANT/REVOKE 保持不变。
- **`AuthService.refresh()`（`service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java`）**：
  - 返回传给 `sessions.rotate()` 的同一个明文 token（`newRefreshToken`），不再调用创建第二 session 的 `issueTokens()`。
  - access token 仍由 `jwt.issueAccessToken(...)` 按 rotated session 签发；`AuthResponse` 结构不变；`login()` 仍走 `issueTokens()`（登录创建首个 session 的语义不变）。
- **新增 DB 并发测试** `infra/db/tests/48_refresh_rotate_concurrent.sql`（runner 自动拾取，无需改脚本）：两独立 DB session（dblink + `SET ROLE vc_api`，TASK-0098 先例）并发 rotate 同一 live token，恰好一个获胜；断言旧 token 被 revoke、**恰好一个** live successor 且其 token_hash 等于获胜者传入的新 hash、败者 hash 零落库（无隐藏 session）、总 session 数 = 旧 1 + 新 1。
- **服务层测试**（`AuthServiceTest.java`）：断言 refresh 返回的明文 token 的 sha256 等于传给 `sessions.rotate()` 的新 hash（ArgumentCaptor）；`sessions.issue()` 在 refresh 路径**永不**被调用（不创建第二 session）；rotate 失败路径不调用 issue、不遗留任何 session。

## 明确范围外

- 不修 P1-04/P1-05（租户上下文与宽泛 DML 权限模型）、P1-07/08/09（前端 snapshot/baseline/cookie-CSRF——cookie/CSRF 方案属 P1-09 工作包 9，不在本卡决策范围）、P2-03/04/13（登录限流/校验/seed 竞态）、P1-10/P2-28（DB CI job 与 readiness 竞态）。
- 不改 `identity_logout`、`identity_refresh_token_issue`、`identity_admin_seed`、`identity_account_create`、`identity_authenticate` 等其余 V14 函数；不改 GRANT/REVOKE、RLS、`IdentityRefreshTokenRepository`、`RefreshTokens`、`JwtTokenService`、控制器/OpenAPI。
- 不改 `infra/db/run-rls-tests.sh`（自动拾取新测试，无需改动）、`.harness/**`（除 project-state/task-ledger 生命周期字段）、`specs/**`。
- 不删除测试、不加 skip、不吞退出码、不改写历史 Evidence/Handoff/ADR。

## 输入和前置条件

- Base Commit 固定为 `60c00e1f5142ac7e6666cbeb91c7834c511ac1d9`（TASK-0098 ACCEPTED 终态），DRAFT 创建前工作树干净、`activeTask: null`、ledger 无 TASK-0099 条目。
- Context Lock 只绑定 Base Commit 内仓库相对路径；外部审计/交接文档仅作 provenance。
- DB 验证在 OrbStack Docker（`pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0`，与 `infra/db/run-rls-tests.sh` 冻结一致）内执行：全新容器应用 V1-V15 全量迁移 + 全部 SQL 测试（01-48）；dblink 扩展可用性已由 TASK-0098 44-47 实测。
- 本卡触碰 `**/db/migration/**`（C4 保护路径）：使用 `database-migration` skill 1.0.0、Owner 人工批准（humanApprovals 已预填）、独立 Reviewer。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供（`~/.zcode/venvs/vc-harness/bin/python`，PATH 前缀解析）。
- 每次 doctor/precheck 使用干净 `TMPDIR=$(mktemp -d ...)`，避免旧 receipt 命中。

## API / 事件 / 数据契约

- `vc.identity_refresh_token_rotate` 签名与返回结构不变（`(text, text, timestamptz)` → `TABLE(out_account_id, out_role, out_status, out_username)`）；语义新增：仅持有 token 行锁且锁内复查 live（`revoked_at IS NULL AND expires_at > now()`）+ 账户 `ACTIVE` 时才 revoke 并插入后继；败者零写入、返回零行。
- 表结构、索引、GRANT/REVOKE、其余 SECURITY DEFINER 函数不变。
- `AuthService.refresh()` 返回的 `AuthResponse` 结构不变（accessToken/refreshToken/tokenType/expiresIn/accountId/role）；语义新增：`refreshToken` 字段 = 传给 rotate 的同一明文 token，refresh 路径不再创建第二个 session。
- 无 OpenAPI/事件/消息契约变更（AuthService 是 application 层，非 controller）。

## 权限、RLS 和数据处理要求

- 不接触真实用户数据、凭据或外部服务；DB 数据仅为合成 fixture；容器临时（`--rm`、匿名 volume、无 host 端口绑定），与 backlog `testPolicies.database` 一致。
- 函数保持 `SECURITY DEFINER SET search_path = vc, public`；不改任何 GRANT/REVOKE/RLS policy；不给任何角色 BYPASSRLS。
- 明文 refresh token 仍只存在于 JVM 内、只以 sha256 hex 落库；测试用 `encode(sha256(...), 'hex')` 构造哈希，不引入明文落库。
- `vc_api` 无身份表直接 DML（测试 39 第 7 节既有断言保持通过）。

## 状态机和失败行为

- 并发语义（READ COMMITTED）：会话 A 先持有 token 行锁并获胜提交；会话 B 的 `SELECT ... FOR UPDATE OF t` 等待 A 提交后，EvalPlanQual 重查 WHERE——`revoked_at IS NULL` 已不成立 → 零行 → `NOT FOUND` → 函数返回零行（fail closed，不插入后继）。
- 败者/过期/已撤销/未知 token：返回零行，服务层统一映射 `AUTHENTICATION_REQUIRED`（存在性与原因不披露，维持既有语义）。
- DISABLED 账户：锁内复查账户 `ACTIVE` 失败 → 零行返回，旧 token **不被 revoke**（测试 39 第 6 节既有断言保持通过）。
- 服务层失败路径：rotate 返回空 → 抛 `AUTHENTICATION_REQUIRED`，不调用 `sessions.issue`、不遗留 session。
- 任一 DB 测试失败即保持非零退出并如实记录；remote CI 在 Actions 配额耗尽下如实记录非 PASS（TASK-0095/0097/0098 先例），本地等价验证（全新容器全量迁移 + 全部 SQL 套件 + 定向 Maven 测试）为备用通道（Owner 既有授权）。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆或 SafetyGate；不引入新依赖、SaaS 或付费运行时。
- 不改变 token 存储边界（只存 sha256 hex）、日志/URL/模型不出现明文 token 或密码的既有保证。

## 验收标准

1. **DB 并发唯一获胜**：两独立 DB session 并发 rotate 同一 live token（各自不同新 hash），`count(*)` 之和恰好为 1（一个返回账户行、一个返回 0 行）；旧 token 被 revoke 恰好 1 行；live successor 恰好 1 行，其 `token_hash` 等于获胜 session 传入的新 hash；败者新 hash 在表中**零行**（无隐藏 session）；该账户 `identity_refresh_token` 总行数 = 2（旧 revoked + 唯一 live successor）。
2. **服务层返回同一明文 token**：`AuthService.refresh()` 返回的 `refreshToken` 的 `sha256Hex` 恰好等于传给 `sessions.rotate()` 的新 token hash 参数（ArgumentCaptor 断言）。
3. **服务层不创建第二 session**：refresh 成功路径 `verify(sessions, never()).issue(anyLong(), anyString(), any())`；refresh 失败路径（rotate 空）抛 `AUTHENTICATION_REQUIRED` 且 `issue` 从未调用。
4. **失败不遗留隐藏 session（DB）**：测试 39 既有断言（reuse revoked/expired/unknown/disabled 全 fail closed 且零新增）+ 测试 48 败者零写入共同证明。
5. **既有套件无回归**：`run-rls-tests.sh` 在全新容器应用 V1-V15 全量迁移后 01-47 全部 PASS（重点 39 身份套件），新增 48 全部 PASS（脚本自动拾取）。
6. **服务层回归**：定向 `AuthServiceTest`（docker JDK 25 容器，`-pl service/apps/runtime -am test -Dtest=AuthServiceTest`）全部 PASS（既有 14 项 + 新增用例）。
7. **交付闭环**：Diff 仅含 writeAllowlist；canonical Precheck 全 PASS；独立 Reviewer 通过；remote 按配额受限如实记录（非 PASS，passClaimed=false）；Handoff `nextAction` 与终态 project-state 逐字一致；origin/main `0/0`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；`bash infra/db/run-rls-tests.sh` 是任务特有 DB 门禁（precheck 不含 DB 套件），只运行一次；定向 Maven `AuthServiceTest` 是受影响模块测试，只运行一次；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器/容器与环境身份。

## 回滚或前向修复

- 修复采用最小迁移与测试变更；若 DB 套件在修复后仍有失败，先确认失败集合是否超出本卡范围，超范围即停止并报告。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- 迁移在全新容器内重放，天然可重试；无持久数据、无 Flyway checksum 历史，回滚 = 修正文件后重跑全新容器。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment（本卡为 C4；若出现该需求应停止并询问 Owner）。

## 停止条件

- 需要修改 writeAllowlist 外路径（如 run-rls-tests.sh 结构、其余迁移、Java 其余文件、specs、`.harness/task-backlog.yaml` 等）时立即停止并询问 Owner。
- dblink 双会话并发测试无法在冻结镜像上确定性执行（如扩展不可用、交错不可复现）时停止并询问 Owner，不得降级为仅串行断言或加 skip。
- 需要触碰 `identity_logout`/`identity_refresh_token_issue`/其他 V14 函数、cookie/CSRF 方案（P1-09）或任何 P1-06 范围外功能时停止并报告。
- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0099/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0099.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、容器/解释器、环境、Reviewer 和 remote exact-SHA；
Handoff `nextAction` 与终态 project-state 逐字一致。
