# TASK-0061：修复 Backlog activation 根字段历史误判并永久替代 TASK-0060

```yaml
taskId: TASK-0061
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
baseCommit: 7fd8ede3047d67999a7821114f1febcb572553a2
authorizationCommit: 728ec614eeddaabfbdd4a0a5622d0251b59dfe64
contextFingerprint: 0a1943032e77318d90236d9f1071d786d47e123ab6929c3017240309e27de359
contextLock: docs/tasks/context/TASK-0061.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0060/**
  - docs/handoffs/TASK-0060.json
  - docs/schemas/**
  - docs/tasks/**
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0061-backlog-activation-history-permanent-replacement.md
  - docs/tasks/context/TASK-0061.context-lock.yaml
  - docs/evidence/TASK-0061/**
  - docs/handoffs/TASK-0061.json
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
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0060-permanent-adoption-retained-machine-delivery.md
  - docs/tasks/context/TASK-0060.context-lock.yaml
  - docs/evidence/TASK-0060/**
  - docs/handoffs/TASK-0060.json
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0060-permanent-adoption-retained-machine-delivery.md
  - docs/tasks/context/TASK-0060.context-lock.yaml
  - docs/evidence/TASK-0060/evidence-pack.json
  - docs/evidence/TASK-0060/review-r1.md
  - docs/evidence/TASK-0060/review-r2.md
  - docs/handoffs/TASK-0060.json
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
      Owner 明确授权 TASK-0061 作为已 REJECTED TASK-0060 的永久 standalone
      replacement；仅修复 Backlog activation 首次引入边的根字段伪 rewrite，
      保持真实父边 corrupt/restore 失败关闭，把 TASK-0055 依赖原子重接到
      TASK-0061，并完成定向测试、独立 Reviewer、唯一 canonical、同 SHA 五项
      CI 与终态 Evidence/Handoff。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0061
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_backlog_activation_introduction_skips_immutable_root_comparison scripts.harness.tests.test_harness.BacklogTests.test_backlog_clean_real_parent_history_edge_passes scripts.harness.tests.test_harness.BacklogTests.test_backlog_real_parent_root_corruption_and_restore_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0060_planning_repair_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0061_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_registers_exact_technical_alpha_baseline scripts.harness.tests.test_harness.BacklogTests.test_backlog_derives_next_task_and_hard_gate_blockers scripts.harness.tests.test_harness.BacklogTests.test_planned_cards_bind_backlog_without_dynamic_evidence
  - git diff --check
```

## 背景与用户可观察目标

TASK-0060 已以真实 `REJECTED` 终态关闭。它保留了四个永久唯一标题、规划 Hash
投影、`TASK-0055 -> TASK-0060` 依赖、`TASK-0054 -> TASK-0060` 一次性历史授权
以及真实父边根字段 corrupt/restore 门禁，但 R2 证明当前候选把相同根字段比较
错误应用于 Backlog 首次 activation 的无父引入边。

本任务以新的永久 ID 独立修复该边界，并将 `TASK-0055` 从 REJECTED 的
TASK-0060 原子重接到 TASK-0061。TASK-0060 的旧 Reviewer、测试和 pre-closure
仅作为失败输入，不得表示 TASK-0061 PASS。

## 范围内

- 让 `BACKLOG_IMMUTABLE_ROOT_FIELDS` 仅在真实父 Backlog 快照存在时比较；
- activation 首次引入使用的合成 `empty_backlog` 不产生根字段伪 rewrite；
- 真实父子边的根字段 corruption 及下一边 restoration 继续失败关闭；
- 增加 activation introduction、clean history、真实父边 corruption 和下一边
  restore 的定向正负回归；
- 保留 TASK-0054 到 TASK-0060 的历史修复边，并增加 TASK-0060 到 TASK-0061
  的唯一、精确、原子、已授权永久替代边；
- 仅把 TASK-0055 依赖从 TASK-0060 改为 TASK-0061，并同步其
  `planningContractHash` 与六节卡片投影；
- 保持四个永久标题、`0055 -> 0056 -> 0057 -> 0058 -> 0059` 严格链以及
  TASK-0056 和策略、Skill、AGENTS、workflow 的 Base blob 不变。

## 明确范围外

- 重写机器交付策略、Skill、AGENTS、workflow、生命周期、命令注册表、保护路径、
  Sources、Invariants、Schema 或 TASK-0060 历史制品；
- 修改 TASK-0056、TASK-0057、TASK-0058 或 TASK-0059；
- 实现 TASK-0055～TASK-0059 的业务或 Harness 后继能力；
- 晋级 TASK-0055 或 TASK-0013；
- 产品、Provider、数据库、API、H5、身份、真实 Key、Persona、安全政策或 Beta。

