# TASK-0147：P3-01 OpenAPI drift gate 接入 canonical/CI

```yaml
taskId: TASK-0147
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.7"
  task-intake: "1.2.7"
  harness-change: "1.1.7"
targetSkillVersions: {}
baseCommit: e6e6d1264f9b90254a137625f7a3824eabd6a0f9
authorizationCommit: ""
contextFingerprint: 7c912181b4ddb0e80d5fd3aed45a24161236e888da48ce6a7bb8c606d60687f8
contextLock: docs/tasks/context/TASK-0147.context-lock.yaml
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
  riskClass: C4
  surfaceId: TASK_0147_P3_01_OPENAPI_DRIFT_GATE
  policySurfaces: [GOVERNANCE, CI]
  distinctCrossRiskSurfaces: 2
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 85
  thresholdsTriggered: [crossRiskSurfaces]
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    P3-01 的 canonical 接入横跨 .harness/commands.yaml（命令注册与 precheck profile）与
    scripts/harness/tests/test_harness.py（precheck profile 精确断言同步 + 新 openapi 注册/漂移
    阻断测试）——同一受保护路径集必须在一张 C4 卡内原子收敛；拆分会导致命令注册与断言漂移。
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
  - docs/tasks/TASK-0146-p2-12-inmemory-authz-snapshot-one-way-alignment.md
  - docs/tasks/context/TASK-0146.context-lock.yaml
  - docs/evidence/TASK-0146/evidence-pack.json
  - docs/evidence/TASK-0146/pre-closure-request.json
  - docs/evidence/TASK-0146/review-r1.md
  - docs/handoffs/TASK-0146.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/dev/openapi_tool.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/precheck.ps1
  - scripts/harness/doctor.py
  - scripts/harness/catalog_tool.py
  - scripts/harness/tests/test_harness.py
  - specs/openapi/virtual-companion.yaml
writeAllowlist:
  - docs/tasks/TASK-0147-openapi-drift-gate-canonical.md
  - docs/tasks/context/TASK-0147.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0147/**
  - docs/handoffs/TASK-0147.json
  - .harness/commands.yaml
  - scripts/harness/tests/test_harness.py
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
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/dev/**
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
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
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0146/evidence-pack.json
  - docs/handoffs/TASK-0146.json
  - scripts/dev/openapi_tool.py
  - scripts/harness/precheck.py
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
  - INV-HARNESS-008
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 6d4b8e2f-3c5a-4f7e-9b2d-1e3f5a7c9b0d
    evidence: >-
      Owner 于 2026-08-09/08-10 长线会话授权按 docs/evidence/TASK-0109/zcode-remediation-handoff.md
      §4.7 组 F 串行处理 P3-01（把现有 scripts/dev/openapi_tool.py 的 validate 与
      diff --fail-on-drift 接入 canonical/CI 注册；制造 drift 的测试必须阻断；生成物与手写源
      ownership 明确，禁止手改生成物）。P3-01 为 OPEN 无 Owner gate 项；工程细节按长线授权由
      实施者决定并如实记录；禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 6d4b8e2f-3c5a-4f7e-9b2d-1e3f5a7c9b0d
    evidence: >-
      Owner 明确批准以精确 scope=harness-change 实施 P3-01：.harness/commands.yaml 新增
      openapiValidate（scripts/dev/openapi_tool.py validate）与 openapiDrift（scripts/dev/
      openapi_tool.py diff --fail-on-drift）命令并加入 precheck profile（CI 经 precheck.sh 自动
      继承，不改 ci.yml 与 harnessPortabilityLocal 历史 gate 语义）；scripts/harness/tests/
      test_harness.py 同步 precheck profile 精确断言并新增 openapi 注册契约与漂移阻断测试；
      doctor.py 的 CANONICAL_PRECHECK_COMMANDS 只要求包含性，无需改动；不修改 openapi_tool.py
      本体与生成物；不授权通用 alias、环境变量 override、history rewrite、policy/Skill/阈值
      弱化或对其他任务复用。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 6d4b8e2f-3c5a-4f7e-9b2d-1e3f5a7c9b0d
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK，远端仍如实非 PASS，不复用任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0147
  - python -m unittest scripts.harness.tests.test_harness
  - git diff --check
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。P3-01 是
> `docs/evidence/TASK-0109/zcode-remediation-handoff.md` §4.7 组 F 登记的 OPEN 审计项：
> `scripts/dev/openapi_tool.py` 已有 `validate`/`diff --fail-on-drift`，但 `.harness/commands.yaml`
> 与 `.github/workflows/ci.yml` 均未接入——OpenAPI 契约漂移没有任何自动门禁。

## 背景与用户可观察目标

P3-01（OpenAPI drift gate 未进 CI）现状：`scripts/dev/openapi_tool.py`（TASK-0023 建立）已有
确定性生成器与漂移门禁——`validate` 校验手写源 `specs/openapi/virtual-companion.yaml`，
`diff --fail-on-drift` 把临时生成物与提交的 `specs/openapi/dist/**` 逐字节比较、不一致即非零退出；
但该工具只在 TASK-0112 等个别卡作为 requiredCommands 手动执行，**没有注册进 canonical precheck
profile，CI 也不跑**——手改生成物或源/生成漂移可静默进入 main。

用户可观察结果：每次 canonical Precheck 自动执行 `openapiValidate` 与 `openapiDrift` 两个命令
（CI 经 `precheck.sh` 在全部平台继承），OpenAPI 源校验失败或生成物漂移时 precheck 非零退出、
失败关闭；新增注册契约测试锁定命令 argv，新增漂移阻断测试证明改动生成物即 FAIL。

## 范围内

- `.harness/commands.yaml`：新增两个命令并加入 precheck profile——
  `openapiValidate`（argv `[scripts/dev/openapi_tool.py, validate]`，timeoutSeconds 300）与
  `openapiDrift`（argv `[scripts/dev/openapi_tool.py, diff, --fail-on-drift]`，timeoutSeconds
  300）；precheck profile 从 5 命令扩为 7 命令；**不动 harnessPortabilityLocal profile**
  （TASK-0074..77 combined gate 的 exactCommandIds/canonicalCommandIds 语义保持不变）。
- `scripts/harness/tests/test_harness.py`：
  - 同步 `test_precheck_profile_keeps_each_canonical_gate_exactly_once` 的期望列表
    （加入 openapiValidate/openapiDrift）。
  - 新增 openapi 注册契约测试：commands.yaml 的 openapiValidate/openapiDrift argv 精确、
    precheck profile 包含二者、无重复。
  - 新增 OpenAPI drift 阻断测试：临时修改 `specs/openapi/dist` 生成物 →
    `openapi_tool.diff_generated(ROOT)` 非空（或 `diff --fail-on-drift` 非零退出），try/finally
    恢复原字节；以及 validate 对合法源 PASS。
- 唯一正式 Precheck（7 命令）、完整 Harness unittest、唯一 `git diff --check`、独立 C4 R1、
  pre-closure、push、fetch、clean 与远端 `0/0` 全部真实完成。

## 明确范围外

- 不修改 `scripts/dev/openapi_tool.py` 本体、`specs/openapi/**` 手写源或任何生成物
  （`specs/openapi/dist/**` 由工具确定性生成，禁止手改）。
- 不修改 `.github/workflows/ci.yml`（harness-full 已跑 precheck.sh，加入 profile 后自动继承；
  显式重复步骤是冗余）。
- 不修改 doctor.py（`CANONICAL_PRECHECK_COMMANDS` 校验为包含性，允许额外命令）、
  harnessPortabilityLocal profile、task-delivery-policy.yaml、ci-execution-policy.yaml。
- 不修改历史 Evidence/Handoff/Card/Context/Backlog 条目或任何历史 Git 对象。
- 不处理 P2-25/P2-27（Owner gate）、P3-02/P3-07、Provider DNS、数据库 Owner gates 或条件风险。

## 输入和前置条件

- Base `e6e6d1264f9b90254a137625f7a3824eabd6a0f9` 是 TASK-0146 单父 ACCEPTED terminal，已 push、
  fetch、`HEAD...origin/main=0/0` 且工作树 clean（post-terminal Doctor PASS，824152 checks）。
- 本卡 context lock 的 provenance 条目带 `provenanceOnly: true`，fingerprint `7c912181…` 基于
  Base 重新计算。
- 受控 Python 环境：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH` 前置；`openapi_tool.py`
  仅依赖标准库 + PyYAML（requirements-harness.txt 已锁定）。
- Owner 授权 provenance Hash 沿用 `cc0f91c1ddad24cb89128002439148384e4af8b6c8d056498ba8814a53580e95`。

## API / 事件 / 数据契约

不改变产品 API、事件或数据。命令注册表新增 `openapiValidate`/`openapiDrift`（argv 精确如上，
timeoutSeconds 300）；precheck profile 扩为 7 命令；`openapi_tool.py` 输出语义不变
（`OpenAPI validation: PASS` / `OpenAPI drift check: PASS`，drift 时 stderr 输出 `DRIFT:` 行并
非零退出）。不提供 CLI flag、环境变量 override、Git note/replace/graft 或可配置 allowlist。

## 状态机和失败行为

执行普通 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY Doctor 真实 PASS 后
进入实现；READY 后不得修改任务卡正文或不可变元数据。

OpenAPI 漂移失败关闭：`diff --fail-on-drift` 非零退出，precheck 计入 failures 并以非零退出；
drift 测试证明修改生成物即阻断。任何正式门禁非 PASS（READY Doctor、Reviewer、canonical
Precheck、完整 Harness、`git diff --check`、pre-closure、push/远端 0/0）或候选身份变化：立即
停止 promotion，如实 REJECTED（保留失败历史），按失败根因创建新卡从 DRAFT 起修正范围。

## 验收标准

- `.harness/commands.yaml` 含 `openapiValidate`（argv `[scripts/dev/openapi_tool.py, validate]`）
  与 `openapiDrift`（argv `[scripts/dev/openapi_tool.py, diff, --fail-on-drift]`），均带
  timeoutSeconds 300；precheck profile 恰好为 7 命令（doctor、catalogValidate、catalogDrift、
  paidFeatureCheck、betaRosterGate、openapiValidate、openapiDrift），无重复；harnessPortabilityLocal
  profile 字节不变。
- `test_precheck_profile_keeps_each_canonical_gate_exactly_once` 同步通过；新增 openapi 注册
  契约测试断言 argv 精确与 profile 包含。
- 新增 OpenAPI drift 阻断测试：修改 `specs/openapi/dist` 生成物后 `diff --fail-on-drift`
  非零退出（DRIFT 输出），恢复后干净树 `validate` 与 `diff --fail-on-drift` 均 PASS（exit 0）。
- 唯一正式 Precheck 7/7 PASS（含两个 openapi 命令）；完整 Harness unittest 全部通过（含新增
  测试）；唯一无参数 `git diff --check` PASS（输出空）；独立 C4 R1 PASS（阻塞 P0/P1 为零）。
- 终态 pre-closure PASS、单父 `[skip ci]` 提交、push 后 fetch 断言 `HEAD==origin/main`、tree
  一致、`0/0`、clean；remote exact-SHA 如实非 PASS（dispatchCount=0）。
- post-terminal Doctor 在最新终态通过，历史制品保持 byte-for-byte 不变。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。实现迭代只运行 `ValidationFlowTests` 与新增 openapi
测试（`python -m unittest scripts.harness.tests.test_harness.ValidationFlowTests ...`）作为迭代
证据，不冒充正式 Evidence；冻结候选后依次执行独立 Reviewer、唯一 Precheck、完整 Harness
unittest、唯一无参数 diff check、Evidence/Handoff 和唯一 pre-closure。Precheck 已覆盖的 canonical
子命令不重复；同一条 `git diff --check` 只执行一次。

## 回滚或前向修复

若任一正式门禁非 PASS：如实 REJECTED（保留失败历史与 Evidence），按失败根因创建新卡从 DRAFT
起修正范围（参考 TASK-0140/0141→0142、TASK-0145→0146 前向恢复模式）。若仅命令注册/断言漂移，
先核查 doctor.py 的包含性断言与 test_harness.py 的精确断言是否同步，再决定修复批次。

## 停止条件

- 正式 Precheck/完整 Harness/diff check/pre-closure 任一非 PASS 或候选身份变化：立即停止。
- Reviewer 出现阻塞 P0/P1 且超过允许的 1 个 fix batch 或 R2 后仍存在：REJECTED。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/门禁，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0147/`（evidence-pack.json、review-r1.md、pre-closure-request.json），
并生成 `docs/handoffs/TASK-0147.json`。
