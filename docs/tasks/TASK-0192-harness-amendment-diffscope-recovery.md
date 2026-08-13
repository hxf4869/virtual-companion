# TASK-0192：Harness 恢复（amendment-diff-scope 缺口修复 + TASK-0191 seed 遗漏一次性机器绑定恢复）

```yaml
taskId: TASK-0192
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
planningBacklog: null
planningContractHash: null
planningContractHashAlgorithm: null
baseCommit: 2abc531bde888d7f9689d199fb8b092b3341b226
authorizationCommit: ""
contextFingerprint: 0027e99094ba7321200a1baf45fb5f41da154ddd84cf8c439ee513a6bc9d65c6
contextLock: docs/tasks/context/TASK-0192.context-lock.yaml
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
  surfaceId: TASK_0192_HARNESS_AMENDMENT_DIFFSCOPE_RECOVERY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 60
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 2026-08-13 修正版 A 指令：TASK-0192 是 C4 Harness 恢复卡，范围同时
    包含通用 amendment 机制缺口修复与 TASK-0191 seed 遗漏的一次性精确机器绑定
    恢复；二者共同恢复 greenline，拆卡会留下 doctor 红/半修复状态。
preReadyMaintenancePlan:
  recordId: OWNER-MAINT-20260813-TASK-0192-PRE-READY-01
  recordPath: docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_PRE_READY_MAINTENANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  exactPaths:
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json
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
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/evidence/TASK-0190/evidence-pack.json
  - docs/handoffs/TASK-0190.json
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/evidence/TASK-0191/evidence-pack.json
  - docs/evidence/TASK-0191/review-r1.md
  - docs/handoffs/TASK-0191.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
writeAllowlist:
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0192/**
  - docs/handoffs/TASK-0192.json
forbiddenPaths:
  - .github/**
  - ci/**
  - frontend/**
  - infra/**
  - service/**
  - specs/**
  - mvnw
  - mvnw.cmd
  - pom.xml
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
  - docs/decisions/**
  - docs/planning/**
  - docs/schemas/**
  - docs/source/**
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0184-realtime-sse-resume-stream.md
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/TASK-0190-license-inventory-jackson-databind.md
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/tasks/context/TASK-0190.context-lock.yaml
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/evidence/TASK-0184/**
  - docs/evidence/TASK-0189/**
  - docs/evidence/TASK-0190/**
  - docs/evidence/TASK-0191/**
  - docs/handoffs/TASK-0184.json
  - docs/handoffs/TASK-0189.json
  - docs/handoffs/TASK-0190.json
  - docs/handoffs/TASK-0191.json
  - skills/**
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/evidence/TASK-0191/evidence-pack.json
  - docs/handoffs/TASK-0191.json
  - scripts/harness/doctor.py
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-13"
    sourceThreadId: zcode-audit-20260813
    evidence: >-
      Owner 2026-08-13 修正版 A：TASK-0191 按真实结果闭合 REJECTED 后创建
      TASK-0192（Base 使用其真实 REJECTED 终态 SHA 2abc531bde888d7f9689d199
      fb8b092b3341b226）。TASK-0192 是 C4 Harness 恢复卡，范围同时包含：修复
      通用 amendment 机制缺口（只有一条父边已完整通过
      validate_amendment_introduction 时，才把该边的 .harness/task-backlog.yaml
      视为强制治理伴随路径，不再被普通 diff-scope/forbidden 检查重复拒绝；
      不得全局忽略 Backlog）；为 TASK-0191 已发生的 seed 路径遗漏建立一次性、
      精确机器绑定恢复（绑定 task、base、parent、bfc6a62 commit/tree、路径、
      mode 和 blob 内容；不得实现通用追溯授权）；增加正负测试，至少拒绝额外
      Backlog 内容、错误父提交、额外路径、blob/tree 漂移、多父提交、二次消费
      和其他任务复制使用。TASK-0192 不得修改 TASK-0191 历史、不得
      rebase/reset/filter，也不得把 TASK-0191 的业务实现顺带声明为 ACCEPTED。
      greenline 恢复后再单独创建任务，对继承的 P0 实现进行明确授权、同一
      候选 SHA 全量复验和独立复核后完成正式接纳；在此之前不得推送或合并。
      仅在 TASK-0192 的精确 pre-READY 边界需要 Owner 批准时合并为一次提问。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0192
  - PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.Task0192AmendmentDiffScopeRecoveryTests test_harness.Task0191SeedRecoveryTests test_harness.Task0098PostTerminalTailTests test_harness.Task0189PostTerminalTailTests
  - git diff --check
```

