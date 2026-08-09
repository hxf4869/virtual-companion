# TASK-0122 Independent Review R1

- **Reviewer**: Codex Independent Reviewer R1
- **Review Type**: C3 `COMPLETE_MATRIX / ACCEPTANCE / INVARIANTS / ADJACENT_RISK`
- **Reviewed Commit**: `1c27a0bb598efdfd07aecfcb14dcfd46b19aaef5`
- **Candidate Tree**: `03307764106086c3d7a81b82bb36d29c9bfdf9cd`
- **Parent**: `fb76b3f533e0a9a5ecb04a96ac77e65c02f34771`
- **Base**: `55629d56be58006b4cffc1fc474229293a04381d`
- **Verdict**: **PASS**
- **reviewerRunsExpensiveFullTests**: `false`

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `0`

未发现阻塞性或非阻塞性正确性、安全性、治理、范围或测试缺陷。

## Governance And Scope

- HEAD、Commit、Tree、Parent 与冻结身份一致；工作树和 Index 均干净。
- Base 至候选为五个单父提交，未发现 merge、历史旁路或候选后改动。
- `authorizationCommit` 为 `27adb9d1e4b0a98824a761982f490e3d46d3303f`；READY 后仅发生授权提交绑定、IN_PROGRESS 状态迁移及候选实现。
- Context Lock 共 `84` 个 Base 输入；逐项 SHA-256 与 Base blob 一致，独立重算 fingerprint 为 `d608f595fdfc71758b6304b00eb32cc4be495f6d1da88ebae84c37ea7c7fdd9c`。
- `task-delivery-flow@1.3.7`、`task-intake@1.2.7`、`catalog-change@1.0.0`、`contract-change@1.0.0` 均已注册并与任务卡绑定。
- 候选逐父实现 diff 均位于 `writeAllowlist`；未触碰 `forbiddenPaths`。migration、repository、DataSource pool、JWT、cookie 属性、frontend、Harness 和历史任务制品无 diff。
- Catalog、Contract 与 OpenAPI 的保护路径授权及独立 Reviewer 要求满足。

## Key Proofs

- `AuthAbuseGuard` 使用四个隔离且有界的 rolling-window scope：login/refresh source 分别为 `20/60s`、`10/60s`，login/refresh input key 分别为 `5/900s`、`5/60s`。
- progressive backoff 精确实现 `1/2/4/8/16/60s`；Retry-After 对 backoff 与 rolling release 取最大值并向上取整，拒绝不追加 timestamp 或递增 streak。
- 观测时间通过 `AtomicLong.accumulateAndGet(..., Math::max)` 钳制为单调不减；同 scope 的 check+consume 在 `tryLock` 临界区原子完成。
- 全局 login/refresh 共用非公平 `Semaphore(4)`，仅调用 `tryAcquire()`；lease 覆盖完整下游调用，并通过幂等 `close()` 在正常返回和异常退出时释放。
- source 容量为每 route `4096`，login/refresh key 容量各 `8192`；满容量时只扫描并回收真实过期状态，不驱逐活跃 key。
- map 仅保存 64 字符 HMAC-SHA-256 digest。进程启动时生成独立 256-bit key，输入按长度前缀 framing 并进行 domain separation。
- HMAC 使用 `CodingErrorAction.REPORT` 的严格 UTF-8 编码；孤立 surrogate 失败关闭，不会与 replacement character 形成 digest alias。
- login key 与 `AuthService.normalizeUsername()` 共用同一 trim + `Locale.ROOT` lower 逻辑；source 保持 key 的组成部分。refresh 仅在既有 512-byte token fence 通过后计算 HMAC。
- source filter 只处理精确 POST login/refresh。Spring MVC 等价的 percent-encoded 或 matrix alias 在读取 body 前固定返回 `400 INVALID_REQUEST`；非目标 method/path 不消费 admission。
- 过滤器实际顺序为 Cookie CSRF -> Source Admission -> Body Limit -> JWT/MVC；三个 admission 相关 filter 均在 Security chain 内构造，不作为容器 Bean 重复注册。
- source/舱壁拒绝发生在 body filter 前；controller key 拒绝发生在 `AuthService` 前，因此 BCrypt、repository、session JDBC、JWT、successor 和 audit 均不可达。
- filter 与 MVC rejection 共用固定 `429 AUTH_RATE_LIMITED`、固定 message、正整数 `Retry-After`；响应不包含 source、username、token、digest、bucket、容量或 details。
- Catalog 仅在末尾追加 ordinal `16`；原 ordinal `0..15` 不变。Catalog、identity contract、OpenAPI 及实际变化的生成物均同步包含新 code 和 login/refresh 429 契约。

