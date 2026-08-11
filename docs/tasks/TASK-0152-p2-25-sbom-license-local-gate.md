# TASK-0152：P2-25 SBOM/license 本地工具链 + 严重级阻断（修正卡）

```yaml
taskId: TASK-0152
state: ACCEPTED
terminalStateReason: >-
  P2-25 SBOM/license 本地工具链 + 严重级阻断完成并验证：新增 .harness/license-inventory.yaml
  （24 Maven 直接依赖 + 20 frontend 直接依赖 license family 预录，vite/vue-tsc=MIT）与
  scripts/harness/check_licenses.py（纯 Python gate：dependencyManagement 排除、exceptions
  到期语义 expiresAt>今天 生效、缺失/过期/格式错误 FAIL），commands.yaml 注册 licenseCheck 并加入
  precheck profile（8 命令，非 CANONICAL_PRECHECK_COMMANDS），test_harness.py 精确断言 8 命令 +
  licenseCheck 正例 + 3 负例场景，ci.yml 新增 supply-chain job（cyclonedx 2.9.1 makeAggregateBom
  → target/*.json 上传 + pnpm audit，SHA pinned）。INV-COST-001 license_scan 首次落地。前身
  TASK-0151 R1 FAIL（P0 缺 harness-change approval）经 Owner 授权 reset 摘除未推送链后重建，
  R1 PASS（0 P0/P1/P2，findings 全部闭合）。唯一 Precheck 8/8 PASS（doctor 710573）、唯一完整
  Harness unittest 277 tests OK、唯一 git diff --check PASS 在候选 06f4cef/89d6414；remote
  exact-SHA 如实非 PASS（dispatchCount=0），本卡只声明 READY 冻结的 LOCAL_EXACT_TREE_FALLBACK。
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
baseCommit: 26131834ce239608116f34cd87ce65a5750310f9
contextFingerprint: 3aa7fdd4cdc976477da15d25f06df832db0848dc67900f8ab0afd6d1d46dc703
contextLock: docs/tasks/context/TASK-0152.context-lock.yaml
authorizationCommit: 3656508351a8b2d6397b827203a6a75cc78110ea
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
  surfaceId: TASK_0152_SBOM_LICENSE_LOCAL_GATE
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 40
  estimatedWallMinutes: 85
  thresholdsTriggerled: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: LOCAL_EXACT_TREE_FALLBACK, profile: precheck}
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0152
  - git diff --check
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
  - docs/evidence/TASK-0150/evidence-pack.json
  - docs/evidence/TASK-0150/review-r1.md
  - docs/evidence/TASK-0150/review-r2.md
  - docs/handoffs/TASK-0150.json
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/check_paid_features.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/precheck.py
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - .github/workflows/ci.yml
  - pom.xml
  - frontend/package.json
  - service/platform/catalog/pom.xml
  - service/platform/persistence/pom.xml
  - service/modules/conversation/pom.xml
  - service/modules/modelruntime/pom.xml
  - service/modules/safety/pom.xml
  - service/adapters/model-anthropic/pom.xml
  - service/adapters/model-failure/pom.xml
  - service/adapters/model-fake/pom.xml
  - service/adapters/model-openai/pom.xml
  - service/apps/runtime/pom.xml
  - service/tests/anthropic-messages-contract-tests/pom.xml
  - service/tests/generation-contract-tests/pom.xml
  - service/tests/model-protocol-contract-tests/pom.xml
  - service/tests/openai-chat-completions-contract-tests/pom.xml
writeAllowlist:
  - docs/tasks/TASK-0152-p2-25-sbom-license-local-gate.md
  - docs/tasks/context/TASK-0152.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - .harness/commands.yaml
  - .harness/license-inventory.yaml
  - docs/evidence/TASK-0152/**
  - docs/handoffs/TASK-0152.json
  - scripts/harness/check_licenses.py
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
  - scripts/harness/doctor.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/precheck.ps1
  - scripts/harness/durable_command.ps1
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/check_beta_gate.py
  - specs/**
  - "**/db/migration/**"
  - "service/**/safety/**"
  - "service/**/memory/**"
  - "service/**/modelruntime/**"
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
  - .harness/license-policy.yaml
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - docs/evidence/TASK-0109/zcode-remediation-handoff.md
  - docs/evidence/TASK-0150/evidence-pack.json
  - docs/handoffs/TASK-0150.json
requiredInvariants:
  - INV-COST-001
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
      Owner 2026-08-11 明确授权 reset 摘除 TASK-0151 未推送链（参照 TASK-0145→0146 先例）并
      重建修正卡。TASK-0151 R1 FAIL P0 根因（DRAFT 缺 scope: harness-change humanApproval，
      READY 后不可修、REJECTED 死锁）已如实记录（review-r1.md 备份
      /tmp/vc-task0151-rejected-record/）。本卡 TASK-0152 = P2-25 SBOM/license 本地工具链 +
      严重级阻断（Owner 2026-08-11 决策"本地工具链 + 严重级阻断"，gate 落点"放进本地 precheck
      如果时间不长可以都跑"）。范围与 TASK-0151 相同并修复 R1 全部 P1/P2/P3：新增纯 Python
      licenseCheck（check_licenses.py + license-inventory.yaml 预录清单 + commands.yaml 注册 +
      precheck profile 8 命令）；CI 新增 supply-chain job（cyclonedx makeAggregateBom + pnpm
      audit + SBOM artifact，SHA pinned，上传路径 target/*.json）；负例测试补齐 3 场景（清单
      缺失、license 不在 allowlist、exception 格式校验）+ exceptions 到期语义；vite/vue-tsc
      license family 修正（MIT）；测试用 sys.executable；清理死代码。不改 pom.xml build/plugins、
      不动 harnessPortabilityLocal profile、不改 license-policy.yaml。工程细节按长线授权由实施者
      决定并如实记录；禁止历史改写和伪造 PASS。
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 2026-08-11 授权重建 TASK-0152（reset TASK-0151 后）。本卡修改 .harness/commands.yaml、
      .harness/license-inventory.yaml（新增）、scripts/harness/check_licenses.py（新增）、
      scripts/harness/tests/test_harness.py、.github/workflows/ci.yml 共 5 个 C4 protected 路径
      （harness-change 1.1.7 + humanApproval + 独立 Reviewer）。TASK-0151 R1 FAIL P0 即缺本 scope
      批准，本卡 DRAFT 阶段显式声明。变更内容：licenseCheck 纯 Python gate（<1s，INV-COST-001
      license_scan 首次落地）+ precheck profile 8 命令 + CI supply-chain job。不触碰
      harnessPortabilityLocal profile（TASK-0074..77 combined gate 语义）、不改 pom.xml
      build/plugins、不改 license-policy.yaml。工程细节按长线授权决定并如实记录。
  - scope: local-exact-tree-fallback
    approvedBy: repository-owner
    approvedAt: "2026-08-11"
    sourceThreadId: 2c8d4f6a-5e3b-4a9c-8d1f-3b5c7e9a2d4f
    evidence: >-
      Owner 要求长线继续推进；既有 includedMinutes=usedMinutes=2000、paidBudgetUsd=0、
      stopUsageEnabled=true、dispatchCount=0 与无 runner exact-SHA 事实保持不变。本卡重新冻结
      LOCAL_EXACT_TREE_FALLBACK（profile=precheck），远端仍如实非 PASS，不复用任何跨卡 Reviewer
      或命令 PASS。
independentReview: required
reviewers:
  - id: task0152_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 06f4cef
    candidateTree: 89d6414069e4a5c0684934d4162220ddff8ca55f
    evidencePath: docs/evidence/TASK-0152/review-r1.md
    reason: >-
      R1 完整复核 PASS：前身 TASK-0151 findings 全部闭合（P0 harness-change approval 现存在且
      doctor 实测 PASS；P1a exceptions 到期语义 + 3 负例场景；P1b SBOM 上传路径 target/*.json；
      P2 vite/vue-tsc=MIT、24+20 数字、sys.executable、无死代码；P3 managed 去重清理）；候选身份/
      指纹/范围/验收标准/INV-COST-001/INV-HARNESS 逐条核对；0 P0/P1/P2，2 个 P3 信息项。
```

