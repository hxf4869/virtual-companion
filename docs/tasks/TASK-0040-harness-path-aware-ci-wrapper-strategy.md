# TASK-0040：Harness 路径感知 CI 与包装器平台策略

```yaml
taskId: TASK-0040
state: PLANNED
owner: repository-owner
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 0c2f6e9ac7f950515b5913d4c65780788e0951f2b12e4e2d04ace7851347ae5f
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 目标

让 CI 始终产生确定终态，并在 job 内按失败关闭的路径分类选择普通卡 smoke 与参考平台全量验证。

## 范围内

- workflow 始终触发，并在 job 内执行失败关闭的路径分类；
- 未知或无法分类路径回退全量验证；
- Ubuntu 参考平台对精确 SHA 必跑全量 Harness；
- 普通业务卡在 Windows 与 macOS 只运行 wrapper smoke，Harness 或可移植性变更升级完整矩阵。

## 明确禁止

- 使用 workflow trigger paths 让 required check 长期 pending；
- 让未知路径静默跳过全量验证；
- 跳过 Ubuntu 参考平台精确 SHA 全量验证，或把 smoke 冒充全量 PASS。

## 依赖与决策闸门

- 依赖：TASK-0039；
- 无新增硬决策闸门。

## 验收

- 所有受治理提交都会触发 workflow 并得到可判定的 required check 终态；
- job 内分类失败时回退全量，未知路径有失败关闭测试；
- Ubuntu 精确 SHA 全量与 Windows、macOS 普通卡 wrapper smoke 的边界被机器测试约束。

## 晋级规则

TASK-0039 必须 ACCEPTED，仓库必须空闲，且本卡必须是执行顺序中首个可晋级任务；满足条件后才能创建唯一 DRAFT。
