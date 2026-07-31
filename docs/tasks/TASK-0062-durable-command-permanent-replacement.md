# TASK-0062：固化 Durable Atomic Receipt 并永久替代 TASK-0061

```yaml
taskId: TASK-0062
state: IN_REVIEW
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions:
  task-delivery-flow: 1.2.0
baseCommit: 8579df81a3b453b26bf297ddb6bf4ef48efa8393
authorizationCommit: 174c6180c15d9c6b6e56198974029acf3865419e
contextFingerprint: 7d346b97b56310e916a50f19ae2265cb09385ba7fa7f07b4e4f72dcad888af97
contextLock: docs/tasks/context/TASK-0062.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0061/**
  - docs/handoffs/TASK-0061.json
  - docs/schemas/**
  - docs/tasks/**
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/context/TASK-0062.context-lock.yaml
  - docs/evidence/TASK-0062/**
  - docs/handoffs/TASK-0062.json
  - scripts/harness/durable_command.ps1
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-delivery-flow/SKILL.md
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0060-permanent-adoption-retained-machine-delivery.md
  - docs/tasks/TASK-0061-backlog-activation-history-permanent-replacement.md
  - docs/tasks/context/TASK-0060.context-lock.yaml
  - docs/tasks/context/TASK-0061.context-lock.yaml
  - docs/evidence/TASK-0060/**
  - docs/evidence/TASK-0061/**
  - docs/handoffs/TASK-0060.json
  - docs/handoffs/TASK-0061.json
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0061-backlog-activation-history-permanent-replacement.md
  - docs/tasks/context/TASK-0061.context-lock.yaml
  - docs/evidence/TASK-0061/evidence-pack.json
  - docs/evidence/TASK-0061/review-r1.md
  - docs/handoffs/TASK-0061.json
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
      Owner 明确授权 TASK-0062 作为已 REJECTED TASK-0061 的永久 standalone
      replacement：正式采纳其已通过独立 R1 的 activation/真实父边历史修复，
      将 TASK-0055 原子重接到 TASK-0062，并把经系统 TEMP exit-7 smoke 证明的
      PowerShell 7 durable atomic receipt transport 固化为唯一机器策略、注册
      helper、task-delivery-flow 1.2.0、Doctor 与失败关闭测试；完成独立 Reviewer、
      唯一 candidate canonical、同 SHA 五项 CI 和终态闭环。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0062
  - python -m unittest scripts.harness.tests.test_harness.DurableCommandTests scripts.harness.tests.test_harness.DeliveryPolicyTests scripts.harness.tests.test_harness.BacklogTests.test_backlog_activation_introduction_skips_immutable_root_comparison scripts.harness.tests.test_harness.BacklogTests.test_backlog_clean_real_parent_history_edge_passes scripts.harness.tests.test_harness.BacklogTests.test_backlog_real_parent_root_corruption_and_restore_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0012_owner_amendment_history_edge_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0060_planning_repair_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0061_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0062_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_registers_exact_technical_alpha_baseline scripts.harness.tests.test_harness.BacklogTests.test_backlog_derives_next_task_and_hard_gate_blockers scripts.harness.tests.test_harness.BacklogTests.test_planned_cards_bind_backlog_without_dynamic_evidence scripts.harness.tests.test_harness.ValidationFlowTests.test_agent_rules_define_snapshot_reuse_and_low_frequency_polling scripts.harness.tests.test_harness.IntegrationTests.test_command_registry_is_consumed_without_shell_commands
  - git diff --check
```

## 背景与用户可观察目标

TASK-0061 的候选实现、八项短矩阵和 fork_turns=none 独立 R1 均已通过，但其
canonical 与替代 smoke 都没有原子 receipt，真实 inner exit 无法恢复，故该卡
已按事实 REJECTED。TASK-0062 以新的永久 ID 采纳已审阅实现，并把已在仓库外
独立证明可用的 transport 固化为仓库内唯一、可复用、失败关闭的实现。

## 范围内

- 保留 TASK-0061 已通过 R1 的 activation introduction、真实父边 corruption/
  restore、四个永久唯一标题和完整规划 Hash 修复，不重写产品或历史修复算法；
