# TASK-0191：P0 owner context/RLS 信任模型修复（owner GUC 密码学绑定）

```yaml
taskId: TASK-0191
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  database-migration: "1.0.0"
  harness-change: "1.1.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 3c7fd0b5b306325d51464053e7b3382044c3dd4b
authorizationCommit: ""
contextFingerprint: 56ca64e24e6fd668fa90bac08c53c6ce133c152a1859a29fdefc79edd1c1756e
contextLock: docs/tasks/context/TASK-0191.context-lock.yaml
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
  surfaceId: TASK_0191_OWNER_CONTEXT_RLS_TRUST_MODEL
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 2026-08-13 指令：修复 P0 owner context/RLS 信任模型且不得只撤销
    begin_job_context（运行时角色仍可直接 SET 普通 GUC）。数据库信任根
    （current_owner_id/RLS predicate/建立入口/运行时适配/测试）必须一次成卡
    原子落地，拆卡会留下 GUC 伪造仍可行的半修复状态。
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
  - .harness/agent-entrypoints.yaml
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
  - docs/decisions/0004-identity-session-boundary.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/evidence/TASK-0190/evidence-pack.json
  - docs/handoffs/TASK-0190.json
  - service/platform/persistence/src/main/resources/db/migration/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/worker/**
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/**
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V27__owner_context_cryptographic_binding.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/OwnerContext.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/OwnerContextTest.java
  - service/apps/runtime/src/main/resources/application.yaml
  - infra/db/tests/**
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0191/**
  - docs/handoffs/TASK-0191.json
forbiddenPaths:
  - .github/**
  - ci/**
  - frontend/**
  - infra/db/run-rls-tests.sh
  - scripts/harness/**
  - skills/**
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
  - service/apps/runtime/pom.xml
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
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V16__revoke_business_dml_correct_role_attributes.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - service/platform/persistence/src/main/resources/db/migration/V19__admin_seed_concurrency_guard.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql
  - service/platform/persistence/src/main/resources/db/migration/V22__identity_auth_event_retention_purge.sql
  - service/platform/persistence/src/main/resources/db/migration/V23__worker_claim_functions_runtime_api_grant.sql
  - service/platform/persistence/src/main/resources/db/migration/V24__worker_coordinator_functions_runtime_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V25__generation_intake_workitem_promotion.sql
  - service/platform/persistence/src/main/resources/db/migration/V26__authorization_snapshot_runtime_creation.sql
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/evidence/TASK-0184/**
  - docs/evidence/TASK-0189/**
  - docs/evidence/TASK-0190/**
  - docs/handoffs/TASK-0184.json
  - docs/handoffs/TASK-0189.json
  - docs/handoffs/TASK-0190.json
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
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
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - docs/decisions/0004-identity-session-boundary.md
  - specs/contracts/worker-lease-contract.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
requiredInvariants:
  - INV-TENANT-001
  - INV-WORKER-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      Owner 于 2026-08-13 确认 TASK-0190 闭环并指令：创建永久任务 TASK-0191，
      baseCommit 使用 TASK-0190 ACCEPTED 终态提交 3c7fd0b；目标修复 P0 owner
      context/RLS 信任模型，不得只撤销 begin_job_context，因为运行时角色仍可能
      直接设置普通 GUC；先完成只读调用链调查、威胁模型、追加式数据库迁移方案、
      运行时适配、回滚策略及正负隔离测试设计；不得修改既有 Flyway migration
      或历史任务制品；形成 DRAFT、Context Lock、精确 read/write allowlist、风险
      等级和验收命令后，将所有需要 Owner 决策的事项合并成一次提问；批准精确
      安全边界前不进入 READY、不修改业务代码；批准后在冻结范围内自主完成实现、
      验证、独立复核和终态闭环；TASK-0190 的完整 unittest discover NOT_RUN 与
      34 分钟 CI 预算风险继续如实保留，不得改写为 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      同一 Owner 指令授权本卡治理路径（project-state/task-ledger/evidence/handoff）
      的 C4 交付；无第二治理意图。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0191
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡为独立延续单卡（前一合法终态：TASK-0190 ACCEPTED `3c7fd0b`）。外部审计
> 报告 `/Users/hxf/projects/virtual-companion-audit-20260813-report.md` 为仓库外
> 输入，仅记录 provenance，不进入 Context Lock 可复验路径。

## 只读调查结论（DRAFT 冻结前事实）

### 调用链与信任根现状

1. **信任根是会话可写 custom GUC**：`vc.current_owner_id()`
   （V1 `V1__extensions_roles_functions.sql:41-47`）直接读
   `current_setting('vc.owner_user_id', true)`。PostgreSQL 对未注册命名空间
   （`vc.*`）的 custom GUC 无法收回 `SET`/`set_config` 权限——任何数据库会话
   都能 `SET LOCAL vc.owner_user_id = '2'`。
2. **上下文建立入口共 3 个**：
   - Java `OwnerContext.asOwner`（JWT 验证后 `set_config(..., true)`，服务端
     可信路径，`OwnerInjectionFilter` → 每 HTTP 请求）；
   - `vc.begin_job_context(p_owner, p_fence)`（V1:53-73，invoker 函数，PUBLIC
     EXECUTE 从未撤销，任意 owner + 任意非空非 `STALE` fence 即可绑定）；
   - 任意会话直接 `SET LOCAL vc.owner_user_id`（权限模型无法阻止）。
3. **全部下游信任该 GUC**：V2/V5 等 RLS policy
   （`owner_user_id = vc.current_owner_id()`，FORCE RLS）；V17 的 34 个
   SECURITY DEFINER 断言（`p_owner_user_id IS DISTINCT FROM
   vc.current_owner_id()` 即 RAISE）——V17 只是与同一可伪造 GUC 比较。
   V16 DML 收紧、V18 search_path、NOBYPASSRLS 均不改变此信任根。
4. **post-V26 数据库函数内部已无 owner set_config**（V17 全部移除，仅
   claim_work_items 保留 `vc.job_fence`）；Java 无 `begin_job_context` 调用者
   （仅 `OwnerContext` 直接 set_config）。
5. **运行时连接**：`VC_DB_USERNAME`（vc_api 成员语义，NOBYPASSRLS NOLOGIN
   组角色）；worker 同池复用（V23 已论证）。
6. **测试依赖**：51 个既有 DB 测试直接 `SET LOCAL vc.owner_user_id`；
   test 04 以 `vc_worker` 调 `begin_job_context` 验证 STALE 拒绝。
7. `pgcrypto` 已由 V8/V14 创建（幂等），`hmac()` 可用；V27 无需新扩展。

### 威胁模型（修复目标与边界）

- **T1（本卡修复）**：持有运行时角色凭据或可注入 SQL 的攻击者在会话内
  伪造任意 owner 上下文（直接 SET GUC 或调 `begin_job_context`）→ 跨租户
  读 + 经授权函数跨租户写。违反 INV-TENANT-001/INV-WORKER-001 与 ADR-0004
  第 3/7 条（owner 只能由服务端验证后的受控映射产生）。
- **T2（本卡缓解的子集）**：纯 SELECT 级 SQL 注入（无多语句、无应用内存
  访问）——注入语句无法为任意 owner 产生有效绑定证明（证明需应用侧秘密）。
- **T3（明确范围外）**：攻击者完全攻陷应用进程（读取应用内存/环境）或持有
  migrator/superuser 凭据——数据库无法区分，属 P2 运行时身份隔离与部署边界
  （审计 P2 项，另开任务）。本卡不宣称解决 T3。

### 拟议修复设计（待 Owner 批准后冻结）

**核心：把 RLS 信任根从"裸 GUC"改为"GUC + HMAC 绑定证明"，证明密钥只存在于
运行时应用进程与数据库受限表（运行时角色不可读）。**

1. **V27（append-only 新迁移，不改 V1-V26）**：
   - 受限表 `vc._owner_binding_secret`（单行，migrator 所有，**零** runtime
     grant——运行时角色不可 SELECT）；秘密经 Flyway placeholder
     `${owner_binding_secret}` 注入（缺失即迁移失败，fail-closed）。
   - 重定义 `vc.current_owner_id()`：SECURITY DEFINER + STABLE；仅当
     `hmac('owner:'||GUC_owner, K, 'sha256') = GUC vc.owner_binding` 时返回
     owner，否则 NULL（fail-closed）。RLS predicate 与 V17 断言零改动自动生效。
   - 新 `vc.set_owner_context(p_owner bigint, p_proof text)`：SECURITY
     DEFINER；验证 HMAC 证明后绑定 `vc.owner_user_id` + `vc.owner_binding`
     两个事务级 GUC；REVOKE FROM PUBLIC，GRANT 四个 runtime 角色。
   - `REVOKE EXECUTE ON FUNCTION vc.begin_job_context(bigint, text) FROM
     PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher`（函数保留
     不重定义不删除，migrator 专用；历史语义冻结）。
2. **运行时适配**：`OwnerContext.asOwner` 用 `javax.crypto`（HmacSHA256，无新
   依赖）以 env `VC_OWNER_BINDING_SECRET` 计算
   `hex(hmac("owner:"+id, K))`，改调 `vc.set_owner_context(?, ?)`；production
   profile 增加该 env 无默认值（缺失启动失败，fail-closed，与 P1-11 模式一致）。
3. **回滚策略**：Flyway 无 down-migration；前向修复 = 文档化 V28（恢复旧
   `current_owner_id` 语义 + 归还 grant），本卡不预建；紧急运维回滚 = 旧镜像
   + 旧库快照（V27 已应用则依赖前向 V28）。
4. **正负隔离测试设计**：
   - 新增 69：runtime 角色直接 `SET LOCAL vc.owner_user_id='2'`（无绑定）→
     `current_owner_id()` NULL → RLS 零行（伪造失效）；
   - 新增 70：runtime 角色伪造 `vc.owner_binding`（错误 HMAC）→ 同上拒绝；
   - 新增 71：runtime 角色调 `begin_job_context` → permission denied；
   - 新增 72：`set_owner_context` 正确证明（superuser 会话可读秘密表计算）
     → 上下文建立成功且 RLS 隔离保持；错误证明 → RAISE；
   - 既有 51 个测试 + test 04 机械改造：`SET LOCAL vc.owner_user_id` 旁补
     `SET LOCAL vc.owner_binding`（superuser 可读秘密计算合法绑定；测试以
     postgres 运行）；test 04 的 begin_job_context 段改为预期 permission
     denied。
5. **验收命令**：YAML `requiredCommands` 四条（canonical precheck、runtime
   mvn test、RLS 容器测试、git diff --check）。

## 待 Owner 决策事项（已合并为一次提问，批准前不进 READY）

1. 密码学绑定方案（HMAC 证明）是否批准为精确安全边界；
2. 新部署环境变量 `VC_OWNER_BINDING_SECRET` 的供给契约（app env + Flyway
   placeholder 两处同值，生产 fail-closed）；
3. 既有 51 个 DB 测试文件 + test 04 的机械改造是否授权（属测试代码，非
   Flyway migration、非历史任务制品）；
4. `begin_job_context` 处置方式（REVOKE 保留 vs 重定义恒拒绝）；
5. T3（应用进程攻陷/migrator 凭据）确认范围外、另开 P2 任务；
6. V27 是否同时收编 P2 运行时身份强制隔离（建议不收编）。

## 范围内

- 新迁移 V27（唯一被写的 migration 文件）；
- `OwnerContext`/`OwnerContextTest`/`application.yaml` 运行时适配；
- `infra/db/tests/**` 新增 69-72 与既有测试机械改造；
- 本卡治理路径（context/evidence/handoff/project-state/ledger）。

## 明确范围外

- 不修改 V1-V26 任何既有 migration；不修改任何历史任务制品（TASK-0184/
  0189/0190 的卡/context/evidence/handoff）。
- 不做 T3（运行时/migrator 身份强制隔离、BYPASSRLS/DDL 校验）——审计 P2，
  另开任务。
- 不做 P1 lease/fence 业务写入保护（审计 P1-01）、不做 job_fence 绑定改造
  （claim_token 已不可猜，fence 伪造单独不足以接管）。
- 不改 CI workflow、Backlog、lifecycle、前端、specs 契约。
- 不推送远端；不创建/删除分支。

## 状态机和失败行为

- V27 迁移失败（placeholder 缺失等）→ fail-closed 停止，记录真实退出码。
- RLS 容器测试或 mvn test 非 PASS → `maximumFixBatches: 1` 内修复重跑；超出
  即停止询问 Owner。
- 需要 writeAllowlist 外路径时立即停止，另行申请授权。

## 验收标准

1. V27 落地后：runtime 角色（或任意会话）直接 SET GUC、伪造 binding、调
   begin_job_context 均无法建立有效 owner 上下文（新测试 69-71 实证）；
   `set_owner_context` 正确证明路径成功且跨租户 RLS 隔离保持（72 实证）；
   既有 60+ 测试全绿（含机械改造）。
2. `requiredCommands` 四条以同一候选 SHA 真实 PASS（保留真实退出码）；
   canonical precheck 含 licenseCheck 全绿。
3. diff 仅含 writeAllowlist 路径；V1-V26 与历史任务制品零修改。
4. C4 独立复核 PASS；Evidence/Handoff/project-state nextAction 逐字一致；
   Ledger 追加 TASK-0191。
5. 完整 harness unittest discover 如实 NOT_RUN（CiPolicy 34 分钟 CI 预算
   风险继续保留，不改写为 PASS）。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。

## Evidence Pack

输出到 `docs/evidence/TASK-0191/`（含 `review-r1.md`），并生成
`docs/handoffs/TASK-0191.json`。
