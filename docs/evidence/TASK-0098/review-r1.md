# TASK-0098 独立复核 R1

- Reviewer: 独立 subagent（fork_turns=none，只读，15 分钟预算内完成）
- 候选提交: `5a0f0cff65fc18e56fe9728c127a23882635185f`
- 候选 Tree: `937d2eebff42023a109cd18dc1a9d546420cbc88`
- 基准: IN_PROGRESS 提交 `2d1061fe10e80c06ecb9095a0fae1adef0703059`
- verdict: **PASS**（无 P0/P1/ACCEPTANCE/INVARIANT 违例；无 blocking finding）

## 复核范围

COMPLETE_MATRIX + ACCEPTANCE + INVARIANTS + ADJACENT_RISK；只读复核，未执行写操作、未重跑容器套件（执行方前提：全新 pgvector 容器 V1-V15 全量迁移后 47/47 SQL 测试 PASS；READY Doctor PASS 410672 checks；维护记录与 8 路径维护边由 Doctor 验证）。

## Findings

### 1. Diff 范围 — PASS
候选相对 IN_PROGRESS 仅 6 个文件：V7、V15、44/45/46/47，全部在任务卡 writeAllowlist；零 forbiddenPaths 触碰；无删除测试、无 skip、无吞退出码（44-47 均 `\set ON_ERROR_STOP on`，断言失败即 RAISE EXCEPTION 非零退出）；`git diff 2d1061fe 5a0f0cff --check` 干净。

### 2. V7 finalize_generation — PASS
- `SELECT ... FOR UPDATE` 锁 generation 行；锁内复查 `status='FINAL_REVIEW'` 与 `assistant_message_id IS NULL`（INV-GEN-002 幂等守卫）。
- 条件 UPDATE winner：`UPDATE ... WHERE ... AND status='FINAL_REVIEW'` + `IF NOT FOUND THEN RAISE`。
- message 表新增可空 `generation_id` + 复合 FK（ON DELETE SET NULL）+ 部分唯一索引 `message_generation_one_final`（WHERE generation_id IS NOT NULL AND role='assistant'）。
- finalize 插入 assistant message 写入 generation_id；签名/GRANT/REVOKE/p_fault 钩子保持不变。

### 3. V15 insert_generation_candidate — PASS
`FOR UPDATE` 锁 generation 行，锁内复查 6 个终态（与 generation-states.yaml 的 terminal 状态逐字一致）；`record_provider_attempt`/`record_quota_release` 等其余函数未改动。

### 4. 并发测试 44-47 — PASS
全部用 dblink 实现两独立 DB 后端（SET ROLE vc_api 模拟 API 客户端）：
- 44 finalize/finalize：双异步发送真实竞争行锁；断言恰好一个获胜（双赢/双输即失败）、loser 错误 `current COMPLETED`、message/usage/SETTLE/chat.completed/outbox/is_final 各恰 1。
- 45 finalize/cancel：持锁 + 在途 finalize 阻塞 + 锁内 cancel 获胜 → 迟到 finalize 失败（`current CANCELLED`）且零残留。
- 46 finalize/terminalize：同模式，OUTPUT_BLOCKED/chat.blocked=1/chat.completed=0/零残留。
- 47 candidate/terminalize TOCTOU：迟到 candidate 被拒（`cannot insert into a terminal generation`）、candidate 零行、chat.failed=1。

### 5. 验收标准 1-8 — 全部 PASS（逐条核对）

### 6. 邻接风险 — PASS
V6 幂等接收/V10 list_messages/Java MessageRepository 均显式列操作，新增可空列兼容；TRUNCATE CASCADE 与新复合 FK 无冲突（01-43 全 PASS 为证据）；V10 cancel_generation 已持锁（finalize/cancel 交错在 finalize 侧修复成立）。

## Non-blocking 观察

- 测试 44 的 loser 错误断言依赖行锁语义（winner 提交后 loser 才获锁），确定性成立。
- 验收 8 中 Precheck/Evidence/Handoff/remote 部分依赖终态 pre-closure 流程补全，非冻结候选可验证范围；按执行方前提声明接受，无冲突证据。

**结论：候选可进入终态流程。**
