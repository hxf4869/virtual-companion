# TASK-0235：Doctor 收紧 C——ACCEPTED 验证证据强制、14 卡缺口 canonical 识别与 sources-of-truth 权威边界

```yaml
taskId: TASK-0235
state: ACCEPTED
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
baseCommit: 64889c9f475f417092ae8185b68fb3d8ff7eb6d9
authorizationCommit: b8fee38be829506a9bcac8ddfb6865b63c945f36
contextFingerprint: b6baa4b00dd08934ff9e30c2373a48a8cbea60a46c1336907e74d9ad2b5695c8
contextLock: docs/tasks/context/TASK-0235.context-lock.yaml
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
  surfaceId: TASK_0235_ACCEPTANCE_EVIDENCE_GOVERNANCE
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
  surface: SLICE-GOVERNANCE-C
  activationPoint: TERMINAL_COMMIT
  activationSemantics: >-
    新增校验只对 baseCommit 位于本卡激活锚（本卡 bind 提交，实现阶段硬编码，
    与 TASK-0233/0234 同一先例）之后的新终态卡强制；历史终态卡不重判；
    14 卡缺口识别为恒启用正向断言。
  exactPaths:
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
  newValidations:
    - id: ACCEPTED_VERIFICATION_EVIDENCE_REQUIRED
      rule: >-
        激活后新 ACCEPTED 卡的 Evidence checks 必须同时包含三个真实 PASS 条目：
        (1) command 含 doctor.py 且不含 --pre-closure 的 READY Doctor 条目
        （status=PASS、exitCode=0）；(2) command 含 precheck.py 的 canonical
        precheck 条目（status=PASS、exitCode=0）；(3) command 含 --pre-closure
        的条目（status=PASS、exitCode=0）。缺失或非 PASS → error。
        REJECTED 卡不适用；历史 ACCEPTED 卡不重判。
    - id: TASK_0213_0227_GAP_RECOGNITION
      rule: >-
        恒启用定向正向断言：(1) TASK-0232 quarantine-registry.json 的
        LEGACY_VALIDATION_GAP_BATCH 组 cards 恰好覆盖 14 个冻结 ID
        （TASK-0213/0214/0215/0216/0217/0218/0219/0221/0222/0223/0224/0225/
        0226/0227）且每卡 checks.preClosure 登记为 NOT_RUN；(2) 对每张卡，
        其当前 Evidence 的 pre-closure 条目 status 必须仍为 NOT_RUN
        （缺口事实未被追溯改写）；(3) 任一断言不成立 → error。
    - id: SOURCES_OF_TRUTH_BOUNDARY
      rule: >-
        激活后新终态卡（含 DRAFT/READY 检查）的 sourcesOfTruth 列表：
        每个路径必须存在于仓库且为文件；不得包含 docs/source/**、
        docs/decisions/**、docs/planning/**（说明文档/计划不是机器真源）；
        必须包含 .harness/project-state.yaml、.harness/task-ledger.yaml、
        .harness/task-lifecycle.yaml 三个核心真源（本卡冻结的权威边界）；
        违反 → error。历史卡不重判。
  negativeMatrix:
    - accepted: 激活后 ACCEPTED 卡缺 pre-closure PASS 条目 → FAIL
    - accepted: pre-closure 条目 status=NOT_RUN → FAIL
    - gap: registry 缺 14 个 ID 之一 → FAIL
    - gap: 某卡 Evidence pre-closure 被登记为 PASS → FAIL
    - sot: sourcesOfTruth 含 docs/source/** → FAIL
    - sot: sourcesOfTruth 缺核心真源 → FAIL
  historicalCompatibility:
    - TASK-0213..0219/0221..0227（14 张卡）不因新校验重判，仅受恒启用
      正向断言（缺口事实保持 + registry 覆盖完整）约束。
    - TASK-0231/0232/0233/0234 与全部既有历史卡不重判。
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
  - docs/evidence/TASK-0232/quarantine-registry.json
  - docs/evidence/TASK-0234/evidence-pack.json
  - docs/handoffs/TASK-0234.json
writeAllowlist:
  - docs/tasks/TASK-0235-acceptance-evidence-governance.md
  - docs/tasks/context/TASK-0235.context-lock.yaml
  - docs/evidence/TASK-0235/**
  - docs/handoffs/TASK-0235.json
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
  - docs/evidence/TASK-0232/**
  - docs/handoffs/TASK-0232.json
  - docs/evidence/TASK-0233/**
  - docs/handoffs/TASK-0233.json
  - docs/tasks/TASK-0233-doctor-temporal-binding-governance.md
  - docs/evidence/TASK-0234/**
  - docs/handoffs/TASK-0234.json
  - docs/tasks/TASK-0234-exact-tree-channel-governance.md
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
  - docs/evidence/TASK-0232/quarantine-registry.json
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
      明确列出 SLICE-GOVERNANCE、sources-of-truth 权威边界与 14 张历史卡的
      精确后验补偿验证为必须完成的工作项；第 14 条要求 Doctor 可以检出本轮
      所有新增负例。本卡只修改 scripts/harness/doctor.py 与
      scripts/harness/tests/test_harness.py 两条冻结路径，新校验对新终态卡
      激活、历史卡不重判（14 卡仅受恒启用正向断言约束），不改变失败/安全/
      契约语义。不编造 sourceThreadId。
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 补充授权第 6 条与第 9 条：实现细节、测试和负例、
      卡片拆分与授权范围内精确 writeAllowlist 由本 Agent 自行决定。本卡为
      SLICE-GOVERNANCE 第三片，严格单面 GOVERNANCE。
independentReview: required
reviewers:
  - id: task0235_r1
    kind: independent-review-gate
    maximumMinutes: 15
    scope: [COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK]
    blocking: [P0, P1, ACCEPTANCE_VIOLATION, INVARIANT_VIOLATION]
    nonBlocking: [P2, P3]
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0235
  - PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0235AcceptanceEvidenceGovernanceTests
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0234（ACCEPTED），intake 分配本号。
> 本卡是 SLICE-GOVERNANCE 的第三片（Doctor 收紧 C）。SLICE-GOVERNANCE-A/B 已由
> TASK-0233/0234 ACCEPTED 完成。

## 背景与用户可观察目标

上一轮审计确认：14 张历史卡（TASK-0213..0219/0221..0227）在 READY Doctor /
canonical precheck / pre-closure NOT_RUN 下被 ACCEPTED，且普通卡 sourcesOfTruth
缺乏权威边界校验。TASK-0233/0234 已分别收紧时间真实性、Commit/Tree 绑定与
exact-tree 通道；本卡补齐最后两块：(1) 激活后 ACCEPTED 卡必须有完整三件套
验证证据（READY Doctor + canonical precheck + pre-closure 真实 PASS）；
(2) 14 张卡的验证缺口必须永久被 TASK-0232 registry 覆盖且不被追溯改写；
(3) sourcesOfTruth 权威边界（真源必须存在、不得引用说明文档/计划、必须含
三个核心真源）。

用户可观察目标：Doctor 新增三组校验；test_harness 新增完整负例矩阵；
历史卡不重判。

## 范围内

- 仅改 `scripts/harness/doctor.py` 与 `scripts/harness/tests/test_harness.py`。
- 实现三组校验并接入 doctor 主流程；激活语义按卡内 `governanceContract`
  冻结规则。
- test_harness 新增 `Task0235AcceptanceEvidenceGovernanceTests`，覆盖卡内
  negativeMatrix 全部 6 项负例 + 正例。

## 明确范围外

- 不改 `.harness/ci-execution-policy.yaml`、task-delivery-policy、lifecycle、
  skills、AGENTS.md 或任何其它 Harness 文件。
- 不重判 14 张历史卡与其它历史终态卡（14 卡仅受恒启用正向断言约束）。
- 不改写任何历史卡、Evidence、Handoff、Ledger 条目或提交。
- 不 push main、不 force push、不 merge/rebase/reset/cherry-pick、不建 tag/PR。

## 输入和前置条件

- Base：`64889c9f475f417092ae8185b68fb3d8ff7eb6d9`（TASK-0234 ACCEPTED 终态；
  已推送至恢复分支，远端 SHA/Tree 复核一致，正式 Doctor 释放绑定 PASS）。
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
- 修改 writeAllowlist 外路径 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. 三组校验函数存在并接入 doctor 主流程，激活语义与卡内 governanceContract 一致。
2. `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
   test_harness.Task0235AcceptanceEvidenceGovernanceTests` 全部 PASS，负例矩阵
   覆盖卡内 6 项。
3. 全量 doctor --summary 与 READY/canonical/pre-closure 真实执行；历史卡
   （14 张 + 全部既有卡）不因新校验出现新 error。
4. C4 独立 Reviewer 审查实际实现范围并 APPROVE（P0/P1=0）。
5. 终态后推送恢复分支并远端精确 SHA/Tree 复核；正式提交态 Doctor 通过
   PRIMARY_REMOTE_RELEASE_BOUND 校验；本卡自身满足
   ACCEPTED_VERIFICATION_EVIDENCE_REQUIRED（三件套真实 PASS）。
6. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`。READY 后真实跑 `doctor.py --task TASK-0235`；
候选冻结后真实跑官方 `precheck.py --task TASK-0235` 与
`doctor.py --task TASK-0235 --pre-closure`。终态后普通推送至
`refs/heads/codex/governance-recovery-20260816`、fetch 并远端精确 SHA/Tree 复核，
再跑一次正式 `doctor.py --task TASK-0235` 验证释放绑定。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。

## 停止条件

- 需要修改 writeAllowlist 外路径、需要重判历史卡或把 NOT_RUN/失败转为 PASS
  立即停止。
