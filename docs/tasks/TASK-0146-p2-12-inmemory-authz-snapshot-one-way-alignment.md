# TASK-0146：P2-12 后继 InMemory 授权快照单向语义对齐

```yaml
taskId: TASK-0146
state: ACCEPTED
terminalStateReason: >-
  P2-12 后继 InMemory 授权快照单向语义对齐已完成：InMemoryAuthorizationSnapshotStore.withdraw/
  narrow 改为仅 ACTIVE 可转换（已终态含 WITHDRAWN/NARROWED 交叉抛与 JDBC transitionFailure 逐字
  一致的单向异常），narrow id 一致性校验先于状态检查，put insert-only 未变；requiredSkills 含
  model-routing-change（service/**/modelruntime/** 受保护路径）。新增
  InMemoryAuthorizationSnapshotStoreTest（11 测试覆盖全部验收分支，含终态交叉）。唯一 Precheck
  5/5 PASS（Doctor 682648 checks）、根级 Docker Maven verify BUILD SUCCESS（1392 tests 0
  failures）、唯一 git diff --check PASS 全部在候选 bf1f99b/c845414 PASS；独立 C3 R1 PASS
  （P0/P1/P2=0，P3=2 信息性）后完成；remote exact-SHA 如实非 PASS（dispatchCount=0），本卡只
  声明 READY 冻结的 LOCAL_EXACT_TREE_FALLBACK。TASK-0145 同范围失败链（缺 model-routing-change）
  已按 Owner 授权 reset 摘除，失败记录备份于 /tmp/vc-task0145-rejected-record/。
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
  - model-routing-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  model-routing-change: "1.0.0"
targetSkillVersions: {}
baseCommit: 439ea01ed1442ada2d273679548673efa9ff32b4
authorizationCommit: 3048d19a22fdb1901e58ff3a0fd03ec6efc0073c
contextFingerprint: 4a318026d13199e5caaa45bb12becf8e9959db91985ae44f4a276b455e1d33f6
contextLock: docs/tasks/context/TASK-0146.context-lock.yaml
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
  surfaceId: TASK_0146_P2_12_INMEMORY_AUTHZ_SNAPSHOT_ONE_WAY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
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
  - docs/tasks/TASK-0144-p2-12-jdbc-authorization-snapshot-one-way.md
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - docs/evidence/TASK-0144/evidence-pack.json
  - docs/evidence/TASK-0144/pre-closure-request.json
  - docs/evidence/TASK-0144/review-r1.md
  - docs/evidence/TASK-0144/review-r2.md
  - docs/handoffs/TASK-0144.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/model-routing-change/SKILL.md
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuardTest.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcAuthorizationSnapshotStore.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/ApprovedModelProviderConfig.java
writeAllowlist:
  - docs/tasks/TASK-0146-p2-12-inmemory-authz-snapshot-one-way-alignment.md
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0146/**
  - docs/handoffs/TASK-0146.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStoreTest.java
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
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshot.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotId.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationStatus.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuard.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/authorization/ExecutionAuthorizationGuardTest.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryProviderRegistry.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderContractRef.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProviderRegion.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/ProcessingPurpose.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/DataCategory.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotCodec.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/execution/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/contract/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/port/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/registry/**
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/catalog/**
  - service/platform/**
  - service/adapters/**
  - service/tests/**
  - service/apps/**
  - frontend/**
  - infra/**
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
  - skills/model-routing-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0144/evidence-pack.json
  - docs/handoffs/TASK-0144.json
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/AuthorizationSnapshotStore.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/authorization/InMemoryAuthorizationSnapshotStore.java
requiredInvariants:
  - INV-AUTH-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 5e8a2c4f-9b1d-4c3e-8f6a-7b2c9d0e1f2a
    evidence: >-
      TASK-0144 R1 P2 记录：InMemoryAuthorizationSnapshotStore 允许终态再转换，与 JDBC 单向语义
      存在可观察分歧。TASK-0145（前序同范围卡）因 requiredSkills 缺 model-routing-change 在唯一
      正式 Precheck FAIL（service/**/modelruntime/** 受保护路径），其 REJECTED closure 被同一
      缺陷阻塞（卡不可变/历史不可改写/Doctor 无豁免）；Owner 于 2026-08-11 明确授权 reset 摘除
      TASK-0145 未推送链并创建本卡（TASK-0146）从 DRAFT 重新声明：requiredSkills 增加
      model-routing-change 1.0.0，实现内容沿用已验证方案并重新验证；失败记录备份于
      /tmp/vc-task0145-rejected-record/。禁止历史改写和伪造 PASS。
  - scope: model-routing-change
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 5e8a2c4f-9b1d-4c3e-8f6a-7b2c9d0e1f2a
    evidence: >-
      Owner 授权 reset 摘除 TASK-0145 未推送链并创建本卡承接，requiredSkills 明确增加
      model-routing-change（service/**/modelruntime/** 受保护路径的注册 Skill，1.0.0）；
      实现范围仅为 InMemoryAuthorizationSnapshotStore.withdraw/narrow 单向语义对齐与新增单测，
      不修改 Guard/领域模型/JDBC/迁移；独立 C3 Reviewer 强制。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 5e8a2c4f-9b1d-4c3e-8f6a-7b2c9d0e1f2a
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers:
  - id: task0146_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: bf1f99b5c7078eace51873f8d0e6f6c20b5eca6b
    evidencePath: docs/evidence/TASK-0146/review-r1.md
    reason: "R1 完整复核 PASS：候选身份（2 文件、单父、tree 匹配、diff-check 干净）、put insert-only 未变、withdraw/narrow 仅 ACTIVE 可转换且单向异常与 JDBC transitionFailure 逐字一致、narrow ID 一致性校验顺序与 JDBC 一致、测试覆盖验收全部三分支（含 WITHDRAWN/NARROWED 交叉）、生产代码零 withdraw/narrow 调用点无回归、INV-AUTH-001 维持；P0/P1/P2=0、P3=2 信息性。Reviewer 未运行正式门禁。"
    candidateTree: c845414b85484f3b05538551c1b55461369ffaa8
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0146
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P2-12 后继：TASK-0144
> 的 R1 P2 与 Handoff remaining 记录——`InMemoryAuthorizationSnapshotStore` 允许终态再转换，
> 与 JDBC 单向语义对齐。本卡为 TASK-0145（同范围卡，正式 Precheck FAIL：requiredSkills 缺
> model-routing-change）经 Owner 授权 reset 摘除未推送链后的承接卡，requiredSkills 已补齐
> model-routing-change。

## 背景与用户可观察目标

TASK-0144 把 `JdbcAuthorizationSnapshotStore` 修正为单向生命周期（`ACTIVE -> WITHDRAWN/NARROWED`
为仅有的合法转换，终态不可复活、不可再转换），但 `InMemoryAuthorizationSnapshotStore`（当前 runtime
实际装配的实现，见 `ApprovedModelProviderConfig`）仍允许：

- `withdraw` 对已 `WITHDRAWN` 快照幂等成功、对已 `NARROWED` 快照可再转 `WITHDRAWN`；
- `narrow` 对已 `WITHDRAWN`/`NARROWED` 快照可再转 `NARROWED`。

即内存实现可把终态快照再转换，与端口契约（"must not resurrect withdrawn or narrowed snapshots"）
和 JDBC 实现的可观察行为存在分歧。

用户可观察结果：两个 `AuthorizationSnapshotStore` 实现行为一致——`withdraw`/`narrow` 仅接受
`ACTIVE` 快照，对不存在抛 not-stored、对已终态抛单向转换异常；现有 Guard/Invoker 调用路径
（仅对 ACTIVE 快照转换）行为不变。

## 范围内

- `service/modules/modelruntime/.../authorization/InMemoryAuthorizationSnapshotStore.java`：
  - `withdraw`：仅 `ACTIVE` 可转 `WITHDRAWN`；对已 `WITHDRAWN`/`NARROWED` 抛
    `IllegalStateException`（单向转换）；不存在抛 not-stored（既有）。
  - `narrow`：校验 `narrowed.id()==id`（既有），仅 `ACTIVE` 可转 `NARROWED`；对已终态抛
    `IllegalStateException`。
- `service/modules/modelruntime/src/test/java/.../authorization/InMemoryAuthorizationSnapshotStoreTest.java`
  （新增）：覆盖 put insert-only（既有）、withdraw/narrow 正常转换、not-stored、已终态再
  withdraw/narrow 失败（含 WITHDRAWN/NARROWED 交叉）、narrow ID 不一致。
- 唯一正式 Precheck、根级 Docker Maven verify、唯一 `git diff --check`、独立 C3 R1、pre-closure、
  push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 `JdbcAuthorizationSnapshotStore`、`AuthorizationSnapshotStore` 接口、领域模型、
  `ExecutionAuthorizationGuard`、`ApprovedModelProviderConfig`、catalog 或任何其他文件。
- 不修改任何 `db/migration/**`、SQL suite、`infra/**`、`scripts/**`、`.harness/**`（除
  project-state/task-ledger）。
- 不处理 P2-25/P2-27（Owner gate）、P3-01/P3-02/P3-07、Provider DNS、数据库 Owner gates 或条件风险。

## 输入和前置条件

- Base `439ea01ed1442ada2d273679548673efa9ff32b4` 是 TASK-0144 单父 ACCEPTED terminal，已 push、
  fetch、`HEAD...origin/main=0/0` 且工作树 clean。TASK-0145 的未推送失败链（ff35a61..0a231cd）
  已按 Owner 授权 reset 摘除，其失败记录（evidence/handoff，含正式 Precheck FAIL 与 REJECTED
  closure pre-closure FAIL 的真实记录）备份于 `/tmp/vc-task0145-rejected-record/`。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint `4a318026…` 基于
  Base 重新计算。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置。
- Docker 只用 OrbStack（Maven 根级 verify）。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。`AuthorizationSnapshotStore` 端口行为与 JDBC 实现一致：仅
`ACTIVE` 可转换；错误消息不包含敏感数据。现有 `ExecutionAuthorizationGuardTest` 的
withdraw/narrow 调用均为 ACTIVE 快照，行为不变。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；READY 后不得修改任务卡正文或不可变元数据。

授权快照状态机与 TASK-0144 一致：`ACTIVE -> WITHDRAWN`、`ACTIVE -> NARROWED` 是仅有的合法转换；
`WITHDRAWN`/`NARROWED` 为终态。任何正式门禁非 PASS 或候选身份变化：立即停止 promotion，如实
REJECTED（保留失败历史），按失败根因创建新卡从 DRAFT 起修正范围。

## 验收标准

- `withdraw` 仅接受 `ACTIVE`：正常转换返回 WITHDRAWN；不存在抛 not-stored；已
  WITHDRAWN/NARROWED 抛"only ACTIVE may transition"。
- `narrow` 校验 `narrowed.id()==id`（不一致抛 IllegalArgumentException）并仅接受 `ACTIVE`：
  正常转换返回 NARROWED；已终态抛单向转换异常。
- 新增 `InMemoryAuthorizationSnapshotStoreTest` 覆盖上述全部分支；既有
  `ExecutionAuthorizationGuardTest` 全部继续通过（无回归）。
- 唯一正式 Precheck 全命令 PASS；根级 Docker Maven verify BUILD SUCCESS；唯一无参数
  `git diff --check` PASS（输出空）；独立 C3 R1 PASS（阻塞 P0/P1 为零）。
- 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 fetch 断言 `HEAD==origin/main`、tree
  一致、`0/0`、clean；remote exact-SHA 如实非 PASS（dispatchCount=0）。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行
`InMemoryAuthorizationSnapshotStoreTest` 与 `ExecutionAuthorizationGuardTest` 定向测试作为迭代
证据，不冒充正式 Evidence；冻结候选后依次执行独立 Reviewer、唯一 Precheck、根级 Maven verify、
唯一无参数 diff check、Evidence/Handoff 和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令
不重复；同一条 `git diff --check` 只执行一次。
