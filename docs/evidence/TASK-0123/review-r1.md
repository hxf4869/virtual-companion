# TASK-0123 Independent Review R1

```yaml
taskId: TASK-0123
reviewerId: task0123_r1
verdict: FAIL
reviewedCommit: 1a66fae6857755f0ee4c775a8dd31efd0dfecb16
candidateTree: f2805a293e97ca3295dccb83bbd58eb841283c8c
```

- **Review Type**: C3 `COMPLETE_MATRIX / ACCEPTANCE / INVARIANTS / ADJACENT_RISK`
- **Parent**: `d4ec252849f76e4089d796b0adf9dcb473a42896`
- **Base**: `30a0a25e20cd1c76b31d016d768faaf13a72588f`
- **reviewerRunsExpensiveFullTests**: `false`

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `2`
- **P3**: `0`

### P2-01：共享 resolver 越过冻结 Auth POST 边界

`AuthRequestTarget.resolve` 使用不区分大小写的方法比较，并在确认 raw target 属于 Auth 前把所有 POST path
解析失败转为 `MALFORMED`。因此 lowercase `post` 会进入 source/body 逻辑，malformed 非 Auth target 也被两个
Auth filter 拦截，违反非 POST、非 Auth path 保持原链行为的 AC1。

最小修复是只接受精确 `POST`，并将 parse-failure rejection 限定到 context-path-adjusted raw Auth target；补充
lowercase method 与 malformed 非 Auth 的 resolver/filter chain-through 测试。

### P2-02：实际 Security chain 未提供冻结 INVALID_REQUEST envelope

Spring Security firewall 会在自定义 filters 前拒绝部分 encoded/matrix target，并产生空 400。原候选将实际
Security-chain 断言收窄为 status-only，未满足任务冻结的
`{"code":"INVALID_REQUEST","message":"The request is invalid"}` 用户可观察合同。

必须提供已授权的 firewall rejection mapping，或由 Owner 正式修订合同；当前候选不得进入正式门禁。

## Finding Disposition

- `P2-01`: **OPEN**
- `P2-02`: **OPEN**

## Governance And Scope

候选 Commit/Tree/Parent、71-input Context fingerprint 与工作树 clean 状态核验一致。Parent 至候选仅修改
writeAllowlist 内 10 个实现/测试路径；未触碰 `specs/**`、JWT、CSRF/cookie、数据库、route mapping、
frontend、Harness 或历史制品，未发现测试删除、skip、ignore、超时扩张或新增依赖。

## Acceptance Matrix

| AC | Result | Evidence |
|---|---|---|
| 1 | FAIL | lowercase method 与 malformed 非 Auth target 被过度分类，见 P2-01 |
| 2 | FAIL | standalone envelope/zero-read 通过，实际 Security chain 对部分 encoded path 为空 400，见 P2-02 |
| 3 | PASS | login/refresh encoded/matrix rejection 与既有 source/429/lease 语义未改 |
| 4 | PASS | literal Auth-prefix `%`、`%2`、`%ZZ` 单测固定 envelope、zero-read、zero-chain |
| 5 | PASS | body exact/one-over、known/unknown 与 replay 行为保留 |
| 6 | PASS | strict REPORT、U+FFFD、lone surrogate、null/negative 均覆盖 |
| 7 | PASS | direct AuthService 五类入口在昂贵依赖前失败 |
| 8 | PASS | scope 与冻结不变量无越界 |
| 9 | NOT_RUN | 正式命令尚未运行 |
| 10 | NOT_RUN | closure/push/post-terminal 尚未运行 |

## Decision

**FAIL。** 仅允许使用任务唯一 fix batch 关闭两项 P2，再由 R2 复核 finding closure、delta、相邻风险和新增
P0/P1。本 Reviewer 未运行或声称通过任何正式 requiredCommand。
