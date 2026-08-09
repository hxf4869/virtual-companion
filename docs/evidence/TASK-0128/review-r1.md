```yaml
taskId: TASK-0128
reviewerId: task0128_r1
verdict: PASS
reviewedCommit: f8feb47f7f02221e36edbb3c7cb2809e1bcd06c8
candidateTree: ad24eced37ed4cfba141572cd98003fce4386d44
baseCommit: 2febf109eacb692096bbcae1baf15cc12138d2d0
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `1`

### P3-01 Text stop-index mismatch 测试未直接断言历史 OutputDelta

`AnthropicMessagesFailureContractTest.java:213-235` 构造了：

- delta index mismatch，预期在输出前失败。
- 已输出 `"already emitted"` 后发生 stop index mismatch。

但两种情况都调用 `assertMalformedWithoutSuccess(events, false)`；该 helper 在 `:388-402` 只断言终态为
`MalformedResponse` 且无 Usage/EOS，没有断言第二种情况确实保留先前的
`OutputDelta("already emitted")`，也没有断言第一种情况不存在 OutputDelta。

生产实现行为正确：`AnthropicMessagesSession.java:383-398` 在匹配 delta 时立即 enqueue text，随后
`:370-372` 对错误 stop index 抛错，失败终态不会删除已排队事件。该缺口不构成当前行为阻塞，但削弱了
验收标准 3 的回归证明。

建议将两个场景分别断言：delta mismatch 只有失败事件；stop mismatch 依次包含历史 TextChunk 和最终
MalformedResponse，且无 Usage/EOS。

## Acceptance Matrix

| 验收项 | 结论 | 证据 |
|---|---|---|
| 非流 tool name 精确匹配 | PASS | Codec 保留并要求非空白 name；Session 与请求 `schemaName` 精确比较。 |
| Wrong/missing/blank name fail-closed | PASS | 三类非流及三类流用例均产生单一 MalformedResponse，无 OutputDelta/Usage/EOS。 |
| 混合 text prelude + matching tool_use | PASS | 非流 codec 同时解析 text/tool；structured session 仅使用 tool input。成功测试只输出 StructuredJson。 |
| 流式 name 与 index 同块绑定 | PASS | start 保存 name/index；delta、stop 均要求与当前 `blockIndex` 相等，错误发生在 StructuredJson 输出前。 |
| 第二 structured block 拒绝 | PASS | 首个 tool block stop 后设置 `blockSettled`；后续 block start 被拒绝。 |
| Text delta/stop mismatch timing | PASS | delta mismatch 在 enqueue 前失败；stop mismatch 保留已发 text，随后 MalformedResponse；无 Usage/EOS。存在上述 P3 测试精度残余。 |
| 合法多 text block | PASS | 不同 index 的顺序 block 均可打开、输出和关闭；测试断言两段输出顺序及最终 Usage/EOS。 |
| Index 类型与范围 | PASS | start/delta/stop 均调用 `requireNonNegativeInteger`，拒绝缺失、非整数、long 溢出及负数。 |
| 大小与 UTF-8 累计预算 | PASS | 原 `addOutputBytes`、跨 delta surrogate 修正、raw/event/body 上限均未改变；所有 delta 仍在 append/emit 前计数。 |
| Timeout/backpressure/cancel/body close | PASS | 相关实现和测试零 diff；terminal fence、67 引用上界、IO abort、parser interrupt、body close 路径保持。 |
| 正式 requiredCommands | PENDING | Reviewer 未运行或声明 canonical、正式 targeted reactor、root verify、无参数 `git diff --check` PASS。 |

## Failure Timing

- 非流 name/input 违例在 `markFirstContent()` 和 `completeSuccessfully()` 前抛出，因此只有失败终态。
- 流式 wrong name 在 block start 阶段失败；index mismatch 在相关 delta/stop 被消费时失败。
- Structured input delta 只累计内部 buffer，不产生 OutputDelta；后续 stop/name/index 失败不会泄漏部分 StructuredJson。
- Text delta 是公开历史事件，匹配 delta 一经 enqueue 不回撤；后续 stop mismatch 追加唯一失败终态。
- 所有协议失败经 `normalizeFailure()` 映射为 body-free `MalformedResponse`，不生成 Usage/EOS。

## Scope And Governance

- Commit、Tree、Base 与冻结身份精确一致；工作树和 Index clean。
- Base 后为严格单父 DRAFT、READY、authorization binding、IN_PROGRESS、candidate 链。
- Context Lock 的 61 个 Base 输入 SHA-256 全部匹配；canonical fingerprint 复算为声明值
  `40d8fae46a1197d2705954d15fc2d2e91f7df937f38dc265f07b73ffed437f24`。
- 候选实现提交仅修改任务授权的两个 Anthropic 生产文件和三个 contract-test 文件。
- 累计治理及实现路径全部位于 writeAllowlist；未触及 provider 配置、OpenAI、provider-neutral contract、limits、
  runtime、数据库、specs、历史 Evidence 或其他 forbidden path。
- 候选冻结前迭代报告显示 Success 13 项、Failure 9 项均通过；该结果不替代正式 targeted reactor。

## Decision

**PASS。** 候选内 P0/P1/P2 为 0，name/index 协议绑定、失败时序和邻接语义满足任务验收。
P3-01 是非阻塞测试精度残余；同一 Commit/Tree 可进入冻结的正式门禁，所有正式 requiredCommands 当前保持
`PENDING`。