> 本卡为独立延续单卡（前一合法终态：TASK-0191 REJECTED `2abc531`）。

## 背景与用户可观察目标

TASK-0191 以真实 FAIL 闭合 REJECTED 后，doctor 对 TASK-0191 的 diff-scope 检查
存在 3 项永久 error（idle summary 亦 FAIL，greenline 红灯）：

1. **通用设计缺口（2 条 error）**：`validate_amendment_introduction` 强制
   amendment 引入提交原子包含 `.harness/task-backlog.yaml`（expected_changed），
   但 `validate_diff_scope` 的联合路径检查把该边的 backlog 变更重复计入任务
   范围，对未在 writeAllowlist 预授权 backlog 的卡（其 forbiddenPaths 往往冻结
   含 backlog）失败关闭。TASK-0037 先例因卡 writeAllowlist 本含 backlog 未触发。
2. **一次性遗漏（1 条 error）**：`infra/db/tests/00_owner_binding_secret_seed.sql`
   为 TASK-0191 READY 冻结清单遗漏，且已在 `bfc6a62` 先行引入——amendment
   规则禁止追溯授权，不可补录，只能由本卡建立一次性精确机器绑定恢复。

本卡修复（1）为通用规则、（2）为一次性绑定，使 `doctor --task TASK-0191` 与
idle summary 恢复 PASS（greenline 恢复），为后续独立接纳 TASK-0191 继承的 P0
实现铺平机器通道。

## pre-READY maintenance 边界（须 Owner 批准后执行）

doctor 的 3 项 error 在本卡 READY Doctor 时即会阻塞（全局任务校验含
lastTerminal），因此修复必须先于 READY 落地（TASK-0073/0098/0189 同型边界）：

- 唯一边 `OWNER-MAINT-20260813-TASK-0192-PRE-READY-01`（Owner 2026-08-14
  条件批准），**修正后 DRAFT**（非 cab8311）的直接单父提交，恰 3 个冻结
  路径：`scripts/harness/doctor.py`、
  `scripts/harness/tests/test_harness.py`、
  `docs/evidence/TASK-0192/pre-ready-maintenance-authorization.json`
  （approvedAt 2026-08-14）。
- oneTimeOnly、不可复用、消费后惰化、路径不得增删；边界即实现。

## 实现设计（Owner 冻结边界内，2026-08-14 修正版机器绑定）

提交链事实（修正 DRAFT cab8311 中把 seed 引入提交直接父误写为 3fe5244 的
错误；实际链为 3fe5244 → 2668949（scope amendment）→ bfc6a62（引入 seed））：

- TASK-0191：baseCommit `3c7fd0b5b306325d51464053e7b3382044c3dd4b`（tree
  `21dddce6f1f61960d6647ffa9aaadc992e1f01d6`）、authorizationCommit
  `9aa3221a25d4eedc77377ff07d0bfff46a4e7c63`（tree
  `4e7f600e9244cd2aef346cc1bfc97205e5ed0ba7`）。
- **amendment 伴随边**：`3fe5244f865d46b59a535cd25e5f52793366e28f`（tree
  `d6b2ed710be62ffcd4b6bc612edc99f1a2c64de2`）→
  `26689494cfe560cd1b388d2a1a6c44adadb1e8d2`（tree
  `5b5745e80d5472a8d974aaa626697836fd122a17`），精确 changed-path set =
  6 路径（backlog + 卡 + 4 amendment 路径；sorted-set sha256
  `ae79436097f6d4ba2cbc5b8d4a7dd2aec2d6847300cd190df927746ed628c879`）。
