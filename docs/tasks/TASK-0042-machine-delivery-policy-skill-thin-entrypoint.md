# TASK-0042：机器交付策略、双模式 Skill 与薄入口

```yaml
taskId: TASK-0042
state: REJECTED
resolutionReason: >-
  首候选经 R1 得到 3 个阻断 P1；唯一修复批次关闭其中 2 个，但 R2 发现 Skill 把 wrapper
  Evidence alias 错误写成条件例外，产生新的阻断 P1。合同禁止第二修复批次和 R3，因此未运行
  candidate canonical 或 exact-SHA CI。失败候选已保存到本地可验证 bundle/ref，并由前向清理提交
  恢复实现前 Tree；终态 Tree 不包含 policy、Skill、Doctor/test 或入口/registry 失败实现。
  候选提交作为不可改写审计祖先保留，绝不表示 PASS 或可交付实现。
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
baseCommit: 0c15def49faf36cbd9a07fb76203f6191c60e5e6
authorizationCommit: f1b9b46ea157c04956fedbdfea8a31e09873a504
contextFingerprint: e9a60431b971dfec16d7eb3a5563c1a469c360eaf545b659774ad379f2cdf124
contextLock: docs/tasks/context/TASK-0042.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0038/**
  - docs/handoffs/TASK-0038.json
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
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0039-harness-timing-cross-filesystem-performance.md
  - docs/tasks/TASK-0040-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0041-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0042-machine-delivery-policy-skill-thin-entrypoint.md
  - docs/tasks/context/TASK-0042.context-lock.yaml
  - docs/tasks/TASK-0043-idle-planning-checkpoint-core.md
  - docs/tasks/TASK-0044-idle-planning-checkpoint-consumers.md
  - docs/tasks/TASK-0045-harness-timing-cross-filesystem-successor.md
  - docs/tasks/TASK-0046-harness-path-aware-ci-wrapper-successor.md
  - docs/tasks/TASK-0047-harness-snapshot-receipt-successor.md
  - docs/evidence/TASK-0042/**
  - docs/handoffs/TASK-0042.json
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
  - docs/evidence/TASK-0038/evidence-pack.json
  - docs/evidence/TASK-0038/review-gate-pre-review.md
  - docs/handoffs/TASK-0038.json
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
    evidence: Owner 明确批准 standalone TASK-0042 的 C4 Harness、Skill、AGENTS、Backlog successor registration 与独立 Reviewer，并在 DRAFT 冻结前补充仅限已定位 real-Git baseline fixture 的 CI-unblock 修复以及 TASK-0039～0041 到 TASK-0045～0047 的原子 SUPERSEDED 登记。
independentReview: required
reviewers:
  - id: task-0042-terminal-cleanup-audit
    kind: terminal-cleanup-audit
    verdict: FAIL
    reviewedCommit: dde501dfa669fb580c8688a9ca388a7eca85fca6
    evidencePath: docs/evidence/TASK-0042/review-terminal-cleanup.md
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0042
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_real_git_history_rejects_corrupt_restore_and_moved_activation scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_contract_drift
  - python C:/Users/k/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/task-delivery-flow
  - git diff --check
```

## 背景与用户可观察目标

TASK-0038 因 45 分钟无可评审候选已真实 REJECTED，未评审 stash
`16bc536df6f7ebf9e17e0e08a187d8a1b81ebc09` 只可作为只读参考。Owner 要求用新的永久
standalone TASK-0042 交付三层流程的第一块：唯一机器交付策略、双模式 Skill、AGENTS 薄入口及其失败关闭
投影，并在 Backlog 中重建后续卡链。完成后，新会话应能只依赖机器真源和注册 Skill 执行单卡或严格串行
长线交付，且下一张可晋级任务为 TASK-0043。

Base exact-SHA CI run `30581926062` 的 Backend/Frontend 成功，但 Ubuntu、Windows、macOS Harness 均因
`BacklogTests.test_real_git_history_rejects_corrupt_restore_and_moved_activation` 的已定位 fixture 污染而失败。
若该最小修复留给依赖 TASK-0042 ACCEPTED 的 TASK-0043，将形成 CI 与晋级死锁，因此本卡仅额外承担这一项
CI-unblock 修复。未绑定 DRAFT 的恢复 Doctor 已按协调纠偏取消，状态为 `CANCELLED/NOT_RUN`，不得记为 PASS。

