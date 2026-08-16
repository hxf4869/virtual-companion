# TASK-0236：TASK-0235 Evidence 候选 SHA 猜测缺陷的登记与 Doctor 定向识别（不掩盖、不合法化）

```yaml
taskId: TASK-0236
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
baseCommit: ef7eddd76587688b1addf6506c2fa09586d6e153
authorizationCommit: e7aacffe7acf9aa3fc23bb90f214ed0f8dd12c71
contextFingerprint: 6d374dbb30e88aadaf73c9e83acf151ab67a7fe9daf9aa3bc1547870ef453873
contextLock: docs/tasks/context/TASK-0236.context-lock.yaml
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
  surfaceId: TASK_0236_TASK0235_EVIDENCE_GAP_RECOGNITION
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
  surface: SLICE-GOVERNANCE-D
  exactPaths:
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
  defectFacts:
    task0235TerminalCommit: ef7eddd76587688b1addf6506c2fa09586d6e153
    task0235EvidenceGuessedSha: 0758f322db42de2553763cbd657b78b7472c7624
    task0235RealCandidateCommit: 0758f32c1b649281f0b4543617a441801ef1c844
    task0235RealCandidateTree: 9dec374fcefb8e7380bda7915936eb8faca8a1e1
    badYamlCommit: c06dbf61e4d21e5968077f8f7b3e1006a1a05a4e
    badYamlPath: docs/tasks/TASK-0236-task0235-evidence-gap-recognition.md
    badYamlStatement: >-
      本卡首个 idle DRAFT 提交 c06dbf6 中的任务卡 YAML 存在 negativeMatrix 折行
      语法错误（while scanning a simple key），已在 29caf89 修正。c06dbf6 是
      不可变历史提交，Doctor 的 authorized-task-history 对该 (commit, path)
      组合定向豁免解析（豁免以本卡登记存在为前置）。
    statement: >-
      TASK-0235 Evidence 的 verifiedCommit/candidateCommit 使用了猜测的完整 SHA
      （0758f322db42...，实际不存在于仓库）；真实候选提交为
      0758f32c1b649281f0b4543617a441801ef1c844。TASK-0233 的
      COMMIT_TREE_BINDING 校验在正式提交态 Doctor 中正确识别该缺陷
      （3 errors：candidateCommit 不在 base..terminal 链、candidateTree 不属于
      candidateCommit、verifiedCommit 不在链上）。终态制品不可改写，本卡按
      TASK-0231→0232 同型处理：登记缺陷事实、Doctor 定向识别（正向断言缺陷
      保持且登记存在），并在登记存在的条件下对 TASK-0235 定向豁免绑定校验的
      三条报错——这不是掩盖：缺陷与豁免条件都被 Doctor 恒启用断言，登记缺失
      即 FAIL。
  newValidations:
    - id: TASK0235_EVIDENCE_GAP_RECOGNITION
      rule: >-
        恒启用正向断言：(1) TASK-0235 Evidence 中 verifiedCommit/candidateCommit
        为 0758f322db42de2553763cbd657b78b7472c7624 的条目数量 ≥ 1（缺陷事实
        未被改写）；(2) 本卡登记 JSON docs/evidence/TASK-0236/
        task0235-evidence-gap-registry.json 存在且其 task0235RealCandidateCommit/
        task0235RealCandidateTree/guessedSha 与卡内 defectFacts 一致；
        (3) 任一断言不成立 → error。
    - id: AUTHORIZED_HISTORY_BAD_YAML_EXEMPTION
      rule: >-
        validate_authorized_task_history 对 (commit=c06dbf61e4d21e5968077f8f7b
        3e1006a1a05a4e, path=docs/tasks/TASK-0236-task0235-evidence-gap-recognition.md)
        定向豁免解析（该提交的坏 YAML 缺陷已由本卡登记）；豁免前置为
        TASK0235_EVIDENCE_GAP_RECOGNITION 登记存在，登记缺失即 FAIL。
    - id: TASK0235_BINDING_EXEMPTION
      rule: >-
        validate_task0233_commit_tree_binding 对 taskId=TASK-0235 跳过（定向豁免），
        仅当 TASK0235_EVIDENCE_GAP_RECOGNITION 全部断言成立时该豁免才不产生
        error；登记 JSON 缺失或漂移时 recognition 报 error，Doctor 必然 FAIL。
  negativeMatrix:
    - recognition: 0235 evidence 中猜测 SHA 被改写（构造）→ FAIL
    - recognition: 登记 JSON 缺失（注入 None）→ FAIL
    - recognition: 登记 JSON 的 realCandidateCommit 漂移 → FAIL
    - exemption: 登记缺失时绑定校验对 0235 恢复报错（由 recognition FAIL 保证，测试断言 recognition error 存在）
    - badyaml: 坏 YAML 豁免条件（登记缺失）→ FAIL
  historicalCompatibility:
    - TASK-0235 的卡/Evidence/Handoff/Ledger 历史制品零修改；仅新增登记与
      定向识别；其余全部历史卡不重判。
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
  - docs/tasks/TASK-0235-acceptance-evidence-governance.md
  - docs/evidence/TASK-0235/evidence-pack.json
  - docs/handoffs/TASK-0235.json
  - docs/tasks/TASK-0233-doctor-temporal-binding-governance.md
writeAllowlist:
  - docs/tasks/TASK-0236-task0235-evidence-gap-recognition.md
  - docs/tasks/context/TASK-0236.context-lock.yaml
  - docs/evidence/TASK-0236/**
  - docs/handoffs/TASK-0236.json
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
  - docs/tasks/TASK-0235-acceptance-evidence-governance.md
  - docs/tasks/context/TASK-0235.context-lock.yaml
  - docs/evidence/TASK-0235/**
  - docs/handoffs/TASK-0235.json
  - docs/tasks/TASK-0233-doctor-temporal-binding-governance.md
  - docs/evidence/TASK-0233/**
  - docs/handoffs/TASK-0233.json
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
  - docs/evidence/TASK-0235/evidence-pack.json
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
      Owner 2026-08-16 /goal 补充明确授权第 6 条（按上一条授权完成治理恢复，
      明确列出 SLICE-GOVERNANCE 与「TASK-0231/0232 未被追溯改写，但其无效性
      被 canonical 机制正式识别」同型处理原则）与第 10 条（遇到失败时在当前卡
      允许的一次修复批次内修复；不得把 FAIL 改成 PASS）。本卡不修改 TASK-0235
      任何历史制品，只新增缺陷登记与 Doctor 定向识别（正向断言 + 登记缺失即
      FAIL），不改变失败/安全/契约语义。不编造 sourceThreadId。
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 补充授权第 6/9/10 条：实现细节、测试和负例、
      卡片拆分与授权范围内精确 writeAllowlist 由本 Agent 自行决定；不得把
      FAIL/TIMEOUT/UNKNOWN/NOT_RUN 改成 PASS。本卡为 SLICE-GOVERNANCE 第四片。
independentReview: required
reviewers:
  - id: task0236_r1
    kind: independent-review-gate
    maximumMinutes: 15
    scope: [COMPLETE_MATRIX, ACCEPTANCE, INVARIANTS, ADJACENT_RISK]
    blocking: [P0, P1, ACCEPTANCE_VIOLATION, INVARIANT_VIOLATION]
    nonBlocking: [P2, P3]
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0236
  - PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0236EvidenceGapRecognitionTests
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0235（ACCEPTED），intake 分配本号。
> 本卡是 SLICE-GOVERNANCE 的第四片（缺陷登记与定向识别），按 TASK-0231→0232
> 同型处理 TASK-0235 的 Evidence 候选 SHA 猜测缺陷。

## 背景与用户可观察目标

TASK-0233 的 COMMIT_TREE_BINDING 校验在正式提交态 Doctor 中正确识别出
TASK-0235 Evidence 的缺陷：verifiedCommit/candidateCommit 使用了猜测的完整 SHA
（0758f322db42de2553763cbd657b78b7472c7624，仓库中不存在；真实候选提交为
0758f32c1b649281f0b4543617a441801ef1c844）——3 errors。TASK-0235 终态制品
（卡/Evidence/Handoff/Ledger/终态提交）不可改写，因此本卡按 TASK-0231→0232
同型处理：把缺陷事实登记为机器可验证记录，Doctor 恒启用正向断言（缺陷保持 +
登记存在），并在登记存在的条件下对 TASK-0235 定向豁免绑定校验——登记缺失或
漂移即 FAIL，缺陷不会被掩盖。

用户可观察目标：仓库出现一份绑定 TASK-0235 缺陷事实的登记 JSON；Doctor 恒启用
识别该缺陷；定向测试覆盖全部负例；TASK-0235 历史制品零修改。

## 范围内

- 实现 `docs/evidence/TASK-0236/task0235-evidence-gap-registry.json`：登记
  TASK-0235 终态提交、猜测 SHA、真实候选提交与 tree、缺陷描述、不得改写声明。
- 仅改 `scripts/harness/doctor.py` 与 `scripts/harness/tests/test_harness.py`：
  新增 TASK0235_EVIDENCE_GAP_RECOGNITION 恒启用校验；绑定校验对 TASK-0235
  定向豁免（登记存在为前置，由 recognition 保证）。
- test_harness 新增 `Task0236EvidenceGapRecognitionTests`（负例矩阵 4 项 + 正例）。

## 明确范围外

- 不修改 TASK-0235 及更早的任何卡、Context Lock、Evidence、Handoff、Ledger
  条目或提交。
- 不修改 `.harness/ci-execution-policy.yaml`、task-delivery-policy、lifecycle、
  skills、AGENTS.md 或任何其它 Harness 文件。
- 不把 TASK-0235 的缺陷追述为合法；不把 FAIL 改成 PASS。
- 不 push main、不 force push、不 merge/rebase/reset/cherry-pick、不建 tag/PR。

## 输入和前置条件

- Base：`ef7eddd76587688b1addf6506c2fa09586d6e153`（TASK-0235 ACCEPTED 终态；
  已推送至恢复分支，远端 SHA/Tree 复核一致；正式 Doctor 真实 FAIL 3 errors
  为 TASK-0235 证据缺陷，如实保留）。
- 仓库 idle：`activeTask=null`，工作树与 Index 干净。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径含 `scripts/harness/**` 保护路径，已获本卡 harness-change 人工批准声明。

## 状态机和失败行为

- 本卡单面 GOVERNANCE，`splitDecision: KEEP`。
- 登记 JSON 缺失/漂移、0235 缺陷事实被改写 → recognition FAIL（Doctor 必然 FAIL）。
- 任一负例未按预期 FAIL → 定向测试 FAIL。
- 修改 writeAllowlist 外路径或 TASK-0235 历史制品 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. 登记 JSON 存在，字段与卡内 defectFacts 一致。
2. TASK0235_EVIDENCE_GAP_RECOGNITION 恒启用且绑定校验定向豁免只以登记存在
   为前置；Doctor 全量与 READY/canonical/pre-closure 真实执行，TASK-0235
   不再产生绑定校验 error（缺陷由 recognition 正向断言覆盖）。
3. 定向测试真实执行且负例矩阵覆盖卡内 4 项。
4. C4 独立 Reviewer 审查实际实现范围并 APPROVE（P0/P1=0）。
5. 终态后推送恢复分支并远端精确 SHA/Tree 复核；正式提交态 Doctor PASS。
6. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`。READY 后真实跑 `doctor.py --task TASK-0236`；
候选冻结后真实跑官方 `precheck.py --task TASK-0236` 与
`doctor.py --task TASK-0236 --pre-closure`。终态后普通推送至
`refs/heads/codex/governance-recovery-20260816`、fetch 并远端精确 SHA/Tree 复核，
再跑一次正式 `doctor.py --task TASK-0236` 验证释放绑定。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。

## 停止条件

- 需要修改 writeAllowlist 外路径、修改 TASK-0235 历史制品或把 FAIL 转为 PASS
  立即停止。
