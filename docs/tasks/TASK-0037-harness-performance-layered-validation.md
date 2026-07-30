# TASK-0037：Harness 性能基线、分层验证与快照复用

```yaml
taskId: TASK-0037
state: IN_REVIEW
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 4f368e017967e617f94989d335b65b6921fda287e20f15ab47c894933039fe03
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: 46562b5df9485c575453d2dd9bde3261d8697b16
authorizationCommit: e26a151a4493c2f6e536340fba47f790e57c4694
contextFingerprint: 0d0c6a692055145bfedf7f5c8b5ec1d91f58127a9a9f10cd0ac43f44a39ebbf0
contextLock: docs/tasks/context/TASK-0037.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - .github/workflows/ci.yml
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/**
  - docs/tasks/**
  - docs/evidence/TASK-0012/**
  - docs/handoffs/TASK-0012.json
  - docs/schemas/**
  - requirements-harness.txt
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - docs/tasks/TASK-0037-harness-performance-layered-validation.md
  - docs/tasks/context/TASK-0037.context-lock.yaml
  - docs/tasks/TASK-0038-task-delivery-policy-skill-entrypoint.md
  - docs/tasks/TASK-0039-harness-timing-cross-filesystem-performance.md
  - docs/tasks/TASK-0040-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0041-harness-snapshot-receipt-evidence-gate.md
  - docs/evidence/TASK-0037/**
  - docs/handoffs/TASK-0037.json
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
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - skills/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
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
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/handoffs/TASK-0012.json
requiredInvariants:
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-006
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: Owner 明确授权 TASK-0037 立即进行纯技术拆分与本次 Harness 自举修复；仅修执行态 REJECTED 被误判为 planning-only、显式 lifecycle fixture、四张永久替代卡及唯一测试投影，禁止扩展到 idle planning checkpoint、AGENTS、Skill、CI、Schema、业务、Catalog 或 Contract。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0037
  - python -m unittest scripts.harness.tests.test_harness.BacklogTests.test_backlog_history_classifies_execution_rejected_and_planning_terminal_edges scripts.harness.tests.test_harness.BacklogTests.test_backlog_history_rejects_classification_reversals scripts.harness.tests.test_harness.BacklogTests.test_planning_terminal_rejects_dynamic_fields_or_missing_resolution scripts.harness.tests.test_harness.EnforcementTests.test_execution_rejected_requires_ledger_evidence_and_handoff scripts.harness.tests.test_harness.BacklogTests.test_backlog_registers_exact_technical_alpha_baseline scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.BacklogTests.test_backlog_derives_next_task_and_hard_gate_blockers scripts.harness.tests.test_harness.BacklogTests.test_planning_terminal_card_is_atomic_and_does_not_consume_task_ledger
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在不弱化失败关闭、精确 SHA Evidence、历史不可变性或跨平台保障的前提下，建立 Harness 性能基线、分层验证和相同输入快照的可审计复用，缩短治理任务与普通业务卡的反馈关键路径。

## 优先级原因与实测基线

TASK-0012 实测暴露出多轮全量 Harness、三种包装器和五路 CI 尾延迟会显著放大静态评审修复成本，因此本任务排在 TASK-0012 之后、TASK-0013 之前优先治理。

- 本地完整 Harness：119 项，674.036s；
- PowerShell canonical precheck：39,118 checks，174.037s；
- WSL canonical precheck 仅载入阶段：246.590s；
- GitHub Windows Harness 首轮：18m11s，job `90878411943`。

这些数值是 TASK-0012 的历史实测基线，不是 TASK-0037 的最终性能阈值。

## 范围内

- 增加分阶段计时、慢项报告以及同环境优化前后对比；
- 把迭代期定向检查与终态精确 SHA 全量验证分层；
- 为输入、命令、工具链、环境和外部状态完全相同的快照实现可审计复用；
- 评估并实现安全的路径感知 CI、包装器 smoke 与参考平台全量策略；
- 优化临时 Git 历史 fixture、Windows NTFS 和 WSL 跨盘扫描。

## 明确禁止

- 删除测试、增加跳过，或弱化失败关闭、精确 SHA Evidence、历史不可变性和跨平台保障；
- 用路径感知或快照复用跳过终态精确 SHA 全量验证；
- 复用无法证明全部输入身份相同的结果；
- 在 PLANNED 阶段提前冻结工具版本、精确命令或最终性能阈值；
- 实现 Provider、数据库、API、H5、身份、模型外发或其他业务功能。

## 依赖、闸门与晋级

- 依赖：TASK-0012 ACCEPTED；
- 决策闸门：无；
- 执行顺序：TASK-0012 后第一优先，先于 TASK-0013；
- 晋级条件：仓库空闲、依赖已 ACCEPTED、无未批准闸门，且为执行顺序首个可晋级任务。

## 验收标准

- 同一环境提供优化前后对比，测试删除数为零、跳过数不增加，并证明语义等价与失败关闭不变；
- 普通业务卡只冻结一个 canonical precheck 与受影响模块测试，跨平台包装器全量仅用于 Harness 或可移植性变更；
- 终态全量与 CI 继续绑定精确实现 SHA；
- 每次快照复用记录完整输入身份、命中原因和审计证据；
- 具体版本、动态命令和最终性能阈值在晋级唯一 DRAFT 时基于当时最新 main 冻结。

### DRAFT 动态冻结与处置结论

- Base Commit 精确冻结为 `46562b5df9485c575453d2dd9bde3261d8697b16`，即 fetch 后的 `origin/main`、TASK-0012 最后执行终态与本任务恢复后的共同快照；失败关闭旧历史 `3f7fe306ece42a714d1e12ee25f19f329460270b` 仅作恢复证据，不得成为新 `main` 祖先。
- Windows 本地 Python 3.12.9 的恢复基线 Doctor 为 49,384 checks、213.475s、PASS；定向回归 `test_backlog_projection_exposes_idle_order_and_repository_blockers` 在 Base 上真实 FAIL，因为测试把活动状态隐式绑定到当前 idle lifecycle。
- 原 TASK-0037 静态合同横跨交付策略、计时与跨文件系统性能、路径感知 CI、快照 receipt 与 Evidence 门禁，不能在单卡硬预算内安全交付。本卡不改写原静态合同、ID 或历史，以执行态 `REJECTED` 保留未完成范围并登记四张永久替代卡。
- 本次 Harness 自举修复仅修 Doctor 的 Backlog card-history 父边分类：执行态 `IN_REVIEW → REJECTED` 不得进入 planning-only snapshot/projection 校验；`PLANNED → REJECTED/SUPERSEDED` 仍保持六字段、`planningResolution`、无 Ledger/Evidence/Handoff 的 planning-only 语义。
- 不修改 `PLANNING_TERMINAL_STATES` 或 `is_planning_only_task()`；不实现 idle planning checkpoint。后者涉及 idle history、DRAFT/Base-Handoff 锚点与 terminal diff-scope 的组合语义，完整保留到 TASK-0038。

### 永久替代卡与静态关系

- TASK-0038：机器交付策略、双模式 Skill、AGENTS 薄入口及 idle planning-only 自举组合修复；依赖 TASK-0012。
- TASK-0039：阶段计时、慢项、Git-history fixture、NTFS/WSL 性能；依赖 TASK-0038。
- TASK-0040：path-aware CI、wrapper smoke 与 reference full；依赖 TASK-0039。
- TASK-0041：完整输入 snapshot receipt、可审计复用与 Evidence 门禁；依赖 TASK-0040。
- 四卡全部插入 TASK-0037 与 TASK-0013 之间；TASK-0013 原静态 dependency 与原 criticalPath 保持不变。TASK-0037 已进入执行 Ledger，不登记 planning-only resolution。

### 候选祖先与终态边界

- Backlog、四张规划卡、Doctor 与测试实现必须位于 reviewed candidate ancestor，并由 Reviewer 绑定精确 Commit/Tree。
- Reviewer PASS 后才运行一次 candidate canonical；提交前执行 `doctor.py --task TASK-0037 --pre-closure`。
- 终态必须是单父 `REJECTED` 提交，且只更新任务卡 schema 允许字段、`.harness/project-state.yaml`、`.harness/task-ledger.yaml`、TASK-0037 Evidence/Handoff；不得把 Backlog、四卡、Doctor 或测试留到终态提交。
- READY 后除 schema 允许的 `state`、`authorizationCommit`、`reviewers`、`resolutionReason` 外，不修改授权正文或冻结字段。

### 定向失败关闭矩阵

- execution REJECTED 与 planning-only REJECTED/SUPERSEDED 必须正确分类。
- execution REJECTED 缺 Ledger、Evidence 或 Handoff 必须失败。
- planning-only 夹带动态字段或缺 `planningResolution` 必须失败。
- `PLANNED →` 带动态字段的伪执行 REJECTED、执行态 → 伪 planning-only REJECTED、执行态 → SUPERSEDED 必须失败。
- 四卡 Hash、顺序、依赖、`nextPromotable` 必须确定；active 与 terminal 投影均使用显式 fixture，不依赖仓库当前 lifecycle state。
- 不删测、不加 skip、不增加 timeout、不弱化任何 fail-close。

### Reviewer、预算与停止条件

- 候选 Commit/Tree 形成后，在同一可见任务内使用无历史上下文的独立 Reviewer R1 一次性复核完整矩阵；最多一批集中修复，随后仅允许 R2 delta-only。
- 目标 60 分钟，90 分钟硬熔断；45 分钟仍无可评审候选即停止。
- 若出现超出已知 REJECTED 分类与显式 fixture 的第三类结构性 P1，或真实终态暴露新的 Harness 缺口，不做第三类扩张，保留证据并停止。
- 失败、超时、取消与 `NOT_RUN` 只记录真实状态，永不转换为 PASS。

### Evidence Pack

输出到 `docs/evidence/TASK-0037/`，并生成 `docs/handoffs/TASK-0037.json`。Handoff 必须明确未实现的四个后续切片、TASK-0038 的 idle planning checkpoint 组合修复，以及不得自动晋级 TASK-0038。
