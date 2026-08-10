# TASK-0138 独立 C4 Review R1

```yaml
taskId: TASK-0138
reviewerId: task0138_r1
verdict: PASS
reviewedCommit: 7f7f44e6a72378abba66c22b07f5fbfe48c4fe5c
candidateTree: 15df2c427917096aff6a7bef6189edf05e9feabd
baseCommit: 336dc60d4fc12bca33ae55cffe367efa50821903
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`；**P1**: `0`；**P2**: `0`；**P3**: `3`（信息性）

无阻断 finding。P3 提示：

1. precheck.py/doctor.py 等 shebang 仍为 `#!/usr/bin/env python3`——本卡明确范围外未动，且是
   直接执行 shebang 而非 canonical/fallback 探测引用，属知情保留。
2. precheck.ps1 候选列表只剩 python 后，venv/setup-python 优先注释语义仍成立（PATH 前置解析）。
3. AGENTS.md 保留「不依赖 python3 字面量」否定表述，为刻意声明，非残留。

## Acceptance

- AGENTS.md、agent-entrypoints.yaml、precheck.sh、precheck.ps1 全部以字面量 `python` 为唯一
  解释器引用；无 `python3` canonical/fallback 残留。**独立复算**：候选 AGENTS.md sha256 =
  `3342044d…`，与 agent-entrypoints.yaml 中 codex/zed/githubCopilotCliAgentInstructions 三处
  contentSha256 精确一致；CLAUDE.md 两处绑定未变且与实测一致。
- wrapper 测试合并为单方法 `test_posix_wrapper_selects_literal_python_and_fails_closed_without_it`，
  保留原平台门控，正例/负例覆盖；方法与 skipIf 数量 Base/父/候选均为 262/1，净持平，无删测、
  无新增 skip；断言与 precheck.sh 实际输出匹配（/tmp 伪造 PATH 探针实测 rc=0/rc=2 与输出一致）。
- INV-HARNESS-001/004/007/008 无弱化；绑定自洽强化。

## Scope And Identity

候选 Commit、Tree、Base 与任务声明一致；候选直接父为 `7b9047e…`。实现提交只改 5 个允许路径
（AGENTS.md、agent-entrypoints.yaml、precheck.sh、precheck.ps1、test_harness.py，+29/-13）。
补丁无冲突标记、无尾随空白、无删测、无新增 skip。

## Decision

**PASS。** 候选 P0/P1/P2/P3 为零（P3=3 信息性），代码层面可进入正式门禁。Reviewer 未运行
Harness 全量、Doctor、Precheck 或 `git diff --check`；本结论不替代任何正式门禁 PASS。后续唯一
完整 Harness 门禁因 TASK-0066/0067 恢复记录测试对 AGENTS.md 不可变的既有断言（非本候选回归，
非 Doctor/机器真源绑定）而 FAIL——该门禁结果不能由本结论替代为 PASS，也不改变本次代码审阅结论。