## Acceptance Matrix

| AC | Result | Evidence |
|---|---|---|
| 1 | PASS | source 20/21、10/11、route 隔离及转发头忽略由 guard/filter tests 覆盖 |
| 2 | PASS | input 5/6、窗口 release、username canonicalization 与 source 组合由 guard/controller tests 覆盖 |
| 3 | PASS | 全部 backoff 阶段、30 分钟 idle、max/ceil 及拒绝不自增由 mutable Clock 测试覆盖 |
| 4 | PASS | clock rollback、原子 source 并发预算、4-slot 无等待舱壁及幂等释放均有测试 |
| 5 | PASS | 缩小容量的四 scope 行为证明 active no-eviction、expired reclaim 与 scope 隔离 |
| 6 | PASS | counting body、chain/service mock 证明 source/舱壁/key 拒绝的下游零调用 |
| 7 | PASS | null/blank/one-over token 不建立 key state并保持 401；exact 512 才进入 bucket |
| 8 | PASS | filter 与 MVC 429 的 header、UTF-8 JSON、固定 code/message 和 no-details 均有断言 |
| 9 | PASS | 实际 Security chain 顺序、每类 filter 数量为一及无容器 Bean 由集成测试检查 |
| 10 | PASS | Catalog 仅追加 ordinal 16；source、contract、OpenAPI 与生成物静态一致 |
| 11 | PASS | Base 至候选路径审计未发现任何冻结范围外 diff |
| 12 | PASS | R1 已绑定本 Commit/Tree；正式命令尚待实施者在同一 clean candidate 上执行 |

## Test Evidence

已读取现存迭代 Surefire 报告及对应断言，共 `99` 项、`0` failure、`0` error、`0` skipped：

- `AuthAbuseGuardTest`: 13
- `AuthSourceAdmissionFilterTest`: 7
- `AuthControllerAbuseControlTest`: 5
- `AuthSecurityIntegrationTest`: 17
- `AuthControllerCookieTest`: 5
- `AuthControllerValidationTest`: 30
- `AuthServiceTest`: 22

这些是迭代证据，不替代正式 requiredCommands，也未被本 Reviewer 声称为正式门禁 PASS。

## Invariants And Residual Risk

`INV-TENANT-001`、`INV-AUTH-001` 及冻结 Harness 不变量未被削弱。实现不建立身份、不访问 limiter 数据库、不改变 RLS、refresh rotation、JWT、cookie 或租户语义。

已声明且仍存在的残余风险准确：状态仅限单 JVM、重启清空、不解析 trusted proxy、没有 account-only 跨 source 防护、永久锁定、密码策略或审计聚合保留。反向代理聚合 `remoteAddr` 可能造成误伤，但未被误报为多实例或真实用户级保护。

## Gate Decision

**PASS。** 允许对同一 Commit `1c27a0bb598efdfd07aecfcb14dcfd46b19aaef5` / Tree `03307764106086c3d7a81b82bb36d29c9bfdf9cd` 进入正式门禁。

本次 Reviewer 未运行或声称通过任务卡冻结的 canonical precheck、正式 targeted reactor、OpenAPI validate/diff、root Maven verify 或无参数 `git diff --check`。
