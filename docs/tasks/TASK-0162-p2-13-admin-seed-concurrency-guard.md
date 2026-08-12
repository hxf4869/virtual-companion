# TASK-0162：P2-13 admin seed 并发保护（advisory lock）

```yaml
taskId: TASK-0162
state: ACCEPTED
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
baseCommit: 0e0fd69bf9c506b38443b455554862ba83e1153f
authorizationCommit: "4b06b5e95c050c6995297f9f92ecb0bb5f04d8e8"
contextFingerprint: 20041b6f06ae61c7c15e4fac81c67b9eca8277d82cd0725e9d03982887685b89
contextLock: docs/tasks/context/TASK-0162.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 60
  targetWallMinutes: 90
  hardFuseWallMinutes: 120
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 90, hardFuseWallMinutes: 120, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 60, targetWallMinutes: 90, hardFuseWallMinutes: 120, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 60, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0162_ADMIN_SEED_CONCURRENCY_GUARD
  policySurfaces: [DATABASE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 30
  terminalCheckMinutesEstimate: 35
  estimatedWallMinutes: 50
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0162
  - bash infra/db/run-rls-tests.sh
  - python -m unittest discover -s scripts/harness/tests -p "test_*.py"
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0158/evidence-pack.json
  - docs/evidence/TASK-0158/review-r1.md
  - docs/handoffs/TASK-0158.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0158-risk-09-search-path-hardening.md
  - docs/tasks/task-card-template.md
  - infra/db/run-rls-tests.sh
  - infra/db/tests/39_identity_accounts_sessions.sql
  - infra/db/tests/48_refresh_rotate_concurrent.sql
  - owner-authorization://longline-2026-08-09
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - skills/database-migration/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V19__admin_seed_concurrency_guard.sql
  - infra/db/tests/58_admin_seed_concurrent.sql
  - docs/tasks/TASK-0162-p2-13-admin-seed-concurrency-guard.md
  - docs/tasks/context/TASK-0162.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0162/**
  - docs/handoffs/TASK-0162.json
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
  - docs/tasks/TASK-0159-*
  - docs/tasks/TASK-0160-*
  - docs/tasks/TASK-0161-*
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
  - docs/tasks/context/TASK-0156.context-lock.yaml
  - docs/tasks/context/TASK-0157.context-lock.yaml
  - docs/tasks/context/TASK-0158.context-lock.yaml
  - docs/tasks/context/TASK-0159.context-lock.yaml
  - docs/tasks/context/TASK-0160.context-lock.yaml
  - docs/tasks/context/TASK-0161.context-lock.yaml
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
  - docs/evidence/TASK-0159/**
  - docs/evidence/TASK-0160/**
  - docs/evidence/TASK-0161/**
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
  - docs/handoffs/TASK-0159.json
  - docs/handoffs/TASK-0160.json
  - docs/handoffs/TASK-0161.json
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
  - service/apps/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/**/*.java
  - service/**/pom.xml
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-8]__*.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/[0-4][0-9]_*.sql
  - infra/db/tests/5[0-7]_*.sql
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
  - .harness/tools.lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0158.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权长线审计修复一次一张新卡推进；2026-08-12 在 TASK-0158（RISK-09）ACCEPTED
      闭环后接续评估剩余 OPEN/OWNER_GATE 项。经当前 HEAD 核实（docs/evidence/TASK-0109/
      zcode-remediation-handoff.md §3 表大量标 OPEN 项已由历史卡闭环），P2-13 admin seed
      并发是 §6 执行顺序中最靠前的可做 single-surface 实施项。P2-13：V14 identity_admin_seed
      是 idempotent check-then-insert（SELECT WHERE role='ADMIN' 未 FOUND 则 INSERT），
      但无并发保护；两个实例并发启动存在 TOCTOU，可创建多个 bootstrap ADMIN。本卡新增 V19
      migration 用 advisory lock 串行化 check-then-insert。C4 database-migration +
      humanApproval(scope: database-migration) + 独立 Reviewer + static-gates-only 验证
      （完整 Harness unittest 留统一审计）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 授权 P2-13 admin seed 并发保护：新增 V19 migration（不改历史 V1-V18，
      避免 Flyway checksum 破坏）——用 CREATE OR REPLACE FUNCTION 重定义 vc.identity_admin_seed，
      在函数体开头加 PERFORM pg_advisory_xact_lock(hashtext('vc.identity_admin_seed.bootstrap'))
      串行化 bootstrap 的 check-then-insert（沿用 V9/V17 既有 pg_advisory_xact_lock(hashtext(...))
      模式）；签名/参数/返回类型/其余逻辑不变，search_path=vc,pg_catalog（与 V18 一致）。不采用
      partial unique index WHERE role='ADMIN'，因为 identity_account_create 允许 ACTIVE ADMIN
      经 API 创建第二个 ADMIN（V14 line 305-350，role 接受 ADMIN），partial index 会破坏该能力；
      advisory lock 语义中立，只保护 bootstrap 并发，不限制 ADMIN 总数。新增 58 号 cross-tenant
      并发测试（dblink 两 session 同时 seed，断言 count(ADMIN)=1 + 两返回值相同）。DB 变更跑
      run-rls-tests.sh（OrbStack pgvector/pgvector:0.8.5-pg18 digest-pinned，当前 57 → 58 测试）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS（TASK-0158 R1 PASS 不复用）。
independentReview: required
reviewers:
  - id: task0162_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: "1d2be92d62c3e4b7d32c75faffdef78d4436ae44"
    candidateTree: "4b13062a98030c28718459aacdc7e4683c18faff"
    evidencePath: docs/evidence/TASK-0162/review-r1.md
    reason: >-
      R1 PASS：0 P0/P1/P2。独立重跑全部静态门禁 PASS（fresh TMPDIR）：doctor 769584 checks、
      canonical precheck 8/8、run-rls-tests.sh 58/58（V1..V19 应用 + 58_admin_seed_concurrent PASS）、
      git diff --check exit 0。Diff scope 精确 5 文件全在 writeAllowlist；V1-V18 未改（Flyway checksum
      安全）。V19 仅 CREATE OR REPLACE identity_admin_seed 加事务级 advisory lock + search_path=vc,pg_catalog
      （不动签名/返回/SECURITY DEFINER/GRANT/INSERT/audit 逻辑）；test 58 dblink 两 session 真并发证明
      单 bootstrap ADMIN 唯一确定。advisory lock 方案对现有语义零变更。完整 unittest deferred per Owner
      static-gates-only 策略。
terminalStateReason: >-
  P2-13 admin seed 并发保护 ACCEPTED：新增 V19 migration（CREATE OR REPLACE FUNCTION vc.identity_admin_seed
  函数体开头加 pg_advisory_xact_lock(hashtext('vc.identity_admin_seed.bootstrap')) 串行化 bootstrap
  check-then-insert + search_path=vc,pg_catalog，其余逻辑与 V14 逐行等价，不改 V1-V18 历史）；58 号
  dblink 并发负测（两 session 同时 seed，断言 count(ADMIN)=1 + 两返回值相同 + vc_user/audit 一次）。
  run-rls-tests.sh 58/58 PASS（V1..V19 应用 + 含新增 58）；canonical precheck 8/8 PASS（doctor 769584 +
  7 子命令）；git diff --check exit 0；独立 C4 R1 静态复核 PASS（0 P0/P1/P2，fresh TMPDIR 独立重跑全部
  静态门禁）。无前向修复（所有门禁首跑 PASS）。完整 Harness unittest 按 Owner 2026-08-12 static-gates-only
  策略 deferred to unified audit（V19+test 58 静态全 PASS，DB 行为由 run-rls-tests.sh 58 测试直接验证）。
  candidate elapsed ~7 min（远低于 hardFuse 120）。remote exact-SHA 如实非 PASS（dispatchCount=0），
  LOCAL_EXACT_TREE_FALLBACK 冻结于 READY。P2-13（admin seed bootstrap 并发保护）完整落地。
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P2-13 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §3 表 P2-13 行与 §4.6）：
> 给 V14 `vc.identity_admin_seed` 的 idempotent check-then-insert 补 advisory lock 并发保护，
> 阻止多实例并发启动创建多个 bootstrap ADMIN。沿用 `owner-authorization://longline-2026-08-09`
> 长线授权（hash `cc0f91c1...`），与 TASK-0153..0161 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

