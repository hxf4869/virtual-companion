---
name: task-intake
description: 将需要修改仓库的原始需求收口为可审计的 DRAFT/READY 任务；在没有活动任务、需要明确范围、风险、Context Lock、验收或审批时使用。
metadata:
  id: task-intake
  version: 1.2.0
  riskClass: C1
---

# Task Intake

## Purpose

把原始需求变成仓库内唯一可执行的任务授权，解决“做什么、为什么、能改哪里、不能改哪里、如何证明完成”。

## When to Use

- 用户要求修改或创建仓库内容，但当前没有活动任务；
- Backlog 中的 PLANNED 任务满足依赖、执行顺序和决策闸门，需要晋级为唯一 DRAFT；
- DRAFT 任务需要补齐范围、Owner、风险、验收、Context Lock 或审批后进入 READY；
- 现有活动任务无法覆盖新请求，需要先判断新请求是补充、后续任务还是范围扩张。

只读问答、代码审查和状态查询无需创建任务，但不得借只读名义实施修改。

## Required Inputs

- 用户的可观察目标和明确不做事项；
- Owner 与必要的人类批准；
- 当前干净 Base Commit；
- 需要锁定的仓库相对输入；
- 风险等级、真源、不变量、读写白名单、禁止路径和必跑命令。

## Procedure

1. 读取 `AGENTS.md`、项目状态、生命周期和相关机器真源。
2. 确认不存在另一个活动任务；若存在，判断请求是否属于该任务，否则停止并交由 Owner 排序。
3. 若任务已在 `.harness/task-backlog.yaml` 中登记为 PLANNED，先验证它是按执行顺序首个满足全部 ACCEPTED 依赖和 APPROVED 硬决策闸门的任务；PLANNED 卡只绑定 Backlog 静态规划合同 Hash，不得包含 Base、授权 Commit、Context、精确命令或 Skill 版本，也不占 `activeTask`、不得执行。
4. 以最后一个终态提交作为新任务唯一 `baseCommit`，不得先提交其他变更再把它们包含进 Base；创建或晋级唯一 DRAFT 任务卡，保持 Backlog 锁定的目标、范围、禁止项、依赖、验收和决策闸门不变，并补齐失败行为、停止条件和前向修复策略。
5. 以当前 Base Commit 的仓库相对路径内容生成 Context Lock；外部资料先归档或只记录 provenance，不写入可复验路径。
6. 解析受保护路径：`requiredSkillVersions` 固定 Base Commit 中实际执行的版本；若任务升级 Skill，另在 `targetSkillVersions` 声明交付版本；同时列出人工批准和独立复核要求。
7. 需要持久保存 DRAFT 时，只提交字段完整的任务卡与 Context Lock，保持 `project-state.activeTask` 为空；Doctor 不接受同一检查点中的其他路径。
8. Owner 批准目标、风险、白名单和验收后，将任务转为 READY，并在同一授权提交中同步
   `project-state.activeTask`、`activeTaskCard`、`nextAction`、`updatedAt`。该提交只允许任务卡、Context Lock 和
   `.harness/project-state.yaml`，且项目状态的阶段、能力门禁和历史指针必须与 Base Commit 一致。
9. 用后续仅修改任务卡的提交，把 READY 授权提交的完整 Git SHA 写入 `authorizationCommit`；运行
   `doctor.py --task TASK-ID`。通过后才允许实施者转为 IN_PROGRESS。
10. PLANNED 在进入 DRAFT 前被取消或替代时，不伪造动态执行证据；保留原卡和 Backlog 条目，把原卡 state 与
    append-only `resolutions` 原子登记为同一 REJECTED/SUPERSEDED，并记录非空原因、决策人、时间和替代 ID。
    该规划终态不进入执行 Task Ledger。已进入 DRAFT 的任务在
    ACCEPTED/REJECTED/SUPERSEDED 时，以单父提交原子更新任务卡、项目状态并把本任务追加到 `.harness/task-ledger.yaml`；同时加入 Evidence Pack 与 Handoff。REJECTED/SUPERSEDED 必须保留非空原因，Backlog 条目和永久 ID 不得删除或复用。历史条目和其绑定的任务卡、
   Evidence、Handoff 不可删除或改写。提交前完整暂存候选快照，并用 `doctor.py --task TASK-ID --pre-closure` 检查候选闭包；正式
   Doctor/Precheck 只接受已经形成真实 Git 提交的终态。

## Validation

- 任务字段满足 `docs/tasks/task-card-template.md`；
- Context Fingerprint 可从 Base Commit 独立复算；
- 当前授权字段与 `authorizationCommit` 中的 READY 任务完全一致；
- READY 授权提交与 `project-state` 的活动任务投影是同一原子事务；
- `authorizationCommit` 必须是 Base 后首个 READY、单父提交；其父节点只能是 idle Base 或未绑定 DRAFT，不能事后前移授权锚；
- 任务历史完全从 `baseCommit` 后分叉；逐父边变更并集不包含白名单外路径，改后恢复也不能绕过；
- 正式 Doctor 前完整暂存候选快照，Index 与工作树内容一致；
- 终态任务已登记到 append-only Task Ledger，历史审计产物仍与首次登记提交一致；
- `writeAllowlist` 不与 `forbiddenPaths` 冲突；
- 所需 Skill 均在 `.harness/skills.yaml` 注册并固定版本；
- C3/C4 的批准与独立复核要求已声明；
- 同一时刻最多一个活动任务。
- 可存在多个 PLANNED，但最多一个 DRAFT；PLANNED 不得携带动态证据或作为 Diff Scope 执行授权。
- Backlog 中已登记的 Task ID、名称和静态规划合同不可删除、复用或静默改写。

## Forbidden Actions

- 不得在 intake 过程中实现业务代码；
- 不得用多张 DRAFT 冒充规划队列，或绕过 Backlog 顺序、依赖和硬决策闸门；
- 不得由 Agent 伪造 Owner 批准或把沉默视为批准；
- 不得为容纳已经发生的越界修改而倒推放宽白名单；
- 不明确的关键边界必须标为 BLOCKED；
- 不得把历史聊天当作唯一 Context 输入。

## Evidence Checklist

- [ ] Base Commit 和 Context Fingerprint 有效
- [ ] 目标、范围外和停止条件明确
- [ ] 写入白名单与禁止路径可机器校验
- [ ] Skill、审批和 Reviewer 要求已声明
- [ ] 验收与必跑命令可复测
