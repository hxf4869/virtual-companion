# TASK-0169：P2-03 密码最低策略与复杂度（min 8 + 大写/小写/数字/符号全要）

```yaml
taskId: TASK-0169
state: READY
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: fe1341253bec6b42c8053d1924ed40634c6221c3
authorizationCommit: ""
contextFingerprint: 2c16e275cc90479fc611d86c62f2492a4180b8b7ca0532e44d3b5bd1445083f5
contextLock: docs/tasks/context/TASK-0169.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  schemaVersion: 2
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
  r3Forbidden: true
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOrReanchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C3
  surfaceId: TASK_0169_P2_03_PASSWORD_MINIMUM_POLICY_COMPLEXITY
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 30
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0169
  - JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am test
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0168/evidence-pack.json
  - docs/evidence/TASK-0168/review-r1.md
  - docs/handoffs/TASK-0168.json
  - docs/tasks/TASK-0168-owner-injection-filter-trusted-principal-binding.md
  - docs/tasks/context/TASK-0168.context-lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthErrorException.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunner.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
writeAllowlist:
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthRequests.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - docs/tasks/TASK-0169-p2-03-password-minimum-policy-and-complexity.md
  - docs/tasks/context/TASK-0169.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0169/**
  - docs/handoffs/TASK-0169.json
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-014[0-9]-*
  - docs/tasks/TASK-015[0-9]-*
  - docs/tasks/TASK-016[0-8]-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-014[0-9].context-lock.yaml
  - docs/tasks/context/TASK-015[0-9].context-lock.yaml
  - docs/tasks/context/TASK-016[0-8].context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-014[0-9]/**
  - docs/evidence/TASK-015[0-9]/**
  - docs/evidence/TASK-016[0-8]/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-014[0-9].json
  - docs/handoffs/TASK-015[0-9].json
  - docs/handoffs/TASK-016[0-8].json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-inventory.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - scripts/harness/**
  - .github/workflows/**
  - specs/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/platform/**
  - service/**/pom.xml
  - service/platform/persistence/src/main/resources/db/migration/V[1-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V1[0-9]__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V20__*.sql
  - service/platform/persistence/src/main/resources/db/migration/V21__*.sql
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/baseline/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/modelproviders/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - infra/db/run-rls-tests.sh
  - infra/db/tests/0[1-9]_*.sql
  - infra/db/tests/[1-3][0-9]_*.sql
  - infra/db/tests/4[0-9]_*.sql
  - infra/db/tests/5[0-9]_*.sql
  - infra/db/tests/6[01]_*.sql
  - frontend/**
  - .mvn/**
  - pom.xml
  - mvnw
  - mvnw.cmd
sourcesOfTruth:
  - AGENTS.md
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/task-backlog.yaml
  - .harness/task-lifecycle.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/sources-of-truth.yaml
  - .harness/invariants.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/commands.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/contracts/authorization-contract.yaml
  - specs/contracts/database-ownership-contract.yaml
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0168.json
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 长线授权继续审计修复（一次一张新卡）。本卡 TASK-0169 = P2-03 密码最低策略子项
      （§4.3 列「密码最低策略」为 Owner 决策，明令「不要由实现者私定安全数值」）。Owner 2026-08-12 实测
      授权精确安全数值：最小长度 8 + 复杂度要求（大写字母、小写字母、数字、符号四类全部要有）。符号定义
      = 任何非字母非数字字符（含标点/特殊字符；标准 password-policy 语义）。策略在账号创建路径强制
      （createAccount validateAccountInput + seedAdmin），login 路径只认证不强制（不破坏既有弱密码账号登录
      与既有 login 测试）。CreateAccountRequest.password 加 @Size(min=8) Bean Validation 早拒。
      审计保留（180 天）拆为独立 C4 DB 卡 TASK-0170（V22 purge 函数 + @Scheduled），不在本卡。auth 变更
      不在 protected-paths requiredSkill 列表（service/apps/runtime/** 非保护路径）→ Owner 标 C3 auth
      风险等级（独立 Reviewer 必须）。含 Java 变更跑 runtime 模块定向测试。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P2-03 审计修复续卡
> （密码最低策略子项，§4.3 列为 Owner 决策）：在账号创建路径强制密码最低策略与复杂度。auth 路径不在
> protected-paths.yaml 的 requiredSkill 列表（无 db-migration/safety/memory/modelruntime/.harness/**
> 触碰），Owner 基于安全敏感性标为 C3。

## 背景与用户可观察目标

P2-03（来自 TASK-0109 审计 §4.3）要求收紧 auth 安全数值。P2-03 核心限流/锁定/输入收紧已由
TASK-0156（实现 `48f5e00`，已 merge）+ TASK-0160（修 AuthSourceAdmissionFilterTest，ACCEPTED
`4f7ac71`）闭环，阈值经 Owner 在 TASK-0156 humanApproval 明确授权（login source 20→10/分/IP、
@Size username 128→64/password 1024→128、字节限制同步）。

当前缺漏（本卡目标）：`AuthService` 只校验密码上限（`MAX_PASSWORD_LENGTH=1024` 字符 +
`MAX_PASSWORD_UTF8_BYTES=128` 字节），**无最低长度、无复杂度要求**——空密码/弱密码（如 `"pw"`、
`"secret"`、`"aaaaaaaa"`）可在 createAccount 与 seedAdmin 通过。§4.3 明列「密码最低策略」为 Owner
决策项，且「不要由实现者私定安全数值」。

用户可观察结果（本卡完成后）：
- **createAccount**：ADMIN 创建账号时，密码必须 ≥8 字符 且 同时包含大写字母、小写字母、数字、符号
  四类，否则 400 `INVALID_REQUEST`（非泄露固定消息，与既有输入校验一致）。
- **seedAdmin**：平台 bootstrap ADMIN 同样强制密码策略；弱密码 seed 在启动时 fail-closed。
- **login**：不强制密码策略（login 只认证既有账号，不校验密码强度）——既有账号登录与既有 login
  测试不受影响。
- **Bean Validation 早拒**：`CreateAccountRequest.password` 加 `@Size(min=8)`，<8 字节的请求体在
  进入 AuthService 前即被 400 拒绝。

Owner 2026-08-12 授权的精确数值：最小长度 **8**；复杂度 = **大写 + 小写 + 数字 + 符号 四类全部要有**；
符号定义 = 任何非字母非数字字符。

## 范围内

1. `AuthService.java`：
   - 新增常量 `MIN_PASSWORD_LENGTH = 8`。
   - 新增私有静态方法 `validatePasswordPolicy(String password)`：`password.length() < 8` 或未同时
     包含 [A-Za-z] 之大写、小写、[0-9] 之数字、与非字母数字之符号 → `throw invalidRequestError()`
     （复用既有非泄露 400 `INVALID_REQUEST`，与全部输入校验一致；不区分缺失哪一类，不泄露策略细节）。
   - `validateAccountInput`（createAccount 路径）：既有 null/blank/byte/max 校验通过后调用
     `validatePasswordPolicy(password)`。
   - `seedAdmin`：既有 absent-return-0（username/password/displayName 任一 blank → return 0）与
     byte/max 校验通过后、`validateNormalizedInput` 之前调用 `validatePasswordPolicy(password)`。
2. `AuthRequests.java`：`CreateAccountRequest.password` 的 `@Size(max = 128)` 改为
   `@Size(min = 8, max = 128)`（Bean Validation 层 <8 早拒）；`LoginRequest.password` 保持
   `@Size(max = 128)` 不变（login 不强制策略）。
3. `AuthServiceTest.java`：
   - 既有正向 createAccount/seedAdmin 用例的弱密码更新为强密码 `Str0ng!Pw`（S 大写、tr0ng 含小写+数字、
     ! 符号、Pw 含大小写；长度 9；满足全部四类）：`adminCreatesAccountWithBcryptHash...`（`s3cret`→
     `Str0ng!Pw`，同步 `verify(passwordEncoder).encode(...)`）、`adminCreatesAdminAccountWhenRoleExplicit`
     （`pw`→`Str0ng!Pw`）、`duplicateUsernameMapsToGeneric...`（`pw`→`Str0ng!Pw`，使其越过策略到达
     duplicate 路径）、`invalidRoleFailsClosed`（`pw`→`Str0ng!Pw`，使其仅因 role 失败）、
     `seedAdminHashesPasswordBeforePersisting`（`secret`→`Str0ng!Pw`，同步 verify encode）。
   - 新增策略矩阵测试（createAccount + seedAdmin 各一组）：太短（7 字符 `Str0ng!`）→ 400；缺大写
     （`str0ng!pw`）→ 400；缺小写（`STR0NG!PW`）→ 400；缺数字（`Strong!pw`）→ 400；缺符号
     （`Str0ngPw`）→ 400；合法强密码（`Str0ng!Pw`）→ 通过。全部断言 `INVALID_REQUEST`/400 且
     `verify(accounts, never()).createAccount(...)` / `verify(accounts, never()).seedAdmin(...)`。
4. `AuthControllerValidationTest.java`：新增 `createAccountWithShortPasswordRejectedByBeanValidation`
   （`@Size(min=8)` 7 字符密码 → 400 `INVALID_REQUEST` + `verifyNoInteractions(authService)`）；
   既有 invalidAccountBodies 负测（用 `"pw"` 期望 400）仍通过（`@Size(min=8)` 使 `"pw"` 亦 400，
   断言不变）。
5. 终态治理闭环：canonical precheck + runtime 模块定向测试 + git diff --check + 独立 R1 + Evidence/
   Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不改 `validateLoginInput`/login 路径（login 只认证，不校验密码强度）；不改 `AuthControllerAbuseControlTest`
  （全为 login/refresh 限流测试，不触密码策略）。
- 不改 `AuthInputLimits`（字节上限由 TASK-0156 收紧，本卡只加字符级最低策略，不动字节上限）。
- 不改 `AuthService` 的 `MAX_PASSWORD_LENGTH`/`MAX_USERNAME_LENGTH`（TASK-0156 已定，本卡不动上限）。
- 不新增 migration、不触碰 V1..V21；审计保留（180 天）拆为独立 C4 DB 卡 TASK-0170（V22 purge 函数 +
  @Scheduled），不在本卡。
- 不触碰 .harness/** 治理文件（除 project-state/task-ledger 终态更新）、specs、infra/db、skills、
  scripts/harness、ci、frontend。
- 不改 `AdminSeedRunner`（它只透传 `authService.seedAdmin`，策略在 `AuthService.seedAdmin` 内强制）。
- 不引入新依赖（不加 Passay 等 password-policy 库；复杂度判定用 JDK `Character` 内联，零新依赖）。

## 输入和前置条件

- Base `fe1341253bec6b42c8053d1924ed40634c6221c3` = TASK-0168 ACCEPTED terminal（已 push、
  HEAD==origin/main、0/0、clean；nextAction 三处 sha256 `ee7c21ab…` 一致）。
- DRAFT 前已跑 `mvn -pl service/apps/runtime -am test`：BUILD SUCCESS 234/0（与 TASK-0168 一致，
  无 pre-existing 失败）——确认 writeAllowlist 4 文件无 stale 测试阻塞（TASK-0168 教训：DRAFT 前
  先跑受影响模块定向测试）。
- 本卡 context lock 输入钉在 Base；provenance 条目 `owner-authorization://longline-2026-08-09`
  provenanceOnly（沿用 hash `cc0f91c1…`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`；JDK 25 在
  `/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`。
- 关键事实：`createAccount` 先校验 principal role（非 ADMIN → 403 ACCESS_DENIED），再 `validateAccountInput`
  → 策略只对 ADMIN 创建路径生效；`seedAdmin` 的 absent-return-0 早于策略，blank 密码仍 return 0（不抛）。

## API / 事件 / 数据契约

- 产品 API 不变。错误契约不变：弱密码创建 → 既有 400 `INVALID_REQUEST`（固定非敏感消息
  "The request is invalid"），与既有 null/blank/超长字段失败完全一致；不新增错误码、不泄露缺失哪一类。
- `/api/v1/auth/login` 行为不变（不校验密码策略）。
- 不新增事件、不新增表/函数/角色、不改 OpenAPI（无新端点/错误码）。

## 权限、RLS 和数据处理要求

- 无 DB 变更、无 RLS/policy/GRANT 变更（V1..V21 frozen）。
- 密码明文从不落盘、不入日志、不入响应；本卡只加内存中字符类别判定，不改变密码处理路径
  （仍 `passwordEncoder.encode(password)` 后存 BCrypt hash）。
- 策略判定不区分缺失哪一类（统一 `INVALID_REQUEST`），不形成用户枚举侧信道。

## 状态机和失败行为

- createAccount/seedAdmin 弱密码 → 400 `INVALID_REQUEST`，不调用 `accounts.createAccount`/
  `seedAdmin`（测试 `verify(never())` 实证）。
- seedAdmin absent（username/password/displayName blank）→ return 0（既有行为不变，策略不触发）。
- 合法强密码 → 正常 hash + 持久化（既有行为不变）。
- 正式门禁非 PASS → 停止 promotion，如实 REJECTED；硬熔断 90min 到达 → closure-only overrun。

## 验收标准

1. `AuthService.validatePasswordPolicy`：length<8 或缺四类任一 → `invalidRequestError()`（400
   `INVALID_REQUEST`）；四类齐全且 ≥8 → 通过。
2. `validateAccountInput` 与 `seedAdmin` 在既有校验后调用 `validatePasswordPolicy`；seedAdmin 的
   absent-return-0 早于策略（blank 密码仍 return 0）。
3. `CreateAccountRequest.password` 为 `@Size(min = 8, max = 128)`；`LoginRequest.password` 保持
   `@Size(max = 128)` 不变。
4. `AuthServiceTest` 策略矩阵全 PASS（createAccount + seedAdmin 各 6 场景：太短/缺大写/缺小写/缺数字/
   缺符号/合法）；既有正向用例弱密码已更新为 `Str0ng!Pw` 且 `verify encode` 同步。
5. `AuthControllerValidationTest` 新增 `@Size(min=8)` Bean Validation 测试 PASS；既有 invalidAccountBodies
   负测仍 PASS。
6. `mvn -pl service/apps/runtime -am test` BUILD SUCCESS（测试数 ≥234，0 失败，0 skip）。
7. 唯一 canonical precheck `python scripts/harness/precheck.py --task TASK-0169` 8/8 PASS；唯一
   `git diff --check` exit 0（输出空）。
8. R1 独立复核 PASS（C3 auth 必须；0 P0/P1/P2）。
9. 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（canonical precheck 只跑一次；runtime 模块定向测试一次；
同一条无参数 `git diff --check` 只执行一次）。完整 Harness unittest 与根级 Maven verify 按 Owner
2026-08-12 static-gates-only 策略 deferred to 统一全项目复审。

## 回滚或前向修复

- 若策略矩阵测试暴露既有用例遗漏的弱密码依赖：扩 `writeAllowlist` 不可能（READY 冻结），按
  TASK-0168 教训 DRAFT 前已跑 mvn 定向测试确认无 pre-existing 阻塞；若 IN_PROGRESS 后仍发现，最多
  1 个 fix batch 修测试数据（不删测、不加 skip）。
- 若 R1 发现阻塞项：最多 1 个 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须新增 migration 或触碰 protected path：立即停止，向 Owner 申请范围升级（自批禁止）。

## 停止条件

- writeAllowlist 外路径被修改（含改后恢复）；forbiddenPaths 被触碰（含 V1..V21、.harness/**、
  scripts/harness/** 等）。
- 正式 Precheck / runtime 定向测试 / diff check / pre-closure 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 Evidence/Handoff/
  pre-closure/终态提交/push/远端 0/0 的 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0169/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0169.json`。