## 输入和前置条件

- Base 固定为 `7fd8ede3047d67999a7821114f1febcb572553a2`，Tree
  `ca3c92a0ed149197262acfdccfbd22eee1cc9527`；
- 创建前已 fetch 并确认 `main == origin/main`、ahead/behind `0/0`、
  index/worktree clean、`activeTask=null`；
- TASK-0060 为 REJECTED，TASK-0061 未被任何当前文件或 Git 历史占用；
- R2 P1 精确定位为 `validate_backlog_history_edge()` 无条件根字段比较与
  activation 合成父值之间的语义冲突；
- Base 确定继承该已知失败，DRAFT/READY Doctor 均记录
  `NOT_RUN/INHERITED_KNOWN_FAILURE`，不得冒充 PASS 或重复消耗 7～8 分钟；
- 复杂度闸门评估为一个不可拆的 C4 Backlog 历史边界修复面；预计 Reviewer
  小于 15 分钟、terminal check 小于 20 分钟、总墙钟目标 60 分钟。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或协议合同。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、Doctor/tests 与离线 Git 历史；不读取凭据、真实用户数据
或真实模型数据，不访问真实供应商，不修改数据库、服务、账号或权限范围。

## 状态机和失败行为

按 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 严格闭环。
DRAFT/READY 的已知 activation 失败只记录为
`NOT_RUN/INHERITED_KNOWN_FAILURE`，唯一候选 canonical 决定新实现是否有效；
若机器合同拒绝该晋级方式，必须以代码证据失败关闭。

进入 IN_REVIEW 后使用 `fork_turns=none` 独立 Reviewer。R1 覆盖完整矩阵；
最多一批修复，并仅由同一 Reviewer 执行 R2 delta，禁止 R3。Reviewer PASS 后
只运行一次 candidate canonical；通过后只接受同一精确候选 SHA 的 Backend、
Frontend、Ubuntu Harness、Windows Harness、macOS Harness 五项真实终态。

所有预计超过 60 秒的 Doctor、canonical 和 pre-closure 必须从启动时使用可持续
PTY/session，保留同一进程、stdout 和真实退出码；若当前执行工具不能返回
session 标识，则停止该命令路径并据实记录，不得用后台 PID、外层 timeout、
替代重跑或推断结果。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套任务、计划、ADR、状态、Evidence、Handoff 或客户端规则副本。

## 验收标准

- activation introduction PASS，clean history PASS；
- 真实父边根字段 corruption FAIL，下一边 restoration FAIL；
- TASK-0054 到 TASK-0060 的历史修复仍可验证，TASK-0060 到 TASK-0061
  只有一个精确授权修复边；
- TASK-0055 唯一依赖 TASK-0061，规划 Hash 与卡片投影一致；
- 四个永久标题无冲突，TASK-0055、0057、0058、0059 四张规划卡 Hash 一致；
- `nextPromotable=TASK-0055`，TASK-0013 继续等待执行顺序；
- TASK-0056 与 policy、Skill、AGENTS、workflow 保持 Base blob；
- 定向矩阵、`git diff --check`、独立 Reviewer、唯一 canonical、同 SHA 五项 CI
  均真实 PASS；
- Evidence/Handoff、唯一 PTY pre-closure、ACCEPTED 单父 closure、推送、远端
  `0/0` 与 clean 闭环，终态 nextAction 唯一指向 TASK-0055。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行一次冻结定向
矩阵和一次 `git diff --check`；Reviewer PASS 后只运行一次 candidate canonical，
canonical 已覆盖的子命令不重复。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。只做精确前向修复；
不得删除测试、增加 skip、扩大 timeout、弱化历史不可变或恢复 TASK-0060。

## 停止条件

- 墙钟 20 分钟仍无法完成 readiness；
- 墙钟 35 分钟仍无通过短矩阵的精确候选 Commit/Tree；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- candidate canonical 或 exact-SHA CI 无法在 90 分钟硬熔断前安全闭环；
- 总墙钟达到 90 分钟：停止实现、修复、Reviewer、canonical 和 CI，仅允许策略
  规定的最小 closure-only overrun；
- 需要扩大 allowlist、修改范围外路径或进入真实 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0061/` 并生成
`docs/handoffs/TASK-0061.json`。Evidence 必须记录 Base、Context、
DRAFT/READY 的继承已知失败、候选 Commit/Tree、短矩阵、R1/R2、唯一 canonical、
同 SHA 五项 CI、唯一 pre-closure、终态提交/Tree、总墙钟和任何 closure-only
overrun。
