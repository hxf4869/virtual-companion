# TASK-0038：任务交付执行策略、双模式 Skill 与 AGENTS 入口

```yaml
taskId: TASK-0038
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions:
  task-delivery-flow: 1.0.0
planningBacklog: .harness/task-backlog.yaml
planningContractHash: a56440293ebd9a58c7b28c6412b871b06880bc87c6dbf603ab7169d5df2885af
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: def92abfae0fc362be77d5133e6df36a138763f0
authorizationCommit: a53ac102a4be0df68337854a90adc896a2d9d591
contextFingerprint: 83d3cbae244e04b9fd1c8f9530e51583e7598ddcdcec850b5e5aac439639d08e
contextLock: docs/tasks/context/TASK-0038.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0037/**
  - docs/handoffs/TASK-0037.json
  - docs/schemas/**
  - docs/tasks/**
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - AGENTS.md
  - .harness/agent-entrypoints.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0038-task-delivery-policy-skill-entrypoint.md
  - docs/tasks/context/TASK-0038.context-lock.yaml
  - docs/evidence/TASK-0038/**
  - docs/handoffs/TASK-0038.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-delivery-flow/SKILL.md
forbiddenPaths:
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/commands.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - skills/catalog-change/**
  - skills/contract-change/**
  - skills/database-migration/**
  - skills/harness-change/**
  - skills/memory-change/**
  - skills/model-routing-change/**
  - skills/safety-change/**
  - skills/task-intake/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - docs/decisions/**
  - docs/engineering/**
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
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
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/agent-entrypoints.yaml
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/decisions/0003-portable-agent-harness.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/evidence/TASK-0037/evidence-pack.json
  - docs/handoffs/TASK-0037.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: Owner 本消息明确批准 TASK-0038 以 C4 Harness/Skill/AGENTS 范围完整实现机器交付策略、task-delivery-flow 双模式 Skill、薄入口、基线 fixture 与 idle planning checkpoint；要求严格按本卡闭环且不得晋级 TASK-0039。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0038
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_real_git_history_rejects_corrupt_restore_and_moved_activation scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_accepts_no_tail_rejected_superseded_serial_and_draft scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_empty_merge_split_and_extra_paths scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_static_contract_order_dependency_gate_and_next_action_drift scripts.harness.tests.test_harness.IdlePlanningCheckpointTests.test_rejects_dirty_staged_and_corrupt_then_restore scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_contract_drift
  - python C:/Users/k/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/task-delivery-flow
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立适用于单卡和长线严格串行协调的唯一机器交付策略、双模式 Skill 与薄文档入口。

## 范围内

- 在 Harness 唯一机器策略中约束验证层级、风险分级 Reviewer、阶段预算、熔断、候选身份和长线串行条件；
- 注册 `task-delivery-flow` Skill，并让 `AGENTS.md` 只保留硬约束与机器策略、Skill 的入口；
- 接入 Sources、Invariants、Doctor 和定向测试，修复 idle planning checkpoint 与 planning-only resolution 的自举组合缺口。

## 明确禁止

- 只写说明文档、另建平行计划系统或在 `AGENTS.md` 复制策略正文；
- 用删测、skip、放宽失败关闭或无界 Reviewer 循环换取时延；
- 顺带实现性能引擎、CI 平台矩阵、快照复用或 Technical Alpha 产品功能。

## 依赖与决策闸门

- 依赖：TASK-0012；
- 无新增硬决策闸门；TASK-0037 的 REJECTED 终态不是本卡依赖。

## 验收

- 机器策略、双模式 Skill 和薄入口被仓库注册、Doctor 与定向测试失败关闭地约束；
- 单卡与长线严格串行模式均可复用，规划态自举组合有端到端覆盖；
- 具体 Skill 版本、动态命令和时间阈值只在本卡晋级唯一 DRAFT 时冻结。

## 晋级规则

TASK-0012 必须保持 ACCEPTED，仓库必须空闲，且本卡必须是执行顺序中首个可晋级任务；满足条件后才能创建唯一 DRAFT。

### DRAFT 动态冻结与已知基线

- Base Commit 冻结为 `def92abfae0fc362be77d5133e6df36a138763f0`；fetch 后本地
  `HEAD == origin/main`、ahead/behind `0/0`、工作区与 index 干净，TASK-0037 为执行态
  `REJECTED`，`activeTask=null`，Backlog 首个可晋级任务为 TASK-0038。
- 本地 Windows Python 3.12.9 恢复 Doctor 为 57,150 checks、215.808 秒、PASS。首次工具运行因
  65 秒外层超时而失去可观察终态，不计 PASS；确认原进程退出后以单一可持续会话重跑得到上述结果。
- exact-SHA GitHub Actions run `30581926062` 绑定 Base `def92ab`：Backend job
  `91004019883` 与 Frontend job `91004020043` 成功；Ubuntu `91004019933`、Windows
  `91004019982`、macOS `91004019987` Harness 均失败于
  `BacklogTests.test_real_git_history_rejects_corrupt_restore_and_moved_activation`。
- 该红灯是本卡必修：临时 Git 历史 fixture 把当前执行态 REJECTED TASK-0037 卡复制成 activation
  planning-only 基线，合法 `attack=False` 因缺 `planningResolution` 被误判。本卡必须让 fixture
  显式构造 planning-only/activation 快照，不依赖真实当前 lifecycle；攻击场景仍失败关闭，不回退
  TASK-0037 已交付的生产分类修复。

### 唯一机器交付策略

- 新增 `.harness/task-delivery-policy.yaml` 作为唯一机器交付策略，并由
  `.harness/sources-of-truth.yaml`、`.harness/invariants.yaml`、Doctor 与失败关闭测试共同约束。
  不建立第二套任务、计划、状态、Evidence 或 Handoff 系统。
- 策略提供 `single-card` 与 `longline` 两种模式。`longline` 只编排 Backlog，严格一次一个全新
  可见实现任务；前卡终态、推送、Handoff、远端及 CI 复核完成后才允许开启下一卡；卡内完整复用
  `single-card`，只在真实 Owner 闸门或有证据的 BLOCKED 处暂停。
- READY 前复杂度闸门：同时命中治理/授权/历史等多个风险面、预计 Reviewer 无法在 15 分钟内审完、
  单轮终态检查超过 20 分钟或预计总墙钟超过 90 分钟时必须拆卡。目标 60 分钟、硬熔断 90 分钟；
  45 分钟无可评审候选或 R2 出现新的结构性 P0/P1 时停止，禁止第三轮。
- 验证顺序固定为：迭代定向检查不超过 60 秒；冻结精确候选 Commit/Tree；Reviewer；Reviewer PASS
  后对候选执行一次 canonical/精确 SHA CI；最后 closure。普通业务卡只固定一个 canonical Python
  precheck、受影响模块测试和一次 diff，不重复 canonical 已包含命令。Harness/可移植性卡才允许完整
  三平台包装器；具体 CI 调度留给 TASK-0040。
- C1/C2 除机器或保护规则另有要求外不强制独立 Reviewer；C3/C4 使用 `fork_turns=none` 的独立静态
  Reviewer。R1 一次性审完整矩阵，P0/P1 和明确验收/不变量违反阻断，P2/P3 作为非阻断后续登记。
  最多一批集中修复；R2 只审 findings 闭环、delta、相邻风险和新增 P0/P1，不从头重审，也不重复昂贵测试。
- 候选身份必须声明完整输入字段；任一未知或漂移只产生 `RERUN_REQUIRED`。失败、取消、超时、NOT_RUN
  永不成为 PASS；exact-SHA 终态 CI 不跨 SHA 复用。自动 receipt 与跨执行复用留给 TASK-0041。
- Reviewer 前终态 fixture 必须显式模拟 active/terminal 状态，不得读取当前工作区 lifecycle；
  pre-closure 前精确暂存完整 index，防止在未暂存快照上运行昂贵检查。

### Idle planning checkpoint 自举合同

- 从最后执行任务 canonical terminal commit 到 DRAFT/HEAD 的规划尾部必须由 Git 历史派生并失败关闭验证。
  每条规划父边必须单父、非空、原子；仅允许 Backlog append 一个 planning resolution、对应卡
  `PLANNED -> REJECTED/SUPERSEDED`，以及为保持下一动作一致所必需的 project-state `nextAction`。
- 规划尾部禁止 Ledger、Evidence、Handoff、代码、Skill、策略、静态 Harness 合同、新任务卡、Backlog
  静态任务/顺序/依赖/关键路径/Gate/authorization amendment 漂移；规划卡 Hash、标题、固定声明、
  六节正文和其余元数据必须不变。未提交或 staged 变化、merge、空提交、拆分提交、多 resolution、
  错误后恢复均失败关闭。
- 无合法规划尾部时沿用 canonical terminal commit；有合法尾部时，最后一个已验证 checkpoint 成为下一
  DRAFT 与 Base-Handoff 唯一锚点。上一执行任务 Diff Scope 只截止其 canonical terminal commit；
  规划尾部由独立 checkpoint validator 负责，不能洗入旧任务或新任务。
- 正例至少覆盖无尾部、原子 REJECTED、原子 SUPERSEDED、多次串行 resolution、checkpoint 后合法 DRAFT；
  负例至少覆盖空提交、merge、拆分、多 resolution/额外路径、错误 nextAction、静态合同/顺序/依赖/Gate
  漂移、Ledger/Evidence/Handoff/代码/新卡夹带、未提交/staged、先错后恢复、下一 DRAFT 仍锚旧 terminal。

### Skill、入口与候选边界

- 使用系统 `skill-creator` 的 `init_skill.py` 初始化 `skills/task-delivery-flow`，目标版本
  `1.0.0`；仓库注册只交付 `SKILL.md`，初始化器自动生成但项目不需要的 `agents/openai.yaml` 不进入
  最终 Skill 树。用系统 `quick_validate.py` 与仓库 Doctor 双重校验，并以测试证明项目机器真源优先。
- `AGENTS.md` 只保留恢复、活动任务/审批/暂存/失败关闭等最小硬约束，以及机器策略和已注册 Skill 的
  入口，不复制交付策略或 Skill 正文。同步 `.harness/agent-entrypoints.yaml` 中全部受内容 Hash 约束的
  AGENTS 投影；`CLAUDE.md` 保持现有薄导入。
- reviewed implementation candidate 必须包含机器策略、Skill、AGENTS/entrypoint、Doctor/tests、基线
  fixture 与 idle checkpoint 全部实现。终态单父提交仅包含标准 closure 路径。

### API / 事件 / 数据契约

本卡不修改业务 API、事件、数据库或产品 Catalog；机器策略只描述治理交付合同，不能成为业务契约真源。

### 权限、RLS 和数据处理要求

本卡仅处理仓库治理元数据和离线临时 Git fixture；不读取真实凭据、真实用户数据或外部模型数据，不修改
数据库、RLS、账号、容器或本机开发服务。

### 状态机和失败行为

严格按 `PLANNED -> DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。任何 Context、Skill、
审批、allowlist、checkpoint、Reviewer、候选身份、canonical 或 CI 失败都保持真实 FAIL 并仅做前向修复；
不得删测、skip、扩大 timeout、伪造 PASS 或回退 TASK-0037 生产修复。

