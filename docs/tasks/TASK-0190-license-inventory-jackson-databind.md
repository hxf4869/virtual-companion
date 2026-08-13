# TASK-0190：license inventory 补齐（jackson-databind Jackson 2）+ greenline precheck 恢复

```yaml
taskId: TASK-0190
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: f3cbecfeabc1247a107606cb4c3a375d300fba3c
authorizationCommit: ec769e4cf84643dd6ac1176dd5a4d367c9d4d97f
contextFingerprint: b3a9aceedc4122018f2d4b109036f02d41334137601e59a875e29f41c7089499
contextLock: docs/tasks/context/TASK-0190.context-lock.yaml
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
  surfaceId: TASK_0190_LICENSE_INVENTORY_JACKSON_DATABIND
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260813-TASK-0190-PRE-READY-01
  recordPath: docs/evidence/TASK-0190/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - .harness/license-inventory.yaml
    - docs/evidence/TASK-0190/pre-ready-maintenance-authorization.json
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/evidence-pack.json
  - docs/evidence/TASK-0189/review-r1.md
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/handoffs/TASK-0189.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - scripts/harness/check_licenses.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - service/apps/runtime/pom.xml
  - specs/contracts/license-cost-boundary-contract.yaml
writeAllowlist:
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - .harness/license-inventory.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0190/**
  - docs/handoffs/TASK-0190.json
forbiddenPaths:
  - .github/**
  - ci/**
  - service/apps/runtime/pom.xml
  - service/**
  - frontend/**
  - infra/**
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - scripts/harness/check_licenses.py
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - skills/catalog-change/SKILL.md
  - skills/contract-change/SKILL.md
  - skills/database-migration/SKILL.md
  - skills/memory-change/SKILL.md
  - skills/model-routing-change/SKILL.md
  - skills/safety-change/SKILL.md
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/evidence/TASK-0184/**
  - docs/handoffs/TASK-0184.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/**
  - docs/handoffs/TASK-0189.json
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
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
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/evidence-pack.json
  - docs/handoffs/TASK-0189.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - service/apps/runtime/pom.xml
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-COST-001
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      Owner 于 2026-08-13 授权 TASK-0190（license inventory 补齐）：baseCommit 为
      TASK-0189 REJECTED 终态 f3cbecfeabc1247a107606cb4c3a375d300fba3c；写范围仅
      .harness/license-inventory.yaml 与本卡必需 task/context/project-state/ledger/
      evidence/handoff/review 路径；TASK-0189 已验证的 6 个实现路径（doctor.py/
      test_harness.py/ci-execution-policy.yaml/task-delivery-flow SKILL/task-intake
      SKILL/owner-auth json）只读不写；补经 POM 核验的 com.fasterxml.jackson.core:
      jackson-databind（Apache-2.0）条目；不修改 TASK-0184、TASK-0189 历史制品；
      冻结完整 canonical precheck、git diff --check 与 C4 独立复核；最终结果绑定
      同一真实候选 SHA；后续任务 Base 始终使用最新合法终态提交。Owner 追加批准
      一次性 pre-READY maintenance boundary（recordId OWNER-MAINT-20260813-TASK-
      0190-PRE-READY-01）：仅允许修改两个精确路径 .harness/license-inventory.yaml
      与 docs/evidence/TASK-0190/pre-ready-maintenance-authorization.json，必须为
      DRAFT 的直接单父提交，oneTimeOnly: true、不可复用、消费后惰化；只增加经 POM
      核验的 Jackson 2 license 条目，不修改任何历史制品；边界完成后自主推进 READY
      Doctor、IN_PROGRESS、同一候选 SHA 的完整 canonical precheck、C4 独立复核及
      ACCEPTED 闭合，只有路径扩展/历史改写/策略或生命周期变更/非 PASS/Reviewer
      P0/P1/预算超限/不可逆操作才暂停；CiExecutionPolicyTests 约 34 分钟耗时继续
      作为 CI 预算风险记录，不得表述为 CI 兼容 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0190
  - git diff --check
```

> 本卡为独立延续单卡（TASK-0189 REJECTED 后的下一永久任务），不写 planningBacklog/planningContractHash；ID 已核对未占用。**Base 原则**：后续任务 Base 始终使用最新合法终态提交（本卡为 TASK-0189 REJECTED 终态 `f3cbecfe`），不使用历史 checkpoint（如 `80fd3e6`）或更早的 `c626005`。

## 背景与用户可观察目标

canonical precheck 的 licenseCheck 失败：`service/apps/runtime/pom.xml` 的
`com.fasterxml.jackson.core:jackson-databind`（TASK-0184 引入，compile scope，Spring Boot
BOM 管理版本）不在 `.harness/license-inventory.yaml`（仅记录 Jackson 3 的
`tools.jackson.core:jackson-databind`）。这是 TASK-0184 引入依赖时未同步 inventory 的历史
遗漏（其当年 doctor/precheck NOT_RUN，被"跳过长检查"策略掩盖），导致 TASK-0189 无法通过
canonical precheck 而以 REJECTED 闭合。本卡在 `.harness/license-inventory.yaml` 补一条经
POM 核验的 `com.fasterxml.jackson.core:jackson-databind`（Apache-2.0）条目，使 canonical
precheck 恢复全绿，完成 greenline 恢复的最后一块。

## 范围内

