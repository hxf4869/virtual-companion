# TASK-0233：Doctor 收紧 A——evidence 时间真实性、taskId/Commit/Tree 逐项绑定与 TASK-0231/0232 无效性 canonical 识别

```yaml
taskId: TASK-0233
state: READY
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
baseCommit: e5d88e3ff5529f28cb76bec2d663523f9b1fa9a8
authorizationCommit: 4311049689a44b2efb0f39ad634664713e2f4819
contextFingerprint: aeb382c39500e06167dc20a28e318fd9bf44d5c9f58ff9c39de483780fd696c6
contextLock: docs/tasks/context/TASK-0233.context-lock.yaml
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
  surfaceId: TASK_0233_DOCTOR_TEMPORAL_AND_BINDING_GOVERNANCE
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
  surface: SLICE-GOVERNANCE-A
  activationPoint: TERMINAL_COMMIT
  activationSemantics: >-
    新增校验只对 baseCommit 位于本卡终态提交之后（含）的新终态卡强制；
    历史终态卡不重判（维持 TASK-0196 撤回 blanket 重判的契约）。
  exactPaths:
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
  newValidations:
    - id: TEMPORAL_INTEGRITY
      rule: >-
        对激活后新终态卡：deliveryTiming.overallElapsed/intakeActivation/
        candidateExecution 的 startedAt 必须不早于其 anchorCommit 的 committer
        time（RFC3339 字符串比较）；各段 endedAt 与 readyDoctorPassAt 必须不晚于
        对应事件提交（IN_PROGRESS/终态提交）的 committer time 加 600 秒容差；
        违反即 error。
    - id: COMMIT_TREE_BINDING
      rule: >-
        对激活后新终态卡：evidence checks 中每个携带 candidateCommit/
        candidateTree 的条目，candidateCommit 必须是 baseCommit 的后代且是
        终态提交的祖先（merge-base --is-ancestor 双向校验），candidateTree
        必须等于 candidateCommit^{tree}；verifiedCommit 为完整 SHA 时必须为
        base..terminal 链上的提交；违反即 error。
    - id: TASK_0231_0232_INVALIDITY_RECOGNITION
      rule: >-
        恒启用定向校验（正向断言，不重判历史）：
        (1) TASK-0231 必须 REJECTED，其卡 resolutionReason 非空且包含
        「投影漂移」，其 Evidence 存在 precheck FAIL exitCode 1 条目；
        (2) TASK-0232 必须 ACCEPTED，其 quarantine-registry.json 绑定的
        predecessorQuarantineBlob/predecessorQuarantineSha256 必须与
        TASK-0231 终态提交处 governance-gap-quarantine.json 的真实 blob/
        contentSha256 一致，且 TASK-0232 handoff knownRisks 必须声明
        LOCAL_EXACT_TREE_FALLBACK 证据缺口。
        任一断言不成立即 error——即「0231/0232 的无效性已被机器记录」本身
        成为 Doctor 的 canonical 校验。
  negativeMatrix:
    - temporal: 伪造未来 startedAt/endedAt → FAIL
    - temporal: startedAt 早于 anchorCommit 时间 → FAIL
    - binding: candidateTree 不等于 candidateCommit^{tree} → FAIL
    - binding: candidateCommit 不是 base..terminal 祖先 → FAIL
    - binding: verifiedCommit 指向链外提交 → FAIL
    - recognition: 0231 resolutionReason 缺失 → FAIL
    - recognition: 0232 registry blob 漂移 → FAIL
    - recognition: 0232 handoff 缺口声明缺失 → FAIL
  historicalCompatibility:
    - TASK-0213..0219/0221..0227（14 张卡）与 TASK-0231/0232 不因新校验重判；
      0231/0232 仅受定向正向断言约束。
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
  - docs/tasks/TASK-0231-governance-gap-quarantine.md
  - docs/evidence/TASK-0231/evidence-pack.json
  - docs/handoffs/TASK-0231.json
  - docs/tasks/TASK-0232-quarantine-registry.md
  - docs/evidence/TASK-0232/evidence-pack.json
  - docs/evidence/TASK-0232/quarantine-registry.json
  - docs/handoffs/TASK-0232.json
writeAllowlist:
  - docs/tasks/TASK-0233-doctor-temporal-binding-governance.md
  - docs/tasks/context/TASK-0233.context-lock.yaml
  - docs/evidence/TASK-0233/**
  - docs/handoffs/TASK-0233.json
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
  - docs/tasks/TASK-0231-governance-gap-quarantine.md
  - docs/tasks/context/TASK-0231.context-lock.yaml
  - docs/evidence/TASK-0231/**
  - docs/handoffs/TASK-0231.json
  - docs/tasks/TASK-0232-quarantine-registry.md
  - docs/tasks/context/TASK-0232.context-lock.yaml
  - docs/evidence/TASK-0232/**
  - docs/handoffs/TASK-0232.json
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
  - docs/evidence/TASK-0231/evidence-pack.json
  - docs/evidence/TASK-0232/quarantine-registry.json
  - docs/handoffs/TASK-0232.json
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
      明确列出 SLICE-GOVERNANCE 为必须完成的工作项；第 14 条要求
      「TASK-0231/0232 未被追溯改写，但其无效性被 canonical 机制正式识别」、
      「Doctor 可以检出本轮所有新增负例」。本卡只修改
      scripts/harness/doctor.py 与 scripts/harness/tests/test_harness.py
      两条冻结路径，新增校验对新终态卡激活、历史卡不重判，不改写
      TASK-0231/0232 任何历史制品，不改变失败/安全/契约语义。
      不编造 sourceThreadId。
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 补充授权第 6 条与第 9 条：实现细节、测试和负例、
      卡片拆分、P2/P3 修复、最小可逆方案与授权范围内精确 writeAllowlist 均
      由本 Agent 自行决定，不向 Owner 请求。本卡为 SLICE-GOVERNANCE 第一片，
      严格单面 GOVERNANCE。
independentReview: required
reviewers:
  - id: task0233_r1
    kind: independent-review-gate
    maximumMinutes: 15
    scope: [COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK]
    blocking: [P0, P1, ACCEPTANCE_VIOLATION, INVARIANT_VIOLATION]
    nonBlocking: [P2, P3]
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0233
  - PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0233GovernanceTemporalBindingTests
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0232（ACCEPTED），仓库内无既有 TASK-0233 引用，intake 分配本号。
> 本卡是 SLICE-GOVERNANCE 的第一片（Doctor 收紧 A）。SLICE-AUTHORIZATION 已由
> TASK-0198 ACCEPTED 完成。

## 背景与用户可观察目标

上一轮审计确认三类 Doctor 验证覆盖缺口：(1) 普通终态卡的 Evidence 时间戳没有
真实性校验（与对应提交时间的一致性）；(2) Evidence checks 的 verifiedCommit/
candidateCommit/candidateTree 没有逐项绑定校验（伪造 tree/链外提交不会被检出）；
(3) TASK-0231（REJECTED，投影漂移）与 TASK-0232（继承登记）的无效性仅由
resolutionReason/registry 声明，没有被 Doctor 作为 canonical 校验识别。

用户可观察目标：Doctor 新增三组校验——TEMPORAL_INTEGRITY、COMMIT_TREE_BINDING
对新终态卡强制（历史卡不重判），TASK_0231_0232_INVALIDITY_RECOGNITION 恒启用；
test_harness 新增完整负例矩阵；Doctor 能够检出本轮全部新增负例。

## 范围内

- 仅改 `scripts/harness/doctor.py` 与 `scripts/harness/tests/test_harness.py`。
- 实现三组校验函数并接入 doctor 主流程；激活语义按卡内 `governanceContract`
  冻结规则（新终态激活 + 定向恒校验）。
- test_harness 新增 `Task0233GovernanceTemporalBindingTests`，覆盖卡内
  negativeMatrix 全部 8 项负例 + 对应正例。

## 明确范围外

- 不改 `.harness/ci-execution-policy.yaml`、task-delivery-policy、lifecycle、
  skills、AGENTS.md 或任何其它 Harness 文件。
- 不重判 TASK-0213..0219/0221..0227 与 TASK-0231/0232 的历史终态
  （0231/0232 仅受定向正向断言约束）。
- 不改写任何历史卡、Evidence、Handoff、Ledger 条目或提交。
- 不 push main、不 force push、不 merge/rebase/reset/cherry-pick、不建 tag/PR。
- 本卡不实现 ordinary-card exact-tree fallback 强制校验（后继 SLICE-GOVERNANCE-B）。

## 输入和前置条件

- Base：`e5d88e3ff5529f28cb76bec2d663523f9b1fa9a8`（TASK-0232 ACCEPTED 终态；
  本地分支 codex/governance-recovery-20260816 已创建并推送，远端 SHA/Tree
  复核一致）。
- 仓库 idle：`activeTask=null`，工作树与 Index 干净。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径含 `scripts/harness/**` 保护路径，已获本卡 harness-change 人工批准声明。

## 状态机和失败行为

- 本卡单面 GOVERNANCE，`splitDecision: KEEP`。
- 任一负例未按预期 FAIL → 定向测试 FAIL。
- 新校验使历史卡被重判 → FAIL。
- 0231/0232 定向断言漂移 → FAIL。
- 修改 writeAllowlist 外路径 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. 三个校验函数存在并接入 doctor 主流程，激活语义与卡内 governanceContract 一致。
2. `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
   test_harness.Task0233GovernanceTemporalBindingTests` 全部 PASS，且负例矩阵
   覆盖卡内 8 项负例。
3. 全量 doctor --summary 与 READY/canonical/pre-closure 真实执行；历史卡
   （14 张 + 0231/0232）不因新校验出现新 error。
4. C4 独立 Reviewer 审查实际实现范围并 APPROVE（P0/P1=0）。
5. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`（canonical precheck、定向 unittest、
`git diff --check`）。READY 后真实跑 `doctor.py --task TASK-0233`；候选冻结后
真实跑官方 `precheck.py --task TASK-0233` 与
`doctor.py --task TASK-0233 --pre-closure`。终态后普通推送至
`refs/heads/codex/governance-recovery-20260816` 并执行远端精确 SHA/Tree 复核。
未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。

## 停止条件

- 需要修改 writeAllowlist 外路径、需要重判历史卡或把 NOT_RUN/失败转为 PASS
  立即停止。
