# TASK-0158：RISK-09 SECURITY DEFINER search_path 收紧与 public CREATE 撤销

```yaml
taskId: TASK-0158
state: DRAFT
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
baseCommit: b21e344ea35c67523a63e947855113b8c3afb28b
authorizationCommit: ""
contextFingerprint: e10a18502859158e5ef0d34b583ed2a6ebcdfd131aba098772e13acf9e6c49b8
contextLock: docs/tasks/context/TASK-0158.context-lock.yaml
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
  surfaceId: TASK_0158_RISK_09_SEARCH_PATH_HARDENING
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
  - python scripts/harness/precheck.py --task TASK-0158
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
  - docs/evidence/TASK-0161/evidence-pack.json
  - docs/evidence/TASK-0161/review-r1.md
  - docs/handoffs/TASK-0161.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0161-p2-27-complete-ci-matrix-replacement.md
  - docs/tasks/task-card-template.md
  - infra/db/run-rls-tests.sh
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - infra/db/tests/56_runtime_role_cannot_migrate.sql
  - owner-authorization://longline-2026-08-09
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - skills/database-migration/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/database-ownership-contract.yaml
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql
  - infra/db/tests/57_search_path_public_create_fail_closed.sql
  - docs/tasks/TASK-0158-risk-09-search-path-hardening.md
  - docs/tasks/context/TASK-0158.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0158/**
  - docs/handoffs/TASK-0158.json
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
  - service/platform/persistence/src/main/resources/db/migration/V1[0-7]__*.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/[0-4][0-9]_*.sql
  - infra/db/tests/5[0-6]_*.sql
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
  - docs/handoffs/TASK-0161.json
requiredInvariants:
  - INV-TENANT-001
  - INV-WORKER-001
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
      Owner 2026-08-11 授权长线审计修复一次一张新卡推进；2026-08-12 在 P2-27（TASK-0161 ACCEPTED）
      闭环后明确接续 TASK-0158（RISK-09）。RISK-09（见 docs/evidence/TASK-0109/
      zcode-remediation-handoff.md §5.1/§5.3）：全部 SECURITY DEFINER 函数当前声明
      `SET search_path = vc, public`，若不可信 role 能在 public CREATE，可植入同名 shadow
      object 经 search_path 的 public 项劫持特权函数体内的解析。本卡收紧为 `vc, pg_catalog` +
      REVOKE CREATE ON SCHEMA public FROM PUBLIC + shadow-object 负测。C4 database-migration
      + humanApproval(scope: database-migration) + 独立 Reviewer + static-gates-only 验证
      （完整 Harness unittest 留统一审计）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 授权 RISK-09 search_path 收紧：新增 V18 migration（不改历史，避免 Flyway
      checksum 破坏）——用 ALTER FUNCTION 把 schema vc 下全部 SECURITY DEFINER 函数的 search_path
      改为 `vc, pg_catalog`（覆盖 V17 重定义的 34 个 + V5 inline 的 3 个 complete/fail/cancel_work_item），
      并 `REVOKE CREATE ON SCHEMA public FROM PUBLIC`；新增 57 号 cross-tenant 负测验证 (a) 所有 SD
      函数 proconfig=vc,pg_catalog 无 public；(b) runtime 角色对 public 无 CREATE；(c) public 同名
      函数 shadow 不可劫持。DB 变更跑 run-rls-tests.sh（OrbStack pgvector/pgvector:0.8.5-pg18
      digest-pinned，当前 56 → 57 测试）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS（TASK-0161 R1 PASS 不复用）。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 RISK-09 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §5.1 第 5 项与 §5.3 条件发布闸门表
> RISK-09 行）：把全部 SECURITY DEFINER 函数的 `SET search_path` 从 `vc, public` 收紧为
> `vc, pg_catalog`，撤销 `public` schema 的 CREATE 权限，并补 shadow-object 负测。沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0153..0161
> 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

RISK-09（TASK-0109 审计条件发布闸门）：schema `vc` 下全部 SECURITY DEFINER 函数
（V17 重定义的 34 个 + V5 inline 的 `complete_work_item`/`fail_work_item`/`cancel_work_item` 3 个，
共 37 个）当前声明 `SET search_path = vc, public`。由于这些函数以特权 owner 身份执行，若任一
不可信 role 能在 `public` schema 创建对象，攻击者可植入与某未限定名同名的 shadow object，借
search_path 的 `public` 项劫持特权函数体内的解析（对象劫持）。即便当前 SD 函数体多已用 `vc.`
显式限定，`public` 出现在 search_path 中仍是整类风险的开放面。

用户可观察结果：
1. 全部 37 个 SECURITY DEFINER 函数的 `SET search_path` 变为 `vc, pg_catalog`（`public` 移除）。
2. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`，runtime 角色（vc_api/vc_worker 等）无法在 public
   建对象，从源头杜绝 shadow object 植入。
