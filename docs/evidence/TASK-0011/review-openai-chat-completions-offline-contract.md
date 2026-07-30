# TASK-0011 OpenAI Chat Completions 离线合同独立复核

```yaml
taskId: TASK-0011
reviewerId: codex-task0011-openai-chat-completions-reviewer
kind: openai-chat-completions-offline-contract
verdict: PASS
reviewedCommit: e0efe4ae304f2fc43dfd9cc5799c51ee63dd23f7
reviewedTree: 99a7ef802f6167aa11dc43a2f0653a0f4528b074
```

## 结论

PASS，无阻断项或非阻断遗留项。Reviewer 未参与实现，并从精确 Git
Commit 与 Tree 复核了 `b18dd0d..e0efe4a` 的完整变更。

## 审查范围

- 实现变更仅位于 TASK-0011 白名单；Catalog、Contract、`modelruntime`、
  Runtime、Specs、CI、Harness 和其他禁止路径保持未修改。
- 每个合法 Session 只调用一次 `HttpClient.sendAsync`，redirect 禁用，
  不含重试、路由或 fallback。
- 完整 Binding、连续 sequence、Connect/First Token/Total 三段超时、
  取消幂等、唯一终态和迟到事件 fence 均符合任务合同。
- HTTP method/raw path/Header/Body、结构化请求、SSE finish reason、Usage
  与 `[DONE]` 条件符合当前 Chat Completions 参考和仓库机器真源。
- 机器真源 14 项，以及单请求、loopback、非法响应、多 choices、缺
  Usage/DONE 和脱敏边界均有定向合同测试。

## 审查发现与修复

- P1：Jackson 默认接受尾随 JSON 根 token。实现已启用
  `FAIL_ON_TRAILING_TOKENS`，并覆盖普通 JSON、SSE event、结构化非流
  与结构化流式响应的失败关闭和零 EOS。
- P2：JDK Header 校验异常可能回显超出 HTTP Header 字符范围的 Token。
  配置入口已无回显拒绝 ISO control 和大于 `0xFF` 的字符，并覆盖
  Unicode Token 脱敏与零网络调用。
- P2：阻塞 `next()` 被中断后曾未登记终态已交付。中断与正常路径现统一
  走终态交付逻辑，并覆盖新线程后续 `next()` 立即为空。
- P2：解码路径校验曾接受 percent-encoded request-target。配置与
  mock 断言现都使用 raw path，编码变体在网络调用前被拒绝。

## 最终复核

- 精确 Commit：`e0efe4ae304f2fc43dfd9cc5799c51ee63dd23f7`。
- 精确 Tree：`99a7ef802f6167aa11dc43a2f0653a0f4528b074`。
- `git diff --check b18dd0d..e0efe4a`：PASS。
- P0：0。
- P1：0。
- P2：0。
- 真实供应商互操作、凭据、区域、合同、Runtime 外发、Beta、支付和安全
  政策均为任务范围外，由主流程在 Evidence 中记录 `NOT_RUN`。