P2-13（TASK-0109 审计 §3 表 / §4.6）：V14 `vc.identity_admin_seed` 是 platform bootstrap 路径，
由 `AdminSeedRunner` 在启动时调用。函数语义为 idempotent：先 `SELECT id FROM vc.identity_account
WHERE role = 'ADMIN' ORDER BY id LIMIT 1`，若 FOUND 则返回 existing id（no-op），否则 `nextval +
INSERT` 创建唯一 bootstrap ADMIN。

**缺陷**：该 check-then-insert 没有并发保护。当多个应用实例同时启动（或同一实例的并发初始化路径）
同时调用 `identity_admin_seed`，两个调用都会执行 SELECT（都未 FOUND），然后都执行 INSERT，
从而创建**多个 bootstrap ADMIN**，破坏"single bootstrap ADMIN"不变量并产生不可预期的重复种子。
这是经典的 check-then-act TOCTOU。现有 test 39 只覆盖了顺序 idempotent（第二次 no-op），未覆盖
真并发（test 48 的 dblink 模式证明本仓库已有并发测试基础设施）。

**产品语义（经当前 HEAD 代码核实）**：bootstrap 阶段最多一个 ADMIN（seed），但之后 ACTIVE ADMIN
可通过 `identity_account_create`（V14 line 305-350，role 接受 ADMIN）经 `/admin/accounts` API
创建更多 ADMIN。因此 partial unique index `WHERE role='ADMIN'` 不可行（会破坏 API 创建第二个 ADMIN
的能力）。**唯一正确方案是 advisory lock**：只串行化 seed 函数内的 check-then-insert，不限制
ADMIN 总数，语义完全中立。