## 背景

P2-25（license/SBOM 不覆盖传递依赖）是 48 项审计总表的 OWNER_GATE 项。Owner 2026-08-11 决策
"本地工具链 + 严重级阻断"（不付费 SaaS），gate 落点"放进本地 precheck"。TASK-0151（前身）R1
FAIL：P0 缺 `scope: harness-change` humanApproval（DRAFT 遗漏，READY 后不可修、REJECTED 死锁），
经 Owner 授权 reset 摘除未推送链后，本卡重建并修复 R1 全部 P1/P2/P3。

## 目标

建立确定性、本地可执行、<1s 的 license allowlist gate，接入 canonical precheck profile，使
INV-COST-001 的 `license_scan` enforcement 首次落地；同时在 CI 新增 supply-chain job 生成 SBOM
并执行 pnpm audit，为 Actions 配额恢复后的严重级漏洞阻断预留基础。

## 范围

### in

1. 新增 `.harness/license-inventory.yaml`：预录 Maven 直接依赖（15 外部 + 9 内部模块自引用 =
   24 Maven）和 frontend/package.json 直接依赖（6 dependencies + 14 devDependencies = 20
   frontend）的 license family；格式 `schemaVersion / mavenDirectDependencies[] /
   frontendDirectDependencies[] / exceptions[]`；内部模块标 INTERNAL；vite=MIT、vue-tsc=MIT
   （R1 P2 修正）。
