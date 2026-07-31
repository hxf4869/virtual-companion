# TASK-0060：采纳保留机器交付实现并建立 TASK-0054 永久替代边

```yaml
taskId: TASK-0060
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: dedcc579617a5356198ac42e17de58f8e8f880f5
authorizationCommit: e50aafe927b3655b6642e3ecd6c0012362bda856
contextFingerprint: effb3bf858f8eb7018260a1c36340d04aa0e4162b5ea4f455a8ac357ec8e5ff3
contextLock: docs/tasks/context/TASK-0060.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0054/**
  - docs/handoffs/TASK-0054.json
  - docs/schemas/**
  - docs/tasks/**
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0060-permanent-adoption-retained-machine-delivery.md
  - docs/tasks/context/TASK-0060.context-lock.yaml
  - docs/evidence/TASK-0060/**
  - docs/handoffs/TASK-0060.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
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
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0054-adopt-machine-delivery-policy-cross-platform-ci.md
  - docs/tasks/context/TASK-0054.context-lock.yaml
  - docs/evidence/TASK-0054/**
  - docs/handoffs/TASK-0054.json
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - skills/**
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
  - docs/tasks/TASK-0054-adopt-machine-delivery-policy-cross-platform-ci.md
  - docs/tasks/context/TASK-0054.context-lock.yaml
  - docs/evidence/TASK-0054/evidence-pack.json
  - docs/evidence/TASK-0054/review-r1.md
  - docs/evidence/TASK-0054/review-r2.md
  - docs/handoffs/TASK-0054.json
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
    evidence: >-
      Owner 明确授权 TASK-0060 作为 TASK-0054 的永久 standalone replacement，在当前 main
      正式采纳 Base 中保留的机器交付策略、Skill 与 Harness 实现；仅修复 TASK-0055、0057、
      0058、0059 的永久标题冲突、把 TASK-0055 依赖从 REJECTED TASK-0054 重接到
      TASK-0060，并补充所需的规划 Hash、投影、精确失败关闭门禁、定向测试与独立 Reviewer。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0060
  - python -m unittest scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.BacklogTests.test_backlog_registers_exact_technical_alpha_baseline scripts.harness.tests.test_harness.BacklogTests.test_task0060_planning_repair_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_rejects_dependency_order_cycle_and_card_hash_drift scripts.harness.tests.test_harness.BacklogTests.test_backlog_derives_next_task_and_hard_gate_blockers scripts.harness.tests.test_harness.BacklogTests.test_backlog_history_preserves_ids_contracts_and_resolutions
  - git diff --check
```

## 背景与用户可观察目标

TASK-0054 已以真实 `REJECTED` 终态关闭。其 R2 对候选
`6d40835ca0ea505e5ab59e12f9c851881a273879` /
Tree `dbb95f3ffbf03175f0f271e73317a05a56265211` 的结论只作为风险线索；TASK-0054 的
Reviewer、定向测试、canonical 或其他动态证据均不得表示 TASK-0060 PASS。

当前 Base 保留了机器交付策略、`task-delivery-flow` 1.1.0、薄 AGENTS、Doctor/tests 和五张后继
PLANNED 卡。唯一已定位实现阻断是 TASK-0055、0057、0058、0059 与更早永久标题重复，且
TASK-0055 仍依赖 REJECTED TASK-0054。Owner 要求 TASK-0060 独立采纳保留实现，修复精确元数据，
重新建立 Reviewer、candidate canonical 与同 SHA 五作业 CI 证据；ACCEPTED 后唯一下一动作是
TASK-0055。

## 范围内

- 正式采纳 Base 中已保留的机器交付策略、`task-delivery-flow` Skill、薄 AGENTS、注册表、
  Doctor/tests 与跨平台 CI 合同，不重写其功能；
- 将 TASK-0055 标题改为 `Idle planning checkpoint 核心父边校验永久后继`；
- 将 TASK-0057 标题改为 `Harness 阶段计时与跨文件系统性能引擎永久后继`；
- 将 TASK-0058 标题改为 `Harness 路径感知 CI 与包装器平台策略永久后继`；
- 将 TASK-0059 标题改为 `Harness 内容寻址快照复用与 Evidence 门禁永久后继`；
- 同步四张 PLANNED 卡的标题、规划合同 Hash 与完整投影；TASK-0055 同时把依赖从
  TASK-0054 改为 TASK-0060，保持 `0055 -> 0056 -> 0057 -> 0058 -> 0059` 严格链；
- 只增加允许上述一次性、精确、原子修复并拒绝任意扩大改写的 Doctor 门禁与定向测试；
- 以 TASK-0060 卡、TASK-0054 的 REJECTED Ledger 事实、TASK-0055 的新依赖和终态
  Evidence/Handoff 共同保存 `TASK-0054 -> TASK-0060` 的永久替代关系与原因。

## 明确范围外

- 修改机器交付策略、Skill、AGENTS、入口、Sources、Invariants、workflow、CI 实现、生命周期、
  命令注册表、保护路径、Schema 或 TASK-0054 历史制品；
- 修改 TASK-0056，除非精确 Hash/依赖投影验证证明必要；
- 实现 TASK-0055～TASK-0059 的 checkpoint、四消费者、性能、路径感知 CI 或 snapshot receipt；
- 晋级 TASK-0055 或 TASK-0013；
- 任何产品、Provider、数据库、API、H5、身份、模型外发、真实 Key、Persona、安全政策或 Beta 工作。

