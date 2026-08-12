# TASK-0166：§5.1.6 / RISK-10 V8/V11 存量数据升级 fail-closed 测试覆盖

```yaml
taskId: TASK-0166
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 091e01e927dd59655e6ae6472c20ace43867024d
authorizationCommit: "d7a29b74c3bb24d81923c1bbba06adaddc4544bf"
contextFingerprint: ad620ead6c277472c94167a4d5bc26647a79c6ebe792c16f3aa938ab89413018
contextLock: docs/tasks/context/TASK-0166.context-lock.yaml
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
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 30, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C2
  surfaceId: TASK_0166_V8_V11_LEGACY_UPGRADE_FAIL_CLOSED_TEST
  policySurfaces: [DATABASE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 20
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0166
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
  - docs/evidence/TASK-0165/evidence-pack.json
  - docs/evidence/TASK-0165/review-r1.md
  - docs/handoffs/TASK-0165.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0165-quota-nonneg-check-and-release-idempotency.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - infra/db/tests/50_realtime_event_catalog.sql
  - infra/db/tests/60_quota_nonneg_check_and_release_idempotency.sql
  - infra/db/run-rls-tests.sh
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - infra/db/tests/61_v8_v11_legacy_upgrade_fail_closed.sql
  - docs/tasks/TASK-0166-v8-v11-legacy-upgrade-fail-closed-test.md
  - docs/tasks/context/TASK-0166.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0166/**
  - docs/handoffs/TASK-0166.json
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
  - docs/tasks/TASK-0165-*
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
  - docs/tasks/context/TASK-0165.context-lock.yaml
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
  - docs/evidence/TASK-0165/**
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
  - docs/handoffs/TASK-0165.json
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
  - service/platform/persistence/src/main/resources/db/migration/V21__*.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-3][0-9]_*.sql
  - infra/db/tests/4[0-9]_*.sql
  - infra/db/tests/5[0-9]_*.sql
  - infra/db/tests/60_*.sql
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
  - specs/contracts/database-ownership-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0165.json
requiredInvariants:
  - INV-RT-001
  - INV-MEM-001
  - INV-MEM-002
  - INV-TX-001
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
      Owner 2026-08-11/2026-08-12 授权长线审计修复一次一张新卡推进；TASK-0165（§5.1.4 quota 非负 CHECK
      + release 幂等）ACCEPTED 闭环后接续评估剩余 OPEN 项。经当前 HEAD 091e01e 串行复核（V8:38-53 realtime_event
      DEFAULT 0 backfill + CREATE UNIQUE INDEX；V11:34-47 memory_item conversation_id nullable +
      CHECK memory_item_session_requires_conversation + FK memory_item_conversation_fk；V7 realtime_event
      与 V2 memory_item 原始列结构 = 存量数据形状）确认 §5.1.6 / RISK-10 缺陷真实存在：V8/V11 migration 注释明写
      "Alpha tables are empty (tests TRUNCATE)"，其 DEFAULT/nullable backfill + 约束创建路径假设空表；若同
      (owner,gen) 有 ≥2 条存量 realtime 行全部 collapse 到 (epoch=1,seq=0) 触发 unique_violation，存量 SESSION
      memory 无 conversation_id 触发 check_violation，存量 memory 指向已删 conversation 触发
      foreign_key_violation —— 三者均 fail-closed（abort，不静默损坏）。唯一缺口是"无测试证明此升级行为"。
      RISK-10 要求 preflight/backfill + 不兼容历史数据升级测试：migration 本身即 preflight（abort），DEFAULT
      即 backfill（单行情形），缺的是测试证据。本卡限定为纯测试覆盖卡（C2），仅新增 test 61（4 场景 drop/recreate
      模拟 V8/V11 升级步骤 + 断言 fail-closed），不触任何 migration（V8/V11 已 frozen，Flyway checksum 安全）、
      不改 Java/catalog/contract。infra/db/tests/** 不匹配保护 glob **/db/migration/**，故 C2 非 C4，无需
      database-migration skill 与 humanApproval(scope:database-migration)。R1 条件性但保留（审计质量）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、
      dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结 LOCAL_EXACT_TREE_FALLBACK
      （profile=precheck），远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS（TASK-0165 R1 PASS 不复用）。
independentReview: conditional
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §5.1.6 / RISK-10 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §5.1 第 6 项 "存量 migration 兼容" 与
> RISK-10 "V8/V11 存量升级"）：证明 V8/V11 migration 在带不兼容存量数据升级时 fail-closed（不静默损坏），
> 闭合 RISK-10 "用不兼容历史数据做升级测试" 的证据要求。沿用 `owner-authorization://longline-2026-08-09`
> 长线授权（hash `cc0f91c1...`），与 TASK-0153..0165 同属 idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§5.1.6（TASK-0109 审计 §5.1 第 6 项 "存量 migration 兼容"，= RISK-10 "V8/V11 存量升级"）：V8 将旧 realtime
event 填 seq=0 后建唯一索引、V11 为旧 SESSION memory 增 FK/CHECK 的路径可能假设空表；用带存量数据的真实
升级测试确认，必要时 preflight/backfill。

