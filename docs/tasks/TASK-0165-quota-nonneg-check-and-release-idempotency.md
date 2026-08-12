# TASK-0165：§5.1.4 quota 非负 CHECK + release 幂等

```yaml
taskId: TASK-0165
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
baseCommit: 5f2df58a6221b7646671db2e7faf8db4e1515144
authorizationCommit: "37c34315c156f235bd6038609301ee650d595be7"
contextFingerprint: 82cd641d51bab3a7faada73f85718eaa2e02d197298f3da6e6cd41ab309ed00b
contextLock: docs/tasks/context/TASK-0165.context-lock.yaml
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
  surfaceId: TASK_0165_QUOTA_NONNEG_AND_RELEASE_IDEMPOTENCY
  policySurfaces: [DATABASE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 30
  terminalCheckMinutesEstimate: 35
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0165
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
  - docs/evidence/TASK-0164/evidence-pack.json
  - docs/evidence/TASK-0164/review-r1.md
  - docs/handoffs/TASK-0164.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0164-provider-attempt-authorization-snapshot-db-enforcement.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - service/platform/persistence/src/main/resources/db/migration/V17__sd_owner_param_trusted_assertion.sql
  - infra/db/tests/43_candidate_and_quota_release.sql
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - infra/db/run-rls-tests.sh
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql
  - infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql
  - docs/tasks/TASK-0165-quota-nonneg-check-and-release-idempotency.md
  - docs/tasks/context/TASK-0165.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0165/**
  - docs/handoffs/TASK-0165.json
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
  - docs/tasks/TASK-0164-*
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
  - docs/tasks/context/TASK-0164.context-lock.yaml
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
  - docs/evidence/TASK-0164/**
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
  - docs/handoffs/TASK-0164.json
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
  - service/platform/persistence/src/main/resources/db/migration/V20__*.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-3][0-9]_*.sql
  - infra/db/tests/4[0-9]_*.sql
  - infra/db/tests/5[0-9]_*.sql
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
  - docs/handoffs/TASK-0164.json
requiredInvariants:
  - INV-TX-001
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
      Owner 2026-08-11/2026-08-12 授权长线审计修复一次一张新卡推进；TASK-0164（§5.1.3 provider_attempt
      授权快照 DB 强制 INV-AUTH-001）ACCEPTED 闭环后接续评估剩余 OPEN 项。经当前 HEAD 5f2df58 串行复核
      （V7/V15/V17/test 43/QuotaLedger.java/GenerationRecovery.java 全量证据链）确认 §5.1.4 缺陷真实存在：
      （1）generation_usage.{input_tokens,output_tokens,actual_cost} 与 quota_ledger_entry.quota_amount 四列
      在 DB 层无数值非负 CHECK（V7:80-108 仅有 kind/status 枚举 CHECK 与 DEFAULT 0），finalize_generation
      （V7:178-328）对 p_input_tokens/p_output_tokens/p_actual_cost/p_quota_amount 入参无符号校验直接 INSERT，
      负数 usage/SETTLE 可落库；（2）record_quota_release（V17:1904-1950）虽有非负函数守卫（V17:1927，handoff
      清单此处"无符号校验"已过时），但每次调用盲插 RELEASE 行，无 per-generation 单次转换守卫，重复调用插两行。
      可纯 DB 修复，不依赖 P1-04（V17 已落地 trusted-context）。本卡限定纯 DB 层（V21 + 新 test 60），不改 Java
      （内存 QuotaLedger.release owner 级 ceiling 钳制粗粒度非 reservation 级幂等，收 reservationId 留后续 Java
      卡或并入 P2-12）。C4 database-migration + humanApproval(scope: database-migration) + 独立 Reviewer +
      static-gates-only 验证（完整 Harness unittest 留统一审计）。
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 授权 §5.1.4 quota 非负 CHECK + release 幂等：新增 V21 migration（不改历史 V1-V20，
      避免 Flyway checksum 破坏）——(a) ALTER generation_usage ADD CONSTRAINT input_tokens/output_tokens/
      actual_cost CHECK(>=0) 三条 + ALTER quota_ledger_entry ADD CONSTRAINT quota_amount CHECK(>=0) 一条
      （DO $$ IF NOT EXISTS 守卫，幂等，镜像 V7 FK 约束模式）；(b) CREATE UNIQUE INDEX IF NOT EXISTS
      quota_ledger_release_one_per_generation ON quota_ledger_entry(owner_user_id, generation_id)
      WHERE kind='RELEASE'（per-generation 单次 RELEASE 复合唯一，并发 backstop）；(c) CREATE OR REPLACE
      record_quota_release（签名 (bigint,bigint,integer,text) 不变 → 无需 DROP/GRANT，CREATE OR REPLACE
      保留 V15 EXECUTE 权限），在 generation-exists 校验后、INSERT 前加幂等守卫：若该 (owner,generation)
      已存在 RELEASE 行则返回既有 entry_id（no-op，非负校验仍先于幂等检查以保留 test 43 负向语义）；
      函数体全 schema-qualified，保留 V17 trusted-context 校验段逐行。fresh migration 无历史负数行（DEFAULT 0
      满足 CHECK），ADD CONSTRAINT 无回填难题。新增 test 60（§5.1.4 integration_test：finalize 负 input
      check_violation + record_quota_release 二次调用幂等 no-op 仅一行 RELEASE + quota_amount CHECK backstop）。
      DB 变更跑 run-rls-tests.sh（OrbStack pgvector/pgvector:0.8.5-pg18 digest-pinned，当前 59 → 60 测试）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、
      dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结 LOCAL_EXACT_TREE_FALLBACK
      （profile=precheck），远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS（TASK-0164 R1 PASS 不复用）。
independentReview: required
reviewers: []
terminalStateReason: ""
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §5.1.4 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §5.1 第 4 项 "Quota 数值与 release 幂等"）：
> 给 `vc.generation_usage` / `vc.quota_ledger_entry` 补非负 CHECK 约束，给 RELEASE 路径加 per-generation
> 单次幂等强制（partial unique index + `record_quota_release` 函数幂等守卫），使 quota 数值与 release 在
> DB 层 fail-closed。沿用 `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），
> 与 TASK-0153..0164 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§5.1.4（TASK-0109 审计 §5.1 第 4 项 "Quota 数值与 release 幂等"）：复核 usage/token/cost/quota 的非负 CHECK，
以及重复/并发 quota release 是否有 reservation/idempotency key。

