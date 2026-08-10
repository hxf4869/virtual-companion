# TASK-0134：TASK-0133 Harness 授权失败精确隔离与 P2-20 承接

```yaml
taskId: TASK-0134
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
baseCommit: 3c30dd693af0574eb160bbbd37b2e8e2b79a9d80
authorizationCommit: e220647beb4d66d4202ffa7c0566804a1b908a69
contextFingerprint: b8a971de490359f186de9ddeb77da4d541ca94ec83a80218b8e8edfe8a871e26
contextLock: docs/tasks/context/TASK-0134.context-lock.yaml
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
  surfaceId: TASK_0134_TASK0133_HARNESS_APPROVAL_QUARANTINE
  policySurfaces: [GOVERNANCE, AUTHORIZATION, HISTORY]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    TASK-0133 的固定 REJECTED 身份、错误 approval scope、终态产物与唯一 Doctor 放行点必须在同一
    fail-closed predicate 中原子绑定；拆分会使前一张卡无法建立可验证绿线，后一张卡则依赖尚未生效的
    历史隔离。Owner 已明确批准按该前向恢复方案执行。
rejectedHistoryQuarantine:
  taskId: TASK-0133
  cardPath: docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  baseCommit: ce8cf00587f7ef76bfbe5cb6ff9e1a198d03f459
  readyAuthorizationCommit: 1001c7304548d6089cb800fb627cfe998e100fcd
  readyTree: 5334cc36968fe4b7fa58d5453a3d10c7c07796d1
  authorizationBindingCommit: eb87ec50ce62e12ae488cb990ce121c9005ca589
  inProgressCommit: 68d3487785ac832273abd1ddfdbb418f113625f4
  candidateCommit: fca2f55f524952d34223b562a8db88f0e95a9342
  candidateTree: 1f025c7f2d088997800d990f808219a00a927918
  terminalCommit: 3c30dd693af0574eb160bbbd37b2e8e2b79a9d80
  terminalTree: de68fb31bc2f22c725a979e9dda00895fa9af41a
  protectedPath: scripts/harness/tests/test_harness.py
  requiredSkill: harness-change
  invalidApprovalScope: harness-change-p2-20-default-branch-fixture
  candidateTestSha256: 51e08137927e17e06f18f6b0453d617177fd93b5ec90273efb2bbd0bef7d49d9
  readyCardSha256: c6149cf38787315a62b354af7e94e1f7e29f2565adfa62082431fb283c5aa137
  terminalArtifacts:
    docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md: 4706a0763dedfac52054c65a734730053733a625b0c956c2bb1f0dcdd36e9ee4
    docs/evidence/TASK-0133/evidence-pack.json: 458d54dcc74866cb194f1def1a3d11a4a3a0b1fad239e0ecd3ac354662865f4a
    docs/evidence/TASK-0133/pre-closure-request.json: 46c71a96b2e02e1de187be1dc677a41239a5e77391b3f6d97c543f864da2246d
    docs/evidence/TASK-0133/review-r1.md: 76f02bba9ece1dd284ed79ecf6114ad479f4f0fbc73afed9eed7dbc54f92ad21
    docs/handoffs/TASK-0133.json: 071b8e31d829302725b2441d5a306e714fee62cfd15d67c12f51ac202dae46a3
  formalPrecheck:
    status: FAIL
    exitCode: 1
    stdoutSha256: 4b71cdc57a872ffe8e8225cc0960dd3d505c16ac03c62fa675e4db59114093a7
    stderrSha256: 39fb5f5eb43fea0c04139b070352522b455007a5ff59a52dfda8173a50a175eb
    exactError: 'TASK-0133: scripts/harness/tests/test_harness.py requires recorded human approval for harness-change'
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
  - docs/evidence/TASK-0133/evidence-pack.json
  - docs/evidence/TASK-0133/pre-closure-request.json
  - docs/evidence/TASK-0133/review-r1.md
  - docs/handoffs/TASK-0133.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  - docs/tasks/context/TASK-0133.context-lock.yaml
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
  - docs/tasks/TASK-0134-task0133-harness-approval-quarantine.md
  - docs/tasks/context/TASK-0134.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0134/**
  - docs/handoffs/TASK-0134.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-0130-*
  - docs/tasks/TASK-0131-*
  - docs/tasks/TASK-0132-*
  - docs/tasks/TASK-0133-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-0130.context-lock.yaml
  - docs/tasks/context/TASK-0131.context-lock.yaml
  - docs/tasks/context/TASK-0132.context-lock.yaml
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-0130/**
  - docs/evidence/TASK-0131/**
  - docs/evidence/TASK-0132/**
  - docs/evidence/TASK-0133/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-0130.json
  - docs/handoffs/TASK-0131.json
  - docs/handoffs/TASK-0132.json
  - docs/handoffs/TASK-0133.json
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
  - docs/tasks/TASK-0133-harness-default-branch-fixture-portability.md
  - docs/tasks/context/TASK-0133.context-lock.yaml
  - docs/evidence/TASK-0133/evidence-pack.json
  - docs/evidence/TASK-0133/pre-closure-request.json
  - docs/evidence/TASK-0133/review-r1.md
  - docs/handoffs/TASK-0133.json
  - scripts/harness/doctor.py
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
      Owner 在获知 TASK-0133 的 immutable approval scope 冲突、正式 Precheck FAIL 和推荐前向恢复方案后
      明确回复“按你说的来”，批准 TASK-0133 如实 REJECTED，并创建本 C4 一次性治理恢复任务；禁止历史
      改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 前向恢复：绑定 TASK-0133 Base、READY、candidate、
      REJECTED terminal 与固定产物，只为该已知错误授权历史增加 fail-closed Doctor 隔离和对应负例；
      允许修改 Doctor、对应 Harness tests 和必要 lifecycle artifacts，不授权通用 scope alias、历史重写、
      policy/Skill/阈值弱化或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-10"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用 TASK-0133 的 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0134
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。TASK-0133 已按真实失败终态推送；
> 本卡是 Owner 明确批准的永久 replacement，不修改或删除其 Card、Context、Evidence、Review、Handoff。

## 背景与用户可观察目标

TASK-0133 的代码候选已由独立 R1 判定 P0/P1/P2/P3=0，但 READY 冻结的 protected-path 批准把
`scope` 写成细分名称，而 `.harness/protected-paths.yaml` 和 Doctor 要求精确 `harness-change`。
唯一正式 Precheck 因此正确失败，字段又不能在 READY 后修改。Owner 选择保留失败历史，并授权新卡用
精确对象身份隔离该单一错误，同时重新验证和正式承接 P2-20。

用户可观察结果：普通 Harness 仍拒绝任何错误、缺失或模糊的 protected approval；只有固定
TASK-0133 REJECTED 历史、固定 candidate/terminal 和固定制品的这一条已知事实被识别。P2-20 的
main/master/无 global config 回归继续通过，后续 Doctor 重新恢复绿线。

## 范围内

- 在 Doctor 中新增只接受 TASK-0133 固定 ID、Card path、Base、READY、candidate/tree、terminal/tree、
  错误 scope、目标 protected path、formal failure 与终态 artifact hashes 的隔离 predicate。
- 仅在 `scripts/harness/tests/test_harness.py` 这一条 protected approval 检查中消费该 predicate；普通
  `scope == harness-change` 规则保持首选且不变。
- 增加正例和 fail-closed 负例：任务字段、提交/Tree、path、scope、目标文件或任一终态 artifact 漂移
  都不得获得隔离。
- 强化 retained merge fixture 对真实双亲 merge 的断言，并重新运行完整 Harness、Reviewer 和正式门禁。

## 明确范围外

- 不修改 TASK-0133 或任何其他历史 Card、Context、Evidence、Review、Handoff、Ledger entry 或 Git 历史。
- 不把细分 scope、前缀、后缀、通配、别名或任意非精确值普遍等同于 `harness-change`。
- 不修改 protected paths、lifecycle、delivery/CI policy、commands、schemas、Skill、AGENTS、workflow 或阈值。
- 不修 P2-21、P2-23 至 P2-27、OpenAPI、业务、数据库、frontend 或 Provider DNS。

## 输入和前置条件

- Base `3c30dd693af0574eb160bbbd37b2e8e2b79a9d80` 是 TASK-0133 单父 REJECTED terminal，已 push、fetch、
  `HEAD...origin/main=0/0` 且工作树 clean；唯一 pre-closure 真实 exit 1、730736 checks、精确一条 approval
  scope 错误。
- TASK-0133 candidate `fca2f55f524952d34223b562a8db88f0e95a9342` / tree
  `1f025c7f2d088997800d990f808219a00a927918` 只修改目标测试文件，R1 无 finding；本卡不复用其门禁 PASS。
- Owner 授权 provenance Hash 为 `b01b658d1bd02a8371451c171b486665397a8106ba357e08560ee9acaddd744b`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。隔离 predicate 是 Doctor 内部历史审计函数，不提供 CLI flag、环境变量、
Git note/replace/graft 或可配置 allowlist，不影响其他任务的授权模型。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 必须在没有任何
pre-READY 代码维护或 override 的情况下真实 PASS；实现只在 IN_PROGRESS 后发生。

隔离的任一身份、hash、path、scope、reviewer 或 artifact 不匹配时返回 false，Doctor 保留原
`requires recorded human approval for harness-change` 错误。R1 最多两轮、一批前向修复；R2 新增结构性
P0/P1 或任一正式门禁非 PASS 时停止并 REJECTED。

## 验收标准

- TASK-0133 固定历史正例被识别；错误 task/path/state/Base/READY/candidate/terminal/Tree/scope 或 artifact
  mutation 全部失败关闭，且另一任务的细分 scope 仍被拒绝。
- 隔离不改变普通 protected-path 精确 `scope == requiredSkill` 的代码路径，不增加通用兼容层。
- merge fixture 在无 global config、显式 main、显式 master 三例均构造可证明的真实双亲 merge，并断言
  checkpoint derivation 拒绝。
- 完整 Harness、唯一正式 Precheck、唯一 `git diff --check`、独立 C4 R1、终态 pre-closure、push、fetch、
  clean 和远端 `0/0` 全部真实完成；remote unavailable 仍非 PASS。
- post-terminal Doctor 在最新终态通过，TASK-0133 原始失败产物保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行新增隔离测试与 P2-20 目标测试；冻结候选后
依次执行独立 Reviewer、唯一 Precheck、完整 Harness、唯一无参数 diff check、Evidence/Handoff 和
唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复。
