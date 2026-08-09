```yaml
taskId: TASK-0128
reviewerId: task0128_r2
verdict: TIMEOUT
reviewedCommit: a18c5d8d7e3f2860fbae02147ce73429b6dbb5d9
candidateTree: 3f759478734261db431731994879c8f0df5c8ade
baseCommit: 2febf109eacb692096bbcae1baf15cc12138d2d0
previousCandidate: f8feb47f7f02221e36edbb3c7cb2809e1bcd06c8
fixBatchCount: 1
reviewerRunsExpensiveFullTests: false
budget:
  maximumMinutes: 15
  elapsedSeconds: 900
  hardLimitReached: true
interruption:
  terminalOutputReceived: false
  observedStatus: WAIT_AGENT_TIMEOUT_THEN_LATE_PASS_TEXT
  action: QUARANTINE_LATE_OUTPUT_AND_REJECT_TASK
```

## Terminal Observation

R2 通过既有独立 Reviewer dispatch 后，主 Agent 使用 `wait_agent(timeout_ms=900000)` 等待终态。15 分钟
硬上限到达时工具返回 `timed_out=true`，没有交付 Reviewer 终态。紧随其后的只读 `list_agents` 才显示
Reviewer 已完成并附带 PASS 文本。

该 late output 的静态内容说明 R1 P3 测试缺口已关闭，但无法证明终态在 15 分钟截止前可用。根据冻结的
`review.maximumMinutes: 15`、`timeoutStatus: TIMEOUT` 与 fail-closed 规则，late PASS 不得倒推为期限内
PASS，也不得授权后续门禁。本卡 Reviewer Gate 真实终态为 `TIMEOUT`。

## Consequence

- R1 P3-01 修复提交与 late R2 文本均保留在不可变历史中，不 reset、amend、rebase 或删除。
- 在错误地把 late output 当作及时 PASS 后执行的 formal 命令真实 exit 0，但顺序已违反 Reviewer Gate，
  只能作为诊断事实，不能构成 ACCEPTED 或 local exact-tree promotion PASS。
- TASK-0128 以 REJECTED 关闭；replacement 必须重新授权、重新独立复核并重新执行完整正式门禁。
