# TASK-0037：Harness 性能基线、分层验证与快照复用

```yaml
taskId: TASK-0037
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 4f368e017967e617f94989d335b65b6921fda287e20f15ab47c894933039fe03
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在不弱化失败关闭、精确 SHA Evidence、历史不可变性或跨平台保障的前提下，建立 Harness 性能基线、分层验证和相同输入快照的可审计复用，缩短治理任务与普通业务卡的反馈关键路径。

## 优先级原因与实测基线

TASK-0012 实测暴露出多轮全量 Harness、三种包装器和五路 CI 尾延迟会显著放大静态评审修复成本，因此本任务排在 TASK-0012 之后、TASK-0013 之前优先治理。

- 本地完整 Harness：119 项，674.036s；
- PowerShell canonical precheck：39,118 checks，174.037s；
- WSL canonical precheck 仅载入阶段：246.590s；
- GitHub Windows Harness 首轮：18m11s，job `90878411943`。

这些数值是 TASK-0012 的历史实测基线，不是 TASK-0037 的最终性能阈值。

## 范围内

- 增加分阶段计时、慢项报告以及同环境优化前后对比；
- 把迭代期定向检查与终态精确 SHA 全量验证分层；
- 为输入、命令、工具链、环境和外部状态完全相同的快照实现可审计复用；
- 评估并实现安全的路径感知 CI、包装器 smoke 与参考平台全量策略；
- 优化临时 Git 历史 fixture、Windows NTFS 和 WSL 跨盘扫描。

## 明确禁止

- 删除测试、增加跳过，或弱化失败关闭、精确 SHA Evidence、历史不可变性和跨平台保障；
- 用路径感知或快照复用跳过终态精确 SHA 全量验证；
- 复用无法证明全部输入身份相同的结果；
- 在 PLANNED 阶段提前冻结工具版本、精确命令或最终性能阈值；
- 实现 Provider、数据库、API、H5、身份、模型外发或其他业务功能。

## 依赖、闸门与晋级

- 依赖：TASK-0012 ACCEPTED；
- 决策闸门：无；
- 执行顺序：TASK-0012 后第一优先，先于 TASK-0013；
- 晋级条件：仓库空闲、依赖已 ACCEPTED、无未批准闸门，且为执行顺序首个可晋级任务。

## 验收标准

- 同一环境提供优化前后对比，测试删除数为零、跳过数不增加，并证明语义等价与失败关闭不变；
- 普通业务卡只冻结一个 canonical precheck 与受影响模块测试，跨平台包装器全量仅用于 Harness 或可移植性变更；
- 终态全量与 CI 继续绑定精确实现 SHA；
- 每次快照复用记录完整输入身份、命中原因和审计证据；
- 具体版本、动态命令和最终性能阈值在晋级唯一 DRAFT 时基于当时最新 main 冻结。
