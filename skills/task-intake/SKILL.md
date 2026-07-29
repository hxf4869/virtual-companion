---
name: task-intake
description: 将需要修改仓库的原始需求收口为可审计的 DRAFT/READY 任务；在没有活动任务、需要明确范围、风险、Context Lock、验收或审批时使用。
metadata:
  id: task-intake
  version: 1.1.0
  riskClass: C1
---

# Task Intake

## Purpose

把原始需求变成仓库内唯一可执行的任务授权，解决“做什么、为什么、能改哪里、不能改哪里、如何证明完成”。

## When to Use

- 用户要求修改或创建仓库内容，但当前没有活动任务；
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
3. 创建 DRAFT 任务卡，明确用户目标、范围内/外、失败行为、验收、停止条件和前向修复策略。
4. 以当前 Base Commit 的仓库相对路径内容生成 Context Lock；外部资料先归档或只记录 provenance，不写入可复验路径。
5. 解析受保护路径：`requiredSkillVersions` 固定 Base Commit 中实际执行的版本；若任务升级 Skill，另在 `targetSkillVersions` 声明交付版本；同时列出人工批准和独立复核要求。
6. Owner 批准任务目标、风险、白名单和验收后，将任务转为 READY，并只提交任务卡与 Context Lock，形成不可变授权检查点。
7. 将该完整 Git SHA 写入 `authorizationCommit`；运行 `doctor.py --task TASK-ID`。通过后才允许实施者转为 IN_PROGRESS。

## Validation

- 任务字段满足 `docs/tasks/task-card-template.md`；
- Context Fingerprint 可从 Base Commit 独立复算；
- 当前授权字段与 `authorizationCommit` 中的 READY 任务完全一致；
- `writeAllowlist` 不与 `forbiddenPaths` 冲突；
- 所需 Skill 均在 `.harness/skills.yaml` 注册并固定版本；
- C3/C4 的批准与独立复核要求已声明；
- 同一时刻最多一个活动任务。

## Forbidden Actions

- 不得在 intake 过程中实现业务代码；
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
