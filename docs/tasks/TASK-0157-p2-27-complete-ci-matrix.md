# TASK-0157：P2-27 完整 CI 矩阵与 windowsJavaHome 解耦

```yaml
taskId: TASK-0157
state: READY
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
baseCommit: 4f7ac713008befcb7babd624e78dbe0e7773ae33
authorizationCommit: "c302d48d33b85c5b0b5b505dd88d7fa8890c64dc"
contextFingerprint: 592373e6f589f5d820590496014b481b56a9205e9ff4b28ea23087f75e20c6a8
contextLock: docs/tasks/context/TASK-0157.context-lock.yaml
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
  overallElapsed: {anchor: DRAFT_COMMIT, terminal: TERMINAL_COMMIT, recordingRequired: true, resetOranchorForbidden: true}
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrun: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0157_P2_27_COMPLETE_CI_MATRIX
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 35
  estimatedWallMinutes: 80
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0157
  - python -m unittest discover -s scripts/harness/tests -p "test_*.py"
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
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
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0156/evidence-pack.json
  - docs/evidence/TASK-0156/review-r1.md
  - docs/evidence/TASK-0160/evidence-pack.json
  - docs/evidence/TASK-0160/review-r1.md
  - docs/handoffs/TASK-0156.json
  - docs/handoffs/TASK-0160.json
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/TASK-0156-p2-03-auth-rate-limit-and-input-tightening.md
  - docs/tasks/TASK-0160-p2-03-auth-source-admission-test-fix.md
  - docs/tasks/task-card-template.md
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - owner-authorization://longline-2026-08-09
  - pom.xml
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - docs/tasks/TASK-0157-p2-27-complete-ci-matrix.md
  - docs/tasks/context/TASK-0157.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0157/**
  - docs/handoffs/TASK-0157.json
  - .harness/ci-execution-policy.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - .github/workflows/ci.yml
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
  - docs/tasks/TASK-0149-*
  - docs/tasks/TASK-0150-*
  - docs/tasks/TASK-0151-*
  - docs/tasks/TASK-0152-*
  - docs/tasks/TASK-0153-*
  - docs/tasks/TASK-0154-*
  - docs/tasks/TASK-0155-*
  - docs/tasks/TASK-0156-*
  - docs/tasks/TASK-0158-*
  - docs/tasks/TASK-0159-*
  - docs/tasks/TASK-0160-*
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
  - docs/tasks/context/TASK-0149.context-lock.yaml
  - docs/tasks/context/TASK-0150.context-lock.yaml
  - docs/tasks/context/TASK-0151.context-lock.yaml
  - docs/tasks/context/TASK-0152.context-lock.yaml
  - docs/tasks/context/TASK-0153.context-lock.yaml
  - docs/tasks/context/TASK-0154.context-lock.yaml
  - docs/tasks/context/TASK-0155.context-lock.yaml
  - docs/tasks/context/TASK-0156.context-lock.yaml
  - docs/tasks/context/TASK-0158.context-lock.yaml
  - docs/tasks/context/TASK-0159.context-lock.yaml
  - docs/tasks/context/TASK-0160.context-lock.yaml
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
  - docs/evidence/TASK-0149/**
  - docs/evidence/TASK-0150/**
  - docs/evidence/TASK-0151/**
  - docs/evidence/TASK-0152/**
  - docs/evidence/TASK-0153/**
  - docs/evidence/TASK-0154/**
  - docs/evidence/TASK-0155/**
  - docs/evidence/TASK-0156/**
  - docs/evidence/TASK-0158/**
  - docs/evidence/TASK-0159/**
  - docs/evidence/TASK-0160/**
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
  - docs/handoffs/TASK-0149.json
  - docs/handoffs/TASK-0150.json
  - docs/handoffs/TASK-0151.json
  - docs/handoffs/TASK-0152.json
  - docs/handoffs/TASK-0153.json
  - docs/handoffs/TASK-0154.json
  - docs/handoffs/TASK-0155.json
  - docs/handoffs/TASK-0156.json
  - docs/handoffs/TASK-0158.json
  - docs/handoffs/TASK-0159.json
  - docs/handoffs/TASK-0160.json
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
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_licenses.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - specs/**
  - service/platform/**
  - service/modules/**
  - service/adapters/**
  - service/tests/**
  - service/apps/**
  - service/**/safety/**
  - service/**/memory/**
  - service/**/modelruntime/**
  - service/platform/persistence/src/main/resources/db/migration/**
  - infra/**
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
  - .harness/tools.lock.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/handoffs/TASK-0160.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-004
  - INV-HARNESS-005
  - INV-HARNESS-007
  - INV-HARNESS-009
humanApprovals:
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权长线审计修复一次一张新卡推进。TASK-0157（P2-27 完整 CI 矩阵）：
      backend+frontend 三平台（ubuntu/windows/macos），database 保持 Linux-only；移除
      ci-execution-policy.yaml BACKEND_LOCAL.windowsJavaHome 硬编码 G:/ai/hxf/.tools/temurin-25.0.4+7
      改可配置（javaToolchain 声明字段）；同步 doctor.py 冻结断言；补 BACKEND_LOCAL/FRONTEND_LOCAL
      负向 unittest 门禁。C4 harness-change（.harness/** + scripts/harness/** + .github/workflows/**
      触发 protected-paths）+ humanApproval(scope: harness-change) + 独立 Reviewer。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-12 在本卡 EnterPlanMode 批准方案 A（javaToolchain 声明字段）：BACKEND_LOCAL 移除
      windowsJavaHome 硬编码路径 G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7（违反 INV-HARNESS-004
      跨平台可移植性），新增 javaToolchain: {distribution: temurin, versionLine: "25-LTS",
      resolver: ACTIONS_SETUP_JAVA} 声明字段，与 tools.lock.yaml runtime.java.versionLine 对齐。
      doctor.py 冻结断言改为禁止 windowsJavaHome 字段复活 + 强制 javaToolchain 校验。
      .github/workflows/ci.yml 的 backend+frontend job 改为 matrix（ubuntu/windows/macos），
      database 保持 ubuntu-only。新增 BACKEND_LOCAL/FRONTEND_LOCAL 负测（test_harness.py
      CiExecutionPolicyTests 类）。完整 Harness unittest + canonical precheck + R1 独立 Reviewer。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡
      重新冻结 LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用
      任何跨卡 Reviewer 或命令 PASS。
independentReview: required
reviewers: []
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 P2-27 审计修复卡
> （见 `docs/evidence/TASK-0109/zcode-remediation-handoff.md` 第 188 行 + 组 E 第 332-338 行）：
> 把 backend+frontend CI 矩阵扩到三平台，移除 BACKEND_LOCAL.windowsJavaHome 硬编码本机路径，
> 同步 doctor.py 冻结断言，并补 BACKEND_LOCAL/FRONTEND_LOCAL 负测门禁。

## 背景与用户可观察目标

P2-27（来自 TASK-0109 审计 48 项问题总表）要求修复"策略与跨平台 CI 分叉"：当前
`.harness/ci-execution-policy.yaml` 的 `BACKEND_LOCAL.windowsJavaHome` 硬编码具体本机路径
`G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7`，违反 `INV-HARNESS-004`（Windows/macOS/Linux
和 WSL wrapper 执行同一 Python Harness 实现）的可移植性。同时 `.github/workflows/ci.yml`
的 `backend` 和 `frontend` job 只在 `ubuntu-latest` 跑，而 policy 宣称 `[WINDOWS, LINUX]` 平台
范围，存在策略与 CI 分叉。`database` job 实际只在 Linux 跑且依赖 PostgreSQL 18 + pgvector
原生容器，保持 Linux-only 是合理产品边界。

`doctor.py:13108-13109` 当前断言 `backend.get("windowsJavaHome") ==
"G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7"`，把这一具体本机路径当 harness 契约冻结，
是历史缺陷（该路径来自某台 Windows 机器的本地 JDK 安装，不可移植）。
`scripts/harness/tests/test_harness.py` 完全没有覆盖 `BACKEND_LOCAL`/`FRONTEND_LOCAL` profile
（grep 0 命中），意味着这个硬编码断言从来没有负向测试保护。

`ci.yml` 的 backend/supply-chain job 已经通过 `actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3
distribution: temurin java-version: "25"` 在 runner 上动态解析 JDK，**完全不依赖
`windowsJavaHome` 字段**——这个字段是历史的"本地 Windows 跑 BACKEND_LOCAL profile"残留。
当前本地 exact-tree fallback 实际只跑 macOS 上的 `HARNESS_PORTABILITY_LOCAL` profile
（见 `ci-execution-policy.yaml:69-76`），Windows BACKEND_LOCAL profile 不是当前受支持场景。

用户可观察结果：
1. `BACKEND_LOCAL.windowsJavaHome` 字段从 `ci-execution-policy.yaml` 移除，新增
   `javaToolchain: {distribution: temurin, versionLine: "25-LTS", resolver: ACTIONS_SETUP_JAVA}`
   声明字段，与 `tools.lock.yaml runtime.java.versionLine: "25-LTS"` 对齐。
2. `doctor.py` 冻结断言改造：禁止 `windowsJavaHome` 字段复活 + 强制 `javaToolchain` 校验
   （distribution/versionLine/resolver 与 tools.lock 一致）。
3. `.github/workflows/ci.yml`：`backend` 和 `frontend` job 改为三平台 matrix
   （ubuntu/windows/macos）；`database` 保持 `ubuntu-latest`（Linux-only 显式注释）；
   `harness-full`/`harness-smoke`/`supply-chain` 不动。
4. `test_harness.py` 新增 5 个 BACKEND_LOCAL/FRONTEND_LOCAL 负向变体，覆盖：
   `windowsJavaHome` 复活、`javaToolchain` 缺失、`versionLine` 漂移、`resolver` 非受支持、
   `pnpmVersion` 漂移。
5. 终态治理闭环：canonical precheck + 完整 Harness unittest + git diff --check +
   独立 R1 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 范围内

1. **`.harness/ci-execution-policy.yaml`** BACKEND_LOCAL profile 改造：
   - 移除 `windowsJavaHome: G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7`。
   - 新增 `javaToolchain: {distribution: temurin, versionLine: "25-LTS", resolver: ACTIONS_SETUP_JAVA}`。
   - 保留：`affectedPaths`、`affectedModulesOnly: true`、`harnessGates: [WINDOWS, LINUX]`、
     `argvTemplate`、`modifySystemJava: false`。
   - FRONTEND_LOCAL/FULL_STACK_LOCAL/TERMINAL_METADATA_ONLY/HARNESS_PORTABILITY_LOCAL profile 不动。
2. **`scripts/harness/doctor.py`** 第 13091-13120 段冻结断言改造：
   - 移除 `backend.get("windowsJavaHome") == "G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7"`。
   - 新增：`"windowsJavaHome" not in backend`（防止字段复活）。
   - 新增：`backend["javaToolchain"]` 必须存在且 `distribution=="temurin"`、
     `versionLine=="25-LTS"`、`resolver=="ACTIONS_SETUP_JAVA"`，与 `tools.lock.yaml`
     `runtime.java.versionLine=="25-LTS"` 一致。
   - 保留：BACKEND_LOCAL argvTemplate/harnessGates/modifySystemJava、FRONTEND_LOCAL
     nodeVersion/pnpmVersion、FULL_STACK_LOCAL composeProfiles 等所有其它断言不变。
3. **`scripts/harness/tests/test_harness.py`** 在 `CiExecutionPolicyTests` 类（L2460）新增负向测试：
   按 L2473-2543 现有 `copy.deepcopy(load_yaml(policy_path)) → 修改 → assert audit.errors` 模式，
   新增 5 个 subTest 变体：
   - `backend["windowsJavaHome"] = "G:/ai/hxf/..."` 复活 → 失败
   - `backend.pop("javaToolchain")` 缺失 → 失败
   - `backend["javaToolchain"]["versionLine"] = "21-LTS"` 与 tools.lock 漂移 → 失败
   - `backend["javaToolchain"]["resolver"] = "LOCAL_PATH"` 非受支持 resolver → 失败
   - `frontend["pnpmVersion"] = "10.0.0"` 漂移 → 失败（顺便补 FRONTEND_LOCAL 覆盖）
4. **`.github/workflows/ci.yml`** CI 矩阵改造：
   - `backend` job：改为 `strategy.matrix.include: [ubuntu-latest/30min, windows-latest/30min, macos-latest/30min]`；
     `runs-on: ${{ matrix.os }}`；保留 `actions/setup-java@SHA` + `cache: maven`。
   - `frontend` job：同 matrix 三平台；保留 `pnpm/action-setup@SHA` + `actions/setup-node@SHA`。
   - `database` job：`runs-on: ubuntu-latest` 不变；`name` 注释明确
     "Database (PostgreSQL 18 + pgvector) — Linux-only reference platform"。
   - `harness-full`/`harness-smoke`/`supply-chain`：不动。
5. 终态治理闭环：canonical precheck + 完整 Harness unittest + git diff --check +
   独立 R1 + Evidence/Handoff/pre-closure/单父 [skip ci]/push/远端 0/0。

## 明确范围外

- 不动 `harness-full`（ubuntu-only reference platform）/ `harness-smoke`（windows+macos wrapper smoke）/
  `supply-chain`（SBOM/audit ubuntu-only）job。
- 不动 `HARNESS_PORTABILITY_LOCAL` profile 的三平台（windows/wslUbuntu/macos）冻结断言。
- 不动 `BACKEND_LOCAL.affectedPaths`（仍为 `pom.xml/mvnw/.mvn/**/service/**`）、
  `FRONTEND_LOCAL` 全部字段、`FULL_STACK_LOCAL` 全部字段。
- 不动 `skills/**`、`AGENTS.md`、`CLAUDE.md`、`.harness/task-delivery-policy.yaml`、
  `.harness/task-backlog.yaml`、`.harness/task-lifecycle.yaml`、`.harness/protected-paths.yaml`。
- 不引入新 Maven/pnpm 依赖（无 `license-inventory.yaml` 改动）。
- 不处理 RISK-09（TASK-0158）、P1-04/05、P2-12 等其它审计项。
- 不动 `service/**`、`infra/**`、`frontend/**` 源代码（`frontend/package.json` 仅作为
  R1 兼容性参考读取，不修改）。

## 输入和前置条件

- Base `4f7ac713008befcb7babd624e78dbe0e7773ae33` = TASK-0160 ACCEPTED terminal（已 push、0/0、clean；
  Doctor summary PASS 907841 checks；HEAD tree `58891a63...`）。
- 本卡 context lock 43 输入钉在 Base；provenance 条目
  `owner-authorization://longline-2026-08-09` provenanceOnly（沿用 hash `cc0f91c1...`）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。
- 完整 Harness unittest：`python -m unittest discover -s scripts/harness/tests -p "test_*.py"`
  （261+ tests，含新增 BACKEND_LOCAL/FRONTEND_LOCAL 负测，约 30-45 分钟）。
- canonical precheck：`python scripts/harness/precheck.py --task TASK-0157`
  （profile=precheck 8 子命令：doctor/catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck/
  betaRosterGate/openapiValidate/openapiDrift）。
- 远端 exact-SHA 通道仍配额耗尽（dispatchCount=0）；LOCAL_EXACT_TREE_FALLBACK profile=precheck
  限于 macOS 本地候选，远端如实非 PASS。

## API / 事件 / 数据契约

不涉及 API/事件/数据契约变更。纯 Harness 治理 + CI 配置 + unittest 门禁改造。

## 权限、RLS 和数据处理要求

不涉及数据库/RLS/用户数据。纯 Harness 配置和 CI workflow 改造。

## 状态机和失败行为

- 实现 = 4 个文件改动 + 5 个新增负向 unittest 变体；完整 Harness unittest 验证全部 261+ 测试通过。
- canonical precheck 8 子命令 PASS（doctor 会自动校验新 javaToolchain 断言与
  forbiddenPaths/writeAllowlist 零冲突、context fingerprint 一致等）。
- R1 阻塞 → 最多 1 fix batch → R2；R3 禁止。超 hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及。本卡纯治理/CI 改造，无模型/Prompt/记忆/安全面影响。

## 验收标准

1. `ci-execution-policy.yaml` BACKEND_LOCAL 含 `javaToolchain: {distribution: temurin,
   versionLine: "25-LTS", resolver: ACTIONS_SETUP_JAVA}`，不含 `windowsJavaHome` 键。
2. `doctor.py:13091-13120` 不再断言 `windowsJavaHome == "G:/ai/hxf/..."`；新增断言
   禁止 windowsJavaHome 复活 + 强制 javaToolchain 与 tools.lock.yaml 一致。
3. `test_harness.py` `CiExecutionPolicyTests` 类新增 5 个 subTest 变体（windowsJavaHome 复活、
   javaToolchain 缺失/漂移/resolver 错、pnpmVersion 漂移），全部 `assertTrue(audit.errors)`。
4. `ci.yml` backend 和 frontend job 都用 `strategy.matrix.include` 三平台
   （ubuntu-latest/windows-latest/macos-latest）；database 保持 `runs-on: ubuntu-latest`
   且 name 含 "Linux-only reference platform" 注释；harness-full/harness-smoke/supply-chain 不变。
5. 完整 Harness unittest（`python -m unittest discover -s scripts/harness/tests -p "test_*.py"`）
   PASS（261+ tests，0 failures，含新增 5 负测）。
6. 唯一 canonical precheck 8/8 PASS。
7. 唯一无参数 `git diff --check` PASS。
8. R1 独立复核 PASS（C4 必须；0 P0/P1/P2）。
9. 终态 pre-closure PASS、单父 [skip ci] 提交、push 后 HEAD==origin/main、0/0、clean；
   remote exact-SHA 如实非 PASS（dispatchCount=0，LOCAL_EXACT_TREE_FALLBACK 冻结于 READY）。
10. `INV-HARNESS-004`（跨平台可移植性）改善：移除了绑定某台 Windows 机器的硬编码路径。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准：
- canonical precheck 只跑一次（含 doctor/catalogValidate/catalogDrift/paidFeatureCheck/licenseCheck/
  betaRosterGate/openapiValidate/openapiDrift 8 子命令，不重复）；
- 完整 Harness unittest 跑一次（约 30-45 min，受保护路径内容变更必需）；
- 同一条无参数 `git diff --check` 只执行一次。

## 回滚或前向修复

若 R1 发现阻塞：最多 1 fix batch → R2；否则如实 REJECTED 并以新卡承接（需 Owner 授权）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰。
- 完整 unittest / canonical Precheck / diff check / pre-closure 任一非 PASS。
- 候选身份变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0157/`（evidence-pack.json、review-r1.md），并生成
`docs/handoffs/TASK-0157.json`。