## 范围内

- 新增 `.harness/task-delivery-policy.yaml`，作为验证层级、复杂度闸门、60/90/45 分钟预算、候选身份、
  Reviewer 上限、single-card 与 longline 串行条件的唯一机器策略；
- 用系统 `skill-creator` 初始化并交付 `skills/task-delivery-flow/SKILL.md`，仅保留
  `name`/`description` frontmatter，版本 `1.0.0` 只由 `.harness/skills.yaml` 持有；
- 将 `AGENTS.md` 收敛为保留治理例外和失败关闭硬约束的薄入口，并同步
  `.harness/agent-entrypoints.yaml` 中全部 AGENTS 内容 Hash 投影；`CLAUDE.md` 不变；
- 接入 Sources、Invariants、Skills registry、Doctor 策略结构/投影校验及小型
  `DeliveryPolicyTests`，把旧 canonical test
  `ValidationFlowTests.test_agent_rules_define_snapshot_reuse_and_low_frequency_polling` 的完整策略断言迁到
  机器策略/Skill 投影；
- 仅修复已定位 real-Git baseline fixture：显式合成 planning-only/activation snapshot、清空 synthetic
  resolutions，并保存/恢复 synthetic card bytes；正例继续 PASS，攻击场景继续失败关闭；
- 在独立规划登记提交中新增 TASK-0043～TASK-0047 PLANNED 卡并插入 TASK-0041 与 TASK-0013 之间；
  依赖严格为 `0043 <- 0042 <-`（TASK-0042 为 standalone 已发现任务）、`0044 <- 0043`、
  `0045 <- 0044`、`0046 <- 0045`、`0047 <- 0046`，历史 criticalPath 前缀不变；
- 在三条彼此独立、单父、只改 Backlog 与对应旧卡的规划边上，把
  TASK-0039→TASK-0045、TASK-0040→TASK-0046、TASK-0041→TASK-0047 原子登记为 `SUPERSEDED`；
  `planningResolution` 与 Backlog resolution 完全一致，正文和静态合同不变。

## 明确范围外

- idle planning checkpoint 核心实现、DRAFT/Base-Handoff/idle terminal/terminal Diff Scope 四消费者接线
  及其长矩阵；
- 除上述单个 CI-unblock 外的 run `30581926062` 修复；
- Harness 阶段计时、Git/history 性能引擎、路径感知 CI、包装器平台策略、snapshot receipt 或结果复用；
- TASK-0013 晋级、Technical Alpha 业务代码、Provider、数据库、API、H5、身份、模型外发及产品能力；
- 从 TASK-0038 stash 整包恢复或把其未评审结果表示为候选、PASS、Evidence 或真源。

## 输入和前置条件

- Base 固定为 `0c15def49faf36cbd9a07fb76203f6191c60e5e6`；创建前已 fetch，确认
  `HEAD == origin/main`、ahead/behind `0/0`、当前分支 `main`、工作区与 index 干净；
- `project-state.activeTask=null`、`lastTerminalTask=TASK-0038`，TASK-0038 为执行态 REJECTED；
- 完整阅读 `AGENTS.md`、`task-intake` 1.2.0、`harness-change` 1.1.0、系统
  `skill-creator`、TASK-0038 card/Context/Evidence/Handoff/预审及本卡 Context Lock；
- Owner 本轮消息是本卡 C4 Harness/Skill/AGENTS、最小 fixture CI-unblock、Backlog successor registration
  与旧链 SUPERSEDED 的人工批准证据；
- 目标墙钟 60 分钟、绝对上限 90 分钟；25 分钟报告候选准备度，45 分钟无通过定向检查的候选则立即
  REJECTED 或受控拆分，不启动第三轮 Reviewer。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、产品 Catalog 或协议合同。机器策略只引用 canonical task lifecycle，
流程数组只能命名为 `happyPath`，不得形成第二状态机。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、Skill、Doctor/tests 与离线临时 Git fixture；不读取凭据、真实用户数据或外部模型
数据，不修改数据库、RLS、账号、容器、本机服务或权限范围。

