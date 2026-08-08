# TASK-0105 R1 独立复核报告

- Reviewer: independent subagent（无实现上下文，只读复核）
- Reviewed commit: `9257065458d15d0ba0c1e66eab8ae3324fa4c4ca`（候选实现）
- Base: `8e11d11f2789c975b6dadad8c06b2493a15323f4`
- Verdict: **PASS**（无 P0/P1；1×P2 残余如实记录 + 2×P3；P3 采纳进 fix batch，P2 记入 Handoff）

## 逐项核对（R1 原判）

1. **Diff Scope — PASS**：diff 10 文件全部落在 writeAllowlist；forbiddenPaths 零命中（transport.ts / auth.ts / stores/auth.ts / package.json / .github/** 均未改动）；git diff --check 干净。
2. **卡片状态机 — PASS**：state=IN_PROGRESS；baseCommit/authorizationCommit 可解析；链完整；humanApprovals 非空；contextFingerprint 独立重算 MATCH（9e54add4…）。
3. **P2-16 — PASS**：`guardJsonResult`/`classifyStatus` 正确——仅 403/404 隐藏为 []/null/false 且不抛错；401→unauthorized、>=500→server、其他 4xx→client、ok+parseFailed→parse；deleteMemory 同样 401/5xx 抛 typed error；spec 全路径断言（503 覆盖 7 端点含 delete；409→client；403 与 404 等价隐藏；parseFailed→parse）。store `failureCode` 对 unauthorized → "session-expired"（spec 断言 load/confirm/reject/update/remove 五路径）；memory.vue transport 复用 `createAuthenticatedTransport`（401 → auth.onUnauthorized 会话处理）。
4. **P3-03 — PASS**：loadEvidence 成功清旧 error；`hasEvidence()` 用 Array.isArray && length>0（pending/canonical 两处）；`update` 返回 Promise<boolean> 且 onSave 仅 true 退出编辑；`listMemories` 用 `encodeURIComponent`（spec 断言 `rel a/b?c#d&e` → `rel%20a%2Fb%3Fc%23d%26e`）。
5. **P3-04 — PASS**：login.vue aria-label×2、错误 role="alert"、submitting aria-busy、失败 `focusUsername()`；memory.vue 错误 role="alert"、两 section aria-live、编辑输入 aria-label、刷新按钮 aria-busy；chat.vue 状态区 role="status"+aria-live、取消按钮 aria-busy。
6. **INV-TENANT-001 — PASS**：仅 403/404 隐藏；抛错文案（status/kind）不含资源存在性信息；页面错误文案为通用措辞。
7. **INV-MEM-002 — PASS**：partition 逻辑零改动——候选与 canonical 严格分离保持。
8. **相邻风险 — PASS**：两个 spec 文件纯新增（既有 12 用例保留且与实现一致）；AuthApiResponse 结构可赋值 MemoryApiResponse（type-check 证明）；POST/PATCH/DELETE 自动注入 X-CSRF-Token（相比旧散拼 header 新增 CSRF 保护）；401 时 onUnauthorized 每响应一次（无 double-redirect）；无删测/skip/吞退出码。
9. **验收覆盖**：AC1-AC8 满足（含 Reviewer 实测 vitest 128/128、type-check exit 0、build exit 0、diff --check 干净）；AC9（ledger/Handoff/remote）归终态闭包步骤。

## Findings

- **P2（残余，非阻塞，记入 Handoff）**：`MemoryApiResponse.parseFailed` 生产路径不可达——生产 transport（transport.ts:72，TASK-0103 闭环物，本卡 forbiddenPaths）用 `response.json().catch(() => null)`，从不置 parseFailed；`ok && parseFailed → parse` 分支仅在 spec 手工构造时触发。服务端契约返回 JSON，风险低；留待允许触碰 transport.ts 的后续工作包统一置位。
- **P3-1（采纳进 fix batch 1cb96bc）**：stores/memory.ts 未使用的 `type MemoryHttpErrorKind` 死导入 → 删除。
- **P3-2（说明）**：task-ledger 的 TASK-0105 条目在终态闭包提交写入（与既有模式一致），不采纳为变更。
