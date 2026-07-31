# TASK-0054：采纳机器交付策略并闭环跨平台 CI

```yaml
taskId: TASK-0054
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions:
  task-delivery-flow: 1.1.0
baseCommit: 4f1fb21c6e9858bd51e137d82985a14c9b7585a5
authorizationCommit: ""
contextFingerprint: 51374f9d4273a96494c45b806eb60cbe2b5687050f5f9c50ee34ee2a6ddbc3a4
contextLock: docs/tasks/context/TASK-0054.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0048/**
  - docs/handoffs/TASK-0048.json
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
  - docs/tasks/TASK-0049-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0050-idle-planning-checkpoint-consumers-replacement.md
  - docs/tasks/TASK-0051-harness-timing-cross-filesystem-final-successor.md
  - docs/tasks/TASK-0052-harness-path-aware-ci-wrapper-final-successor.md
  - docs/tasks/TASK-0053-harness-snapshot-receipt-final-successor.md
  - docs/tasks/TASK-0054-adopt-machine-delivery-policy-cross-platform-ci.md
  - docs/tasks/context/TASK-0054.context-lock.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/evidence/TASK-0054/**
  - docs/handoffs/TASK-0054.json
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
  - docs/tasks/TASK-0048-machine-delivery-policy-final-replacement.md
  - docs/tasks/context/TASK-0048.context-lock.yaml
  - docs/evidence/TASK-0048/**
  - docs/handoffs/TASK-0048.json
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
  - .harness/task-delivery-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/agent-entrypoints.yaml
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/decisions/0003-portable-agent-harness.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0048-machine-delivery-policy-final-replacement.md
  - docs/tasks/context/TASK-0048.context-lock.yaml
  - docs/evidence/TASK-0048/evidence-pack.json
  - docs/evidence/TASK-0048/review-r1.md
  - docs/evidence/TASK-0048/review-r2.md
  - docs/handoffs/TASK-0048.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: Owner 明确批准 standalone TASK-0054 的 C4 Harness、Skill、薄 AGENTS 独立采纳，两条机器执行规则，TASK-0055 至 TASK-0059 后继链登记，TASK-0049 至 TASK-0053 五条独立 SUPERSEDED 规划边及独立 Reviewer。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0054
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_real_git_history_rejects_corrupt_restore_and_moved_activation scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_contract_drift scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_wrapper_alias_drift scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_long_command_observability_drift scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_validator_rejects_hard_fuse_closure_drift
  - python C:/Users/k/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/task-delivery-flow
  - git diff --check
```

## 背景与用户可观察目标

TASK-0048 已以 REJECTED 终态关闭，但其最终候选
`4761fcee31f632f9e45d9d7e871b2f95e0ce9ae1` /
Tree `8235c704d48fe4dc4d1873c8ab7daa6f195c56fb` 的九条实现路径仍保留在当前 Base。
旧 Reviewer、本地 PASS、candidate canonical 和四个平台成功的 partial CI 只作为风险线索；
它们不构成 TASK-0054 PASS。

Owner 要求以新的永久 standalone 任务独立复核并正式采纳当前机器交付策略、
`task-delivery-flow` Skill、薄 AGENTS、注册表、Doctor/tests 与自包含 fixture，补齐真实执行暴露的
长命令可观察性和 90 分钟硬熔断 closure-only 语义，并以 TASK-0054 精确 SHA 取得五作业 CI 和
ACCEPTED 闭环。完成后 `project-state.nextAction` 必须精确指向 TASK-0055，本任务停止且不晋级后继卡。

## 范围内

- 独立复核并采纳九条既有实现路径：`AGENTS.md`、`.harness/agent-entrypoints.yaml`、
  `.harness/invariants.yaml`、`.harness/skills.yaml`、`.harness/sources-of-truth.yaml`、
  `.harness/task-delivery-policy.yaml`、`scripts/harness/doctor.py`、
  `scripts/harness/tests/test_harness.py` 和 `skills/task-delivery-flow/SKILL.md`；
- 在唯一机器策略和 Skill 中加入长命令可观察性：预计超过 60 秒的 Doctor、candidate canonical、
  pre-closure 从启动时即使用可持续 session/PTY，保留同一进程、stdout 和真实退出码；外层 yield/timeout
  只能让出控制，不得丢失结果；禁止重复进程、并行 status/ps 和重复日志抓取；退出码丢失只能记
  `NOT_RUN`/`UNKNOWN`，不能记 PASS；
