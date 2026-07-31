# TASK-0057：Harness 阶段计时与跨文件系统性能引擎永久后继

```yaml
taskId: TASK-0057
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 9a15881aec6ad58bf01b198b54a8fed8d053f6933b6dd8c18634265672e4cdb1
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以可审计慢项指标和同环境对比缩短 Windows NTFS 与 WSL 跨盘 Harness 关键路径。

## 范围内

- 阶段、Git 与缓存指标，snapshot/ancestry/Ledger 优化；
- Windows NTFS 与 WSL 本地临时文件系统同环境验证。

## 明确禁止

- 用 timeout、删测、skip 或放宽失败关闭制造性能提升；
- 顺带实现路径感知 CI 或 snapshot receipt。

## 依赖与决策闸门

- 依赖：TASK-0056；
- 无新增硬决策闸门。

## 验收

- 优化前后数据可审计，历史不可变与失败关闭不变；
- 两类文件系统代表性验证通过且 skip 不增加。

## 晋级规则

TASK-0056 必须 ACCEPTED，仓库必须空闲，且本卡是执行顺序中首个可晋级任务。
