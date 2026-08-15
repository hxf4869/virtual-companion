# TASK-0234：Doctor 收紧 B——ordinary-card exact-tree 通道强制校验（fallback 激活条件与远端释放绑定）

```yaml
taskId: TASK-0234
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
baseCommit: 494146bd614c6516dcbcfaa5ca7e658a90272a12
authorizationCommit: 54316e85f9d515f2c844fd7f1d1f9b811fa690f7
contextFingerprint: 47760b38c2786d75adb664aa8b762c9a5b24055688006025c9a64b5f082adc9e
contextLock: docs/tasks/context/TASK-0234.context-lock.yaml
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
  surfaceId: TASK_0234_EXACT_TREE_CHANNEL_GOVERNANCE
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 80
  thresholdsTriggered: [terminalCheckMinutesGreaterThan20]
  splitRecommended: false
  splitRequired: false
  splitDecision: KEEP
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: PRIMARY_REMOTE_EXACT_SHA, profile: precheck}
governanceContract:
  surface: SLICE-GOVERNANCE-B
  activationPoint: TERMINAL_COMMIT
  activationSemantics: >-
    新增校验只对 baseCommit 位于本卡激活锚（本卡 bind 提交，实现阶段硬编码，
    与 TASK-0233 同一先例：严格单活动卡串行下等价于终态激活）之后的新终态卡
    强制；历史终态卡不重判。
  exactPaths:
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
  newValidations:
    - id: LOCAL_FALLBACK_ACTIVATION_REQUIRED
      rule: >-
        激活后新终态卡若 validationPlan.selectedChannel=LOCAL_EXACT_TREE_FALLBACK，
        其 Evidence 必须包含 validationChannels 记录，且满足：
        policySource=ci-execution-policy、channel=LOCAL_EXACT_TREE_FALLBACK、
        remote 强类型不可用证据（reasonType=OWNER_SUPPLIED_QUOTA_EXHAUSTED 且
        includedMinutes/usedMinutes/paidBudgetUsd/stopUsageEnabled/resetDate/
        dispatchCount 完整）、results 平台结果记录覆盖
        resultRecordRequiredFields 全部字段（taskId/candidateCommit/
        candidateTree/cleanWorktree/cleanIndex/argv/cwd/operatingSystem/
        interpreter/toolchain/dependencies/environment/stdoutSha256/
        stderrSha256/receiptSha256/exitCode/startedAt/completedAt）、
        notCovered 字段显式存在；缺失任一 → error。
        历史卡与既有 validationChannels 特判卡（TASK-0064/0066/0067/
        0074/0075/0076/0077）不重判。
    - id: PRIMARY_REMOTE_RELEASE_BOUND
      rule: >-
        激活后新终态卡若 validationPlan.selectedChannel=PRIMARY_REMOTE_EXACT_SHA：
        正式 Doctor（提交态，非 pre-closure 暂存态）要求本地 remote-tracking
        引用 refs/remotes/origin/codex/governance-recovery-20260816 存在，
        Evidence.headCommit 必须是其 tip 的祖先（即候选已真实推送到专用恢复
        分支），且 tip 在本地可达；pre-closure 暂存态（allow_uncommitted_
        terminal）豁免远端检查。不满足 → error（释放前必须先推送并远端复核）。
  negativeMatrix:
    - fallback: 激活后卡声明 fallback 但缺 validationChannels → FAIL
    - fallback: validationChannels 缺 resultRecordRequiredFields 字段 → FAIL
    - fallback: remote 不可用证据缺 reasonType/字段 → FAIL
    - fallback: notCovered 字段缺失 → FAIL
    - primary: 提交态 headCommit 未推送到恢复分支 → FAIL
    - primary: remote-tracking 引用缺失 → FAIL
    - primary: pre-closure 暂存态豁免远端检查（正例，不 FAIL）
  historicalCompatibility:
    - TASK-0213..0219/0221..0227、TASK-0231/0232/0233 与全部既有历史卡不因
      新校验重判；特判卡 validationChannels 保持原样。
readAllowlist:
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
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0233-doctor-temporal-binding-governance.md
  - docs/evidence/TASK-0233/evidence-pack.json
  - docs/handoffs/TASK-0233.json
writeAllowlist:
  - docs/tasks/TASK-0234-exact-tree-channel-governance.md
  - docs/tasks/context/TASK-0234.context-lock.yaml
  - docs/evidence/TASK-0234/**
  - docs/handoffs/TASK-0234.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - frontend/**
  - infra/**
  - scripts/dev/**
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
  - AGENTS.md
  - CLAUDE.md
  - .gitattributes
  - requirements-harness.txt
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0233-doctor-temporal-binding-governance.md
  - docs/tasks/context/TASK-0233.context-lock.yaml
  - docs/evidence/TASK-0233/**
  - docs/handoffs/TASK-0233.json
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
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/invariants.yaml
  - .harness/sources-of-truth.yaml
  - scripts/harness/doctor.py
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 补充明确授权第 6 条：按上一条授权完成治理恢复，
      明确列出 SLICE-GOVERNANCE 与 ordinary-card exact-tree fallback 验证为
      必须完成的工作项；第 2 条批准每张合法终态卡后推送到专用恢复分支并执行
      远端精确 SHA/Tree 复核。本卡只修改 scripts/harness/doctor.py 与
      scripts/harness/tests/test_harness.py 两条冻结路径，新校验对新终态卡
      激活、历史卡不重判，不改变失败/安全/契约语义。不编造 sourceThreadId。
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 补充授权第 6 条与第 9 条：实现细节、测试和负例、
      卡片拆分与授权范围内精确 writeAllowlist 由本 Agent 自行决定。本卡为
      SLICE-GOVERNANCE 第二片，严格单面 GOVERNANCE。
independentReview: required
reviewers:
  - id: task0234_r1
    kind: independent-review-gate
    maximumMinutes: 15
    scope: [COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK]
    blocking: [P0, P1, ACCEPTANCE_VIOLATION, INVARIANT_VIOLATION]
    nonBlocking: [P2, P3]
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0234
  - PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0234ExactTreeChannelGovernanceTests
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0233（ACCEPTED），intake 分配本号。
> 本卡是 SLICE-GOVERNANCE 的第二片（Doctor 收紧 B）。SLICE-GOVERNANCE-A 已由
> TASK-0233 ACCEPTED 完成。

## 背景与用户可观察目标

上一轮审计确认：普通卡在卡内声明 LOCAL_EXACT_TREE_FALLBACK，但 Evidence 缺少
STRONG_TYPED_REMOTE_UNAVAILABLE_EVIDENCE、OWNER_AUTHORIZED_SCOPE、
resultRecordRequiredFields 与 notCovered 平台记录；且 PRIMARY_REMOTE_EXACT_SHA
卡的远端释放（推送 + 远端 SHA/Tree 复核）没有任何机器校验绑定。Owner 2026-08-16
补充授权批准使用专用恢复分支 codex/governance-recovery-20260816 完成远端释放。

用户可观察目标：Doctor 新增两组校验——LOCAL_FALLBACK_ACTIVATION_REQUIRED 对
激活后 fallback 卡强制完整激活条件与结果记录；PRIMARY_REMOTE_RELEASE_BOUND 对
激活后远端通道卡强制「候选已推送到专用恢复分支」的机器绑定（pre-closure 暂存态
豁免、正式提交态强制）。历史卡不重判。

## 范围内

- 仅改 `scripts/harness/doctor.py` 与 `scripts/harness/tests/test_harness.py`。
- 实现两组校验并接入 doctor 主流程；激活语义按卡内 `governanceContract`
  冻结规则（新终态激活 + 特判卡豁免 + 暂存态远端豁免）。
- test_harness 新增 `Task0234ExactTreeChannelGovernanceTests`，覆盖卡内
  negativeMatrix 全部负例 + 正例。

## 明确范围外

- 不改 `.harness/ci-execution-policy.yaml`、task-delivery-policy、lifecycle、
  skills、AGENTS.md 或任何其它 Harness 文件。
- 不重判任何历史终态卡与特判卡（TASK-0064/0066/0067/0074/0075/0076/0077）。
- 不改写任何历史卡、Evidence、Handoff、Ledger 条目或提交。
- 不 push main、不 force push、不 merge/rebase/reset/cherry-pick、不建 tag/PR。

## 输入和前置条件

- Base：`494146bd614c6516dcbcfaa5ca7e658a90272a12`（TASK-0233 ACCEPTED 终态；
  已推送至恢复分支，远端 SHA/Tree 复核一致）。
- 仓库 idle：`activeTask=null`，工作树与 Index 干净。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径含 `scripts/harness/**` 保护路径，已获本卡 harness-change 人工批准声明。

## 状态机和失败行为

- 本卡单面 GOVERNANCE，`splitDecision: KEEP`。
- 任一负例未按预期 FAIL → 定向测试 FAIL。
- 新校验使历史卡/特判卡被重判 → FAIL。
- 修改 writeAllowlist 外路径 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. 两组校验函数存在并接入 doctor 主流程，激活语义与卡内 governanceContract 一致。
2. `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
   test_harness.Task0234ExactTreeChannelGovernanceTests` 全部 PASS，负例矩阵
   覆盖卡内 7 项。
3. 全量 doctor --summary 与 READY/canonical/pre-closure 真实执行；历史卡与
   特判卡不因新校验出现新 error。
4. C4 独立 Reviewer 审查实际实现范围并 APPROVE（P0/P1=0）。
5. 终态后推送恢复分支并远端精确 SHA/Tree 复核；正式提交态 Doctor 通过
   PRIMARY_REMOTE_RELEASE_BOUND 校验。
6. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`。READY 后真实跑 `doctor.py --task TASK-0234`；
候选冻结后真实跑官方 `precheck.py --task TASK-0234` 与
`doctor.py --task TASK-0234 --pre-closure`。终态后普通推送至
`refs/heads/codex/governance-recovery-20260816`、fetch 并远端精确 SHA/Tree 复核，
再跑一次正式 `doctor.py --task TASK-0234` 验证释放绑定。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。

## 停止条件

- 需要修改 writeAllowlist 外路径、需要重判历史卡或把 NOT_RUN/失败转为 PASS
  立即停止。
