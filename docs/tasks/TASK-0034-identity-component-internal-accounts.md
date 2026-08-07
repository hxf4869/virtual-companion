# TASK-0034：成熟身份组件与内部测试账号接入（硬决策闸门）

```yaml
taskId: TASK-0034
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - database-migration
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  database-migration: "1.0.0"
targetSkillVersions: {}
planningBacklog: .harness/task-backlog.yaml
planningContractHash: 97d1811077869765bf3dab340f350e477d3033283fec180c1dd33498457f8346
planningContractHashAlgorithm: SHA256_CANONICAL_JSON_V1
baseCommit: ddc98d1f96192ecb94053c9740b3956bdf6fc750
contextFingerprint: 71babb7366bfc6fb961f621d4f901ffb8682c1a27dd481ff49ea54b41bd292a9
contextLock: docs/tasks/context/TASK-0034.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
authorizationCommit: 68e60bc62fe5cdc8d4938dce4918de859927017c
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
  riskClass: C4
  surfaceId: TASK_0034_IDENTITY_COMPONENT_INTERNAL_ACCOUNTS
  policySurfaces: [AUTHORIZATION]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .harness/ci-execution-policy.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/task-card-template.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - requirements-harness.txt
  - pom.xml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/database-migration/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - specs/catalog/catalog-manifest.yaml
  - specs/catalog/error-codes.yaml
  - specs/catalog/generation-states.yaml
  - specs/catalog/message-states.yaml
  - specs/catalog/product-scope.yaml
  - specs/catalog/risk-levels.yaml
  - specs/catalog/service-modes.yaml
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - infra/db/run-rls-tests.sh
  - specs/openapi/virtual-companion.yaml
  - scripts/dev/openapi_tool.py
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/harness_common.py
  - scripts/harness/tests/test_harness.py
  - specs/generated/openapi/catalog-schemas.yaml
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationReceiveService.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/JdbcProviderDeploymentRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/GenerationRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/RealtimeResumeService.java
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/VirtualCompanionRuntimeApplication.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/TechnicalBaselineProperties.java
  - docs/tasks/TASK-0026-h5-offline-chat-stream-recovery.md
  - docs/tasks/TASK-0030-h5-memory-management.md
  - docs/tasks/TASK-0033-anthropic-messages-offline-contract.md
  - docs/evidence/TASK-0026/evidence-pack.json
  - docs/evidence/TASK-0030/evidence-pack.json
  - frontend/package.json
  - frontend/vitest.config.ts
  - frontend/src/main.ts
  - frontend/src/pages.json
  - frontend/src/api/realtime.ts
  - frontend/src/api/memory.ts
  - frontend/src/stores/chat.ts
  - frontend/src/stores/memory.ts
  - frontend/src/pages/chat/chat.vue
  - frontend/src/pages/memory/memory.vue
writeAllowlist:
  - docs/tasks/TASK-0034-identity-component-internal-accounts.md
  - docs/tasks/context/TASK-0034.context-lock.yaml
  - docs/evidence/TASK-0034/**
  - docs/handoffs/TASK-0034.json
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - infra/db/run-rls-tests.sh
  - infra/db/tests/39_identity_accounts_sessions.sql
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityAccountRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRecord.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/IdentityRefreshTokenRepository.java
  - service/platform/persistence/src/main/java/com/virtualcompanion/platform/persistence/PersistenceConfig.java
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/**
  - service/apps/runtime/src/test/java/com/virtualcompanion/runtime/auth/**
  - specs/openapi/virtual-companion.yaml
  - specs/openapi/dist/**
  - frontend/src/api/**
  - frontend/src/stores/**
  - frontend/src/pages/login/**
  - frontend/src/pages.json
  - frontend/src/main.ts
forbiddenPaths:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
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
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - requirements-harness.txt
  - scripts/harness/**
  - scripts/dev/**
  - skills/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - docs/source/**
  - docs/decisions/**
  - service/adapters/**
  - service/modules/**
  - service/platform/catalog/**
  - service/tests/**
  - service/platform/persistence/pom.xml
  - service/platform/persistence/src/test/**
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V2__user_domain_ownership.sql
  - service/platform/persistence/src/main/resources/db/migration/V3__authorization_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V4__provider_registry.sql
  - service/platform/persistence/src/main/resources/db/migration/V5__worker_claim_lease_fence.sql
  - service/platform/persistence/src/main/resources/db/migration/V6__conversation_generation_persistence.sql
  - service/platform/persistence/src/main/resources/db/migration/V7__finalize_generation_usage_quota_outbox.sql
  - service/platform/persistence/src/main/resources/db/migration/V8__realtime_resume_ticket_gap_reset_snapshot.sql
  - service/platform/persistence/src/main/resources/db/migration/V9__relationship_active_companion_limit.sql
  - service/platform/persistence/src/main/resources/db/migration/V10__generation_cancel_message_history.sql
  - service/platform/persistence/src/main/resources/db/migration/V11__canonical_memory_lifecycle.sql
  - service/platform/persistence/src/main/resources/db/migration/V12__memory_candidate_management_api.sql
  - service/platform/persistence/src/main/resources/db/migration/V13__memory_recall_context_tombstone.sql
  - frontend/src/domain/**
  - frontend/src/pages/chat/**
  - frontend/src/pages/memory/**
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
  - skills/database-migration/SKILL.md
  - docs/decisions/0002-persistence-and-contract-first-direction.md
  - specs/contracts/database-ownership-contract.yaml
  - specs/contracts/realtime-contract.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
  - INV-TENANT-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: database-migration
    approvedBy: repository-owner
    approvedAt: "2026-08-07"
    sourceThreadId: long-line-execution-product-conversation
    evidence: >-
      长线执行 Owner 授权 TASK-0034 成熟身份组件与内部测试账号接入（database-migration C4，
      单一 protected skill surface）：新建 V14 前向迁移（身份账户/refresh token/认证审计），
      Spring Security + JWT 自托管鉴权（用户名+密码登录、平台初始化管理员 + 后台手动建号、
      Bearer access 2h + refresh 7d 服务端有状态撤销），user_id→owner_user_id 服务端映射接 RLS
      （INV-TENANT-001），最小 H5 登录集成与 OpenAPI 契约，零 catalog/generated 改动。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0034
  - bash infra/db/run-rls-tests.sh
  - python scripts/dev/openapi_tool.py validate
  - python scripts/dev/openapi_tool.py diff --fail-on-drift
  - bash -c "cd frontend && npx vitest run"
  - bash -c "cd frontend && npx vue-tsc --noEmit"
  - python -m unittest discover -s scripts/harness/tests -p test_*.py
  - git diff --check
```

