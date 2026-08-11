# TASK-0157 R1 Independent Review

## Verdict: FAIL (TIMEOUT — hardFuse exceeded, acceptance criterion #5 not independently confirmed)

**Reviewed commit:** 872311a67705784d180847550639b3ae3f52b418
**Candidate tree:** c70bd0f032feb9516c398566597edae0a6379b13
**Date:** 2026-08-12
**Reviewer kind:** independent-review-gate (fork_turns=none, dispatched subagent)

## Review scope

- COMPLETE_MATRIX：候选 diff（Base 4f7ac71 → 872311a）逐行审查
- ACCEPTANCE：任务卡 §验收标准 10 条逐项核对
- INVARIANTS：INV-HARNESS-001/002/003/004/005/007/009 合规
- ADJACENT_RISK：harness portability / CI workflow / doctor validator 完整性回归风险

## Findings

### 0 P0 / 0 P1 / 0 P2（静态层面）

候选 diff 静态层面无缺陷，4 个实现文件改动均符合任务卡 §范围内：

1. **`.harness/ci-execution-policy.yaml`** BACKEND_LOCAL：
   - `windowsJavaHome: G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7` 已移除（消除 INV-HARNESS-004
     跨平台可移植性违规的本机硬编码路径）✓
   - 新增 `javaToolchain: {distribution: temurin, versionLine: "25-LTS", resolver: ACTIONS_SETUP_JAVA}`，
     与 `tools.lock.yaml runtime.java.versionLine: 25-LTS` 对齐 ✓
   - 其它 BACKEND_LOCAL/FRONTEND_LOCAL/FULL_STACK_LOCAL/TERMINAL_METADATA_ONLY/
     HARNESS_PORTABILITY_LOCAL profile 字段全部不变 ✓

2. **`scripts/harness/doctor.py`**：
   - L175 `CI_EXECUTION_POLICY_CANONICAL_HASH` 同步更新（`e04d3c6d...` → `f8f2ea20...`），
     独立重算 `canonical_json_sha256(ci_execution_policy_projection(policy))` 验证一致 ✓
   - L13091-13120 段断言改造：移除 `windowsJavaHome == "G:/ai/hxf/..."` 冻结；
     新增 `"windowsJavaHome" not in backend`（防止字段复活）+
     `backend.get("javaToolchain") == {distribution: temurin, versionLine: "25-LTS",
     resolver: ACTIONS_SETUP_JAVA}` 强类型校验 ✓
   - 其它 BACKEND_LOCAL/FRONTEND_LOCAL/FULL_STACK_LOCAL 断言（argvTemplate/harnessGates/
     nodeVersion=22/pnpmVersion=11.9.0/composeProfiles）保留不变 ✓

3. **`scripts/harness/tests/test_harness.py`** `CiExecutionPolicyTests` 类（L2561）：
   新增 `test_policy_rejects_backend_and_frontend_local_profile_drift` 方法，包含 7 个 subTest
   变体（任务卡要求 5 个，实际超额）：
   - `windowsJavaHome_returned`（字段复活）→ 失败 ✓
   - `missing_javaToolchain`（缺失）→ 失败 ✓
   - `javaToolchain_versionLine_drift`（"21-LTS" 漂移）→ 失败 ✓
   - `javaToolchain_resolver_unsupported`（"LOCAL_PATH" 非受支持）→ 失败 ✓
   - `javaToolchain_distribution_drift`（"oracle" 漂移）→ 失败 ✓
   - `frontend_pnpmVersion_drift`（"10.0.0" 漂移）→ 失败 ✓
   - `frontend_nodeVersion_drift`（"20" 漂移）→ 失败 ✓
   每个 variant 通过 `audit.require` 链路均会触发 `audit.errors`（独立审查 doctor.py:13091-13120
   断言逻辑确认）✓

4. **`.github/workflows/ci.yml`**：
   - `backend` job：`strategy.matrix.include` 三平台（ubuntu-latest/windows-latest/macos-latest
     各 30 timeoutMinutes），`runs-on: ${{ matrix.os }}`，`defaults.run.shell: bash`，
     保留 `actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 distribution: temurin
     java-version: "25" cache: maven` ✓
   - `frontend` job：同 matrix 三平台（ubuntu/macos 20 min，windows 25 min），
     `defaults.run.shell: bash`，保留 pnpm/action-setup@SHA + setup-node@SHA ✓
   - `database` job：`name: Database (PostgreSQL 18 + pgvector) - Linux-only reference platform`，
     `runs-on: ubuntu-latest` 保持 ✓
   - `harness-full`/`harness-smoke`/`supply-chain`：未改动 ✓

### 阻塞（acceptance criterion #5 未独立确认）

**完整 Harness unittest 未独立确认 PASS**。

