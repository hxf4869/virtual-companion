# TASK-0072：精确自举确认与 Base snapshot 修复闭环

```yaml
taskId: TASK-0072
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.1
  task-intake: 1.2.1
  harness-change: 1.1.1
targetSkillVersions: {}
baseCommit: d83baca18211c464cebdc7082308e90b2d5d18f0
authorizationCommit: ""
contextFingerprint: e9d37c734399b2b4129970866acf8f83077f2fbce16c4a290a1de8808a72c436
contextLock: docs/tasks/context/TASK-0072.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  bootstrapAndReadyDeadlineMinutes: 50
  reviewAndTargetedMinutes: 20
  terminalValidationMinutes: 40
  bufferMinutes: 10
  hardFuseWallMinutes: 120
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: EXACT_ONE_TIME_SELF_BOOTSTRAP_RATIFICATION
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 40
  estimatedWallMinutes: 120
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 将精确 maintenance boundary、Base task-card snapshot 修复确认、
    一次性 anchor 消费和普通生命周期闭环授权为同一不可拆分 C4 交付；拆分会
    留下未消费的活动自举边界。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0072
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0072
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机没有受控 macOS exact-tree 环境；本卡不声称 macOS PASS。
  remote:
    outcome: UNKNOWN_NOT_RUN
    reasonType: OWNER_QUOTA_EVIDENCE_EXPIRED
    currentQuotaVerified: false
    dispatchCount: 0
    passClaimed: false
  localFallbackActivation:
    scope: TASK_0072_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 明确允许本卡以同一冻结 Commit/Tree 的 Windows 与 WSL 本地
      exact-tree 结果替代当前不可验证的远端 CI，但远端必须保持非 PASS。
  terminalMetadataOnly:
    requiredCommitMarker: "[skip ci]"
    implementationTreeMustRemainVerified: true
    neverRepresentsCiPass: true
readAllowlist:
  - AGENTS.md
  - .harness/**
  - docs/evidence/**
  - docs/handoffs/**
  - docs/schemas/**
  - docs/tasks/**
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0072-exact-self-bootstrap-ratification.md
  - docs/tasks/context/TASK-0072.context-lock.yaml
  - docs/evidence/TASK-0072/**
  - docs/handoffs/TASK-0072.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
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
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/**
  - docs/evidence/TASK-0070/**
  - docs/handoffs/OWNER-MAINT-20260801-READY-GREENLINE-01.json
  - docs/handoffs/TASK-0070.json
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
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
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/authorization.json
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/pre-review-evidence.json
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/review-r1.md
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/windows-receipt.json
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/windows-validation-failure.json
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/task-0072-self-bootstrap-authorization.json
  - docs/handoffs/OWNER-MAINT-20260801-READY-GREENLINE-01.json
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
  - docs/evidence/TASK-0070/evidence-pack.json
  - docs/handoffs/TASK-0070.json
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
    approvedAt: "2026-08-02"
    evidence: >-
      Owner 通过 source thread 019fb2c1-8104-73b1-81dc-ee8bcfce6f63
      精确授权 recordId OWNER-MAINT-20260801-READY-GREENLINE-01，只允许
      a737f223→9725e740→60b09ec→d83baca 单父链和 TASK-0072 自举闭环；
      禁止通用 bypass、开放式 override、产品变更和历史重写。
  - scope: task-0072-exact-self-bootstrap
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      Owner 授权记录绑定
      docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/task-0072-self-bootstrap-authorization.json
      SHA-256 28bee6151de91cbd997c808a21105bc2cfa8413d4a96278018474c4c6ff575b1，
      boundary d83baca18211c464cebdc7082308e90b2d5d18f0 / Tree
      80ae86080731e76e4f793923f70682aae8d12361 已通过 102 项精确机器约束。
  - scope: task-0072-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      Owner 要求 GitHub Actions 固定记录 UNKNOWN_NOT_RUN /
      OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0，不 dispatch、不重跑、不轮询；
      Reviewer PASS 后只运行一次 Windows 与一次 WSL exact Commit/Tree。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_backlog_registers_exact_technical_alpha_baseline scripts.harness.tests.test_harness.BacklogTests.test_base_promotion_uses_same_commit_planning_card_blob scripts.harness.tests.test_harness.BacklogTests.test_base_promotion_card_blob_failures_are_closed scripts.harness.tests.test_harness.BacklogTests.test_base_promotion_current_worktree_cannot_change_result scripts.harness.tests.test_harness.BacklogTests.test_current_backlog_validation_remains_worktree_bound_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_backlog_card_wrong_path_then_restore_stays_failed scripts.harness.tests.test_harness.BacklogTests.test_backlog_draft_cannot_bypass_pending_hard_gate scripts.harness.tests.test_harness.BacklogTests.test_backlog_draft_reconstructs_base_git_snapshot scripts.harness.tests.test_harness.BacklogTests.test_backlog_rejects_duplicate_order_and_invalid_critical_path scripts.harness.tests.test_harness.BacklogTests.test_hard_gate_requires_owner_and_each_decision_evidence scripts.harness.tests.test_harness.BacklogTests.test_backlog_rejects_dependency_order_cycle_and_card_hash_drift scripts.harness.tests.test_harness.BacklogTests.test_backlog_derives_next_task_and_hard_gate_blockers scripts.harness.tests.test_harness.BacklogTests.test_backlog_resolution_requires_reason_and_new_id_for_replacement scripts.harness.tests.test_harness.BacklogTests.test_planning_terminal_card_is_atomic_and_does_not_consume_task_ledger
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0072
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0072
```

