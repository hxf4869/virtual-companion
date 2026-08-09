# TASK-0121 Independent Review R1

```yaml
taskId: TASK-0121
reviewerId: task0121_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: a5722a37a7c74be66262fe6c641f54c5f1a1f5d0
candidateTree: 2e19cb3111213cf18eb0425d2468ea85614900ec
baseCommit: 7188d27df49bcd624f6017c6ff71ad8ebbc3e0ad
candidateParent: 7c271c293b148e50d852584bf8bd905c3127728b
riskClass: C3
verdict: PASS
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Verdict

PASS。候选身份、Context、17 条 Diff Scope、请求体和字段/token 边界、cookie-only 契约、
生成物以及测试矩阵均一致；最终 findings 为 `P0=0，P1=0，P2=0，P3=0`。

## Review Scope

- Auth 请求体 `16384` 字节 exact/one-over、已知 `Content-Length` 与 unknown/chunked。
- 底层最多读取 `limit + 1`、合法请求的 byte-identical replay，以及 filter 顺序/重复注册风险。
- username/password/displayName/role 的 UTF-8 上限与攻击者尺寸输入的分配边界。
- `vc_refresh` 的 `512` 字节上限及 refresh/logout/rotation/idempotence。
- OpenAPI cookie-only refresh/logout、响应不含 refresh token、生成物删除与快照一致性。
- writeAllowlist、forbiddenPaths、单父治理链和迭代测试有效性。

## Key Evidence

- Commit、Tree、Parent、Base 与冻结身份一致，工作树和 Index 干净；71 个 Context 输入及 fingerprint
  `4d149ba1b4cfd75c37e88141157e402bdc0bd9f6ab4efc4d5286395111a73d26` 独立复算匹配。
- 已知超限 `Content-Length` 在读取前固定 400；未知长度最多读取 16385 bytes，合法 body 原字节重放。
- UTF-8 helper 先用字符长度证明明显超限，再做实际 byte count，避免攻击者尺寸的额外大分配。
- raw 与 normalized 值均在 BCrypt、Repository/JDBC、JWT 和响应构造前校验。
- refresh token 在 successor generate、hash、JDBC 与 JWT 前受限，cookie-only、401、rotation 和幂等语义保持。
- OpenAPI 无 refresh/logout request body，响应模型不暴露 refresh token，删除的旧生成物与快照一致。
- 现存迭代 Surefire 报告为 82 tests 全部通过；该结果只用于 Reviewer 取证，不替代正式门禁。
- 同一 `OncePerRequestFilter` 实例的 already-filtered 标记防止容器和 SecurityFilterChain 嵌套时重复读取。

## Gate Decision

允许同一 Commit/Tree 进入正式门禁。Reviewer 未运行或声称 canonical precheck、正式 targeted reactor、
OpenAPI gates、root verify 或无参数 `git diff --check` 为 PASS；这些结果由实施者另行执行和记录。
