# TASK-0095 R1 独立评审报告

- 候选：`06e3967e83cbbd352c47de8cd1cd7607177a53d6`
- Tree：`f6f8185870d85dccdcd221f40a7f4ff0f402ce6e`
- Reviewer：`task0095_r1`，只读评审，未修改仓库
- Verdict：**APPROVE**

## 范围与完整性（COMPLETE_MATRIX）

- `git diff d3e43de..06e3967 --stat` 仅 5 个文件，全部在任务卡 writeAllowlist 内：
  `.harness/project-state.yaml`、`docs/tasks/TASK-0095-doctor-receipt-cache-toctou.md`、
  `docs/tasks/context/TASK-0095.context-lock.yaml`、`scripts/harness/doctor.py`（+22）、
  `scripts/harness/tests/test_harness.py`（+236）；零触碰 forbiddenPaths
  （`harness_common.py`、`precheck.py`、`skills/`、`.github/`、CI、Maven/前端/数据库）。
- `git diff --check` 退出码 0。

## 实现（doctor.py main() cache-hit 分支，17443-17469）

- 返回 PASS 前调用 `compute_doctor_receipt_manifest(...)` 重算完整 manifest，不传旧
  snapshot（内部构造全新 `DoctorGitSnapshot()`，所有字段重新读取）。
- 重算返回 `None`（无法建立稳定候选身份）→ `_c = None` 按 miss 处理，不 PASS。
- 重算与 lookup manifest 逐字段不一致（任何输入变化）→ `_c = None` 按 miss 处理，
  进入真实校验。
- `verify_unchanged` 语义保留；`audit.error` 时仍走 FAIL。
- 真实校验结束写 receipt 的条件（`_completed_manifest == _receipt_manifest`）未变，
  竞态变化持续存在时不会把旧 manifest 写入新 receipt。

## 测试

- 新增 7 项：1 个合法 hit 重验（无变化仍 PASS + summary + `[receipt hit`）与 6 个
  lookup 窗口竞态负测（graft、replace refs、Git config、timezone source、environment、
  implementation identity），注入点位于 lookup 之后、重算之前（TOCTOU 窗口）。
- 未删除既有测试、未加 skip、未吞退出码。

## 复跑

```
python -m unittest scripts.harness.tests.test_harness.GitHistoryPolicyTests
Ran 51 tests in 21.726s — OK — UNITTEST_EXIT=0
```

## 发现

- P0/P1/P2：无。
- P3（非阻塞）：
  1. environment 竞态测试注入固定值 `TZ=Etc/UTC`，若 ambient TZ 恰为该值会假失败
     （GitHub Actions 等环境常见）；建议改为注入保证异于 ambient 的值。
  2. 重算返回 None（身份建立失败）路径无专门单测；属可选增强。

采纳两条 P3 后形成候选 v2，由 R2 复核 delta。
