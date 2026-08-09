# TASK-0123 Independent Review R2

```yaml
taskId: TASK-0123
reviewerId: task0123_r2
verdict: FAIL
reviewedCommit: 70ace14a89a9c094690a94bb8576ca978d518456
candidateTree: 7c195d82363781e73d2747d46ed50af9c36c0f5b
```

- **Review Type**: `FINDING_CLOSURE / FIX_DELTA / ADJACENT_RISK / NEW_P0_P1`
- **Parent**: `1a66fae6857755f0ee4c775a8dd31efd0dfecb16`
- **reviewerRunsExpensiveFullTests**: `false`

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `2`
- **P3**: `0`

### P2-02：encoded Auth-prefix 的 firewall envelope 仍未闭合

`AuthRequestRejectedHandler` 只在 raw URI 以 literal `/api/v1/auth` 开头时接管。既有 body-filter 测试已经把
`/api/v1/%61uth/admin/accounts` 识别为 MVC 等价的 non-canonical Auth alias，但实际 Security chain 中
`StrictHttpFirewall` 先拒绝 `%61`；handler 的 literal raw-prefix 检查失败后委托默认 handler，仍产生空 400。

需要让 firewall handler 在 parse 成功时使用 shared resolver 的 `NON_CANONICAL` 分类，并只用 raw-prefix
fallback 处理 malformed Auth target；实际 Security-chain 测试必须加入 encoded Auth segment。

### P2-03：自定义 handler 全局移除了默认 security observation marking

Auth-enabled 时新增 component 成为应用唯一 `RequestRejectedHandler`。Spring Security 7.1 在没有自定义 handler
且 ObservationRegistry 非 NOOP 时默认组合 `ObservationMarkingRequestRejectedHandler` 与
`HttpStatusRequestRejectedHandler`；当前实现只委托后者，导致 Auth 与非 Auth firewall rejection 都丢失异常
observation 标记。这是全局安全可观测性回归。

需要在 Auth envelope/default-status 分支前保留框架 observation marking，并以 active observation 测试证明异常仍被标记。

## Finding Disposition

- `R1 P2-01`: **CLOSED**。method 已改为精确 `POST`；malformed 非 Auth 返回 `NOT_TARGET`；source/body tests
  证明 lowercase method 与 malformed 非 Auth 均 zero-read chain-through。
- `R1 P2-02`: **PARTIALLY CLOSED / STILL OPEN**。literal raw Auth-prefix 的 firewall rejection 已有固定 envelope，
  encoded Auth-prefix alias 仍为空 400。
- `P2-03`: **OPEN**。自定义 bean 替代了框架默认 observation composition。

## Fix Delta Review

Commit/Tree/Parent 与冻结 R2 身份一致，工作树和 Index clean。Delta 只修改一个授权 helper 文件和三个授权测试
文件；未改变 filter 顺序、JWT、CSRF/cookie、数据库、route mapping、limiter 或严格 UTF-8 service 语义。
条件 bean 已由实际 Security integration 证明被采用，但 response-only tests 未覆盖 encoded Auth-prefix 与
observation preservation。

## Decision

**FAIL。** 唯一 fix batch 已消费，R3 禁止；不得进入正式 requiredCommands，也不得继续第三轮 TASK-0123
实现/复核。应真实 REJECTED 闭包，并由新的永久任务处理剩余问题。本 Reviewer 未运行 Doctor、precheck、
Maven、root verify 或无参数 `git diff --check`。
