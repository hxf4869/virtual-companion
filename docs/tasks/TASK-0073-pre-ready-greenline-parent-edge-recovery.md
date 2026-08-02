# TASK-0073：pre-READY 绿线与 parent-edge 核心前向恢复

```yaml
taskId: TASK-0073
state: IN_PROGRESS
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
targetSkillVersions:
  task-delivery-flow: 1.3.2
  task-intake: 1.2.2
  harness-change: 1.1.2
baseCommit: ee0757a8749a0ccab53553785b92abb865e4373b
authorizationCommit: 595e5a47903336fc74133e482e89c2291ddfa63e
contextFingerprint: 6c11c7530ee0c0012eaebf48a09ce785febdcc7b074fb45548736e94058feb27
contextLock: docs/tasks/context/TASK-0073.context-lock.yaml
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
  surfaceId: TASK_0073_EXACT_PRE_READY_GREENLINE_AND_PARENT_EDGE_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 8
  terminalCheckMinutesEstimate: 60
  estimatedWallMinutes: 90
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 只授权一条以 ee0757a 为 Base 的精确原子恢复链；唯一 pre-READY
    maintenance 必须先恢复普通 READY Doctor，随后同卡才能把已保留的
    parent-edge 核心依赖从失败的 TASK-0071 前向迁移到 TASK-0073。
    拆分会留下无法通过普通 READY 门禁或无法释放 TASK-0056 的半卡。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0073
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0073
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
    scope: TASK_0073_ONLY
    ownerAuthorized: true
    remoteStatusMustRemainNonPass: true
    globalUnknownQuotaBehaviorUnchanged: true
    evidence: >-
      Owner 只允许本卡使用 READY 冻结的 Windows 与 Ubuntu-24.04 WSL
      exact-tree profile；不得 dispatch、重跑或轮询 GitHub Actions，
      远端固定保持 UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED /
      dispatch=0 / passClaimed=false。
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
  - docs/evidence/TASK-0071/**
  - docs/evidence/TASK-0072/**
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0071.json
  - docs/handoffs/TASK-0072.json
  - docs/schemas/**
  - docs/tasks/**
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0073-pre-ready-greenline-parent-edge-recovery.md
  - docs/tasks/context/TASK-0073.context-lock.yaml
  - docs/evidence/TASK-0073/**
  - docs/handoffs/TASK-0073.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
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
  - .harness/sources-of-truth.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/evidence/OWNER-MAINT-20260801-READY-GREENLINE-01/**
  - docs/evidence/TASK-0055/**
  - docs/evidence/TASK-0069/**
  - docs/evidence/TASK-0070/**
  - docs/evidence/TASK-0071/**
  - docs/evidence/TASK-0072/**
  - docs/handoffs/OWNER-MAINT-20260801-READY-GREENLINE-01.json
  - docs/handoffs/TASK-0055.json
  - docs/handoffs/TASK-0069.json
  - docs/handoffs/TASK-0070.json
  - docs/handoffs/TASK-0071.json
  - docs/handoffs/TASK-0072.json
  - docs/schemas/**
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/TASK-0070-backlog-draft-promotion-base-card-snapshot-recovery.md
  - docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md
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
  - skills/catalog-change/**
  - skills/contract-change/**
  - skills/database-migration/**
  - skills/memory-change/**
  - skills/model-routing-change/**
  - skills/safety-change/**
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
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0071-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0072-exact-self-bootstrap-ratification.md
  - docs/evidence/TASK-0071/evidence-pack.json
  - docs/evidence/TASK-0072/evidence-pack.json
  - docs/handoffs/TASK-0071.json
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
      来源协调线程 019fb2c1-8104-73b1-81dc-ee8bcfce6f63：
      “授权 TASK-0073 精确一次性 pre-READY 绿线恢复：以
      ee0757a8749a0ccab53553785b92abb865e4373b 为 Base，允许唯一
      machine-recognized maintenance commit 修复上述策略哈希和 TASK-0072
      历史 boundary 绑定；禁止通用 override、复用或绕过。之后必须由普通
      READY Doctor PASS 才能实现，并完整执行独立 Reviewer、canonical、
      Windows/WSL、pre-closure 与安全推送。”
  - scope: task-0073-exact-pre-ready-maintenance
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      精确授权只允许 DRAFT 之后一个直接单父 maintenance commit，绑定
      ee0757a Base、TASK-0073 DRAFT parent、唯一变更路径及逐文件
      mode/type/blob/content；禁止第二条记录、第二次消费、其他 Task、
      环境变量、CLI flag、Git note/replace/graft、可配置 allowlist、
      通用 override、额外路径/提交或历史改写。
  - scope: task-0073-parent-edge-forward-recovery
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      普通 READY Doctor 真实 PASS 后，保留当前 Base 已有的 TASK-0071
      parent-edge core 并重新验证，只把 TASK-0056 Card/Backlog dependency
      与 delivery-policy followUpTasks core 从失败的 TASK-0071 精确迁移到
      TASK-0073；TASK-0055、TASK-0071、TASK-0072 保持历史 REJECTED。
  - scope: task-0073-local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-02"
    evidence: >-
      GitHub Actions 固定 UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED /
      dispatch=0 / passClaimed=false；Reviewer PASS 后只对同一冻结
      TASK-0073 Commit/Tree 各运行一次 Windows 与 WSL exact-tree，
      Windows 非零则 WSL 不启动。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.Task0073PreReadyMaintenanceTests.test_exact_machine_record_is_accepted scripts.harness.tests.test_harness.Task0073PreReadyMaintenanceTests.test_machine_record_mutations_fail_closed scripts.harness.tests.test_harness.Task0073PreReadyMaintenanceTests.test_boundary_requires_exact_single_parent_and_paths scripts.harness.tests.test_harness.Task0073PreReadyMaintenanceTests.test_consumed_record_is_inert_and_not_reusable scripts.harness.tests.test_harness.Task0073PreReadyMaintenanceTests.test_task0072_historical_doctor_binding_allows_current_evolution scripts.harness.tests.test_harness.Task0073PreReadyMaintenanceTests.test_task0072_historical_doctor_binding_fails_closed scripts.harness.tests.test_harness.BacklogTests.test_task0073_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_no_tail_and_serial_rejected_superseded_edges scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_optional_next_action_and_no_promotable_state scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_merge_empty_split_multiple_and_extra_paths scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_mode_contract_task_mismatch_and_restore_after_error
  - git diff --check
  - python scripts/harness/precheck.py --task TASK-0073
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0073
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0073
```

