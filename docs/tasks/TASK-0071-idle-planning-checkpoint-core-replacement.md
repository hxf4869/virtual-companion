# TASK-0071：Idle planning checkpoint 父边核心永久恢复

```yaml
taskId: TASK-0071
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
baseCommit: f9556808dc12ad14a67cb08cb570efb0281fc172
authorizationCommit: 6f2fb4678089d4a0deb3be4896345807254ecfd4
contextFingerprint: 5073873a8d83d7657f38e52a92adae1a7e93d6404c8ef1c4aeabd5540be18116
contextLock: docs/tasks/context/TASK-0071.context-lock.yaml
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
  surfaceId: IDLE_PLANNING_CHECKPOINT_PARENT_EDGE_CORE_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - HISTORY
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 6
  terminalCheckMinutesEstimate: 58
  estimatedWallMinutes: 90
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 将唯一 parent-edge 派生器、原子边验证、错误后恢复矩阵和
    TASK-0055 到 TASK-0071 的精确依赖迁移授权为同一 C4 恢复；
    拆分会留下不可供 TASK-0056 消费的半核心。四个消费者、性能、
    路径感知 CI 与 snapshot receipt 仍严格留在后继卡。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0071
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0071
    python: 3.12.3
    bash: 5.2.21
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机没有受控 macOS exact-tree 环境；本卡不声称 macOS PASS，
      后续只能对新鲜冻结的精确 Commit/Tree 重新执行。
  remote:
    outcome: UNKNOWN_NOT_RUN
    reasonType: OWNER_QUOTA_EVIDENCE_EXPIRED
    previousResetDate: "2026-08-01"
    currentQuotaVerified: false
    dispatchCount: 0
    passClaimed: false
  localFallbackActivation:
    scope: TASK_0071_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 要求 GitHub Actions 保持 UNKNOWN_NOT_RUN、
      OWNER_QUOTA_EVIDENCE_EXPIRED、dispatch=0；只允许同一冻结
      TASK-0071 Commit/Tree 的 Windows 与 WSL 本地 exact-tree 验证，
      不得继承 TASK-0069、TASK-0072 或其他历史 PASS。
  terminalMetadataOnly:
    requiredCommitMarker: "[skip ci]"
    implementationTreeMustRemainVerified: true
    neverRepresentsCiPass: true
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - .harness/**
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/evidence/TASK-0070/**
  - docs/evidence/TASK-0072/**
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0072.json
  - docs/schemas/**
  - docs/tasks/**
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/context/TASK-0071.context-lock.yaml
  - docs/evidence/TASK-0071/**
  - docs/handoffs/TASK-0071.json
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
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/evidence/TASK-0070/**
  - docs/evidence/TASK-0072/**
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0072.json
  - docs/schemas/**
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
  - docs/tasks/TASK-0072-exact-self-bootstrap-ratification.md
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
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
  - docs/tasks/TASK-0072-exact-self-bootstrap-ratification.md
  - docs/evidence/TASK-0055/evidence-pack.json
  - docs/evidence/TASK-0069/evidence-pack.json
  - docs/evidence/TASK-0070/evidence-pack.json
  - docs/evidence/TASK-0072/evidence-pack.json
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0072.json
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
      授权 TASK-0071 只实现原 TASK-0055 的 idle planning checkpoint
      parent-edge 核心、真实 Git 正负矩阵、已知 projection fixture 修复及
      TASK-0056 精确依赖迁移；禁止四消费者、通用 bypass、workflow、
      产品、服务、数据库、前端、凭据与历史重写。
  - scope: task-0071-parent-edge-core-recovery
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      TASK-0070 的 Owner 合同将 TASK-0071 parent-edge 核心留给后继卡；
      TASK-0072 终态 machine nextAction 要求创建全新正常 TASK-0071。
      本卡以 f9556808dc12ad14a67cb08cb570efb0281fc172 为直接恢复 Base，
      仅在普通 READY Doctor PASS 后以前向单父边精确迁移 TASK-0056
      dependency TASK-0055 -> TASK-0071；TASK-0055 保持 REJECTED。
  - scope: task-0071-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      Owner 要求 GitHub 不 dispatch、不重跑、不轮询，固定记录
      UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0；
      Reviewer PASS 后只对同一 TASK-0071 Commit/Tree 各执行一次
      Windows 与 WSL exact-tree，Windows 非零即停止。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.BacklogTests.test_task0071_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_no_tail_and_serial_rejected_superseded_edges scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_optional_next_action_and_no_promotable_state scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_merge_empty_split_multiple_and_extra_paths scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_mode_contract_task_mismatch_and_restore_after_error
  - git diff --check
  - python scripts/harness/precheck.py --task TASK-0071
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0071
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0071
```

