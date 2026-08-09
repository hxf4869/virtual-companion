# TASK-0133：Harness 默认分支 Fixture 可移植性

```yaml
taskId: TASK-0133
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
baseCommit: ce8cf00587f7ef76bfbe5cb6ff9e1a198d03f459
authorizationCommit: null
contextFingerprint: fcfca1f80167a18b028f75f5bd6bd81206938421bbbdf7d99f31e7f21a003687
contextLock: docs/tasks/context/TASK-0133.context-lock.yaml
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
  surfaceId: TASK_0133_HARNESS_DEFAULT_BRANCH_FIXTURE_PORTABILITY
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 55
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - .github/workflows/ci.yml
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
  - AGENTS.md
  - CLAUDE.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0132/evidence-pack.json
  - docs/evidence/TASK-0132/review-r1.md
  - docs/handoffs/TASK-0132.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0132-provider-egress-hostname-case-normalization.md
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0133/**
  - docs/handoffs/TASK-0133.json
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-0130-*
  - docs/tasks/TASK-0131-*
  - docs/tasks/TASK-0132-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-0130/**
  - docs/evidence/TASK-0131/**
  - docs/evidence/TASK-0132/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-0130.json
  - docs/handoffs/TASK-0131.json
  - docs/handoffs/TASK-0132.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/__init__.py
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
  - service/**
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
  - skills/harness-change/SKILL.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/tasks/TASK-0132-provider-egress-hostname-case-normalization.md
  - docs/evidence/TASK-0132/evidence-pack.json
  - docs/handoffs/TASK-0132.json
  - scripts/harness/tests/test_harness.py
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
  - INV-HARNESS-008
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 恢复当前长线 goal，要求 Codex 不启用 fast 且不中断地修复全部审计问题；TASK-0132
      已 ACCEPTED、推送并远端 0/0，其 Handoff 与 project-state 唯一 nextAction 精确指向本任务。
  - scope: harness-change-p2-20-default-branch-fixture
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 已明确授权按审计继续修复并要求不为常规决策询问。本 C4 卡只修改一个 Harness test
      源文件，关闭已复现的 P2-20 master 硬编码；不修改任何 Harness 真源、脚本实现、阈值或门禁。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用历史 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0133
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，因此不写 `planningBacklog` 或 `planningContractHash`。本卡只关闭审计
> P2-20，不决定或修改 P2-21 canonical Python 合同。

## 背景与用户可观察目标

Harness 的 `IdlePlanningCheckpointTests` 在 merge 负例中将初始化分支硬编码为 `master`。当前机器
`init.defaultBranch=main`，精确测试已在当前 Base 重现 `pathspec 'master' did not match`，使 Harness
全量测试在合法 Git 配置下产生环境相关错误。目标是始终返回 fixture 实际初始分支，同时证明 main、
master 与无用户级 Git 配置三类环境都保留原 merge 拒绝语义。

## 范围内

- 只修改 `scripts/harness/tests/test_harness.py`。
- fixture 初始化可显式指定测试分支；merge 负例动态查询当前分支后创建 side 并返回。
- 增加 main、master、`GIT_CONFIG_GLOBAL=/dev/null` 三种回归，均断言 merge 历史被拒绝。
- 完成 C4 独立 Reviewer、冻结候选正式门禁与终态闭环。

## 明确范围外

- 不改 Doctor、harness_common、Precheck、wrapper、命令注册、policy、Skill、AGENTS 或 CI workflow。
- 不选择 `python`/`python3`/受控解释器，不修 P2-21、P2-23 至 P2-27 或 OpenAPI gate。
- 不改 task lifecycle、风险等级、Diff Scope、Evidence schema、阈值或历史制品。
- 不改任何业务、数据库、frontend、spec 或生成物。

## 输入和前置条件

- Base `ce8cf00587f7ef76bfbe5cb6ff9e1a198d03f459` 是 TASK-0132 ACCEPTED 单父终态，已 push、fetch、
  `HEAD...origin/main=0/0`、clean 且 post-terminal Doctor PASS。
- 当前受控 Python 3.13 运行精确测试时，在 merge subtest 因 checkout `master` 退出 1，其他场景不阻塞。
- Context Lock 固定 Harness 真源、ADR、原审计交接、即时 Handoff 与目标测试。

## API / 事件 / 数据契约

不改变产品 API。测试 helper 的可选 `initial_branch` 只属于 unittest fixture，不是 Harness 运行接口。

## 权限、RLS 和数据处理要求

不触碰业务数据、RLS、凭据或网络。临时 Git 仓库仅包含 synthetic planning fixture。

## 状态机和失败行为

- merge 场景仍必须生成真实双父 merge commit，并由 `derive_idle_planning_checkpoint` 拒绝。
- 分支发现失败必须使测试失败，不能回退到猜测的 `main` 或 `master`。
- 无全局配置只通过进程环境隔离测试，不修改用户或系统 Git 配置。

## 模型、Prompt、记忆和安全边界

不涉及模型、Prompt、Memory 或业务授权。Harness 约束只减少 fixture 误报，不放宽任何治理规则。

## 验收标准

1. 当前 `init.defaultBranch=main` 环境不再因 checkout `master` 报错，merge 拒绝断言真实到达。
2. 显式 main、显式 master 与 `GIT_CONFIG_GLOBAL=/dev/null` 初始化三例均查询实际 primary branch、返回后
   构造 merge，并得到 non-PASS derivation 与非空 audit errors。
3. 测试不读取或写入用户 Git config，不以固定分支名兜底，不吞 subprocess 退出码。
4. Base 后业务/实现 diff 仅 `scripts/harness/tests/test_harness.py`；Harness 真源、历史制品与 forbidden paths 零 diff。
5. 独立 Reviewer 的 P0/P1/P2=0；任何真实缺陷最多一个 fix batch 和 R2，禁止 R3。
6. frozen Precheck、完整 Harness unittest 与唯一无参数 `git diff --check` 在同一 clean candidate 按顺序
   各执行一次并 PASS。
7. terminal closure、push/fetch、HEAD==origin/main、0/0、clean 和 post-terminal Doctor 全部 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前不运行正式门禁；历史 Reviewer 和
命令结果不得复用。

## 回滚或前向修复

- 当前 Base 是唯一前向起点，不重写历史任务。
- 若修复需要变更 Harness 生产逻辑或机器真源，停止并使用新的永久 Task ID 授权。
- 终态后缺陷使用新永久任务，不 amend/reset/rebase/squash。

## 停止条件

- 需要修改目标 test file 之外的实现，或触碰任一 forbidden path。
- Reviewer 15 分钟内无终态、R2 后仍有 P0/P1/P2、需要第二 fix batch/R3。
- 任一 formal/pre-closure/push/remote 复核非 PASS，或达到 hard fuse。

## Evidence Pack

输出 `docs/evidence/TASK-0133/` 与 `docs/handoffs/TASK-0133.json`，绑定候选 Commit/Tree、Reviewer、
精确命令、local/remote 渠道与 timing；终态原子更新 Card/Project State/Ledger/Evidence/Handoff，使用
`[skip ci]` 单父提交推送并复核远端。