- 对 Base Doctor 新暴露的 TASK-0012 强类型 Owner amendment 引入边，按
  `authorizationAmendments` 受控可变根的单次 bootstrap 合同校验 `authority.owns`
  的精确追加；不得按 Commit SHA 开宽泛例外，其他真实父边的 `authority`
  corruption/restore 继续失败关闭；
- 保留 `TASK-0054 -> TASK-0060 -> TASK-0061` 历史，新增唯一
  `TASK-0061 -> TASK-0062` 永久替代边，并将 TASK-0055 唯一依赖原子改为
  TASK-0062；
- 新增 PowerShell 7 durable command helper，明确 launch/worker/config/receipt
  合同、精确 argv 数组、并发双流排空、真实 inner exit、输出关闭后同目录原子
  receipt 和每次执行唯一 TEMP 目录；
- 在唯一 policy、Skill 1.2.0、Skill/Command/Source/Invariant 注册、Doctor 和
  定向测试中失败关闭地约束 direct persistent session/PTY 优先与
  DURABLE_ATOMIC_RECEIPT 后备；
- 覆盖含空格 executable/argv/cwd、并发 stdout/stderr、exit 7、输出完整性、
  `receipt.tmp` 消失、缺失/错误 config、PowerShell 5.1 禁止回退以及非 Windows
  必须使用 direct transport 或明确失败。

## 明确范围外

- 实现 TASK-0055～TASK-0059 的 checkpoint、消费者、性能、路径感知 CI 或
  snapshot receipt 业务内容；
- 修改产品代码、API、数据库、Catalog、协议、Provider、身份、Persona、安全
  政策、真实凭据、真实外发或 Beta；
- 修改 AGENTS、workflow、生命周期、保护路径、Schema、现有历史 Evidence/
  Handoff 或任何全局文件；
- 晋级 TASK-0055 或 TASK-0013。

## 输入和前置条件

- Base 固定为 `8579df81a3b453b26bf297ddb6bf4ef48efa8393`，Tree
  `fbe59e55def9dbf6ec119c6ca2de1f10c7d3ade9`；
- 创建前已 fetch/pull 并确认 `main == origin/main`、ahead/behind `0/0`、
  index/worktree clean、`activeTask=null`；
- TASK-0061 已真实 REJECTED；其候选 `b42140480aa47613800efe878ec5924d88dfbafe`
  / Tree `95c46c593a51452df59cd4b269ce740f310b676b` 的旧短矩阵和 R1 只作为采用输入，
  不得表示 TASK-0062 PASS；
- 正式修改前的系统 TEMP exit-7 transport smoke 已独立通过：外层
  UTF-16LE EncodedCommand、隐藏窗口、worker config、ArgumentList、并发双流、
  真实 exit 7、输出关闭、Flush(true) 与同目录 File.Move 均已取证；
- Base 没有已注册的 durable helper；DRAFT Doctor 的失败已由原子 receipt 完整
  回收，READY 对同一已知失败快照如实记录
  `NOT_RUN/DEDUPLICATED_KNOWN_FAILURE`（不是 PASS），不得复用旧 PASS；候选必须
  使用新注册 helper 得到自己的 canonical。
- 本卡 DRAFT Doctor 由已通过 smoke 的 TEMP transport 真实执行并以原子 receipt
  回收 `exit=1`；它暴露了两个 Base 继承失败：TASK-0012 Owner amendment 引入
  `authority.owns` 的历史边被误判，以及 TASK-0061 不可恢复结果使用
  `FAIL + RESULT_UNRECOVERABLE + null exitCode` 与旧 Doctor 语义冲突。READY
  不重复消耗该已知 Base 快照；候选必须以前向代码和测试消除两项失败。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或协议合同。新增的本地 transport 只接受
JSON request/config，receipt 仅表达本地进程执行终态、真实 exit 与输出文件身份，
不能成为 Python canonical 或 Evidence PASS 的别名。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、离线 Git 历史和合成命令输出；不读取凭据、真实用户数据或
真实模型数据，不访问真实供应商，不修改数据库、服务、账号或权限范围。

## 状态机和失败行为

按 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 严格闭环。
direct persistent session/PTY 可用时必须优先使用；工具面缺失时，只有本次正式
smoke 已 PASS 的 PowerShell 7 DURABLE_ATOMIC_RECEIPT 才能启动昂贵命令。每个
长命令只能启动一次，约 55～60 秒只检查 receipt 是否存在；禁止 PID、ps、status、
日志 tail、重复读取或重复执行。receipt 缺失、无效、身份不符或真实 exit 不可得
一律 UNKNOWN/FAIL，绝不推断 PASS。

