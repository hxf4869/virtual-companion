# TASK-0010：优化 Harness 验证流程与全量扫描性能

```yaml
taskId: TASK-0010
state: IN_PROGRESS
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.1.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: 5b459750b545afe399755ebb40f03b78dcc6d29c
authorizationCommit: 7cac05e11782f6e3d67efa3e1f346c01ef7d42db
contextFingerprint: 3b68447c31d969e71106322f04dc38fb650ad3104743cca4baddf0f24f8b3121
contextLock: docs/tasks/context/TASK-0010.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/workflows/ci.yml
  - .harness/**
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/**
  - requirements-harness.txt
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/tasks/**
  - docs/schemas/**
  - docs/evidence/TASK-0009/**
  - docs/handoffs/TASK-0009.json
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0010-harness-validation-flow-performance.md
  - docs/tasks/context/TASK-0010.context-lock.yaml
  - docs/evidence/TASK-0010/**
  - docs/handoffs/TASK-0010.json
  - AGENTS.md
  - .harness/agent-entrypoints.yaml
  - scripts/harness/harness_common.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - docs/tasks/task-card-template.md
  - docs/engineering/agent-onboarding.md
forbiddenPaths:
  - CLAUDE.md
  - .github/copilot-instructions.md
  - .github/workflows/**
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/tools.lock.yaml
  - .harness/license-policy.yaml
  - skills/**
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - requirements-harness.txt
  - docs/schemas/**
  - docs/decisions/**
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
sourcesOfTruth:
  - AGENTS.md
  - .github/workflows/ci.yml
  - .harness/project-state.yaml
  - .harness/task-lifecycle.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - .harness/agent-entrypoints.yaml
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/harness_common.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/tasks/task-card-template.md
  - docs/decisions/0003-portable-agent-harness.md
  - docs/engineering/agent-onboarding.md
  - docs/evidence/TASK-0009/evidence-pack.json
  - docs/handoffs/TASK-0009.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: 2026-07-30
    evidence: 用户明确要求优化过重的全量扫描流程，保留必跑检查但不额外重复已经通过的全量扫描，并降低长命令轮询频率
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/doctor.py --task TASK-0010
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - python scripts/harness/precheck.py --task TASK-0010
  - powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1 -Task TASK-0010
  - wsl.exe -d Ubuntu-24.04 -- bash scripts/harness/precheck.sh --task TASK-0010
  - git diff --check
```

## 背景与用户可观察目标

当前空闲仓库在 Windows 上单次 `doctor.py --summary` 实测约 342 秒并执行 25,155 项检查。任务模板默认同时要求独立 Doctor 和包含 Doctor 的 canonical precheck，Agent 又可能在同一 Git/Index/环境快照上重复运行完整入口；长命令静默期间还会产生高频无变化轮询。用户希望保留全部必跑门禁和失败语义，但显著减少等待、重复扫描与无效状态播报。

交付后，普通开发任务只安排一次最终 canonical precheck，不再把它已经覆盖的 Doctor 作为同一验证快照上的重复终态命令；生命周期节点要求的 DRAFT、READY、pre-closure 和真实终态验证仍保留。Doctor 的历史与 Git 检查必须做等价的批量读取或进程内缓存，并输出可观察的阶段耗时。长命令使用客户端允许的最长安全等待，默认按 60 秒级低频检查，只在阶段变化、完成或失败时重点播报。

## 范围内

- 定义“相同验证快照”为命令、环境、完整 HEAD、Git Index/候选树和工作树状态均未变化；
- 明确已有真实 PASS 只能避免额外调度，不能伪造、改写或省略任务卡 `requiredCommands` 的最终 Evidence；
- 调整普通任务模板，去除 canonical precheck 已覆盖的重复终态 Doctor 命令；
- 保留 DRAFT、READY、pre-closure、终态提交后以及快照变化后的必要 Doctor/Precheck；
- 为 Doctor 的只读 Git 查询增加单次进程作用域缓存，并把逐路径 `ls-tree`/`ls-files --stage` 改为等价快照查表；
- 为 Doctor/Precheck 增加阶段与命令耗时输出，减少静默等待；
- 增加自动测试，证明缓存不跨执行泄漏、快照变化会失效、所有失败仍 fail closed；
- 更新 Agent 规则、入口内容哈希和恢复手册。

## 明确范围外

- 删除、跳过、降级或吞掉任何 Doctor、Catalog、付费依赖、Beta Gate、Diff Scope、Context、Evidence 或跨平台失败；
- 把未执行检查记录为 PASS，或跨 Commit、Index、工作树、环境复用结果；
- 修改 CI 矩阵、超时预算、PowerShell/POSIX 薄包装、业务代码、Catalog、Contract、数据库或产品能力；
- 引入后台守护进程、外部缓存服务、付费工具或第二套任务/Evidence 系统；
- 为当前任务临时放宽 Harness。

