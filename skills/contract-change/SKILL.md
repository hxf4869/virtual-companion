---
name: contract-change
description: 修改 specs/contracts 下的 API、事件、状态机、事务、实时、安全或其他技术契约时使用。
metadata:
  id: contract-change
  version: 1.0.0
  riskClass: C3
---

# Contract Change

## Preconditions

- READY 任务明确列出 `contract-change@1.0.0`，并覆盖目标 Contract、实现和测试路径；
- 已列出生产者、消费者、兼容窗口、失败语义和不变量；
- 已指定独立 Reviewer；安全、数据库、模型路由或 Harness 变化还需对应 Skill。

## Procedure

1. 验证任务、Context Lock、Base Commit 和 Diff Scope。
2. 读取目标 Contract、关联 Catalog、不变量、Accepted ADR、实现和契约测试。
3. 明确字段、状态、时序、幂等、重试、权限、租户、错误和版本兼容行为。
4. 先修改唯一 Contract 真源，再同步实现、测试和文档；不得以 Markdown 或供应商 SDK 替代契约。
5. 对生产者与消费者运行契约测试，并执行 Harness precheck。
6. 独立 Reviewer 从失败场景复核，不只验证正常路径。

## Invariants

- Provider EOS 不等于业务完成；
- Final Message、最终安全审核、Generation 终态和 Outbox 的原子性不得被削弱；
- Gap、Reset、Snapshot、授权快照、RLS、Lease/Fence 等既有约束必须显式保留或由新 ADR 合法替代；
- 合同变化不能偷偷改变产品范围或 Catalog Code 语义。

## Stop Conditions

- 生产者、消费者、兼容策略、失败语义或数据所有权不明确；
- 需要越界修改或缺少相应高风险 Skill/审批；
- 只能通过删除测试、放宽不变量或依赖未批准能力才能通过。
