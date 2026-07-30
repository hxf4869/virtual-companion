# Repository Agent Rules — Virtual Companion

本文件是所有开发 Agent 的唯一行为真源。客户端专用入口只能引用本文件，不能复制规则正文。若客户端不会自动发现它，必须先手工加载本文件。

## 每次会话的恢复顺序

1. 从仓库根目录开始，读取 `.harness/project-state.yaml`、append-only `.harness/task-ledger.yaml` 和
   `.harness/task-backlog.yaml`；Backlog 是 PLANNED 执行顺序、依赖、关键路径、决策闸门和晋级条件的唯一机器真源。
2. 读取 `.harness/sources-of-truth.yaml`、`.harness/invariants.yaml`、`.harness/protected-paths.yaml` 和 `.harness/task-lifecycle.yaml`。
3. 运行 `python scripts/harness/doctor.py --summary`；若系统只有 `python3`，使用 `python3`。
4. 读取 `activeTask` 对应任务卡及其 Context Lock；没有活动任务时只能做只读分析或通过 `task-intake` 创建任务，不能实施变更。
5. 按 `.harness/skills.yaml` 解析任务要求的 Skill ID、精确版本和路径，并直接读取 `SKILL.md`。不得依赖客户端是否自动安装或发现 Skill。
6. 只读取本任务需要的 Accepted ADR、架构说明和代码调用链。`docs/source/**` 只是历史快照，不能覆盖机器真源。

## 权威边界

- “是否允许改、可改哪里、这次验收什么”由当前 READY/IN_PROGRESS 任务授权。
- “后续做什么、先后依赖、哪些决策阻断晋级”由 `.harness/task-backlog.yaml` 授权；PLANNED 卡只是其
  Hash 绑定投影，不能成为第二真源。
- 产品语义、状态码、契约、不变量、保护规则和项目状态以 `.harness/**`、`specs/catalog/**`、`specs/contracts/**` 等机器真源为准。
- 长期设计理由以 Accepted ADR 为准；当前实现事实由代码、测试和锁文件证明。
- README、架构说明和历史方案只负责解释，不能覆盖上述事实。
- 任务不能授权自己覆盖或弱化机器真源；两者冲突时必须转为 BLOCKED，由 Owner 修正任务或走对应受保护变更。

聊天记录、模型记忆、缓存、向量索引和可观测数据都不是项目或用户的 Canonical Truth。

## 任务与变更规则

- 业务或仓库变更必须有且只有一个活动任务；合法状态和迁移见 `.harness/task-lifecycle.yaml`。
- 可以有多个 PLANNED，但最多一个待处理 DRAFT、最多一个活动任务。PLANNED 不占
  `project-state.activeTask`、不可执行，也不得提前冻结 Base、授权 Commit、Context、精确命令或 Skill 版本。
- PLANNED 只有在全部依赖 ACCEPTED、硬决策闸门 APPROVED、仓库空闲且按 Backlog 顺序成为首个可晋级任务时，
  才能基于当时最新 main 补齐动态证据并成为唯一 DRAFT。
- Backlog 中预建 Task ID 永久占用且不得复用；PLANNED 取消或替代必须保留原卡、Backlog 条目，并向
  append-only `resolutions` 原子登记与原卡一致的 REJECTED/SUPERSEDED 状态、原因和决策证据，不伪造动态
  Evidence/Ledger；已进入 DRAFT 的任务按正常执行终态闭环。
- planning-only 卡除六个精确元数据字段外，还必须保留绑定 Backlog 标题的一级标题、固定投影声明和恰好六个非空正文节；这些内容虽不覆盖 Backlog 机器语义，但其完整投影在正式登记后按每条 Git parent edge 不可改写，合法规划终态只允许原子状态与 `planningResolution` 变化。
- 原始需求先经 `task-intake` 收口为 DRAFT；Owner 批准范围、风险和验收后，任务与项目活动状态必须在同一授权提交进入 READY。
- 开工前验证 Base Commit、Context Fingerprint、写入白名单、禁止路径、所需 Skill 和审批，再转为 IN_PROGRESS。
- 只能修改任务 `writeAllowlist` 内文件；`forbiddenPaths` 永远优先。
- READY 后的范围或验收修订只能使用 Backlog 中的强类型 Owner amendment 合同及任务卡中的完整 Hash 绑定投影；每项替代必须绑定原授权条款的稳定 ID、原文 Hash 与替代原文 Hash，未列条款保持原授权投影不变。amendment 只能由 `repository-owner` 批准并以单父原子 Git 提交 append-only 引入，未提交的 worktree/index、聊天或非祖先提交不能获得权限。
- amendment 新增写路径只作为原 `writeAllowlist` 的规范仓库相对 POSIX 精确路径并集，不作为 glob；拒绝绝对路径、反斜杠、`.`/`..`、重复分隔、Unicode/大小写碰撞和符号链接别名，`forbiddenPaths` 始终优先。Doctor 对每个 merge parent 分别审计，改坏再恢复或事后追溯授权均失败。
- Diff Scope 按 `baseCommit` 后每条 Git 父边累计，改后恢复仍算变更；不得并入从 Base 之前分叉的旧历史。
- 正式 Doctor/Precheck 前必须精确暂存本任务的完整候选快照；继续编辑后重新暂存，Index 与工作树内容必须一致。
- 命中 `.harness/protected-paths.yaml` 时，必须具备其中要求的 Skill、人工批准或独立复核。
- 范围、真源、所有权、安全行为或失败语义不明确时，转为 BLOCKED 并停止相关写入。
- 变更理由必须能追溯到任务目标、机器真源、不变量或 Accepted ADR；不得用“顺手优化”扩大范围。

