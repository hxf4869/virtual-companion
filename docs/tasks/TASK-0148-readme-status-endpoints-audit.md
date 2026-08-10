# TASK-0148：P3-02 README 状态与端点核对

```yaml
taskId: TASK-0148
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
baseCommit: bbad5e74b245d7418a5aa4fe29dd4c3963945b54
authorizationCommit: ""
contextFingerprint: 0f2c4567aa251f84a3ea0fb85a0d977593722d571aa54da1586be47b7b341995
contextLock: docs/tasks/context/TASK-0148.context-lock.yaml
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
  surfaceId: TASK_0148_P3_02_README_AUDIT
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 45
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
readAllowlist:
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - requirements-harness.txt
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0147-openapi-drift-gate-canonical.md
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - docs/evidence/TASK-0147/evidence-pack.json
  - docs/evidence/TASK-0147/pre-closure-request.json
  - docs/evidence/TASK-0147/review-r1.md
  - docs/handoffs/TASK-0147.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - README.md
  - specs/openapi/virtual-companion.yaml
  - service/apps/runtime/src/main/resources/application.yaml
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/auth/web/AuthController.java
  - service/apps/runtime/src/main/java/com/virtualcompanion/runtime/baseline/BaselineController.java
  - frontend/package.json
  - pom.xml
writeAllowlist:
  - docs/tasks/TASK-0148-readme-status-endpoints-audit.md
  - docs/tasks/context/TASK-0148.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0148/**
  - docs/handoffs/TASK-0148.json
  - README.md
forbiddenPaths:
  - docs/tasks/TASK-00*-*
  - docs/tasks/TASK-010*-*
  - docs/tasks/TASK-011*-*
  - docs/tasks/TASK-012*-*
  - docs/tasks/TASK-013*-*
  - docs/tasks/TASK-0140-*
  - docs/tasks/TASK-0141-*
  - docs/tasks/TASK-0142-*
  - docs/tasks/TASK-0143-*
  - docs/tasks/TASK-0144-*
  - docs/tasks/TASK-0145-*
  - docs/tasks/TASK-0146-*
  - docs/tasks/TASK-0147-*
  - docs/tasks/context/TASK-00*.context-lock.yaml
  - docs/tasks/context/TASK-010*.context-lock.yaml
  - docs/tasks/context/TASK-011*.context-lock.yaml
  - docs/tasks/context/TASK-012*.context-lock.yaml
  - docs/tasks/context/TASK-013*.context-lock.yaml
  - docs/tasks/context/TASK-0140.context-lock.yaml
  - docs/tasks/context/TASK-0141.context-lock.yaml
  - docs/tasks/context/TASK-0142.context-lock.yaml
  - docs/tasks/context/TASK-0143.context-lock.yaml
  - docs/tasks/context/TASK-0144.context-lock.yaml
  - docs/tasks/context/TASK-0145.context-lock.yaml
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - docs/evidence/TASK-00*/**
  - docs/evidence/TASK-010*/**
  - docs/evidence/TASK-011*/**
  - docs/evidence/TASK-012*/**
  - docs/evidence/TASK-013*/**
  - docs/evidence/TASK-0140/**
  - docs/evidence/TASK-0141/**
  - docs/evidence/TASK-0142/**
  - docs/evidence/TASK-0143/**
  - docs/evidence/TASK-0144/**
  - docs/evidence/TASK-0145/**
  - docs/evidence/TASK-0146/**
  - docs/evidence/TASK-0147/**
  - docs/handoffs/TASK-00*.json
  - docs/handoffs/TASK-010*.json
  - docs/handoffs/TASK-011*.json
  - docs/handoffs/TASK-012*.json
  - docs/handoffs/TASK-013*.json
  - docs/handoffs/TASK-0140.json
  - docs/handoffs/TASK-0141.json
  - docs/handoffs/TASK-0142.json
  - docs/handoffs/TASK-0143.json
  - docs/handoffs/TASK-0144.json
  - docs/handoffs/TASK-0145.json
  - docs/handoffs/TASK-0146.json
  - docs/handoffs/TASK-0147.json
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0147/evidence-pack.json
  - docs/handoffs/TASK-0147.json
  - README.md
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 9e7c3a5b-4d2f-4b8e-9a6c-2f5d7e9b1c3a
    evidence: >-
      Owner 于 2026-08-09/08-10 长线会话授权按 docs/evidence/TASK-0109/zcode-remediation-handoff.md
      §4.9 串行处理 P3-02（README 只描述 Technical Alpha 已真实接线的能力和端点，不把规划能力
      写成可用）。P3-02 为 OPEN 无 Owner gate 项；本卡为核对卡：逐项对照 README 声明与代码/配置/
      OpenAPI/前端事实，差异处最小修正，无差异则记录核对矩阵作为 Accepted 证据；禁止历史改写和
      伪造 PASS。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 9e7c3a5b-4d2f-4b8e-9a6c-2f5d7e9b1c3a
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS。
independentReview: not-required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0148
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P3-02 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.9 登记的 OPEN 审计项：README 只
> 描述 Technical Alpha 已真实接线的能力和端点，不把规划能力写成可用。

## 背景与用户可观察目标

P3-02（README 状态/端点过期）原始判断基于 TASK-0109 时代（2026-08-08）的 README。此后
TASK-0112（Auth hygiene）等卡可能已同步文档。本卡在最新 HEAD（TASK-0147 terminal bbad5e7）上
逐项核对 README 的全部可验证声明（端点、技术栈、迁移、模块、合同面、profile 开关、脚本与文档
引用），发现差异则最小修正，未发现差异则把核对矩阵固化为 Accepted 证据闭环该审计项。

## 范围内

- 逐项核对（核对矩阵见 Evidence Pack）：
  1. 固定端点：`GET /actuator/health`（management.endpoints.web.exposure.include: health）、
     `GET /api/internal/baseline`（BaselineController）。
  2. Auth 端点：`POST /api/v1/auth/login|refresh|logout|admin/accounts`
     （AuthController @RequestMapping("/api/v1/auth") + 方法映射）。
  3. 技术栈：Java 25 + Spring Boot 4.1、PostgreSQL 18 + pgvector、V1-V15 迁移（15 个迁移文件）、
     15 模块 reactor（14 个 `<module>` + 根，项目惯例）、uni-app + Vue 3 + TypeScript + Pinia
     （frontend/package.json 的 @dcloudio/uni-app 依赖与 `uni build` 脚本）。
  4. 合同面：specs/openapi/virtual-companion.yaml 的 version/relationship/generation/message/
     snapshot/memory 路径存在但 runtime 无对应 controller（grep 确认）。
  5. Profile 开关：auth.enabled/datasource-enabled 默认 false（VC_AUTH_ENABLED 等）、
     model-providers.enabled 默认 false、production profile 强制开关与 fail-closed 描述。
  6. 脚本与文档引用：scripts/dev/*.ps1、docs/engineering/agent-onboarding.md、
     docs/engineering/technology-baseline.md、docs/architecture/repository-structure.md 存在。
- README.md 的最小修正（仅当核对发现差异时；未发现差异则不改 README，只记录核对矩阵）。
- 唯一正式 Precheck、唯一 `git diff --check`、pre-closure、push、fetch、clean 与远端 `0/0` 全部
  真实完成。

## 明确范围外

- 不修改任何代码、配置、OpenAPI、frontend、迁移或生成物（只读核对）。
- 不修改 docs/engineering/**、docs/architecture/**、docs/decisions/**（只核对引用存在性）。
- 不处理 P2-25/P2-27（Owner gate）、P3-07、Provider DNS、数据库 Owner gates 或条件风险。

## 输入和前置条件

- Base `bbad5e74b245d7418a5aa4fe29dd4c3963945b54` 是 TASK-0147 单父 ACCEPTED terminal，已 push、
  fetch、`HEAD...origin/main=0/0` 且工作树 clean（post-terminal Doctor PASS，831626 checks）。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint `0f2c4567…` 基于
  Base 重新计算。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件、数据或任何代码行为。README 是开发者入口文档；本卡只允许事实性修正
（端点、状态、技术栈描述），不得把未接线能力写成可用，也不得删除既有准确声明。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；READY 后不得修改任务卡正文或不可变元数据。任何正式门禁非 PASS 或候选身份变化：立即
停止 promotion，如实 REJECTED（保留失败历史），按失败根因创建新卡从 DRAFT 起修正范围。

## 验收标准

- 核对矩阵覆盖 README 全部可验证声明，每项标注核对源（代码/配置/OpenAPI/frontend/文件系统）
  与结论（一致/修正）。
- 未发现差异时 README.md 字节不变；发现差异时修正后与代码事实一致。
- 唯一正式 Precheck 全命令 PASS；唯一无参数 `git diff --check` PASS（输出空）。
- 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 fetch 断言 `HEAD==origin/main`、tree
  一致、`0/0`、clean；remote exact-SHA 如实非 PASS（dispatchCount=0）。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代以只读 grep/find 核对为准（不冒充正式
Evidence）；冻结候选后依次执行唯一 Precheck、唯一无参数 diff check、Evidence/Handoff 和唯一
pre-closure。Precheck 已覆盖的 canonical 子命令不重复；同一条 `git diff --check` 只执行一次。

## 回滚或前向修复

若任一正式门禁非 PASS：如实 REJECTED（保留失败历史与 Evidence），按失败根因创建新卡从 DRAFT
起修正范围。

## 停止条件

- 正式 Precheck/diff check/pre-closure 任一非 PASS 或候选身份变化：立即停止。
- hardFuseWallMinutes 90 到达：停止实现/修复/门禁，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0148/`（evidence-pack.json、pre-closure-request.json；C2 无强制
独立 Reviewer，如执行独立复核则附 review-r1.md），并生成 `docs/handoffs/TASK-0148.json`。
