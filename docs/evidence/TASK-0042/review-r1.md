# TASK-0042 R1 独立静态评审

```yaml
taskId: TASK-0042
reviewerId: task-0042-independent-reviewer-r1
kind: independent-complete-matrix-review
verdict: FAIL
reviewedCommit: 46bbc9824db782c903d70970471629aa26bc29c9
reviewedTree: 8fe69170ab956bfcb5cda0288ac32e062eeee818
```

## 结论

FAIL。P0 为 0，P1 为 3，P2/P3 为 0。Commit/Tree、线性单父历史、allowlist、Backlog
顺序/依赖、0039～0041 原子 SUPERSEDED 边、Skill frontmatter/ASCII、Hash 投影均通过。

## 阻断 findings

- P1：Doctor 只检查 `taskDeliveryPolicy` 指定键，未拒绝同一路径 Sources alias；需要 exact-once
  校验和 duplicate-alias 负例。
- P1：旧 ValidationFlow 的完整策略未全部迁移；policy/Skill/test 缺约 60 秒默认轮询及禁止并行
  `status`、`ps`、重复日志抓取等语义。
- P1：real-Git baseline fixture 虽已清空 resolutions、合成 PLANNED metadata 并保存/恢复
  synthetic bytes，仍读取当前 workspace lifecycle/card，不满足完全自包含。

Reviewer 未运行 canonical、全量 Harness 或 CI。