**缺陷（经当前 HEAD 5f2df58 代码核实）**：
- `V7__finalize_generation_usage_quota_outbox.sql:80-93` 的 `vc.generation_usage` 表 `input_tokens` /
  `output_tokens`（bigint DEFAULT 0）/ `actual_cost`（numeric(18,6) DEFAULT 0）**无数值非负 CHECK**，
  仅有 DEFAULT 0。
- `V7:96-108` 的 `vc.quota_ledger_entry` 表 `quota_amount`（integer DEFAULT 0）**无 CHECK(>=0)**，仅有
  `quota_ledger_kind CHECK (kind IN ('SETTLE','RELEASE'))` 枚举约束。
- `V7:178-328` 的 `finalize_generation` SECURITY DEFINER 函数对 `p_input_tokens` / `p_output_tokens` /
  `p_actual_cost` / `p_quota_amount` 入参**无符号校验**，直接 INSERT 进 generation_usage 与 quota_ledger_entry
  （SETTLE 路径），故一个传负数的调用方会让负数 usage / SETTLE 行落库。
- `V17:1904-1950` 的 `record_quota_release` 函数**已有非负守卫**（V17:1927 `quota_amount must be non-negative`，
  故 handoff 候选清单中"无符号校验"在 RELEASE 路径上已过时——test 43:90-96 的负向断言正由此守卫实现），
  但**无 per-generation 单次 RELEASE 守卫**：每次成功调用盲插一行 RELEASE（V17:1942-1946），对同一
  `(owner_user_id, generation_id)` 重复调用会插入两行 RELEASE，无 reservation id / idempotency key /
  单次转换语义。

**结论**：quota 数值非负在 DB 层无表级 CHECK 强制（仅 record_quota_release RELEASE 路径有函数守卫，
finalize SETTLE 路径与任何直接 DML 均无防护）；release 无 per-generation 幂等。本卡把这两项在 DB 层强制落地。