3. 新增 cross-tenant 负测 `57_search_path_public_create_fail_closed.sql` 机器证明上述两点，并在
   public 植入同名函数 shadow 验证不可劫持。
4. 不修改任何既有 migration（V1-V17 冻结，Flyway checksum 安全）；仅新增 V18。
5. 终态治理闭环：run-rls-tests.sh（57 测试 PASS）+ canonical precheck 8/8 + git diff --check +
   独立 R1 静态复核 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **新增 `service/platform/persistence/src/main/resources/db/migration/V18__sd_search_path_pg_catalog_revoke_public_create.sql`**：
   - 头部 `SET search_path TO vc, pg_catalog;`。
   - 用一个 `DO` 块内省 `pg_proc`（`prosecdef = true` 且 `pronamespace = 'vc'`），对每个匹配函数
     `EXECUTE format('ALTER FUNCTION vc.%s(%s) SET search_path = vc, pg_catalog', quote_ident(proname), pg_get_function_identity_arguments(oid))`，
     覆盖全部 37 个 SD 函数（34 V17 + 3 V5 inline），仅改 `SET` 子句，签名/函数体/GRANT/RLS 不变。
   - `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`。
   - 不新增/不改任何表、约束、RLS、GRANT EXECUTE、角色；不改 V1-V17。
2. **新增 `infra/db/tests/57_search_path_public_create_fail_closed.sql`** cross-tenant 负测：
   - **G1**：遍历 `pg_proc`（`prosecdef=true`、`pronamespace='vc'`），断言每个 proconfig 含
     `search_path=vc, pg_catalog` 且不含 `public`；断言 SD 函数计数 ≥ 37。
   - **G2**：`has_schema_privilege('vc_api','public','CREATE')` 与 `vc_worker` 均 false；PUBLIC 对
     public 无 CREATE（nacl 检查）；runtime 角色尝试 `CREATE FUNCTION public.x()` 必须权限拒绝。
   - **G3**（shadow 劫持拒绝）：以超级用户在 public 植入同名函数 shadow
     `public.current_owner_id()`（返回伪造值）；建立真实 owner 上下文；证明
     `vc.current_owner_id()`（限定）与一个 `SET search_path = vc, pg_catalog` 的探针 SD 函数内的
     未限定 `current_owner_id()` 均不取 public shadow 值。
3. 终态治理闭环：run-rls-tests.sh + canonical precheck + git diff --check + R1 + Evidence/Handoff/
   pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不修改任何既有 migration（V1-V17），避免破坏 Flyway checksum。
- 不改任何函数签名、函数体逻辑、GRANT EXECUTE、RLS policy、表结构、角色定义。
- 不改 `search_path` 以外的任何 SD 函数属性（SECURITY DEFINER、LANGUAGE、RETAINS、owner 均不变）。
- 不动 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、
  `scripts/harness/**`、`.github/workflows/**`、`specs/**`、Java 代码、frontend、pom。
- 不引入新 Maven/pnpm 依赖（`license-inventory.yaml` 无改动）。
- 不处理其它审计项（P1-04/05、P1-11、P2-04/12/13、P2-20..26、P3-*）。
- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit。

## 输入和前置条件

