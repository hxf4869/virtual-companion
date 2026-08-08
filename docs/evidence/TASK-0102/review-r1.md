# TASK-0102 R1 独立复核报告

- Reviewer: independent subagent（无实现上下文，只读复核）
- Reviewed commit: `70ddf96`（候选实现）
- Base: `9ae55774533bc455d1ab911dc01ee7a215d510b5`
- Verdict: **PASS**（无 P0/P1/P2 阻塞；4×P3 可选建议 + 1 说明）

## 逐项核对

1. **Diff Scope — PASS**：diff 15 个文件全部落在 writeAllowlist；零越界、零 forbiddenPaths 命中；AuthDataSourceConfig.java 未改动（@Value 字段注入规避）；jwt/tenant/baseline 包、specs/catalog、frontend、pom 未触碰；git diff --check 干净。
2. **卡片状态机 — PASS**：state=IN_PROGRESS、baseCommit=9ae5577、authorizationCommit=90c93b8 可解析；链完整（95a7f52 DRAFT → 90c93b8 READY → ce1b0aa bind → aa1e952 IN_PROGRESS → 70ddf96 候选）；humanApprovals 覆盖 task-assignment + contract-change；contextFingerprint 独立重算 MATCH（229678870d…fc89f）。
3. **P1-08 — PASS**：`requestMatchers(HttpMethod.GET, "/api/internal/baseline").permitAll()` 精确限定 GET；集成测试匿名 200 + 其他端点匿名 401。
4. **P1-09 后端侧 — PASS**：AuthResponse 移除 refreshToken；login/refresh 返回 IssuedSession（明文 token 仅经 controller 写 cookie）；vc_refresh（HttpOnly+SameSite=Lax+Secure 默认 true+Path=/api/v1/auth+Max-Age=TTL）+ vc_csrf（非 HttpOnly）；refresh 从 cookie 读取（缺失 → 401）；V14 rotate 服务层语义不变；测试逐项断言响应体无 refreshToken。
5. **CSRF/Origin — PASS**：CookieCsrfGuardFilter 方法过滤/Origin allowlist/double-submit 常量时间比较/Bearer-only 无 cookie 不强制/403 CSRF_REJECTED；注册顺序正确；集成测试覆盖全路径。
6. **风险 3 — PASS**：production profile 无默认值占位符；缺 env 启动失败（cause chain 含占位符名）、显式 env 启动成功（runtime 无 Flyway + Hikari 惰性连接，无需活库）。
7. **契约 — PASS**：h5CredentialBoundary 与实现逐项一致；deferredOwnerDecisions 移除 cookie 决策合理；resolvedOwnerDecisions 两条记录完整；catalog 真源未改。
8. **范围克制 — PASS**：未触碰 P2-03/04/13、P3-05/06、P1-04/05、前端；无删测/skip/吞退出码。
9. **验收覆盖 — PASS**：验收 1-3 实现+测试齐全；4/5/6 逻辑成立（执行证据由实现者提供）。

## Findings（均 P3，全部采纳进 fix batch 9f214e9）

- **F1**：CORS allowedHeaders 未含 X-CSRF-Token（同源部署不受影响，跨源预检会拦截）→ 已补。
- **F2**：production 测试仅断言 VC_AUTH_ENABLED（条件求值顺序变化可能误失败）→ 改 containsAnyOf 两个占位符。
- **F3**：CookieCsrfGuardFilter 自身 Origin 分支未被独立测试（CORS filter 先行拦截）→ 新增 2 个直接单测（未知 Origin 403 / 允许 Origin+CSRF 200）。
- **F4**：cookie 断言缺 Path/Secure/MaxAge → 已补。
- **F5（说明）**：Bearer-only 无 cookie 的 logout 现 401（cookie-only 交付预期语义）→ Handoff 向 TASK-0103 提示前端必须保持会话 cookie。