**范围限定（纯 DB 卡）**：本卡只做 DB 层强制，不改 Java 侧。内存 `QuotaLedger.release`（QuotaLedger.java:94-114）
已有 owner 级 `Math.min(ceiling, current+units)` 钳制（粗粒度 owner 上限，非 reservation 级幂等），
`GenerationRecovery.releaseIfPresent`（GenerationRecovery.java:113-117）只传 ownerUserId + reservedUnits、
不传 reservationId；这些 Java 内存语义与 DB 层 `record_quota_release` 是两条独立路径，DB 强制只关心
"凡写入 quota_ledger_entry 的 RELEASE 行每 generation 至多一条 + 所有数值列非负"，与 Java 内存投影相互独立。
Java 侧收 reservationId 做 reservation 级幂等留后续独立 Java 卡或并入 P2-12 JDBC 层。

用户可观察结果：
1. `vc.generation_usage` 加三条 `CHECK (>= 0)`（input_tokens / output_tokens / actual_cost）。
2. `vc.quota_ledger_entry.quota_amount` 加 `CHECK (>= 0)`。
3. 新增 partial unique index `quota_ledger_release_one_per_generation` on
   `(owner_user_id, generation_id) WHERE kind='RELEASE'`：每个 generation 至多一条 RELEASE 行
   （并发 second writer raise unique_violation，fail-closed backstop）。
4. `record_quota_release` 加幂等守卫：同一 (owner, generation) 已有 RELEASE 时，再次调用返回既有 entry_id
   （no-op，不插第二行）；非负校验先于幂等检查（保留 test 43 负向语义）。
5. 新增 `60_quota_nonneg_check_and_release_idempotency.sql` 机器证明 §5.1.4。
6. 不修改任何既有 migration（V1-V20 冻结，Flyway checksum 安全）；仅新增 V21。
7. 终态治理闭环：run-rls-tests.sh（60 测试 PASS）+ canonical precheck 8/8 + git diff --check +
   独立 R1 静态复核 + Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **新增 `service/platform/persistence/src/main/resources/db/migration/V21__quota_nonneg_check_and_release_idempotency.sql`**：
   - 头部 `SET search_path TO vc, pg_catalog;`（与 V18/V19/V20 一致）。
   - (a) 四条非负 CHECK，均用 `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=...)
     THEN ALTER TABLE ... ADD CONSTRAINT ... CHECK (...); END IF; END $$;` 守卫（镜像 V7 FK 约束幂等模式）：
     - `generation_usage_input_tokens_nonneg CHECK (input_tokens >= 0)`
     - `generation_usage_output_tokens_nonneg CHECK (output_tokens >= 0)`
     - `generation_usage_actual_cost_nonneg CHECK (actual_cost >= 0)`
     - `quota_ledger_entry_quota_amount_nonneg CHECK (quota_amount >= 0)`
   - (b) `CREATE UNIQUE INDEX IF NOT EXISTS quota_ledger_release_one_per_generation
     ON vc.quota_ledger_entry (owner_user_id, generation_id) WHERE kind = 'RELEASE';`
     （partial unique index，per-generation 单次 RELEASE；与 V7 `message_generation_one_final` /
     `generation_candidate_one_final` 同模式）。
   - (c) `CREATE OR REPLACE FUNCTION vc.record_quota_release(...)`（签名 `(bigint, bigint, integer, text)`
     不变 → CREATE OR REPLACE，无需 DROP，保留 V15 GRANT EXECUTE 权限）。函数体：
     保留 V17 全部校验段逐行（owner required / trusted-context current_owner_id 断言 /
     generation_id required / `quota_amount IS NULL OR < 0` 非负守卫 / reason required / generation exists）；
     在 generation-exists 校验**之后**、INSERT**之前**插入幂等守卫：
     `SELECT id INTO v_existing FROM vc.quota_ledger_entry WHERE owner_user_id=p_owner_user_id
     AND generation_id=p_generation_id AND kind='RELEASE'; IF FOUND THEN RETURN QUERY SELECT v_existing; RETURN; END IF;`
     （非负校验在幂等检查之前，故 test 43 负向调用仍在非负守卫处 raise，不因已有 RELEASE 而被幂等 no-op 吞掉）；
     随后原有 INSERT + RETURN。search_path 保留 V17 的 `vc, public`（函数体全 schema-qualified，运行时零变更；
     本卡不触 §5.1.5 search_path 领域）。无 GRANT/REVOKE（CREATE OR REPLACE 不改权限，V15 已正确设置）。
   - 不改任何既有表结构（authorization_snapshot、generation、message、realtime、outbox、provider_attempt、
     RLS policy、角色）；不改 V1-V20。
