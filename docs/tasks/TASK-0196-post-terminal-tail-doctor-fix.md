# TASK-0196：Doctor post-terminal 校验修复（一次性接纳 fe0253f→751cb9d + 终态后新父边默认失败关闭）

```yaml
taskId: TASK-0196
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
baseCommit: 751cb9db547df2ba33d55d310276bc14e1fbd5eb
authorizationCommit: ""
contextFingerprint: 76803c8d53aee411bfaee30948367636e0309034c31077ae726a24e35e6379cd
contextLock: docs/tasks/context/TASK-0196.context-lock.yaml
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
  surfaceId: TASK_0196_POST_TERMINAL_TAIL_DOCTOR_FIX
  policySurfaces: [GOVERNANCE, AUTHORIZATION, HISTORY]
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 90
  thresholdsTriggered: [crossRiskSurfacesMinimumDistinct2, reviewerMinutesGreaterThan15, terminalCheckMinutesGreaterThan20, estimatedWallMinutesGreaterThan90]
  splitRecommended: true
  splitProposal: >-
    Owner 2026-08-14 指令：目标 1（一次性接纳 fe0253f→751cb9d）与目标 2-7
    （Doctor post-terminal 校验修复）必须同卡不可分割——接纳记录是修复后
    默认失败关闭的唯一放行例外，修复是接纳记录可被机器验证的前提；拆卡会
    留下"已登记记录无校验者"或"默认失败关闭无放行通道"的半卡。
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 将 fe0253f→751cb9d 定性为未登记的 post-terminal correction，要求以
    canonical task-intake 建立一次性、不可复制、不可重放的精确机器绑定接纳，
    同时修复 Doctor 的 ACCEPTED/REJECTED blanket continue 短路与终态后新父边
    默认放行缺陷；接纳记录（目标 1）与校验修复（目标 2-4）互为前提，必须
    一次成卡原子完成。
postTerminalTailAcceptance:
  recordId: OWNER-MAINT-20260814-TASK-0196-POST-TERMINAL-TAIL-01
  recordPath: docs/evidence/TASK-0196/pre-ready-maintenance-authorization.json
  kind: OWNER_AUTHORIZED_EXACT_ONE_TIME_POST_TERMINAL_TAIL_ACCEPTANCE
  directSingleParentFromDraftRequired: true
  pathSetFrozenAtDraft: true
  additionsOrRemovalsForbidden: true
  oneTimeOnly: true
  reusable: false
  consumedRecordMustBecomeInert: true
  terminal:
    commit: fe0253fc9cfd0b3d88c11a18273c25b2a8e9274f
    tree: e1356cd6b521ae68d6b21f7e7f8e0b8f49dc4b71
    taskId: TASK-0195
    state: ACCEPTED
  tail:
    commit: 751cb9db547df2ba33d55d310276bc14e1fbd5eb
    tree: adfe981041de9027b9d5b2b83697dd2500fe3c3f
    parent: fe0253fc9cfd0b3d88c11a18273c25b2a8e9274f
    singleParentRequired: true
    changedPaths:
      - docs/handoffs/TASK-0195.json
    files:
      - path: docs/handoffs/TASK-0195.json
        mode: "100644"
        type: blob
        blob: d00ec0dfd535ce0480444db45a0d8cff7c06e5fd
        contentSha256: ea23f12deb5d724de90b10f91d04a759ba19b92b2d3616640c1e98ddbb2c6749
  draftAnchorBaseCommit: 751cb9db547df2ba33d55d310276bc14e1fbd5eb
  exactPaths:
    - .harness/ci-execution-policy.yaml
    - docs/evidence/TASK-0196/pre-ready-maintenance-authorization.json
    - scripts/harness/doctor.py
    - scripts/harness/tests/test_harness.py
    - skills/task-delivery-flow/SKILL.md
    - skills/task-intake/SKILL.md
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - docs/evidence/TASK-0194/evidence-pack.json
  - docs/evidence/TASK-0194/review-r1.md
  - docs/handoffs/TASK-0194.json
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0195/evidence-pack.json
  - docs/evidence/TASK-0195/inherited-manifest.json
  - docs/evidence/TASK-0195/review-r1.md
  - docs/handoffs/TASK-0195.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
writeAllowlist:
  - docs/tasks/TASK-0196-post-terminal-tail-doctor-fix.md
  - docs/tasks/context/TASK-0196.context-lock.yaml
  - docs/evidence/TASK-0196/**
  - docs/handoffs/TASK-0196.json
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
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
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/**
  - docs/handoffs/TASK-0098.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/**
  - docs/handoffs/TASK-0189.json
  - docs/tasks/TASK-0191-owner-context-rls-trust-model.md
  - docs/tasks/TASK-0192-harness-amendment-diffscope-recovery.md
  - docs/tasks/TASK-0193-p0-owner-context-rls-inherited-adoption.md
  - docs/tasks/TASK-0194-worker-lease-fence-transaction-boundary.md
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0191.context-lock.yaml
  - docs/tasks/context/TASK-0192.context-lock.yaml
  - docs/tasks/context/TASK-0193.context-lock.yaml
  - docs/tasks/context/TASK-0194.context-lock.yaml
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0191/**
  - docs/evidence/TASK-0192/**
  - docs/evidence/TASK-0193/**
  - docs/evidence/TASK-0194/**
  - docs/evidence/TASK-0195/**
  - docs/handoffs/TASK-0191.json
  - docs/handoffs/TASK-0192.json
  - docs/handoffs/TASK-0193.json
  - docs/handoffs/TASK-0194.json
  - docs/handoffs/TASK-0195.json
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
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - scripts/harness/doctor.py
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/tasks/TASK-0098-generation-finalization-terminal-concurrency.md
  - docs/tasks/context/TASK-0098.context-lock.yaml
  - docs/evidence/TASK-0098/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0189-canonical-greenline-restore.md
  - docs/tasks/context/TASK-0189.context-lock.yaml
  - docs/evidence/TASK-0189/pre-ready-maintenance-authorization.json
  - docs/tasks/TASK-0195-p1-worker-lease-fence-inherited-adoption.md
  - docs/tasks/context/TASK-0195.context-lock.yaml
  - docs/evidence/TASK-0195/evidence-pack.json
  - docs/handoffs/TASK-0195.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
humanApprovals:
  - scope: post-terminal-tail-acceptance
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 2026-08-14 指令原文要点：接手 C4 治理修复，不得沿用上一 Agent
      "合法 terminal closure 收尾"结论；将 fe0253f→751cb9d 定性为未登记的
      post-terminal correction；TASK-0195 机器状态保持 ACCEPTED，不改写历史；
      原任务 writeAllowlist 不构成终态后的持续写授权；Doctor 对 ACCEPTED/REJECTED
      提前 continue 跳过深度校验是新的 C4/P1 治理缺陷；通过 canonical task-intake
      分配下一个永久任务 ID（机器真源确认 TASK-0196），为 fe0253f→751cb9d 建立
      一次性、不可复制、不可重放的精确机器绑定接纳（recordId
      OWNER-MAINT-20260814-TASK-0196-POST-TERMINAL-TAIL-01），并修复 Doctor
      post-terminal 默认失败关闭与深度校验短路；禁止 amend/rebase/删除/重写
      fe0253f/751cb9d，禁止本轮进入 READY 或修改实现。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-14"
    sourceThreadId: zcode-main-20260814
    evidence: >-
      Owner 授权本 C4 harness-change 卡（.harness/ci-execution-policy.yaml、
      scripts/harness/doctor.py、scripts/harness/tests/test_harness.py、
      skills/task-delivery-flow/SKILL.md、skills/task-intake/SKILL.md 六条
      冻结 maintenance 路径 + 本卡治理路径）在 READY 后实施 Doctor 修复；
      DRAFT 阶段只建卡与 Context Lock，不修改任何实现。
independentReview: required
reviewers: []
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0196
  - git diff --check
```

