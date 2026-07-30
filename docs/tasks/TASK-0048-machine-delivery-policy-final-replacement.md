# TASK-0048：机器交付策略最终替代与后继链重建

```yaml
taskId: TASK-0048
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
baseCommit: fb40cf5f71879f2a10affced0081aa0debaae99c
authorizationCommit: 0bb36951794b30ecbe55444d1c208ac8b8373158
contextFingerprint: e795ca05afce1301c65a65198a025ea6f4ddac3b5567a16ef8dc4c0496e5e1d5
contextLock: docs/tasks/context/TASK-0048.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0042/**
  - docs/handoffs/TASK-0042.json
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
  - docs/tasks/TASK-0043-idle-planning-checkpoint-core.md
  - docs/tasks/TASK-0044-idle-planning-checkpoint-consumers.md
  - docs/tasks/TASK-0045-harness-timing-cross-filesystem-successor.md
  - docs/tasks/TASK-0046-harness-path-aware-ci-wrapper-successor.md
  - docs/tasks/TASK-0047-harness-snapshot-receipt-successor.md
  - docs/tasks/TASK-0048-machine-delivery-policy-final-replacement.md
  - docs/tasks/context/TASK-0048.context-lock.yaml
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0050-idle-planning-checkpoint-consumers-replacement.md
  - docs/tasks/TASK-0051-harness-timing-cross-filesystem-final-successor.md
  - docs/tasks/TASK-0052-harness-path-aware-ci-wrapper-final-successor.md
  - docs/tasks/TASK-0053-harness-snapshot-receipt-final-successor.md
  - docs/evidence/TASK-0048/**
  - docs/handoffs/TASK-0048.json
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
  - docs/tasks/TASK-0039-harness-timing-cross-filesystem-performance.md
  - docs/tasks/TASK-0040-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0041-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0042-machine-delivery-policy-skill-thin-entrypoint.md
  - docs/tasks/context/TASK-0042.context-lock.yaml
  - docs/evidence/TASK-0042/**
  - docs/handoffs/TASK-0042.json
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
  - docs/tasks/TASK-0042-machine-delivery-policy-skill-thin-entrypoint.md
  - docs/tasks/context/TASK-0042.context-lock.yaml
  - docs/evidence/TASK-0042/evidence-pack.json
  - docs/evidence/TASK-0042/review-r1.md
  - docs/evidence/TASK-0042/review-r2.md
  - docs/evidence/TASK-0042/review-terminal-cleanup.md
  - docs/handoffs/TASK-0042.json
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
    evidence: Owner 明确批准 standalone TASK-0048 的 C4 Harness、Skill、AGENTS、最小 real-Git baseline fixture CI-unblock、TASK-0049 至 TASK-0053 后继链登记、TASK-0043 至 TASK-0047 五条独立 SUPERSEDED 规划边以及独立 Reviewer。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0048
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_real_git_history_rejects_corrupt_restore_and_moved_activation scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_contract_drift scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_wrapper_alias_drift
  - python C:/Users/k/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/task-delivery-flow
  - git diff --check
```

## 背景与用户可观察目标

TASK-0042 已以 REJECTED 终态关闭。两轮独立评审把其实现压缩到一个明确残余：包装器即使以精确 argv
冻结，也只能作为实际执行命令据实记录，绝不是 Python canonical 命令、Evidence、receipt 或 PASS 的别名。
Owner 要求以新的永久 standalone TASK-0048 最终交付唯一机器策略、`task-delivery-flow` 1.0.0、
AGENTS 薄入口、Doctor/定向测试与已定位 fixture CI-unblock，并重建可继续推进的五卡后继链。

TASK-0042 失败候选 `26d3eb4ea196fedb66b82a8d11b7a36caa0ad2c7` /
Tree `890c39976ebbb212ee9afa7b8b3d3de8f5b73681` 及已核验本地 bundle 只作为 FAIL 参考和选择性机械恢复来源。
不得恢复 TASK-0042 card/state/closure，不得复用旧 Reviewer、定向 PASS 或 CI 结果。完成后机器
`nextAction` 必须精确指向 TASK-0049，并在本任务停止，不晋级后继卡。

## 范围内

- 新增 `.harness/task-delivery-policy.yaml`，作为验证层级、复杂度闸门、60/90/45 分钟预算、候选身份、
  Reviewer 上限、single-card 与 longline 严格串行条件的唯一机器策略；