2. **新增 `infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql`**（§5.1.4 integration_test，
   参照 test 43 单 session 正负断言模式）：
   - 正向 CHECK（finalize 路径）：seed FINAL_REVIEW generation + candidate，调 `finalize_generation`
     传 `p_input_tokens = -5` → 期望异常（generation_usage.input_tokens CHECK check_violation，整个 finalize
     事务回滚，INV-TX-001）。
   - 正向 CHECK backstop（直接 DML）：`SET ROLE vc_api` + owner context，直接 INSERT quota_ledger_entry
     负 quota_amount → 期望 check_violation（证明表 CHECK 在函数守卫之外仍 fail-closed）。
   - 幂等正向：对同一 (owner, generation) 调 `record_quota_release` 两次（同正 amount）→ 第二次返回的 entry_id
     与第一次相同（no-op），且该 generation 的 RELEASE 行数仍为 1。
   - 幂等负向交互：对已有 RELEASE 的 generation 再调 `record_quota_release(..., -1, ...)` → 仍在非负守卫处 raise
     （证明非负校验先于幂等 no-op，语义不被幂等吞掉）。
3. 终态治理闭环：run-rls-tests.sh + canonical precheck + git diff --check + R1 + Evidence/Handoff/
   单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不修改任何既有 migration（V1-V20），避免破坏 Flyway checksum。
- 不改 `record_quota_release` 的 SECURITY DEFINER、签名（4 参数不变）、owner、trusted-context 校验语义、
  search_path（保留 V17 `vc, public`）、GRANT/REVOKE（CREATE OR REPLACE 不改权限）。仅新增幂等守卫分支。
- 不改 generation_usage / quota_ledger_entry 的 PK、generation FK、`quota_ledger_kind` 枚举 CHECK、RLS policy、
  列定义（仅加 CHECK 约束与 partial unique index）。
- 不改 `finalize_generation` 函数（V7/V17 冻结）；finalize 负入参由表 CHECK 在 INSERT 处 fail-closed 拦截
  （atomic 事务回滚，INV-TX-001），无需 DROP/CREATE finalize。
