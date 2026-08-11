# TASK-0150 R2 独立复核（delta）

Reviewer：独立 subagent（fork_turns=none，无任务历史上下文，只读）
R1 候选：633090e（tree 5a50f62）—— FAIL（1 P1 + 5 P3）
R2 候选（fix batch）：48a9179（tree 720fa7c101baa32890d8c1c451149b0682b87be6）
delta：`git diff 633090e 48a9179`（6 文件，+128/-7）
复核时间：2026-08-11

## verdict: PASS

R1 P1 finding 由 fix batch 真实闭合；未引入新 P0/P1。

## finding closure 表

| R1 finding | 等级 | 闭合状态 | 证据 |
|---|---|---|---|
| 验收标准 2：guard 拒绝时 sendAsync 零调用，无 Session 注入接缝 | P1 | CLOSED | EgressDnsGuard 去 final；两个 Session 新增 public 4 参构造 (HttpClient, HttpRequest, ModelProtocolRequest, EgressDnsGuard)（内部 new Codec 避免 package-private 跨包泄露）；两个契约测试新增 rejectingEgressGuardNeverOpensAConnection，注入总是抛 IAE 的子类 + CountingHttpClient，断言 client.asynchronousCalls()==0 |
| CGNAT 边界增强（上界包含性 + 公网外地址放行） | P3 | CLOSED | EgressDnsGuardTest 新增 cgnatBoundariesArePublicOutsideTheSharedRange（100.63.255.255 / 100.128.0.1 放行）+ 100.127.255.255 上界阻断 |
| IPv4-mapped 公网地址放行 | P3 | CLOSED | 新增 ipv4MappedPublicAddressIsAllowed（::ffff:8.8.8.8 放行） |
| AnthropicMessagesSession 误加 Utf8ByteAccumulator import | P3 | CLOSED | diff 删除 import，类体内无引用 |
| MalformedResponse 语义 / 同步 DNS 不受预算约束 | P3 | N/A | delta 未触及，非阻塞；R1 已确认无悬挂/竞争 |

## delta 范围合规
6 文件全部命中 writeAllowlist，零命中 forbiddenPaths。CountingHttpClient（两包）未修改。

## delta 正确性
1. public 构造保留原 package-private 构造的终止/取消/超时语义：public 4 参构造委托到原 private 5 参构造体；Adapter 生产路径仍调 package-private 4 参构造；语义零漂移。
2. IllegalArgumentException → MalformedResponse 映射合理：normalizeFailure 两 Session 均有分支，guard 抛 IAE 经 unwrap 命中；归类 MalformedResponse 避免误触发重试/断连语义。
3. EgressDnsGuard 去 final 不引入安全弱化：生产唯一实例化是 defaults() 工厂，内部方法 private static 不可覆写；Adapter 不接受外部 guard；去 final 仅打开测试注入接缝。
4. 测试真实非恒真：guard 子类覆写 requireAllowedResolution(URI) 整体替换方法体（virtual dispatch），无论 host 都抛 IAE；Session.execute() guard 调用在 try 块首行先于 sendAsync；CountingHttpClient.sendAsync 两重载均 asynchronousCalls.incrementAndGet()；assertEquals(0, ...) 真实断言。

## 新 P0/P1
无。

## P3 观察（非阻塞）
- OpenAiChatCompletionsBoundaryContractTest:44-45 的 `import static ... BodyPublishers;` 插在 SSL import 分组之间，风格不一致（编译无影响）；Anthropic 侧用全限定 `java.net.http.HttpRequest.BodyPublishers.ofString`，两侧风格不统一。
- EgressDnsGuard javadoc 新增"non-final so contract tests can inject..."段落，准确反映设计意图。
