# TASK-0055：Idle planning checkpoint 核心父边校验永久后继

```yaml
taskId: TASK-0055
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.0
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ea273f129aa1d46f30d21ebd0ed0626066086ef009b9c4496f30389b3fa01e74
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: c904d65783f0854e482dcf77f59d0f5066410845
authorizationCommit: ""
contextFingerprint: 4cf6a616da896d26bf54c46bdc40f65f6eee71a67ca37b5016208ef375222a7f
contextLock: docs/tasks/context/TASK-0055.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: IDLE_PLANNING_CHECKPOINT_PARENT_EDGE_CORE
  policySurfaces:
    - GOVERNANCE
    - HISTORY
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 58
  estimatedWallMinutes: 90
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 明确要求本卡建立唯一 parent-edge 派生核心并覆盖同一错误后恢复历史；
    把派生器、原子边验证或负例矩阵拆开会留下不能失败关闭、也不能供 TASK-0056
    消费的半卡。四消费者、性能、CI 策略和 snapshot receipt 仍严格留在后继卡。
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
  candidateBinding:
    commitAndTreeRequired: true
    cleanWorktreeAndIndexRequired: true
    rerunAfterInputChange: true
  windows:
    requiredOutcome: PASS
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0055
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0055
    python: 3.12.3
    bash: 5.2.21
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机没有受控 macOS exact-tree 环境；本卡不声称 macOS PASS，后续如获授权
      必须对新鲜冻结的同一 Commit/Tree 和命令重新执行。
  remote:
    outcome: UNKNOWN_NOT_RUN
    reasonType: OWNER_QUOTA_EVIDENCE_EXPIRED
    previousResetDate: "2026-08-01"
    currentQuotaVerified: false
    dispatchCount: 0
    passClaimed: false
  localFallbackActivation:
    scope: TASK_0055_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 在本卡委派中明确要求当前额度不可验证时保持 UNKNOWN_NOT_RUN、
      dispatch=0，并对 TASK-0055 精确 Commit/Tree 使用本地 Windows/WSL fallback；
      不得复用 TASK-0069 PASS 或把该授权泛化到其他任务。
  terminalMetadataOnly:
    requiredCommitMarker: "[skip ci]"
    implementationTreeMustRemainVerified: true
    neverRepresentsCiPass: true
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/evidence/TASK-0048/**
  - docs/evidence/TASK-0060/review-r2.md
  - docs/evidence/TASK-0069/**
  - docs/handoffs/TASK-0048.json
  - docs/handoffs/TASK-0069.json
  - docs/schemas/**
  - docs/tasks/TASK-0043-idle-planning-checkpoint-core.md
  - docs/tasks/TASK-0048-machine-delivery-policy-final-replacement.md
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/context/TASK-0055.context-lock.yaml
  - docs/evidence/TASK-0055/**
  - docs/handoffs/TASK-0055.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
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
  - docs/evidence/TASK-0048/**
  - docs/evidence/TASK-0060/**
  - docs/evidence/TASK-0069/**
  - docs/handoffs/TASK-0048.json
  - docs/handoffs/TASK-0060.json
  - docs/handoffs/TASK-0069.json
  - docs/schemas/**
  - docs/tasks/TASK-0043-idle-planning-checkpoint-core.md
  - docs/tasks/TASK-0048-machine-delivery-policy-final-replacement.md
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - skills/**
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - .gitattributes
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
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0048-machine-delivery-policy-final-replacement.md
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/evidence/TASK-0048/evidence-pack.json
  - docs/evidence/TASK-0060/review-r2.md
  - docs/evidence/TASK-0069/evidence-pack.json
  - docs/handoffs/TASK-0048.json
  - docs/handoffs/TASK-0069.json
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
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-01"
    evidence: >-
      Owner 明确授权 TASK-0055 只修改 Doctor、Harness tests 与本卡治理产物，
      建立 idle planning checkpoint 唯一 parent-edge 核心；四消费者、性能、
      workflow、snapshot receipt、产品、Provider、凭据、数据库、身份和 Beta 均禁止。
  - scope: task-0055-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-01"
    evidence: >-
      Owner 明确要求不刷新或扩大 gh 权限、不触发 workflow，并保持 GitHub
      UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0；只对本卡冻结
      Commit/Tree 执行 Windows 与 WSL 本地验证，历史 TASK-0069 PASS 不得复用。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_no_tail_and_serial_rejected_superseded_edges scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_optional_next_action_and_no_promotable_state scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_merge_empty_split_multiple_and_extra_paths scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_mode_contract_task_mismatch_and_restore_after_error
  - git diff --check
  - python scripts/harness/precheck.py --task TASK-0055
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0055
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0055
```