- 交付 `skills/task-delivery-flow/SKILL.md`，frontmatter 只有 ASCII/English `name` 与
  `description`，版本 `1.0.0` 只由 `.harness/skills.yaml` 持有；
- 将 `AGENTS.md` 收敛为保留 task-intake、planning-only resolution、terminal closure 和失败关闭硬约束的
  薄入口，并同步 `.harness/agent-entrypoints.yaml` 中全部 AGENTS 内容 Hash 投影；
- 接入 Sources、Invariants、Skills registry、Doctor 与小型 `DeliveryPolicyTests`；Sources 对策略路径
  必须 exact-once，任何 alias 或 duplicate 均失败；
- 完整迁移约 60 秒低频轮询、禁止并行 `status`/`ps`/重复日志抓取，以及 REUSED-PASS 的完整输入身份语义；
- 包装器无条件不是 Evidence、receipt 或 PASS alias。冻结实际 wrapper argv 后只能把该实际命令据实记录；
  Skill 中不得出现 `unless frozen` 或任何条件例外，精确负例必须使后缀/别名漂移失败关闭；
- 保留 TASK-0042 已定位的 real-Git baseline fixture 自包含 CI-unblock：只使用合成 Backlog/lifecycle/card，
  清空 synthetic resolutions，corrupt/restore 只使用 synthetic bytes；
- 登记 TASK-0049～TASK-0053 为 PLANNED，顺序插入被阻断链之后、TASK-0013 之前，依赖严格为
  `0049 <- 0048`、`0050 <- 0049`、`0051 <- 0050`、`0052 <- 0051`、`0053 <- 0052`；
- 以五条彼此独立、单父、只改 Backlog 与对应旧卡的规划边，把 TASK-0043→TASK-0049、
  TASK-0044→TASK-0050、TASK-0045→TASK-0051、TASK-0046→TASK-0052、TASK-0047→TASK-0053
  原子登记为 `SUPERSEDED`；旧卡静态正文与规划合同不变，不进入 Task Ledger。

## 明确范围外

- idle planning checkpoint 核心、DRAFT/Base-Handoff/idle terminal/terminal Diff Scope 四消费者及其长矩阵；
- 除已定位 real-Git baseline fixture 外的 CI 修复；
- Harness 阶段计时、Git/history 性能引擎、路径感知 CI、包装器平台策略、snapshot receipt 或结果复用实现；
- TASK-0049 晋级、TASK-0013 晋级及任何 Technical Alpha 业务代码、Provider、数据库、API、H5、身份、
  模型外发或产品能力；
- 修改 TASK-0042 终态产物、恢复其任务状态，或把其失败候选/旧检查/旧 Reviewer 表示成本任务 PASS。

## 输入和前置条件

- Base 固定为 `fb40cf5f71879f2a10affced0081aa0debaae99c`；创建前已实时 fetch 并确认
  `HEAD == origin/main`、ahead/behind `0/0`、当前分支 `main`、工作区与 index 干净；
- `project-state.activeTask=null`、`lastTerminalTask=TASK-0042`；TASK-0048 不在 Base Backlog 中，
  必须走 standalone 原始需求路径，不声明 `planningBacklog` 或 `planningContractHash`；
- 已完整读取 AGENTS、task-intake 1.2.0、harness-change 1.1.0、系统 skill-creator、TASK-0042
  card/Context/Evidence/Handoff/R1/R2/cleanup evidence 以及相关机器真源；
- 失败候选 bundle/ref/hash 已验证；只允许对本卡实现路径做受控机械 path diff 恢复，再应用明确残余修复；
- 使用本机已保存的项目 local 环境：Windows PowerShell、Python 3.12.9、PyYAML 6.0.3；
- 目标墙钟 60 分钟、绝对上限 90 分钟；25 分钟报告候选准备度，45 分钟无通过冻结定向矩阵的精确
  implementation Commit/Tree 则立即 REJECTED；已有候选则继续闭环。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、产品 Catalog 或协议合同。机器策略只引用 canonical task lifecycle；
流程数组只能命名为 `happyPath`，不得形成第二状态机。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、Skill、Doctor/tests 与离线临时 Git fixture；不读取凭据、真实用户数据或外部模型
数据，不修改数据库、RLS、账号、容器、本机服务或权限范围。

## 状态机和失败行为

按 standalone 路径执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。DRAFT 与 READY
各只运行机器要求的精确 Doctor 一次，不运行恢复 Doctor。任何 Context、Skill、审批、allowlist、Backlog
投影、Reviewer、候选身份、canonical 或 exact-SHA CI 失败都保持真实 FAIL。

