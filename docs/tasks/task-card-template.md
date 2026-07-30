# PLANNED 卡模板

Backlog 中预建的任务先使用以下最小机器投影。`.harness/task-backlog.yaml` 是目标、范围、禁止项、依赖、验收、
决策闸门、执行顺序和晋级条件的唯一机器真源；卡片正文是非规范的人类可读渲染，不参与治理决策。PLANNED 不占
`project-state.activeTask`、不可执行，也不得创建 Context Lock 或提前冻结动态证据。

```yaml
taskId: TASK-XXXX
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ""
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

每张 PLANNED 卡的正文必须包含以下固定声明；正文可帮助阅读，但冲突时只接受 Hash 绑定的 Backlog 条目：

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

PLANNED 取消或替代时保留原卡和 Backlog ID，把卡片 `state` 原子改为
REJECTED/SUPERSEDED，并向 Backlog 的 append-only `resolutions` 登记相同状态、非空原因和决策证据；该规划终态
不伪造 Base、Context、命令、Evidence 或 Ledger。SUPERSEDED 只允许从 PLANNED 进入；已经进入 DRAFT 或后续状态的任务只以
ACCEPTED/REJECTED 正常执行终态完成 Evidence/Ledger 闭环。两种情况都不得复用编号。

# DRAFT 及后续状态模板

```yaml
taskId: TASK-XXXX
state: DRAFT
owner: ""
riskClass: C2
requiredSkills:
  - task-intake
requiredSkillVersions:
  task-intake: X.Y.Z
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: ""
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: ""
authorizationCommit: ""
contextFingerprint: ""
contextLock: docs/tasks/context/TASK-XXXX.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
readAllowlist: []
writeAllowlist:
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-XXXX-title.md
  - docs/tasks/context/TASK-XXXX.context-lock.yaml
  - docs/evidence/TASK-XXXX/**
  - docs/handoffs/TASK-XXXX.json
forbiddenPaths: []
sourcesOfTruth: []
requiredInvariants: []
humanApprovals: []
independentReview: not-required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-XXXX
  - git diff --check
```

## 背景与用户可观察目标

说明用户最终能观察到什么，以及为什么现在要做。

## 范围内

## 明确范围外

## 输入和前置条件

所有 Context Lock 输入必须使用 Base Commit 中的仓库相对路径。外部资料只记录 provenance；需要参与复验时先归档到仓库。

Backlog 管理的任务只有在其全部依赖 ACCEPTED、硬决策闸门 APPROVED、仓库空闲且它是执行顺序中首个可晋级任务时，
才能把 PLANNED 卡晋级为唯一 DRAFT。晋级不得改变 Backlog 锁定的静态规划合同；此时才基于最新 main 补齐
Base、Context、白名单、精确命令和 Skill 版本。完整 DRAFT 检查点只能包含任务卡和 Context Lock。Owner 批准后，将任务置为 READY，并在同一授权提交中仅同步
`.harness/project-state.yaml` 的 `activeTask`、`activeTaskCard`、`nextAction`、`updatedAt`；随后用一个仅修改任务卡的提交把
该授权提交完整 SHA 写入 `authorizationCommit`。任务历史必须完全从 `baseCommit` 后分叉，不得并入 Base 之前的旧支线；所有历史父边发生过的路径都计入
Diff Scope，即使之后恢复。终态提交必须是单父提交，并原子更新任务卡、项目状态、Task Ledger、Evidence Pack 和 Handoff，
不得改写历史条目。正式检查前须暂存完整候选快照，Index 与工作树不一致时检查失败；
提交前用 `doctor.py --task TASK-ID --pre-closure` 复验，提交后必须执行任务卡中冻结的精确 canonical Precheck 命令验证真实提交；Precheck 已包含正式 Doctor，不得在同一终态快照上再默认列 standalone Doctor。PowerShell/POSIX 包装器不是该 Python 命令的 Evidence 别名，只有在授权前把实际包装器 argv 写入 `requiredCommands` 才能执行并据实记录。只有任务特有且未被 Precheck 覆盖的检查才加入 `requiredCommands`。

## API / 事件 / 数据契约

## 权限、RLS 和数据处理要求

## 状态机和失败行为

## 模型、Prompt、记忆和安全边界

## 验收标准

每项必须可复测，包含公式、样本、通过线或明确断言。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准；每条命令记录状态、退出码、验证提交、产物哈希或无产物理由，同一条 `git diff --check` 只执行一次。任务卡不得重复列出 canonical Precheck 已覆盖的子命令，也不得要求普通业务任务同时运行多个本地平台的完整 Precheck。

## 回滚或前向修复

## 停止条件

## Evidence Pack

输出到 `docs/evidence/TASK-XXXX/`，并生成 `docs/handoffs/TASK-XXXX.json`。
