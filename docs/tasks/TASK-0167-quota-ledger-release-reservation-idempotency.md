# TASK-0167：§5.1.4 内存 QuotaLedger.release 收 reservationId 做 reservation 级幂等

```yaml
taskId: TASK-0167
state: READY
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
baseCommit: afb43f730189006a371181dbca5413b5cd42cce3
authorizationCommit: "70f1e0c6014d9adda53db68036220d35c6c26349"
contextFingerprint: 53ddb969822ac4bd2db8a246ede7728e30b617ab6fb9997d0688f7c7cc5f44ef
contextLock: docs/tasks/context/TASK-0167.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 30, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C3
  surfaceId: TASK_0167_QUOTA_LEDGER_RELEASE_RESERVATION_IDEMPOTENCY
  policySurfaces: [MODEL_ROUTING]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 20
  terminalCheckMinutesEstimate: 25
  estimatedWallMinutes: 35
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0167
  - ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime -am test
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0166/evidence-pack.json
  - docs/evidence/TASK-0166/review-r1.md
  - docs/handoffs/TASK-0166.json
  - docs/tasks/TASK-0166-v8-v11-legacy-upgrade-fail-closed-test.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaReservation.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/RouteDecision.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/DeterministicRouter.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/QuotaLedgerTest.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/GenerationRecoveryTest.java
  - owner-authorization://longline-2026-08-09
writeAllowlist:
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/QuotaLedger.java
  - service/modules/modelruntime/src/main/java/com/virtualcompanion/modelruntime/routing/GenerationRecovery.java
  - service/modules/modelruntime/src/test/java/com/virtualcompanion/modelruntime/routing/QuotaLedgerTest.java
  - docs/tasks/TASK-0167-quota-ledger-release-reservation-idempotency.md
  - docs/tasks/context/TASK-0167.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0167/**
  - docs/handoffs/TASK-0167.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-6]-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-6].context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-6]/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-6].json
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
  - service/adapters/**
  - service/tests/**
  - service/platform/**
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
  - .harness/tools.lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/model-routing-change/SKILL.md
  - specs/contracts/generation-contract.yaml
  - specs/contracts/model-protocol-contract.yaml
  - specs/contracts/authorization-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0166.json
requiredInvariants:
  - INV-GEN-001
  - INV-GEN-002
  - INV-AUTH-001
  - INV-COST-001
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
      Owner 2026-08-11/2026-08-12 授权长线审计修复一次一张新卡推进；TASK-0166（§5.1.6/RISK-10 V8/V11 存量升级
      fail-closed 测试覆盖）ACCEPTED 闭环后接续评估剩余 OPEN 项。经当前 HEAD afb43f73 串行复核确认 Java 侧两项候选：
      (1) ProviderAttemptAudit/LiveModelInvoker audit 投影一致性 —— TASK-0164 已在 DB 层完整闭环 §5.1.3/INV-AUTH-001
      （V20 NOT NULL + 复合 FK + test 59，零 Java 改动），Java ProviderAttemptAudit 不投影 snapshot 是因 P2-12 JDBC
      持久化仍 PLANNED、无 DB 写入端，投影 snapshot 属 P2-12 接线范围，非当前可独立修复缺陷，不开卡；
      (2) 内存 QuotaLedger.release 缺陷真实存在 —— QuotaLedger.java:94-114 release(String ownerUserId, long units)
      只收 owner+units 不收 reservationId；GenerationRecovery.java:113-117 releaseIfPresent 已持有 QuotaReservation
      （含 reservationId）却只传 ownerUserId+reservedUnits 调 release，丢掉 reservationId。多 reservation 交叉时
      重复 release 同一 reservation 会错误释放其他活跃 reservation 额度（数值证明：provision 100；reserve r1=60
      rem 40、r2=40 rem 0；release r1 rem 100 capped；reserve r2=70 rem 30；重复 release r1 无幂等则 rem=min(100,
      90)=90 错误多恢复 60，reserve r3=80 成功 → r2+r3=140 超 entitlement 100；有 reservation 级幂等则 r1 dup no-op
      rem 30 不变，r3=80 被正确拒绝）。ceiling cap 只挡单次 inflation，挡不住跨 reservation 交叉重复 release。
      TASK-0165 review §3 明确"No service/**/*.java changed (QuotaLedger.java/GenerationRecovery.java untouched)"，
      §5.1.4 Java 侧 release 幂等确为剩余项（DB 层 V21 per-generation RELEASE 幂等是另一层，不覆盖内存路由实时依据）。
      本卡 C3 model-routing-change（service/**/modelruntime/** 触 protected-paths.yaml:28-31 independentReview: true），
      requiredSkills 含 model-routing-change:1.0.0；R1 独立 Reviewer mandatory（C3）；不触 database-migration（无 DB
      改动）。infra/db/tests 不动，V1-V21 frozen。Maven 模块定向测试（./mvnw -pl service/modules/modelruntime -am test）
      作迭代证据；根级 verify + 完整 Harness unittest 留统一审计（Owner static-gates-only 策略）。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、stopUsageEnabled=true、
      dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结 LOCAL_EXACT_TREE_FALLBACK
      （profile=precheck），远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS（TASK-0166 R1 PASS 不复用）。
independentReview: required
reviewers: []
terminalStateReason: ""
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 §5.1.4 审计修复 Java 侧卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §5.1 第 4 项 "Quota 数值与 release 幂等"：复核
> usage/token/cost/quota 的非负 CHECK，以及重复/并发 quota release 是否有 reservation/idempotency key）。
> §5.1.4 的 DB 层（quota 非负 CHECK + per-generation RELEASE 幂等）已由 TASK-0165 ACCEPTED 闭环；
> 本卡补 Java 内存 `QuotaLedger.release` 的 reservation 级幂等。沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与 TASK-0153..0166 同属
> idle DRAFT 治理例外，不进 backlog。

## 背景与用户可观察目标

§5.1.4（TASK-0109 审计 §5.1 第 4 项 "Quota 数值与 release 幂等"，= RISK-07 "registry/quota 持久化" 的内存
前置）：复核 usage/token/cost/quota 的非负 CHECK，以及重复/并发 quota release 是否有 reservation/
idempotency key。§5.1.4 的 DB 层已由 TASK-0165 ACCEPTED 闭环（V21 四个非负 CHECK + per-(owner,generation)
partial unique index + `record_quota_release` 幂等守卫）；本卡闭合其 **Java 内存侧** 剩余缺口。

**缺陷（经当前 HEAD afb43f73 代码核实，非盲信清单）：**

- `QuotaLedger.java:94-114` 的 `release(String ownerUserId, long units)` 只接收 ownerUserId + units，**不接收
  reservationId / QuotaReservation**。release 通过 `compute` 恢复 `Math.min(ceiling, current + units)`，
  ceiling cap 只防单次 release 把余额抬过 provisioned ceiling，**但无法区分"恢复的是哪一笔 reservation"**。
- `GenerationRecovery.java:113-117` 的 `releaseIfPresent` 是唯一调用方，已持有完整的 `QuotaReservation`
  （含 `reservationId`、`ownerUserId`、`reservedUnits`、`remainingUnits`），却只传 `reservation.ownerUserId()` +
  `reservation.reservedUnits()` 给 release，**丢掉了 `reservationId`**。
- `QuotaReservation.java` 已有 `reservationId` 字段（`"qr-" + DecisionHash.hex(ownerUserId + "|" + current +
  "|" + units)`），但当前未用于 release 幂等。

**真实危害（数值证明）：** provision owner=A budget=100（ceiling=100）；reserve r1=60（rem 40）；reserve r2=40
（rem 0）；release(r1) → rem 100（capped）；reserve r2'=70（rem 30）；此时若重复 release(r1)：
- **无幂等**：rem = min(100, 30+60) = 90 —— 错误多恢复 60（r1 已 release 过），真实活跃 reservation 只有 r2'=70，
  正确 rem 应为 30；随后 reserve r3=80 成功（90→10），而 owner 真实 entitlement=100，r2'(70)+r3(80)=150 已超
  entitlement 100 —— **over-reserve fail-open**。
- **有 reservation 级幂等**：r1 重复 release = no-op，rem 保持 30；reserve r3=80 因 30<80 被正确拒绝（fail-closed）。

ceiling cap 只挡"单次 release 把余额抬过 ceiling"，挡不住"跨 reservation 交叉时重复 release 错误释放其他
活跃 reservation 的额度"。`releaseCapsAtProvisionedCeiling` 现有测试（QuotaLedgerTest:122-132）只覆盖单
reservation 重复 release 被 ceiling 挡住的 benign 场景，**未覆盖多 reservation 交叉的 over-reserve 场景**。

**范围限定（纯 Java 实现卡 C3 model-routing-change）：** 本卡只改 modelruntime 模块 3 个 Java 文件
（QuotaLedger / GenerationRecovery / QuotaLedgerTest），把 release 改为收 `QuotaReservation` 做 reservation 级
幂等去重。不修改任何 migration（V1-V21 frozen）、任何 DB test、任何 catalog/contract、任何 pom。触保护路径
`service/**/modelruntime/**`（protected-paths.yaml:28-31，riskClass C3，requiredSkill model-routing-change，
independentReview: true）。

用户可观察结果：
1. `QuotaLedger.release(QuotaReservation reservation)`：收完整 reservation；内部维护 `releasedReservations`
   去重集，同一 reservation 重复 release 为 no-op（返回当前 remaining 不变），不同 reservation 各自独立恢复。
2. `GenerationRecovery.releaseIfPresent` 改传完整 `QuotaReservation`（已持有，无新依赖）。
3. `QuotaLedgerTest` 适配新签名 + 新增 reservation 级幂等负测（重复 release r1 不影响 r2；无幂等则会 over-reserve）。
4. `./mvnw -pl service/modules/modelruntime -am test` 全 PASS（含新增幂等测试 + 既有 modelruntime 单测无回归）。
5. 不修改任何既有 migration（V1-V21）、DB test、catalog/contract/pom。
6. 终态治理闭环：canonical precheck 8/8 + git diff --check + R1 独立静态复核（C3 mandatory）+
   Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **`QuotaLedger.java`**（唯一内存 ledger 实现）：
   - 新增 `private final ConcurrentHashMap<String, Boolean> releasedReservations` 与 per-ledger
     `java.util.concurrent.atomic.AtomicLong reservationSequence`。
   - `reserve`：reservationId 改为 `"qr-" + reservationSequence.incrementAndGet() + "-" + DecisionHash.hex(...)`
     （仅在成功分支递增，使每个成功 reservation 在单 ledger 内唯一；跨 fresh ledger 同 event 仍 deterministic，
     保留 `reservationIdIsDeterministicForTheSameEvent` 语义）。失败分支不递增、不生成 reservation。
   - `release(QuotaReservation reservation)`：`requireNonNull(reservation)`；在 `compute(owner, ...)` 内先查
     `releasedReservations.containsKey(reservationId)` —— 若已 released 则返回当前 remaining（幂等 no-op，不再恢复、
     不再标记）；否则恢复 `Math.min(ceiling, current + reservation.reservedUnits())`，并把 reservationId 放入
     `releasedReservations`；未知 owner（无 budget）返回 0（与现有 fail-closed 对称）。整个 check-and-mark 在同一
     `compute` 内原子完成，并发 release 同一 reservation 只有一个生效。
   - 删除旧 `release(String ownerUserId, long units)`（其唯一调用方已持有 reservation；保留它会留下无幂等的旁路，
     违背本卡目的）。`reservation.reservedUnits() < 0` 由 `QuotaReservation` record compact constructor 已保证
     （不可达），故无需重复负值校验。

2. **`GenerationRecovery.java:113-117`**：`releaseIfPresent` 改为 `quotaLedger.release(reservation)`
   （reservation 非空时直接传入；签名收 `QuotaReservation`）。无逻辑变化（仍先判 null），只改传参。

3. **`QuotaLedgerTest.java`**：
   - 适配新签名：既有 `release(String, long)` 调用改为 `release(QuotaReservation)`（先 reserve 拿 reservation，
     再 release(reservation)，更准确反映真实用法）。
   - 保留全部既有断言语义（provision/reserve/remaining/ceiling cap/unknown owner no-op/negative reject/
     deterministic id/cyclically stable），不删测、不弱化断言。
   - 新增 reservation 级幂等负测：
     (a) `releaseRepeatedForSameReservationIsIdempotent`：provision 100；reserve r1=60、r2=40（rem 0）；
         release(r1) → rem 60；release(r1) dup → rem 60（no-op）；release(r2) → rem 100；证明重复 release r1
         未多恢复（若多恢复会 rem=100 提前，使 release(r2) 后 rem 仍 100 无法区分——改用 r2'=70 场景区分，见下）。
     (b) `releaseIdempotencyPreventsOverReserve`：provision 100；reserve r1=60（rem 40）；reserve r2=70
         fails（40<70）→ 改 reserve r2=40（rem 0）；release(r1) → rem 100 capped；reserve r3=70（rem 30）；
         release(r1) dup → rem 30（idempotent no-op）；reserve r4=80 fails（30<80，正确拒绝，证明未 over-reserve）。
         对照：若无幂等，release(r1) dup → rem=min(100,90)=90，reserve r4=80 成功 → rem 10（over-reserve，缺陷）。
     (c) `distinctReservationsReleaseIndependently`：provision 100；reserve r1=40、r2=40（rem 20）；release(r1)
         → rem 60；release(r2) → rem 100；release(r1) dup → rem 100（no-op）；证明不同 reservation 独立恢复，
         已 released 的重复 no-op。

4. 终态治理闭环：canonical precheck 8/8 + `./mvnw -pl service/modules/modelruntime -am test` PASS +
   git diff --check + R1 独立静态复核（C3 mandatory）+ Evidence/Handoff/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **不修改任何既有 migration（V1-V21）**（Flyway checksum 安全）；不新增 V22（无 DB 改动）。
- **不修改任何 DB test（01-61）**、`infra/db/run-rls-tests.sh`、任何 RLS policy、角色、约束、函数。
- 不改 catalog（specs/catalog/**）、契约（specs/contracts/**）、service apps/adapters/tests/platform、frontend、
  任何 pom.xml。
- 不改 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/**`（除 project-state/task-ledger）、`scripts/harness/**`、
  `.github/workflows/**`、`ci/**`。
- 不改 `QuotaReservation.java`（record 已有 reservationId，无需改）、不改 `DeterministicRouter.java` /
  `RouteDecision.java`（reservation 流转不变）、不改 `LiveModelInvoker.java`（audit/recovery 调用不变）。
- 不处理其它审计项（§5.1.2 worker fence、P1-04/05/11、P2-03、P2-22 等需 Owner 决策；ProviderAttemptAudit
  投影属 P2-12 JDBC 接线）。
- 根级 Maven verify 与完整 Harness unittest 按 Owner 2026-08-12 static-gates-only 策略 deferred to unified audit
  （本卡跑受影响模块定向 test 作迭代证据）。

## 输入和前置条件

- Base `afb43f730189006a371181dbca5413b5cd42cce3` = TASK-0166 ACCEPTED terminal（已 push、0/0、clean；
  nextAction 与 docs/handoffs/TASK-0166.json byte-for-byte 一致，sha256 `0c702982...` 已校验）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。context fingerprint `53ddb969...` 由自验算法生成
  （先复现 TASK-0166 `ad620ead...` 通过，再生成 TASK-0167）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- Java 工具链：JDK 25（`/opt/homebrew/opt/openjdk@25`，brew 安装，25.0.4）；项目 `maven.compiler.release=25`。
- Maven 模块定向测试：`JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
  ./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime -am test`（受影响模块 + 其依赖，
  作迭代证据；本地 ~/.m2 已有 modelruntime 依赖）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0167`（profile=precheck 8 子命令）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件/数据契约变更。`QuotaLedger` 是 modelruntime 内部 in-memory synthetic 模拟器（package-private
路由组件，非对外 API），无 OpenAPI/catalog/契约投影。release 签名从 `(String, long)` 改为 `(QuotaReservation)`
是内部实现变更，唯一调用方 GenerationRecovery 同卡改。不改任何 contract yaml、OpenAPI source、catalog 输出。

## 权限、RLS 和数据处理要求

- 不涉及数据库、RLS、角色、GRANT/REVOKE。纯内存 Java 实现。
- `QuotaLedger` 用 `ConcurrentHashMap.compute` 保证 per-owner 原子性；新增 `releasedReservations` 去重集的
  check-and-mark 在同一 `compute` 内完成，并发 release 同一 reservation 只有一个生效（幂等）。
- 不改任何认证/授权/租户隔离逻辑；`QuotaReservation` 的 ownerUserId 校验不变。

## 状态机和失败行为

- 实现 = 3 个 Java 文件修改（QuotaLedger 改 release 签名 + 幂等；GenerationRecovery 改传参；QuotaLedgerTest
  适配 + 新增 3 幂等测试）。
- `./mvnw -pl service/modules/modelruntime -am test` 全 PASS（含 QuotaLedgerTest 既有 + 新增、GenerationRecoveryTest
  既有、DeterministicRouterTest 既有，无回归）。若编译或测试失败，据此迭代修正。
- canonical precheck 8 子命令 PASS（doctor 校验 writeAllowlist/forbiddenPaths 零冲突、context fingerprint 一致、
  protected-path 技能匹配 model-routing-change；catalog/openapi/license/paid-feature 无 drift，因本卡不改这些）。
- R1 独立静态复核 PASS（C3 mandatory；0 P0/P1/P2）。R1 阻塞 → 最多 1 fix batch（仅改 3 个实现文件，不动卡 body
  保持 READY projection 冻结）→ R2；R3 禁止。超 hardFuse 90min → closure-only overrun 或 REJECTED。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。`QuotaLedger` 是 Technical Alpha 路由组件的 in-memory synthetic quota 模拟器（无持久
ledger 行、无真实成本），reserve/release 决定路由层能否为一次 external attempt 分配 synthetic 容量。本卡把
release 从"按 owner 盲恢复 units"收紧为"按 reservation 原子幂等恢复"，使重复/并发 release 不能错误释放其他
活跃 reservation 的额度，维持 quota 边界 fail-closed（不 over-reserve 超 entitlement）。

## 验收标准

1. `QuotaLedger.release(QuotaReservation reservation)` 实现reservation 级幂等：同一 reservation 重复 release
   为 no-op（返回当前 remaining 不变），不同 reservation 各自独立恢复；check-and-mark 原子（同一 compute）。
2. `reserve` 的 reservationId 在单 ledger 内唯一（sequence 前缀），跨 fresh ledger 同 event 仍 deterministic
   （`reservationIdIsDeterministicForTheSameEvent` 继续通过）。
3. `GenerationRecovery.releaseIfPresent` 改传完整 `QuotaReservation`；旧 `release(String, long)` 删除。
4. `QuotaLedgerTest` 既有断言全部保留通过 + 新增 reservation 级幂等负测（重复 release r1 不影响 r2；
   idempotency 阻止 over-reserve；distinct reservation 独立）。
5. 不修改任何既有 migration（V1-V21）、DB test（01-61）、catalog/contract/pom、其他 service Java 文件。
6. `./mvnw -pl service/modules/modelruntime -am test` PASS（exit 0）。
7. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
8. 唯一无参数 `git diff --check` PASS（exit 0）。
9. R1 独立静态复核 PASS（C3 mandatory；0 P0/P1/P2）。
10. 根级 Maven verify 与完整 Harness unittest 按 Owner static-gates-only 策略 deferred to unified audit
    （Evidence 如实标注，不转换为 PASS）。
11. 终态单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
    remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- `./mvnw --batch-mode --no-transfer-progress -pl service/modules/modelruntime -am test` 跑一次（Java 模块定向
  迭代证据，JDK 25）；
- 完整 Harness unittest 按 static-gates-only 策略 deferred to unified audit（列入 requiredCommands 但本卡不跑，
  doctor 不校验 requiredCommands 是否真跑，只校验字段冻结）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞或 Maven test 失败：最多 1 fix batch（仅修正 3 个实现文件的 release 幂等逻辑/测试）→ R2；
若再次超 hardFuse 或发现真实缺陷，如实 REJECTED 并报告 Owner 决策。本卡是前向 Java 实现，不触碰历史制品；
若复核发现 release 幂等缺陷实际由更深层的 reservation 生命周期问题引起（超出 modelruntime 范围），停止并转
Owner 决策是否扩大范围。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（尤其 V1-V21 既有 migration、DB test 01-61、
  run-rls-tests.sh、catalog/contract/pom、其他 service Java 文件）。
- `./mvnw` 模块 test / canonical precheck / diff check 任一非 PASS。
- release 幂等实现破坏既有 fail-closed 语义（reserve 不足仍 empty、unknown owner 仍 no-op、ceiling 仍 cap）。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0167/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0167.json`。
