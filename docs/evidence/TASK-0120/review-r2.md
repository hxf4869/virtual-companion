# TASK-0120 Independent Review R2

```yaml
taskId: TASK-0120
reviewerId: task0120_r2
reviewer: "Codex independent reviewer R2 (/root/check_audit_report)"
reviewedCommit: 03188aec64a05f324769d2d2afbb6603cfd8d236
candidateTree: 7f267fe18204dd81f04081d2279213e6eccb83a6
baseCommit: eb35feb03f0718bf3dc193fc675613234f007d72
candidateParent: e00ef26f30fcb2c298a173547feaffa2492a9175
riskClass: C3
verdict: PASS
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Verdict

PASS。R1 的唯一 P1 已关闭，最终 findings 为 `P0=0，P1=0，P2=0，P3=0`。新候选 Commit、Tree、
直接父提交、单父治理链和 Diff Scope 均一致，允许同一候选进入四条正式门禁。

## R1 Finding Disposition

- `OpenAiChatCompletionsSession.onSseData()` 现在在 callback 入口检测已冻结 terminal 并立即返回
  `false`；usage/choice 分支在处理当前 frame 后再次检测，覆盖 terminal 在 codec/state 处理期间发生
  的竞争。文本分支继续由 `emitText()` 的锁内 terminal 检查停止，`[DONE]` 始终返回 `false`。
- `CloseReleasedLateInputStream` 故意忽略 interrupt，并在 close 后提供已缓冲 late contentless frame。
  total-timeout 和重复 cancel 测试均证明 parser 只消费至该 frame 的 dispatch 边界，读取数精确等于
  prefix + late frame，后续 sentinel 未读，reader thread 停止，唯一 timeout/cancel terminal 不变。
- terminal 仍可能与一个已经完成组帧的当前 event 并发；实现会在其 callback 入口或返回点停止，
  不继续读取下一 sentinel。这是冻结并由测试绑定的 dispatch 边界。

## Complete Matrix

- 8 MiB raw fence、所有真实 framing/data/comment/CR/LF 字节计数、exact/one-over、budget+1、
  no-reset、`[DONE]` early-stop、MalformedResponse、body close 与 structured no-leak 均未回归。
- 唯一 fix batch 只修改已授权 OpenAI session 和 raw-budget contract test，无 forbidden 或范围外路径。
- 迭代报告显示 decoder `14/14`、raw-budget contract `7/7` PASS，仅作为迭代证据，不替代正式门禁。

## Gate Decision

PASS。允许对 Commit `03188aec64a05f324769d2d2afbb6603cfd8d236`、Tree
`7f267fe18204dd81f04081d2279213e6eccb83a6` 执行任务卡冻结的四条正式 `requiredCommands`；
Reviewer 未运行或声称这些命令为 PASS。