**缺陷（经当前 HEAD 091e01e 代码核实，非盲信清单）：**

- `V8__realtime_resume_ticket_gap_reset_snapshot.sql:38-53`：注释明写 "Alpha tables are empty (tests TRUNCATE),
  so NOT NULL DEFAULTS are safe for any pre-existing V7 row"。给 `vc.realtime_event`（V7 建表，列 = owner_user_id /
  id / generation_id / event_type / payload / status / created_at）加 `stream_epoch bigint NOT NULL DEFAULT 1` +
  `event_seq bigint NOT NULL DEFAULT 0` + `committed_at timestamptz NOT NULL DEFAULT now()`，随后建
  `CREATE UNIQUE INDEX IF NOT EXISTS realtime_event_seq_uniq ON vc.realtime_event (owner_user_id, generation_id,
  stream_epoch, event_seq)`。DEFAULT backfill 把所有存量 V7 行的 (stream_epoch, event_seq) 填成 (1, 0)；
  若同一 `(owner_user_id, generation_id)` 存在 ≥2 条存量行，全部 collapse 到 (1, 0) → CREATE UNIQUE INDEX
  触发 unique_violation → **migration 中止（fail-closed，不静默损坏）**。单条存量行（≤1 每 owner,gen）则
  backfill 成功不冲突。
- `V11__canonical_memory_lifecycle.sql:27-47,49-50`：注释明写 "Existing Alpha tables are empty (tests TRUNCATE),
  so the new default is safe"。给 `vc.memory_item`（V2 建表，列 = owner_user_id / id / relationship_id / scope /
  summary / status / created_at）加 `conversation_id bigint`（nullable）+ `deleted_at timestamptz`，随后加
  `CHECK memory_item_session_requires_conversation (scope <> 'SESSION' OR conversation_id IS NOT NULL)` +
  `FK memory_item_conversation_fk (owner_user_id, conversation_id) REFERENCES vc.conversation(owner_user_id, id)
  ON DELETE CASCADE`。存量 SESSION memory（V2 无 conversation_id 列）被 nullable backfill 为 NULL →
  ADD CONSTRAINT CHECK 触发 check_violation；存量 memory 的 conversation_id 指向已删/不存在 conversation →
  ADD CONSTRAINT FK 触发 foreign_key_violation → **二者均 fail-closed（abort）**。

**结论**：V8/V11 已对不兼容存量数据 fail-closed（abort migration，绝不静默损坏），backfill（DEFAULT / nullable
列）处理单行/合法情形。RISK-10 要求"preflight/backfill + 不兼容历史数据升级测试"——migration 本身即是
preflight（abort 阻断坏升级），DEFAULT 即 backfill，**唯一缺口是"无测试机器证明此升级行为"**。本卡补这个测试。

**范围限定（纯测试覆盖卡 C2）**：本卡只新增 1 个 DB 测试文件（test 61），用 drop/recreate 约束的事务化模拟
忠实复现 V8/V11 在不兼容存量数据上的升级步骤，断言其 fail-closed。**不修改任何 migration**（V8/V11 已 frozen，
Flyway checksum 安全；且已 fail-closed 无 latent bug 可修）、**不改任何 Java/catalog/contract/service**。
不触 `**/db/migration/**`（`infra/db/tests/**` 是 `db/tests` 非 `db/migration`，不在 protected-paths），故
风险类 C2（仅 unprotected test 文件 + C2 任务元数据），无需 database-migration skill。

用户可观察结果：
1. 新增 `infra/db/tests/61_v8_v11_legacy_upgrade_fail_closed.sql`，4 场景机器证明 V8/V11 升级 fail-closed：
   (a) V8 唯一索引在 backfill 碰撞数据上 CREATE UNIQUE INDEX → unique_violation；
   (b) V8 唯一索引 post-migration 持续拒绝同 key 重复（unique_violation）；
   (c) V11 CHECK 在存量 SESSION-without-conversation 上 ADD CONSTRAINT → check_violation；
   (d) V11 FK 在存量 dangling conversation 上 ADD CONSTRAINT → foreign_key_violation。
