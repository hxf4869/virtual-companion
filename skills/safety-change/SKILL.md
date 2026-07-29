---
id: safety-change
version: 1.0.0
riskClass: C4
---

# Purpose

修改输入、增量、最终审核、风险等级、极端情境、依赖操纵或年龄能力规则。

# When to Use

仅在 READY 任务明确列出 `safety-change`，且任务写入范围覆盖目标文件时使用。

# When Not to Use

- 任务仍为 DRAFT、缺少 Owner 或缺少验收；
- 实际变更属于另一个更高风险 Skill；
- 需要修改任务禁止路径；
- 需要引入未批准依赖、商业功能或第二套同类框架。

# Required Inputs

- READY 任务卡、Base Commit 和 Context Fingerprint；
- 允许读写路径与禁止路径；
- 对应 ADR 和真源；
- 回滚或前向修复策略。

# Required Sources of Truth

- `specs/catalog/risk-levels.yaml`
- `specs/contracts/safety-fail-closed-contract.yaml`
- `specs/catalog/age-states.yaml`

# Procedure

1. 验证任务状态、Context Fingerprint 和 Diff 基线。
2. 读取全部真源与相关 ADR，不以历史聊天记忆替代。
3. 先写最小设计和失败场景，再改代码或契约。
4. 只修改 `writeAllowlist` 内文件；发现范围不足立即停止。
5. 增加能证明不变量的自动测试或生成物。
6. 运行任务规定命令，生成 Evidence Pack。
7. 输出 Handoff，逐项标明完成、剩余、失败和风险。

# Validation

- Catalog validate/generate/diff；
- Diff Scope Gate；
- 对应模块单元/集成/契约测试；
- 所有命令记录真实退出码和提交 SHA；
- 高风险任务由独立 Reviewer 复跑关键检查。

# Forbidden Actions

- 硬规则只能被提高不能被模型降低
- 审核不可用必须 fail-closed
- 人格不能覆盖安全
- 高风险变更需人工批准

- 不得删除失败测试、降低阈值或屏蔽门禁来制造通过；
- 不得手工编辑生成文件；
- 不得声称未执行的检查已经通过。

# Evidence Checklist

- [ ] 任务和 Context Fingerprint 有效
- [ ] Diff 未超出白名单
- [ ] 真源和生成物同步
- [ ] 必跑检查有机器证据
- [ ] 安全、隐私、租户和成本边界已复核
- [ ] Handoff 可供新会话恢复
