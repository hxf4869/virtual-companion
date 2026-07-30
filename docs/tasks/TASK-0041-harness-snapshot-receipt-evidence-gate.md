# TASK-0041：Harness 内容寻址快照复用与 Evidence 门禁

```yaml
taskId: TASK-0041
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 41e7f88955e14737403b1371c7e1161daf16fdcb31bc24fbef4d2c23bc467667
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以完整输入身份和可审计 receipt 约束同一调度上下文内的结果复用，同时保持终态 exact-SHA CI 不可跨 SHA 复用。

## 范围内

- 定义覆盖代码、任务合同、工具链、环境、外部状态和命令身份的完整 manifest；
- 仅在同一 job 或会话调度决定中，对完整 manifest 相同的 PASS 结果生成内容寻址 snapshot receipt；
- 将复用来源、命中原因、输入身份和验证状态接入 Evidence 门禁；
- 区分 pre-closure 与真实提交 HEAD，终态 exact-SHA CI 始终绑定当前实现 SHA。

## 明确禁止

- 跨 SHA 复用终态 exact-SHA CI，或让 pre-closure 与真实提交 HEAD 互相复用；
- 在 manifest 缺失、未知或输入无法证明相同时复用；
- 把失败、超时、取消或 NOT_RUN 复用为 PASS；
- 顺带建设跨 job、跨会话或跨提交的通用远端缓存服务。

## 依赖与决策闸门

- 依赖：TASK-0040；
- 无新增硬决策闸门。

## 验收

- receipt 严格内容寻址并绑定完整 manifest，缺失、未知或不一致输入均失败关闭；
- 复用只发生于同一 job 或会话的调度决定且只接受可验证 PASS；
- Evidence 可审计全部身份与命中信息，终态 exact-SHA CI 对当前实现 SHA 真实运行。

## 晋级规则

TASK-0040 必须 ACCEPTED，仓库必须空闲，且本卡必须是执行顺序中首个可晋级任务；满足条件后才能创建唯一 DRAFT。
