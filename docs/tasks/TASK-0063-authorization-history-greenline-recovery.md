# TASK-0063：恢复授权历史绿线并永久替代 TASK-0062

```yaml
taskId: TASK-0063
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: a328a02c72e5cfb7bc784e7a083caaaf8cffe08c
authorizationCommit: ""
contextFingerprint: b32f01cb9e04a2985398190422b5302f4eef2bbcc7f3ef653e3dc137b44e3dbb
contextLock: docs/tasks/context/TASK-0063.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
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
  surfaceId: HARNESS_AUTHORIZATION_HISTORY_GREENLINE_RECOVERY
  policySurface: HISTORY
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesObserved: 12.9
  estimatedWallMinutes: 60
  splitRequired: false
  indivisibleReason: >-
    TASK-0062 的精确 REJECTED 授权投影隔离与 TASK-0012 真实 amendment bootstrap
    都属于同一条 Harness authorization-history 验证绿线；任意拆半都会保留另一条
    已知 canonical error，使半卡无法独立取得 canonical PASS/ACCEPTED。TASK-0055
    重接仅是永久替代结果的原子 Backlog 投影，不实现第二风险面。
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0062/**
  - docs/handoffs/TASK-0062.json
  - docs/schemas/**
  - docs/tasks/**
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0063-authorization-history-greenline-recovery.md
  - docs/tasks/context/TASK-0063.context-lock.yaml
  - docs/evidence/TASK-0063/**
  - docs/handoffs/TASK-0063.json
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
  - docs/tasks/TASK-0061-backlog-activation-history-permanent-replacement.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/context/TASK-0060.context-lock.yaml
  - docs/tasks/context/TASK-0061.context-lock.yaml
  - docs/tasks/context/TASK-0062.context-lock.yaml
  - docs/evidence/TASK-0060/**
  - docs/evidence/TASK-0061/**
  - docs/evidence/TASK-0062/**
  - docs/handoffs/TASK-0060.json
  - docs/handoffs/TASK-0061.json
  - docs/handoffs/TASK-0062.json
  - skills/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
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
  - scripts/harness/durable_command.ps1
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0061-backlog-activation-history-permanent-replacement.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/context/TASK-0062.context-lock.yaml
  - docs/evidence/TASK-0062/evidence-pack.json
  - docs/evidence/TASK-0062/review-r1.md
  - docs/handoffs/TASK-0062.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
  - INV-HARNESS-008
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: >-
      Owner 明确授权 TASK-0063 作为已 REJECTED TASK-0062 的全新永久 standalone
      replacement：在不修改 task-delivery-policy 的前提下，以一个不可拆的 C4
      Harness authorization-history greenline recovery 面同时封闭 TASK-0062 的
      精确 REJECTED 历史投影和 TASK-0012 真实 amendment bootstrap 两类 Base
      error，正式采纳 Base 已保留的 durable receipt、task-delivery-policy、
      task-delivery-flow 1.2.0 与 Harness 实现；将 TASK-0055 原子重接到 TASK-0063，
      完成独立 Reviewer、唯一 candidate canonical、精确 SHA 五平台 CI 与终态闭环。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0063
  - python -m unittest scripts.harness.tests.test_harness.DurableCommandTests scripts.harness.tests.test_harness.DeliveryPolicyTests scripts.harness.tests.test_harness.BacklogTests.test_task0062_rejected_authorization_projection_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0012_owner_amendment_real_history_edge_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_activation_introduction_skips_immutable_root_comparison scripts.harness.tests.test_harness.BacklogTests.test_backlog_clean_real_parent_history_edge_passes scripts.harness.tests.test_harness.BacklogTests.test_backlog_real_parent_root_corruption_and_restore_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0060_planning_repair_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0061_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0062_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0063_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_registers_exact_technical_alpha_baseline scripts.harness.tests.test_harness.BacklogTests.test_backlog_derives_next_task_and_hard_gate_blockers scripts.harness.tests.test_harness.BacklogTests.test_planned_cards_bind_backlog_without_dynamic_evidence scripts.harness.tests.test_harness.ValidationFlowTests.test_agent_rules_define_snapshot_reuse_and_low_frequency_polling scripts.harness.tests.test_harness.IntegrationTests.test_command_registry_is_consumed_without_shell_commands
  - git diff --check
```

## 背景与用户可观察目标

TASK-0062 已以真实 `REJECTED` 终态关闭。它在 Base 中保留了 PowerShell 7
durable atomic receipt helper、唯一机器交付策略、`task-delivery-flow` 1.2.0、
Commands/Sources/Invariants/Doctor/tests 和规划替代链实现；其 19 项定向矩阵通过，
独立 R1 除授权历史外未发现新问题，但候选把 READY 冻结正文中的候选截止从
35 分钟改为 45 分钟，形成不可追溯修复的历史违规，故未运行 canonical 或 CI。