## 背景与用户可观察目标

TASK-0071 已保留 parent-edge 核心实现、6/6 目标矩阵与 R2 PASS 的历史证据，
但其候选 canonical 因两个全局机械绑定错误真实失败并永久 REJECTED；这些历史
结果都不是本卡当前 PASS。当前 Base 已包含该核心，同时 TASK-0056 仍依赖失败的
TASK-0071。

用户最终可观察到：唯一 TASK-0073 pre-READY maintenance 先精确修复 policy
canonical hash 与 TASK-0072 历史 Doctor boundary 绑定，普通 READY Doctor
真实 PASS 后再以前向单父边把 TASK-0056 依赖和 delivery policy core 指针迁移到
TASK-0073；核心重新通过当前矩阵，历史失败不被洗白。

## 范围内

- DRAFT 后唯一直接单父 maintenance commit：增加 TASK-0073 专用、一次性、
  消费后惰性的机器记录及精确 Owner 授权证据，绑定 Base、DRAFT parent、
  唯一 boundary、路径、mode/type/blob/content 与禁止接口；
- 把 `TASK_DELIVERY_POLICY_CANONICAL_HASH` 修正为当前 policy 的 canonical
  JSON，并同步后续 TASK-0073 dependency/follow-up 迁移产生的新 canonical 绑定；