- 在唯一机器策略和 Skill 中加入 90 分钟硬熔断：停止全部实现、修复、Reviewer、canonical 和 CI；
  若仓库仍 active 或半闭环，仅允许最小 closure-only overrun，动作严格限于 Evidence/Handoff、
  pre-closure、terminal commit、push 和远端 `0/0`，单列时长与根因，期间禁止实现；
- 让 Doctor 和小型 `DeliveryPolicyTests` 对两条新增规则精确失败关闭；将
  `task-delivery-flow` 注册版本提升为 `1.1.0` 并通过系统 skill-creator 的 Windows
  `quick_validate.py`；
- 保持 AGENTS 为机器策略与 Skill 的薄入口；只有内容确需变更时才同步全部 AGENTS Hash 投影，
  不复制两条规则正文；
- 登记 TASK-0055～TASK-0059 为新的 PLANNED 单父后继链，顺序插入现有被阻断链之后、
  TASK-0013 之前，依赖严格为 `0055 <- 0054`、`0056 <- 0055`、`0057 <- 0056`、
  `0058 <- 0057`、`0059 <- 0058`；
- 以五条彼此独立、单父、只改 Backlog 与对应旧卡的规划边，把 TASK-0049→TASK-0055、
  TASK-0050→TASK-0056、TASK-0051→TASK-0057、TASK-0052→TASK-0058、
  TASK-0053→TASK-0059 原子登记为 `SUPERSEDED`；旧卡静态正文不变且不进入 Task Ledger。

## 明确范围外

- idle planning checkpoint core、DRAFT/Base-Handoff/idle terminal/terminal Diff Scope 四消费者；
- Harness 阶段计时、Git/history/fixture 性能引擎、路径感知 CI、包装器平台策略、
  snapshot receipt 或结果复用实现；
- 修改 TASK-0048 终态产物、恢复 TASK-0048 状态，或把其 Reviewer、local PASS、
  canonical、partial CI 表示成本任务 PASS；
- TASK-0055 或 TASK-0013 晋级；任何业务、Provider、数据库、API、H5、身份、模型外发、
  Persona、安全政策、真实凭据或 Beta 工作；
- 修改 workflow、CI 实现、canonical lifecycle、命令注册表、保护路径、Schema 或其他 Skill。

## 输入和前置条件

- Base 固定为 `4f1fb21c6e9858bd51e137d82985a14c9b7585a5`；创建前实时 fetch 并确认
  `HEAD == origin/main`、ahead/behind `0/0`、分支 `main`、index/worktree clean；
- Base `project-state.activeTask=null`、`lastTerminalTask=TASK-0048`；Backlog 没有 TASK-0054，
  因此按 standalone 原始需求创建 DRAFT，不声明 `planningBacklog` 或 `planningContractHash`；
- 当前机器策略复杂度闸门已评估：本卡是一个不可分割的 C4 交付治理表面，规划边仅是该策略后继投影，
  不实现后继能力；目标 60 分钟且 90 分钟硬熔断，因此不拆分永久 TASK-0054；
- 已完整读取 AGENTS、task-intake 1.2.0、harness-change 1.1.0、系统 skill-creator、
  TASK-0048 card/Context/Evidence/Handoff/R1/R2/CI-delta 及相关机器真源；
- 使用本机已保存的 aiCoding project local 环境：Windows PowerShell、Python 3.12.9、
  PyYAML 6.0.3；不修改系统 Python、Docker 或本机服务；
- 目标墙钟 60 分钟、25 分钟报告 readiness、45 分钟必须有通过短矩阵的精确 implementation
  Commit/Tree，90 分钟停止所有实现性动作并按冻结 closure-only 规则处理。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、产品 Catalog 或协议合同。机器策略只引用 canonical task lifecycle；
`happyPath` 仍只是交付路径，不形成第二状态机。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、Skill、Doctor/tests 和离线临时 Git fixture；不读取凭据、真实用户数据或外部模型
数据，不修改数据库、RLS、账号、容器、本机服务或权限范围。

## 状态机和失败行为

按 standalone 路径执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。DRAFT 与 READY
Doctor 各只运行一次，不运行额外恢复 Doctor。Reviewer 前只运行不超过 60 秒的冻结定向测试、Windows
Skill validator、一次 `git diff --check` 和生命周期必需 Doctor，不运行 canonical 或 CI。

R1 只做一次完整静态矩阵；最多一批实现修复。若发生修复，R2 仅核验 finding 闭环、delta、相邻风险和
新增 P0/P1，禁止 R3。Reviewer 不改文件、不运行 canonical 或 CI。

