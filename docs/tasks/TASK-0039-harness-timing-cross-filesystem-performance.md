# TASK-0039：Harness 阶段计时与跨文件系统性能引擎

```yaml
taskId: TASK-0039
state: SUPERSEDED
planningResolution:
  state: SUPERSEDED
  reason: TASK-0038 已执行态 REJECTED，原依赖链不可晋级；由 TASK-0045 在 TASK-0044 后承接相同性能治理范围。
  decidedBy: repository-owner
  decidedAt: "2026-07-31"
  replacementTask: TASK-0045
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 3073500f85d1be8297a52ee620368b5372eb89dd73fc09c128366e3bdbe06ccc
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

以可审计慢项指标和同环境对比缩短 Harness 在 Windows NTFS 与 WSL 跨盘场景的执行关键路径。

## 范围内

- 增加阶段、Git 命令与缓存慢项指标；
- 让 Context Lock 历史读取接入统一 snapshot，并为 commit graph 与 ancestry 提供单次运行级缓存；
- 按 blob 内容寻址解析 Ledger，批量优化 Git/history/fixture 访问；
- 验证 Windows NTFS 与 WSL 本地临时文件系统的代表性路径。

## 明确禁止

- 通过增大 timeout、删除测试、增加 skip 或放宽失败关闭制造性能提升；
- 在 PLANNED 阶段冻结易失热点计数、精确命令、工具版本或最终性能阈值；
- 顺带实现路径感知 CI、跨检查结果复用或 Technical Alpha 产品功能。

## 依赖与决策闸门

- 依赖：TASK-0038；
- 无新增硬决策闸门。

## 验收

- 阶段、Git 命令与缓存慢项可审计，优化前后可在同一环境复验；
- snapshot、运行级 ancestry 缓存与内容寻址 Ledger 解析保持历史不可变和失败关闭；
- Windows NTFS 与 WSL 代表性验证通过，测试删除数为零且 skip 不增加。

## 晋级规则

TASK-0038 必须 ACCEPTED，仓库必须空闲，且本卡必须是执行顺序中首个可晋级任务；满足条件后才能创建唯一 DRAFT。