> 本卡为独立延续单卡，不写 planningBacklog/planningContractHash；永久 ID 由机器真源派生：
> Task Ledger 现存最大编号 TASK-0195（PERMANENT_NEVER_REUSE），仓库内无任何 TASK-0196
> 引用，下一顺序编号即 TASK-0196（TASK-0195 卡内"现存最大编号 0194→TASK-0195"同型先例）。
> `postTerminalTailAcceptance.exactPaths` 与任务卡 `writeAllowlist` 的 maintenance 路径、
> ci-execution-policy record `boundary.changedPaths` 三处必须原子一致（6 个冻结路径）。
> TASK-0191/0192/0193/0194/0195 历史制品（卡/context/evidence/handoff）一律 forbidden 零修改。

## 背景与用户可观察目标

TASK-0195 于 `fe0253f` 以 ACCEPTED 形成 canonical terminal closure。其后 `751cb9d`
（单父 `fe0253f`）修改了 `docs/handoffs/TASK-0195.json` 的 `nextAction` 措辞
（"终态提交后" → "终态（继承实现正式接纳完成）后"），使 handoff 与 project-state
的 `nextAction` 逐字一致。该修改发生在终态之后、无任何新任务授权、无任何一次性
机器绑定记录（对比 TASK-0098 `OWNER-MAINT-20260808-…-POST-TERMINAL-TAIL-01` 与
TASK-0189 `OWNER-MAINT-20260813-…-POST-TERMINAL-TAIL-01` 的先例模式）——是未登记的
post-terminal correction。