R1 第一次 unittest 与 implementation agent 并行运行时 hung ~30 分钟（0% CPU、RSS 不变、
STAT S，疑似 git IO 争用或 subprocess pipe 缓冲争用），无任何输出。kill 后串行重跑，
第二次 unittest 仍呈现 stalling 迹象（CPU 0-10%、进程持续但进展缓慢），尚未完成时
POLICY HALT 到达（candidate execution 已超 hardFuse 90min）。

未捕获 "Ran N tests ... OK" 输出 → acceptance criterion #5
（"完整 Harness unittest ... PASS（261+ tests，0 failures，含新增 5 负测）"）
**无法独立确认 PASS**。

按 task-delivery-policy `evidenceResultContract.PASS.terminalResultRequired: true` 与
`candidateIdentity.nonPassResults: [FAIL, CANCELLED, TIMEOUT, NOT_RUN, UNKNOWN]`，
R1 verdict 为 **FAIL / TIMEOUT**（candidate execution 超时 + 关键命令未独立确认）。

注：implementation agent 之前在 worktree dirty 状态（候选未冻结前）跑过一次 unittest：
"Ran 278 tests in 2083.150s ... FAILED (failures=1, skipped=1)"，唯一 failure 是
`IntegrationTests.test_doctor_accepts_current_task` 因 worktree/index 不一致（4 个文件
modified 未 add）导致 doctor 报 4 ERROR；那不是真实代码缺陷。候选 commit 872311a 后该
测试应通过（worktree 已 clean，doctor 无参数已验证 PASS 751912 checks），但**未在候选
commit 上完整独立复跑**。

## Independent verification

- **git diff --check**：exit 0（输出空）✓
- **doctor --task TASK-0157**：PASS（752227 checks，144.4s）✓
- **Diff scope**：7 files（4 实现文件 + 3 治理/metadata：project-state.yaml +
  task-ledger.yaml + 任务卡自身），全部在 writeAllowlist 内，零 forbiddenPaths 冲突 ✓
- **Linear history**：Base 4f7ac71 → 12b0409 (DRAFT) → c302d48 (READY) → c7571f8
  (authorizationCommit) → cc3cf9c (IN_PROGRESS) → 872311a (candidate)，单父链 ✓
- **Canonical hash recompute**：`f8f2ea2088cd6075c599fb406de6b1f9c65b52eb39fd14be9fe8ddb122ccd6fe`，
  与 doctor.py L175 `CI_EXECUTION_POLICY_CANONICAL_HASH` 一致 ✓
- **Complete Harness unittest**：NOT_RUN（两次 hung/killed；无 "Ran N tests ... OK" 输出）✗

## Acceptance criteria audit

| # | criterion | status |
|---|---|---|
| 1 | BACKEND_LOCAL 含 javaToolchain、不含 windowsJavaHome | PASS（静态确认） |
| 2 | doctor.py 移除 windowsJavaHome 冻结、新增 javaToolchain 校验 | PASS（静态确认 + hash recompute） |
| 3 | test_harness.py 新增 5+ subTest 变体 | PASS（7 个变体，静态确认 audit.require 触发） |
| 4 | ci.yml backend/frontend 三平台 matrix、database Linux-only | PASS（静态确认） |
| 5 | 完整 Harness unittest PASS | **NOT_RUN / FAIL（TIMEOUT）** — 阻塞 |
| 6 | 唯一 canonical precheck 8/8 PASS | NOT_RUN（hardFuse 后 policy 禁止 canonical） |
| 7 | 唯一无参数 git diff --check PASS | PASS（R1 独立运行 exit 0） |
| 8 | R1 独立复核 PASS（C4 必须；0 P0/P1/P2） | FAIL（acceptance #5 未达成） |
| 9 | 终态 pre-closure + 单父 [skip ci] + push + 0/0 | PENDING（REJECTED closure 进行中） |
| 10 | INV-HARNESS-004 改善 | PASS（移除本机硬编码路径） |

## Recommendation

**REJECTED**（candidate execution TIMEOUT，acceptance criterion #5 未独立确认）。

候选实现本身静态层面正确（0 P0/P1/P2，全部静态门禁 PASS：doctor/diff/hash/scope/invariants），
但 task-delivery-policy hardFuse 90min 到达时完整 Harness unittest 未独立跑通。
按 policy `hardFuse.stopImmediately: [IMPLEMENTATION, FIXES, REVIEWER, CANDIDATE_CANONICAL, CI]`
+ `mandatoryTerminalClosure` + Owner 2026-08-12 决策"REJECTED + replacement 严格执行 policy"，
本卡做 REJECTED terminal closure，candidateExecution.outcome=TIMEOUT。

Replacement TASK-0161（Owner 授权后创建）以 TASK-0157 REJECTED terminal 为 Base，
候选实现（872311a：4 文件改动）已在 Base 中不重复，仅跑：
- 完整 Harness unittest（独立串行，避免并行争用）
- canonical precheck
- git diff --check
- R1 独立复核
- 终态治理闭环
deliveryBudgets.hardFuseWallMinutes 调高至 180（覆盖完整 unittest 30-45 min × 2 + R1 setup +
canonical + closure 余量）。
