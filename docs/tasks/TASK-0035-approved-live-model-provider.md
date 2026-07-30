# TASK-0035：单一获批真实模型供应商受控接入（硬决策闸门）

```yaml
taskId: TASK-0035
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 479a03e830f1e6c964deea820ba8b65d40ea07e0d72af957c6fa74e35a6b89d2
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

在全部 Owner 决策获批后受控接入唯一真实模型部署，并保持所有 Guard 与安全边界。

## 范围内

- 单一获批 Provider/Model/Region/Contract/Credential 接线；
- Alpha Persona、安全政策、审计、配额和故障隔离。

## 明确禁止

- 第二真实供应商、Beta、公开注册和真实支付；
- 猜测供应商、模型、凭据、区域、合同、Persona 或安全政策；
- 绕过 Registry、Authorization Guard、安全流水线或 Quota。

## 依赖与决策闸门

- 依赖：TASK-0020、TASK-0030、TASK-0032、TASK-0033、TASK-0034；
- 硬闸门：`GATE-LIVE-MODEL-PROVIDER`。

## 验收

- 仅获批部署可外发且凭据不进入仓库、日志或业务类型；
- 真实外发故障、撤销、区域、合同和安全失败全部关闭。

## 晋级规则

只有全部依赖 ACCEPTED，且供应商、模型、凭据、区域、合同、Persona 内容和 Alpha 安全政策均由 Owner 审批并在 Backlog 闸门中记录后才能晋级；不得猜默认值。