- **不改任何 Java 代码**（QuotaLedger.java / GenerationRecovery.java / 任何 service/**.java 全 forbidden）。
  内存 release 收 reservationId 做 reservation 级幂等留后续独立 Java 卡或并入 P2-12。
- 不动 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、
  `scripts/harness/**`、`.github/workflows/**`、`specs/**`、frontend、pom。
- 不引入新 Maven/pnpm 依赖（`license-inventory.yaml` 无改动）。
- 不处理其它审计项（§5.1.2 worker fence、§5.1.6 V8/V11 升级、P1-04/05/11 等）。
- 不改 test 43（既有 record_quota_release 测试，保持不变；新幂等语义由 test 60 独立证明）。
- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit。

## 输入和前置条件

- Base `5f2df58a6221b7646671db2e7faf8db4e1515144` = TASK-0164 ACCEPTED terminal（已 push、0/0、clean；
  nextAction 与 docs/handoffs/TASK-0164.json byte-for-byte 一致，sha256 `2cf7ff95...` 已校验）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。context fingerprint `82cd641d...` 由自验算法生成
  （先复现 TASK-0164 `f732afcc...` 通过，再生成 TASK-0165）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- DB 测试：`bash infra/db/run-rls-tests.sh`（OrbStack `pgvector/pgvector:0.8.5-pg18` digest-pinned，
  匿名 `--rm` 容器，59 → 60 测试，约 2-4 min wall）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0165`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件契约变更。纯数据库 schema 增强：generation_usage / quota_ledger_entry 加非负 CHECK，
quota_ledger_entry 加 partial unique index，record_quota_release 加幂等守卫。
catalog（quota 路径）、database-ownership-contract.yaml 的所有权模型不变（两表仍 owner_user_id 复合所有权）。

## 权限、RLS 和数据处理要求

- 强化 quota 数值完整性与 release 幂等边界：所有数值列在 DB 层 CHECK(>=0) fail-closed；每 generation
  至多一条 RELEASE 行（partial unique index + 函数幂等守卫双保险）。
- 不改任何 RLS policy、不改任何角色 NOBYPASSRLS/BYPASSRLS 属性；generation_usage / quota_ledger_entry
  既有 FORCE RLS (V7) 覆盖新 CHECK / index（约束与 RLS 正交）。
- record_quota_release 仍 SECURITY DEFINER + trusted-context（V17），EXECUTE 权限由 V15 设置、CREATE OR
  REPLACE 保留不变。
- 测试在临时容器内用 SYNTHETIC 数据，`--rm` 清理，满足 TEMPORARY_VOLUME_ONLY。

## 状态机和失败行为

- 实现 = 1 个新 migration（V21，~80 行）+ 1 个新 integration test（60，~90 行）。不改任何既有 test。
- run-rls-tests.sh 60 测试全 PASS（含新增 60，test 1-59 无回归）。若 V21 的 CHECK/index/CREATE OR REPLACE
  因约束或语义漂移失败，run-rls-tests.sh 在 migration 应用阶段即失败（ON_ERROR_STOP=1），据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context fingerprint 一致、
  protected-path 技能匹配 `**/db/migration/**` → database-migration C4+humanApproval）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 120min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡强化数据库 quota 数值完整性与 release 幂等边界。

## 验收标准

1. 新增 V21 migration 存在；头部为 `SET search_path TO vc, pg_catalog;`；含 4 条 CHECK(>=0)（DO 守卫幂等）、
   1 条 partial unique index `quota_ledger_release_one_per_generation`、CREATE OR REPLACE record_quota_release
   加幂等守卫（签名不变、保留 V17 trusted-context 校验逐行、非负校验先于幂等、search_path `vc, public`）。
2. 不修改 V1-V20 任何既有 migration（diff 仅新增 V21）。
3. run-rls-tests.sh 60 测试 PASS（含新增 60），exit 0；test 1-59 无回归（尤其 test 43 不变仍 PASS）。
4. 新增 test 60：finalize 负 input check_violation、quota_amount 直接 DML CHECK backstop、record_quota_release
   二次幂等 no-op（返回既有 id + 仅一行 RELEASE）、幂等 + 负向交互（负数仍在非负守卫 raise）。
5. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
6. 唯一无参数 `git diff --check` PASS（exit 0）。
7. R1 独立静态复核 PASS（C4 必须；0 P0/P1/P2）。
8. 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
   （Evidence 如实标注，不转换为 PASS）。
9. 终态单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
10. §5.1.4 两项（非负 CHECK + release 幂等）在 DB 层强制落地（integration_test 由 test 60 机器证明）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `bash infra/db/run-rls-tests.sh` 跑一次（DB 变更直接门禁，60 测试，约 2-4 min）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands
  但本卡不跑，doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 run-rls-tests.sh 失败：最多 1 fix batch（修正 V21 约束/函数体或测试断言）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。V21 是前向新增 migration，
无需回滚既有历史（Flyway checksum 安全）；若 V21 本身有缺陷，下一张 replacement 卡以 REJECTED
terminal 为 Base 新增 V22 修正（不改 V21）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V20 既有 migration、test 01-59、
  任何 service/**.java、test 43）。
- run-rls-tests.sh / canonical precheck / diff check 任一非 PASS。
- V21 改变了 record_quota_release 的 SECURITY DEFINER/trusted-context 校验语义/签名/GRANT/owner/search_path
  （应保留 V17 `vc, public`），或改变既有表 PK/generation FK/枚举 CHECK/RLS/列定义。
- 候选身份变化或越界。
- hardFuseWallMinutes 120 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0165/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0165.json`。
