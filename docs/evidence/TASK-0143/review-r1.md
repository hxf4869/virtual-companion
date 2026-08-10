# TASK-0143 独立 C4 Review R1

```yaml
taskId: TASK-0143
reviewerId: task0143_r1
verdict: PASS
reviewedCommit: f5da58a5813b0fcb6d568115374bf6cc207c3b3c
candidateTree: 5f073233800c0ceb671adc6beba5fd2614416fc0
baseCommit: 4a5d68119eb544f3c3746ff03dbfb31e1ad088b9
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`；**P1**: `0`；**P2**: `0`；**P3**: `3`（信息性）

无阻断 finding。P3 提示（已在 R2 delta 全部关闭）：

1. 默认超时（1800s）未输出说明文字（卡范围内字面表述偏差；R2 已补输出）。
2. precheck.py 残留无用 `import subprocess`（R2 已移除）。
3. harness_common.py 死代码 `started`/`finally: _ = started` 与 tasklist 断言健壮性提示
   （R2 已移除死代码）。

## Acceptance

- commands.yaml 7 个命令全部有 `timeoutSeconds`（doctor 900、catalogValidate 300、
  catalogDrift 300、paidFeatureCheck 120、betaRosterGate 120、durableCommand 600、
  harnessTests 3600），与卡数值一致；profile 结构与 argv 未变。
- `run_command_with_timeout`：正常路径返回 `(真实退出码, False)`（communicate 正常回收）；
  超时路径 `_terminate_process_tree`（POSIX start_new_session + killpg SIGKILL；Windows
  CREATE_NEW_PROCESS_GROUP + taskkill /F /T）后再次 communicate 回收，返回 `(returncode, True)`，
  不吞退出码。
- precheck.py：超时输出 `== cid: TIMEOUT (exit=..., elapsed=..., timeout=...s, process tree
  terminated)` 并计入 failures（precheck 退出码 1）；PASS/FAIL/TIMEOUT 分支互斥；PASS/FAIL
  分支语义不变。
- doctor.py 两处精确命令投影断言（harnessTests: 3600、durableCommand: 600）与 commands.yaml
  逐字一致。
- TimeoutTests：4 个新测试（正常完成、POSIX 进程树终止——child spawn grandchild 写 PID +
  sleep 3600、timeout 2s、断言 grandchild 进程消亡；Windows taskkill 路径；显式/默认超时值）+
  1 个 precheck TIMEOUT 集成测试；平台门控恰为 Windows/POSIX 各一，无新增无条件 skip；测试数
  265 → 270，无删测。
- ci.yml backend `timeout-minutes: 30`、frontend `timeout-minutes: 20` 已补。
- 相邻风险：全链 base→candidate 仅 9 个 writeAllowlist 文件；precheck.sh/ps1、
  durable_command.ps1、catalog_tool.py、check_*.py、AGENTS.md、policy、skills 未触碰；
  INV-HARNESS-001..009 无削弱；无冲突标记、无尾随空白、LF 行尾。

## Scope And Identity

候选 Commit `f5da58a`、Tree `5f073233…` 与卡声明一致；单父 `91aa1e8`（IN_PROGRESS）；提交链
DRAFT `ac49644` → DRAFT 修正 `bf7c0cb` → 授权 `4c58d97`（与卡 authorizationCommit 一致）→
绑定 `1048e9c` → IN_PROGRESS `91aa1e8` → 实现 `f5da58a`。实现提交精确只改 6 个 writeAllowlist
文件（commands.yaml、precheck.py、harness_common.py、doctor.py、test_harness.py、ci.yml），
无 forbiddenPaths 触碰。

## Decision

**PASS。** 候选身份、单父、tree、授权链全部核对一致；实现范围精确限于 6 个授权路径；
`run_command_with_timeout` 的 POSIX killpg / Windows taskkill 实现、退出码透传与 communicate
回收逻辑正确；TIMEOUT 状态语义（非 PASS/FAIL、计入 failures、非零退出）与卡契约一致；doctor.py
两处断言逐字同步；测试为真实进程树终止验证且平台门控恰为 Windows/POSIX 各一、无删测无无条件
skip。3 条 P3 均为风格/文档级，已在 R2 delta 全部关闭。本结论不替代任何正式门禁 PASS。