## 背景与用户可观察目标

TASK-0055 已在 READY 门禁真实失败并永久 REJECTED，TASK-0072 又因 Windows
canonical 回归真实 REJECTED；两者历史都不可重开、删除或洗白。TASK-0070 的
Owner 合同与 TASK-0072 终态 machine nextAction 共同要求由全新 TASK-0071
继续原 parent-edge 核心。本卡采用既有 TASK-0069/TASK-0070 的直接执行恢复卡
模式，不在 Backlog 新增第二个 PLANNED 条目。

用户最终可观察到：仓库存在一个只从显式 canonical terminal 后 Git parent
history 派生 idle planning checkpoint 的唯一失败关闭核心；TASK-0056 的正式
依赖精确迁移到 TASK-0071，但四个执行消费者仍未接线。

## 范围内

- 在 `scripts/harness/doctor.py` 增加唯一 checkpoint 派生函数和最小内部 helper，
  校验单父、非空、每边恰好一个 planning-only resolution、Backlog 与对应 card
  原子变化，以及可选且只修改 `project-state.nextAction`；
- 校验 Backlog、project-state 与对应 card 的 parent/child 均为 `100644 blob`，
  并从每条父边的显式 Backlog、lifecycle、card 与 project-state fixture 派生；
- 增加隔离 real-Git 正负矩阵：无尾部、合法 REJECTED/SUPERSEDED 串行边、
  无可晋级、merge、空提交、拆分、多 resolution、额外路径、mode/静态合同/
  Task 匹配腐化、restore 及错误后恢复；
- 采用 TASK-0069 的精确 planning-repair 模式，在同一授权单父候选边只把
  TASK-0056 Card 与 Backlog entry 的依赖从 TASK-0055 改为 TASK-0071；
- 修复 `test_backlog_projection_exposes_idle_order_and_repository_blockers`
  使用当前动态终态卡代替显式历史 fixture 的回归，并把它放入早期目标矩阵。

## 明确范围外

- DRAFT、Base-Handoff、idle terminal、terminal Diff Scope 四消费者的任何接线；
- 修改 `validate_draft_checkpoint`、`validate_task_base_handoff_anchors`、
  `validate_idle_terminal_history` 或 `validate_diff_scope` 的消费行为；
- 新增 TASK-0071 PLANNED Backlog entry、第二状态机、第二 Backlog 或通用 bypass；
- Git/history 性能、路径感知 CI、workflow、snapshot receipt、Evidence 复用；
- 修改 TASK-0049、TASK-0055、TASK-0069、TASK-0070、TASK-0072 历史产物；
- 产品、Provider、Persona、安全政策、身份、数据库、凭据、真实外发或 Beta。

## 输入和前置条件

- Base Commit `f9556808dc12ad14a67cb08cb570efb0281fc172`，Tree
  `ad58222046f7b18b08bb704b3b9e0595c1444a50`；fetch 后
  `main` ahead/behind `10/0`、index/worktree clean、`activeTask=null`、
  `lastAcceptedTask=TASK-0069`、`lastTerminalTask=TASK-0072`；
- TASK-0055 为 REJECTED 且未实现核心；TASK-0056 仍依赖 TASK-0055；
  TASK-0049 保持 SUPERSEDED；
- TASK-0072 Windows exact candidate `5db76f78...` 的唯一平台执行为 FAIL：
  179 tests 中 `test_backlog_projection_exposes_idle_order_and_repository_blockers`
  一项失败，WSL 未运行；该历史 FAIL 不得变成本卡 PASS；
- TASK-0069 的 planning repair 仅作为当前精确模式输入，不复用其候选、
  Reviewer、Windows、WSL 或远端结果。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增 Python 内部核心只接受
显式 `terminal_commit` 与 `target_commit`，返回完整合法尾部的精确 Commit；
任一边失败则向既有 `Audit` 追加错误并返回 `None`。它不自行选择执行任务、
改变生命周期或接线消费者。

## 权限、RLS 和数据处理要求

