# TASK-0036：Technical Alpha 隔离、安全、记忆、故障与指标总验收

```yaml
taskId: TASK-0036
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 8809df77db8d2efe725461f78aa64eeff7950f9ab027524c60a28bfd27f24b61
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

对 Technical Alpha 的租户隔离、安全、记忆、恢复、协议和指标进行总验收。

## 范围内

- 跨租户、授权撤销、安全失败、记忆删除和故障恢复矩阵；
- 指标、审计、性能基线和 Alpha 发布证据。

## 明确禁止

- Beta、公开注册、真实支付和 Technical Alpha 之外能力；
- 依赖或硬闸门未满足时宣称 Alpha 完成；
- 用 NOT_RUN、失败或合成 PASS 替代真实验收。

## 依赖与决策闸门

- 依赖：TASK-0026、TASK-0030、TASK-0032、TASK-0034、TASK-0035；
- 无新增硬闸门，但继承所有依赖的硬闸门结果。

## 验收

- 所有依赖的终态 Evidence 可追溯且总验收矩阵真实通过；
- Technical Alpha 禁止能力保持关闭，P0/P1/P2 全部闭环。

## 晋级规则

任一依赖或其决策闸门未满足时，本卡必须保持 PLANNED/BLOCKED；只有全部依赖 ACCEPTED 且 Backlog 判定为首个可晋级任务时，才能创建唯一 DRAFT。