## 输入和前置条件

- Base Commit 为 TASK-0009 终态 `5b459750b545afe399755ebb40f03b78dcc6d29c`，工作区干净且无活动任务；
- Windows 基线：`python scripts/harness/doctor.py --summary` PASS，25,155 项，墙钟约 342 秒；
- TASK-0009 证明当前 Windows GitHub Harness 完整作业耗时 17 分 35 秒，其中测试与 canonical precheck 均真实执行；
- `harness-change@1.1.0` 要求 C4、人工批准、最小受保护写入、跨平台验证和独立 Reviewer。

## API / 事件 / 数据契约

- canonical precheck 仍由 `.harness/commands.yaml` 驱动，PowerShell/POSIX 仍只调用同一 Python 实现；
- `doctor.py` 最终退出码、`Harness doctor: PASS/FAIL` 和检查语义保持兼容；
- `precheck.py` 仍逐命令执行并传播真实退出码，只增加单调计时与阶段输出；
- 进程内 Git 缓存只存在于单次 Doctor 执行，执行结束即销毁，不写入仓库、不跨环境复用；
- 默认任务模板的终态 `requiredCommands` 不重复列出 precheck 已覆盖的 Doctor。

## 权限、RLS 和数据处理要求

- 只读取 Git 元数据、仓库文件和现有治理证据；
- 不读取或输出本机凭据、Token、真实用户数据或模型请求；
- 不新增网络、Secret、Artifact 上传或仓库写权限。

## 状态机和失败行为

- 任一快照要素变化后，之前的 PASS 不再用于避免调度，必须按任务卡重新执行；
- 任一缓存解析异常、Git 命令失败或快照不一致均 fail closed；
- 缓存只能复用同一 Doctor 进程内相同只读查询结果，不能掩盖执行期间的仓库变化；
- 性能目标不能通过减少 `audit.require`、删除测试、缩小历史范围或降低检查阈值实现；
- 若性能优化无法证明语义等价，回退该优化并保留流程去重与进度输出。

## 模型、Prompt、记忆和安全边界

本任务不修改产品 Prompt、模型协议、记忆、安全策略或真实 Provider。Agent 执行规则只约束任务粒度、验证调度和长命令轮询，不改变产品行为。

## 验收标准

1. 普通任务模板不再同时要求独立 Doctor 和包含 Doctor 的 canonical precheck；生命周期文本仍明确 DRAFT、READY、pre-closure 与终态验证。
2. Agent 规则精确定义相同验证快照、PASS 失效条件和 60 秒级低频轮询，禁止合成 Evidence。
3. Doctor 在单次执行内批量读取 Git Tree/Index 或缓存完全相同的只读 Git 查询，测试证明缓存不跨执行泄漏且仓库变化后重新读取。
4. 所有现有 Harness 单元/失败场景测试通过，新增测试覆盖缓存命中、作用域退出、Git 失败和进度/计时输出。
5. Windows 同一机器优化后的完整 Doctor 保持至少 25,155 项检查并 PASS；两次实测中位耗时不超过 180 秒，且较 342 秒基线至少降低 40%。
6. Python、PowerShell、WSL canonical precheck 均执行相同 5 项命令并真实 PASS；GitHub CI 三 OS Harness、Backend、Frontend 全部成功。
7. 未修改 CI 工作流、薄包装、命令注册表、业务代码、Catalog、Contract、Schema 或受保护范围外文件。
8. 独立 Reviewer 绑定精确实现 Commit/Tree，确认 0 个语义削弱和 0 个 Evidence 伪复用。

## 必跑检查

以 YAML `requiredCommands` 为准。性能证据另记录基线与优化后两次 Doctor 的墙钟、检查数、退出码和精确验证 Commit。

## 回滚或前向修复

若缓存导致陈旧读取、跨测试污染或平台差异，前向移除对应缓存并保留原 Git 查询；若 180 秒目标未达成，不删检查，记录热点并拆分后续性能任务。流程去重和进度输出只有在保持 Evidence 真实性时保留。

## 停止条件

- 需要删除或弱化任何现有检查才能达到性能目标；
- 缓存无法绑定单次执行快照，可能跨 Commit/Index/工作树误复用；
- 需要修改 CI、包装器、命令注册表、业务代码或本任务禁止路径；
- 跨平台入口出现语义分叉，或独立 Reviewer 发现 Evidence 可被伪造。

## Evidence Pack

输出到 `docs/evidence/TASK-0010/`，并生成 `docs/handoffs/TASK-0010.json`。C4 实现必须由未参与修改的独立 Reviewer 绑定精确实现 Commit 与 Git Tree 复验。