- TASK-0072 已消费记录只从历史 boundary `d83baca...` 读取 Doctor blob
  `6c934cc...` / SHA-256 `8cb547e1...`，允许当前 Doctor 合法演进，同时错误
  commit/blob/hash、篡改历史或 copied record 全部失败关闭；
- 保留并重新验证当前 Base 已有的 parent-edge core，不继承 TASK-0071 PASS；
- 在普通 READY Doctor PASS 后，以既有 planning-repair 模式把 TASK-0056 Card
  和 Backlog dependency 从 TASK-0071 原子迁移为 TASK-0073，并把 delivery
  policy `idlePlanningCheckpointCore` 精确指向 TASK-0073；
- 增加廉价自绑定门禁、目标/邻接测试、独立 Reviewer、唯一 canonical、
  Windows/WSL exact-tree、唯一 pre-closure 与原子终态证据。

## 明确范围外

- 通用 break-glass、override framework、环境变量、CLI bypass、Git note、
  replace、graft、历史重写、可配置 allowlist、第二条记录或第二次消费；
- 修改 TASK-0055、TASK-0071、TASK-0072 的历史卡、Evidence、Handoff 或 Ledger
  事实，或把任何旧 PASS/FAIL/UNKNOWN/NOT_RUN 当作本卡结果；
- 接线 DRAFT、Base-Handoff、idle terminal、terminal Diff Scope 四消费者；
- Harness 性能引擎、workflow、路径感知 CI、snapshot receipt 或远端 dispatch；
- 产品、Provider、Persona、安全政策、身份、数据库、H5、凭据、真实外发、
  支付或 Beta。

## 输入和前置条件

- Base Commit `ee0757a8749a0ccab53553785b92abb865e4373b` / Tree
  `880fac1735d4f33a99269c3eded1b52e88812b7c`；`main`、单工作树、clean，
  `origin/main=a737f223...`，创建前 ahead/behind `17/0`；
- `activeTask=null`、`lastTerminalTask=TASK-0071`、TASK-0073 未占用；
- TASK-0071 retained candidate `834353846a2e505d1b6d8b7daffd120ccac822b6`
  / Tree `0d9f1627ad2458149b05be2e9217ed705238025d` 只作为历史实现输入；
- current task-delivery-policy canonical JSON
  `b1091d59b30918ce22c2dfa910884c7fe63827386171e579c7679d0bb62d1e3a`；
- TASK-0072 boundary `d83baca18211c464cebdc7082308e90b2d5d18f0`
  中 Doctor blob `6c934cc3006f6135ba4ad6584c3689aac3b5d6b6` /
  SHA-256 `8cb547e12d73b266071a56586ad9b9e73a3e977907d457414815373032cfb8c1`；
- Owner 精确授权文本 SHA-256
  `ce29bbebec0eda3a7bd1d89f310f3e52e250b72a034a25213be815a9d1e8c8b6`。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。唯一新增合同是
TASK-0073 精确 pre-READY maintenance record/boundary 与其一次性消费语义；
parent-edge 核心的 Python 内部输入输出和四消费者字节行为保持不变。

## 权限、RLS 和数据处理要求

