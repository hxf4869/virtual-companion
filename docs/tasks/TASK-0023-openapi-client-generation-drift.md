# TASK-0023：OpenAPI 生成、Client 生成与漂移检查基线

```yaml
taskId: TASK-0023
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 9840e91d08ac282bcbd6eb0040457a37212f84a8472aaf0fb5b647215175f792
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

## 目标

建立 OpenAPI 唯一契约、Java 接口与 TypeScript Client 的确定性生成和漂移门禁。

## 范围内

- OpenAPI 源、生成器锁定和 CI 漂移检查；
- 错误包络与所有权隐藏语义。

## 明确禁止

- 实现代码反向覆盖 OpenAPI；
- 手改生成物；
- 借 API 基线开启公开注册或 Beta。

## 依赖与决策闸门

- 依赖：TASK-0022；
- 无独立硬决策闸门。

## 验收

- 同输入生成字节稳定且漂移失败关闭；
- Java 与 TypeScript 消费同一 OpenAPI 真源。

## 晋级规则

只有 TASK-0022 已 ACCEPTED 且本卡按 Backlog 顺序可晋级时，才动态锁定生成器与精确命令。