IN_REVIEW 后使用 `fork_turns=none` 独立 Reviewer。R1 覆盖完整矩阵；最多一批
修复，并仅由同一 Reviewer 执行 R2 delta，禁止 R3。Reviewer PASS 后只运行一次
candidate canonical；通过后只接受同一候选 SHA 的 Backend、Frontend、Ubuntu、
Windows、macOS 五项真实 CI。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套任务、计划、ADR、状态、Evidence、Handoff 或客户端规则副本。临时 request、
config、stdout、stderr 与 receipt 只位于唯一系统 TEMP 目录，取证后安全清理且
不得提交。

## 验收标准

- 新 helper 的 launch/worker/config/receipt 合同与策略注册一致；精确 argv 不经
  字符串拼接，stdout/stderr 并发排空，真实 inner exit 被保留，输出 flush/close
  后才以同目录 `receipt.tmp -> receipt.json` 原子发布；
- helper 正负 smoke 覆盖含空格 executable/argv/cwd、双流、exit 7、最终 marker、
  输出 Hash/长度、临时 receipt 消失、缺失/错误 config 和 PowerShell 5.1 不回退；
- policy 明确 direct transport 优先，durable fallback 仅在 direct 缺失且 smoke
  PASS 时可用；非 Windows 只能 direct 或明确失败，缺 receipt 永远非 PASS；
- Skill 以 1.2.0 精确注册并给出可执行 helper 入口；Commands、Sources、
  Invariants、Doctor 和测试形成唯一投影，完整文件 Hash/结构校验阻止追加相反例外；
- TASK-0012 Owner amendment 的唯一受控根 bootstrap 引入边通过，任何其他
  authority 根字段 corruption 及下一边 restoration 仍失败；只兼容不可改写的
  遗留 `FAIL + RESULT_UNRECOVERABLE + null exitCode + null artifactHash` 投影，
  普通 FAIL 仍必须有非零整数退出码，PASS 仍只允许 exit 0；
- activation introduction 与 clean history PASS；真实父边 corruption 和下一边
  restoration 均失败关闭；
- `TASK-0054 -> TASK-0060 -> TASK-0061 -> TASK-0062` 历史唯一且精确；
  TASK-0055 唯一依赖 TASK-0062，四个永久标题、0055～0059 严格链、0056 Base
  blob、四张规划卡 Hash 均一致；
- ACCEPTED 后 `nextPromotable` 与 `project-state.nextAction` 唯一为 TASK-0055，
  TASK-0013 继续等待执行顺序；
- 定向矩阵、`git diff --check`、独立 Reviewer、唯一 canonical、同 SHA 五项 CI、
  唯一 pre-closure、ACCEPTED 单父 closure、推送和远端 `0/0` 全部真实 PASS。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行一次冻结定向矩阵
和一次 `git diff --check`；Reviewer PASS 后只运行一次 candidate canonical，
canonical 已覆盖的子命令不重复。TEMP transport smoke 是启动门，不是 candidate
PASS。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。只做精确前向修复；
不得删除测试、增加 skip、扩大 timeout、弱化历史不可变、恢复 TASK-0061 或把
无 receipt 结果转换为 PASS。

## 停止条件

- 墙钟 20 分钟仍无法完成 readiness；
- 墙钟 45 分钟仍无通过 runner 自测、历史/Hash/Skill/Policy/Doctor/负例和 diff
  短矩阵的精确候选 Commit/Tree；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- candidate canonical 或 exact-SHA CI 无法在 90 分钟硬熔断前安全闭环；
- 总墙钟达到 90 分钟：停止实现、修复、Reviewer、canonical 和 CI，仅允许策略
  规定的最小 closure-only overrun；
- 需要扩大 allowlist、修改范围外路径或进入真实 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0062/` 并生成 `docs/handoffs/TASK-0062.json`。
Evidence 必须记录 Base、Context、TEMP 启动 smoke、DRAFT/READY 的真实状态、
候选 Commit/Tree、定向矩阵、R1/R2、唯一 canonical、同 SHA 五项 CI、唯一
pre-closure、终态提交/Tree、总墙钟以及任何 closure-only overrun。