> 规划正文仅为非规范的人类可读渲染；唯一机器真源是 `.harness/task-backlog.yaml` 中本 Task ID 的静态合同，并由 `planningContractHash` 完整绑定。

## 背景与用户可观察目标

在 Owner 已批准的身份方案（GATE-IDENTITY-PROVIDER-SESSION APPROVED：Spring Security + JWT 自托管鉴权、用户名+密码登录、平台初始化 1 条管理员 + 管理员后台手动建号、user_id 即 owner_user_id、Bearer access 2h + refresh 7d）基础上，接入成熟身份组件与内部测试账号。用户可观察：H5 登录页面可用管理员创建的内部账号登录，退出可登出；登录后聊天/记忆/关系等既有接口携带凭据访问，未登录请求收到 AUTHENTICATION_REQUIRED；凭据不落日志/URL/模型。

## 范围内

- **V14 迁移**（database-migration 保护面）：身份账户表（username 唯一、BCrypt password_hash、role ADMIN/USER、status ACTIVE/DISABLED）、refresh token 表（sha256 token_hash、user_id FK、expires_at、revoked_at）+ 认证审计事件记录；身份账户与会话的访问控制（SECURITY DEFINER 函数或等价最小权限路径，跨账号/未授权失败关闭，不披露存在性）。
- **Spring Security + JWT**（service/apps/runtime）：spring-boot-starter-security + 成熟 JWT/密码哈希库（Spring Security 自带 BCrypt；禁止自研密码学原语）；SecurityFilterChain（认证端点公开、其余 Bearer JWT）；登录成功签发 access+refresh，JWT claim 携带 user_id。
- **服务端验证映射**：认证成功后把 user_id 映射为 owner_user_id，经 `SET LOCAL current_owner_id` 注入 SQL 会话接 RLS（INV-TENANT-001，服务端可信来源；客户端 owner_user_id/开发 Header 不是身份真源）。
- **内部账号供给**：平台初始化 1 条管理员（应用启动 seed，密码来自批准渠道注入，不落日志/仓库）；管理员后台手动建号端点（仅 ADMIN 角色可调用），无公开注册。
- **会话撤销与审计**：logout 撤销服务端 refresh token；refresh 续期检查服务端有状态存储；登录成功/失败、登出、建号写入审计事件。
- **H5 最小登录集成**（frontend/src/api + stores + pages/login）：登录/登出/刷新调用（transport 注入式，镜像 TASK-0026/0030 范式）；token 注入既有 api transport；401 重定向到登录页；简单登录页 + 路由。
- **OpenAPI 契约**：登录/刷新/登出/管理员建号端点加入 specs/openapi/virtual-companion.yaml 并生成 dist；错误复用既有 AUTHENTICATION_REQUIRED/ACCESS_DENIED/NOT_FOUND_OR_FORBIDDEN（零 catalog/generated 改动，不新增错误码）。
- **服务端 CSRF/Origin 边界**：API-only Bearer 无 cookie 会话故无 CSRF token 需求；配置 Origin/CORS 允许来源（Alpha 本机/内网），未知 Origin 拒绝；凭据不外泄到日志/URL/模型。

