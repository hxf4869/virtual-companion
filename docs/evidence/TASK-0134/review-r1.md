# TASK-0134 独立 C4 Review R1

```yaml
taskId: TASK-0134
reviewerId: task0134_r1
verdict: PASS
reviewedCommit: e3b35ef5bfd168830805f4dd87fe43265573975d
candidateTree: b64c6bd02888a9168f8a35cfd55d6a7ebd37b446
baseCommit: 3c30dd693af0574eb160bbbd37b2e8e2b79a9d80
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `2`

无阻断 finding。两条非阻断提示：

1. `task0133_rejected_harness_approval_isolated` 中 scopes 计数与 `"harness-change" not in scopes`
   是冗余防御（approvals 整体已被 canonical SHA256 固定），无害，属纵深防御。
2. 负例测试未直接覆盖 approvals 其它字段变体、图边漂移、candidate blob 漂移与 evidence/handoff
   字段漂移（这些均被哈希绑定间接覆盖，但直接用例更佳）。

## Acceptance

- 正例对 candidate 与 terminal 两个 target 均识别；负例对 taskId/state/riskClass/baseCommit/
  authorizationCommit/path/target_commit/scope/tree/ledger/artifact 变体全部失败关闭；taskId
  检查在最前，另一任务细分 scope 必被拒。
- 普通 `scope == requiredSkill` 精确批准路径零改动（`approved=True` 时 predicate 不调用）；
  仅 `not approved and skill_id == "harness-change"` 分支消费；无 CLI flag、env override、
  Git note/replace/graft、可配置 allowlist 或 alias。
- `test_rejects_merge_on_discovered_primary_branch` 三例（无 global config / 显式 main /
  显式 master）共享新增断言：`git rev-list --parents -n 1` 输出 token 数为 3 且 target 居首，
  证明真实双亲 merge，并保留 derivation 拒绝断言。
- 消费点仅在 `validate_diff_scope`，生产调用 target 恰好落在 predicate 允许的
  {candidate, terminal} 集合；TASK-0134 自身含精确 `harness-change` 批准走普通路径；
  不破坏 Precheck/唯一 diff check/R1/pre-closure/push/远端 0/0 的执行可能。

## Scope And Identity

候选 Commit、Tree、Base 与任务声明一致；候选直接父为
`a3df26e43bf7428913675d897101c4ce2bd0a445`。候选只修改
`scripts/harness/doctor.py` 与 `scripts/harness/tests/test_harness.py`（+360/-1），
补丁无尾随空白、无冲突标记、无 skip/删除测试。硬编码常量与任务卡 Context Lock
`rejectedHistoryQuarantine` 完全一致（6 条图边、3 个 tree、READY 卡 blob sha
c6149cf3、candidate test blob sha 51e08137、5 个 terminal artifact、ledger 条目、
approvals/reviewers canonical sha、evidence formal check FAIL/exit 1/hash 绑定）。

## Invariants

INV-HARNESS-001..009 均未被削弱：003 精确批准路径不变；005 隔离只绑定真实 FAIL/exit 1
证据；007 交付策略零改动。异常处理（HarnessError/OSError/UnicodeError/JSONDecodeError/
YAMLError）一律 return False，失败关闭完整。

## Decision

**PASS。** 候选 P0/P1/P2/P3 为零（P3=2 非阻断提示），可进入正式门禁。Reviewer 未运行
Harness 全量、Doctor、Precheck 或 `git diff --check`；本结论不替代任何正式门禁 PASS。
后续完整 Harness 门禁的 TASK-0111 既存 fingerprint 失败（Base 3c30dd69 上同测同样 FAIL，
非本候选回归）不改变本次代码审阅结论，也不能由本结论替代为门禁 PASS。
