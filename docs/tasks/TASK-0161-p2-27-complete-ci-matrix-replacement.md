# TASK-0161：P2-27 完整 CI 矩阵 replacement（TASK-0157 REJECTED TIMEOUT）

```yaml
taskId: TASK-0161
state: DRAFT
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
baseCommit: b0c44fb252a1b0ba1ac2c5f7fbae49b49a069b84
authorizationCommit: ""
contextFingerprint: b4d84bf26d487c99077bf4a82c0e3b3ed9bb636ea212c035ab5c7d5f0655d339
contextLock: docs/tasks/context/TASK-0161.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 90
  targetWallMinutes: 120
  hardFuseWallMinutes: 180
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 120, hardFuseWallMinutes: 180, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 90, targetWallMinutes: 120, hardFuseWallMinutes: 180, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 60, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0161_P2_27_CI_MATRIX_REPLACEMENT_VALIDATION
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 50
  terminalCheckMinutesEstimate: 50
  estimatedWallMinutes: 130
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0161
  - python -m unittest discover -s scripts/harness/tests -p "test_*.py"
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
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
  - docs/evidence/TASK-0157/evidence-pack.json
  - docs/evidence/TASK-0157/review-r1.md
  - docs/handoffs/TASK-0157.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0157-p2-27-complete-ci-matrix.md
  - docs/tasks/task-card-template.md
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0161-p2-27-complete-ci-matrix-replacement.md
  - docs/tasks/context/TASK-0161.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0161/**
  - docs/handoffs/TASK-0161.json
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
  - service/**
  - infra/**
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
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0157/evidence-pack.json
  - docs/handoffs/TASK-0157.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 在 TASK-0157 REJECTED TIMEOUT 后批准 replacement TASK-0161：以
      b0c44fb（TASK-0157 REJECTED terminal）为 Base；候选 872311a 实现（4 文件改动）已在
      Base 中不重复，本卡只跑验证。deliveryBudgets.hardFuseWallMinutes=180 覆盖完整
      Harness unittest × 2 串行 + canonical + R1 + closure（避免 TASK-0157 并行 IO 争用
      hung 重演）。C4 harness-change + humanApproval(scope: harness-change) + 独立 Reviewer
      + 完整 Harness unittest + canonical precheck。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 批准 replacement 卡：4 个实现文件已在 Base b0c44fb（TASK-0157 candidate
      872311a 内容），本卡 writeAllowlist 不含实现文件，只跑完整验证（unittest × 2 串行 +
      canonical + diff + R1）；hardFuse=180。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS（TASK-0157 R1 FAIL/TIMEOUT 不复用）。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 TASK-0157
> （P2-27 完整 CI 矩阵）的 replacement 卡：TASK-0157 候选 872311a 实现静态层面正确
> （0 P0/P1/P2，全部静态门禁 PASS），但 acceptance #5（完整 Harness unittest PASS）因
> 并行 unittest IO 争用 hung + hardFuse 90min 到达而未独立确认 → REJECTED TIMEOUT。
> 本卡以 REJECTED terminal b0c44fb 为 Base（候选 872311a 实现已在 Base 中），不重复实现，
> 只跑完整验证：unittest 串行 + canonical + diff + R1 + 终态 ACCEPTED。hardFuse=180。

## 背景与用户可观察目标

TASK-0157（P2-27 完整 CI 矩阵）候选 `872311a` 实现正确完成全部 4 文件改动
（ci-execution-policy.yaml BACKEND_LOCAL windowsJavaHome→javaToolchain、doctor.py 断言+hash
同步、test_harness.py 新增 7 subTest 负测、ci.yml backend+frontend 三平台 matrix），且静态层面
全部门禁 PASS（doctor 751922/752227 PASS、canonical hash 重算一致、diff --check exit 0、
scope/invariants clean、目标测试 CiExecutionPolicyTests + CiWorkflowTests 聚焦 PASS）。

但完整 Harness unittest 在 TASK-0157 内未独立跑通：第一次 impl-agent Evidence unittest 与
R1 独立 unittest 并行运行时，两进程 git IO/subprocess pipe 争用导致双方均 hung ~30 min
（0% CPU、RSS 不变、STAT S），无任何输出；串行重试仍呈现 stalling 迹象。policy hardFuse
90min 在 candidate elapsed ~99min 时到达。按 Owner 2026-08-12 决策「REJECTED + replacement
严格执行 policy」，TASK-0157 REJECTED terminal closure（b0c44fb），candidateExecution.outcome=TIMEOUT。

本卡 TASK-0161 以 b0c44fb 为 Base（候选 872311a 实现已在 Base 中），**不修改任何实现文件**，
只跑完整验证。用户可观察结果与 TASK-0157 一致：BACKEND_LOCAL.windowsJavaHome 移除、javaToolchain
声明字段、CI 三平台 matrix、doctor 断言同步、负测门禁补全。本卡的目标是给候选一个干净、
独立的完整 unittest + canonical + R1 验证。

## 范围内

1. **本卡不修改任何实现文件**（4 个实现文件已在 Base b0c44fb 中）。
2. 完整 Harness unittest（串行，**禁止与 R1 并行**）：`python -m unittest discover -s
   scripts/harness/tests -p "test_*.py"`，约 30-45 min wall，PASS（278+ tests，0 failures）。
3. canonical precheck：`python scripts/harness/precheck.py --task TASK-0161`，8/8 PASS
   （doctor/catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck/betaRosterGate/
   openapiValidate/openapiDrift）。
4. git diff --check（无参数，exit 0）。
5. R1 独立 Reviewer（fork_turns=none，**串行**：等 impl-agent unittest 完成后再 dispatch），
   独立跑 unittest + doctor + diff + diff 审查，PASS（0 P0/P1/P2）。
6. 终态治理闭环：pre-closure Doctor + 单父 [skip ci] ACCEPTED terminal 提交 +
   push + 远端 0/0/clean。

## 明确范围外

- 不修改任何实现文件（4 个实现文件已在 Base b0c44fb）。
- 不重复 TASK-0157 的实现工作。
- 不动 harness-full/harness-smoke/supply-chain job。
- 不动 HARNESS_PORTABILITY_LOCAL profile 三平台冻结。
- 不动 skills/**、AGENTS.md、CLAUDE.md、task-delivery-policy.yaml。
- 不处理 RISK-09（TASK-0158）、其它审计项。

## 输入和前置条件

- Base `b0c44fb` = TASK-0157 REJECTED terminal（已 push、0/0、clean；Doctor summary PASS
  915455 checks）。Base 已含候选 872311a 的全部 4 文件实现。
- 本卡 context lock 39 输入钉在 Base；provenance `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1...`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- 完整 Harness unittest 约 30-45 min；**必须串行**（impl-agent 与 R1 不可并行，TASK-0157
  并行 IO 争用 hung 教训）。
- canonical precheck 约 100-110s。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck。

## API / 事件 / 数据契约

不涉及。

## 权限、RLS 和数据处理要求

不涉及。

## 状态机和失败行为

- 实现 = 0（候选已在 Base）；本卡全部工作是验证。
- 完整 unittest PASS（278+ tests，0 failures）。
- canonical precheck 8/8 PASS。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 180min → closure-only overrun
  或 REJECTED（届时需 Owner 评估是否再次 replacement）。

## 模型、Prompt、记忆和安全边界

不涉及。

## 验收标准

1. 候选 872311a 实现（在 Base 中）保持不变：BACKEND_LOCAL 含 javaToolchain、不含 windowsJavaHome；
   doctor.py 断言+hash 同步；test_harness.py 含 7 subTest 负测；ci.yml 三平台 matrix。
2. 完整 Harness unittest PASS（278+ tests，0 failures，含 TASK-0157 新增 5+ 负测）。
3. 唯一 canonical precheck 8/8 PASS（profile=precheck）。
4. 唯一无参数 `git diff --check` PASS（exit 0）。
5. R1 独立复核 PASS（C4 必须；0 P0/P1/P2；独立串行跑 unittest + doctor + diff）。
6. 终态 pre-closure PASS、单父 [skip ci] ACCEPTED 提交、push 后 HEAD==origin/main、0/0、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0）。
7. INV-HARNESS-004 改善（已随 TASK-0157 候选 872311a 落地）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（8 子命令不重复）；
- 完整 Harness unittest 跑一次（impl-agent Evidence），约 30-45 min；
- R1 独立串行再跑一次 unittest（约 30-45 min，独立验证）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞：最多 1 fix batch → R2；若再次超 hardFuse 或发现真实缺陷，如实 REJECTED
并报告 Owner 决策（候选 872311a 实现已落地，进一步 replacement 可能需要新实现）。

## 停止条件

- 候选 872311a 实现被修改（writeAllowlist 外路径被改；本卡禁止改实现）。
- 完整 unittest / canonical / diff / pre-closure 任一非 PASS。
- R1 发现真实 P0/P1 缺陷（非 hardFuse 超时）。
- hardFuseWallMinutes 180 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0161/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0161.json`。
