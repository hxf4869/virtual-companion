# TASK-0164：§5.1.3 provider_attempt 授权快照 DB 强制（INV-AUTH-001）

```yaml
taskId: TASK-0164
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
baseCommit: fd7b64653f771a88989494122c8a10fcb54f810a
authorizationCommit: ""
contextFingerprint: f732afcc74ecdc064439d5c5a720a1296e2a43012a095b259dde6c7f0ff530ef
contextLock: docs/tasks/context/TASK-0164.context-lock.yaml
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
  surfaceId: TASK_0164_PROVIDER_ATTEMPT_AUTHORIZATION_SNAPSHOT
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
  - python scripts/harness/precheck.py --task TASK-0164
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
  - docs/evidence/TASK-0163/evidence-pack.json
  - docs/evidence/TASK-0163/review-r1.md
  - docs/handoffs/TASK-0163.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - infra/db/tests/58_admin_seed_concurrent.sql
  - infra/db/run-rls-tests.sh
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql
  - infra/db/tests/40_provider_attempt_rls.sql
  - infra/db/tests/54_sd_owner_mismatch_fail_closed.sql
  - infra/db/tests/55_sd_missing_context_fail_closed.sql
  - infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql
  - docs/tasks/TASK-0164-provider-attempt-authorization-snapshot-db-enforcement.md
  - docs/tasks/context/TASK-0164.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0164/**
  - docs/handoffs/TASK-0164.json
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
  - docs/tasks/TASK-0162-*
  - docs/tasks/TASK-0163-*
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
  - docs/tasks/context/TASK-0162.context-lock.yaml
  - docs/tasks/context/TASK-0163.context-lock.yaml
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
  - docs/evidence/TASK-0162/**
  - docs/evidence/TASK-0163/**
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
  - docs/handoffs/TASK-0162.json
  - docs/handoffs/TASK-0163.json
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
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-3][0-9]_*.sql
  - infra/db/tests/4[1-9]_*.sql
  - infra/db/tests/5[0-3]_*.sql
  - infra/db/tests/56_*.sql
  - infra/db/tests/57_*.sql
  - infra/db/tests/58_*.sql
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
  - docs/handoffs/TASK-0163.json
requiredInvariants:
  - INV-AUTH-001
  - INV-TENANT-001
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
      Owner 2026-08-11/2026-08-12 授权长线审计修复一次一张新卡推进；TASK-0163（§5.1.1）ACCEPTED
      闭环后接续评估剩余 OPEN 项。经当前 HEAD fd7b646 复核（explore agent 全量证据链）确认
      §5.1.3 provider_attempt 授权快照缺陷真实存在：V15 provider_attempt 仅 7 列，缺失
      requested/execution_authorization_snapshot 列与指向 authorization_snapshot 的 FK，
      INV-AUTH-001 声明的 not_null_constraint + composite_foreign_key 在 DB 层完全缺失
      （仅 Java InvocationBinding 内存 requireNonBlank 软约束）。可独立修复，不依赖 P1-04
      （V17 已落地 trusted-context）。本卡限定纯 DB 层强制（V20 + DB tests），不触 Java
      侧：当前无 Java 生产代码调用 record_provider_attempt（P2-12 JDBC 层仍 PLANNED），
      Java ProviderAttemptAudit/LiveModelInvoker audit 投影修复留后续独立 C3 卡或并入 P2-12。
      C4 database-migration + humanApproval(scope: database-migration) + 独立 Reviewer +
      static-gates-only 验证（完整 Harness unittest 留统一审计）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 授权 §5.1.3 provider_attempt 授权快照 DB 强制：新增 V20 migration
      （不改历史 V1-V19，避免 Flyway checksum 破坏）——ALTER vc.provider_attempt ADD COLUMN
      requested_authorization_snapshot text NOT NULL, ADD COLUMN execution_authorization_snapshot
      text NOT NULL；加两条复合 FK 指向 vc.authorization_snapshot(owner_user_id, snapshot_id)
      复合主键（符合 INV-AUTH-001 composite_foreign_key）；DROP + CREATE record_provider_attempt
      新签名追加 p_requested_authorization_snapshot/p_execution_authorization_snapshot text 两参数，
      保留 V17 trusted-context 校验段（PERFORM vc.assert_current_owner_trusted 语义）+ 扩 INSERT
      列清单 + REVOKE FROM PUBLIC/GRANT TO vc_api；search_path=vc,pg_catalog（与 V18/V19 一致）。
      FK 目标用 authorization_snapshot 复合 PK (owner_user_id, snapshot_id)（V3:22），非 UNIQUE(snapshot_id)，
      以严格满足 composite_foreign_key 语义。fresh migration 无 provider_attempt 历史行（无生产写入端），
      ADD COLUMN NOT NULL 无回填难题。改 test 40（列数断言 7→9 + 调用签名扩展）、test 54/55（调用签名
      扩展，V17 fail-closed 场景）、新增 test 59（INV-AUTH-001 integration_test：FK 命中正向、
      未知 snapshot_id fail-closed、跨 owner snapshot 借用被拒）。DB 变更跑 run-rls-tests.sh
      （OrbStack pgvector/pgvector:0.8.5-pg18 digest-pinned，当前 58 → 59 测试）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS（TASK-0163 R1 PASS 不复用）。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §5.1.3 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §3 表与 §5.1.3）：给 V15
> `vc.provider_attempt` 补 requested/execution authorization snapshot 列、复合 FK，并拓宽
> `record_provider_attempt` SECURITY DEFINER 函数签名，使 INV-AUTH-001 的 not_null_constraint +
> composite_foreign_key 在 DB 层强制落地（当前仅 Java 内存软约束）。沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与
> TASK-0153..0163 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§5.1.3（TASK-0109 审计 §5.1.3 / INV-AUTH-001）：INV-AUTH-001 声明
"every external model attempt binds requested and execution authorization snapshots"，
enforcement 为 `[not_null_constraint, composite_foreign_key, integration_test]`。

**缺陷（经当前 HEAD fd7b646 代码核实）**：
- `V15__provider_attempt_terminal_transitions.sql:26-41` 的 `vc.provider_attempt` 表仅 7 列
  （owner_user_id, id, generation_id, provider_id, supplier_name, status, created_at），
  **完全缺失** `requested_authorization_snapshot` 与 `execution_authorization_snapshot` 列，
  也无任何 FK 指向 `vc.authorization_snapshot`。
- `V17__sd_owner_param_trusted_assertion.sql:1700-1756` 重定义的 `vc.record_provider_attempt`
  函数签名仅 5 参数（p_owner_user_id, p_generation_id, p_provider_id, p_supplier_name, p_status），
  INSERT 子句不写 snapshot 列。
- 契约层 `contract/InvocationBinding.java` 的 `ExternalAttemptBinding` 已在内存持有
  `requestedAuthorizationSnapshotId` / `executionAuthorizationSnapshotId` 且 `requireNonBlank`
  硬约束（:24-39），路由层 `routing/DeterministicRouter.java:135-153` 已能产出两者；
  但投影点 `execution/LiveModelInvoker.java:291-302` 把 binding 投影成
  `execution/ProviderAttemptAudit.java:17-22` 时**丢弃**两个 snapshot_id，且 DB schema
  从无落库位置。

**结论**：INV-AUTH-001 的三项 enforcement 中，DB 层 `not_null_constraint` 与
`composite_foreign_key` 完全缺失；仅靠 Java 内存 `requireNonBlank` 软满足。本卡把这两项
在 DB 层强制落地（`integration_test` 由新增 test 59 承载）。

**范围限定（纯 DB 卡）**：本卡只做 DB 层强制，不改 Java 侧。当前**无任何 Java 生产代码**调用
`record_provider_attempt`（grep `*.java` 命中全在注释/测试断言；JDBC 持久化层 P2-12 仍 PLANNED），
因此 Java `ProviderAttemptAudit`/`LiveModelInvoker` 的 audit 投影修复没有运行时验证对象，
留作后续独立 C3（modelruntime）卡或并入 P2-12。DB 层强制只关心"凡写入 provider_attempt 的行
必须绑定双 snapshot"，与 Java 内存投影相互独立。

用户可观察结果：
1. `vc.provider_attempt` 新增 `requested_authorization_snapshot` / `execution_authorization_snapshot`
   两列，均 `text NOT NULL`。
2. 两条复合 FK 指向 `vc.authorization_snapshot(owner_user_id, snapshot_id)` 复合主键，强制每个
   provider attempt 行绑定本 owner 下的真实 snapshot 行（跨 owner 借用被 FK 拒绝）。
3. `vc.record_provider_attempt` 函数签名拓宽 2 参数（两 snapshot text，与 Java 契约 requireNonBlank
   对齐），INSERT 写入两列；保留 V17 trusted-context 校验段与 GRANT/REVOKE。
4. 新增 `59_provider_attempt_authorization_snapshot_fk.sql` 机器证明 INV-AUTH-001：FK 正向命中、
   未知 snapshot_id fail-closed、跨 owner snapshot 借用被拒。
5. 不修改任何既有 migration（V1-V19 冻结，Flyway checksum 安全）；仅新增 V20。
6. 终态治理闭环：run-rls-tests.sh（59 测试 PASS）+ canonical precheck 8/8 + git diff --check +
   独立 R1 静态复核 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **新增 `service/platform/persistence/src/main/resources/db/migration/V20__provider_attempt_authorization_snapshot.sql`**：
   - 头部 `SET search_path TO vc, pg_catalog;`。
   - `ALTER TABLE vc.provider_attempt ADD COLUMN requested_authorization_snapshot text NOT NULL,
     ADD COLUMN execution_authorization_snapshot text NOT NULL;`（fresh migration 无历史行，
     NOT NULL 安全）。
   - 两条复合外键：
     `ALTER TABLE vc.provider_attempt ADD CONSTRAINT provider_attempt_requested_auth_snapshot_fk
     FOREIGN KEY (owner_user_id, requested_authorization_snapshot)
     REFERENCES vc.authorization_snapshot(owner_user_id, snapshot_id);`
     execution 同理（`provider_attempt_execution_auth_snapshot_fk`）。FK 目标为 V3 authorization_snapshot
     复合 PK `(owner_user_id, snapshot_id)`（V3:22），严格满足 `composite_foreign_key` 语义。
   - `DROP FUNCTION IF EXISTS vc.record_provider_attempt(bigint, bigint, text, text, text);`
     （CREATE OR REPLACE 不能改参数列表，必须 DROP+CREATE）。
   - `CREATE FUNCTION vc.record_provider_attempt(p_owner_user_id bigint, p_generation_id bigint,
     p_provider_id text, p_supplier_name text, p_status text, p_requested_authorization_snapshot text,
     p_execution_authorization_snapshot text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
     SET search_path = vc, pg_catalog AS $$ ... $$;`
     函数体保留 V17 的 trusted-context 校验段（current_owner_id trusted assertion），id 生成
     （generation sequence）、INSERT 扩展两 snapshot 列、RETURN；逻辑与 V17 逐行等价仅增列写入。
   - `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO vc_api;`
     （沿用 V15:116-121 / V17 权限模式）。
   - 不改任何既有表结构（authorization_snapshot、generation、RLS policy、角色）；不改 V1-V19。
2. **改 `infra/db/tests/40_provider_attempt_rls.sql`**：
   - 列数断言 `c <> 7` → `c <> 9`（:33-37）。
   - 扩展 `record_provider_attempt(...)` 调用为 7 参数（:46/62/70/78/101 等调用点追加两 snapshot 参数）。
3. **改 `infra/db/tests/54_sd_owner_mismatch_fail_closed.sql`** 与
   **`infra/db/tests/55_sd_missing_context_fail_closed.sql`**：
   - 扩 `record_provider_attempt` 调用签名为 7 参数（:117 / :121）。
4. **新增 `infra/db/tests/59_provider_attempt_authorization_snapshot_fk.sql`**（INV-AUTH-001
   `integration_test` 承载，参照 test 06/51 snapshot 既有测试 + test 58 dblink 模式不必要，
   本 test 为单 session 正负断言）：
   - 正向：为本 owner 先 seed authorization_snapshot 行（V3 路径），再调
     `record_provider_attempt` 传入该 snapshot_id，FK 命中、行写入成功、两列值正确。
   - 负向 A：传入不存在的 snapshot_id（本 owner 无该行），FK 违反 fail-closed（`foreign_key_violation`）。
   - 负向 B：跨 owner snapshot 借用（owner 1 的 snapshot_id 用于 owner 2 的 provider_attempt），
     复合 FK 因 owner_user_id 不匹配 fail-closed。
   - 负向 C（可选）：snapshot 列传 NULL 应被 NOT NULL 拒绝（函数参数已 NOT NULL 约束或显式断言）。
5. 终态治理闭环：run-rls-tests.sh + canonical precheck + git diff --check + R1 + Evidence/Handoff/
   pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不修改任何既有 migration（V1-V19），避免破坏 Flyway checksum。
- 不改 `record_provider_attempt` 的 SECURITY DEFINER、owner、trusted-context 校验语义（仅 DROP+CREATE
  拓宽参数与 INSERT 列，保留 V17 逐行逻辑）。
- 不改 provider_attempt 表的 PK、generation FK、status CHECK、RLS policy、列除新增两 snapshot 外的任何列。
- 不改 authorization_snapshot 表结构（V3 冻结）。
- **不改任何 Java 代码**（ProviderAttemptAudit.java / LiveModelInvoker.java / InvocationBinding.java /
  DeterministicRouter.java 等 service/** 全 forbidden）。Java audit 投影一致性留后续独立卡。
- 不动 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、
  `scripts/harness/**`、`.github/workflows/**`、`specs/**`、frontend、pom。
- 不引入新 Maven/pnpm 依赖（`license-inventory.yaml` 无改动）。
- 不处理其它审计项（§5.1.4 quota、§5.1.2 worker fence、§5.1.6 V8/V11 升级、P1-04/05/11 等）。
- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit。

## 输入和前置条件

- Base `fd7b64653f771a88989494122c8a10fcb54f810a` = TASK-0163 ACCEPTED terminal（已 push、0/0、clean；
  nextAction 与 docs/handoffs/TASK-0163.json byte-for-byte 一致，sha256 已校验）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- DB 测试：`bash infra/db/run-rls-tests.sh`（OrbStack `pgvector/pgvector:0.8.5-pg18` digest-pinned，
  匿名 `--rm` 容器，58 → 59 测试，约 2-4 min wall）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0164`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件契约变更。纯数据库 schema 增强：provider_attempt 表加两 NOT NULL 列 + 两复合 FK，
record_provider_attempt SD 函数拓宽签名。catalog/provider-attempt-statuses.yaml（status 枚举）不变。
database-ownership-contract.yaml 的所有权模型不变（provider_attempt 仍 owner_user_id 复合所有权）。

## 权限、RLS 和数据处理要求

- 强化授权审计边界：每个 external model attempt 行在 DB 层强制绑定 requested + execution authorization
  snapshot（INV-AUTH-001），跨 owner snapshot 借用被复合 FK 拒绝。
- 不改任何 RLS policy、不改任何角色 NOBYPASSRLS/BYPASSRLS 属性；provider_attempt 既有 FORCE RLS
  (V16) 覆盖新列（列级 RLS 默认用 USING，新列随表 RLS 保护）。
- record_provider_attempt 仍 SECURITY DEFINER + trusted-context（V17），GRANT EXECUTE 仅 vc_api，
  REVOKE PUBLIC 不变。
- 测试在临时容器内用 SYNTHETIC 数据，`--rm` 清理，满足 TEMPORARY_VOLUME_ONLY。

## 状态机和失败行为

- 实现 = 1 个新 migration（V20，~70 行）+ 改 3 个既有 test（40/54/55，签名与列数断言）+ 1 个新
  integration test（59，~80 行）。
- run-rls-tests.sh 59 测试全 PASS（含新增 59、改后的 40/54/55）。若 V20 的 ALTER/DROP/CREATE 因
  约束或签名漂移失败，run-rls-tests.sh 在 migration 应用阶段即失败（ON_ERROR_STOP=1），据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context
  fingerprint 一致、protected-path 技能匹配 `**/db/migration/**` → database-migration C4+humanApproval）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 120min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡强化数据库授权审计边界（INV-AUTH-001）。

## 验收标准

1. 新增 V20 migration 存在；头部为 `SET search_path TO vc, pg_catalog;`；含 ALTER provider_attempt
   加两 text NOT NULL 列、两复合 FK 指向 authorization_snapshot(owner_user_id, snapshot_id)、
   DROP+CREATE record_provider_attempt 拓宽 2 参数并保留 V17 trusted-context 校验 + GRANT/REVOKE。
2. 不修改 V1-V19 任何既有 migration（diff 仅新增 V20）。
3. run-rls-tests.sh 59 测试 PASS（含改后的 40/54/55、新增 59），exit 0。
4. test 40 列数断言改为 9；调用签名扩为 7 参数。
5. test 54/55 调用签名扩为 7 参数（V17 fail-closed 场景行为不变）。
6. 新增 test 59：FK 正向命中、未知 snapshot_id fail-closed、跨 owner 借用被拒（复合 FK owner 不匹配）。
7. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
8. 唯一无参数 `git diff --check` PASS（exit 0）。
9. R1 独立静态复核 PASS（C4 必须；0 P0/P1/P2）。
10. 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
    （Evidence 如实标注，不转换为 PASS）。
11. 终态 pre-closure PASS、单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
    remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
12. INV-AUTH-001 的 not_null_constraint + composite_foreign_key 在 DB 层强制落地
    （integration_test 由 test 59 机器证明）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `bash infra/db/run-rls-tests.sh` 跑一次（DB 变更直接门禁，59 测试，约 2-4 min）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands
  但本卡不跑，doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 run-rls-tests.sh 失败：最多 1 fix batch（修正 V20 函数体/约束或测试断言）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。V20 是前向新增 migration，
无需回滚既有历史（Flyway checksum 安全）；若 V20 本身有缺陷，下一张 replacement 卡以 REJECTED
terminal 为 Base 新增 V21 修正（不改 V20）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V19 既有 migration、test 01-39/41-49/50-53/56-58、
  任何 service/**.java）。
- run-rls-tests.sh / canonical precheck / diff check / pre-closure 任一非 PASS。
- V20 改变了 record_provider_attempt 的 SECURITY DEFINER/trusted-context 校验语义/GRANT/owner，
  或改变 provider_attempt 既有列/PK/generation FK/status CHECK/RLS。
- 候选身份变化或越界。
- hardFuseWallMinutes 120 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0164/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0164.json`。