## 输入和前置条件

- Base 固定为 `dedcc579617a5356198ac42e17de58f8e8f880f5`，Tree
  `022b73f430be949d7a4c7ad28c2aad9686b2e7b3`；创建前已 fetch 并确认
  `HEAD == origin/main`、ahead/behind `0/0`、分支 `main`、index/worktree clean；
- Base `activeTask=null`、`lastTerminalTask=TASK-0054`，TASK-0060 未被占用，按 standalone
  原始需求创建，不冒充 PLANNED 卡；
- 四个新标题已对当前 Backlog、当前任务卡和 Git 历史新增标题执行 ordinal 精确预检，均为零冲突；
- 当前 Base Doctor 的四个标题冲突是 TASK-0054 已保存的已知失败，不能转换为 DRAFT/READY PASS；
  早期 Doctor 若不具备新增信息则不重复调度，最终只接受 TASK-0060 新候选的真实 PASS；
- 复杂度闸门已评估：本卡是不可分割的单一 C4 采纳/元数据修复面，不实现后继能力；60 分钟目标、
  45 分钟候选截止和 90 分钟硬熔断保持不变。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或协议合同。机器交付策略与 Skill 内容保持 Base 字节不变。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、Doctor/tests 与离线 Git 历史；不读取凭据、真实用户数据或真实模型数据，
不访问真实供应商，不修改数据库、RLS、账号、容器、本机服务或权限范围。

## 状态机和失败行为

按 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 执行。DRAFT/READY Doctor 各至多一次；
Base 已知失败不得冒充 PASS，也不得重复运行来消耗预算。进入实现后先完成永久标题、依赖、Hash/投影与
一次性历史修复门禁，再运行冻结定向短矩阵。

候选进入 IN_REVIEW 后使用 `fork_turns=none` 的独立 Reviewer。R1 覆盖完整矩阵；最多一批修复，
如发生修复则同一 Reviewer 的 R2 仅核验 finding 闭环、delta、相邻风险和新增 P0/P1，禁止 R3。
Reviewer 不改文件、不运行昂贵全量测试、canonical 或 CI。

Reviewer PASS 后只运行一次 TASK-0060 candidate canonical；通过后推送精确候选 SHA，并取得同一 SHA
的 Backend、Frontend、Ubuntu Harness、Windows Harness、macOS Harness 五项真实终态。FAIL、
CANCELLED、TIMEOUT、NOT_RUN 或 UNKNOWN 均保持非 PASS。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入第二套任务、计划、
ADR、状态、Evidence、Handoff 或客户端规则副本，不新增付费插件或 SaaS-only 必需运行时。

## 验收标准

- 四个新标题对当前与历史永久标题集合均精确唯一，旧四个重复标题不再存在；
- TASK-0055、0057、0058、0059 的 Backlog 合同、卡片标题、`planningContractHash` 和六节投影一致；
  TASK-0056 内容与 Hash 不变；
- TASK-0054 保持 REJECTED 且历史制品字节不变；TASK-0055 唯一依赖 TASK-0060，后续严格链不变；
- 一次性历史修复门禁只接受四个精确标题变更和 TASK-0055 精确依赖变更，拆分、遗漏、额外字段、
  额外任务、错误标题、错误依赖或非授权 TASK-0060 状态均失败关闭；
- Base 中机器交付策略、Skill、AGENTS、注册表、Sources、Invariants 与 workflow 字节不变；
- 定向短矩阵、独立 R1/R2（如有）、唯一 candidate canonical 与同 SHA 五项 CI 全部真实 PASS；
- Evidence/Handoff、精确暂存 pre-closure、ACCEPTED 单父 closure、推送、远端 `0/0` 与 clean 闭环；
- 终态 `project-state.nextAction` 唯一指向 TASK-0055，TASK-0013 不得抢先。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行一次冻结定向矩阵和一次
`git diff --check`；系统 skill-creator 不运行，因为本任务不修改注册 Skill 或版本。Reviewer PASS 后
只运行一次 candidate canonical，canonical 已覆盖的子命令不重复。

预计超过 60 秒的 Doctor、canonical 和 pre-closure 必须从启动时使用可持续 session/PTY，保留同一
进程、完整 stdout 和真实退出码；外层 yield/timeout 只能让出控制，不能重启进程。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。只做精确前向修复；不得删除测试、增加 skip、
扩大 timeout、弱化永久 ID/规划合同历史或恢复 TASK-0054。R1 后最多一批修复和一次 R2。

## 停止条件

- 25 分钟 readiness gate 无法确认精确标题、依赖、Hash/投影与受控历史修复路径；
- 45 分钟仍无通过短矩阵的精确候选 Commit/Tree；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- candidate canonical 或 exact-SHA CI 无法在硬熔断前安全闭环；
- 总墙钟达到 90 分钟：停止实现、修复、Reviewer、canonical 和 CI，只允许策略规定的最小
  closure-only overrun，并单列时长与根因；
- 需要扩大 allowlist、修改任一明确范围外路径或进入真实 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0060/` 并生成 `docs/handoffs/TASK-0060.json`。Evidence 必须记录
Base、Context、四标题预检、DRAFT/READY 真实状态、候选 Commit/Tree、短矩阵、R1/R2、
candidate canonical、同 SHA 五项 CI、pre-closure、终态提交/Tree、总墙钟以及任何
closure-only overrun。
