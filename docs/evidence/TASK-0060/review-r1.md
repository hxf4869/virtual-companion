# TASK-0060 R1 independent static review

```yaml
taskId: TASK-0060
reviewerId: task-0060-independent-reviewer-r1
kind: independent-complete-matrix-review
verdict: FAIL
reviewedCommit: 0cabbbf26db096d6baad78b128b3167b38f2c38d
reviewedTree: 3b8a1b2999a6e7005adec000f31e5a3ccbd37cbb
```

## Result

FAIL with P0=0, P1=1, P2=0, and P3=0.

The Context Lock, four permanently unique successor titles, exact card/backlog
hash projections, unchanged TASK-0056, TASK-0054 preservation, TASK-0055
dependency on TASK-0060, strict successor chain, next-promotable projection, and
retained policy/Skill/entrypoint/workflow boundary all passed the static matrix.

The P1 was in `task0060_planning_repair_projection()`: the one authorized repair
edge compared only `tasks`. It could therefore carry a rewrite of a root static
contract such as `rules`, then restore that field in the next commit, while the
repair count remained exactly one and the current contract stayed valid. Existing
negative tests covered only task-entry variants.

Reviewer required one batch to make immutable root contracts fail closed, require
the TASK-0060 repair projection to preserve the entire non-task root object, and
cover both corruption and restoration edges.

Reviewer did not modify files or run Doctor, tests, canonical, pre-closure, or CI.
