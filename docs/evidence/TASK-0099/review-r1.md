# TASK-0099 R1 独立复核（独立 Reviewer，只读）

- 复核对象：候选提交 `c7ece0e28d0d48d4ef6b56ae48d9183e17313c3a`（tree `140f3ba0205a7e9d8bf926a84dc91ec551138422`），Base `60c00e1f5142ac7e6666cbeb91c7834c511ac1d9`
- 复核范围：COMPLETE_MATRIX（Diff Scope、V14 行锁/条件 UPDATE、服务层同一明文 token、48 并发测试、服务层测试、验收对照、禁止事项）
- 结论：**PASS**（无 P0/P1/P2 blocking finding）
- 复核命令：`Independent Reviewer R1 for TASK-0099 frozen candidate`（read-only subagent，fork_turns=none，未修改任何文件）

## 逐项结论

### 1. Diff Scope — PASS
`git diff 60c00e1..c7ece0e` 与 `..HEAD` 一致，共 7 个文件（卡+context-lock、project-state、V14、AuthService.java、AuthServiceTest.java、48 测试），全部落在任务卡 writeAllowlist；未触碰任何 forbiddenPaths（run-rls-tests.sh、specs、其他迁移、`.harness` 除 project-state 生命周期字段均未改）。`git diff --check` 退出码 0。

### 2. V14 rotate 修复 — PASS
- V14:229-237 `SELECT t.account_id ... FOR UPDATE OF t`：token 行锁（仅锁 `identity_refresh_token` 行，join 账户行不锁）。
- 锁内复查 `revoked_at IS NULL AND expires_at > now()` 且 `a.status = 'ACTIVE'`（同一 WHERE）。
- V14:243-252 条件 UPDATE `WHERE token_hash = p_old_token_hash AND revoked_at IS NULL AND expires_at > now()`，`IF NOT FOUND THEN RETURN` 失败关闭；仅获胜者到达 INSERT。
- 函数签名 `(text, text, timestamptz) → TABLE(out_account_id, out_role, out_status, out_username)`、GRANT/REVOKE 均未变。

### 3. AuthService.refresh 修复 — PASS
- `AuthService.java:115-119` 生成 `newRefreshToken` 并以其 sha256Hex 传给 `sessions.rotate()`；返回的 `AuthResponse.refreshToken` 正是同一 `newRefreshToken`。
- refresh 路径不再调用 `issueTokens()`/`sessions.issue()`（`issueTokens` 仅剩 `login()` 使用，首会话语义不变）。
- access token 仍由 `jwt.issueAccessToken` 签发；失败路径（rotate empty / 非 ACTIVE）抛 `AUTHENTICATION_REQUIRED`、零落库。

### 4. DB 并发测试 48 — PASS
- dblink 双会话 + `SET ROLE vc_api`（35-36 行）；token issue 在独立 autocommit DO 块（28-37 行），主会话等待 dblink 结果前不持任何 identity 锁。
- 断言全覆盖：cnt_a+cnt_b=1（恰好一个获胜）、旧 token 恰好 revoke 一次、恰好 1 个 live successor 且 hash 等于获胜者新 hash、败者 hash 零落库、账户总行数=2（无隐藏 session）。

### 5. 服务层测试 — PASS
- `AuthServiceTest.java:127-135`：ArgumentCaptor 捕获 rotate 新 hash，断言等于 `sha256Hex(response.refreshToken())`；`verify(sessions, never()).issue(...)`。
- 失败路径 `refreshNeverIssuesWhenRotationFails`：rotate empty → `AUTHENTICATION_REQUIRED`，issue 从未调用。

### 6. 验收对照 — 1-7 均可满足
验收 1/2/3/4 由上述断言直接覆盖；验收 5（01-47 无回归 + 48 新增自动拾取）、验收 6（AuthServiceTest 15 项全部保留）、验收 7（Diff 仅 writeAllowlist；precheck/DB/Maven/闭包为独立验证步骤）均满足。

### 7. 禁止事项 — PASS
无测试删除（base 15 项 = 候选 15 项）、无 skip/Disabled/assume、无 shell/CI 变更吞退出码、无环境注入、无手改生成物。

## 发现清单

- P0 阻塞：无
- P1 阻塞：无
- P2 非阻塞：无
- P3 建议（非阻塞，closure 时在 Handoff 校准措辞）：
  1. 任务卡验收 6 的"既有 14 项 + 新增用例"表述与实测不符：base 与候选均为 15 项 `@Test`（`refreshRotatesSessionAndReissuesTokens` 增强 + `invalidOrRevokedOrExpiredRefreshFailsClosed` 改名 `refreshNeverIssuesWhenRotationFails`，无净新增方法）——Handoff 中校准为"15 项既有用例（refresh 成功用例增强哈希相等断言，失败用例改名并强化 issue 永不调用断言）"。
  2. 改名后的失败路径测试语义（invalid/revoked/expired 全类别由 `Optional.empty()` 统一覆盖）未在测试名中体现——Handoff 注明覆盖范围。

结论：候选提交符合任务卡全部要求，无阻塞发现，可进入 canonical/DB/Maven 验证与闭包流程。
