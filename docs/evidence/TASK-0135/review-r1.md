# TASK-0135 独立 C4 Review R1

```yaml
taskId: TASK-0135
reviewerId: task0135_r1
verdict: PASS
reviewedCommit: 6e0bdeeb5cfe0343a1ea6e457bdb79661ad82013
candidateTree: 29b7e18c98d8a1b64bed06e15d215014fd97b82d
baseCommit: 2fe3e470bb499aa1e968d6acd2d23f7421757077
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `3`

无阻断 finding。三条非阻断提示：

1. `_rejected_fingerprint_identity_exact` 的 `actual_fingerprint` 参数在函数体内未使用（死参数），
   实际 fingerprint 通过 `expected_mismatch_error` 文本精确绑定，无功能影响。
2. 共享 predicate 硬编码 `riskClass == "C3"`，与三个固定身份一致；对未来其他风险级历史会安全失败关闭。
3. 卡 frontmatter `reviewers` 的 canonical hash 绑定点本机无法独立复算（evidence/handoff 两处
   6/6 已复算匹配）；该绑定点由执行者的完整 Harness 正例测试覆盖，属执行侧验证项，非代码缺陷。

## Acceptance

- 三个固定正例全部精确绑定：15 个固定 commit 全部存在；12 条父边全部单父精确匹配；READY/terminal
  6 个 tree 全部匹配；12 个终态制品（terminal blob == 工作树 == sha256 常量）全部匹配；Ledger 3 条
  精确条目匹配；evidence/handoff 的 taskId/baseCommit/headCommit/state=REJECTED/ready Doctor check
  恰好 1 条且 status=FAIL/exitCode=1/命令精确匹配（含 "(READY activation)" 变体）/reviewers
  canonical hash 6/6 匹配；三卡 frontmatter 的 taskId/state=REJECTED/riskClass=C3/baseCommit/
  authorizationCommit/contextFingerprint/contextLock 全部匹配常量；错误元组精确等于
  `verify_context_lock` 产出（fingerprint payload 复算三例全部等于各自 actual 值）。
- `harness_common.py` 零改动；`verify_context_lock` 未被触碰；生产 doctor.py 任何路径均不调用
  三个 predicate（仅测试消费 + 聚合函数自身）；无 CLI flag、env override、Git note/replace/graft、
  可配置 allowlist、前缀/后缀/通配豁免。
- 消费点 `test_all_context_locks_are_reproducible` 为 `if errors and
  doctor.rejected_fingerprint_history_isolated(task, errors): continue`，仅 errors 非空且精确命中时
  跳过，其余任务仍 `assertEqual([], errors)`；新增正例/身份字段变异/errors 漂移/fixed-fingerprint/
  交叉历史/tree 漂移/ledger 漂移/artifact 漂移全覆盖。

## Scope And Identity

候选 Commit、Tree、Base 与任务声明一致；候选直接父为
`8e1d60363254d990adc1a50ac2d71a2c1c14445a`。候选只修改任务卡、`scripts/harness/doctor.py`
与 `scripts/harness/tests/test_harness.py`。补丁无冲突标记、无尾随空白、无 skip/删除测试。

## Invariants

INV-HARNESS-001..009 均未被削弱：003 精确批准路径不变；005 隔离只绑定真实 FAIL/exit 1 证据；
006/007/008/009 相关文件零改动。异常处理一律 return False，失败关闭完整。

## Decision

**PASS。** 候选 P0/P1/P2/P3 为零（P3=3 非阻断提示），代码层面可进入正式门禁。Reviewer 未运行
Harness 全量、Doctor、Precheck 或 `git diff --check`；本结论不替代任何正式门禁 PASS。后续唯一
正式 Precheck 因 READY 冻结任务卡授权投影被候选正文修改而 FAIL（执行侧越界，非代码审阅结论），
该门禁结果不能由本结论替代为 PASS，也不改变本次代码审阅结论。
