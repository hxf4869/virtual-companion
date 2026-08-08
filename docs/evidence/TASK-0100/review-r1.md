# TASK-0100 R1 独立复核（独立 Reviewer，只读）

- 复核对象：候选提交 `95684f90db3651d6d0faecf9b1ce8a9e19ff919b`，Base `760743318a1153327373473fd3b7f3decfcae7a2`
- 复核范围：COMPLETE_MATRIX（Diff Scope、P2-07 原子 seq、P2-08 catalog 约束、P2-09/P2-11 终态 allocator、测试 23/42/45/49/50、验收对照、禁止事项）
- 结论：**PASS**（无 P0/P1/P2 blocking finding；2 条 P3 可选建议）
- 复核命令：`Independent Reviewer R1 for TASK-0100 frozen candidate`（read-only subagent，fork_turns=none）

## 逐项结论

### 1. Diff Scope — PASS
`git diff 7607433..95684f9` 变更路径全部落在任务卡 writeAllowlist（4 迁移 V7/V8/V10/V15 + 测试 23/42/45/49/50 + 卡/context-lock/project-state）；forbiddenPaths 零触碰（specs/**、catalog_tool.py、run-rls-tests.sh、其他迁移、Java 均未改）。

### 2. P2-07 原子 seq 分配 — PASS
- V8:271-289 append：单条原子 `UPDATE ... SET next_seq = next_seq + 1 ... AND stream_epoch = p_stream_epoch RETURNING next_seq - 1`（行锁 + epoch 谓词），NOT FOUND 失败关闭；首个事件 seq=1 契约保持；读后写窗口已移除。
- V8:326-331 advance：`SET next_seq = next_seq + p_count RETURNING next_seq` 原子累加。
- 预检与原子 UPDATE 之间的 reset 竞态由 UPDATE 谓词关闭（零行 → raise）。

### 3. P2-08 catalog 约束 — PASS
- V8:58-67 CHECK `realtime_event_type_catalog` 与 specs/catalog/realtime-events.yaml durable:true 的 9 个 code 逐项一致；chat.delta/chat.replace/stream.* 不在其中。
- append 窄函数（V8:246-252）只接受 5 个 durable 非终态类型。
- `append_terminal_event`（V8:333-395）只接受 4 个终态类型；V8:728-732 REVOKE PUBLIC 且未出现在 GRANT vc_api 列表——仅 SECURITY DEFINER 终态函数可执行。

### 4. P2-09/P2-11 终态 allocator — PASS
- V7 finalize、V15 terminalize、V10 cancel 均以 `append_terminal_event` 替代内联 INSERT，同事务原子分配真实 epoch/seq 并推进 high-water；cancel 同事务写 chat.cancelled（P2-11）；V15 已删除不再使用的 v_row_id；锁顺序一致（generation 先于 stream）。

### 5. 测试 — PASS
23（chat.completed epoch 1 seq 2 + next_seq=3）、42（chat.failed epoch 1 seq 1 + next_seq=2）、45（cancel 获胜方 1 条 chat.cancelled / 0 条 chat.completed）、49（dblink 并发 append {1,2}、并发 advance {5,7}、next_seq=7、连接复用前 drain）、50（foo/chat.delta/终态类型拒绝、直接 INSERT CHECK、vc_api 无 EXECUTE、cancel 原子事件、reset 后 epoch 2 seq 1 + resume 顺序）全部覆盖验收 1-4；回归静态核查 16/17/20/22/25/30/41/44/46/47 与 CHECK/allocator 兼容。

### 6. 验收对照 — 1-7 可满足（5/6/7 的实跑属终态检查职责）
### 7. 禁止事项 — PASS（无删测、无 skip、无吞退出码、无环境注入、无手改生成物、specs/catalog 未改）

## 发现清单

- P0/P1/P2：无
- P3（可选建议，已由实施者采纳进 fix batch de9402f，R2 复核关闭）：
  1. advance_realtime_seq 的原子 UPDATE 无 NOT FOUND 检查（当前不可达，建议补失败关闭纵深防御）。
  2. append_terminal_event 不校验 generation 终态状态（依赖调用方 + owner-only 权限，建议在 allocator 内加终态断言）。

结论：候选提交符合任务卡全部要求，可进入 fix batch（R1 P3 采纳）与 R2 delta 复核、终态验证与闭包流程。
