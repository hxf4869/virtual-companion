# Repository Agent Rules — Virtual Companion

本文件是所有开发 Agent 的唯一行为入口。客户端专用文件只能薄引用本文件；机器交付正文位于
`.harness/task-delivery-policy.yaml`，操作流程位于 `.harness/skills.yaml` 注册的
`task-delivery-flow` Skill，三者不得互相复制或建立平行计划系统。

## 会话恢复

1. 从仓库根目录读取 `.harness/project-state.yaml`、append-only `.harness/task-ledger.yaml`、
   `.harness/task-backlog.yaml`、`.harness/sources-of-truth.yaml`、`.harness/invariants.yaml`、
   `.harness/protected-paths.yaml` 和 `.harness/task-lifecycle.yaml`。
2. 运行一次 `python scripts/harness/doctor.py --summary`；受控 Python 环境由 PATH 前置提供，
   不依赖 `python3` 字面量。
3. 读取活动任务、Context Lock、`.harness/skills.yaml` 中任务要求的精确 Skill 版本与路径。
4. 单卡或长线交付还必须读取机器交付策略与注册的 `task-delivery-flow` Skill。
5. 只读取本任务需要的 Accepted ADR、机器真源和代码调用链；历史聊天与 `docs/source/**` 不是真源。

## 权威边界

- 当前 READY/IN_PROGRESS/IN_REVIEW 任务授权本次目标、范围、验收和写路径。
- Backlog 是 PLANNED 顺序、依赖、闸门、永久 ID 和晋级条件的唯一机器真源；规划卡只保存 Hash 绑定投影。
- 产品语义、生命周期、不变量、保护规则与项目状态以机器真源为准；任务不能授权自己弱化真源。
- Accepted ADR 记录长期理由，代码和测试证明当前实现；说明文档与模型记忆不能覆盖机器事实。

## 硬约束

- 实现变更必须由唯一活动任务授权；PLANNED 不可执行。`task-intake` 允许的 idle DRAFT、
  planning-only resolution 与 terminal closure 是范围受限的治理例外；最多一个 DRAFT 和一个活动任务。
- 只能修改 `writeAllowlist`，`forbiddenPaths` 始终优先。保护路径必须满足精确 Skill，以及规则声明所需的
  人工批准或独立 Reviewer；不得把 Reviewer 强加给未被任务或保护规则要求的全部 C1/C2 变更。
- Context、范围、所有权、安全、候选身份或失败语义不明确时转为 BLOCKED；不得自批、倒推扩权或伪造 PASS。
- READY 后只接受 Backlog 强类型 Owner amendment；必须先以单父原子提交落入历史，未提交内容不授权。
- Diff Scope 按 Base 后每条父边累计；改后恢复、merge 旁路、路径别名和追溯授权均失败关闭。
- 正式 Doctor/Precheck 前精确暂存完整候选；Index 与工作树不一致时禁止终态检查。
- 不手改生成物，不删测、不加 skip、不吞退出码，不提交密钥、Token、真实联系人或真实用户数据。
- 不引入第二套任务、ADR、生命周期、Evidence、Handoff、客户端规则副本或付费/SaaS-only 必需运行时。

## 交付入口

- 先读取 `.harness/task-delivery-policy.yaml`，再按 `skills/task-delivery-flow/SKILL.md` 执行；策略缺失、
  漂移、未注册或与 canonical lifecycle 冲突时失败关闭。
- `single-card` 交付当前卡；`longline` 只按 Backlog 严格串行编排全新可见任务，卡内仍执行
  `single-card`。阈值、Reviewer、候选身份、验证顺序和停止条件只以机器策略为准。
- 合法状态与迁移只以 `.harness/task-lifecycle.yaml` 为准；策略中的 `happyPath` 不是第二状态机。
- C3/C4 独立 Reviewer、终态 Evidence/Handoff、单父原子 closure 和远端复核不可省略。

## 验证与交接

- 执行任务卡冻结的精确命令。canonical Python 入口是
  `python scripts/harness/precheck.py --task TASK-ID`；PowerShell/POSIX 包装器不是 Evidence 别名。
- canonical 已包含的子命令不重复；长命令只等待同一进程，记录真实耗时、退出码和终态。
- 提交前运行 `doctor.py --task TASK-ID --pre-closure`；终态 Precheck 只验证真实提交。
- Evidence 的 PASS 必须绑定实际执行和精确 SHA；失败、取消、超时、NOT_RUN 永不转换为 PASS。
- 终态提交只原子更新任务卡、项目状态、Task Ledger、完整 Evidence 和 Handoff；历史制品不可改写。
- Handoff 必须给出完成项、剩余项、已知风险和与 `project-state.nextAction` 一致的唯一下一动作。