### 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或 Technical Alpha 产品能力；不新增付费插件、SaaS-only
运行时或客户端专用规则副本。

### 验收标准

- 唯一机器策略的字段、模式、预算、Reviewer、候选身份、验证顺序和串行条件被 Doctor 精确校验，删除、
  缺失、未知值或语义漂移均失败关闭。
- `task-delivery-flow` 1.0.0 经初始化、仓库注册、系统 quick_validate 和 Doctor 验证；AGENTS 薄入口
  未复制策略正文，所有受 Hash 约束投影一致。
- Base run `30581926062` 的 fixture 根因由显式 planning-only/activation snapshot 修复；原正例 PASS，
  attack 负例仍 FAIL。
- idle checkpoint 正负矩阵端到端通过，DRAFT/Base-Handoff/idle terminal/diff-scope 四处统一消费同一
  派生 checkpoint，且无规划尾部行为不变。
- R1 一次完整矩阵；若有 findings，最多一批修复与一次 R2 delta-only。Reviewer PASS 后候选本地
  canonical PASS，再把该精确实现 SHA 推送并等待 GitHub 5 jobs 全部成功。
- 生成 Evidence/Handoff，执行精确暂存后的 pre-closure，以单父 ACCEPTED 提交关闭并推送；最终
  `origin/main` 与本地 `main` ahead/behind 为 `0/0`。

