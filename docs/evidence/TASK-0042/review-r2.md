# TASK-0042 R2 delta-only 评审

```yaml
taskId: TASK-0042
reviewerId: task-0042-independent-reviewer-r2
kind: independent-delta-review
verdict: FAIL
reviewedCommit: 26d3eb4ea196fedb66b82a8d11b7a36caa0ad2c7
reviewedTree: 890c39976ebbb212ee9afa7b8b3d3de8f5b73681
```

## 结论

FAIL。R1 Sources exact-once 与 synthetic fixture 两项已关闭；旧 ValidationFlow 主体语义已迁移，
但 wrapper Evidence 身份仍未关闭并形成新的阻断 P1。新增 P0 为 0，新增 P1 为 1；未发现其他
delta 相邻风险。

## 未关闭 finding

- policy 和 AGENTS 都规定 wrapper 不是 Evidence alias；Skill 却写成 wrapper 不是 alias
  “unless its exact argv was frozen”，错误允许冻结后成为 alias。正确语义应是冻结 wrapper
  后把它作为实际命令记录，仍不能成为 Python canonical 的别名。
- 测试只用前缀子串断言，无法捕获该 `unless` 例外。

唯一修复批次已经使用，合同禁止第二批修复与 R3；Reviewer 明确要求停止，不得进入 candidate
canonical、exact-SHA CI 或 ACCEPTED。