本任务以新的永久 ID 对该保留实现重新授权、独立复核和精确 SHA 验证。它只增加
两处互锁的绿线恢复：极窄隔离 TASK-0062 已 REJECTED 的唯一已知投影违规，并让
TASK-0012 的 amendment authority bootstrap 同时接受真实父快照根字段缺失和严格
空对象。成功后 TASK-0055 唯一依赖 TASK-0063，下一动作唯一指向 TASK-0055。

## 范围内

- 保持 Base 中 `durable_command.ps1`、task-delivery-policy、Commands、Sources、
  Invariants、Skill 1.2.0 与其失败关闭测试字节不变，以本任务 Reviewer、
  candidate canonical 和 exact-SHA CI 正式采纳；
- 仅隔离 TASK-0062 卡路径在 READY authorization
  `174c6180c15d9c6b6e56198974029acf3865419e` 之后、首次违规 commit
  `7163dd7f529fc00352b322e6f7b53201e43b6ad2` 引入的唯一 `35 -> 45`
  authorization projection 差异；
- 固定授权前 projection SHA-256
  `09ad0b20460224da488d4b7d3cbc32f3178aafda6215f53d38b3943691c05f5e`
  与违规后 projection SHA-256
  `6646218d220980e6d0fe0aaee03a81f17ba2fc57d69308dcb003aba8d50dd0e3`；
  只允许停止条件行中一次精确替换，不把 TASK-0062 表示为已授权或 ACCEPTED；
- 隔离成立还必须同时绑定 TASK-0062 `REJECTED`、既有 Ledger、终态 commit
  `a328a02c72e5cfb7bc784e7a083caaaf8cffe08c`、Evidence、Handoff 和 R1 `FAIL`；
  当前卡/Evidence/Handoff/R1 SHA-256 分别固定为
  `05361d87d1f714709ec44aa36a9a9a663f8fdffce4eb38a9d45c3442ee7c026a`、
  `2743fa5a6811b665fe1f7886e239ff9ffe6baa54b77b7551958b526f7221e23f`、
  `4118884005a1b88c90c425cb3fd69686bc45c59b11c8c10beede88ffb70faea3`、
  `6912f809d9e2e0f54a9a8535e68530b693ec41b6588613ac33639e43a690d668`；
- 对真实 `2a55335e695c8fc5434c0dbc867288842c804e74` →
  `1b9eafd46649b76ab1a1b4e93f8cba8feaa7d6ad` 父边，允许父
  `authorizationAmendments` 根字段完全缺失或严格空对象；`null`、list、非空对象、
  错误 `authority.owns`、错误边、额外 authority 字段及改写既有 amendment
  全部失败关闭；
- 保留 TASK-0054 → TASK-0060 → TASK-0061 → TASK-0062 历史，新增唯一
  TASK-0062 → TASK-0063 永久替代边；仅把 TASK-0055 依赖从 TASK-0062
  原子重接到 TASK-0063，并同步 Backlog、规划卡六节投影、Hash、Doctor
  常量和测试；
- 保持 TASK-0055 → TASK-0056 → TASK-0057 → TASK-0058 → TASK-0059
  严格单父链，TASK-0013 不得抢先。

## 明确范围外

- 修改或放宽 `.harness/task-delivery-policy.yaml`、Skill、durable helper、
  Commands、Sources、Invariants、AGENTS、workflow、生命周期、保护路径或 Schema；
- 泛化 SHA 白名单、允许其他 REJECTED 卡正文变化、追溯授权 TASK-0062、改写
  TASK-0062 历史或其 Evidence/Handoff/R1；
- 实现或晋级 TASK-0055～TASK-0059 或 TASK-0013；
- 产品、Provider、数据库、API、H5、身份、真实模型、凭据、Persona、安全政策、
  外发或 Beta。

## 输入和前置条件

- Base 固定为 `a328a02c72e5cfb7bc784e7a083caaaf8cffe08c`，Tree
  `5f3be68be769945b9485e29545f740d7dc0f6054`；创建前已 fetch 并确认
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean、
  `activeTask=null`；
- TASK-0062 为 REJECTED，TASK-0063 未被当前文件或 Git 历史占用；
- 系统 TEMP、无仓库副作用的 PowerShell 7.6.3 exit-7 smoke 已 PASS：
  executable/argv/cwd 均含空格，stdout/stderr 各 2,049 行，真实 exit 7，
  Launch 返回时 receipt 不存在，最终同目录原子发布且 `receipt.tmp` 消失；
- 复杂度按 TASK-0061 已审阅先例评估为一个不可拆的 C4 Harness
  authorization-history greenline recovery 面；distinct=1，Reviewer 预计
  12 分钟，terminal check 已实测约 12.9 分钟，总墙钟预计 60 分钟，均未触发
  `splitWhen`；
- Base 已知继承 TASK-0062 pre-closure 的三条错误；DRAFT/READY 不重复运行同一
  已知失败 Doctor，也不把它表示为 PASS。唯一候选 canonical 必须同时消除两类
  绿线错误。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或协议合同。TASK-0062 隔离只是一个精确
