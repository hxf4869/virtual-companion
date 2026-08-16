# TASK-0238：14 卡补偿验证批 1——TASK-0213/0214/0215/0216/0217 精确历史绑定逐卡验证

```yaml
taskId: TASK-0238
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: b8512229dd5cb3ba1f8e7019c1dd47d7f0a72bbb
authorizationCommit: ""
contextFingerprint: 8e5cd420ba3846cbec19ff5d7fc6280d5e6d6b99b987fbba101125aca75dd8be
contextLock: docs/tasks/context/TASK-0238.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0238_COMPENSATION_VERIFICATION_BATCH_1
  policySurfaces: [HISTORY]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 6
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 40
  thresholdsTriggered: []
  splitRecommended: false
  splitRequired: false
  splitDecision: KEEP
  ownerIndivisibleAuthorization: false
  harnessImplementationForbidden: true
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: PRIMARY_REMOTE_EXACT_SHA, profile: precheck}
compensationBatch:
  batchId: COMPENSATION-BATCH-1
  recordPath: docs/evidence/TASK-0238/compensation-batch-1.json
  cards:
    - taskId: TASK-0213
      baseCommit: 5da7d936f7c80c603d15f198101d8894c24867e1
      terminalCommit: 14a8f4efba69b77e7f4d629bd73a1e6a68980ae1
      candidateCommit: 827fb8a6fb57441aad8a9ebc841a2514c2e128e9
      candidateTree: 678b0bfa6f583551f9686de6d7d8513902353f2a
    - taskId: TASK-0214
      baseCommit: 14a8f4efba69b77e7f4d629bd73a1e6a68980ae1
      terminalCommit: e69c00b4a12d6291dadf5e890aa2738d8e2c8229
      candidateCommit: 5264542e6c9797688bbb0562c44d7cf0a6b97bd4
      candidateTree: f896a91f221ad056cc996f72a001874937bc4f71
    - taskId: TASK-0215
      baseCommit: e69c00b4a12d6291dadf5e890aa2738d8e2c8229
      terminalCommit: 41b0f8215eb64f3ddea68a748fe5f94a0fcfd8c4
      candidateCommit: 3c4d0352cd591b09f0bdebf7566da65bc3a46fde
      candidateTree: 54c8770c85c79adcc2300a2b25f04c1192d536a4
    - taskId: TASK-0216
      baseCommit: 41b0f8215eb64f3ddea68a748fe5f94a0fcfd8c4
      terminalCommit: 425597ca44d188e1827462fc22313499d0ce5ea2
      candidateCommit: 952c472b5bcd9e9d1c0c21a9e362da6abb60f060
      candidateTree: 90d7634d4d3a59d3243b494f4ee3dc6fd0aa0769
    - taskId: TASK-0217
      baseCommit: 425597ca44d188e1827462fc22313499d0ce5ea2
      terminalCommit: fb5656ee3d9491cc304fe2f70601362cb3cfa176
      candidateCommit: b641685109b9cb4fe0d60734ed7d40e903f42515
      candidateTree: 559445204e01d3b41011ec53a4b3fcf0c3413a7c
  verificationRules:
    - chain: baseCommit 必须是 candidateCommit 祖先、candidateCommit 必须是 terminalCommit 祖先（git merge-base --is-ancestor）
    - tree: candidateTree 必须等于 candidateCommit^{tree}
    - artifactsIntact: 每卡的卡/evidence/handoff 当前 blob 必须等于其 terminalCommit 处 blob（历史制品未被改写）
    - gapKept: 每卡 evidence checks 的 preClosure 状态必须仍为 NOT_RUN（缺口事实保持，与 TASK-0231 登记一致）
    - resultsRecorded: 每项校验结果逐卡记录到 compensation-batch-1.json，FAIL 如实保留不转换
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
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/tasks/TASK-0213-h5-index-carry-relationship-id-to-memory.md
  - docs/evidence/TASK-0213/evidence-pack.json
  - docs/handoffs/TASK-0213.json
  - docs/tasks/TASK-0214-h5-memory-empty-point-to-chat.md
  - docs/evidence/TASK-0214/evidence-pack.json
  - docs/handoffs/TASK-0214.json
  - docs/tasks/TASK-0215-h5-login-back-to-index-nav.md
  - docs/evidence/TASK-0215/evidence-pack.json
  - docs/handoffs/TASK-0215.json
  - docs/tasks/TASK-0216-h5-memory-empty-id-select-or-fill.md
  - docs/evidence/TASK-0216/evidence-pack.json
  - docs/handoffs/TASK-0216.json
  - docs/tasks/TASK-0217-h5-memory-carry-relationship-id-to-chat.md
  - docs/evidence/TASK-0217/evidence-pack.json
  - docs/handoffs/TASK-0217.json
  - docs/evidence/TASK-0231/governance-gap-quarantine.json
writeAllowlist:
  - docs/tasks/TASK-0238-compensation-batch-1.md
  - docs/tasks/context/TASK-0238.context-lock.yaml
  - docs/evidence/TASK-0238/**
  - docs/handoffs/TASK-0238.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
forbiddenPaths:
  - .github/**
  - ci/**
  - service/**
  - frontend/**
  - infra/**
  - scripts/**
  - skills/**
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
  - docs/tasks/TASK-0213-h5-index-carry-relationship-id-to-memory.md
  - docs/tasks/TASK-0214-h5-memory-empty-point-to-chat.md
  - docs/tasks/TASK-0215-h5-login-back-to-index-nav.md
  - docs/tasks/TASK-0216-h5-memory-empty-id-select-or-fill.md
  - docs/tasks/TASK-0217-h5-memory-carry-relationship-id-to-chat.md
  - docs/tasks/context/TASK-0213.context-lock.yaml
  - docs/tasks/context/TASK-0214.context-lock.yaml
  - docs/tasks/context/TASK-0215.context-lock.yaml
  - docs/tasks/context/TASK-0216.context-lock.yaml
  - docs/tasks/context/TASK-0217.context-lock.yaml
  - docs/evidence/TASK-0213/**
  - docs/evidence/TASK-0214/**
  - docs/evidence/TASK-0215/**
  - docs/evidence/TASK-0216/**
  - docs/evidence/TASK-0217/**
  - docs/handoffs/TASK-0213.json
  - docs/handoffs/TASK-0214.json
  - docs/handoffs/TASK-0215.json
  - docs/handoffs/TASK-0216.json
  - docs/handoffs/TASK-0217.json
  - docs/evidence/TASK-0231/**
  - docs/handoffs/TASK-0231.json
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
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - docs/evidence/TASK-0231/governance-gap-quarantine.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-009
humanApprovals:
  - scope: task-intake
    approvedBy: repository-owner
    approvedAt: "2026-08-16"
    evidence: >-
      Owner 2026-08-16 /goal 补充明确授权第 6 条：14 张历史卡的精确后验补偿
      验证为必须完成的工作项；第 8 条：补偿验证按机器评估拆成严格串行批次，
      每批必须绑定精确历史 candidate Commit/Tree。本卡为批 1（5 卡），只执行
      只读绑定验证与记录，不修改任何历史制品，不把 FAIL/NOT_RUN 改成 PASS，
      不改变失败/安全/契约语义。idle 状态下 --task 不能指向历史卡（selected
      task 机制），故补偿验证采用逐卡精确 Git 对象绑定验证脚本形式。
      不编造 sourceThreadId。
independentReview: not-required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0238
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python docs/evidence/TASK-0238/verify_compensation_batch.py
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash。永久 ID 由机器真源派生：
> Task Ledger 现存最大编号为 TASK-0237（ACCEPTED），intake 分配本号。
> 本卡是 14 卡补偿验证的批 1（5 卡），严格串行；批 2/3 由后继卡承接。

## 背景与用户可观察目标

14 张历史卡（TASK-0213..0219/0221..0227）在验证缺口下 ACCEPTED（缺口已由
TASK-0231/0232/0235 登记并 canonical 识别）。Owner 要求「14 张历史卡的精确
后验补偿验证均有真实结果，每批必须绑定精确历史 candidate Commit/Tree」。
idle 状态下 doctor --task 不能指向历史卡（selected task 机制失败关闭），因此
补偿验证采用逐卡精确 Git 对象绑定验证：链关系、candidate tree、历史制品
完整性、缺口事实保持，逐卡记录真实结果。

用户可观察目标：批 1 五张卡（0213-0217）各获得一份机器可验证的绑定校验记录
（base/candidate/terminal 链、candidateTree、制品 blob 一致性、NOT_RUN 缺口
保持），FAIL 如实保留。

## 范围内

- 实现 `docs/evidence/TASK-0238/compensation-batch-1.json`：冻结五卡身份
  （base/terminal/candidate/tree）与逐项校验结果。
- 实现只读核验脚本 `docs/evidence/TASK-0238/verify_compensation_batch.py`：
  执行 chain/tree/artifactsIntact/gapKept 四项校验并与记录比对；负例矩阵
  （漂移 FAIL）。
- 本卡治理制品与终态闭合。

## 明确范围外

- 不修改五张历史卡及任何历史卡、Evidence、Handoff、Ledger 条目或提交。
- 不修改 `scripts/harness/**`、`.harness/**` 策略或任何保护路径。
- 不补跑历史卡的 doctor/precheck 并把当前运行追溯写成 PASS；不把
  FAIL/NOT_RUN 改成 PASS。
- 不 push main、不 force push、不 merge/rebase/reset/cherry-pick、不建 tag/PR。

## 输入和前置条件

- Base：`b8512229dd5cb3ba1f8e7019c1dd47d7f0a72bbb`（TASK-0237 ACCEPTED 终态；
  已推送至恢复分支，远端 SHA/Tree 复核一致，正式 Doctor 释放绑定 PASS）。
- 仓库 idle：`activeTask=null`，工作树与 Index 干净。

## API / 事件 / 数据契约

- 不修改 OpenAPI、catalog、contracts、events、数据库。

## 权限、RLS 和数据处理要求

- 不触数据库、RLS 或业务数据。
- 写路径均为 C2 task-intake 治理制品；不申请 harness-change 人工批准。

## 状态机和失败行为

- 本卡单面 HISTORY，`splitDecision: KEEP`。
- 任一卡身份字段漂移或校验结果与仓库事实不一致 → verify FAIL。
- 历史制品被改写 → artifactsIntact FAIL。
- 把 NOT_RUN 缺口写成 PASS → gapKept FAIL。
- 修改 writeAllowlist 外路径 → FAIL。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块。

## 验收标准

1. 记录 JSON 存在，五卡身份与卡内 `compensationBatch` 合同一致。
2. verify 脚本真实执行：chain/tree/artifactsIntact/gapKept 对五卡全部 PASS
   （与仓库 Git 对象一致）；负例矩阵按预期 FAIL。
3. Diff 不包含历史制品、Harness 或保护路径。
4. 冻结 requiredCommands 真实执行；FAIL/NOT_RUN 不得改写成 PASS。

## 必跑检查

冻结命令见 YAML `requiredCommands`。READY 后真实跑 `doctor.py --task TASK-0238`；
候选冻结后真实跑官方 `precheck.py --task TASK-0238` 与
`doctor.py --task TASK-0238 --pre-closure`。终态后普通推送至
`refs/heads/codex/governance-recovery-20260816`、fetch 并远端精确 SHA/Tree 复核，
再跑一次正式 `doctor.py --task TASK-0238` 验证释放绑定。未跑不得写成 PASS。

## 回滚或前向修复

- 只允许本卡 writeAllowlist 在 `maximumFixBatches: 1` 内修订。

## 停止条件

- 需要修改 writeAllowlist 外路径、修改历史制品或把 NOT_RUN/失败转为 PASS
  立即停止。
