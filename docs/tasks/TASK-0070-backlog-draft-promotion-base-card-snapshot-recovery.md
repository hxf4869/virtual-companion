# TASK-0070：Backlog DRAFT promotion Base card snapshot 恢复

```yaml
taskId: TASK-0070
state: READY
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
baseCommit: e8fa6dfa2f7b724d4b84e31fc7690da1776bd64a
authorizationCommit: 69bbaa54c2d20419f7be3dca0b702cd4e406b832
contextFingerprint: c47e72707a7d63a2a1143a0bb338e79ef347f1da8e2cc9fa6cc99d59f370bb47
contextLock: docs/tasks/context/TASK-0070.context-lock.yaml
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
  surfaceId: BACKLOG_DRAFT_PROMOTION_BASE_CARD_SNAPSHOT_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 35
  estimatedWallMinutes: 60
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 将 Base task-card blob 一致性修复、TASK-0055 的永久后继预留及
    TASK-0056 frontier 原子改接授权为单一 C4 恢复边；拆分会留下仍不可晋级的
    半修复历史。TASK-0071 parent-edge 核心与四个消费者仍严格留在后继卡。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0070
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0070
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
    billingProbeStatus: HTTP_404_UNVERIFIABLE
    currentQuotaVerified: false
    dispatchCount: 0
    passClaimed: false
  localFallbackActivation:
    scope: TASK_0070_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 在本卡委派中明确要求 GitHub 保持 UNKNOWN_NOT_RUN、
      OWNER_QUOTA_EVIDENCE_EXPIRED、dispatch=0，只对 TASK-0070 冻结
      Commit/Tree 执行 Windows 与 WSL 本地 exact-tree，不得泛化或复用历史 PASS。
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
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/schemas/**
  - docs/tasks/**
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
  - docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/context/TASK-0070.context-lock.yaml
  - docs/evidence/TASK-0070/**
  - docs/handoffs/TASK-0070.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/schemas/**
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
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
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/evidence/TASK-0055/evidence-pack.json
  - docs/evidence/TASK-0069/evidence-pack.json
  - docs/handoffs/TASK-0055.json
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
      Owner 明确授权 TASK-0070 在 Base
      e8fa6dfa2f7b724d4b84e31fc7690da1776bd64a 上只修复
      validate_backlog_draft_promotion_at_base 到 validate_task_backlog_data
      的历史 task-card blob 消费路径，绑定 TASK-0055 READY Doctor receipt
      6d598ed05f100fda8ea89a2116cd224039d3177a5708390dbb4b32c191a33ced、
      TASK-0070、TASK-0071 与 TASK-0056；禁止任意 commit、任意卡或当前工作区回退。
  - scope: task-0070-direct-draft-base-snapshot-recovery
    approvedBy: repository-owner
    approvedAt: "2026-08-01"
    evidence: >-
      Owner 明确授权 TASK-0070 作为一次性 direct DRAFT 恢复卡；其 DRAFT/READY
      自举不依赖待修复的 PLANNED→DRAFT consumer，也不重开 TASK-0055。
      只允许在候选单父边永久预留 TASK-0071，并原子改接 TASK-0056 frontier。
  - scope: task-0070-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-01"
    evidence: >-
      Owner 明确要求不刷新或扩大 gh 权限、不触发 workflow，GitHub 保持
      UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0；只对
      TASK-0070 最终 clean Commit/Tree 各执行一次 Windows 与 WSL 本地验证。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_base_promotion_uses_same_commit_planning_card_blob scripts.harness.tests.test_harness.BacklogTests.test_base_promotion_card_blob_failures_are_closed scripts.harness.tests.test_harness.BacklogTests.test_base_promotion_current_worktree_cannot_change_result scripts.harness.tests.test_harness.BacklogTests.test_task0070_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_draft_cannot_bypass_pending_hard_gate scripts.harness.tests.test_harness.BacklogTests.test_backlog_draft_reconstructs_base_git_snapshot scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_task0070_remote_unknown_local_recovery_is_exact_and_fail_closed scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0070
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0070
```

## 背景与用户可观察目标

TASK-0055 在 READY 授权绑定提交上以三个 planning rendering 错误真实失败。
Base promotion 重建使用了 Base Backlog 与 PLANNED metadata，却让 rendering
校验读取当前 READY 动态卡。本卡只恢复同一历史 snapshot 的一致性，并为原核心
分配新的永久 TASK-0071；不实现 parent-edge 核心或四个消费者。

## 范围内

- 让 DRAFT promotion Base 重建显式读取同一 Base Commit 中 Backlog 每个
  taskCard path 的 Git blob，并以 path-bound 文本交给 planning rendering 校验；
- Base blob 缺失、非 `100644 blob`、UTF-8/YAML 损坏、错误 taskId/path、
  notice 或静态合同漂移时失败，且提供历史 snapshot 后绝不回退当前工作区；
- 精确复现 TASK-0055 的 Base PLANNED 六节卡与当前 READY 动态卡组合，并证明
  修复后合法；保留 DRAFT order/dependency/gate authorization 的全部门禁；
- 在单一授权 parent edge 新增 TASK-0071 PLANNED，静态合同等价承接
  TASK-0055 原合同，依赖 ACCEPTED TASK-0070；同步把 TASK-0056 dependency、
  planning hash/rendering、executionOrder/frontier 与交付策略指针改接 0071；
