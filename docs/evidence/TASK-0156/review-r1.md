# TASK-0156 R1 Independent Review

## Verdict: FAIL (REJECTED confirmed)

**Reviewed commit:** 48f5e00efaea81c2f6fe846939ead3fe6be17bb3
**Candidate tree:** 0e4f9e7891a57f878f69d3e62198700022e3adfd
**Date:** 2026-08-12

## Review scope

- COMPLETE_MATRIX: 全部 5 文件 diff 审查 + 构建测试验证
- ACCEPTANCE: 验收标准逐条核对
- INVARIANTS: harness 不变量合规
- ADJACENT_RISK: auth 链路回归风险

## Findings

### P0-01: Maven verify FAIL — AuthSourceAdmissionFilterTest 2 个测试失败

根级 Maven verify（Docker JDK 25 + vc-maven-cache，227 tests）发现：

1. `AuthSourceAdmissionFilterTest.forwardedHeadersCannotSplitTheServletSourceWindow:37`
   expected: 200 but was: 429
   — 循环硬编码 `for (int i = 0; i < 20; i++)` 发送 20 次 login source admission。
     LOGIN_SOURCE_LIMIT 从 20 收紧到 10 后，第 11 次请求收到 429。

2. `AuthSourceAdmissionFilterTest.loginAndRefreshSourceScopesAreIndependent:181`
   expected: 200 but was: 429
   — 同样硬编码 20 次迭代。

修复方式：将 2 处硬编码 `20` 改为 `AuthAbuseGuard.LOGIN_SOURCE_LIMIT`（自适应）。

**阻塞原因：** AuthSourceAdmissionFilterTest.java 在 TASK-0156 的 forbiddenPaths
（`service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/**`）中。
READY 冻结后 forbiddenPaths 不可改，amendment 无法授权写入 forbiddenPaths 中的路径。
无法在本卡内修复。

### 无其他 P0/P1/P2

实现变更本身（48f5e00）完全正确：
- AuthAbuseGuard LOGIN_SOURCE_LIMIT 20→10 ✓
- AuthRequests @Size username≤64/password≤128（两个 record）✓
- AuthInputLimits MAX_USERNAME 64B/MAX_PASSWORD 128B/MAX_BODY 64KiB ✓
- AuthAbuseGuardTest budget count 自适应 ✓
- AuthControllerValidationTest 边界值 65/129 + stale 16385→动态 ✓

其余 225 个测试全部 PASS，包括 AuthServiceTest（全量审查无断裂）、
AuthInputLimitsTest（常量自适应）、AuthRequestBodyLimitFilterTest（常量自适应）、
AuthControllerAbuseControlTest（无依赖变更）。

## Independent verification

- 根级 Maven verify（docker maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache）：
  Tests run: 227, Failures: 2, Errors: 0, Skipped: 0 → BUILD FAILURE
- diff --check：未单独运行（Maven verify 已失败，候选不可冻结为 PASS）
- context fingerprint：b889f0ac... 与 context-lock.yaml 一致

## Recommendation

REJECTED。创建 replacement TASK-0160：
- Base = TASK-0156 REJECTED terminal（已含 48f5e00 实现）
- writeAllowlist 增加 AuthSourceAdmissionFilterTest.java
- forbiddenPaths 移除 `auth/config/**` glob（改用 writeAllowlist 精确控制）
- 实现 = AuthSourceAdmissionFilterTest 硬编码 20→AuthAbuseGuard.LOGIN_SOURCE_LIMIT（2 处）
- 不重复 TASK-0156 的 5 文件实现（已在 Base）