### 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。定向矩阵与 Skill quick_validate 在 Reviewer 前执行；
Reviewer PASS 后只执行一次候选 canonical。GitHub Actions 5 jobs 作为精确实现 SHA 的附加 Evidence，
不把失败 run 或其他 SHA 复用为 PASS。

### 回滚或前向修复

只在当前 main 上做小批前向修复。候选失败时不重写历史、不切分支、不使用 worktree、不回退用户或
TASK-0037 修改；若已推候选失败，仅允许同一批次内一批修复、R2 delta 和一次替代 exact-SHA CI。

### 停止条件

- 真实 Owner 决策闸门、无法满足的权限或具证据的 BLOCKED；
- 总墙钟达到 90 分钟；
- 45 分钟仍无可评审候选；
- R2 出现新的结构性 P0/P1，或需要第三轮 Reviewer/第三批 CI；
- 发现必须修改冻结 allowlist/验收/授权投影或 TASK-0040/0041 范围。

### Evidence Pack

输出到 `docs/evidence/TASK-0038/` 并生成 `docs/handoffs/TASK-0038.json`；Evidence 记录实现
Commit/Tree、Reviewer R1/R2、Skill 校验、定向/全量/CI run+jobs、基线红灯闭环、checkpoint 正负矩阵、
实际墙钟和预算状态。关闭后停止，不晋级 TASK-0039。
