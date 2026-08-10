# TASK-0146 R1 独立复核（完整矩阵）

- Reviewer: task0146_r1（独立只读子代理，无本任务历史上下文）
- 审阅候选: commit `bf1f99b5c7078eace51873f8d0e6f6c20b5eca6b` / tree `c845414b85484f3b05538551c1b55461369ffaa8`（父 `c38648b`）
- 预算: 15 分钟；耗时 124.2s
- 结论: **VERDICT: PASS**（P0=0、P1=0、P2=0、P3=2 信息性）
- Reviewer 未运行任何正式门禁（Precheck/Maven），如实 NOT_RUN。

## 复核范围

`git diff c38648b bf1f99b` 恰好 2 个文件（1 改 1 增），全部落在任务卡 `writeAllowlist`：

1. `service/modules/modelruntime/.../authorization/InMemoryAuthorizationSnapshotStore.java`（修改）
2. `service/modules/modelruntime/src/test/java/.../authorization/InMemoryAuthorizationSnapshotStoreTest.java`（新增）

## 发现

### P0
无。

### P1
无。

### P2（非阻塞）
无。

### P3（信息性，2 项）
1. `InMemoryAuthorizationSnapshotStore.java:40-49,51-69` — withdraw/narrow 为 check-then-act
   （get → 校验 → put）非原子；并发 withdraw 与 narrow 竞争时两方均基于 ACTIVE 成功，最终状态由
   最后写入者决定（JDBC 靠 `WHERE status='ACTIVE'` 行锁先到先得、败者抛异常）。两种结果均为合法
   终态，无复活路径，单向契约不变量在并发下仍成立；仅与 JDBC 败者异常的可观测行为存在细微差异。
   可选建议：`ConcurrentHashMap.compute` 原子化（不在本卡范围）。
2. `InMemoryAuthorizationSnapshotStoreTest.java` — 未覆盖传入 `narrowed.status()` 非 ACTIVE 的
   用例（`copyWithStatus` 强制覆盖为 NARROWED，行为正确但无测试锁定）；亦无并发测试。验收标准
   未要求，不阻塞。

## 清单核对结论

- 候选身份：diff 恰好 2 文件，单父、tree 匹配、工作树 clean、`git diff --check` 空输出。**PASS**
- put insert-only 保持未变（putIfAbsent + already stored，消息与 JDBC 一致）。**PASS**
- withdraw 仅 ACTIVE 可转 WITHDRAWN，已终态（含 NARROWED）抛单向异常，不存在抛 not stored。**PASS**
- narrow 先校验 id 一致（IllegalArgumentException，与 JDBC 顺序一致）再仅 ACTIVE 可转 NARROWED。**PASS**
- 四类错误消息（not-stored/已终态/已存储/id 不一致）与 JDBC 逐字一致；端口契约满足。**PASS**
- 测试覆盖验收全部三分支（含 WITHDRAWN/NARROWED 交叉互转拒绝）并断言消息内容。**PASS**
- 生产代码（Guard/LiveModelInvoker）对 store 均为只读 find，零 withdraw/narrow 调用者；既有
  Guard 测试无回归；INV-AUTH-001 维持。**PASS**
- 验收标准逐项可复测；正式门禁 Reviewer 未运行（NOT_RUN）。**PASS**

## 总体判断

实现与 TASK-0144 JDBC 参照在单向转换、错误消息、校验顺序上逐字对齐，端口契约"不得复活已
withdraw/narrow 快照"被强制成立；测试覆盖完整、无回归风险、无阻塞项。结论 PASS。