Owner 定性（2026-08-14）：这是治理缺陷而非合法 closure；Doctor 对 ACCEPTED/REJECTED
任务提前 `continue`（`doctor.py` 终态循环），跳过 terminal Evidence/Handoff/history
深度校验，导致该 tail 未被发现；Doctor PASS 是盲区复现证据，不是该 tail 已获授权的
证明。同时 `doctor.py:16360/16410` 对终态任务的 handoff/evidence 收集也跳过 schema
与一致性校验。本卡目标：

1. 为现存 `fe0253f→751cb9d` 建立一次性、不可复制、不可重放的精确机器绑定接纳
   （`postTerminalTailAcceptance`，DRAFT 锚 = `751cb9d`）。
2. 修复 Doctor：canonical terminal commit 之后，对任务卡、Evidence、Handoff、
   project-state、ledger 的任何新父边默认失败关闭，即使路径仍属于旧卡 writeAllowlist。
3. 仅完整匹配正式登记 terminal-tail/maintenance 记录的边可以放行
   （TASK-0098/0189/0196 三份已登记记录；不新增第二份 TASK-0196 记录）。
4. 消除 ACCEPTED/REJECTED blanket continue 造成的深度校验短路，确保终态后的 schema、
   Evidence、Handoff、nextAction 和 terminal history 仍受校验。
5. 在 canonical terminal commit 本身校验 project-state.nextAction 与 handoff.nextAction
   逐字一致。
6. 保持 TASK-0098、TASK-0189 已登记 tail 的兼容性，不全局忽略历史 tail。
7. 不弱化 authorization projection、diff-scope、protected paths、单父原子提交或历史
   不可变规则。

## 范围内

- `ci-execution-policy.yaml` 新增顶层 `task0196PostTerminalTail:` 机器记录（schema 对标
  `task0098PostTerminalTail`/`task0189PostTerminalTail`，tail 语义为 handoff nextAction
  措辞对齐修复），一次性精确绑定 `fe0253f→751cb9d`：terminal commit/tree、tail
  commit/tree/parent、单父约束、精确路径集合、逐文件 mode/type/blob/content hash、
  一次消费、消费后惰化、禁止复制/二次消费/额外路径/多父/通用 override。
- `doctor.py`：新增 TASK-0196 常量与 validator（record/boundary-candidate/boundary/
  card-contract），接入既有调用点（READY-parent、base-handoff anchor、policy 循环、
  card-contract、idle-terminal-history 放行路径、projection redact）；同步更新
  `CI_EXECUTION_POLICY_CANONICAL_HASH`。
- `doctor.py`：消除 ACCEPTED/REJECTED blanket continue（终态循环 16455-16462 与
  handoff/evidence 收集 16360/16410 的短路），使终态任务（含 ACCEPTED/REJECTED）恢复
  schema、Evidence、Handoff、nextAction 与 terminal history 深度校验；无
  `authorizationCommit` 的历史任务按既有兼容路径处理，不得伪造 PASS。
