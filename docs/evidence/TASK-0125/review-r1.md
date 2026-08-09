# TASK-0125 Independent Review R1

```yaml
taskId: TASK-0125
reviewerId: task0125_r1
verdict: PASS
reviewedCommit: 24495063231dac2f2b78ac94432de81de511b030
candidateTree: a6ec7cb48b116fd3241e38584963cf040d35ec78
baseCommit: 098115264879ed1bd99c79e90db2ddca54061c4b
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `0`

未发现阻塞或非阻塞 finding。

## Identity And Governance

- 候选 Commit、Tree、Base 均与冻结身份精确一致；Reviewer 检查时工作树与 Index clean。
- Base 后历史是 DRAFT、READY、authorization binding、IN_PROGRESS 与 candidate 的严格单父链。
- Context Lock 的 55 个 Base 输入 SHA-256 全部正确；canonical 无末尾 LF fingerprint 独立复算为
  `27016920ef0ca8d7c5d1b37e35074f3e8303dc0efd50ebd3406db5673ea4aa14`。
- 候选实现提交仅修改三个精确授权路径；累计历史路径均在 writeAllowlist 内且未触及 forbidden path。
- TASK-0123 R2 的两个遗留 finding 与 TASK-0124 的 intake failure 被正确继承，旧任务和旧门禁未被改写。

## Acceptance Matrix

| 验收项 | 结论 | 关键证据 |
|---|---|---|
| Encoded Auth-prefix 固定 JSON 400 | PASS | resolver 将 MVC 等价 alias 分类为 `NON_CANONICAL`，handler 写固定 envelope；实际 Security-chain 测试覆盖 `/api/v1/%61uth/admin/accounts`。 |
| Official observation marking | PASS | handler 使用官方 `ObservationMarkingRequestRejectedHandler`，调用位于 target 分类和所有响应分支之前；Auth、非 Auth 两分支均断言 active Observation 记录同一异常对象。 |
| 非 Auth 默认空 400 | PASS | 非 Auth 委托 `HttpStatusRequestRejectedHandler`，测试断言 400 且 body 为空。 |
| Exact POST、context path 与 malformed | PASS | method 大小写敏感；resolver 使用 `pathWithinApplication()`；canonical context-path、lowercase method、malformed Auth/非 Auth 回归均保留。 |
| TASK-0123 邻接矩阵 | PASS | body fence、source/429/lease、strict UTF-8、U+FFFD、孤立 surrogate 与 direct service fail-closed 测试均保留。 |
| Scope 与不变量 | PASS | Security config、filter 顺序、JWT、CSRF/cookie、route mapping、数据库、specs、依赖和生成物零 diff。 |
| 正式 requiredCommands | PENDING | Reviewer 未运行或声明正式门禁 PASS。 |

## Test Evidence

Reviewer 读取的候选冻结前迭代报告显示 `AuthSourceAdmissionFilterTest` 12 项、
`AuthSecurityIntegrationTest` 17 项，均 0 failure/error/skip。该结果只作为迭代证据，不替代正式门禁。

## Decision

**PASS。** 候选 `24495063231dac2f2b78ac94432de81de511b030` / Tree
`a6ec7cb48b116fd3241e38584963cf040d35ec78` 可以进入正式门禁。后续正式 root verify 的结果独立记录，
不追溯改变本次 Reviewer 对候选实现与冻结验收矩阵的结论。