用户可观察结果：
1. `vc.identity_admin_seed` 在函数体开头获取 `pg_advisory_xact_lock`，串行化并发 bootstrap。
2. 两个并发 seed 调用只有一个创建 ADMIN（winner），另一个 no-op 返回相同 existing id（loser）。
3. 新增 cross-tenant 并发负测 `58_admin_seed_concurrent.sql` 用 dblink 两 session 同时 seed，
   机器证明 count(ADMIN)=1 且两返回值相同。
4. 不修改任何既有 migration（V1-V18 冻结，Flyway checksum 安全）；仅新增 V19。
5. 终态治理闭环：run-rls-tests.sh（58 测试 PASS）+ canonical precheck 8/8 + git diff --check +
   独立 R1 静态复核 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **新增 `service/platform/persistence/src/main/resources/db/migration/V19__admin_seed_concurrency_guard.sql`**：
   - 头部 `SET search_path TO vc, pg_catalog;`。
   - `CREATE OR REPLACE FUNCTION vc.identity_admin_seed(p_username text, p_password_hash text,
     p_display_name text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
     SET search_path = vc, pg_catalog AS $$ ... $$;`，函数体在开头加
     `PERFORM pg_advisory_xact_lock(hashtext('vc.identity_admin_seed.bootstrap'));`，其余逻辑
     （username 规范化、非空校验、SELECT existing ADMIN → no-op、nextval + INSERT vc_user +
     identity_account + identity_auth_event、RETURN）与 V14 原定义逐行等价。
   - 不改函数签名、参数类型、返回类型、SECURITY DEFINER、LANGUAGE、owner、GRANT EXECUTE、
     REVOKE；CREATE OR REPLACE 保留 V14 既有的权限授予（vc_api EXECUTE、PUBLIC REVOKE）。
   - 不新增/不改任何表、约束、RLS、角色；不改 V1-V18。
2. **新增 `infra/db/tests/58_admin_seed_concurrent.sql`** cross-tenant 并发负测（参照 test 48
   dblink 模式）：
   - TRUNCATE identity 相关表。
   - 用 `dblink_connect` 建两个独立 session，各 `SET ROLE vc_api`（或以 superuser 身份直接调用，
     因 identity_admin_seed 仅 vc_api 有 EXECUTE）。
   - 用 `dblink_send_query` 让两 session **同时**调用 `vc.identity_admin_seed`（不同 username，
     以便区分 winner/loser 的意图），`dblink_get_result` 收集两个返回值。
   - 断言：`count(*) FROM vc.identity_account WHERE role='ADMIN' = 1`；两个返回值相同（= winner
     创建的 id）；loser 的 username 对应的账户不存在。
   - `dblink_disconnect` 清理。
3. 终态治理闭环：run-rls-tests.sh + canonical precheck + git diff --check + R1 + Evidence/Handoff/
   pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不修改任何既有 migration（V1-V18），避免破坏 Flyway checksum。
- 不改 identity_admin_seed 的签名、返回类型、SECURITY DEFINER、GRANT、owner、normalize/INSERT 逻辑
  （仅在函数体开头加 advisory lock 一行）。
- 不改 identity_account 表结构、不加 partial unique index（会破坏 identity_account_create 创建
  第二个 ADMIN 的能力，属产品语义变更，超出本卡范围）。
- 不改 AdminSeedRunner.java / AuthService.java / AuthController.java 等 Java 代码（并发保护在 DB 层）。
- 不动 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、
  `scripts/harness/**`、`.github/workflows/**`、`specs/**`、frontend、pom。