- `doctor.py`：canonical terminal commit 后任何新父边默认失败关闭——仅以下三类放行：
  (a) 精确匹配已登记一次性 post-terminal-tail record（TASK-0098/0189/0196）；
  (b) 合法 idle planning checkpoint（`derive_idle_planning_checkpoint` 既有语义）；
  (c) 已存在新任务 DRAFT/READY 的合法锚（由其他校验器处理）。未登记 tail 一律 FAIL。
- `doctor.py`：在 canonical terminal commit 快照上执行 `validate_terminal_handoff_next_action`
  （project-state.nextAction 与 handoff.nextAction 逐字一致），覆盖 ACCEPTED/REJECTED。
- `scripts/harness/tests/test_harness.py`：本卡冻结的正负测试清单（见下）全部落测试。
- `skills/task-intake/SKILL.md`、`skills/task-delivery-flow/SKILL.md`：登记 TASK-0196
  post-terminal tail 一次性记录条目（recordId、绑定字段、禁止复制/二次消费/泛化），
  并在 task-intake 中同步"终态后新父边必须登记记录"的规则声明（该声明仅叙述本卡
  修复后的机器行为，不引入第二套规则系统）。
- 终态产物：Evidence Pack + Handoff + task card + project-state + Task Ledger，ACCEPTED 闭合。

## 明确范围外

- **不改写历史**：不 amend、rebase、删除、重写 `fe0253f` 或 `751cb9d`；不修改
  TASK-0191/0192/0193/0194/0195 的任何历史制品（卡/context/evidence/handoff）。
- **不把 751cb9d 追述为普通合法 closure**：接纳仅通过一次性机器记录完成，TASK-0195
  机器状态保持 ACCEPTED。
- 不修改任何业务代码、数据库迁移、前端、CI workflow、Backlog、lifecycle 或其他受保护
  真源；不修改 `scripts/harness/` 除 `doctor.py` 与 `tests/test_harness.py` 外的任何文件。
- 不修改 `skills/harness-change/SKILL.md` 或其他 Skill（harness-change 仅为 requiredSkill）。
- 不做通用化 tail 规则（如可配置 allowlist、环境变量、CLI flag、task-id exemption、
  git note/replace/graft、分支/worktree 旁路、GitHub Actions dispatch）——一律禁止。
- 不修审计报告其余 findings（P0 owner context 等全部业务/安全项不在本卡）。
- 不创建/删除本地分支；不 push、不 merge、不 rebase、不 reset。

## 输入和前置条件

- Base Commit：`751cb9db547df2ba33d55d310276bc14e1fbd5eb`（TASK-0195 tail；唯一父
  `fe0253f`，TASK-0195 canonical terminal）。
- Context Lock：`docs/tasks/context/TASK-0196.context-lock.yaml`（fingerprint
  `76803c8d…`，34 inputs，全部来自 Base Commit 751cb9d）。
- 已核验 tail 事实：`751cb9d` 唯一父 `fe0253f`；`git diff --name-only fe0253f 751cb9d`
  恰为 `docs/handoffs/TASK-0195.json`；该文件 fe0253f 时 blob `af6f1260…`（content
  sha256 `573fe845…`）→ 751cb9d 时 blob `d00ec0df…`（content sha256 `ea23f12d…`），
  仅 `nextAction` 一行措辞变化；terminal tree `e1356cd6…`、tail tree `adfe9810…`。
- nextAction 一致性事实：`fe0253f` 处 handoff.nextAction 与 project-state.nextAction
  不一致（handoff 缺"（继承实现正式接纳完成）"措辞）——这是 tail 存在的精确理由，
  作为历史 mismatch 事实记录在记录与 Evidence，不作为校验豁免；`751cb9d` 处两者已
  逐字一致。
- 需使用 `harness-change`（C4 protected path）与 `task-intake`、`task-delivery-flow`；
  requiredSkillVersions 固定 Base 上实际存在的版本（1.1.7/1.2.7/1.3.7）。

## API / 事件 / 数据契约

- `ci-execution-policy.yaml` 新增顶层 `task0196PostTerminalTail:` record：
  `schemaVersion/recordId/decisionId/kind/targetTask/sourceThreadId/authorization/
  terminal/tail/draft/boundary/activation/consumption/validationChannel/
  forbiddenInterfaces`（对标 `task0098PostTerminalTail`）；`tail.files` 逐文件绑定
  mode/type/blob/contentSha256；`terminal` 绑定 commit/tree/taskId/state。