## 背景与用户可观察目标

TASK-0048 已真实 REJECTED，TASK-0049 因依赖阻断保持 SUPERSEDED；TASK-0069
已在当前 Base 真实 ACCEPTED 并把执行前沿重接到本卡。本卡只交付一个可复用的
idle planning checkpoint 核心：从调用方提供的 canonical execution terminal
开始，逐条验证其后的 Git parent history，并在完整串行尾部全部合法时返回唯一
checkpoint；任一边失败时返回失败，不接入任何执行消费者。

## 范围内

- 在 `scripts/harness/doctor.py` 增加唯一 checkpoint 派生函数及最小内部 helper：
  单父、非空、每边恰好一个 planning-only resolution、Backlog 与对应 card 原子
  改动、可选且只改 `project-state.nextAction`、三类文件 parent/child 均为
  `100644 blob`；
- 从每条 Git parent edge 的显式 Backlog、lifecycle、card 与 project-state
  fixture 派生，精确匹配 resolution Task ID、规划终态、替代任务和下一可晋级项；
- 在 `scripts/harness/tests/test_harness.py` 增加隔离 real-Git 正负矩阵，覆盖
  无尾部、REJECTED/SUPERSEDED 串行边、无可晋级、merge、空提交、拆分、
  多 resolution、额外路径、mode/静态合同/任务匹配腐化及恢复后仍失败关闭；
- 保留现有 activation snapshot 特例：只有真实 parent snapshot 才比较不可变
  Backlog root，不能重现 TASK-0060 R2 的 synthetic activation 误报。

## 明确范围外

- DRAFT、Base-Handoff、idle terminal、terminal Diff Scope 四消费者的任何接线；
- 修改 `validate_draft_checkpoint`、`validate_task_base_handoff_anchors`、
  `validate_idle_terminal_history`、`validate_selected_task_diff_scope` 的调用行为；
- real-Git baseline fixture 修复、Git/history 性能、路径感知 CI、workflow、
  snapshot receipt、Evidence 复用或第二套状态机/Backlog；
- 修改 TASK-0048/0049/0056～0059/0060/0069 历史产物，或把历史 PASS/FAIL
  当作本候选验证结果；
- 产品、Provider、Persona、安全政策、身份、数据库、凭据、真实外发或 Beta。

## 输入和前置条件

- Base Commit `c904d65783f0854e482dcf77f59d0f5066410845`，Tree
  `900865deaf2150ee20d9da87e5dc8661fd3c5ed7`；fetch 后
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean；
- Base `activeTask=null`，`lastAcceptedTask/lastTerminalTask=TASK-0069`，
  TASK-0069 为 ACCEPTED，Backlog frontier 与 nextPromotable 均为 TASK-0055，
  无 Owner decision gate；
- Base Doctor summary 只作为开工真源自证：inner exit 0、262,941 checks，
  receipt SHA-256
  `929e04544a6f9d488e478707ecc3ed648e0fb3fa458ba2e06d3dbe3029eba7d3`；
  它不代表本实现候选 PASS；
- TASK-0048/0049 历史只固定阻断与替代语义；TASK-0060 R2 只提供 activation
  根字段误报风险；TASK-0069 Evidence/Handoff 只证明前置依赖与本地 transport，
  均不得复用为本卡 Reviewer、canonical 或平台 PASS。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增 Python 内部核心只接受
显式 `terminal_commit` 与 `target_commit`，返回完整合法尾部的精确 Commit，
否则向既有 `Audit` 追加错误并返回 `None`；它不自行选择执行任务或改变生命周期。

## 权限、RLS 和数据处理要求

