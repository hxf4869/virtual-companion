# TASK-0038：任务交付执行策略、双模式 Skill 与 AGENTS 入口

```yaml
taskId: TASK-0038
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: a56440293ebd9a58c7b28c6412b871b06880bc87c6dbf603ab7169d5df2885af
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

建立适用于单卡和长线严格串行协调的唯一机器交付策略、双模式 Skill 与薄文档入口。

## 范围内

- 在 Harness 唯一机器策略中约束验证层级、风险分级 Reviewer、阶段预算、熔断、候选身份和长线串行条件；
- 注册 `task-delivery-flow` Skill，并让 `AGENTS.md` 只保留硬约束与机器策略、Skill 的入口；
- 接入 Sources、Invariants、Doctor 和定向测试，修复 idle planning checkpoint 与 planning-only resolution 的自举组合缺口。

## 明确禁止

- 只写说明文档、另建平行计划系统或在 `AGENTS.md` 复制策略正文；
- 用删测、skip、放宽失败关闭或无界 Reviewer 循环换取时延；
- 顺带实现性能引擎、CI 平台矩阵、快照复用或 Technical Alpha 产品功能。

## 依赖与决策闸门

- 依赖：TASK-0012；
- 无新增硬决策闸门；TASK-0037 的 REJECTED 终态不是本卡依赖。

## 验收

- 机器策略、双模式 Skill 和薄入口被仓库注册、Doctor 与定向测试失败关闭地约束；
- 单卡与长线严格串行模式均可复用，规划态自举组合有端到端覆盖；
- 具体 Skill 版本、动态命令和时间阈值只在本卡晋级唯一 DRAFT 时冻结。

## 晋级规则

TASK-0012 必须保持 ACCEPTED，仓库必须空闲，且本卡必须是执行顺序中首个可晋级任务；满足条件后才能创建唯一 DRAFT。