## 背景与用户可观察目标

一次性 Base task-card snapshot 维护修复已作为未推送历史保留，但普通 DRAFT
anchor、逐父边路径和 idle terminal 规则会形成自举圆环。本卡只消费机器识别的
精确 maintenance boundary，重新产生当前任务证据，并按普通生命周期完成闭环。

## 范围内

- 验证 a737f223→9725e740→60b09ec→d83baca 的提交、Tree、父关系、路径、
  mode、blob 与内容 Hash 全部精确匹配；
- 证明边界记录缺失、多余、复制、其他任务、错误父链、路径、mode、blob、
  Hash 或重复消费均失败关闭；
- 在 READY Doctor 上确认 Base task-card snapshot 修复消除历史三项错误；
- 在 IN_PROGRESS 后重新执行本卡 14 项目标/邻接测试并产生当前证据；
- 独立 Reviewer PASS 后，以同一 reviewed Commit/Tree 各执行一次 Windows 与
  WSL canonical，并执行唯一 pre-closure 与原子终态闭包。

## 明确范围外

- 通用 break-glass、override framework、环境变量或 CLI bypass；
- 修改 workflow、durable helper、CI 全局额度语义、生命周期或 Backlog；
- 产品、服务、数据库、前端、Provider、凭据、Beta、支付、身份或 Persona；
- 改写 a737f223、9725e740、60b09ec 的历史事实或继承旧 PASS 为当前 PASS。

## 输入和前置条件

- source terminal `a737f22362185ed47e81ecabef5c17b22fb52e18` / Tree
  `e83e352a9805e84e1996115924a33686fdd79d1e`；
- retained implementation `9725e74019b7a102ff8e848beec466bac7044987` /
  Tree `cf89d92a6dc311ee99ca2d2e394df11b05c9e174`，其 14 项 PASS 仅是历史；
- maintenance handoff `60b09ec198a0c37b2345576d3cc593bfbe887bd5` /
  Tree `dceb360cbd14d9112b241e5889b0498c05df317f`，Windows Doctor exit 1、
  11 errors 保持失败事实；
- exact boundary `d83baca18211c464cebdc7082308e90b2d5d18f0` /
  Tree `80ae86080731e76e4f793923f70682aae8d12361`，唯一父为 60b09ec。

## API / 事件 / 数据契约

不修改任何业务 API、事件、数据库、Catalog 或产品协议。唯一内部合同是
TASK-0072 的一次性 boundary/DRAFT anchor 机器记录。

## 权限、RLS 和数据处理要求

只处理治理元数据、离线 Git 对象和合成测试；不访问公网、真实供应商、凭据、
真实用户数据、数据库、容器、账号或权限。

## 状态机和失败行为

执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`；任一 gate
失败则按当前合法状态以 REJECTED 闭包。DRAFT 之后恢复普通 checkpoint 与逐父边
规则；最多一批集中修复和 R2，不允许 R3。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或 Persona；不引入第二套规则、
任务、状态、Evidence 真源或 SaaS-only 运行时。

## 验收标准

- DRAFT canonical gate 真实识别精确链，原 11 errors 消失，全部负例仍失败；
- READY Doctor 真实 PASS 后才进入 IN_PROGRESS；
- 本卡 14 项当前测试、独立 Reviewer、Windows、WSL、pre-closure 全部绑定同一
  候选身份并真实 PASS；
- GitHub 保持 `UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0`；
- Task Ledger 登记后 anchor 自动 consumed/inert，任何未来任务不能复用；
- 终态 `[skip ci]`、push 后 `main == origin/main`、ahead/behind `0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。DRAFT/READY/Windows/WSL/
pre-closure 每个 checkpoint 只启动一次；长命令从启动即使用 durable atomic
receipt，同一未变快照不重复 standalone Doctor 或 canonical precheck。

## 回滚或前向修复

保持 `main`、单父前向历史；不 reset、rebase、amend、squash 或 drop。只有独立
Reviewer 指出 Base-card snapshot 范围内真实缺陷时，允许一批集中前向修复与
唯一 R2。

## 停止条件

- READY Doctor 非 PASS；
- 需要额外任务、路径、第二条自举记录、通用 bypass、workflow 或产品修改；
- Reviewer 需要 R3、第二批修复或 8 分钟总时间盒耗尽；
- hard fuse 120 分钟到达且无法只用 closure-only 动作安全结束。

## Evidence Pack

输出 `docs/evidence/TASK-0072/` 与 `docs/handoffs/TASK-0072.json`。历史 PASS、
FAIL、UNKNOWN、NOT_RUN 或 DEFERRED 永不转换为本候选 PASS。