Reviewer PASS 后仅运行一次 TASK-0054 candidate canonical；随后推送精确 implementation SHA 并等待
该 SHA 的五个 GitHub jobs。失败只允许一批前向修复、一次 focused delta review 和一次 replacement CI。
失败、取消、超时、`NOT_RUN` 或 `UNKNOWN` 均保持非 PASS。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或业务能力；不引入第二套任务、计划、
ADR、状态、Evidence、Handoff 或客户端规则副本，不新增付费插件或 SaaS-only 必需运行时。

## 验收标准

- 九条既有实现路径均由 TASK-0054 的 Context、短矩阵、独立 Reviewer、candidate canonical 和
  exact-SHA CI 重新覆盖；TASK-0048 的任何动态结果均不复用为 PASS；
- 唯一机器策略和 `task-delivery-flow` Skill 精确包含长命令可观察性和 90 分钟硬熔断
  closure-only 语义，Doctor canonical hash 与定向负例对任一字段或正文漂移失败关闭；
- `task-delivery-flow` 1.1.0 通过 Windows `quick_validate.py`，Skill 树仍只交付
  `SKILL.md`，frontmatter 只有 `name` 与 `description`；
- AGENTS 继续只提供机器策略与 Skill 的薄入口，不复制预算、长命令或 closure-only 正文；
  全部 AGENTS 内容 Hash 投影与实际内容一致；
- 自包含 real-Git fixture 不读取当前 workspace lifecycle/card；合法正例 PASS，
  corrupt/restore 与 moved-activation 攻击继续 FAIL；
- TASK-0055～TASK-0059 的标题、Hash、卡片、顺序和单父依赖投影完整；TASK-0049～TASK-0053
  各自以独立原子规划边 `SUPERSEDED` 并精确指向 replacement，静态正文不变且不进入 Task Ledger；
- R1/R2、Skill validation、定向/canonical、exact-SHA CI run 与五个 jobs 均绑定
  TASK-0054 精确候选；五个 jobs 全部 PASS；
- Evidence/Handoff、精确暂存 pre-closure、ACCEPTED 单父 closure、远端 `0/0` 与 clean 全部闭环；
  pre-closure 记录同一进程真实 stdout、退出码和耗时；
- 终态 `project-state.nextAction` 精确指向 TASK-0055；完成后停止，不晋级 TASK-0055。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行冻结定向矩阵、Windows
`quick_validate.py`、一次 `git diff --check` 与 DRAFT/READY Doctor；Reviewer PASS 后仅运行一次
candidate canonical。canonical 已包含的子命令不重复执行。

预计超过 60 秒的 Doctor、canonical 和 pre-closure 必须从启动时使用可持续 session/PTY 并保留同一
进程、stdout 和真实退出码；外层 yield/timeout 只能让出控制。若传输导致退出码不可恢复，记录
`NOT_RUN`/`UNKNOWN`，禁止启动重复进程或伪造 PASS。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。基于当前 Base 独立复核并做最小前向修改，
不得整包恢复旧任务状态。候选或首次 exact-SHA CI 失败只允许一批前向修复、R2 focused delta 和一次
replacement exact-SHA CI；不删测、不加 skip、不扩大 timeout、不弱化失败关闭。

## 停止条件

- 45 分钟仍无通过冻结短矩阵的精确 implementation Commit/Tree；
- 总墙钟达到 90 分钟：立即停止实现、修复、Reviewer、canonical 和 CI；若仓库仍 active 或半闭环，
  只允许 Evidence/Handoff、pre-closure、terminal commit、push、远端 `0/0` 的最小 closure-only
  overrun，单列时长和根因，期间禁止实现；
- R2 出现新的结构性 P0/P1，或需要 R3、第二批本地实现修复、第三批 CI；
- 必须扩大冻结 allowlist、验收，或实现任一明确范围外能力；
- 出现无法满足的权限、真实 Owner 决策闸门或有证据的 BLOCKED。

## Evidence Pack

输出到 `docs/evidence/TASK-0054/` 并生成 `docs/handoffs/TASK-0054.json`。Evidence 必须记录
implementation/terminal Commit 与 Tree、R1/R2、Skill validation、短矩阵/canonical、
TASK-0054 exact-SHA CI run 与五个 jobs、pre-closure 同一进程真实退出码、Backlog 0055～0059、
0049～0053 resolutions、实际 active wall-clock 以及 closure-only overrun 时长与根因（若有）。
