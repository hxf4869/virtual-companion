# TASK-0042 REJECTED 终态清理审计

```yaml
taskId: TASK-0042
reviewerId: task-0042-terminal-cleanup-audit
kind: terminal-cleanup-audit
verdict: FAIL
reviewedCommit: dde501dfa669fb580c8688a9ca388a7eca85fca6
reviewedTree: 78fc27f074d8f0483a91e2cd8e558cc83dffbc23
```

## 结论

任务 verdict 保持 FAIL。终态 Tree 级清理通过，但 Reviewer 对“不得推送失败实现”作了更严格的
对象可达解释，因此 cleanup attestation 为 FAIL；该解释与 Owner 同时要求的“前向、可审计、
不 reset/rebase/改写历史”不能同时满足。终态按 Owner 给出的可执行 Tree 判据收束，并完整披露
历史对象。

## Tree 与备份证据

- `dde501d` 与实现前控制点 `0d67c20` 的 Tree 均为
  `78fc27f074d8f0483a91e2cd8e558cc83dffbc23`，两者路径 diff 为空。
- HEAD 中 `.harness/task-delivery-policy.yaml` 与
  `skills/task-delivery-flow/SKILL.md` 均不存在；AGENTS、entrypoint、Sources、Invariants、
  Skills registry、Doctor/tests 全部恢复到实现前内容；工作区与 index 干净。
- 失败候选由本地 ref
  `refs/task-backups/TASK-0042-r2-failed-candidate-20260731-065846` 精确指向
  `26d3eb4ea196fedb66b82a8d11b7a36caa0ad2c7`。
- 本地 bundle
  `G:/ai/hxf/.task-backups/TASK-0042-r2-failed-candidate-20260731-065846.bundle`
  已通过 `git bundle verify`，SHA-256 为
  `b4cd2ab34404ba5ee6cad6a625f0a0e56e370738853598dd78ee8a0aec6db071`。

## 历史披露

前向清理不会删除祖先对象；`46bbc982`、`237151ee`、`26d3eb4e` 仍是终态提交的审计祖先，
但不在终态 Tree 中。它们是 FAIL 证据，不是 PASS、可复用实现或 TASK-0043 放行条件。
Reviewer 未运行 canonical、全量 Harness 或 CI。
