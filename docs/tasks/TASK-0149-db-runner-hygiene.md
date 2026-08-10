# TASK-0149：P3-07 DB test runner 陈旧注释与 glob 动态一致

```yaml
taskId: TASK-0149
state: DRAFT
owner: repository-owner
riskClass: C2
requiredSkills:
  - task-delivery-flow
  - task-intake
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
targetSkillVersions: {}
baseCommit: a6c4c68041f32c6abf2be769dc662f3b9b2eb493
authorizationCommit: ""
contextFingerprint: bca61c5fe2de7d6bcde6fef6ea14d5508d1c097e855221bd47a9c40135b1f4ee
contextLock: docs/tasks/context/TASK-0149.context-lock.yaml
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
  surfaceId: TASK_0149_P3_07_DB_RUNNER_HYGIENE
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
  - docs/tasks/TASK-0148-readme-status-endpoints-audit.md
  - docs/tasks/context/TASK-0148.context-lock.yaml
  - docs/evidence/TASK-0148/evidence-pack.json
  - docs/evidence/TASK-0148/pre-closure-request.json
  - docs/evidence/TASK-0148/review-r1.md
  - docs/handoffs/TASK-0148.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - infra/db/run-rls-tests.sh
writeAllowlist:
  - docs/tasks/TASK-0149-db-runner-hygiene.md
  - docs/tasks/context/TASK-0149.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0149/**
  - docs/handoffs/TASK-0149.json
  - infra/db/run-rls-tests.sh
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
  - docs/tasks/TASK-0148-*
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
  - docs/tasks/context/TASK-0148.context-lock.yaml
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
  - docs/evidence/TASK-0148/**
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
  - docs/handoffs/TASK-0148.json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
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
  - infra/db/tests/**
  - infra/db/*.sql
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
  - docs/evidence/TASK-0148/evidence-pack.json
  - docs/handoffs/TASK-0148.json
  - infra/db/run-rls-tests.sh
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
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 于 2026-08-09/08-10 长线会话授权按 docs/evidence/TASK-0109/zcode-remediation-handoff.md
      §4.9 串行处理 P3-07（DB runner 注释和测试发现逻辑保持动态一致；覆盖空目录和特殊文件名）。
      P3-07 为 OPEN 无 Owner gate 项；本卡只修改 infra/db/run-rls-tests.sh 的陈旧注释与测试
      glob（数字前缀至少 2 位且空匹配安全），不触碰任何 SQL 测试文件与迁移；工程细节按长线授权
      由实施者决定并如实记录；禁止历史改写和伪造 PASS。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS。
independentReview: not-required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0149
  - bash infra/db/run-rls-tests.sh
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P3-07 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.9 登记的 OPEN 审计项：DB runner
> 注释和测试发现逻辑保持动态一致，覆盖空目录和特殊文件名。

## 背景与用户可观察目标

P3-07（DB test runner 陈旧注释/glob）现状（`infra/db/run-rls-tests.sh`）：

- 第 3 行注释仍写 "runs the **five** cross-tenant fail-closed SQL tests"——当前测试目录已有
  51 个编号测试（01..51），"five" 是 TASK-0015 时代的陈旧描述，会误导读者对覆盖范围的判断。
- 第 133 行测试发现 glob `ls "$TEST_DIR"/[0-9][0-9]_*.sql` 只匹配**恰好 2 位数字**前缀；
  测试超过 99 个（3 位数字）时会静默漏测；且 `$(ls ...)` 在空目录时把未匹配的 glob 字面量
  原样交给循环执行，空目录场景不失败关闭（违背"覆盖空目录"要求）。

用户可观察结果：脚本头注释动态描述编号测试集（不再写死 "five"）；测试发现逻辑支持 2 位及以上
数字前缀（`[0-9][0-9]*`），空目录/无匹配时安全跳过（`compgen -G` 空匹配），迁移 glob 语义不变；
完整 SQL suite 仍按编号排序运行 51 个测试并输出 `ALL TESTS PASS`。

## 范围内

- `infra/db/run-rls-tests.sh`：
  - 第 2-3 行注释更新为动态描述（如 "runs the numbered cross-tenant fail-closed SQL tests"），
    移除 "five" 硬编码。
  - 第 133 行测试发现 glob 改为
    `for t in $(compgen -G "$TEST_DIR"/[0-9][0-9]*_*.sql | sort); do`——支持 2 位及以上数字
    前缀，空匹配时 `compgen -G` 输出为空、循环零次执行（空目录安全），保持按编号排序。
  - 不改变迁移 glob（`ls "$MIG_DIR"/V*.sql | sort -V`）、容器生命周期、日志收集或任何测试语义。
- 迭代验证：`bash -n` 语法检查 + 实际运行 `bash infra/db/run-rls-tests.sh`（52 项测试 ALL
  TESTS PASS，含 51_authorization_snapshot_one_way_lifecycle.sql）。
- 唯一正式 Precheck、唯一正式 SQL suite 运行、唯一 `git diff --check`、pre-closure、push、fetch、
  clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改任何 `infra/db/tests/*.sql`（51 个测试文件）与任何迁移文件。
- 不修改 run-rls-tests.sh 的容器/镜像/日志/错误处理逻辑（只改注释与测试发现 glob）。
- 不处理 P2-25/P2-27（Owner gate）、Provider DNS、数据库 Owner gates 或条件风险。

## 输入和前置条件

- Base `a6c4c68041f32c6abf2be769dc662f3b9b2eb493` 是 TASK-0148 单父 ACCEPTED terminal，已 push、
  fetch、`HEAD...origin/main=0/0` 且工作树 clean（post-terminal Doctor PASS，839375 checks）。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint `bca61c5f…` 基于
  Base 重新计算。
- Docker 只用 OrbStack（run-rls-tests.sh 需要 PostgreSQL 容器）。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件、数据或任何 SQL 测试语义。脚本输出契约不变：每个测试 `PASS <name>`/
`FAIL <name>`，结尾 `ALL TESTS PASS` 或 `SOME TESTS FAILED`（退出码 0/1）；日志目录
`$VC_DB_LOG_DIR` 行为不变。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；READY 后不得修改任务卡正文或不可变元数据。任何正式门禁非 PASS 或候选身份变化：立即
停止 promotion，如实 REJECTED（保留失败历史），按失败根因创建新卡从 DRAFT 起修正范围。

## 验收标准

- run-rls-tests.sh 头部注释不再写死测试数量（无 "five" 字样），动态描述编号测试集。
- 测试发现 glob 支持 2 位及以上数字前缀且空匹配安全（`compgen -G`）；`bash -n` 语法检查 PASS。
- `bash infra/db/run-rls-tests.sh` 真实运行：52 个测试全部 `PASS`，结尾 `ALL TESTS PASS`，
  退出码 0（含 TASK-0144 新增的 51_authorization_snapshot_one_way_lifecycle.sql）。
- 唯一正式 Precheck 全命令 PASS；唯一无参数 `git diff --check` PASS（输出空）。
- 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 fetch 断言 `HEAD==origin/main`、tree
  一致、`0/0`、clean；remote exact-SHA 如实非 PASS（dispatchCount=0）。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代以 `bash -n` 与一次 SQL suite 实跑为准
（不冒充正式 Evidence）；冻结候选后依次执行唯一 Precheck、唯一正式 SQL suite、唯一无参数 diff
check、Evidence/Handoff 和唯一 pre-closure。Precheck 已覆盖的 canonical 子命令不重复；同一条
`git diff --check` 只执行一次。

## 回滚或前向修复

若任一正式门禁非 PASS：如实 REJECTED（保留失败历史与 Evidence），按失败根因创建新卡从 DRAFT
起修正范围。

## 停止条件

- 正式 Precheck/SQL suite/diff check/pre-closure 任一非 PASS 或候选身份变化：立即停止。
- hardFuseWallMinutes 90 到达：停止实现/修复/门禁，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0149/`（evidence-pack.json、pre-closure-request.json），并生成
`docs/handoffs/TASK-0149.json`。