- 不引入新 Maven/pnpm 依赖（`license-inventory.yaml` 无改动）。
- 不处理其它审计项（P1-04/05/11、P2-12、P2-20..26、P3-*）。
- 不改变 admin seed 的产品语义（单 bootstrap ADMIN / 之后可经 API 增加 ADMIN 均不变）。
- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit。

## 输入和前置条件

- Base `0e0fd69bf9c506b38443b455554862ba83e1153f` = TASK-0158 ACCEPTED terminal（已 push、0/0、clean；
  Doctor summary PASS 928967 checks；HEAD tree `7cdccfea...`）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- DB 测试：`bash infra/db/run-rls-tests.sh`（OrbStack `pgvector/pgvector:0.8.5-pg18` digest-pinned
  `@sha256:12a379b4...`，匿名 `--rm` 容器，57 → 58 测试，约 2-4 min wall）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0162`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件/数据契约变更。纯数据库 SD 函数并发保护增强（函数体开头加 advisory lock 一行）。
identity_admin_seed 的输入参数、返回值（bigint account id）、idempotent 语义、audit event 写入
均不变。

## 权限、RLS 和数据处理要求

- 强化身份安全边界：bootstrap ADMIN 创建在并发下仍是唯一确定的，不会因竞态产生多个特权种子账户。
- 不改任何 RLS policy、不改任何角色 NOBYPASSRLS/BYPASSRLS 属性、不改 GRANT/REVOKE、不接触用户数据。
- advisory lock 是事务级（pg_advisory_xact_lock），函数事务结束自动释放，无跨事务残留、无死锁风险
  （单锁、无嵌套获取）。
- 测试在临时容器内用 SYNTHETIC 数据（占位 BCrypt hash），`--rm` 清理，满足 TEMPORARY_VOLUME_ONLY。

## 状态机和失败行为

- 实现 = 1 个新 migration（V19，~50 行，含完整 CREATE OR REPLACE FUNCTION 体）+ 1 个新并发负测
  （58，~70 行）。
- run-rls-tests.sh 58 测试全 PASS（含新增 58）。若 V19 的 CREATE OR REPLACE FUNCTION 因签名/逻辑
  漂移失败，run-rls-tests.sh 在 migration 应用阶段即失败（ON_ERROR_STOP=1），据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context
  fingerprint 一致、protected-path 技能匹配 `**/db/migration/**` → database-migration C4+humanApproval）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 120min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡强化数据库身份 bootstrap 并发安全边界。

## 验收标准

1. 新增 V19 migration 存在；头部为 `SET search_path TO vc, pg_catalog;`；含
   `CREATE OR REPLACE FUNCTION vc.identity_admin_seed(...)` 其函数体开头为
   `PERFORM pg_advisory_xact_lock(hashtext('vc.identity_admin_seed.bootstrap'));`，其余逻辑与
   V14 原定义等价（normalize/校验/SELECT-INSERT/audit/RETURN）。
2. 不修改 V1-V18 任何既有 migration（diff 仅新增 V19）。
3. run-rls-tests.sh 58 测试 PASS（含新增 `58_admin_seed_concurrent.sql`），exit 0。
4. 新增并发负测 58：两 dblink session 同时调用 identity_admin_seed，断言 count(ADMIN)=1、
   两返回值相同、loser username 账户不存在。
5. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
6. 唯一无参数 `git diff --check` PASS（exit 0）。
7. R1 独立静态复核 PASS（C4 必须；0 P0/P1/P2）。
8. 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
   （Evidence 如实标注，不转换为 PASS）。
9. 终态 pre-closure PASS、单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
10. 身份 bootstrap 并发安全强化（advisory lock 串行化 check-then-insert，单 bootstrap ADMIN
    在并发下唯一确定）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `bash infra/db/run-rls-tests.sh` 跑一次（DB 变更直接门禁，58 测试，约 2-4 min）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands
  但本卡不跑，doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 run-rls-tests.sh 失败：最多 1 fix batch（修正 V19 函数体或并发测试断言）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。V19 是前向新增 migration，
无需回滚既有历史（Flyway checksum 安全）；若 V19 本身有缺陷，下一张 replacement 卡以 REJECTED
terminal 为 Base 新增 V20 修正（不改 V19）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V18 既有 migration、test 01-57）。
- run-rls-tests.sh / canonical precheck / diff check / pre-closure 任一非 PASS。
- V19 修改了 identity_admin_seed 的签名/返回类型/SECURITY DEFINER/GRANT/owner，或改变了既有
  normalize/INSERT/audit 逻辑（超出"函数体开头加 advisory lock"范围）。
- 候选身份变化或越界。
- hardFuseWallMinutes 120 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0162/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0162.json`。
