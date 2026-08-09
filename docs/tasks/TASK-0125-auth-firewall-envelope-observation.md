# TASK-0125：Auth Firewall Envelope 与 Observation 保真

```yaml
taskId: TASK-0125
state: REJECTED
owner: repository-owner
riskClass: C3
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 098115264879ed1bd99c79e90db2ddca54061c4b
authorizationCommit: eedf8319306fcc68ff015c8c153406fcae394201
contextFingerprint: 27016920ef0ca8d7c5d1b37e35074f3e8303dc0efd50ebd3406db5673ea4aa14
contextLock: docs/tasks/context/TASK-0125.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C3
  surfaceId: TASK_0125_AUTH_FIREWALL_ENVELOPE_OBSERVATION
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - AGENTS.md
  - CLAUDE.md
  - docs/evidence/TASK-0123/evidence-pack.json
  - docs/evidence/TASK-0123/review-r2.md
  - docs/evidence/TASK-0124/evidence-pack.json
  - docs/evidence/TASK-0124/review-r1.md
  - docs/handoffs/TASK-0123.json
  - docs/handoffs/TASK-0124.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0123-auth-request-target-utf8-boundary.md
  - docs/tasks/TASK-0124-auth-firewall-envelope-observation.md
  - docs/tasks/context/TASK-0124.context-lock.yaml
  - docs/tasks/task-card-template.md
  - pom.xml
  - requirements-harness.txt
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthAbuseGuard.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/AuthService.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthInputLimits.java
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/AuthServiceTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerAbuseControlTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthControllerValidationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/AuthInputLimitsTest.java
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/error-codes.yaml
  - specs/contracts/identity-session-boundary-contract.yaml
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - docs/tasks/TASK-0125-auth-firewall-envelope-observation.md
  - docs/tasks/context/TASK-0125.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0125/**
  - docs/handoffs/TASK-0125.json
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestTarget.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSecurityIntegrationTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilterTest.java
forbiddenPaths:
  - docs/tasks/TASK-0109-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/TASK-0121-*
  - docs/tasks/TASK-0122-*
  - docs/tasks/TASK-0123-*
  - docs/tasks/TASK-0124-*
  - docs/tasks/context/TASK-0109.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - docs/tasks/context/TASK-0123.context-lock.yaml
  - docs/tasks/context/TASK-0124.context-lock.yaml
  - docs/evidence/TASK-0109/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/evidence/TASK-0121/**
  - docs/evidence/TASK-0122/**
  - docs/evidence/TASK-0123/**
  - docs/evidence/TASK-0124/**
  - docs/handoffs/TASK-0109.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - docs/handoffs/TASK-0121.json
  - docs/handoffs/TASK-0122.json
  - docs/handoffs/TASK-0123.json
  - docs/handoffs/TASK-0124.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/**
  - skills/**
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
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
  - specs/**
  - "**/db/migration/**"
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthDataSourceConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSecurityConfig.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/AuthSourceAdmissionFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/config/CookieCsrfGuardFilter.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/application/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthAbuseGuardTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AuthRequestBodyLimitFilterTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/config/AdminSeedRunnerTest.java
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/jwt/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/tenant/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/web/**
  - frontend/**
  - infra/**
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
  - docs/tasks/TASK-0123-auth-request-target-utf8-boundary.md
  - docs/evidence/TASK-0123/evidence-pack.json
  - docs/evidence/TASK-0123/review-r2.md
  - docs/handoffs/TASK-0123.json
  - docs/tasks/TASK-0124-auth-firewall-envelope-observation.md
  - docs/evidence/TASK-0124/evidence-pack.json
  - docs/evidence/TASK-0124/review-r1.md
  - docs/handoffs/TASK-0124.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-AUTH-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求 Codex 使用当前思考深度、不启用 fast，恢复并持续执行既有长线 goal，不为低风险细节暂停。
      TASK-0124 已真实 REJECTED、推送并远端 0/0；其 Handoff 与 project-state 唯一 nextAction 明确要求
      以新永久 ID 创建 TASK-0125，修正 Context Lock 后继续同一目标。
  - scope: auth-firewall-envelope-observation
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      TASK-0124 终态 Handoff 精确授权 TASK-0125 保持其目标、范围、风险、白名单、禁止项和验收不变：补全
      encoded Auth-prefix MVC 等价路径的固定 INVALID_REQUEST envelope，保留 Spring Security 官方
      observation marking 与非 Auth 默认 400，并重新覆盖 TASK-0123 完整矩阵。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner 的 exact-SHA 失败事实保持不变。TASK-0112 至
      TASK-0122 已按同一 fallback 合规闭环；本卡冻结 LOCAL_EXACT_TREE_FALLBACK，远端继续如实非 PASS。
independentReview: required
reviewers:
  - id: task0125_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 24495063231dac2f2b78ac94432de81de511b030
    evidencePath: docs/evidence/TASK-0125/review-r1.md
    reason: 'R1 完整矩阵 PASS：encoded Auth-prefix 在实际 Security chain 返回固定 JSON 400；官方 ObservationMarkingRequestRejectedHandler 在 Auth/非 Auth 分支前标记同一异常；非 Auth 保持默认空 400；P0/P1/P2/P3=0。后续 root verify 的范围外 AuthAbuseGuardTest 失败不改写本 Reviewer 结论。'
    candidateTree: a6ec7cb48b116fd3241e38584963cf040d35ec78
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0125
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress -pl service/apps/runtime -am -Dtest=AuthRequestBodyLimitFilterTest,AuthSourceAdmissionFilterTest,AuthInputLimitsTest,AuthServiceTest,AuthControllerValidationTest,AuthControllerAbuseControlTest,AuthSecurityIntegrationTest -Dsurefire.failIfNoSpecifiedTests=false test
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - git diff --check
```

