# 跨平台 Agent 开发与恢复手册

## 一句话原则

任何 Agent、IDE 或操作系统都只消费同一条治理链：

```text
AGENTS.md
  -> .harness/project-state.yaml
  -> active task + Context Lock
  -> .harness/skills.yaml -> exact SKILL.md
  -> protected paths + diff scope
  -> tests/Evidence -> Handoff
```

客户端文件只负责把 Agent 带到 `AGENTS.md`，不拥有独立规则。机器状态由 YAML/JSON 表达，理由由任务与 Accepted ADR 表达，历史聊天不是恢复前提。

## 客户端入口

| 客户端 | 入口 | 处理方式 |
|---|---|---|
| OpenAI Codex | `AGENTS.md` | 原生项目指令 |
| Zed Agent Panel | `AGENTS.md` | 原生项目指令 |
| Claude Code | `CLAUDE.md` | 仅 `@AGENTS.md` 导入 |
| GitHub Copilot | `.github/copilot-instructions.md` | 仅引用 `AGENTS.md` |
| 其他 Agent / Zcode 类应用 | `AGENTS.md` | 开始工作前手工加载 |

该设计依据各客户端公开机制建立，并把差异限制在薄适配层：

- OpenAI Codex：<https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- Zed：<https://zed.dev/docs/ai/instructions>
- Claude Code：<https://code.claude.com/docs/en/memory>
- GitHub Copilot：<https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions>

如果未来客户端支持方式变化，只更新 `.harness/agent-entrypoints.yaml` 和对应薄入口；不得复制整份规则。

## 新会话恢复算法

1. 确认仓库根目录与 Git 状态，不切换臆测分支、不清理未知修改。
2. 读 `AGENTS.md`，再运行：

   ```text
   python3 scripts/harness/doctor.py --summary
   ```

3. 根据摘要读取 `.harness/project-state.yaml`、活动任务、Context Lock 和精确 Skill。
4. 用任务卡回答以下问题，回答不出来就停止写入：

   - 用户可观察目标是什么？
   - Base Commit 和锁定上下文是什么？
   - 哪些路径能写、哪些绝对不能写？
   - 变更命中了哪些保护规则、审批和 Reviewer？
   - 选择当前做法的依据是哪条真源、不变量或 Accepted ADR？
   - 成功、失败、回滚和交接如何证明？

5. 开工前运行 `doctor.py --task TASK-ID`。Context、状态、Skill、审批或 Diff Scope 任一失败都不得继续。
6. 只做任务范围内的最小变更；发现新需求时更新为 BLOCKED 或创建后续任务，不把它偷偷塞进当前任务。
7. 验证后生成 Evidence/Handoff，由独立 Reviewer 复跑关键失败场景，再进入 ACCEPTED。

## 状态和责任

`DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 是正常路径；`BLOCKED` 和 `REJECTED` 用于明确失败或缺条件。精确迁移见 `.harness/task-lifecycle.yaml`。

- `project-state.yaml`：现在在哪里、最后完成什么、唯一下一动作和能力门禁；
- 任务卡：本次为什么做、允许做什么和验收；
- Context Lock：决策基于哪个 Base Commit 的哪些输入；
- Skill：高风险变更必须遵守的操作过程；
- ADR：跨任务长期有效的设计理由；
- Evidence：实际执行了什么、退出码和产物；
- Handoff：新会话恢复所需的完成项、剩余项、风险和下一动作。

## 跨平台命令

| 环境 | 统一入口 |
|---|---|
| Windows PowerShell | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/harness/precheck.ps1` |
| macOS/Linux/WSL | `bash scripts/harness/precheck.sh` |
| 已知 Python 解释器 | `<python> scripts/harness/precheck.py` |

PowerShell 和 Shell 文件只负责发现 Python；命令列表来自 `.harness/commands.yaml`，由 `precheck.py` 使用 `sys.executable` 执行。CI 也必须调用该入口。

## 失败时怎么做

- `no active task`：只读分析，或用 `task-intake` 创建并批准 READY 任务；
- `context mismatch`：输入或 Base Commit 已变化，重新 intake，禁止改哈希凑通过；
- `outside writeAllowlist`：回到任务边界，不能反向扩大白名单包住已有越界修改；
- `missing Skill/approval/reviewer`：补齐真实授权，不能由 Agent 自批；
- `generated drift`：修改真源并用生成器重建，禁止手改生成物；
- `Beta roster PASS`：只代表值班结构门禁，不代表 PIA、伦理、年龄或发布审批完成；
- 平台差异：修复统一 Python 实现或薄包装，不能在某个平台跳过同一门禁。

## 交接最小内容

结束时必须让下一位 Agent 无需聊天历史即可知道：

1. 任务状态和验证提交；
2. 已完成、未完成和失败项；
3. 每条命令的状态、退出码、环境和产物哈希或无产物理由；
4. 独立 Reviewer 结论；
5. 已知风险和一个明确的 `nextAction`。