2. 新增 `scripts/harness/check_licenses.py`：纯 Python（标准库 + PyYAML），仿 check_paid_features.py
   模式；读 license-policy.yaml allowlist + license-inventory.yaml 清单 + 解析所有 pom.xml 的
   `<dependencies>`（非 dependencyManagement）+ frontend/package.json；校验清单覆盖全部直接依赖
   且 license family 在 allowlist；exceptions 语义：`exceptions[]` 中每项含 dependency/
   licenseFamily/reason/expiresAt，未到期（expiresAt > 今天）的 exception 将其 licenseFamily
   纳入允许集合；违规 exit 1。清理 R1 P3 死代码（managed_deps 未使用、空循环）。
3. 修改 `.harness/commands.yaml`：注册 `licenseCheck` 命令（argv=`[scripts/harness/check_licenses.py]`，
   passTask=false, timeoutSeconds=120），加入 precheck profile（第 5 位）；不动 harnessPortabilityLocal
   profile。
4. 修改 `scripts/harness/tests/test_harness.py`：同步 precheck profile 精确断言（8 命令）；新增
   licenseCheck 正负例测试——正例（当前仓库 PASS）+ 负例 3 场景（清单缺失、license 不在
   allowlist、exception 格式校验/到期）；用 sys.executable（R1 P2 修正）。
5. 修改 `.github/workflows/ci.yml`：新增 `supply-chain` job（ubuntu-latest），cyclonedx-maven-plugin
   2.9.1 makeAggregateBom（输出 target/virtual-companion.json）+ 上传 SBOM artifact（path
   `target/*.json`，R1 P1b 修正）+ pnpm audit（--audit-level=high，continue-on-error informational
   首版）；所有 action SHA pinned。

### out

- 不改 pom.xml build/plugins（cyclonedx 经 CI 命令行调用）。
- 不改 license-policy.yaml（已有 allowlist 含 COMMUNITY_FREE_REVIEW_REQUIRED 足够）。
- 不动 harnessPortabilityLocal profile（TASK-0074..77 combined gate 语义）。
- 不将 licenseCheck 加入 doctor.py CANONICAL_PRECHECK_COMMANDS dict（argv 可演化，仿 openapi 先例）。
- 不做 trivy 漏洞扫描（需外部 DB 下载，CI 网络依赖重；留后续卡或 Owner 决策）。
- 不改 doctor.py（licenseCheck 非 canonical 自动通过 validate_command_registry）。

## 验收标准

1. `scripts/harness/check_licenses.py` 存在、可执行、纯 Python 标准库 + PyYAML；对当前仓库执行
   exit 0 并输出 `License inventory check: PASS (N direct dependencies)`。
2. `.harness/commands.yaml` 的 precheck profile 恰好包含 8 命令（doctor, catalogValidate,
   catalogDrift, paidFeatureCheck, licenseCheck, betaRosterGate, openapiValidate, openapiDrift），
   每命令恰好一次；harnessPortabilityLocal profile 字节不变（仍 6 命令）。
3. `scripts/harness/tests/test_harness.py` 的 precheck profile 精确断言同步为 8 命令；新增
   licenseCheck 正负例测试覆盖 3 场景（清单缺失、license 不在 allowlist、exception 格式校验）；
   测试用 sys.executable 调用。
4. `.github/workflows/ci.yml` 新增 supply-chain job，不影响现有 5 个 job；action SHA pinned；
   SBOM 上传路径 `target/*.json` 与 makeAggregateBom 实际输出一致。
5. `.harness/license-inventory.yaml` 覆盖全部直接依赖（24 Maven + 20 frontend），每项标注
   license family；内部模块标 INTERNAL；vite/vue-tsc 标 MIT。
6. canonical precheck 8 命令 PASS（含新 licenseCheck）；完整 Harness unittest PASS；唯一
   git diff --check PASS；LOCAL_EXACT_TREE_FALLBACK profile=precheck 在候选 Commit/Tree PASS。

## 失败行为

- 正式 Precheck 非 PASS → REJECTED（保留失败历史，不伪造成 PASS）。
- 独立 Reviewer R1 阻塞 P0/P1 → 最多 1 fix batch → R2；R2 仍阻塞 → REJECTED。
- 超出 hardFuseWallMinutes 90 → 立即停止实施，只允许 closure-only overrun。
- licenseCheck 对当前仓库非 exit 0 → 实现未完成，不得冻结候选。

## 停止条件

- writeAllowlist 外路径被修改。
- forbiddenPaths 被触碰。
- licenseCheck 无法在当前仓库 PASS（依赖 license family 无法归类到 allowlist）。
- 完整 Harness unittest 出现非 licenseCheck 相关的回归。
- 候选身份变化或越界。
