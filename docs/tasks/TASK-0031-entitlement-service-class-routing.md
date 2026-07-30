# TASK-0031：模拟权益、Service Class 与确定性路由

```yaml
taskId: TASK-0031
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: d9b3baba3e5803eb50c54fd55b5eccd6223ab5898c2b211b3b83d3e1be72ab6a
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

用模拟权益建立 Service Class、额度预留和供应商中立确定性路由。

## 范围内

- 合成 entitlement、quota reservation 和路由决策；
- Fake、Failure、ZERO_LLM 候选与服务降级。

## 明确禁止

- 真实支付、真实订阅或真实 Provider；
- 非确定性隐藏 fallback；
- 路由绕过 Provider Registry 或 Execution Authorization Guard。

## 依赖与决策闸门

- 依赖：TASK-0013、TASK-0018、TASK-0022；
- 无独立硬决策闸门。

## 验收

- 相同输入产生相同路由和可审计 `decisionNo`；
- 无合格部署时明确 `NO_ELIGIBLE_DEPLOYMENT`。

## 晋级规则

全部依赖 ACCEPTED 且执行顺序允许时，才基于最新 main 创建唯一 DRAFT。
