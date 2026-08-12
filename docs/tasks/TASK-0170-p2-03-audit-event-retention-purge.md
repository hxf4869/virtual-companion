# TASK-0170：P2-03 审计事件保留与定时清理（identity_auth_event >180 天自动 purge）

```yaml
taskId: TASK-0170
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
baseCommit: d44a854a2f9d4a923c5a0c460eba4e36baafde20
authorizationCommit: "4fb38921cf6fdcf7f829108648df0c72e7428f01"
contextFingerprint: b6c72ea32e494411539b14163e76beb68b631be0a40abf18fd72b3039dcf688f
contextLock: docs/tasks/context/TASK-0170.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0170_P2_03_AUDIT_EVENT_RETENTION_PURGE
  policySurfaces: [AUTHORIZATION, HISTORY]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 35
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0170
  - bash infra/db/run-rls-tests.sh
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0169/evidence-pack.json
  - docs/evidence/TASK-0169/review-r1.md
  - docs/handoffs/TASK-0169.json
  - docs/tasks/TASK-0169-p2-03-password-minimum-policy-and-complexity.md
  - docs/tasks/context/TASK-0169.context-lock.yaml
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - service/apps/runtime/pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/52_revoked_runtime_dml_on_business_tables.sql
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V22__identity_auth_event_retention_purge.sql
  - infra/db/tests/62_identity_auth_event_purge.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeScheduler.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/IdentityAuthEventPurgeSchedulerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicatorTest.java
  - docs/tasks/TASK-0170-p2-03-audit-event-retention-purge.md
  - docs/tasks/context/TASK-0170.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0170/**
  - docs/handoffs/TASK-0170.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-9]-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-9].context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-9]/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-9].json
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
  - scripts/harness/**
  - .github/workflows/**
  - specs/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/**/pom.xml
  - service/platform/persistence/src/main/java/**
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/SchemaReadinessHealthIndicator.java
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-5][0-9]_*.sql
  - infra/db/tests/6[01]_*.sql
  - frontend/**
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
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0169.json
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
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
      Owner 2026-08-12 长线授权继续审计修复（一次一张新卡）。本卡 TASK-0170 = P2-03 审计保留子项
      （§4.3 列「审计聚合与保留期限」为 Owner 决策项，明令「不要由实现者私定安全数值」；§4.3 验证列
      「审计保留均有确定测试」）。Owner 2026-08-12 已定全部决策点：identity_auth_event 保留 180 天 +
      自动定时清理机制。机制 = V22 新增 SECURITY DEFINER purge 函数 identity_auth_event_purge(p_cutoff
      timestamptz)（DELETE WHERE occurred_at < p_cutoff，RETURN 删除行数；SET search_path = vc,
      pg_catalog 匹配 V18 基线；GRANT EXECUTE TO vc_api；SECURITY DEFINER 绕过 vc_api 无 DELETE
      授权的限制，以迁移 principal 身份执行 DELETE）+ runtime 新增 @EnableScheduling（放 AuthDataSourceConfig，
      仅当 auth.datasource-enabled 时激活）+ @Scheduled 每日调用（cron 默认 0 17 3 * * *，retention 默认
      180 天经 @Value 可配置）。cutoff 参数化使 DB 测试可控、retention 策略留 runtime 配置层。开卡前已用
      当前 HEAD（d44a854）复核：V14 identity_auth_event 列名 occurred_at；vc_api 仅 EXECUTE INSERT 函数无
      DELETE；V18 search_path 基线 vc,pg_catalog；runtime 全模块无任何 @Scheduled/@EnableScheduling。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 授权本卡触碰 protected path **/db/migration/**（V22 新增 SECURITY DEFINER purge 函数 +
      GRANT EXECUTE vc_api + REVOKE PUBLIC）。不改任何已执行迁移（V1-V21 frozen，Flyway checksum 安全）；
      只新增 V22 前向迁移。search_path 一律 vc,pg_catalog（V18 基线）。purge 函数 SECURITY DEFINER 以
      迁移 principal 执行 DELETE，运行角色 vc_api 仅获 EXECUTE，不获表级 DELETE（INV-TENANT-001 角色无
      BYPASSRLS 不变；审计表为平台级无 RLS，purge 删的是已过保留期的审计行，不影响租户隔离）。新增 DB
      测试 62 验证 purge 删旧留新 + vc_api 不能直接 DELETE（角色越权 fail-closed）。
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
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P2-03 审计修复续卡
> （审计保留子项，§4.3 列为 Owner 决策）：为 append-only `identity_auth_event` 审计表增加 180 天保留
> 与每日自动 purge 机制。触碰 protected path `**/db/migration/**`（V22 新增）→ C4 + database-migration
> skill + humanApproval scope:database-migration + independentReview:required；同时改 `service/apps/runtime/**`
> （@EnableScheduling + @Scheduled purge caller）非保护路径。card riskClass 取最高 = C4。

## 背景与用户可观察目标

P2-03（来自 TASK-0109 审计 §4.3）将「审计聚合与保留期限」列为 Owner 决策项。P2-03 核心限流/锁定/输入
收紧（TASK-0156+0160）、密码最低策略（TASK-0169）均已闭环。当前缺漏（本卡目标）：

`vc.identity_auth_event`（V14）是 append-only 审计表（LOGIN_SUCCESS/LOGIN_FAILURE/LOGOUT/ACCOUNT_CREATE），
只增不删——vc_api 无 DELETE 授权（V14 REVOKE ALL，只有 SECURITY DEFINER INSERT 函数），runtime 无任何
调度器（@Scheduled/@EnableScheduling 全缺）。审计行无限累积，无保留期限、无自动清理，不符合 §4.3「审计
保留均有确定测试」与「审计聚合与保留期限」Owner 决策项。

Owner 2026-08-12 已定的精确决策：保留 **180 天**；机制 = **自动定时清理**（非手工运维脚本）。

用户可观察结果（本卡完成后）：
- **V22 purge 函数**：`vc.identity_auth_event_purge(p_cutoff timestamptz)` SECURITY DEFINER，DELETE
  `WHERE occurred_at < p_cutoff` 并 RETURN 删除行数；`SET search_path = vc, pg_catalog`（匹配 V18 基线）；
  `GRANT EXECUTE TO vc_api`，`REVOKE FROM PUBLIC`。vc_api 仍无表级 DELETE（只能通过此函数删，函数边界固定）。
- **每日自动清理**：runtime 在 auth datasource 激活时（生产）每日 03:17 调用 purge，cutoff = now() - 180 天
  （retention 经 `virtual-companion.auth.audit-retention-days` 可配置，默认 180；cron 经
  `virtual-companion.auth.audit-purge-cron` 可配置，默认 `0 17 3 * * *`）。
- **DB 测试 62**：实证 purge 删旧留新（旧行删除、新行保留、返回计数正确）+ vc_api 不能直接 DELETE
  （角色越权 fail-closed）。
- **Java 单测**：调度器以正确 SQL + cutoff 调用 purge 函数，retention 天数驱动 cutoff 计算。

## 范围内

1. `V22__identity_auth_event_retention_purge.sql`（新增 migration，不改 V1-V21）：
   - `SET search_path TO vc, pg_catalog`（脚本会话）。
   - `CREATE FUNCTION vc.identity_auth_event_purge(p_cutoff timestamptz) RETURNS integer`，`LANGUAGE plpgsql`、
     `SECURITY DEFINER`、`SET search_path = vc, pg_catalog`。校验 `p_cutoff IS NOT NULL`（null → RAISE EXCEPTION）；
     `DELETE FROM vc.identity_auth_event WHERE occurred_at < p_cutoff`；`GET DIAGNOSTICS v_deleted = ROW_COUNT`；
     `RETURN v_deleted`。
   - `REVOKE EXECUTE ON FUNCTION vc.identity_auth_event_purge(timestamptz) FROM PUBLIC;`
   - `GRANT EXECUTE ON FUNCTION vc.identity_auth_event_purge(timestamptz) TO vc_api;`
2. `infra/db/tests/62_identity_auth_event_purge.sql`（新增 DB 测试，run-rls-tests.sh 自动 glob 发现）：
   - `\set ON_ERROR_STOP on`；以 superuser `TRUNCATE` identity 表 + INSERT 多行审计事件（部分 `occurred_at =
     now() - interval '200 days'` 旧、部分 `occurred_at = now()` 新）。
   - `SET ROLE vc_api;` 正向：`SELECT vc.identity_auth_event_purge(now() - interval '180 days')` → 断言返回计数 =
     旧行数；旧行（occurred_at < cutoff）count=0；新行仍存在（count 不变）。用 DO 块 count 比较。
   - 负向：DO 块 `DELETE FROM vc.identity_auth_event` → 期望 `insufficient_privilege`（vc_api 无表级 DELETE，
     镜像 test 52 模式）。`RESET ROLE;`
3. `AuthDataSourceConfig.java`：类上加 `@EnableScheduling`（仅当 `auth.enabled` + `datasource-enabled` 条件
   满足时激活，即生产有 DB 时调度才生效）；新增 `@Bean identityAuthEventPurgeScheduler(authJdbcTemplate,
   @Value("${virtual-companion.auth.audit-retention-days:180}") retentionDays)`。
4. `IdentityAuthEventPurgeScheduler.java`（新增，auth/config 包，plain class 经 @Bean 装配，镜像 AdminSeedRunner
   风格）：构造注入 `JdbcTemplate authJdbcTemplate` + `int retentionDays`；方法
   `@Scheduled(cron = "${virtual-companion.auth.audit-purge-cron:0 17 3 * * *}") purgeExpiredAuthEvents()`：
   cutoff = `Instant.now().minus(retentionDays, ChronoUnit.DAYS)`；`authJdbcTemplate.queryForObject("SELECT
   vc.identity_auth_event_purge(?)", Integer.class, Timestamp.from(cutoff))`（镜像 IdentityAccountRepository 的
   queryForObject Long 模式）；info 日志记录删除数；异常向上传播（不吞）。
5. `IdentityAuthEventPurgeSchedulerTest.java`（新增单测）：mock JdbcTemplate，调用 purgeExpiredAuthEvents()，
   验证以精确 SQL `"SELECT vc.identity_auth_event_purge(?)"` + `Integer.class` + `Timestamp` 参数调用一次；
   验证 retentionDays 驱动 cutoff（如 retentionDays=180 时 cutoff 约 180 天前）。不依赖 Spring 上下文（plain
   实例化，与既有 auth/config 单测隔离风格一致）。
6. `SchemaReadinessHealthIndicatorTest.java`：`expectedSchemaVersionFromClasspathFindsNewestMigration` 断言
   21→22（V22 加入 classpath 后最新 migration 版本为 22；该测试是加 migration 的必然附带变更）。
7. 终态治理闭环：canonical precheck + run-rls-tests.sh + runtime 模块定向测试 + git diff --check + 独立 R1 +
   Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不改任何已执行 migration（V1-V21 frozen，Flyway checksum 安全）；只新增 V22。
- 不改 V14 的 identity 表结构、现有 SD 函数签名/体（purge 是全新函数，非 CREATE OR REPLACE 现有函数，
  故不重新盖写 V18 已设的 proconfig）。
- 不给 vc_api 或任何运行角色表级 DELETE/UPDATE/INSERT 授权（purge 经 SECURITY DEFINER 函数边界执行；
  vc_api 仅获该函数 EXECUTE）。
- 不改 `application.yaml`（retention/cron 经 @Value 默认值提供，生产 profile 不需新属性；如需调参走环境变量）。
- 不改 `VirtualCompanionRuntimeApplication.java`（@EnableScheduling 放 AuthDataSourceConfig，不触碰主类）。
- 不引入新依赖（@Scheduled/@EnableScheduling 是 spring-context 已有，runtime 已依赖 spring-boot-starter-web
  传递 spring-context；无新 Maven 依赖）。
- 不触碰 .harness/**（除 project-state/task-ledger 终态更新）、specs、skills、scripts/harness、ci、frontend。
- 不改 AuthService/AuthController/AuthRequests/AdminSeedRunner（密码策略卡 TASK-0169 已闭环，本卡只加 purge）。
- 审计聚合（跨表/跨 sink 汇总）非本卡；本卡只做单表保留期 purge。

## 输入和前置条件

- Base `d44a854a2f9d4a923c5a0c460eba4e36baafde20` = TASK-0169 ACCEPTED terminal（已 push、HEAD==origin/main、
  0/0、clean；nextAction 三处 sha256 `8190d4b2…` 一致）。
- DRAFT 前已跑基线确认无 pre-existing 失败：`mvn -pl service/apps/runtime -am test` BUILD SUCCESS 238/0
  （与 TASK-0169 一致）；`bash infra/db/run-rls-tests.sh` ALL TESTS PASS（到 test 61）——确认 writeAllowlist
  文件无 stale 测试阻塞、V1-V21 + test 01-61 基线绿。
- 本卡 context lock 输入钉在 Base（47 inputs）；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1…`）；contextFingerprint `b6c72ea3…` 已用复刻 verify_context_lock
  算法生成并自验（先复现 TASK-0169 `2c16e275…` 通过）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`；Docker 用 OrbStack（`~/.orbstack/bin/docker`，
  context=orbstack）。
- 关键事实：V14 `identity_auth_event` 列 = id/event_type/account_id/username/occurred_at（append-only，无 PII，
  无 password/token）；vc_api 经 V14:416-425 仅获 8 个 INSERT 函数的 EXECUTE，无表级 DML、无 DELETE；
  V18 把全部 SD 函数 search_path 改为 `vc, pg_catalog`（pg_proc 循环，apply-time 生效），V22 新函数须自声明
  `SET search_path = vc, pg_catalog` 满足 RISK-09 基线（test 57）；run-rls-tests.sh 自动 glob `[0-9][0-9]*_*.sql`
  发现 test 62，V*.sql 自动排序发现 V22，无需改脚本。

## API / 事件 / 数据契约

- 产品 API 不变（purge 是内部调度任务，无新端点、无新错误码、不改 OpenAPI）。
- 数据契约：新增 V22 purge 函数（DB 内部）；identity_auth_event 表结构不变（无新列、无新约束）。
  vc_api 新增对 `identity_auth_event_purge(timestamptz)` 的 EXECUTE；不新增表级权限。
- 不新增事件、不新增表、不改现有函数签名。

## 权限、RLS 和数据处理要求

- purge 函数 SECURITY DEFINER：以函数 owner（迁移 principal）身份执行 DELETE，绕过 vc_api 无表级 DELETE
  的限制。这是受控的单一边界（只删 occurred_at < cutoff 的审计行），不开放任意 DELETE。
- vc_api 仅获 `identity_auth_event_purge(timestamptz)` 的 EXECUTE；REVOKE FROM PUBLIC；不获 identity_auth_event
  表级 DELETE/UPDATE/INSERT/SELECT（V14 授权基线不变）。
- identity_auth_event 是平台级审计表（无 RLS、无 owner_user_id），purge 删过保留期的审计行不影响租户隔离
  （INV-TENANT-001：运行角色无 BYPASSRLS、不能读他 owner——审计表本就不含租户业务数据）。
- purge 不删 password/token（表本就不存）；只删 event_type/account_id/username/occurred_at 审计元数据行。
- @Scheduled 调度线程由 Spring 默认单线程 TaskScheduler 执行（无并发 purge）；purge 幂等（多次运行安全，
  后续运行删 0 行或仅新过期的行）。

## 状态机和失败行为

- purge 函数 p_cutoff null → RAISE EXCEPTION（fail-closed，不删全表）。
- purge 正常 → DELETE occurred_at < cutoff，返回删除行数（可为 0）。
- vc_api 直接 DELETE identity_auth_event → insufficient_privilege（fail-closed，test 62 实证）。
- @Scheduled 调度：auth datasource 未激活（默认/test）→ 调度器 bean 不创建、@EnableScheduling 不激活 →
  无 purge 发生（正确：无 DB 无需 purge）。auth datasource 激活（生产）→ 每日 03:17 触发 purge。
- purge 期间 DB 异常 → 异常向上传播到调度器（Spring 会记录），不影响其他子系统；下次调度重试。
- 正式门禁非 PASS → 停止 promotion，如实 REJECTED；硬熔断 90min 到达 → closure-only overrun。

## 验收标准

1. `V22__identity_auth_event_retention_purge.sql`：新增 `vc.identity_auth_event_purge(p_cutoff timestamptz)
   RETURNS integer`，SECURITY DEFINER，`SET search_path = vc, pg_catalog`，DELETE occurred_at < p_cutoff 并
   RETURN count；p_cutoff null → RAISE EXCEPTION；`REVOKE ... FROM PUBLIC` + `GRANT EXECUTE ... TO vc_api`。
   不改 V1-V21。
2. `62_identity_auth_event_purge.sql`：purge 删除旧行（occurred_at < cutoff）且保留新行；返回计数 = 旧行数；
   vc_api 直接 DELETE → insufficient_privilege fail-closed。run-rls-tests.sh 含 test 62 全 PASS（62 项）。
3. `AuthDataSourceConfig` 加 `@EnableScheduling` + `@Bean identityAuthEventPurgeScheduler`；scheduler 注入
   authJdbcTemplate + retentionDays（@Value 默认 180）。
4. `IdentityAuthEventPurgeScheduler`：`@Scheduled(cron = "${...:0 17 3 * * *}") purgeExpiredAuthEvents()`
   以 `SELECT vc.identity_auth_event_purge(?)` + Timestamp cutoff 调用；retentionDays 驱动 cutoff。
5. `IdentityAuthEventPurgeSchedulerTest`：plain 实例化（无 Spring 上下文），mock JdbcTemplate，验证精确 SQL +
   参数类型 + retentionDays→cutoff 关系；runtime 模块测试全 PASS（≥240，含新增 2 调度器测试）。
6. `SchemaReadinessHealthIndicatorTest.expectedSchemaVersionFromClasspathFindsNewestMigration` 断言 22
   （V22 为 classpath 最新版本）。
7. `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（0 失败，0 skip）。
8. 唯一 `bash infra/db/run-rls-tests.sh` ALL TESTS PASS（含 test 62）。
9. 唯一 canonical precheck `python scripts/harness/precheck.py --task TASK-0170` 8/8 PASS；唯一
   `git diff --check` exit 0。
10. R1 独立复核 PASS（C4 DB 必须；0 P0/P1/P2）。
11. 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean；
    remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 一次；run-rls-tests.sh 一次含 test 62；
runtime 模块定向测试一次；同一无参 `git diff --check` 一次）。完整 Harness unittest 与根级 Maven verify 按
Owner 2026-08-12 static-gates-only 策略 deferred to 统一全项目复审。

## 回滚或前向修复

- 若 run-rls-tests.sh 暴露 purge 函数权限/search_path 问题：最多 1 个 fix batch 修 V22（不删测、不加 skip、
  不改 V1-V21）。
- 若 runtime 单测暴露 @EnableScheduling/调度器装配问题：最多 1 个 fix batch 修 runtime 代码。
- 若 R1 发现阻塞项：最多 1 个 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须触碰 V1-V21 或非 writeAllowlist 路径：立即停止，向 Owner 申请范围升级（自批禁止）。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 V1-V21、.harness/**、
  scripts/harness/**、specs/**、application.yaml 等）。
- 正式 Precheck / run-rls-tests.sh / runtime 定向测试 / diff check / pre-closure 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0 的 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0170/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0170.json`。
