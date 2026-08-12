# TASK-0172：P2-22 nextAction 治理（Doctor 区分 advisory 文本与可执行任务引用，未注册 TASK 引用失败关闭）

```yaml
taskId: TASK-0172
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
baseCommit: 0b5562292e164c823e254e3949b4d514cc9e8f95
authorizationCommit: "62b86a2d0f21bf9892faa0dbaae4aed1dd1f25da"
contextFingerprint: 700b02c383c680d39056f1724808c74e48f6546beed00e6f4ddd67aa8e972f8a
contextLock: docs/tasks/context/TASK-0172.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0172_P2_22_NEXTACTION_TASK_REFERENCE_GOVERNANCE
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0172
  - python -m unittest discover -s scripts/harness/tests -p "test_*.py"
  - git diff --check
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0171/evidence-pack.json
  - docs/evidence/TASK-0171/review-r1.md
  - docs/handoffs/TASK-0171.json
  - docs/tasks/TASK-0171-p1-04-worker-half-owner-injection.md
  - docs/tasks/context/TASK-0171.context-lock.yaml
  - owner-authorization://longline-2026-08-09
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
writeAllowlist:
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0172-p2-22-nextaction-task-reference-governance.md
  - docs/tasks/context/TASK-0172.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0172/**
  - docs/handoffs/TASK-0172.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-9]-*
  - docs/tasks/TASK-0170-*
  - docs/tasks/TASK-0171-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-9].context-lock.yaml
  - docs/tasks/context/TASK-0170.context-lock.yaml
  - docs/tasks/context/TASK-0171.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-9]/**
  - docs/evidence/TASK-0170/**
  - docs/evidence/TASK-0171/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-9].json
  - docs/handoffs/TASK-0170.json
  - docs/handoffs/TASK-0171.json
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
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_licenses.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0171.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 长线授权继续审计修复（一次一张新卡）。本卡 TASK-0172 = P2-22 nextAction
      治理落地。P2-22（TASK-0109 §4.8）原始问题：project-state.nextAction 曾引用
      TASK-0091/0092/0093，这些 ID 没有正式 Backlog/Task Ledger/任务卡——任何 Agent 不能把
      planning 文档中的 TASK-0091/92/93 当作现成授权直接写代码。Owner 2026-08-12 已定策略：
      「显式 task-intake 动作」——nextAction 只写「先通过 task-intake 创建 DRAFT」类 advisory
      文本 + Doctor 区分 advisory 与可执行任务。开卡前已用当前 HEAD（0b55622）复核现状：
      doctor.py 对 nextAction 仅有非空校验（L8495 validate_nonblank_text）+ READY/终态
      handoff 一致性校验（L3681/5466/5478）+ idle/gate 边只允许 idle 时改 nextAction
      （L11312-11382）+ gate approval 边 nextAction 必须标识 next promotable（L11320）；
      「nextAction 引用未注册 TASK ID 即失败」的校验不存在。本卡补齐该校验：nextAction 中
      引用的每个 TASK-XXXX ID 必须已在 discover_tasks()（docs/tasks/ 任务卡 = ledger 执行链 /
      backlog PLANNED / idle DRAFT 例外卡）中注册；纯 advisory 文本（无 TASK 引用）通过。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 授权本卡触碰 protected path scripts/harness/**（doctor.py + tests/test_harness.py）。
      harness-change skill 1.1.7 已注册（.harness/skills.yaml）。改动最小：doctor.py 在
      validate_project_state 内新增 nextAction 引用注册校验（新函数
      validate_nextaction_registered_references）+ test_harness.py 新增 3 个定向测试
      （advisory 通过/已注册引用通过/未注册引用拒绝）。不改 harness_common.py/precheck.py/
      precheck.sh/precheck.ps1/catalog_tool.py/check_*.py/durable_command.ps1/AGENTS.md/
      CLAUDE.md/skills/**/.github/workflows/**；不新增 CLI flag、环境变量或通用 override；
      不弱化任何既有失败关闭语义。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers:
  - id: task0172_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 030f5ad78f9bdc60972fe59caf3f406ea631ab83
    candidateTree: 7c1d714815931aa1238b30dd9844ebfb68275ab3
    evidencePath: docs/evidence/TASK-0172/review-r1.md
    reason: >-
      R1 PASS（0 P0/P1/P2，4 P3 informational：新校验仅作用于 validate_project_state 当前 HEAD
      路径、gate 边校验独立并存；nextAction 解释性文本提及历史未注册 ID 会触发 ERROR 属 P2-22
      治理目标非缺陷；注册集合=discover_tasks 卡集合单调无退化为未注册风险；canonical checks
      827795 增量 ~5059 同量级无异常）。doctor.py +validate_nextaction_registered_references
      （re.findall TASK-[0-9]{4,} 引用集合 - discover_tasks 全量卡 → 未注册 ERROR；advisory
      无引用放行）挂载 validate_project_state L8495 后；test_harness.py import + StateTests
      3 测试（advisory/已注册/TASK-9999 拒绝）。静态门禁全 PASS（定向 StateTests 10/10 +
      BacklogTests/EnforcementTests 96/0；canonical 8/8 doctor 827795；diff exit0）。
      5 改动文件全在 writeAllowlist，scripts/harness/** protected path 满足 harness-change
      1.1.7 + humanApproval scope:harness-change + independentReview:required；
      harness_common.py/precheck*/skills/**/AGENTS.md 零触碰。完整 unittest discover +
      根级 verify deferred per Owner static-gates-only。
terminalStateReason: >-
  P2-22 nextAction 治理实现闭环。候选 030f5ad/tree 7c1d7148；canonical precheck 8/8 PASS
  （doctor 827795 checks 112.3s，基线 822736 + ~5059）；git diff --check exit 0；定向 harness
  StateTests 10/10（含新 3）+ BacklogTests/EnforcementTests 96/0 无回归；R1 PASS（0 P0/P1/P2，
  4 P3 informational）。doctor.py +validate_nextaction_registered_references：nextAction 引用
  未注册 TASK ID 失败关闭、advisory 文本放行（P2-22 Owner 2026-08-12 定「显式 task-intake
  动作」策略的机器落点），挂载 validate_project_state 非空校验之后，tasks=discover_tasks 全量
  卡（ledger/backlog PLANNED/idle DRAFT 例外，含本卡自身）；test_harness.py import + StateTests
  3 测试。scripts/harness/** protected path 满足 harness-change skill + humanApproval
  scope:harness-change + independentReview:required；harness_common.py/precheck*/skills/**/
  AGENTS.md 零触碰。完整 unittest discover + 根级 Maven verify 按 Owner static-gates-only 策略
  deferred to 统一审计。
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P2-22 审计修复卡
> （§4.8「未来任务引用必须机器可执行」）：Owner 2026-08-12 已定「显式 task-intake 动作」策略，
> 本卡把该策略落进 Doctor 机器校验——nextAction 引用未注册 TASK ID 失败关闭，advisory 文本放行。
> 触碰 protected path `scripts/harness/**`（doctor.py + tests/test_harness.py）→ C4 +
> harness-change skill + humanApproval scope:harness-change + independentReview: required。
> 无业务代码、无 DB、无 catalog/contract/OpenAPI、无前端改动。

## 背景与用户可观察目标

P2-22（TASK-0109 §4.8）：「未来任务引用必须机器可执行」。原始问题：`project-state.nextAction`
曾引用 TASK-0091/0092/0093，但这些 ID 没有正式 Backlog/Task Ledger/任务卡——任何 Agent 都不能把
planning 文档中的 TASK-0091/92/93 当作现成授权直接写代码。

Owner 2026-08-12 已定策略（本卡执行依据）：

- **「显式 task-intake 动作」**：nextAction 对未来工作只写「先通过 task-intake 创建 DRAFT」类
  advisory 文本，不引用未注册任务编号；
- **Doctor 区分 advisory 文本与可执行任务**：nextAction 引用的 `TASK-\d{4,}` 必须是已注册任务
  （存在任务卡 = ledger 执行链 / backlog PLANNED / idle DRAFT 例外卡），否则失败关闭。

当前 HEAD（0b55622）doctor.py 校验现状（代码核实，非盲信清单）：

1. `validate_project_state`（doctor.py:8372）内 L8495 `validate_nonblank_text(audit,
   "project-state: nextAction", state.get("nextAction"))` —— 只要求非空，**不校验引用注册**。
2. READY checkpoint 校验（L3681-3682）校验 project-state.nextAction 非空 + 与授权提交投影一致；
   终态校验（L5466/5478）校验 handoff.nextAction 与 terminal project-state.nextAction 逐字一致。
3. idle checkpoint 边校验（L11312-11382）只允许 idle 时改 nextAction（内容不限）；
   gate approval 边（L11320-11325）要求 nextAction 提及 next promotable——那是 gate 边专用逻辑，
   不含通用「引用必须注册」检查。
4. `discover_tasks()`（harness_common.py:189）从 `docs/tasks/*.md` 任务卡发现全部任务 ID——
   天然覆盖 ledger 执行链、backlog PLANNED 投影卡与 idle 例外 DRAFT 卡，是「已注册」判定的正确真源。

用户可观察结果（本卡完成后）：

- **doctor.py 新增校验**：`project-state: nextAction` 引用的每个 `TASK-\d{4,}` ID 必须在
  `discover_tasks()` 集合内；未注册引用 → ERROR（失败关闭）。advisory 文本（无 TASK 引用）→ PASS。
- **test_harness.py 新增 3 测试**：advisory 通过 / 已注册引用通过 / 未注册引用（TASK-9999）拒绝。
- 当前 HEAD 的 nextAction（引用 TASK-0171/TASK-0168 均已注册 + §5.1.2/P2-22 advisory 片段）通过新校验。

## 范围内

1. **`scripts/harness/doctor.py`（修改）**：
   - 新增函数 `validate_nextaction_registered_references(audit, state, tasks)`：
     - 提取 `str(state.get("nextAction", ""))` 中全部 `TASK-[0-9]{4,}` 引用（`re.findall`，与
       gate approval 边既有 L11321 同模式）；
     - `unregistered = sorted(引用集合 - set(tasks))`；
     - `audit.require(not unregistered, "project-state: nextAction references unregistered task IDs: ...")`；
     - 无引用（advisory）→ 直接通过。
   - 在 `validate_project_state` 内既有 `validate_nonblank_text("project-state: nextAction", ...)`
     （L8495）之后调用 `validate_nextaction_registered_references(audit, state, tasks)`。
     `tasks` 参数即 `discover_tasks()` 全量任务卡（含 idle DRAFT 例外卡自身，保证 READY 授权提交
     nextAction 引用 TASK-0172 时通过）。
2. **`scripts/harness/tests/test_harness.py`（修改）**：
   - import 列表加入 `validate_nextaction_registered_references`（from doctor import ...）；
   - `StateTests` 类新增 3 个测试：
     a. `test_nextaction_advisory_text_without_task_reference_passes`：nextAction = "先通过
        task-intake 创建 DRAFT 后继续" → audit.errors 空；
     b. `test_nextaction_registered_task_reference_passes`：nextAction = "TASK-0171 已闭环，
        继续 §5.1.2" → audit.errors 空（TASK-0171 在 discover_tasks）；
     c. `test_nextaction_unregistered_task_reference_fails_closed`：nextAction = "将 TASK-9999
        晋级为唯一 DRAFT" → errors 含 "references unregistered task IDs" 且含 "TASK-9999"。
   - 直接以 `Audit()` + `state` dict + `discover_tasks()` 调用新函数（plain 单元风格，
     与 StateTests 既有 validate_project_state 测试一致）。
3. 终态治理闭环：canonical precheck + git diff --check + 独立 R1 + Evidence/Handoff/
   pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不改 `scripts/harness/harness_common.py`、`precheck.py`、`precheck.sh`、`precheck.ps1`、
  `catalog_tool.py`、`check_*.py`、`durable_command.ps1`（禁止路径逐文件列禁）。
- 不改 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.github/workflows/**`、`ci/**`、
  `requirements-harness.txt`、`.harness/**`（除 project-state/task-ledger 终态更新）。
- 不改 gate approval 边既有逻辑（L11320 next promotable 检查保持）；不改 idle checkpoint 边
  「idle 只允许改 nextAction」语义；不改 READY/终态 handoff 一致性校验。
- 不新增 CLI flag、环境变量、可配置 allowlist 或通用 override；不弱化任何既有失败关闭。
- 不处理其它审计项（§5.1.2 coordinator 仍 OWNER_GATE；P2-20/P2-23/P2-24/P2-26/P2-27 等按序开卡）。
- 不跑完整 Harness unittest discover 与根级 Maven verify（Owner 2026-08-12 static-gates-only
  策略，deferred to 统一审计；本卡迭代证据 = 定向 StateTests 相关测试类）。

## 输入和前置条件

- Base `0b5562292e164c823e254e3949b4d514cc9e8f95` = TASK-0171 ACCEPTED terminal（已 push、
  HEAD==origin/main、0/0、clean；nextAction 三处 sha256 `e53e785b…` 一致）。
- 本卡 context lock 输入钉在 Base（36 inputs = 35 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` 沿用 hash `cc0f91c1…`）；contextFingerprint
  `700b02c3…` 由复刻 verify_context_lock 算法生成并自验（先复现 TASK-0171 `cfff5e4e…` MATCH，
  再生成 TASK-0172）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- 关键事实：`discover_tasks()` 返回 docs/tasks/ 全部任务卡 ID（含历史 ACCEPTED/REJECTED、
  backlog PLANNED、idle DRAFT 例外卡）——当前 170+ 张卡；当前 HEAD nextAction 引用
  TASK-0171/TASK-0168（已注册）+ advisory 片段（§5.1.2、P2-22 无 TASK 引用）→ 新校验通过；
  历史 idle/gate fixture 测试（TASK-1001/9999）走 derive_idle_planning_checkpoint /
  approve_gate 路径，不经 validate_project_state，不受新校验影响。

## API / 事件 / 数据契约

- 产品 API 不变（无新端点、无新错误码、不改 OpenAPI/catalog/contract）。
- 数据契约：无 DB 改动、无 migration、无角色/权限/RLS 改动。
- Doctor 行为契约（本卡核心）：`project-state.nextAction` 中引用的每个 `TASK-\d{4,}` 必须已注册
  （discover_tasks 命中）；未注册 → doctor ERROR；无引用（advisory）→ PASS。README/规划文档中
  的未注册 ID 不再可能被误当现成授权（Agent 读 nextAction 引用时必须能解析到任务卡）。

## 权限、RLS 和数据处理要求

- scripts/harness/** 是 C4 protected path：requiredSkill harness-change（1.1.7 已注册）+
  humanApproval scope:harness-change + independentReview: required——本卡已在 humanApprovals
  声明 Owner 授权，卡 riskClass = C4。
- 无 DB、无 RLS、无 PII 处理；校验纯静态（读 project-state + discover_tasks 结果）。
- 不引入任何新运行依赖（re 已 import）。

## 状态机和失败行为

- 实现 = 2 个文件（doctor.py 新函数 + 挂载；test_harness.py 3 测试 + import）。
- 迭代验证：定向跑 test_harness.py 的 StateTests 与 validate_project_state 相关测试类
  （python -m unittest ...），确认新测试 PASS 且既有 nextAction/state 测试无回归。
- canonical precheck 8 子命令 PASS（doctor 子命令含新校验：当前 HEAD nextAction 引用已注册 →
  通过；doctor checks 数将比基线 822736 增加）。
- R1 独立静态复核（C4 必须）：0 P0/P1/P2 = PASS。R1 阻塞 → 最多 1 fix batch（仅改 doctor.py +
  test_harness.py，不动卡 body 保持 READY projection 冻结）→ R2；R3 禁止。超 hardFuse 90min →
  closure-only overrun 或 REJECTED。
- 若新校验误伤既有合法状态（如某历史 nextAction 引用未注册 ID）：立即停止，向 Owner 报告并
  按机器真源调查（历史制品不可改写）。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆。本卡是 Harness 治理校验（Doctor 机器门禁）增强：让「nextAction 引用
未来任务」从可读文本变成可机器执行的注册校验。不外发、不调模型、不写记忆。

## 验收标准

1. `doctor.py` 新增 `validate_nextaction_registered_references(audit, state, tasks)`：
   nextAction 引用未注册 `TASK-\d{4,}` ID → audit ERROR（消息含 "references unregistered task
   IDs" 与具体 ID）；无引用（advisory）→ 通过；全已注册 → 通过。
2. `validate_project_state` 内 L8495 非空校验之后调用该函数（tasks = discover_tasks() 全量）。
3. `test_harness.py` 新增 3 测试：advisory 通过 / 已注册引用（TASK-0171）通过 / 未注册引用
   （TASK-9999）失败关闭；import 列表含新函数。
4. 定向跑 StateTests + validate_project_state 相关测试全 PASS（既有无回归；完整 discover
   deferred per Owner static-gates-only，Evidence 如实标注）。
5. 唯一 canonical precheck `python scripts/harness/precheck.py --task TASK-0172` 8/8 PASS
   （doctor 子命令含新校验，当前 HEAD 通过）；唯一无参 `git diff --check` exit 0。
6. R1 独立复核 PASS（C4 必须；0 P0/P1/P2）。
7. 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 一次；完整 Harness unittest
discover 按 Owner 2026-08-12 static-gates-only 策略 deferred to 统一审计——列入但不跑，
doctor 只校验字段冻结；同一无参 `git diff --check` 一次）。迭代中跑定向 StateTests 相关测试类
作实现证据（非 canonical 替代）。

## 回滚或前向修复

- 若定向测试暴露新校验误伤：最多 1 fix batch 修 doctor.py/test_harness.py（不删测、不加 skip）。
- 若 canonical precheck 失败：按错误修 doctor.py 或 test_harness.py（最多 1 fix batch）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须触碰 writeAllowlist 外路径（如 harness_common.py）：立即停止，向 Owner 申请范围
  升级（自批禁止）。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 harness_common.py/
  precheck.py/skills/**/.harness/** 除 project-state/task-ledger、docs/tasks 历史卡、
  TASK-0171 卡/evidence/handoff）。
- 正式 Precheck / diff check / pre-closure 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0 的 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0172/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0172.json`。
