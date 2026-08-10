# TASK-0137 独立 C4 Review R1 / R2

```yaml
taskId: TASK-0137
reviewerId: task0137_r1
verdict: PASS
reviewedCommit: 187c4f5c95e06bbc0b7f6bfb84f440d7a1db0a0b
candidateTree: ce09d8b6e9845724b5a214c41d3661e0f6b99b20
baseCommit: 23eda74e56b76cee3ff925c402b8a373bfacf52b
reviewerRunsExpensiveFullTests: false
r2:
  verdict: PASS
  reviewedCommit: 0e65262651f2dba077f52a28aef57609856a30e8
  candidateTree: 69ed63613b4ee776ca826a07d64adde196c72e0a
```

## R1 Findings

- **P0**: `0`；**P1**: `0`；**P2**: `0`；**P3**: `4`

无阻断 finding。P3 提示：

1. 新增负例测试带 `@unittest.skipIf(os.name == "nt")` 平台门控，与验收标准「无新增 skip」字面
   冲突（R2 已按 finding closure 合并为单测试，net 无新增 skip）。
2. precheck.sh 保留单元素循环 `for candidate in python`（可简化，保留最小 diff 属合理取舍）。
3. ps1 失败消息未说明期望 literal python（跨 wrapper 消息风格差异）。
4. 信息项：precheck.py/doctor.py 等 shebang 为 `#!/usr/bin/env python3`，属既有历史且
   precheck.py 在任务卡「明确范围外」未动；wrapper 以 `exec python precheck.py` 显式指定解释器，
   shebang 不参与 canonical/fallback 合同。

## R2 Findings（FINDING_CLOSURE + DELTA）

- **P0**: `0`；**P1**: `0`；**P2**: `0`；**P3**: `0`（delta 无新增）

P3-F1 已关闭：两个 wrapper 测试合并为单方法
`test_posix_wrapper_selects_literal_python_and_fails_closed_without_it`（正例 + 负例两场景，
恰好 1 个既有平台门控 skipIf，net 无新增 skip、无删测、无吞退出码）。R2 delta 只改
test_harness.py（+3/-4），无新结构性 P0/P1。

## Acceptance（R1 全量 + R2 delta）

- AGENTS.md、precheck.sh、precheck.ps1 全部以字面量 `python` 为唯一解释器引用；无 `python3`
  作为 canonical 或 fallback 残留（既有 shebang 除外，见 R1 P3-4）。
- wrapper 测试覆盖：python 可用时选择 python（正例 rc=0）；python 缺失时失败关闭（负例非零
  退出 + "Python 3.11+ is required" 明确错误）；不再回退 python3。探针实测 precheck.sh 在
  PATH 仅含 python3 时 exit=2 且 stderr 输出匹配断言子串。
- INV-HARNESS-001..009 无弱化：004 双 wrapper 仍 exec 同一 precheck.py 实现；007/008 未动。
- 完整 Harness、唯一 Precheck、唯一 diff check、pre-closure、push、远端 0/0 为执行侧门禁。

## Scope And Identity

R1 候选 `187c4f5` / tree `ce09d8b` 直接父 `a6b460d`；diff 只改 AGENTS.md、precheck.sh、
precheck.ps1、test_harness.py。R2 候选 `0e65262` / tree `69ed636` 直接父 `187c4f5`；delta 只改
test_harness.py。补丁无冲突标记、无尾随空白、无删测、无无条件 skip。

## Decision

**R1 PASS、R2 PASS。** 候选代码层面可进入正式门禁。Reviewer 未运行 Harness 全量、Doctor、
Precheck 或 `git diff --check`；本结论不替代任何正式门禁 PASS。后续唯一正式 Precheck 因
AGENTS.md 变更导致 `.harness/agent-entrypoints.yaml` 绑定 contentSha256 drift（该文件被卡
README 冻结 forbiddenPaths 禁止）而 FAIL——这是执行侧范围问题，非代码审阅结论，不能由本
结论替代为 PASS，也不改变本次代码审阅结论。