只读取离线 Git 对象并使用合成 fixture；不读取凭据、真实用户或模型数据，
不访问真实 Provider，不修改数据库、容器、账号、权限或仓库可见性。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`；maintenance
是 DRAFT 后、READY 前唯一机器识别的直接单父边，不是新状态。maintenance 后
必须建立普通 READY 授权和 `authorizationCommit` 绑定；READY Doctor 真实
exit 0 前禁止 IN_PROGRESS。任一非零、UNKNOWN 或 receipt 丢失均硬停并以
REJECTED 诚实闭包。

目标矩阵和 `git diff --check` 先于独立 Reviewer。R1 覆盖完整矩阵；最多一批
集中前向修复和唯一 R2 delta，禁止 R3。45 分钟无候选、60 分钟目标预算或
90 分钟 hard fuse 到达时，按策略停止并只允许 closure-only 动作。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或 Persona；不引入第二套规则、
任务、状态、Evidence、Handoff 或 SaaS-only 必需运行时。

## 验收标准

1. TASK-0073 record 只接受精确 Base、DRAFT parent、唯一直接单父 maintenance
   boundary、排序且唯一的路径及逐文件 `100644 blob`/OID/content；其他 Task、
   copied record、第二次消费、额外提交/路径或禁止接口均失败关闭。
2. task-delivery-policy canonical hash 与当前 machine policy 一致；任何漂移
   失败关闭。
3. TASK-0072 record 只验证 `d83baca...` 历史 Doctor blob/content，当前 Doctor
   合法演进仍 PASS；错误 boundary/blob/hash、历史篡改或 copied record FAIL。
4. 普通 READY Doctor 真实 exit 0 后才有 IN_PROGRESS；maintenance 不能变成
   其他任务、其他路径或未来重复使用的 pre-READY 授权。
5. parent-edge core 当前正负矩阵重新 PASS，四消费者、性能、workflow 和 receipt
   范围不变。
6. TASK-0056 Card/Backlog dependency 只在一个授权单父边从 TASK-0071 迁移到
   TASK-0073，delivery policy core 同步为 TASK-0073；TASK-0055、TASK-0071、
   TASK-0072 仍为 REJECTED。
7. Reviewer、candidate canonical、Windows、WSL 与 pre-closure 全部绑定同一
   精确实现 Commit/Tree 并真实 PASS，才可 ACCEPTED。
8. GitHub 固定 `UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0 /
   passClaimed=false`，macOS 为 `DEFERRED_NOT_CLAIMED`，均不代表 PASS。
9. 终态 `[skip ci]` 安全推送后 `main == origin/main`、ahead/behind `0/0`、
   clean、`activeTask=null`。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。maintenance 后先跑专用自绑定
正负例；IN_PROGRESS 后先跑受影响最小矩阵与唯一 `git diff --check`，再冻结
clean candidate。Reviewer PASS 后依次只运行一次 candidate canonical、一次
Windows `HARNESS_PORTABILITY_LOCAL`、Windows PASS 后一次 WSL Ubuntu-24.04
`git archive` exact-tree、一次 pre-closure。

所有预计超过 60 秒的 Doctor/canonical/pre-closure 从启动即使用同一持久进程；
Windows durable transport 先以 exit-7 smoke 预检，只低频检查 atomic receipt
是否存在，发布后一次读取 receipt/stdout/stderr，不重复同一长命令。

## 回滚或前向修复

保持 `main` 与单父前向历史；不切分支、不建 worktree、不 reset、rebase、
amend、squash 或改写历史。只有 R1 发现本卡授权范围内真实缺陷时，允许一批
集中前向修复和唯一 R2；不得扩大 allowlist、接线消费者或复用历史候选结果。

## 停止条件

- maintenance 不是 DRAFT 的唯一直接单父子提交，或需要第二条记录、第二次消费、
  额外提交/路径、通用 bypass 或历史改写；
- READY Doctor 非 0、receipt 缺失/身份不匹配或结果 UNKNOWN；
- 45 分钟仍无通过目标矩阵的精确候选，60 分钟目标预算耗尽，或 90 分钟 hard fuse；
- Reviewer 需要 R3、第二批修复，或 R2 出现新结构性 P0/P1；
- 必须接线四消费者、修改 workflow/durable helper/产品，或候选、Context、
  Skill、Reviewer、receipt 身份无法精确绑定。

hard fuse 后停止实现、修复、Reviewer、canonical 与平台验证；若仓库 active 或
半闭环，只允许 Evidence/Handoff、一次 pre-closure、terminal commit、push 与
远端 `0/0` 的 closure-only overrun，期间禁止实现。

## Evidence Pack

输出 `docs/evidence/TASK-0073/` 与 `docs/handoffs/TASK-0073.json`。PASS 只绑定
实际执行与精确 Commit/Tree；历史或当前 FAIL、CANCELLED、TIMEOUT、NOT_RUN、
UNKNOWN、DEFERRED_NOT_CLAIMED 永不转换为 PASS。
