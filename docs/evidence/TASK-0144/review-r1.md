# TASK-0144 R1 独立复核（完整矩阵）

- Reviewer: task0144_r1（独立只读子代理，无本任务历史上下文）
- 审阅候选: commit `9d4a14a3e799e80ce335007d3a2312b117da3caf` / tree `d34bb2a4231bfbce5c19ebeb084e8538dafb1442`（父 `eac715a2`）
- 预算: 15 分钟；耗时 257.4s
- 结论: **VERDICT: PASS**（P0=0、P1=0、P2=1 非阻塞、P3=4 信息性）
- Reviewer 未运行任何正式门禁（Precheck/Maven/SQL suite），如实 NOT_RUN。

## 复核范围

`git diff eac715a 9d4a14a` 恰好 3 个文件（1 改 2 增），全部落在任务卡 `writeAllowlist`：

1. `service/platform/persistence/.../JdbcAuthorizationSnapshotStore.java`（修改）
2. `service/platform/persistence/src/test/java/.../JdbcAuthorizationSnapshotStoreTest.java`（新增）
3. `infra/db/tests/51_authorization_snapshot_one_way_lifecycle.sql`（新增）

## 发现

### P0
无。

### P1
无。

### P2（非阻塞，1 项）
- `JdbcAuthorizationSnapshotStore.java:36-38` 类 Javadoc 与任务卡 "API/事件/数据契约" 声称与
  `InMemoryAuthorizationSnapshotStore` 语义对齐，但内存实现 `withdraw` 仅 `requirePresent`（对已终态
  幂等成功）、`narrow` 可将 WITHDRAWN 终态转 NARROWED——即内存实现允许终态再转换，JDBC 严格拒绝。
  任务卡要求的 JDBC 行为正确且满足端口契约（"must not resurrect"），不阻塞；建议修正 Javadoc 措辞
  或记录为后续对齐项。

### P3（信息性，4 项）
1. `JdbcAuthorizationSnapshotStoreTest` 未直接单测 narrow-not-stored 分支（共享 `transitionFailure`
   空分支已由 `withdrawMissingSnapshotFailsClosed` 覆盖，风险极低）；narrow 参数绑定顺序仅靠代码阅读。
2. V3 表存在全局 `UNIQUE (snapshot_id)`：跨 owner 重复 id 走 `put()` 时抛 `DuplicateKeyException`
   而非同 owner 的 `IllegalStateException`；两者均失败关闭，SQL 测试 Phase 5 已在 SQL 层验证。
3. `transitionFailure` 中 UPDATE(0 行) 与 `find()` 之间极小 TOCTOU：并发同 id 插入会使错误消息措辞
   矛盾，但语义仍失败关闭。
4. SQL Phase 1 用裸 INSERT 断言 `unique_violation`，未执行 Java 侧 `ON CONFLICT DO NOTHING` 本体
   （该路径由 Java 单测 SQL 文本捕获 + affected=0 语义钉住），两者互补。

## 清单核对结论

- 候选身份：diff 恰好 3 个文件，全部在 writeAllowlist，无 migration/forbiddenPaths 越界。**PASS**
- put insert-only：`ON CONFLICT ... DO NOTHING`、无 `DO UPDATE`；affected=0 抛
  `IllegalStateException("already stored")`。**PASS**
- withdraw/narrow 单向：单条条件 UPDATE（`AND status = 'ACTIVE'`，行锁由单条原子 UPDATE 保证）；
  affected=0 经 `find()` 分类 "not stored" / "only ACTIVE may transition"；narrow 先校验 ID 一致。**PASS**
- RLS/租户：`vc.current_owner_id()` 绑定 INSERT，UPDATE/SELECT 由 V3 FORCE RLS 策略兜底，未被削弱；
  SQL Phase 5 实测跨 owner 0 行 + 无法复用 id；错误消息无敏感数据。**PASS**
- 测试充分性：Java 单测覆盖全部失败分支；SQL 51 覆盖重复插入、终态不可复活/不可再转换、并发 withdraw
  单胜（dblink 双会话，主会话先 `FOR UPDATE` 持锁保证确定性胜负，COMMIT 后才 `dblink_get_result`，
  无死锁）、跨 owner 隔离；与 06 互补不冲突。**PASS**
- 验收标准可复测：逐条映射到具体断言；正式门禁 Reviewer 未运行（NOT_RUN）。**PASS**
- 不变量：INV-AUTH-001（双快照绑定）依赖 schema/FK 未动，单向生命周期为失败关闭加强；
  INV-TENANT-001 未削弱并获 Phase 5 实证。**PASS**

## 总体判断

候选实现完整、精确落地任务卡范围：insert-only put、状态条件单语句 withdraw/narrow、narrow ID 校验、
错误分类与 Java/SQL 双层测试齐备，并发与跨租户语义经真实 PostgreSQL 测试设计验证且无确定性竞态。
无 P0/P1；唯一 P2 为 Javadoc 措辞/内存实现对齐事项（不阻塞，fix batch 处理）。
