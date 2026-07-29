# ADR-0003：采用单一 Agent 真源与跨平台可执行 Harness

- 状态：Accepted
- 日期：2026-07-30
- 决策范围：Repository Governance

## 背景

项目可能由 Windows、macOS、Linux 或 WSL 上的不同 Agent 客户端接手。原有仓库虽然已有 `AGENTS.md`、Harness YAML、任务卡、Context Lock、Evidence 和 Handoff，但多项配置未被脚本或 CI 消费，且存在无活动任务、状态不一致、Windows 换行误报、POSIX 缺少 `python` 别名、缺失 Skill 和不可移植绝对路径等断点。

为每个客户端复制规则会形成多套真源；只写更多说明又无法阻止越界修改。因此需要保留现有治理结构，把它变成可机器执行的授权链。

## 决策

1. `AGENTS.md` 是唯一 Agent 行为真源。
2. 原生支持 `AGENTS.md` 的客户端直接读取；其他客户端只增加薄导入或薄引用。入口登记必须反映客户端真实发现优先级、合并语义与产品形态，不能用一个泛化名称掩盖差异；为保证 Zed 直接命中 `AGENTS.md`，不创建优先级更高的 `.github/copilot-instructions.md`。Copilot CLI 同时发现并组合 `AGENTS.md` 与 `CLAUDE.md`，后者仍只是 `@AGENTS.md` 薄导入，两条链路同源；Claude Code 复用该薄入口。所有适配器仍导向同一 Canonical Instructions。无法通过任何受支持机制加载 Canonical Instructions 时 fail closed。未知客户端必须手工加载 `AGENTS.md`。
3. `.harness/project-state.yaml` 记录当前阶段、活动任务、最后验收任务、能力门禁和唯一下一动作。
4. `.harness/task-lifecycle.yaml` 是任务状态机真源；同一时刻最多一个活动任务，终态统一为 `ACCEPTED`/`REJECTED`。
5. `.harness/task-ledger.yaml` 以 append-only 条目保存终态任务的可发现性；每条 Git 父边都必须保留既有条目。V2 终态边界是唯一、单父、原子追加 Ledger/任务卡/项目状态/Evidence/Handoff 的提交。历史任务卡、完整 Evidence 树和 Handoff 绑定该提交的 Git blob、模式与路径集合，不可删除、改写、链接替换或删后恢复。
6. 完整 DRAFT 只能提交任务卡与 Context Lock；READY 授权提交必须原子更新项目活动状态，且首个 READY 提交是不可前移的授权锚点。任务从唯一前序终态开始，交付历史必须 ancestry-closed；Doctor 对每条 Git 父边取变更并集，改后恢复仍视为发生过。
7. Context Lock 使用 Base Commit 中的仓库相对路径；历史外部资料只能通过仓库别名或不可复验的 provenance 明示保留，READY 后字节冻结。
8. `doctor.py` 自动执行任务发现、Context、Skill、保护路径、审批、Diff Scope、Schema、状态和入口一致性检查；正式检查要求任务变更已暂存且 Index 与工作树内容一致，并对完整候选仓库拒绝 Windows/macOS 不可移植路径，Evidence 只绑定已提交的精确 SHA。
9. `.harness/commands.yaml` 是命令注册表；`precheck.py` 用当前 Python 解释器执行，PowerShell/POSIX 文件只做薄包装，CI 调用同一入口。
10. Harness 自身属于 C4：必须有人工批准、独立复核和失败场景测试，不得为当前任务放宽自身。

## 被否决的方案

- 为 Codex、Claude、Zed、Copilot 分别维护完整规则：必然漂移，且客户端优先级差异会隐藏冲突。
- 新建 `CONTEXT.md`、第二套任务目录或第二套 ADR：与现有 task/context/evidence/handoff 体系重复。
- 只靠 Agent 自律检查白名单和审批：无法在 CI 或新会话中复现。
- 将平台差异写成多份命令清单：长期仍会漂移，应共享一个 Python 执行器。

## 结果

- 新 Agent 能仅凭仓库恢复当前状态、理由、授权边界和下一动作；
- Windows、macOS、Linux、WSL 与 CI 执行同一核心门禁；
- 客户端差异被限制在可检查的薄入口；
- 新的 Catalog/Contract 变更不再被缺失 Skill 阻塞；
- Harness 只能降低误报和补足门禁，不能降低产品、安全、隐私、租户或成本约束。