- 新增只绑定本卡 Base、Owner 授权、TASK-0055 失败 receipt、0070/0071/0056
  和上述唯一消费路径的 one-time recovery；其他卡与其他历史边仍失败关闭。

## 明确范围外

- 实现 TASK-0055/TASK-0071 的 idle checkpoint parent-edge 核心；
- 修改或接线 DRAFT、Base-Handoff、idle terminal、terminal Diff Scope 四消费者；
- 修改 workflow、durable helper、通用远端调度/额度状态机、产品或业务代码；
- 重开、改写历史状态或把 TASK-0055/0069 的 PASS/FAIL 作为本候选 PASS；
- Provider、Persona、安全政策、身份、数据库、凭据、真实外发或 Beta。

## 输入和前置条件

- Base Commit `e8fa6dfa2f7b724d4b84e31fc7690da1776bd64a`，Tree
  `7d30f9a4ec094fe2a6f5fc6e926d7d50f00672a4`；fetch 后
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean、
  `activeTask=null`、`lastAcceptedTask=TASK-0069`、`lastTerminalTask=TASK-0055`；
- TASK-0055 READY authority `ee33ce6220104b5402223eca35108ca9deebc857`，
  READY Doctor inner exit 1、271800 checks、receipt
  `6d598ed05f100fda8ea89a2116cd224039d3177a5708390dbb4b32c191a33ced`；
- 本次 Base summary inner exit 1、277325 checks、同三项错误，receipt
  `60d65dcdce1b0ec5ccb4572df6e8d0d0ddce8dd486ace8ab79b57e08a235b7ca`；
- DRAFT 前 durable transport smoke inner exit 7、receipt
  `fd90ab2b206c35927746282d8051b2f35320252df1d5fc73c6806d3fdde6593c`；
  summary、smoke 与 TASK-0055/TASK-0069 历史均不是本实现候选 PASS。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。内部验证器只增加显式
Base card-text snapshot 输入；提供该输入时，缺失 path 必须失败且禁止读取工作区。

## 权限、RLS 和数据处理要求

只处理治理元数据、离线 Git 对象和合成 real-Git fixture；不读取凭据、真实用户
或模型数据，不访问真实 Provider，不修改数据库、容器、账号、权限或仓库可见性。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 或
`REJECTED`。候选前只运行一次冻结 targeted matrix 与一次 diff check；R1 无
P0/P1 后执行一次 Windows、一次 WSL。最多一批集中修复和同 Reviewer R2，
R2 出现新结构性 P0/P1 或需要 R3 时安全 REJECTED。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或业务能力；不引入
第二套规则、任务、计划、状态、Evidence、Handoff 或 SaaS-only 必需运行时。

## 验收标准

- Base PLANNED 六节卡与当前 READY 动态卡同时存在时，Base promotion 只验证
  Base blob 并通过；当前工作树内容任意不同都不能改变 Base 结果；
- Base blob 缺失、非 100644、损坏、错误 Task ID/path、notice 或静态合同漂移
  全部失败，且错误后恢复历史仍由既有 append-only 门禁拒绝；
- TASK-0055 三项 READY 错误的精确复现转为通过；合法 DRAFT→READY order、
  dependency、repository-idle 与 hard-gate projection 不被削弱，其他卡仍失败；
- TASK-0071 以唯一新永久 ID、六节 PLANNED card 和 Hash-bound Backlog 合同
  承接 TASK-0055；TASK-0055 保持 REJECTED，TASK-0056 与 frontier 原子改接
  TASK-0071，TASK-0013 继续等待；
- 同一最终 Candidate Commit/Tree 上 targeted、diff、独立 Reviewer、Windows
  与 WSL 全部真实 PASS；GitHub 与 macOS 非 PASS 状态保持诚实；
- Evidence/Handoff、唯一 pre-closure、terminal `[skip ci]`、push、
  `main == origin/main`、ahead/behind `0/0` 与 clean 全部真实闭环。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。targeted matrix 与 diff check 各只
执行一次；Windows、WSL 与 pre-closure 也各只启动一次。长命令从启动即使用同一
durable 会话，约 60 秒只检查 receipt 是否出现，发布后一次性读取 receipt 与
完整输出；不查 PID/status/log，不重启，不重复 canonical 子命令。

## 回滚或前向修复

保持 `main`，不切分支、不建 worktree、不改写历史。最多一批集中前向修复和
同一 Reviewer R2 delta；不得删测、加 skip、扩大 timeout、泛化例外、回退
工作区读取或用历史候选替换当前实现。

## 停止条件

- 自 DRAFT 前 transport smoke 起 45 分钟仍无通过冻结 targeted matrix 的精确候选；
- 90 分钟 hard fuse 到达：停止实现、修复、Reviewer、canonical 与平台验证；
  若仓库 active 或半闭环，只允许 Evidence/Handoff、一次 pre-closure、
  terminal commit、push 与 remote `0/0` 的 closure-only overrun；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- 必须扩大 allowlist、修改 workflow/durable helper/四消费者/产品，或
  candidate、Context、Skill、Reviewer、receipt 身份无法精确绑定。

## Evidence Pack

输出 `docs/evidence/TASK-0070/` 和 `docs/handoffs/TASK-0070.json`。PASS
只绑定实际执行与精确 Commit/Tree；FAIL、CANCELLED、TIMEOUT、NOT_RUN、
UNKNOWN、DEFERRED_NOT_CLAIMED 永不转换为 PASS。