2. run-rls-tests.sh 61 测试全 PASS（test 1-60 无回归，含 test 50/57/60）。
3. 不修改任何既有 migration（V1-V21）、test 01-60、service/**.java、specs/**。
4. 终态治理闭环：run-rls-tests.sh（61 测试 PASS）+ canonical precheck 8/8 + git diff --check +
   R1 语义复核 + Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **新增 `infra/db/tests/61_v8_v11_legacy_upgrade_fail_closed.sql`**（参照 test 50/60 模式：TRUNCATE fixture
   + 超管插入 + DO 块 `EXCEPTION WHEN` 捕获预期失败）。所有 drop/recreate 约束操作包在事务内并在结束时
   恢复/回滚，保证 DB 终态与测试前一致（不影响其他测试；test 61 是最高编号，且 run-rls-tests 每次全新容器）。
   四个场景：

   - **场景 1（V8 升级 unique 碰撞，核心）**：`BEGIN; DROP INDEX IF EXISTS vc.realtime_event_seq_uniq;`
     以超管插 2 条同 `(owner_user_id=1, generation_id=G, stream_epoch=1, event_seq=0)` 的 realtime_event
     （模拟 V8 DEFAULT backfill 在 2 条存量 V7 行上的输出）；DO 块执行 V8 的 `CREATE UNIQUE INDEX
     realtime_event_seq_uniq ON vc.realtime_event (owner_user_id, generation_id, stream_epoch, event_seq)`
     → 捕获 unique_violation（证明 V8 在此数据上 abort）；`ROLLBACK`（恢复索引）。另插 1 条行后证明
     CREATE UNIQUE INDEX 在单条/无碰撞数据上成功（backfill 合法情形）。
   - **场景 2（V8 post-migration 守卫）**：直接以超管插第二条同 `(owner,gen,epoch,seq)` realtime_event
     → existing index `realtime_event_seq_uniq`（V8 已建）拒绝 unique_violation（证明 V8 建的索引持续强制
     INV-RT-001 单调游标不变量，即升级后不可注入碰撞）。
   - **场景 3（V11 CHECK 升级碰撞）**：`BEGIN; ALTER TABLE vc.memory_item DROP CONSTRAINT
     memory_item_session_requires_conversation;` 以超管插 `scope='SESSION', conversation_id=NULL` memory_item
     （模拟存量 SESSION memory，V2 无 conversation_id）；DO 块执行 V11 的 `ALTER TABLE ADD CONSTRAINT
     memory_item_session_requires_conversation CHECK (scope <> 'SESSION' OR conversation_id IS NOT NULL)`
     → 捕获 check_violation；`ROLLBACK`（恢复约束）。
   - **场景 4（V11 FK 升级碰撞）**：`BEGIN; ALTER TABLE vc.memory_item DROP CONSTRAINT
     memory_item_conversation_fk;` 以超管插 conversation_id 指向不存在 conversation 的 memory_item；
     DO 块执行 V11 的 `ALTER TABLE ADD CONSTRAINT memory_item_conversation_fk FOREIGN KEY (owner_user_id,
     conversation_id) REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE` → 捕获
     foreign_key_violation；`ROLLBACK`（恢复约束）。

   每个场景：模拟"V8/V11 在不兼容存量数据上运行其约束创建步骤" → 断言该步骤 fail-closed。这是 RISK-10
   要的"用不兼容历史数据做升级测试"。

2. 终态治理闭环：run-rls-tests.sh（61 测试 PASS）+ canonical precheck 8/8 + git diff --check +
   R1 语义复核 + Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **不修改任何既有 migration（V1-V21）**，避免破坏 Flyway checksum。V8/V11 已 frozen 且 fail-closed，
  无 latent bug 可修；不新增 V22（无干净 V22 能"修复"已执行的 V8/V11，新增只增噪声）。
- **不改任何 Java 代码**（service/**.java 全 forbidden）、不改 catalog（specs/catalog/**）、契约
  （specs/contracts/**）、service 模块、frontend、pom。
- 不改 test 01-60（既有测试保持不变；新升级行为由 test 61 独立证明）。
- 不动 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、
  `scripts/harness/**`、`.github/workflows/**`、`ci/**`、`infra/db/run-rls-tests.sh`。
- 不引入新依赖（`license-inventory.yaml` 无改动）。
- 不处理其它审计项（§5.1.2 worker fence、P1-04/05/11 等需 Owner 决策）。
- 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit。

## 输入和前置条件

- Base `091e01e927dd59655e6ae6472c20ace43867024d` = TASK-0165 ACCEPTED terminal（已 push、0/0、clean；
  nextAction 与 docs/handoffs/TASK-0165.json byte-for-byte 一致，sha256 `c2c4d64d...` 已校验）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。context fingerprint `ad620ead...` 由自验算法生成
  （先复现 TASK-0165 `82cd641d...` 通过，再生成 TASK-0166）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- DB 测试：`bash infra/db/run-rls-tests.sh`（OrbStack `pgvector/pgvector:0.8.5-pg18` digest-pinned，
  匿名 `--rm` 容器，60 → 61 测试，约 2-4 min wall）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0166`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件/数据契约变更。纯测试覆盖：新增 1 个 SQL 测试文件，证明既有 V8/V11 migration 的升级行为
（fail-closed）。不新增/不修改任何 schema、函数、约束、index、RLS policy、角色。

## 权限、RLS 和数据处理要求

- 测试在临时容器内用 SYNTHETIC 数据，`--rm` 清理，满足 TEMPORARY_VOLUME_ONLY。
- 场景中的 DROP INDEX/CONSTRAINT 仅在事务内（BEGIN/ROLLBACK）临时执行，终态恢复；不改变任何持久约束。
- 超管（postgres，无 SET ROLE）插入用于绕过 V16 运行角色 DML 撤销，与 test 50:146-162 的 CHECK 验证
  超管路径一致（约束是表级、独立于 caller role）。
- 不改任何 RLS policy、角色属性、GRANT/REVOKE。

## 状态机和失败行为

- 实现 = 1 个新 integration test（61，~110 行）。不改任何 migration、函数、既有 test。
- run-rls-tests.sh 61 测试全 PASS（含新增 61，test 1-60 无回归）。若 test 61 的 drop/recreate 事务隔离或
  断言逻辑有误，run-rls-tests.sh 在 test 执行阶段失败（ON_ERROR_STOP=1），据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context fingerprint
  一致、protected-path 技能匹配；本卡不触保护路径，requiredSkills = task-delivery-flow + task-intake）。
- R1 语义复核 PASS（0 P0/P1/P2）。R1 阻塞 → 最多 1 fix batch（仅改 test 61，不动卡 body 保持 READY
  projection 冻结）→ R2；R3 禁止。超 hardFuse 90min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡证明既有 DB migration 的存量数据升级 fail-closed 行为，闭合 RISK-10 证据要求。

## 验收标准

1. 新增 `infra/db/tests/61_v8_v11_legacy_upgrade_fail_closed.sql`，含 4 场景：V8 升级 unique 碰撞
   （CREATE UNIQUE INDEX 在 backfill 碰撞数据上 unique_violation）+ V8 post-migration 守卫
   （existing index 拒绝同 key 重复）+ V11 CHECK 升级碰撞（ADD CONSTRAINT 在 SESSION-without-conversation
   上 check_violation）+ V11 FK 升级碰撞（ADD CONSTRAINT 在 dangling conversation 上 foreign_key_violation）。
2. 不修改任何既有 migration（V1-V21）与 test 01-60（diff 仅新增 test 61）。
3. run-rls-tests.sh 61 测试 PASS（含新增 61），exit 0；test 1-60 无回归（尤其 test 50/57/60 不变仍 PASS）。
4. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
5. 唯一无参数 `git diff --check` PASS（exit 0）。
6. R1 语义复核 PASS（C2 条件性但保留；0 P0/P1/P2）。
7. 完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
   （Evidence 如实标注，不转换为 PASS）。
8. 终态单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
9. §5.1.6 / RISK-10 "用不兼容历史数据做升级测试" 证据要求闭合（test 61 机器证明 V8/V11 升级 fail-closed）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `bash infra/db/run-rls-tests.sh` 跑一次（DB 测试直接门禁，61 测试，约 2-4 min）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands
  但本卡不跑，doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 run-rls-tests.sh 失败：最多 1 fix batch（仅修正 test 61 的断言/事务逻辑）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。test 61 是前向新增测试文件，
无需回滚既有历史；若 test 61 证明 V8/V11 实际**不** fail-closed（latent bug），停止并转 Owner 决策
是否开 C4 修复卡。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V21 既有 migration、test 01-60、
  run-rls-tests.sh、任何 service/**.java、specs/**）。
- run-rls-tests.sh / canonical precheck / diff check 任一非 PASS。
- test 61 改变了任何持久 schema（DROP/ADD 未在事务内恢复），或越界修改既有约束/索引/函数。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0166/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0166.json`。
