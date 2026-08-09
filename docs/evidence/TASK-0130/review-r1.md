# TASK-0130 独立 C3 Review R1

```yaml
taskId: TASK-0130
reviewerId: task0130_r1
verdict: PASS
reviewedCommit: fc318cbbca55098c36c4de159d301c41905e85d7
candidateTree: 4c7e576015d5267299506a579f64cffa2c9e5855
baseCommit: ebc7c2228c5ed4d07ec345d9d33a7d187de00392
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `1`

### P3-01：非流重复 tool_use 拒绝分支缺少直接 Contract Test

生产实现会在同一非流响应中发现第二个 `tool_use` block 时抛出 `AnthropicCodecException`，行为正确且
fail closed（`AnthropicMessagesCodec.java:98`）。现有失败测试直接覆盖 wrong、missing、blank name，但没有
构造两个 `tool_use` block（`AnthropicMessagesFailureContractTest.java:131`）。

建议后续增加重复 block 场景，直接断言唯一 `MalformedResponse` 且无 OutputDelta、Usage 或 EOS。该缺口不
改变当前生产行为，不阻塞本候选；由 TASK-0131 前向补测。

## Acceptance Matrix

- 非流 structured 精确比较 `tool_use.name == schemaName`；missing/blank 在 codec、wrong name 在 session
  失败关闭。
- 混合 text prelude 不输出 TextChunk，只交付 matching tool input 的 StructuredJson，并有直接成功测试。
- SSE start/delta/stop index 均要求可转换为 long 的非负整数，并与当前 open block 精确绑定。
- wrong/missing/blank tool name、错误或负 index、第二 structured block 均有直接失败测试；structured partial
  JSON 在终态校验前不产生输出。
- Text delta index mismatch 不输出内容；stop mismatch 保留此前已发 `TextChunk("already emitted")`，随后
  唯一 MalformedResponse，且无 Usage/EOS。
- 合法多 text block 保持顺序和各自 index，最终正常产生 Usage/EOS。

## Scope And Identity

候选 Commit、Tree 与声明完全一致，工作树和 Index clean。Context Lock 的 72 个 Base 输入全部内容 hash
匹配，canonical fingerprint 独立复算为
`9fc63fcc784e1dfeb554c5659ce5107344a8a98625420a782b427529d1bff718`。

Base 至候选仅变更 TASK-0130 Card、Context Lock 和 Project State；业务代码、测试、TASK-0128/TASK-0129
历史制品及其他 forbidden paths 均为零 diff。治理链线性且每条边均为单父提交，范围与不变量无阻塞缺口。

## Decision

**PASS。** 候选 P0/P1/P2 为零，验收和不变量无缺口；P3-01 为非阻塞直接测试覆盖缺口。允许同一
Commit/Tree 进入正式门禁。Reviewer 未运行或冒充 Maven、Doctor、Precheck、root verify 等正式检查。