- Base `b21e344ea35c67523a63e947855113b8c3afb28b` = TASK-0161 ACCEPTED terminal（已 push、0/0、clean；
  Doctor summary PASS 921298 checks；HEAD tree `a02a2bbc...`）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- DB 测试：`bash infra/db/run-rls-tests.sh`（OrbStack `pgvector/pgvector:0.8.5-pg18` digest-pinned
  `@sha256:12a379b4...`，匿名 `--rm` 容器，56 → 57 测试，约 2-4 min wall）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0158`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件/数据契约变更。纯数据库 SD 函数 search_path 属性 + public CREATE 权限收紧。

## 权限、RLS 和数据处理要求

- 强化 INV-TENANT-001（API/Worker 无 BYPASSRLS、不能读其他 owner）：移除 SD search_path 中的 public
  项 + 撤销 public CREATE，消除对象劫持路径。
- 强化 INV-WORKER-001（Worker 仅在有效 claim/lease/fence 后经 SD 函数读租户数据）：SD 函数体的解析
  不再可达不可信 public 对象。
- 不改任何 RLS policy、不改任何角色 NOBYPASSRLS 属性、不给任何角色 BYPASSRLS、不接触用户数据。
- 测试在临时容器内用 SYNTHETIC 数据，`--rm` 清理，满足 TEMPORARY_VOLUME_ONLY。

## 状态机和失败行为

- 实现 = 1 个新 migration（V18，~30 行）+ 1 个新 cross-tenant 负测（57，~120 行）。
- run-rls-tests.sh 57 测试全 PASS（含新增 57）。若 V18 的 ALTER FUNCTION 因签名/身份问题失败，
  run-rls-tests.sh 在 migration 应用阶段即失败（ON_ERROR_STOP=1），据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 会校验 writeAllowlist/forbiddenPaths 零冲突、context
  fingerprint 一致、protected-path 技能匹配 `**/db/migration/**` → database-migration C4+humanApproval）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 120min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡强化数据库对象解析与 schema CREATE 权限安全边界。

## 验收标准

1. 新增 V18 migration 存在；头部为 `SET search_path TO vc, pg_catalog;`；含一个 DO 块对全部
   `pg_proc(prosecdef=true, pronamespace='vc')` 执行 `ALTER FUNCTION ... SET search_path = vc, pg_catalog`；
   含 `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`。
2. 不修改 V1-V17 任何既有 migration（diff 仅新增 V18）。
3. run-rls-tests.sh 57 测试 PASS（含新增 `57_search_path_public_create_fail_closed.sql`），exit 0。
4. 新增负测 57 同时覆盖 G1（SD proconfig 全为 vc,pg_catalog 无 public，计数 ≥ 37）、
   G2（runtime 角色与 PUBLIC 对 public 无 CREATE，尝试 CREATE 被拒）、G3（public 同名函数 shadow
   不可劫持 SD 解析）。
5. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
6. 唯一无参数 `git diff --check` PASS（exit 0）。
7. R1 独立静态复核 PASS（C4 必须；0 P0/P1/P2）。
8. 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
   （Evidence 如实标注，不转换为 PASS）。
9. 终态 pre-closure PASS、单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
10. INV-TENANT-001/INV-WORKER-001 强化（SD search_path 移除 public + 撤销 public CREATE）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `bash infra/db/run-rls-tests.sh` 跑一次（DB 变更直接门禁，57 测试，约 2-4 min）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands
  但本卡不跑，doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 run-rls-tests.sh 失败：最多 1 fix batch（修正 V18 的 ALTER 逻辑或负测断言）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。V18 是前向新增 migration，
无需回滚既有历史（Flyway checksum 安全）；若 V18 本身有缺陷，下一张 replacement 卡以 REJECTED
terminal 为 Base 新增 V19 修正（不改 V18）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V17 既有 migration）。
- run-rls-tests.sh / canonical precheck / diff check / pre-closure 任一非 PASS。
- V18 修改了既有函数签名/函数体/GRANT/RLS（超出"仅改 SET search_path"范围）。
- 候选身份变化或越界。
- hardFuseWallMinutes 120 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0158/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0158.json`。