## 明确范围外

- 公开注册、共享固定生产身份、第三方 IdP（Authentik/Keycloak/Auth0）接入、OAuth/OIDC 协议实现、自研密码哈希/JWT 签名/密码学原语。
- 客户端信任 owner_user_id 或开发 Header 作为身份真源。
- 完整前端登录 UI 打磨（多因素、找回密码、个人资料页）、前端 domain/chat/memory 页面改造。
- 真实供应商接线（TASK-0035）、真实模型外发（TASK-0035）、Technical Alpha 总验收（TASK-0036）。
- specs/catalog、specs/generated、specs/contracts、service/**/safety、service/**/memory、service/**/modelruntime、scripts/harness、skills、.github、ci 的任何改动。

## 输入和前置条件

- baseCommit = ddc98d1（harness 修复：gate-approval companion edge + nextAction requiredFor 放宽，DRAFT baseCommit 可锚定 gate 尾链）。Context Lock 绑定 readAllowlist 76 个文件在 baseCommit 的 SHA-256。
- 依赖 TASK-0025（Chat/Generation/History API）、TASK-0026（H5 离线聊天/恢复）均已 ACCEPTED；硬闸门 GATE-IDENTITY-PROVIDER-SESSION 已 APPROVED。
- 现有 JDBC 仓储范式（GenerationReceiveService/JdbcProviderDeploymentRepository/PersistenceConfig）、runtime baseline 结构、前端 transport 注入式范式（api/realtime.ts、api/memory.ts、stores、pages）为实现参照。
- 平台管理员 seed 密码与运行期凭据经批准渠道（Docker secret/密钥文件/环境变量）注入，不写入仓库、日志、业务类型、OpenAPI 或 catalog。

## API / 事件 / 数据契约

- 新增端点（OpenAPI，scheme bearerAuth）：`POST /api/v1/auth/login`（用户名+密码→access+refresh）、`POST /api/v1/auth/refresh`、`POST /api/v1/auth/logout`、`POST /api/v1/auth/admin/accounts`（ADMIN 建号）。错误映射：未认证→AUTHENTICATION_REQUIRED；越权→ACCESS_DENIED；用户不存在/密码错误统一 NOT_FOUND_OR_FORBIDDEN（不披露存在性）。
- V14 表（schema vc）：identity_account、identity_refresh_token、身份审计事件表；列/约束以测试证明。密码哈希 BCrypt；refresh token 仅存 sha256(token)，不存明文。
- 既有 chat/memory/relationship 端点行为不变，仅增加 Bearer 鉴权；未带有效凭据一律 AUTHENTICATION_REQUIRED（不泄露资源存在性）。
- 审计事件记录登录成功/失败、登出、建号，不记录密码或 token 原文；登录失败审计含用户名（内部账号，非敏感）但不含密码。

## 权限、RLS 和数据处理要求

- 身份账户与 refresh token 是平台级管理对象（非 owner-scoped 业务数据）；访问经最小权限函数路径，未授权/跨身份/已撤销一律失败关闭或空结果，不披露存在性（镜像既有 SECURITY DEFINER + REVOKE PUBLIC 仅 GRANT vc_api 范式）。
- 登录映射：认证成功后 user_id→owner_user_id，服务端 `SET LOCAL current_owner_id` 注入，既有 FORCE RLS 业务表（conversation/generation/memory/relationship 等）继续按 owner 隔离（INV-TENANT-001）；不得通过身份端点读取他人数据。
- 敏感数据（密码、refresh token 原文）不进日志、URL、模型上下文、OpenAPI 响应、catalog 或 generated 产物。
- 凭据来源遵循 Owner 批准：Docker secret/密钥文件/环境变量注入，仓库内零明文凭据。

