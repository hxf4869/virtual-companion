# TASK-0104 R1 独立复核报告

- Reviewer: independent subagent（无实现上下文，只读复核）
- Reviewed commit: `599f8354fe2ba72cb1dea164f8629ea46d7c8faf`（候选实现）
- Base: `c9c3ccce88a16528c9a8af28d49c92869d5c0f6f`
- Verdict: **FAIL → fix batch → R2 closure PASS**（R1 发现 1×P2 阻塞 + 3×P3；全部采纳进 fix batch）

## 逐项核对（R1 原判）

1. **Diff Scope — PASS**：diff 12 文件全部落在 writeAllowlist；forbiddenPaths 零命中；git diff --check 干净。
2. **卡片状态机 — PASS**：state=IN_PROGRESS；baseCommit/authorizationCommit 可解析；链完整；humanApprovals 非空；contextFingerprint 独立重算 MATCH（516e0107…）。
3. **P1-07 — PASS**：SnapshotResult typed；safeSnapshot 失败→null→exhausted；gap/GAP_EXPIRED/TERMINAL_SNAPSHOT 三路径仅在 state.terminal 时完成；applyTerminalSnapshot 拒绝无 chat.completed 快照；spec 四路径断言。
4. **P2-14 — PASS**：StreamHandle{abort,signal}；signal 传入 resume/fetchSnapshot；catch 中 isCancel→cancelled；store cancel/reset/新 run abort；chat.vue fetch 传 signal。
5. **P2-15 — FAIL（P2 阻塞）**：parser 本身正确（LF/CRLF/尾帧/typed 错误），但 chat.vue 新事件提取只处理单事件帧——信封帧 {"disposition":...,"events":[...]}（TERMINAL_SNAPSHOT 契约形状）事件被静默丢弃（parseEvent 对 NaN eventSeq 返回 null），且 sse-parser.spec 自己断言信封帧合法——内部不一致。属本卡要消灭的"静默事件丢失"同类。
6. **P2-17 — PASS**：runSequence 单写者；reset 递增序号；新 run 先 cancel 旧 handle；双 run 交错用例。
7. **INV-RT-001 — PASS**：reducer 仅 applyTerminalSnapshot 增防御；spec 只增不减；无 skip/only。
8. **验收覆盖**：AC1-AC5 满足（P2 影响生产路径）；AC6 实测三绿。

## Findings（全部采纳进 fix batch 60e578f）

- **P2（阻塞）**：chat.vue 事件提取丢失信封帧支持 → 恢复 `Array.isArray(payload.events) ? payload.events : [frame.data]`。
- **P3-1**：无 data 行注释/keepalive 帧（`: ping`）抛 SseParseError 会使真实 SSE 代理失败 → 改为跳过（合法注释帧）。
- **P3-2**：abort 用例被 isCancel 短路（resume 从未调用）→ 改为断言 streamGeneration 把 handle.signal 传给 deps.resume。
- **P3-3（说明）**：snapshot 401/403/404 → exhausted 与 resume 的 NOT_FOUND 映射不一致（均不披露存在性，可接受，不采纳）。
