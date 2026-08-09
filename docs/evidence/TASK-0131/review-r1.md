# TASK-0131 独立 C3 Review R1

```yaml
taskId: TASK-0131
reviewerId: task0131_r1
verdict: PASS
reviewedCommit: a2ab4e285d20b4539c545cee0676ea6bc70a9c62
candidateTree: f665f0601357ba07d1f7dc44c94063b20e951ad2
baseCommit: e4c90d168f02541771bf9c016fdd47f8ac5706aa
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `0`

无 finding。

## Acceptance

- 新测试使用 `structuredRequest(false, ...)`，明确为 structured non-stream；schemaName 为
  `companion_response`。
- 响应的同一 `content` 数组含两个 `tool_use`，两者 name 均精确匹配 `companion_response`。
- `assertMalformedWithoutSuccess(events, true)` 验证唯一事件、MalformedResponse，且无 OutputDelta、
  UsageReported 或 AttemptEos。
- `drain()` 进一步验证唯一终态、终态最后、连续 sequence 及终态后无迟到事件。
- 测试断言一次服务端请求和一次异步 HTTP 调用，没有重试或重复发送。
- 测试真实命中生产 Codec 的第二 `tool_use` 拒绝分支。

## Scope And Identity

Commit、Tree 与声明一致，候选直接父为 `03098226621c6a22f0d7cb18f24901615afe0ca6`；工作树和 Index clean。

Base 后唯一业务/测试 diff 是 `AnthropicMessagesFailureContractTest.java`。生产代码、Support、Success tests、
TASK-0128 至 TASK-0130 历史制品及 forbidden paths 均零 diff。Context Lock 共 77 个输入，内容 hash 全部
匹配 Base，canonical fingerprint 独立复算等于
`b01c848205b29c4396858cc11c674472ab96a98ffa07481700acba01a243740b`。

## Decision

**PASS。** 候选 P0/P1/P2/P3 为零，可对同一 Commit/Tree 运行正式门禁。Reviewer 未运行 Maven、Doctor、
Precheck 或其他正式完整检查。
