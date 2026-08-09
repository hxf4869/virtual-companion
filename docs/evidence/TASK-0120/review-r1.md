# TASK-0120 Independent Review R1

```yaml
taskId: TASK-0120
reviewerId: task0120_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: e00ef26f30fcb2c298a173547feaffa2492a9175
candidateTree: 89e7b2933bc1ec3c9c5702b67d7516ad82064c47
baseCommit: eb35feb03f0718bf3dc193fc675613234f007d72
candidateParent: ace89845ab4cb3f64346414c265bdab03078c455
riskClass: C3
verdict: FAIL
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Verdict

FAIL。候选 Commit、Tree、直接父提交、Context Lock、授权链与 Diff Scope 均一致，但发现一个阻塞
P1：外部 cancel/timeout 冻结 terminal 后，structured 或 contentless SSE frame 仍可能令 decoder
继续消费 provider bytes。最终 findings 为 `P0=0，P1=1，P2=0，P3=0`，该候选不得进入正式门禁。

## Blocking Finding

### P1：terminal 后 callback 未停止 contentless/structured frame

- `OpenAiChatCompletionsSession.onSseData()` 入口未检查 `terminalQueued`。structured content 可继续累计
  `outputBytes`/`structuredContent`，contentless choice 也会返回 `true`。
- `SseDecoder` 只在 consumer 返回 `false` 时停止；关闭或 interrupt body 不能覆盖已缓冲或忽略
  close/interrupt 的 InputStream，因此最坏可继续读取到 `[DONE]`、EOF 或 8 MiB raw 上限。
- 这违反任务卡冻结的 terminal first-wins、consumer 停止和无 late read 语义。初始 cancel 测试使用
  close 后立即 EOF 的阻塞流，无法暴露该竞态。
- 最小修复：在 dispatch 边界检测已冻结 terminal 并返回 `false`；增加受控 buffered body 测试，
  在 cancel/timeout 后继续提供 contentless 或 structured frame，证明 parser 在该 dispatch 边界停止、
  sentinel 未读、唯一 terminal 不变。

## Passed Matrix

- 8 MiB adapter-private 常量、正 `long` 全连接不可重置计数、每次成功 read 后且处理前检查正确。
- exact/one-over、budget+1、sentinel、`[DONE]` early-stop、overflow 到 MalformedResponse、body close、
  structured overflow 不泄漏均实现正确。
- Base 到候选为单父线性治理链，4 个实现/测试路径均在 writeAllowlist；84 个 Context 输入及
  `e44ae53e328a4fb6bb35bf2493ee860e0941fbbbcb390e6d9f451beb3112da9e` fingerprint 全部匹配。

## Gate Decision

FAIL。允许使用任务卡唯一 fix batch 关闭上述 P1 后进入 R2；R1 未运行或声称任何冻结的正式
`requiredCommands` 为 PASS。