只读取离线 Git 对象并在临时目录创建合成仓库 fixture；不读取凭据、真实用户或
模型数据，不访问真实 Provider，不修改数据库、容器、账号、仓库权限或可见性。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 或
`REJECTED`。实现期只运行冻结的四项定向矩阵；候选冻结后由无历史上下文独立
Reviewer 做完整 R1。只有 P0/P1 才触发最多一批集中修复和同 Reviewer R2；
R2 新结构性 P0/P1、需要 R3/第二批修复、身份变化或边界不明时安全终止。

任一非完整 SHA、非祖先、merge、空边、拆分、多 resolution、额外路径、非
`100644 blob`、静态合同/旧 resolution 漂移、card/resolution 不匹配、
错误 nextAction、仓库非 idle、terminal pointer 变化或中途错误后恢复都必须
保持失败；不得返回最后一个“看起来合法”的局部 checkpoint。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或业务能力；不引入
第二套规则、任务、计划、状态、Evidence、Handoff 或 SaaS-only 必需运行时。

## 验收标准

- 无尾部时返回调用方提供的 canonical terminal；合法 REJECTED、SUPERSEDED
  与多条严格串行边返回最后一个 target Commit；
- 每条边必须单父、非空，只新增一个合法 planning resolution，并原子修改
  `.harness/task-backlog.yaml` 与精确对应 card；可选 project-state 只能真实
  改变 `nextAction`，无可晋级时使用确定性暂停值；
- Backlog、project-state 与对应 card 在 parent/child 均为普通 `100644 blob`，
  mode corrupt/restore、静态合同/顺序/依赖/gate/amendment 漂移、错误后恢复
  均失败；
- merge、空提交、resolution/card 拆分、多 resolution、额外代码/Ledger/
  Evidence/Handoff/新 card 路径、错误 Task ID 或替代目标均失败；
- core 只读取 Git parent history 与显式 fixture，不读取工作区当前 lifecycle/card
  代替历史输入；现有 activation snapshot 特例与 real-parent root immutability
  都保持通过；
- 四个消费者字节行为不改，TASK-0049 保持 SUPERSEDED；定向矩阵、R1、
  candidate canonical、冻结 Windows/WSL exact-tree 与 pre-closure 均绑定本卡
  当前候选，非 PASS 状态不提升为 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。Reviewer 前只执行一次冻结四项定向
矩阵和一次 `git diff --check`；Reviewer 后按顺序执行一次 candidate canonical、
一次 Windows 与一次 WSL 冻结 profile。Doctor/canonical/pre-closure 从启动即
使用同一 durable 会话，约 60 秒只检查 receipt 是否出现，不查 PID/status/log、
不重启；相同输入的真实结果只复用 receipt，不重复执行。

GitHub Actions 保持 `UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED /
dispatch=0`，macOS 保持 `DEFERRED_NOT_CLAIMED`；两者不代表 PASS。终态提交只走
`TERMINAL_METADATA_ONLY` 并带 `[skip ci]`，不触发 workflow。

## 回滚或前向修复

保持 `main`，不切分支、不建 worktree、不改写历史。最多一批集中前向修复和
同一 Reviewer R2 delta；不得删测、加 skip、扩大 timeout、修改 policy/workflow、
接线消费者或用历史候选替换当前实现。

## 停止条件

- 45 分钟仍无通过冻结定向矩阵的精确 candidate Commit/Tree；
- 90 分钟 hard fuse 到达：停止实现、修复、Reviewer、canonical 与平台验证；
  若仓库 active 或半闭环，只允许 Evidence/Handoff、一次 pre-closure、terminal
  commit、push 与远端 `0/0` 的 closure-only overrun，期间禁止实现；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- 必须扩大 allowlist、修改 CI policy/workflow/四消费者/产品，或 candidate、
  Context、Skill、Reviewer、receipt 身份无法精确绑定。

## Evidence Pack

输出 `docs/evidence/TASK-0055/` 和 `docs/handoffs/TASK-0055.json`。PASS
只绑定实际执行与精确 Commit/Tree；FAIL、CANCELLED、TIMEOUT、NOT_RUN、
UNKNOWN、DEFERRED_NOT_CLAIMED 永不转换为 PASS。
