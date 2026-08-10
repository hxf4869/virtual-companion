# TASK-0147 R1 独立复核（完整矩阵）

- Reviewer: task0147_r1（独立只读子代理，无本任务历史上下文）
- 审阅候选: commit `b2aeb9812f427fd7c70404bbca3f95ab8db5b1a0` / tree `bbacc2356b9ac4f95617c8705ab679b73b9e0be5`（父 `dbd8dbb`）
- 预算: 15 分钟；耗时 137.3s
- 结论: **VERDICT: PASS**（P0=0、P1=0、P2=0、P3=1 信息性）
- Reviewer 未运行任何正式门禁（Precheck/完整 Harness unittest），如实 NOT_RUN。

## 复核范围

`git diff dbd8dbb b2aeb98` 恰好 2 个文件（1 改 1 增），全部落在任务卡 `writeAllowlist`：

1. `.harness/commands.yaml`（修改：新增 openapiValidate/openapiDrift 命令 + precheck profile 扩为 7）
2. `scripts/harness/tests/test_harness.py`（修改：precheck profile 精确断言同步 + 3 个新 openapi 测试）

## 发现

### P0
无。

### P1
无。

### P2（非阻塞）
无。

### P3（信息性，1 项）
- `test_harness.py` 的 `test_openapi_drift_fails_closed` 对真实生成物
  `specs/openapi/dist/openapi.snapshot.json` 做写-恢复：`try/finally` 在断言失败/异常路径下仍
  字节级恢复，与既有 catalog 测试模式一致；唯一理论残留是测试进程被 SIGKILL 强杀（可接受，仅
  作意识）。无并发风险（precheck profile 不含 harnessTests，正式 Precheck 与完整 unittest 串行）。

## 清单核对结论

- 候选身份：diff 恰 2 文件全在 writeAllowlist，未触碰 ci.yml/doctor.py/openapi_tool.py/specs/**/
  policy 文件；`git diff --check` 干净。**PASS**
- commands.yaml：openapiValidate（argv `[scripts/dev/openapi_tool.py, validate]`、timeoutSeconds
  300）与 openapiDrift（argv `[scripts/dev/openapi_tool.py, diff, --fail-on-drift]`、
  timeoutSeconds 300）精确注册；precheck profile 恰 7 命令无重复（`precheck.py --list` 实测 7
  条）；harnessPortabilityLocal 与父提交字节级一致。**PASS**
- doctor.py 兼容：CANONICAL_PRECHECK_COMMANDS 包含性校验不触发（7 ⊇ 5）；argv[0] 相对且文件
  存在；profile 引用命令均注册。**PASS**
- test_harness.py：profile 期望列表与 commands.yaml 逐项一致；注册契约测试断言
  argv/timeoutSeconds/profile 包含/harnessPortabilityLocal 不含；干净树测试与工具真实输出精确
  匹配（`OpenAPI validation: PASS`/`OpenAPI drift check: PASS`，均 exit 0 实测）；漂移测试追加
  字节后 exit 1 且 stderr 含 `DRIFT`（工具输出 `DRIFT: generated drift: openapi.snapshot.json`
  匹配），finally 字节级恢复。**PASS**
- INV-HARNESS-004：precheck.sh/ps1 均走 precheck.py 默认 precheck profile，三平台 wrapper 自动
  继承 openapi 命令，无 wrapper 差异。**PASS**
- 验收标准逐项可复测；正式门禁 Reviewer 未运行（NOT_RUN）。**PASS**

## 总体判断

候选身份纯净（2 文件、writeAllowlist 内、零越界），验收标准全覆盖且新测试真实可复测（干净树
PASS 已实测），INV-HARNESS-004 与 TASK-0074..77 combined gate 语义均保持，无阻塞问题。
结论 PASS。