> 本卡是 TASK-0124 因 Context fingerprint 构造错误而真实 REJECTED 后的新永久任务，不重开旧任务，
> 不把旧任务未执行的候选或正式门禁转换为 PASS。Backlog 中没有 TASK-0125，因此不写
> `planningBacklog` 或 `planningContractHash`。

## 背景与用户可观察目标

TASK-0123 已提交 shared Auth request-target classifier、strict UTF-8 boundary 与 firewall handler，但 R2 证明
encoded Auth-prefix alias `/api/v1/%61uth/admin/accounts` 仍因 literal raw-prefix 判断走默认空 400；同时自定义
handler 替代了 Spring Security 7.1 默认 observation composition。TASK-0124 在实现前因 Context fingerprint
错误而 REJECTED。本卡在正确的新 Context 上闭合这两个已证实 P2，并重新证明 TASK-0123 完整 Auth 边界矩阵。

完成后，parseable MVC-equivalent Auth alias 无论由 custom filter 还是 firewall 先拒绝，都返回固定
`400 INVALID_REQUEST` envelope；每次 firewall rejection 仍先把同一 `RequestRejectedException` 标记到当前
Micrometer Observation。非 Auth、非 POST、malformed 非 Auth 与既有 filter/JWT/CSRF/cookie 行为不变。

## 范围内

- 让 Auth firewall handler 在 parseable target 上复用 shared resolver 的 `NON_CANONICAL/MALFORMED` 分类，raw
  literal Auth prefix 只作为无法解析时的保守 fallback。
- 注入 `ObservationRegistry`，在所有 Auth/非 Auth response 分支前执行 Spring Security 官方
  `ObservationMarkingRequestRejectedHandler`，随后再写固定 Auth envelope 或委托默认 status handler。
- 增加 active Observation unit test、encoded Auth-prefix full Security-chain test、context-path 与非 Auth fallback
  回归；重新运行 TASK-0123 完整 targeted 与 root matrix。

## 明确范围外

- 不修改 `AuthSecurityConfig`、filter 顺序、endpoint mappings、权限、JWT、CSRF/origin/cookie、limiter 或数据库。
- 不改变 body/field/token 上限、strict UTF-8 语义、错误 Catalog/Contract/OpenAPI 或任何生成物。
- 不建立新的 metrics、日志、gateway、container filter、trusted proxy 或外部服务；不记录 raw URI/异常文案。
- 不修改 TASK-0123/TASK-0124 的 Task/Evidence/Handoff，不改变其终态，不补写其正式门禁。

## 输入和前置条件

- Base 是 TASK-0124 已推送且远端 0/0、post-terminal Doctor PASS 的 REJECTED 终态提交
  `098115264879ed1bd99c79e90db2ddca54061c4b`；TASK-0123 候选实现继续存在于历史，但没有 PASS 声明。
- Context Lock 固定 Base 中 55 个输入，包含 TASK-0123 R2、TASK-0124 intake failure review/Handoff、当前
  helper/filter/security wiring/tests 与治理真源；fingerprint 按 canonical 算法构造且 payload 无末尾 LF。
- Spring Security 7.1 官方 `ObservationMarkingRequestRejectedHandler` 与 `HttpStatusRequestRejectedHandler` 已由
  Base 锁定的 Maven 工具链提供，不新增依赖。

## API / 事件 / 数据契约