R1 只做一次完整静态矩阵；最多一批实现修复。若发生修复，R2 只核验 findings 闭环、delta、相邻风险和
新增 P0/P1，禁止 R3；R2 出现新的结构性 P0/P1 时安全停止。Reviewer 不运行 canonical 或 CI，也不改文件。

longline 正常依赖链只在前卡 ACCEPTED、已推送、Handoff 完整、远端复核和当前 exact-SHA CI 五项均满足后
放行；REJECTED/SUPERSEDED 不放行正常依赖链。BLOCKED 只阻断依赖后代，仍继续其他可晋级 DAG；只有无可
晋级卡或仅剩 Owner gate 时暂停。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策或业务能力；不引入第二套任务、计划、ADR、状态、
Evidence、Handoff 或客户端规则副本，不新增付费插件或 SaaS-only 必需运行时。

## 验收标准

- 机器策略只有一个 source-of-truth 注册；alias/duplicate 也失败。字段、双模式、预算、Reviewer、候选身份、
  验证顺序、低频轮询、复用身份和 longline 放行/阻断语义均被 Doctor 精确失败关闭；
- `task-delivery-flow` 1.0.0 通过 Windows `quick_validate.py`；最终 Skill 树只交付 `SKILL.md`，
  frontmatter 只有 `name` 与 `description`，正文中不存在 wrapper alias 条件例外；
- 包装器测试拒绝 `unless`、`except`、`if frozen` 或等价后缀/别名漂移；精确冻结 wrapper argv 仍只记录
  wrapper 实际执行，不替代 Python canonical 的 Evidence、receipt 或 PASS；
- AGENTS 保留合法 idle DRAFT、planning-only resolution、terminal closure 例外；protected path 语义不把
  Reviewer 强加给所有 C1/C2，全部 AGENTS Hash 投影一致；
- real-Git baseline fixture 完全自包含，不读取当前 workspace lifecycle/card；合法正例 PASS，既有
  corrupt/restore 与 moved-activation 攻击继续 FAIL；
- TASK-0049～TASK-0053 的标题、Hash、卡片、顺序和依赖投影完整；0043～0047 各自以独立原子规划边
  `SUPERSEDED` 并精确指向 replacement，静态正文不变且不进入 Task Ledger；
- longline 只对 `ACCEPTED + pushed + Handoff + remote + exact-SHA CI` 放行；BLOCKED 只阻断依赖后代；
- lifecycle 只引用 canonical 或命名 `happyPath`；保护路径保留 task-intake 治理例外；
- R1/R2、Skill validation、定向/canonical、exact-SHA CI run 与五个 jobs 均绑定本任务精确候选；
- Evidence/Handoff、精确暂存 pre-closure、ACCEPTED 单父 closure、远端 `0/0` 与 clean 全部闭环；
  终态 `project-state.nextAction` 精确指向 TASK-0049。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行不超过 60 秒的冻结定向矩阵、Windows
`quick_validate.py`、一次 `git diff --check` 与生命周期要求的 DRAFT/READY Doctor；Reviewer PASS 后仅
运行一次候选 canonical。canonical 已包含的子命令不重复执行。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。优先从已核验 bundle/commit 按本卡实现路径
机械恢复，再应用 wrapper alias 残余修复；不得整包恢复 TASK-0042 card/state/closure。候选或首次
exact-SHA CI 失败只允许一批前向修复、R2 delta 和一次替代 exact-SHA CI。

## 停止条件

- 45 分钟仍无通过冻结定向矩阵的精确 implementation Commit/Tree，或总墙钟达到 90 分钟；
- R2 出现新的结构性 P0/P1，或需要 R3、第二批本地实现修复、第三批 CI；
- 必须扩大冻结 allowlist、验收，或实现 idle checkpoint core/四消费者、性能引擎、路径感知 CI、
  snapshot receipt；
- 出现无法满足的权限、真实 Owner 决策闸门或有证据的 BLOCKED。

## Evidence Pack

输出到 `docs/evidence/TASK-0048/` 并生成 `docs/handoffs/TASK-0048.json`。Evidence 必须记录
implementation/terminal Commit 与 Tree、R1/R2、Skill validation、定向/canonical、exact-SHA CI run
及五个 jobs、Backlog 0049～0053、0043～0047 resolutions、实际墙钟及 45/90 gate 状态。
