# TASK-0136 独立 C4 Review R1

```yaml
taskId: TASK-0136
reviewerId: task0136_r1
verdict: PASS
reviewedCommit: 066b33ccca8a46a2dbdbe7b98a2bb82965a2906d
candidateTree: 721695e8d7c044c817ba7998d15fea7d4da278b5
baseCommit: b1a904d20095dc675473c4896e2bace85712eb2e
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `0`
- **P3**: `2`

无阻断 finding。两条非阻断提示：

1. 测试负例未直接覆盖「图边漂移」与「evidence/handoff 字段漂移」的 patch 级用例（现有 tree/ledger/
   artifact 漂移 patch 覆盖同一失败关闭机制），属低风险补强建议。
2. 三个公开 predicate 与聚合函数仅被测试消费、doctor 生产路径不引用——与任务卡「范围内」声明的
   唯一消费点一致，仅提示未来维护者注意该设计边界。

## Acceptance

- 三固定历史正例精确绑定；全负例（taskId/state/riskClass/baseCommit/authorizationCommit/
  contextFingerprint/contextLock/_path/errors 三态/fixed-fingerprint/交叉/tree/ledger/artifact 漂移）
  失败关闭；交叉历史错误文本互配不放行；其他任务仍严格断言空 errors。独立实值核验：12/12 单父边、
  6/6 tree、3/3 Ledger 精确条目、12/12 终态产物（工作树 == Git 对象 == 冻结 hash）、9/9 reviewers
  canonical hash（卡/evidence/handoff 三处一致）、evidence taskId/base/head=binding、handoff
  state=REJECTED。
- 普通 context-lock 校验路径零改动；无 CLI flag/env override/Git note/replace/graft/可配置
  allowlist/前缀/后缀/通配豁免；`harness_common.py` 与 Base 完全一致（零改动）；`verify_context_lock`
  错误文本与冻结常量逐字一致。
- 候选 diff（parent..candidate）只移除 `_rejected_fingerprint_identity_exact` 的 `actual_fingerprint`
  死参数（签名 + 三个调用点，-4 行），无残留引用；`TASK_*_ACTUAL_FINGERPRINT` 常量仍被
  `EXPECTED_MISMATCH_ERROR` 使用，保留合理。
- READY Doctor 条目每卡恰好 1 条匹配精确集合（TASK-0111 无后缀、0124/0129 带 "(READY activation)"），
  status=FAIL、exitCode=1；`--pre-closure` 条目被精确集合正确排除。

## Scope And Identity

候选 Commit、Tree、Base 与任务声明一致；候选直接父为
`b81ba9ffb68554cbfd5d7d1e900c81bd9f46fcaf`。parent..candidate 只改
`scripts/harness/doctor.py`（-4 行）；Base..candidate 额外包含 lifecycle 提交（project-state、
任务卡、context-lock），全部落在 writeAllowlist 内。三历史隔离核心实现与测试在 Base 中已完整
存在（TASK-0135 REJECTED 历史保留），本卡承接并清理死参数。补丁无冲突标记、无尾随空白、无
skip/删除测试。

## Invariants

INV-HARNESS-001..009 均未被削弱：003 精确批准路径不变；005 隔离只绑定真实 FAIL/exit 1 证据；
harness_common.py/策略/Skill/阈值/受保护路径零改动。异常处理一律 return False，失败关闭完整。

## Decision

**PASS。** 候选 P0/P1/P2/P3 为零（P3=2 非阻断提示），可进入正式门禁。Reviewer 未运行
Harness 全量、Doctor、Precheck 或 `git diff --check`；本结论不替代任何正式门禁 PASS。
