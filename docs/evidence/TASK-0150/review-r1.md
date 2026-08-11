# TASK-0150 R1 独立复核

Reviewer：独立 subagent（fork_turns=none，无任务历史上下文，只读）
候选：633090e（tree 5a50f6209c27d5213d72671c75cc2defa8cfd9ed），单父 87f604d，工作树 clean
范围：4 个实现文件（EgressDnsGuard 新增、EgressDnsGuardTest 新增、两个 Session 接线）+ 3 个治理文件（任务卡、context-lock、project-state），diff `git diff --check 74a80b92 633090e` 干净
复核时间：2026-08-11（R1 fix batch 之前）

## verdict: FAIL

阻塞 P0/P1 不为零：1 项 P1。

## findings

### P0
无。

### P1
1. **缺失卡内冻结的 guard 注入构造 + 契约测试扩展，验收标准 2 第 1-2 子项不可验证**
   - 位置：`OpenAiChatCompletionsSession.java:71-81`、`AnthropicMessagesSession.java:71-83`（单一构造、硬编码 `EgressDnsGuard.defaults()`）；两个 BoundaryContractTest 零改动。
   - 任务卡明确写入"构造可选注入 guard 便于测试"、"契约测试扩展：guard 拒绝解析（注入拒绝 guard）时 CountingHttpClient 零调用"；验收标准 2 要求"guard 拒绝时 sendAsync 零调用（CountingHttpClient 计数 0）"。候选不含 Session 级拒绝测试，且无注入接缝无法编写。
   - 静态控制流核查确认属性实际成立（guard 调用是 execute() try 块首条语句，拒绝即抛异常，sendAsync 不可达），故非安全回归，属范围/验收证据缺口。

### P2
无。

### P3
1. AnthropicMessagesSession 新增未使用 import（Utf8ByteAccumulator）——疑从 OpenAI Session 复制；不影响编译。
2. 安全阻断归类为 MalformedResponse（normalizeFailure 新增 IAE→MalformedResponse 分支）：经核查 Session/Codec 无其他 IAE 抛出点，分支不遮蔽既有分类；但 DNS 重绑定阻断（安全事件）被下游解读为"provider 返回畸形响应"，观测语义失真，卡未指定 AdapterFailure 映射，建议后续引入独立类别或文档说明。
3. guard 的同步 DNS 解析不受 totalDeadlineNanos 约束（`InetAddress.getAllByName` 在预算起点前阻塞）；但 cancel() 的 terminateCancelled() 同步入队 AttemptCancelled，消费者不被阻塞，解析返回后 remaining() 仍强制 PhaseTimeout——无悬挂/竞争 P0/P1。
4. 测试边界缺口：CGNAT 上下界（100.63.255.255/100.127.255.255）未测；`::ffff:` 映射字面量在 JDK 解析下可能走 Inet4Address 路径，blockedIpv6 映射分支未被真实覆盖，映射公网放行（::ffff:8.8.8.8）未测；URI 重载的 UnknownHostException→IOException fail-closed 路径无单测（不可确定性注入）。
5. 信息项：diff 实际 7 文件（4 代码 + 3 治理）；harness glob_matches 实测全部 7 路径零命中 forbiddenPaths、全部命中 writeAllowlist，范围合规成立。

## 复核通过的矩阵项
- 类别判定：IPv4 8 类与 ProviderEgressPolicy.ipv4Category 逐条一致；IPv6 ::1/fe80::/10/fc00::/7/::/::ffff: 映射掩码与字节序（getAddress 网络序）正确；公网 IPv6 不误拒。
- fail-closed：空数组→IAE、UnknownHostException→IOException、无 host→IAE；127.0.0.1 字面两重载均不解析直接放行；错误消息 4 条均不含 host/地址。
- 既有回归面：ProviderEgressPolicyTest 16 用例 base==candidate 未改；两个契约模块零改动；契约测试全部使用 127.0.0.1 字面。
- EgressDnsGuardTest 11 用例断言真实；工作树 surefire 报告 11/11 通过（0 跳过）。
- 验收标准 1 可验证项全部满足；3-6 属终态证据范畴（确认 diff --check 干净、回归面为零）；标准 2 因 P1 不可完整满足。

## 修复建议（单 fix batch）
为两个 Session 增加包内可见 guard 注入构造（默认 defaults()），在两个 BoundaryContractTest 增加注入拒绝 guard + CountingHttpClient 计数 0 用例，删除 AnthropicMessagesSession 未使用 import。