历史审计事实，不产生新授权、Owner amendment、状态转换或通用兼容层。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、离线 Git 历史和合成命令输出；不读取凭据、真实用户数据或
模型数据，不访问真实供应商，不修改数据库、服务、账号、容器或权限范围。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY 授权
提交后，只修改 lifecycle 明确允许的 `state`、`authorizationCommit`、`reviewers`
和终态字段；标题、正文、全部 immutable metadata 与
`task_authorization_projection` 字节保持不变。

IN_REVIEW 后启动 `fork_turns=none` 独立 Reviewer。R1 覆盖完整矩阵；R1 无阻断
不运行 R2。若有阻断，最多一批前向修复，同一 Reviewer 的 R2 只查 finding
closure、delta、adjacent risk 和新 P0/P1；禁止 R3。R2 出现新结构性 P0/P1
立即停止并 REJECTED。

顺序固定为 TARGETED → candidate Commit/Tree → R1 → 可选单批修复/R2 →
唯一 candidate canonical → exact-SHA 五平台 CI → 唯一 pre-closure →
单父 terminal commit/push/remote 0/0。Reviewer FAIL 时禁止 canonical/CI。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套任务、计划、ADR、状态、Evidence、Handoff 或客户端规则副本。所有 durable
request/config/stdout/stderr/receipt 只位于唯一系统 TEMP 目录且不得提交。

## 验收标准

- TASK-0062 隔离只接受固定 ID、路径、authorization commit、首次违规 commit、
  两个 projection Hash 和唯一 35→45 文本差异；任一 ID/路径/SHA/Hash/文本、
  终态或绑定产物变化均失败；
- TASK-0062 必须保持 REJECTED，Ledger、Evidence、Handoff 和 R1 FAIL 精确绑定；
  另一 REJECTED 卡正文变化继续失败，普通 READY 后正文不可变规则不放宽；
- TASK-0012 真实父边与严格空对象兼容正例通过；根字段 `null`、list、非空对象、
  错误 owns、错误边、额外字段、corruption/restoration 和既有 amendment
  改写负例全部失败；
- Base 保留的 durable helper、policy、Skill 1.2.0、Commands、Sources、
  Invariants 和测试保持字节不变并通过本任务独立 Reviewer、唯一 canonical 与
  exact-SHA CI；
- TASK-0054 → TASK-0060 → TASK-0061 → TASK-0062 → TASK-0063
  永久替代历史唯一且精确；TASK-0055 唯一依赖 TASK-0063，规划 Hash/六节卡片
  投影一致，0055～0059 严格链不变；
- ACCEPTED 后 `nextPromotable` 和 `project-state.nextAction` 唯一指向
  TASK-0055，TASK-0013 继续等待；
- 冻结定向矩阵、一次 `git diff --check`、R1/可选 R2、唯一 canonical、同一
  候选 SHA 五项 CI、唯一 pre-closure、单父 ACCEPTED closure、push 与远端
  `0/0`/clean 全部真实 PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。Reviewer 前只运行一次冻结定向矩阵
和一次 `git diff --check`；Reviewer PASS 后只运行一次 candidate canonical。
canonical 已覆盖的子命令不重复。

预计超过 60 秒的 Doctor、canonical 和 pre-closure 使用本次 smoke PASS 的
`scripts/harness/durable_command.ps1`，每条命令只启动一次；约 60 秒只检查
`receipt.json` 是否存在，发布前不查 PID/status/log，不并发探测、不重复执行；
发布后只读取一次 receipt 与完整 stdout/stderr，真实 inner exit 决定结果。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。只做精确前向修复；
不得恢复或改写 TASK-0062，不删测、不加 skip、不扩大 timeout、不放宽普通历史
不可变性或追加泛化 SHA 例外。

## 停止条件

- 墙钟 20 分钟仍无法完成 readiness；
- 墙钟 45 分钟仍无通过冻结定向矩阵的精确 candidate Commit/Tree；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- candidate canonical 或 exact-SHA CI 无法在 90 分钟硬熔断前安全闭环；
- 总墙钟达到 90 分钟：立即停止实现、修复、Reviewer、canonical 和 CI，只允许
  Evidence/Handoff、一次 pre-closure、terminal commit、push、远端 0/0 的
  closure-only overrun，并单列时长和根因；
- 需要扩大 allowlist、修改冻结标题/正文/immutable metadata、放宽 Policy、
  修改范围外路径或进入真实 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0063/` 并生成 `docs/handoffs/TASK-0063.json`。
Evidence 必须记录 Base、Context、复杂度评估、TEMP smoke、DRAFT/READY 已知
Base 失败去重、候选 Commit/Tree、定向矩阵、R1/R2、唯一 canonical、同 SHA
五项 CI、唯一 pre-closure、终态提交/Tree、总墙钟及任何 closure-only overrun。
