# TASK-0095 R2 独立评审报告（delta 复核）

- 候选：`5c64000f44b38c40ac4b6856eb4d7ea0cf6d3b54`
- Tree：`4c22e2661b1f95958d8757f4ff6a31a01cf4c85b`
- Reviewer：`task0095_r1`，只读评审，未修改仓库
- Verdict：**APPROVE**

## R1 关闭复验（FINDING_CLOSURE）

- P3-1 关闭：`test_doctor_cache_hit_misses_when_environment_changes_during_lookup`
  注入值改为读取 ambient TZ 后保证不同的值（`Etc/GMT-14` 或 `Etc/GMT+14` 互斥），
  任意 ambient（含缺失、`Etc/UTC`、`Etc/GMT-14` 自身）下 `environmentSha256`
  （绑定 `TZ` 键）必然变化；`finally` 恢复逻辑保留，无环境泄漏。
- P3-2 关闭：`_cache_race_run` 泛化新增 `recompute_results`，`_compute` 在 n==2
  （lookup 之后、重算之前，即 TOCTOU 窗口）优先消费；新增
  `test_doctor_cache_hit_misses_when_manifest_recomputation_fails`，以
  `recompute_results=[None]` 强制重算返回 None → miss。n==3 时列表已空回落 None，
  写 receipt 条件不成立，不会写入任何 receipt。R1 既有 7 个调用点全部向后兼容。

## Delta 范围

- `git diff 06e3967..5c64000 --stat` 仅 `scripts/harness/tests/test_harness.py`
  （37 insertions / 5 deletions），未触碰 doctor.py、机器策略、Skill、Evidence。
- `git diff --check` 退出码 0。

## 复跑

```
python -m unittest scripts.harness.tests.test_harness.GitHistoryPolicyTests
Ran 52 tests in 23.017s — OK — UNITTEST_EXIT=0
```

关键测试单跑（3 tests in 3.004s，全部 ok）：
- `test_doctor_cache_hit_misses_when_manifest_recomputation_fails` ... ok
- `test_doctor_cache_hit_misses_when_environment_changes_during_lookup` ... ok
- `test_doctor_cache_hit_revalidates_unchanged_manifest_and_passes` ... ok

## 发现

- P0/P1/P2：无。
- P3（观察性，非阻塞）：`recompute_results.pop(0)` 原地消费调用方列表；当前两个
  调用点均内联新建列表，无共享状态问题，未来复用需注意。

R1/R2 均 APPROVE，候选 v2 可进入 canonical Precheck 与 PRIMARY_REMOTE_EXACT_SHA。
