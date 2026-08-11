# TASK-0160 R1 Independent Review

## Verdict: PASS

**Reviewed commit:** 7c0e833b1b59552e96cbb9fb854626239533231f
**Candidate tree:** 30686382c2d4b6a9133339d09b4cf68ff4f81f79
**Date:** 2026-08-12

## Review scope

- COMPLETE_MATRIX：候选 diff（Base 662945a → 7c0e833）逐行审查 + 全部前置 TASK-0156 实现在 Base 中的完整性
- ACCEPTANCE：验收标准逐条核对
- INVARIANTS：harness 不变量合规
- ADJACENT_RISK：auth 限流链路回归风险

## Findings

### 0 P0 / 0 P1 / 0 P2

实现变更极小且正确：

1. **AuthSourceAdmissionFilterTest.java**：2 处 `for (int i = 0; i < 20; i++)` → `i < 10`。
   - `forwardedHeadersCannotSplitTheServletSourceWindow` L33：10 次迭代消耗 login source window（LIMIT=10），
     第 11 次收到 429 ✓。
   - `loginAndRefreshSourceScopesAreIndependent` L178：10 次 login 不影响 refresh scope ✓。
   - 注：AuthAbuseGuard.LOGIN_SOURCE_LIMIT 为 package-private（auth.application），
     AuthSourceAdmissionFilterTest 在 auth.config 不同包，跨包不可达，故硬编码 10。
     AuthAbuseGuardTest（同包）仍用常量引用，二者策略正确。

### P3（非阻塞）

无。

## Independent verification

- **根级 Maven verify**（docker maven:3.9-eclipse-temurin-25-alpine + vc-maven-cache）：
  BUILD SUCCESS，Total time 20.820s。全部模块 SUCCESS（含 Virtual Companion :: Apps :: Runtime
  227 tests，0 failures）。AuthSourceAdmissionFilterTest 2 个先前失败的测试现 PASS。
- **canonical precheck 8/8 PASS**：doctor(746393)、catalogValidate、catalogDrift、
  paidFeatureCheck、licenseCheck(71 deps/15 poms)、betaRosterGate、openapiValidate、openapiDrift。
- **git diff --check**：exit 0（输出空）。
- **context fingerprint**：332463bf... 与 context-lock.yaml 逐路径 sha256 一致。

## 前置实现完整性（TASK-0156 已落地，在 Base 中验证）

Base 662945a tree 已含 TASK-0156 实现（48f5e00）：
- AuthAbuseGuard LOGIN_SOURCE_LIMIT = 10 ✓
- AuthRequests @Size(max=64) username, @Size(max=128) password（两个 record）✓
- AuthInputLimits MAX_USERNAME_UTF8_BYTES=64, MAX_PASSWORD_UTF8_BYTES=128, MAX_REQUEST_BODY_BYTES=65536 ✓
- AuthAbuseGuardTest concurrentAdmissionsNeverExceedTheFrozenSourceBudget budget 自适应 ✓
- AuthControllerValidationTest 边界值 65/129 + stale 16385→动态 ✓

## replacement 合规

- Base = TASK-0156 REJECTED terminal（662945a），已 push、0/0、clean。
- 本卡不重复 TASK-0156 实现（writeAllowlist 仅 AuthSourceAdmissionFilterTest.java + 治理制品）。
- writeAllowlist/forbiddenPaths 零冲突（auth/config/AuthSourceAdmissionFilterTest.java 在 writeAllowlist，
  不在 forbiddenPaths；其余 auth/config 文件逐个列出在 forbiddenPaths）。
- Owner 授权链完整（2026-08-11 长线授权 + provenance hash cc0f91c1...）。

## Recommendation

ACCEPTED。P2-03 auth 限流收紧 + 锁定收紧完整落地。