- 在 `.harness/license-inventory.yaml` 的 `mavenDirectDependencies` 增加一条：
  `groupId: com.fasterxml.jackson.core`、`artifactId: jackson-databind`、
  `licenseFamily: Apache-2.0`（与 POM `service/apps/runtime/pom.xml` 的实际依赖一致；
  与既有 `tools.jackson.core:jackson-databind`（Jackson 3）条目并列，两者都保留）。
- 唯一一次性 pre-READY maintenance boundary（recordId `OWNER-MAINT-20260813-TASK-0190-PRE-READY-01`）
  在 DRAFT 后、READY 前以直接单父提交落地：只改 `.harness/license-inventory.yaml` 与
  `docs/evidence/TASK-0190/pre-ready-maintenance-authorization.json`，oneTimeOnly、
  不可复用、消费后惰化，不修改任何历史制品。
- 以同一真实候选 SHA 跑通完整 canonical precheck（真实退出码）与 `git diff --check`。
- C4 独立复核（review-r1.md）+ Evidence Pack + Handoff + project-state + Task Ledger，
  ACCEPTED 闭合。

## 明确范围外

- **不修改** TASK-0184、TASK-0189 的任何历史制品（卡/context/evidence/handoff）。
- **不写** TASK-0189 已验证的 6 个实现路径（doctor.py/test_harness.py/
  ci-execution-policy.yaml/task-delivery-flow SKILL/task-intake SKILL/owner-auth json）；
  除非 Doctor 证明必须调整并另行申请授权。
- 不修改任何业务代码、pom.xml、其它依赖、CI workflow、Backlog、lifecycle 或受保护真源。
- 不修审计发现的任何业务问题；不做 tail 通用化或 terminal 流程治本改造。
- 不创建/不删除分支，不动 `codex/audit-20260813` 分支；不改写任何已提交历史。

## 输入和前置条件

- Base Commit：`f3cbecfeabc1247a107606cb4c3a375d300fba3c`（TASK-0189 REJECTED 终态提交，
  单父 `80fd3e6`；tree `596273b4…`）。
- Context Lock：`docs/tasks/context/TASK-0190.context-lock.yaml`（fingerprint
  `b3a9acee…`，39 inputs）。
- 已核验 POM 依赖：`service/apps/runtime/pom.xml` 的
  `com.fasterxml.jackson.core:jackson-databind`（compile，版本由 Spring Boot BOM 管理）；
  inventory 现有 `tools.jackson.core:jackson-databind`（Jackson 3）保留。
- 需使用 `harness-change`（C4 protected path，`license-inventory.yaml` 属 `.harness/**`，
  humanApproval: repository-owner + independentReview）。

## API / 事件 / 数据契约

- 仅修改 `license-inventory.yaml` 的 `mavenDirectDependencies` 列表（append-only 追加一条，
  不改既有条目）；不新增/修改任何 OpenAPI、catalog、contracts、events schema。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS、业务数据；仅治理清单数据。
- `.harness/license-inventory.yaml` 为 C4 protected path（requiredSkill: harness-change，
  humanApproval: repository-owner，independentReview: required）——本卡已声明。

## 状态机和失败行为

- 若补条目后 licenseCheck 仍 FAIL（如 license family 判定问题），按 fail-closed 停止，
  记录真实退出码，不转 PASS。
- 若 Doctor 证明必须调整 TASK-0189 的 6 个实现路径或其它 writeAllowlist 外路径，停止并
  另行申请 Owner 授权，不自行扩权。
- CiExecutionPolicyTests 本地约 34 分钟超 CI 10 分钟预算：完整 discover 不作为本卡
  验收条件（如实 NOT_RUN），不表述为 CI 完全兼容。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块；仅治理清单数据修正。

## 验收标准

1. **inventory 条目**：`license-inventory.yaml` 新增
   `com.fasterxml.jackson.core:jackson-databind`（licenseFamily: Apache-2.0），与 POM 核验
   一致；既有 `tools.jackson.core:jackson-databind` 条目不变。
2. **canonical precheck**：以同一真实候选 SHA 运行 `precheck.py --task TASK-0190` 全绿
   （含 licenseCheck PASS），保留真实退出码 0。
3. **git diff --check**：PASS。
4. **范围合规**：diff 仅含 writeAllowlist 路径；TASK-0184/0189 历史制品与 TASK-0189 的 6
   个实现路径零修改（git diff 验证）。
5. **C4 独立复核**：reviewer PASS（不省略，Reviewer 独立于实现者）。
6. **doctor PASS**：READY Doctor 与终态后 doctor 均 PASS。
7. **交付闭环**：Evidence/Handoff 与终态 project-state `nextAction` 逐字一致；Ledger 追加
   TASK-0190 ACCEPTED；origin/main `0/0`（未推送则如实记录）。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准：`python scripts/harness/precheck.py --task
TASK-0190` 与 `git diff --check`；每条记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

- 若补条目后仍有 FAIL，按 fail-closed 停止并在 `maximumFixBatches: 1` 内修订
  writeAllowlist 内文件后重跑；超出即停止询问 Owner。
- 需要修改 writeAllowlist 外路径时立即停止，另行申请授权。

## 停止条件

- 需要修改 TASK-0189 的 6 个实现路径或其它 writeAllowlist 外路径时立即停止。
- 任何把 NOT_RUN/失败/超时转为 PASS 的行为立即停止。
- Reviewer 未通过、canonical 未 PASS 时不得进入 terminal。

## Evidence Pack

输出到 `docs/evidence/TASK-0190/`（含 `review-r1.md`），并生成 `docs/handoffs/TASK-0190.json`。
