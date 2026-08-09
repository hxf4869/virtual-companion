# TASK-0127：Technical Alpha 能力与 Evidence 标签真值

```yaml
taskId: TASK-0127
state: READY
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: 86389bd2fca56ec1f3afea638c5eda1869a12555
authorizationCommit: 4caed8261264f1f3ea337b6bc68cc8ff1240a6fd
contextFingerprint: c2b0d5dabfda727be6f1f0ea27fb652ab8091d86fbc414afa6e57a6c6b79f648
contextLock: docs/tasks/context/TASK-0127.context-lock.yaml
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
  riskClass: C2
  surfaceId: TASK_0127_TECHNICAL_ALPHA_CAPABILITY_TRUTH
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 70
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - .github/workflows/ci.yml
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
  - README.md
  - docs/architecture/repository-structure.md
  - docs/engineering/technology-baseline.md
  - docs/evidence/TASK-0090/evidence-pack.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/evidence/TASK-0122/evidence-pack.json
  - docs/evidence/TASK-0126/evidence-pack.json
  - docs/handoffs/TASK-0090.json
  - docs/handoffs/TASK-0126.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/TASK-0126-auth-refresh-malformed-utf16-fail-closed.md
  - docs/tasks/context/TASK-0126.context-lock.yaml
  - docs/tasks/task-card-template.md
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - frontend/src/pages.json
  - infra/db/run-rls-tests.sh
  - pom.xml
  - requirements-harness.txt
  - service/apps/runtime/pom.xml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
  - service/apps/runtime/src/main/resources/application.yaml
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
  - service/platform/persistence/src/main/resources/db/migration/V14__identity_accounts_sessions.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - specs/catalog/product-scope.yaml
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - docs/tasks/TASK-0127-technical-alpha-capability-truth.md
  - docs/tasks/context/TASK-0127.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0127/**
  - docs/handoffs/TASK-0127.json
  - README.md
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-0120-*
  - docs/tasks/TASK-0121-*
  - docs/tasks/TASK-0122-*
  - docs/tasks/TASK-0123-*
  - docs/tasks/TASK-0124-*
  - docs/tasks/TASK-0125-*
  - docs/tasks/TASK-0126-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-0120.context-lock.yaml
  - docs/tasks/context/TASK-0121.context-lock.yaml
  - docs/tasks/context/TASK-0122.context-lock.yaml
  - docs/tasks/context/TASK-0123.context-lock.yaml
  - docs/tasks/context/TASK-0124.context-lock.yaml
  - docs/tasks/context/TASK-0125.context-lock.yaml
  - docs/tasks/context/TASK-0126.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-0120/**
  - docs/evidence/TASK-0121/**
  - docs/evidence/TASK-0122/**
  - docs/evidence/TASK-0123/**
  - docs/evidence/TASK-0124/**
  - docs/evidence/TASK-0125/**
  - docs/evidence/TASK-0126/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-0120.json
  - docs/handoffs/TASK-0121.json
  - docs/handoffs/TASK-0122.json
  - docs/handoffs/TASK-0123.json
  - docs/handoffs/TASK-0124.json
  - docs/handoffs/TASK-0125.json
  - docs/handoffs/TASK-0126.json
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
  - docs/architecture/**
  - docs/engineering/**
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
  - service/**
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
  - specs/catalog/product-scope.yaml
  - specs/openapi/virtual-companion.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
  - service/platform/persistence/src/main/resources/db/migration/V1__extensions_roles_functions.sql
  - service/platform/persistence/src/main/resources/db/migration/V15__provider_attempt_terminal_transitions.sql
  - frontend/src/pages.json
  - docs/evidence/TASK-0090/evidence-pack.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0112/evidence-pack.json
  - docs/evidence/TASK-0122/evidence-pack.json
  - docs/evidence/TASK-0126/evidence-pack.json
  - docs/handoffs/TASK-0126.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
requiredInvariants:
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
      Owner 恢复当前长线 goal 并要求 Codex 按当前思考深度、不启用 fast、无需逐项询问地继续审计修复；
      TASK-0126 已 ACCEPTED、推送且远端 0/0，其 Handoff 与 project-state 唯一 nextAction 指向 TASK-0127。
  - scope: technical-alpha-capability-and-evidence-truth
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 长线授权要求一次一张卡处理审计剩余项。P3-02 已确认 README 将用户、聊天、数据库、模型、
      记忆与安全全部描述为未实现并只列两个端点，与当前 Auth controller、V1-V15 migrations、后端模块和
      前端页面事实冲突；P3-08 要求历史 TASK-0090 保持 append-only，后续 Evidence 使用精确 reactor/remote 标签。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-09"
    sourceThreadId: 019fdf92-9c99-7400-a2ea-d490ef3d7e15
    evidence: >-
      Owner 要求长线不中断推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 失败事实保持不变。
      TASK-0112 至 TASK-0126 已按同一 fallback 合规闭环；本卡冻结 LOCAL_EXACT_TREE_FALLBACK，
      远端继续如实非 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0127
  - python scripts/dev/openapi_tool.py validate
  - docker run --rm -v /Users/hxf/projects/virtual-companion:/workspace -v vc-maven-cache:/root/.m2 -w /workspace maven:3.9-eclipse-temurin-25-alpine ./mvnw --batch-mode --no-transfer-progress verify
  - pnpm --dir frontend test:run
  - pnpm --dir frontend type-check
  - pnpm --dir frontend build
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡不在 Backlog 中，因此不写 `planningBacklog` 或 `planningContractHash`。P3-08 的关闭只允许
> 前向证明后续 Evidence 已使用精确标签；TASK-0090 及所有历史 Task/Evidence/Handoff 必须零 diff。

## 背景与用户可观察目标

根 README 仍称用户、聊天、数据库、模型、记忆和安全业务均未实现，且当前工程只有 health/baseline
两个端点。当前 Base 已存在 Auth login/refresh/logout/admin accounts controller、V1-V15 数据库迁移、
安全与模型运行模块、OpenAI/Anthropic 协议适配器、Chat/Memory/Login 前端页面与对应测试；但 Generation、
Realtime、Memory 等 OpenAPI 路由尚未接入 runtime controller，真实用户 Beta、真实支付和生产外发仍受阻。

完成后，README 必须让开发者能区分“已实现的模块/契约/迁移/页面”“当前 runtime 可调用端点”与“尚未
生产接线或被 capability gate 阻断的能力”，且命令与工具链版本保持真实。Evidence 范围只按真实 argv
命名，不把 targeted/runtime-upstream reactor、root 15-module 和 remote exact-SHA 混为一谈。

## 范围内

- 更新 README 的开篇状态、当前工程能力、runtime 端点、契约但未接线路由、前端与数据库说明。
- 明确 OpenAPI contract surface 不等于 runtime controller 已实现，不把 Chat/Memory/Provider kernel 写成
  面向真实用户可用。
- 明确 production profile、真实 provider、Beta、支付、PIA/伦理/值班等发布闸门仍未满足。
- 在治理入口中说明 Evidence 标签必须精确区分 targeted reactor、root reactor 与 remote exact-SHA；
  历史 TASK-0090 的 `full-module` 原文保持 append-only，不追溯改写。

## 明确范围外

- 不改任何 Java、SQL、frontend、OpenAPI/Catalog/Contract、CI/Harness/Skill、依赖或生成物。
- 不实现 Generation/Realtime/Memory controller，不接真实 provider，不改变 Auth、RLS、模型、安全或前端行为。
- 不修改 TASK-0090 或任何历史 Task/Evidence/Handoff，不伪造新的根级或远端 PASS。
- 不关闭 P3-01/P3-07、数据库/Auth/Harness 剩余项或 RISK-01 至 RISK-11 条件风险。

## 输入和前置条件

- Base 是 TASK-0126 已推送、远端 0/0 且 post-terminal Doctor PASS 的终态提交
  `86389bd2fca56ec1f3afea638c5eda1869a12555`。
- Context Lock 固定 Base 中 65 个输入，包括 machine truth、runtime controllers、V1-V15 migrations、
  OpenAPI、frontend pages、TASK-0090 历史 Evidence 与 TASK-0112/0122/0126 后续 Evidence。
- README 不是能力真源；内容只能从代码、测试、spec 和机器状态保守投影，发生冲突时以这些输入为准。

## API / 事件 / 数据契约

本卡不改变 API、事件、数据库、Catalog、Contract 或 OpenAPI。README 只描述 Base 的现状：runtime 暴露
health、baseline 与四个 Auth route；OpenAPI 中其余 route 是合同面而非已接线的 runtime 实现。

## 权限、RLS 和数据处理要求

不修改权限、RLS、principal、session、token 或数据处理。文档不得暗示 Technical Alpha 已可保存真实用户
数据或满足 Beta/生产发布条件。

## 状态机和失败行为

任务行为仅为文档真值更新。若发现 README 真实性必须依赖修改代码/spec/机器真源、或当前能力证据互相
冲突，则停止并真实 REJECTED；不得通过扩大本卡写范围制造一致性。

## 模型、Prompt、记忆和安全边界

不调用模型、不改 Prompt/Memory/provider。README 必须把 provider adapter/kernel 与真实外发生产接线区分，
且保留 realUserBeta BLOCKED、realPayment FORBIDDEN 和无真实凭据/真实数据的边界。

## 验收标准

1. README 不再声称用户/数据库/模型/记忆/安全全部未实现，也不再只列两个端点。
2. runtime 可调用面精确列出 health、baseline、login、refresh、logout、admin accounts；OpenAPI 其他 route
   被明确标记为契约面、尚无 runtime controller，不能被误解为生产可用。
3. README 准确描述 V1-V15 migrations、后端模块/provider adapters、Login/Chat/Memory 前端页面与测试，
   同时明确这些组件不等于 Generation/Realtime/Memory 纵切已接通。
4. 发布与安全边界保持：Technical Alpha、本地/CI 合成数据、真实外发未接、Beta BLOCKED、支付 FORBIDDEN。
5. TASK-0090 与全部历史制品零 diff；后续 Evidence 精确区分 targeted/runtime-upstream、root 15-module、
   local fallback 与 remote exact-SHA，P3-08 不以改写历史关闭。
6. README 链接和命令与 Base 实际路径、JDK 25、Node 22、pnpm 11、统一 canonical Python 入口一致。
7. 独立 Reviewer 对事实矩阵、范围、历史 append-only 与 P0/P1/P2/P3 给结构化终态。
8. frozen requiredCommands 与唯一无参数 `git diff --check` 在同一 clean candidate 上按顺序各执行一次并 PASS；
   Evidence/Handoff、单父终态提交、push/fetch、远端 0/0 和 post-terminal Doctor 闭环。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 和顺序为准。Reviewer PASS 前只允许只读核对和轻量 README 链接检查；
正式 Precheck、OpenAPI validate、root JDK-25 verify、frontend test/type-check/build、完整 database suite 与无参数
diff check 各一次，绑定同一 clean Commit/Tree。远端 exact-SHA 继续真实非 PASS，本地 fallback 只覆盖记录环境。

## 回滚或前向修复

- 候选前只在 README 白名单内前向修正；不得修改历史 Evidence 或任何实现来迎合文档。
- 若 Reviewer 发现范围内 P2/P3，最多一批 README 修复并进入 R2；P0/P1、结构性矛盾或需跨面修改则 REJECTED。
- 终态后任何真值漂移以新永久 Task ID 前向处理，不 amend/reset/rebase 历史。

## 停止条件

- 必须修改 README 之外业务、spec、CI/Harness 或历史 Task/Evidence/Handoff 才能闭合。
- 无法在当前 Base 区分 runtime 端点、contract surface 与未接线能力。
- Reviewer R2 后仍有 P0/P1 或范围内未闭合 P2，需第二 fix batch/R3，或达到 hard fuse。
- 任一 formal/pre-closure/push/remote 复核非 PASS。

## Evidence Pack

输出 `docs/evidence/TASK-0127/` 与 `docs/handoffs/TASK-0127.json`，绑定 Base、Context、候选 Commit/Tree、
Reviewer、命令真实状态与哈希、local/remote 渠道、delivery timing 和唯一 nextAction；终态原子更新 Task、
Project State、Ledger、Evidence/Handoff，以 `[skip ci]` 单父提交推送并复核远端。
