# TASK-0144：P2-12 JDBC 授权快照单向生命周期

```yaml
taskId: TASK-0144
state: READY
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: ba8b1661926452abf5e975948246f626ddc2795e
authorizationCommit: ""
contextFingerprint: d51518a6029a047d4b23235d3c7913efc6ee54cf1b17251002c161b51056cf0d
contextLock: docs/tasks/context/TASK-0144.context-lock.yaml
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
  riskClass: C3
  surfaceId: TASK_0144_P2_12_JDBC_AUTHZ_SNAPSHOT_ONE_WAY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 85
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
  - docs/tasks/TASK-0143-p2-26-timeout-process-tree.md
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/evidence/TASK-0143/evidence-pack.json
  - docs/evidence/TASK-0143/pre-closure-request.json
  - docs/evidence/TASK-0143/review-r1.md
  - docs/evidence/TASK-0143/review-r2.md
  - docs/handoffs/TASK-0143.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/06_authorization_snapshot_isolation.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
writeAllowlist:
  - docs/tasks/TASK-0144-p2-12-jdbc-authorization-snapshot-one-way.md
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0144/**
  - docs/handoffs/TASK-0144.json
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStoreTest.java
  - infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql
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
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/evidence/TASK-0142/**
  - docs/evidence/TASK-0143/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/handoffs/TASK-0142.json
  - docs/handoffs/TASK-0143.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/**
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
  - "**/db/migration/**"
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/**
  - service/platform/persistence/src/main/resources/**
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ConversationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/FinalizeGenerationService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/MessageRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ProviderDeploymentRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeEventRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/ResumeResult.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/StreamSnapshot.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaim.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/WorkItemClaimService.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/AuthorizationSnapshotCodecTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/FinalizeGenerationServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/GenerationReceiveServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeResumeServiceTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/RealtimeTicketRepositoryTest.java
  - service/platform/persistence/src/test/java/com/virtualcompanion/platform/persistence/WorkItemClaimServiceTest.java
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-4][0-9]_*.sql
  - infra/db/tests/50_*.sql
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0143/evidence-pack.json
  - docs/handoffs/TASK-0143.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
requiredInvariants:
  - INV-AUTH-001
  - INV-TENANT-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 3f0b1c9e-7a2d-4f6e-8b1a-2c4d6e8f0a11
    evidence: >-
      Owner 于 2026-08-09/08-10 长线会话授权按 docs/evidence/TASK-0109/zcode-remediation-handoff.md
      §4.5 串行处理 P2-12（JDBC authorization snapshot UPSERT→insert-only + 单向状态转换 +
      测试；触碰 V3 grants migration 则升 C4 + humanApproval）。本卡按不触碰任何 db/migration
      文件设计（V3 只读参考），风险级 C3；Java store 修复与 SQL suite 测试均为本卡授权范围；
      工程细节按长线授权由实施者决定并如实记录；禁止历史改写和伪造 PASS。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 3f0b1c9e-7a2d-4f6e-8b1a-2c4d6e8f0a11
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0143 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0144
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-12 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.5 登记的 OPEN 审计项：
> `JdbcAuthorizationSnapshotStore` 的 `put` 使用 UPSERT（`ON CONFLICT ... DO UPDATE`）可把
> `WITHDRAWN/NARROWED` 记录覆盖回 `ACTIVE`（复活），且 withdraw/narrow 无当前状态条件与行锁、
> narrow 缺 ID 一致性校验——真实 JDBC 接线后会违反授权快照单向生命周期
> （`AuthorizationSnapshotStore` 接口契约 "must not resurrect withdrawn or narrowed snapshots"）。

## 背景与用户可观察目标

P2-12（JDBC authorization snapshot 可复活）现状：

- `JdbcAuthorizationSnapshotStore.put` 使用
  `INSERT ... ON CONFLICT (owner_user_id, snapshot_id) DO UPDATE SET status = EXCLUDED.status ...`
  —— 对已存在快照（包括已 `WITHDRAWN`/`NARROWED` 的终态快照）执行覆盖更新，可把终态复活为
  `ACTIVE`；而 `InMemoryAuthorizationSnapshotStore.put` 是 `putIfAbsent` + 重复即抛异常的
  insert-only 语义，接口 Javadoc 明确 "must not resurrect withdrawn or narrowed snapshots"。
- `withdraw` 为无条件 `UPDATE ... SET status='WITHDRAWN' WHERE snapshot_id=?`：无当前状态条件，
  无行锁，任何状态都可被转换，且与内存实现相比缺少对已终态快照的失败关闭。
- `narrow` 为无条件 UPDATE：不校验 `narrowed.id()` 与目标 `id` 一致（内存实现有
  `IllegalArgumentException`），无状态条件与行锁。
- 表结构 `vc.authorization_snapshot` 的 PK 为 `(owner_user_id, snapshot_id)`（V3，只读参考，
  本卡不修改任何 migration 文件）。

用户可观察结果：授权快照生命周期为单向 `ACTIVE -> WITHDRAWN/NARROWED`（终态不可复活、不可再转换）；
`put` 对已存在 ID 失败关闭（insert-only）；`withdraw`/`narrow` 仅接受 `ACTIVE` 快照，对不存在与已终态
分别给出明确失败；`narrow` 强制 narrowed ID 与目标 ID 一致；并发 withdraw/narrow 只有一个成功。
所有行为由 Java 单测（Mockito 捕获 SQL 与异常语义）与真实 PostgreSQL SQL suite 测试共同证明。

## 范围内

- `service/platform/persistence/.../JdbcAuthorizationSnapshotStore.java`：
  - `put` 改为 insert-only：`INSERT ... ON CONFLICT (owner_user_id, snapshot_id) DO NOTHING`，
    affected=0 时抛 `IllegalStateException`（对齐内存实现 "already stored" 语义），不再更新既有行。
  - `withdraw` 改为带当前状态条件的单向转换：
    `UPDATE ... SET status='WITHDRAWN' WHERE snapshot_id=? AND status='ACTIVE'`（单条 UPDATE
    原子执行时持有目标行锁）；affected=0 时按 `find` 结果分类：不存在抛 not-found、
    已 `WITHDRAWN/NARROWED` 抛单向状态转换异常。
  - `narrow` 增加 `narrowed.id()` 与目标 `id` 一致性校验（`IllegalArgumentException`），
    并使用 `WHERE snapshot_id=? AND status='ACTIVE'` 的条件更新，错误分类同 withdraw。
- `service/platform/persistence/src/test/java/.../JdbcAuthorizationSnapshotStoreTest.java`（新增）：
  Mockito mock `JdbcTemplate`，断言 put/withdraw/narrow 的 SQL 文本与参数、affected=0 时的异常
  语义（not-found 与已终态分类）、narrow ID 一致性校验；纯单元测试，无需数据库。
- `infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql`（新增）：真实 PostgreSQL 上验证
  insert-only 冲突（同 owner 重复插入同 ID 失败、WITHDRAWN 后不可重新插入）、状态单向转换
  （ACTIVE→WITHDRAWN 成功、WITHDRAWN/NARROWED→任何再转换 0 行）、并发 withdraw 仅一个成功、
  跨 owner 不可见/不可影响；与 06 测试互补。
- 唯一正式 Precheck、根级 Docker Maven verify、完整 SQL suite、唯一 `git diff --check`、独立 C3
  R1、pre-closure、push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改任何 `db/migration/**` 文件（含 V3）：本卡不撤销表级 UPDATE/DELETE 权限、不加 CHECK 约束、
  不加新 migration。数据库层权限收紧（REVOKE UPDATE/DELETE 等）与 P1-04/P1-05/P2-29 的 DB 安全
  边界大卡（Owner gate）协同，作为本卡 Handoff 的 remaining 记录。
- 不修改 `InMemoryAuthorizationSnapshotStore`、`AuthorizationSnapshotStore`、领域模型、Guard、
  `ApprovedModelProviderConfig`、`PersistenceConfig` 或任何其他 Java 文件。
- 不修改 `run-rls-tests.sh`（P3-07 单独卡）与既有 01-50 SQL 测试。
- 不修改历史 Evidence/Handoff/Card/Context/Backlog 条目或任何历史 Git 对象。
- 不处理 P2-25（SBOM/license，Owner gate）、P2-27（平台矩阵，Owner gate）、P3-01/P3-02/P3-07、
  Provider DNS、数据库 Owner gates 或条件风险。

## 输入和前置条件

- Base `ba8b1661926452abf5e975948246f626ddc2795e` 是 TASK-0143 单父 ACCEPTED terminal，
  已 push、fetch、`HEAD...origin/main=0/0` 且工作树 clean（会话恢复 Doctor summary PASS）。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint `d51518a6…`
  基于 Base 重新计算。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置，`python` 解析到
  受控解释器。
- Docker 只用 OrbStack：`docker` 命令来自 OrbStack（SQL suite 与 Maven 根级 verify）。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据表结构。`AuthorizationSnapshotStore` 端口语义与内存实现对齐：
`put` 对已存在 ID 抛 `IllegalStateException`；`withdraw`/`narrow` 仅接受 `ACTIVE` 快照并返回
转换后的快照；`narrow` 对 ID 不一致抛 `IllegalArgumentException`。错误消息不包含敏感数据。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；READY 后不得修改任务卡正文或不可变元数据。

授权快照状态机：`ACTIVE -> WITHDRAWN`、`ACTIVE -> NARROWED` 是仅有的合法转换；
`WITHDRAWN`/`NARROWED` 为终态（不可复活、不可再转换）。`put` 永不更新既有行（insert-only）。
并发转换由条件 UPDATE 的行锁保证：同一快照的并发 withdraw/narrow 只有一个 affected=1。

任何正式门禁非 PASS（READY Doctor、Reviewer、canonical Precheck、根级 Maven、SQL suite、
`git diff --check`、pre-closure、push/远端 0/0）或候选身份变化：立即停止 promotion，如实
REJECTED（保留失败历史，Evidence 如实记录，不重跑挑结果、不伪造成 PASS），然后按失败根因创建
新卡从 DRAFT 起修正范围（参考 TASK-0140/0141→0142 前向恢复模式）。

## 验收标准

- `put` 对已存在 snapshot_id（含 WITHDRAWN/NARROWED 终态）抛 `IllegalStateException` 且不更新
  既有行；SQL 文本为 `ON CONFLICT ... DO NOTHING`（无 `DO UPDATE`），由单测断言。
- `withdraw` 仅接受 `ACTIVE`：`UPDATE ... WHERE snapshot_id=? AND status='ACTIVE'`；不存在抛
  not-found 异常，已终态抛单向转换异常；并发 withdraw 只有一个成功。单测断言 SQL 与异常分类。
- `narrow` 校验 `narrowed.id()==id`（不一致抛 `IllegalArgumentException`）并使用 `status='ACTIVE'`
  条件更新；错误分类同 withdraw。单测断言。
- SQL suite `51_authorization_snapshot_one_way_lifecycle.sql` 在真实 PostgreSQL 通过：重复插入
  同 ID 失败、WITHDRAWN 不可复活、ACTIVE→WITHDRAWN 成功、已终态再转换 0 行、并发 withdraw
  单胜、跨 owner 隔离。
- `bash infra/db/run-rls-tests.sh` 输出 `ALL TESTS PASS`（含既有 50 个与新增 51）；根级 Docker
  Maven verify `BUILD SUCCESS`；唯一正式 Precheck 全命令 PASS；唯一无参数 `git diff --check`
  PASS（输出空）；独立 C3 R1 PASS（阻塞 P0/P1 为零）。
- 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 fetch 断言 `HEAD==origin/main`、tree
  一致、`0/0`、clean；remote exact-SHA 如实非 PASS（dispatchCount=0），LOCAL_EXACT_TREE_FALLBACK
  的 PASS 限于已记录平台/命令。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行
`JdbcAuthorizationSnapshotStoreTest` 与受影响模块定向测试（`-pl service/platform/persistence -am
test`）作为迭代证据，不冒充正式 Evidence；冻结候选后依次执行独立 Reviewer、唯一 Precheck、
根级 Maven verify（docker maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache）、完整 SQL suite
（bash infra/db/run-rls-tests.sh）、唯一无参数 diff check、Evidence/Handoff 和唯一 pre-closure。
Precheck 已覆盖的 canonical 子命令不重复；同一条 `git diff --check` 只执行一次。
