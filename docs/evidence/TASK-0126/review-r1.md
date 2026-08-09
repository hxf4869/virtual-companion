# TASK-0126 Independent Review R1

```yaml
taskId: TASK-0126
reviewerId: task0126_r1
verdict: PASS
reviewedCommit: 680e1a3e71c9c817ddc31f33f26648a214d960b7
candidateTree: 8a98f11531c030240c293763a306ef0d7cca47b6
baseCommit: dc1dfca319e1c1793bcbaba2b74b38b2b7caea85
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `0`

未发现阻塞或非阻塞 finding。

## Identity And Governance

- 候选 Commit、Tree、Base 与冻结身份精确一致；Reviewer 检查时工作树与 Index clean。
- Base 后历史为 DRAFT、READY、authorization binding、IN_PROGRESS、candidate 的严格单父链。
- Context Lock 的 55 个 Base 输入 SHA-256 全部正确；canonical 无末尾 LF fingerprint 独立复算为
  `994d1cf54ef8a0fb8c914983a8e2b72d895aef7fc1ae41b6c77ed1b706530636`。
- 候选只修改三个精确授权路径，累计历史路径均在 writeAllowlist 内且未触及 forbidden path。

## Acceptance Matrix

| 验收项 | 结论 | 关键证据 |
|---|---|---|
| Malformed refresh fail-closed | PASS | `admitRefresh` 先执行有界 Java-length fence，再由 strict UTF-8 encoder 拒绝孤立 high/low surrogate；现有 catch 固定转换为 60 秒 `AuthRateLimitException`。 |
| State 与 service 隔离 | PASS | guard 和 controller 测试证明 malformed 输入不建立 limiter map state、不泄漏 bulkhead permit且不调用 AuthService。 |
| 合法与 over-limit 保真 | PASS | null、blank、Java-length over 与 UTF-8 513-byte token 继续跳过 limiter并保留 401；exact 512-byte token 正常 admission。 |
| HMAC 与 Unicode 邻接边界 | PASS | 合法 U+FFFD 进入独立 digest bucket，malformed 输入不经 replacement alias；HMAC domain/framing、capacity/window/backoff 零 diff。 |
| TASK-0125 邻接矩阵 | PASS | encoded Auth-prefix JSON 400、官方 observation marking、非 Auth 空 400、request-target/body/source fence 测试均保留。 |
| Scope 与不变量 | PASS | AuthInputLimits、AuthService、AuthController、Security/JWT/CSRF、database、specs、依赖和生成物零 diff。 |
| 正式 requiredCommands | PENDING | Reviewer 未运行或声明正式门禁 PASS。 |

## Test Evidence

Reviewer 读取的候选冻结前有界迭代报告显示 `AuthAbuseGuardTest` 13 项、
`AuthControllerAbuseControlTest` 6 项，共 19 项，均 0 failure/error/skip。该结果只作为迭代证据，
不替代正式门禁。

## Decision

**PASS。** 候选 `680e1a3e71c9c817ddc31f33f26648a214d960b7` / Tree
`8a98f11531c030240c293763a306ef0d7cca47b6` 可以进入正式门禁。