只读取离线 Git 对象并在临时目录创建合成仓库 fixture；不读取凭据、真实用户或
模型数据，不访问真实 Provider，不修改数据库、容器、账号、权限或仓库可见性。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`，任一真实
gate 非 PASS 则合法 `REJECTED`。READY Doctor 只运行一次且必须在实现前 PASS。
目标矩阵和 `git diff --check` 先于独立 Reviewer；Reviewer 总时间盒 6 分钟，
第 4 分钟强制收敛。最多一批集中前向修复和唯一 R2，禁止 R3。

任一非完整 SHA、非祖先、merge、空边、拆分、多 resolution、额外路径、
非 `100644 blob`、静态合同或旧 resolution 漂移、错误 Task ID/替代目标、
错误 nextAction、repository 非 idle 或中途错误后恢复都必须失败关闭，不能
返回最后一个局部合法 checkpoint。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或 Persona；不引入第二套规则、
任务、计划、状态、Evidence、Handoff 或 SaaS-only 必需运行时。

## 验收标准

1. 无尾部返回调用方给定的 canonical terminal；合法 REJECTED、SUPERSEDED 与多条严格串行边返回最后 target Commit。
2. 每条边必须单父、非空，只新增一个合法 planning resolution，并原子修改 Backlog 与精确对应 card；可选 project-state 只能真实改变 nextAction。
3. 三类文件在 parent/child 均为普通 `100644 blob`；mode corrupt/restore、静态合同/顺序/依赖/gate/amendment 漂移和错误后恢复均失败。
4. merge、空提交、resolution/card 拆分、多 resolution、额外代码/Ledger/Evidence/Handoff/新卡路径、错误 Task ID 或替代目标均失败。
5. core 只读取 Git parent history 与显式 fixture，不读取工作区当前 lifecycle/card 代替历史输入；四个消费者字节行为不改。
6. TASK-0055 保持 REJECTED、TASK-0049 保持 SUPERSEDED；TASK-0056 Card 与 Backlog dependency 在唯一 TASK-0071 授权单父边从 TASK-0055 精确迁移为 TASK-0071，任何额外值或路径失败。
7. 已知 Backlog projection 回归由显式历史 fixture 修复，目标矩阵、独立 Reviewer、candidate canonical、Windows、WSL 和 pre-closure 全部绑定本卡精确候选并真实 PASS。
8. GitHub 保持 UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0，macOS 保持 DEFERRED_NOT_CLAIMED；两者不代表 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现早期先运行 Backlog projection
回归，再运行完整六项目标矩阵；Reviewer 前只执行一次最终候选目标矩阵和一次
`git diff --check`。随后依次执行唯一 candidate canonical、Windows exact
candidate、Windows PASS 后的 WSL git-archive exact-tree 和唯一 pre-closure。

Doctor、canonical 与 pre-closure 从启动即使用同一 durable 会话，约 60 秒只
检查 receipt 是否出现，不查 PID/status/log、不重启。GitHub 不 dispatch、不重跑、
不轮询；历史 PASS/FAIL 均不是本候选结果。

## 回滚或前向修复

保持 `main`，不切分支、不建 worktree、不 reset、rebase、amend、squash 或改写
历史。最多一批集中前向修复和同一 Reviewer R2 delta；不得删测、加 skip、扩大
timeout、泛化 TASK-0071 repair、接线消费者或用历史候选替代当前候选。

## 停止条件

- READY Doctor 非 0；
- 45 分钟仍无通过目标矩阵的精确候选，或 90 分钟 hard fuse 到达；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- 必须扩大 allowlist、接线四消费者、修改 workflow/durable helper/产品，或
  candidate、Context、Skill、Reviewer、receipt 身份无法精确绑定。

hard fuse 后停止实现、修复、Reviewer、canonical 与平台验证；若仓库 active 或
半闭环，只允许 Evidence/Handoff、一次 pre-closure、terminal commit、push 与
远端 `0/0` 的 closure-only overrun，期间禁止实现。

## Evidence Pack

输出 `docs/evidence/TASK-0071/` 和 `docs/handoffs/TASK-0071.json`。PASS 只绑定
实际执行与精确 Commit/Tree；FAIL、CANCELLED、TIMEOUT、NOT_RUN、UNKNOWN、
DEFERRED_NOT_CLAIMED 永不转换为 PASS。