- `doctor.py` 的 `ci_execution_policy_projection` redact 列表新增
  `"task0196PostTerminalTail"`，并同步更新 `CI_EXECUTION_POLICY_CANONICAL_HASH`。
- 不新增/修改任何 OpenAPI、catalog、contracts、events schema。

## 权限、RLS 和数据处理要求

- 不触数据库、不触 RLS、不触任何业务数据；仅修改治理/校验代码与文档。
- `scripts/harness/doctor.py`、`scripts/harness/tests/test_harness.py`、`skills/**`、
  `.harness/**` 为 C4 protected paths（requiredSkill: harness-change，humanApproval:
  repository-owner，independentReview: required）——本卡已声明双 scope 批准。

## 状态机和失败行为

- 一次性 tail 记录消费后惰化；复制记录、二次消费、附加路径、多父、任何身份漂移、
  泛化到其他 tail 均失败关闭。
- 修复后的 Doctor 对 canonical terminal commit 之后的新父边默认失败关闭；未登记 tail
  （如未来再造的任意 post-terminal 边）必须 FAIL，不得静默放行。
- 若 `CI_EXECUTION_POLICY_CANONICAL_HASH` 计算或维护边自校验失败，按维护边校验 FAIL
  停止，不得以任何方式绕过。
- ACCEPTED/REJECTED blanket continue 消除后，历史任务的既有兼容路径（无
  authorizationCommit 轻量校验）不得被当作 PASS 伪装；任何新增校验缺口不得以
  NOT_RUN/DEFERRED 冒充 PASS。

## 模型、Prompt、记忆和安全边界

- 不涉及模型、prompt、记忆或安全模块；仅治理校验器改动。

## 一次性绑定设计（冻结）

`postTerminalTailAcceptance` 精确绑定以下字段，任一漂移即失败关闭：

| 绑定维度 | 值 |
|---|---|
| task ID | TASK-0196（`targetTask`） |
| canonical terminal commit | `fe0253fc9cfd0b3d88c11a18273c25b2a8e9274f`（TASK-0195 ACCEPTED） |
| terminal tree | `e1356cd6b521ae68d6b21f7e7f8e0b8f49dc4b71` |
| tail commit | `751cb9db547df2ba33d55d310276bc14e1fbd5eb` |
| tail tree | `adfe981041de9027b9d5b2b83697dd2500fe3c3f` |
| parent commit（单父） | `fe0253fc9cfd0b3d88c11a18273c25b2a8e9274f` |
| 精确路径集合 | `[docs/handoffs/TASK-0195.json]`（不多不少） |
| mode/type/blob/content | `100644`/`blob`/`d00ec0df…`/`ea23f12d…`（751cb9d 侧） |
| 单父约束 | `singleParentRequired: true`，tail 必须是 terminal 的直接单父子 |
| 一次消费 | `oneTimeOnly: true`，READY 授权提交后惰化，`reusable: false` |
| 禁止接口 | CLI flag/env var/git note/replace/graft/历史改写/可配置 allowlist/通配写路径/通用 override/分支或 worktree/GitHub Actions dispatch 全部 false |

Doctor 实现约束（READY 后）：
- 记录 identity/字段集合/逐字段值全部硬绑定（对标 `validate_task0098_post_terminal_tail_record` 的 exact-schema 校验）；
- live edge facts 实时从 Git 复核：`rev-list --parents` 单父、`changed_paths_between`
  精确路径、tail tree、逐文件 blob/content、tail 处 project-state.nextAction 与
  handoff.nextAction 逐字一致；
- 复制到其他任务（`copiedRecordForbidden`）与二次消费（consumed 后仍放行）必须 FAIL；
- 修复后默认失败关闭路径不得豁免 TASK-0196 自身 tail——TASK-0196 的放行必须来自其
  登记记录精确匹配，而非"因为它是 TASK-0196"。

## 正负测试清单（DRAFT 冻结，READY 后全部落 `scripts/harness/tests/test_harness.py`）