## 绝对禁止

- 无活动任务写代码，或绕过 Context/Diff Scope/审批门禁；
- 手改 `specs/generated/**`、为当前任务放宽 Harness、删除失败测试或伪造 PASS；
- 为已有能力引入第二套框架、第二套任务系统、第二套 ADR 或客户端专用规则副本；
- 引入付费许可证、企业版、付费插件或 SaaS-only 运行时前置；
- 将供应商 SDK 类型暴露给业务模块；
- 将模型输出直接写成 Canonical Memory，或绕过确认、安全、授权、RLS 与租户边界；
- 提交密钥、Token、真实联系人或真实用户数据。

## 验证与交接

普通任务从仓库根目录执行任务卡冻结的精确 canonical 命令，默认是：

```text
python scripts/harness/precheck.py --task TASK-ID
```

PowerShell 的 `scripts/harness/precheck.ps1` 和 POSIX 的 `scripts/harness/precheck.sh` 只是 Python 发现包装器，不是 Evidence 中精确命令的隐式别名。只有任务卡在授权前把实际包装器 argv 列入 `requiredCommands` 时才能用它替代 Python argv，并按实际命令记录 Evidence；Harness、包装器或平台可移植性任务可以显式要求多个入口。执行任务卡中未被 canonical precheck 覆盖的其余 `requiredCommands` 和受影响模块测试；`git diff --check` 若已列在任务卡中只执行一次。任务卡不得把 canonical precheck 已包含的 Doctor、Catalog、付费依赖或 Beta Gate 再列为同一终态快照上的独立全量命令。每条检查必须记录 `PASS`、`FAIL` 或 `NOT_RUN`、真实退出码、验证提交和产物哈希或无产物理由。C3/C4 任务需要独立 Reviewer。

验证结果只能在所有显式与隐式命令输入均可证明不变时用于避免额外调度，至少包括完整 HEAD SHA、Git Index/候选树、工作树与未跟踪候选、精确命令、操作系统、解释器/工具链、依赖、环境变量、本地 Git 配置、外部服务与数据状态、任务授权、Context 和命令注册表；任一输入无法证明不变就必须重跑。复用只表示“不再次启动相同检查”，Evidence 仍保留该快照上首次真实执行的唯一结果；不得新增 `REUSED` PASS、复制其他环境结果或把失败、超时、取消、`NOT_RUN` 当作通过。

提交前的 `doctor.py --pre-closure` 与终态真实提交后的 canonical precheck 属于不同生命周期快照，必须分别执行。会话恢复的 `doctor.py --summary` 在同一会话且仓库状态未变化时不重复。

长命令返回运行会话后，只等待同一会话，不得因静默重新启动命令。相邻状态轮询使用客户端允许的最长安全等待，默认约 60 秒；禁止同时追加 `status`、`ps` 或重复日志抓取。只在出现新输出、阶段变化、失败、完成或用户主动询问时重点播报；客户端要求心跳时保持一句话。轮询只观察状态，绝不能触发第二次验证。

结束时用单父原子提交更新机器状态和任务卡，把终态任务追加到 `.harness/task-ledger.yaml`，并生成 `docs/evidence/TASK-ID/evidence-pack.json` 和
`docs/handoffs/TASK-ID.json`。Ledger 历史条目及其绑定的任务卡、完整 Evidence 目录和 Handoff 不可删除、改写、
替换为链接或改变文件模式。Handoff 的下一动作必须与终态
`project-state` 一致，并明确完成项、剩余项和已知风险，让无历史会话可以继续。