## 状态机和失败行为

按 standalone 原始需求路径执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`，不伪造
`planningBacklog` 或 `planningContractHash`。任何 Context、Skill、审批、allowlist、Backlog 投影、
Reviewer、候选身份、canonical 或 exact-SHA CI 失败都保持真实 FAIL，并只允许一批前向修复；R2 只检查
findings closure、delta、相邻风险和新增 P0/P1，禁止第三轮。

longline 正常依赖链只在前卡 ACCEPTED、已推送、Handoff 完整、远端复核和 exact-SHA CI 复核全部满足后
放行；REJECTED/SUPERSEDED 不放行正常依赖链。BLOCKED 只阻断依赖后代，仍继续其他可晋级 DAG；只有无可
晋级卡或仅剩 Owner gate 时暂停。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或业务能力；不引入第二套任务、计划、ADR、状态、
Evidence、Handoff 或客户端规则副本，不新增付费插件或 SaaS-only 必需运行时。

## 验收标准

- 机器策略只有一个 source-of-truth 注册，字段、双模式、预算、Reviewer、候选身份、验证顺序和 longline
  放行/阻断语义被 Doctor 精确、失败关闭地校验；
- `task-delivery-flow` 1.0.0 经系统初始化、仓库注册和冻结 Windows argv 的 `quick_validate.py` 真实 PASS；
  最终 Skill 树只交付 `SKILL.md`，frontmatter 只有 `name` 与 `description`；
- AGENTS 保留 task-intake 合法的 idle DRAFT、planning-only resolution、terminal closure 例外；保护路径
  表述为精确 Skill 加规则声明所需的审批或独立 Reviewer，且所有 Hash 投影一致；
- real-Git baseline fixture 完全自包含，不读取当前 workspace lifecycle/card；合法正例 PASS，既有
  corrupt/restore 与 moved-activation 攻击继续 FAIL；
- TASK-0043～TASK-0047 的标题、Hash、卡片、顺序和依赖投影完整；0039～0041 各自以独立原子规划边
  `SUPERSEDED` 并精确指向 replacement，不进入 Task Ledger；
- R1 一次性静态完整 findings；若需修复，最多一批并执行一次 R2 delta；Reviewer 不重跑昂贵 canonical；
- Reviewer PASS 后仅运行一次候选 canonical，再推送精确实现 SHA 并等待 GitHub 5 jobs 全部成功；
  Evidence/Handoff、精确暂存 pre-closure、ACCEPTED 单父 closure、远端 `0/0` 与 clean 全部闭环；
- 终态 `project-state.nextAction` 精确指向 TASK-0043，且本任务停止，不晋级 TASK-0043。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行不超过 60 秒的冻结定向矩阵、Windows
PowerShell 直接 `quick_validate.py`、一次 `git diff --check` 与生命周期要求的 Doctor；Reviewer PASS
后只执行一次候选 canonical。canonical 已包含的子命令不重复执行，Reviewer 不运行昂贵全量检查。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。只从 stash 选择性重建本卡允许范围；不得整包
apply。候选或首次 exact-SHA CI 失败只允许一批前向修复、一次 R2 delta 和一次替代 exact-SHA CI。

## 停止条件

- 45 分钟仍无通过冻结定向检查的可评审候选，或总墙钟达到 90 分钟；
- R2 出现新的结构性 P0/P1，或需要第三轮 Reviewer、第二批本地修复、第三批 CI；
- 必须修改冻结 allowlist、验收、授权投影、idle checkpoint core/四消费者或 TASK-0043 之后实现范围；
- 出现无法满足的权限、真实 Owner 决策闸门或有证据的 BLOCKED。

## Evidence Pack

输出到 `docs/evidence/TASK-0042/` 并生成 `docs/handoffs/TASK-0042.json`。Evidence 必须记录实现
Commit/Tree、终态 Commit/Tree、R1/R2、Skill validation、定向/canonical/CI run+5 jobs、Backlog 新卡、
0039～0041 resolutions、恢复 Doctor 的 CANCELLED/NOT_RUN、实际墙钟及 45/90 gate 状态。