1. **唯一正例**：TASK-0196 记录精确匹配 `fe0253f→751cb9d`（单父、精确路径、mode/
   blob/content/tree 全部一致、tail nextAction 逐字一致）→ Doctor 接受
   `baseCommit=751cb9d` 锚，PASS。
2. **负例**：同卡 writeAllowlist 含 `docs/handoffs/TASK-0195.json` 但无记录匹配的
   post-terminal 修改（如改 content）→ FAIL（writeAllowlist 不构成终态后持续写授权）。
3. **负例**：错误父提交（tail.parent ≠ fe0253f）→ FAIL。
4. **负例**：commit/tree/blob/content/mode 任一漂移 → FAIL。
5. **负例**：changedPaths 附加额外路径（含恢复后再改）→ FAIL。
6. **负例**：tail 多父 → FAIL。
7. **负例**：他卡复制记录（copiedRecordForbidden；其他任务卡声明同 recordId）→ FAIL。
8. **负例**：二次消费（记录已消费后再次作为锚）→ FAIL。
9. **负例**：未登记 terminal tail（任意新造的 post-terminal 边，即使路径在旧卡
   writeAllowlist 内）→ FAIL（默认失败关闭）。
10. **正例回归**：TASK-0098（1696739→d335159）与 TASK-0189（7f9f9e3→c626005）已登记
    tail 的既有放行仍 PASS，不全局忽略历史 tail。
11. **负例**：canonical terminal commit 当下 handoff.nextAction 与 project-state.nextAction
    不一致（如构造不一致终态）→ FAIL（逐字一致校验覆盖 ACCEPTED/REJECTED）。

## 验收标准

1. 一次性绑定机器校验通过：terminal/tail commit·tree·parent·精确路径·逐文件
   mode/type/blob/content·单父·nextAction 逐字一致全部精确匹配；复制/二次消费/附加
   路径/多父/漂移全部失败关闭。
2. `doctor.py --task TASK-0196` READY Doctor 0 errors PASS（含 base-handoff 边界接受
   tail 锚 751cb9d）。
3. 负向测试证明：未登记 post-terminal 边默认失败关闭；writeAllowlist 不单独授权
   post-terminal 修改；终态 nextAction 不一致 FAIL。
4. TASK-0098/0189 既有记录回归 PASS；`doctor --summary` 无新增 error。
5. 正负测试清单 11 项全部落地并真实 PASS/FAIL（无 NOT_RUN 冒充）。
6. 历史零修改：`git diff` 不含 TASK-0191..0195 任何卡/context/evidence/handoff，
   `fe0253f`/`751cb9d` 原样保留。
7. 交付闭环：canonical Precheck PASS（doctor 0 errors）；C4 独立 Reviewer PASS；Handoff
   `nextAction` 与终态 project-state 逐字一致；不推送、不合并。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准：`PATH=… python scripts/harness/precheck.py
--task TASK-0196` 与 `git diff --check`；另在 READY 前冻结精确的定向 unittest argv
（`PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest test_harness.
<本卡新增测试类>`），每条命令记录状态、退出码、验证提交、产物哈希或无产物理由。

## 回滚或前向修复

- 若维护边校验或 Doctor 修复校验失败，按 `task-delivery-flow` 的 fail-closed 停止，
  不降级、不绕过。
- 修复边界只允许对 writeAllowlist 内文件在 `maximumFixBatches: 1` 内修订，随后重跑
  doctor/precheck；超出即停止询问 Owner。

## 停止条件

- 需要修改 writeAllowlist 外路径（含任何历史卡、Backlog、lifecycle、业务代码、
  `skills/harness-change/SKILL.md`）时立即停止询问 Owner。
- 发现记录字段与 Git 事实不符、nextAction 不一致无法解释、或需要通用化放行通道时，
  立即停止询问 Owner，不得自行扩权。
- 任何把 NOT_RUN/失败/超时转为 PASS 的行为立即停止。
- Reviewer 未通过、canonical 未 PASS 时不得进入 terminal。

## Evidence Pack

输出到 `docs/evidence/TASK-0196/`（含 `pre-ready-maintenance-authorization.json`、
`review-r1.md`），并生成 `docs/handoffs/TASK-0196.json`。