- **seed 引入边**：`26689494cfe560cd1b388d2a1a6c44adadb1e8d2` →
  `bfc6a62d53eb55c22dc257216b1db8592f50c667`（tree
  `19ac0333904dcb46f879f2076a232c33be7e9ac1`），精确 changed-path set =
  66 路径（sorted-set sha256
  `c355d48eeb601c081a7a5efd230c0de71567915b554891e2df48e42775fa024f`）；
  seed 路径 `infra/db/tests/00_owner_binding_secret_seed.sql` mode `100644`、
  blob `5f8493983834c2a207141be6fbf5ac2181c9a1c2`、content sha256
  `0203668d07791e99f83ddd4a340db83a61430f2bdca89ac5e6a016f661a5c166`，
  且当前 HEAD blob 必须仍等于引入 blob（防漂移）。

1. **通用 amendment 伴随路径规则**（doctor.py）：新增纯函数
   `amendment_edge_is_governance_introduction(...)` 与
   `amendment_governance_companion_paths(task_id, task_path, base_commit,
   head_commit)`；在 `validate_diff_scope` 的逐路径检查中，当且仅当某父边
   **已由隔离校验得到零错误**（单父；changed 恰为
   {task card, .harness/task-backlog.yaml, *addedWriteAllowlist}；合同
   authorizedParentCommit==该边父提交；子提交原子引入而父提交没有；卡
   scopeAmendments 投影与 backlog 合同逐字一致且 contractHash 正确）时，
   **仅**把该边上的 `.harness/task-backlog.yaml` 视为强制治理伴随路径，
   跳过普通 allowlist/forbidden 重复拒绝。**不得全局忽略 Backlog**，也
   **不得豁免 task card、added paths 或其他任何路径的错误**——它们仍按
   原规则失败关闭。
2. **TASK-0191 seed 一次性恢复**（doctor.py 常量
   `TASK_0192_SEED_RECOVERY_*`，精确绑定上表事实）：task=TASK-0191、
   TASK-0191 base/authorization commit、引入边父 `26689494…` 与引入提交
   `bfc6a62…`（含各自 tree）、精确 changed-path set（66 路径）、seed 路径、
   mode `100644`、引入 blob 与 content sha256、HEAD blob 一致性。恢复仅使
   **这一条** TASK-0191 历史边命中（其余任何任务/边/字段不匹配即不生效，
   失败关闭）；不实现通用追溯授权。
3. **正负测试**（test_harness.py 新增
   `Task0192AmendmentDiffScopeRecoveryTests` 与
   `Task0191SeedRecoveryTests`）：
   - 正：真实仓库中 amendment 边（3fe5244→2668949）识别为治理伴随路径；
     seed 引入边（2668949→bfc6a62）恢复命中；TASK-0191 diff-scope 3 项
     error 消除（doctor --task TASK-0191 恢复 PASS 由 canonical precheck
     与显式重跑实证）。
   - 负（均 FAIL）：错误父提交（含把 3fe5244 当 seed 边直接父）、错误
     tree、错误 blob/content hash、额外路径、多父边、二次消费（父已含
     amendment id）、其他任务复制使用（task_id 不匹配）、未通过隔离零错误
     校验的 backlog 变更仍拒绝。
   - 回归：TASK-0098/TASK-0189 tail 测试类保持 PASS（requiredCommands 定向）。

## 范围内

- 上述 3 个冻结路径的边界提交与终态治理路径（card/context/evidence/handoff/
  project-state/ledger）。

## 明确范围外

- 不修改 TASK-0191 历史制品；不 rebase/reset/filter。
- 不把 TASK-0191 的业务实现（V27/OwnerContext/测试）顺带声明为 ACCEPTED——
  正式接纳由 greenline 恢复后的独立任务卡执行。
- 不全局忽略 Backlog；不实现通用追溯授权。
- 不改 ci-execution-policy/skills/生命周期/业务代码/前端/CI。
- 不推送、不合并。

## 验收标准

1. `doctor --task TASK-0191` 与 `doctor --summary` 恢复 PASS（3 项 error 消除）。
2. `requiredCommands` 三条以同一候选 SHA 真实 PASS；canonical precheck 全绿。
3. 正负测试全 PASS；TASK-0098/TASK-0189 回归 PASS。
4. C4 独立复核 PASS；Evidence/Handoff/project-state nextAction 逐字一致；
   Ledger 追加 TASK-0192。
5. 完整 unittest discover NOT_RUN 如实记录（CiPolicy 34 分钟 CI 预算风险延续）。

## Evidence Pack

输出到 `docs/evidence/TASK-0192/`（含 `review-r1.md`），并生成
`docs/handoffs/TASK-0192.json`。