- canonical Auth API 与成功/失败业务 contract 不变。
- firewall 先拒绝的 parseable Auth-equivalent target 与 filter rejection 统一为 UTF-8 JSON
  `{"code":"INVALID_REQUEST","message":"The request is invalid"}`，不含 details、raw target 或异常 message。
- 非 Auth firewall rejection 保持默认 `sendError(400)`；Observation 只附加异常，不改变 HTTP status/body。

## 权限、RLS 和数据处理要求

- handler 只处理 Spring Security firewall 已拒绝的请求，不建立身份、放宽 matcher 或绕过 ADMIN Bearer/JWT。
- observation error 仅绑定既有 `RequestRejectedException` 对象；自定义 response/log/Evidence 不保存 raw URI、凭据或用户数据。
- repository、JDBC、RLS、session rotation、logout 与 admin seed 完全不可达且无 diff。

## 状态机和失败行为

- handler 首先执行 official observation marker；有 current Observation 时 `context.error` 是同一 exception，无时 no-op。
- exact POST + shared resolver `NON_CANONICAL/MALFORMED` 或 literal raw Auth fallback 返回固定 JSON 400。
- lowercase/non-POST、malformed 非 Auth、parseable 非 Auth继续委托默认 status handler；不得被改写成 Auth envelope。
- resolver/observation/response 任一异常不得泄漏 raw target 或转为 2xx/401/403/429。

## 模型、Prompt、记忆和安全边界

本卡不调用模型，不改 Prompt、Memory、provider 或付费能力；不引入 SaaS/网络依赖。

## 验收标准

1. `/api/v1/%61uth/admin/accounts` 被 resolver 分类为 Auth non-canonical，实际 Security chain 固定返回完整
   INVALID_REQUEST JSON；literal encoded/matrix aliases 继续同样返回且 service 不可达。
2. handler 在 Auth envelope 与非 Auth fallback 两条分支前都把同一 `RequestRejectedException` 标记到 active
   Observation；无 current Observation 时响应仍稳定，不添加日志或输入回显。
3. non-Auth firewall rejection 继续空 400；lowercase method、malformed 非 Auth 在 shared filters 中 zero-read
   chain-through，既有 context-path 语义不回归。
4. TASK-0123 的 malformed Auth fixed envelope、body zero-read、16384/16385 fence、source/429/lease、strict UTF-8、
   U+FFFD/lone surrogate 与 direct service fail-closed tests 全部保持。
5. `AuthSecurityConfig`、JWT、CSRF/cookie、route mapping、数据库、specs、生成物与依赖零 diff；C3 Reviewer 对
   两个 R2 finding closure、完整矩阵、相邻风险和 P0/P1/P2/P3 给结构化终态。
6. frozen canonical、targeted reactor、root JDK-25 verify 与唯一无参数 `git diff --check` 在同一 clean candidate
   上按顺序各执行一次并真实 PASS。
7. Evidence/Handoff、单父终态提交、push/fetch、HEAD==origin/main、0/0 与 post-terminal Doctor PASS。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前仅运行有界迭代测试；正式 Precheck、targeted、
root verify 与无参数 diff check 各一次，绑定同一 clean Commit/Tree。远端 exact-SHA 继续真实非 PASS，本地 fallback
只覆盖记录的平台、工具链和输出哈希。

## 回滚或前向修复

- 候选前仅在三条业务白名单路径内前向修复；不得恢复或重写 TASK-0123/TASK-0124 历史。
- observation composition 无法用官方 handler 且不改变 Security config 的前提下证明时真实 REJECTED，不自写
  instrumentation、不扩大 scope。
- 终态后缺陷只允许新永久 Task ID 前向处理，不 amend/reset/删除测试。

## 停止条件

- 需要修改 forbidden `AuthSecurityConfig`、依赖、specs、database 或历史任务才能闭合。
- handler 无法同时证明 encoded Auth envelope、official observation marking 与 non-Auth fallback 保真。
- Reviewer R2 后仍有 P0/P1 或本卡范围内未闭合 P2，需要第二 fix batch/R3，或达到 hard fuse。
- 任一 formal/pre-closure/push/remote 复核非 PASS。

## Evidence Pack

输出 `docs/evidence/TASK-0125/` 与 `docs/handoffs/TASK-0125.json`，绑定 Base、Context、候选 Commit/Tree、Reviewer、
命令真实状态与哈希、local/remote 渠道、delivery timing 和唯一 nextAction；终态原子更新 Task、Project State、
Ledger、Evidence/Handoff，以 `[skip ci]` 单父提交推送并复核远端。