## 状态机和失败行为

- 账户 status：ACTIVE/DISABLED；DISABLED 账户登录拒绝（AUTHENTICATION_REQUIRED，不披露原因）。密码错误、用户名不存在统一 NOT_FOUND_OR_FORBIDDEN。
- refresh token：未撤销且未过期才可续期；撤销（logout）后拒绝；已过期/已撤销/未知 token 统一失败关闭（不区分披露）；重复 logout 幂等。
- 登录失败不做无限重试放大（仅审计记录；Alpha 内部账号无公开注册故无公开枚举面）。
- 认证异常/加密校验失败一律失败关闭为 AUTHENTICATION_REQUIRED，不返回内部错误详情。

## 模型、Prompt、记忆和安全边界

- 身份组件不涉及模型外发、安全分类器或记忆；不改动 SafetyGate/Quota/Registry 逻辑（service/**/safety、service/**/memory、service/**/modelruntime 全 forbidden）。
- 前端不把 token 写入聊天草稿、记忆内容或任何会被送入模型的上下文；登录态仅用于请求鉴权。
- 本任务不猜默认 IdP、登录渠道、账号供给或会话策略——全部按闸门1 已批准方案执行。

## 验收标准

1. `bash infra/db/run-rls-tests.sh` 通过：V14 应用成功；登录/刷新/登出/建号相关 SQL 功能测试 + 跨身份/未授权/撤销失败关闭测试全绿（含新测试 39_identity_accounts_sessions.sql）。
2. runtime Maven 构建通过（Docker Temurin-25）：Spring Security 配置加载、JWT 签发/验证、owner 映射单测绿。
3. `python scripts/dev/openapi_tool.py validate` 与 `diff --fail-on-drift` 通过：OpenAPI 契约与生成 dist 一致。
4. `bash -c "cd frontend && npx vitest run"` 与 `vue-tsc --noEmit` 通过：auth api/store 单测绿，UI 类型安全。
5. 密码/refresh token 原文不出现在日志、URL、模型、OpenAPI 响应、catalog 或 generated 产物（审计验证）。
6. 未认证请求访问既有端点返回 AUTHENTICATION_REQUIRED；DISABLED/撤销/未知 token 全部失败关闭且不披露存在性。
7. `python scripts/harness/precheck.py --task TASK-0034` PASS（含正式 Doctor）；`python -m unittest` harness 套件绿；`git diff --check` 干净。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准；每条记录状态、退出码、验证提交、产物哈希或无产物理由；同一条 `git diff --check` 只执行一次。precheck 已含正式 Doctor，不重复列 standalone Doctor；PowerShell/POSIX 包装器不是 Python canonical 命令的 Evidence 别名。

## 回滚或前向修复

- 迁移只增不改（V14 不触碰 V1-V13）；失败测试先修测试或实现，最多 1 个 fix batch。
- 若 READY 后 Owner 需修订条款或增加精确写路径：先登记 Backlog authorizationAmendments 强类型合同，再在卡 `scopeAmendments` 追加 Hash 绑定投影（单父原子治理提交）。
- 前向：本卡完成后 nextPromotable 仍为 TASK-0034 直至 ACCEPTED，其后 TASK-0035（真实供应商接线）依赖本卡 ACCEPTED 方可晋级。

## 停止条件

- context/approval/Skill/白名单/候选身份/Reviewer/canonical/CI/远端复核任一失败关闭即停止推进并转 BLOCKED。
- hardFuseWallMinutes=90 停止实现/修复/Reviewer/canonical/CI；仍活动则只允许 closure-only overrun（Evidence/Handoff、pre-closure、terminal commit、push、远端 0/0 复核），记录时长与根因。
- R1 阻塞性发现（P0/P1/AC 违反/不变量违反）进入最多 1 个 fix batch，R2 只做 finding-closure + delta + adjacent risk + 新 P0/P1；禁止第三轮 review。

## Evidence Pack

输出到 `docs/evidence/TASK-0034/`（evidence-pack.json、pre-closure-request、review-r1/r2.md），并生成 `docs/handoffs/TASK-0034.json`（headCommit= 实现候选提交、completed/remaining/knownRisks/nextAction，nextAction 与 project-state 逐字一致）。
