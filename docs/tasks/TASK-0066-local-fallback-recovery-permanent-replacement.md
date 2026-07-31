# TASK-0066：本地精确树恢复永久替代与历史绿线封闭

```yaml
taskId: TASK-0066
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: 9bdf716a85c874bbf8df9e72fb9533b524682365
authorizationCommit: ""
contextFingerprint: cdd1931fbcde572690ab1a927eb5f0b9eef66dc8ecbbcc0239459bb3e28e527d
contextLock: docs/tasks/context/TASK-0066.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryBudgets:
  candidateDeadlineMinutes: 25
  targetWallMinutes: 80
  hardFuseWallMinutes: 110
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: HARNESS_PORTABILITY_LOCAL_RECOVERY
  policySurface: GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 10
  terminalCheckMinutesObserved: 15
  estimatedWallMinutes: 80
  splitRequired: false
  indivisibleReason: >-
    TASK-0064 Windows canonical 暴露的 backlog repair、TASK-0063 历史终态与
    promotion projection 三个错误簇共同决定同一 HARNESS_PORTABILITY_LOCAL
    候选能否通过；任意拆分都会让另一簇继续使完整 profile 失败。TASK-0055
    依赖重接只在本恢复卡合同已授权后发生，是同一永久替代结果的原子规划投影。
validationPlan:
  frozenBefore: READY
  policySource: .harness/ci-execution-policy.yaml
  selectedChannel: LOCAL_EXACT_TREE_FALLBACK
  profile: HARNESS_PORTABILITY_LOCAL
  candidateBinding:
    commitAndTreeRequired: true
    cleanWorktreeAndIndexRequired: true
    rerunAfterInputChange: true
  windows:
    requiredOutcome: PASS
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0066
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
    javaHome: G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0066
    kernel: 6.6.87.2-microsoft-standard-WSL2
    python: 3.12.3
    bash: 5.2.21
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机无受控 macOS 环境，不声称 macOS PASS；获得受控 macOS exact-tree
      环境后，须对同一冻结 profile 和候选身份重新执行。
  remote:
    outcome: NOT_RUN_QUOTA
    reasonType: OWNER_SUPPLIED_QUOTA_EXHAUSTED
    includedMinutes: 2000
    usedMinutes: 2000
    paidBudgetUsd: 0
    stopUsageEnabled: true
    resetDate: "2026-08-01"
    dispatchCount: 0
  terminalMetadataOnly:
    requiredCommitMarker: "[skip ci]"
    implementationTreeMustRemainVerified: true
    neverRepresentsCiPass: true
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/evidence/TASK-0062/**
  - docs/evidence/TASK-0063/**
  - docs/evidence/TASK-0064/**
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
  - docs/handoffs/TASK-0064.json
  - docs/schemas/**
  - docs/tasks/**
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - pom.xml
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/tasks/context/TASK-0066.context-lock.yaml
  - docs/evidence/TASK-0066/**
  - docs/handoffs/TASK-0066.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/TASK-0063-authorization-history-greenline-recovery.md
  - docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md
  - docs/tasks/context/TASK-0062.context-lock.yaml
  - docs/tasks/context/TASK-0063.context-lock.yaml
  - docs/tasks/context/TASK-0064.context-lock.yaml
  - docs/evidence/TASK-0062/**
  - docs/evidence/TASK-0063/**
  - docs/evidence/TASK-0064/**
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
  - docs/handoffs/TASK-0064.json
  - docs/schemas/**
  - docs/tasks/task-card-template.md
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - requirements-harness.txt
  - skills/**
  - specs/**
  - service/**
  - frontend/**
  - db/**
  - deploy/**
  - ops/**
  - docs/source/**
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
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/TASK-0063-authorization-history-greenline-recovery.md
  - docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md
  - docs/evidence/TASK-0062/evidence-pack.json
  - docs/evidence/TASK-0062/review-r1.md
  - docs/evidence/TASK-0063/evidence-pack.json
  - docs/evidence/TASK-0064/evidence-pack.json
  - docs/evidence/TASK-0064/review-r1-r2.md
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
  - docs/handoffs/TASK-0064.json
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
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: >-
      Owner 明确要求 TASK-0066 在不回写 TASK-0064、不修改 workflow、产品代码
      或 TASK-0058 的前提下，前向修复 Windows exact-candidate canonical 暴露
      的全部失败，并以最小机器真源、Doctor 与测试完成 C4 Harness 恢复。
  - scope: task-0066-local-fallback-recovery
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: >-
      Owner 原话：“GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，
      例如本地跑或者不跑。”该授权只绑定 TASK-0066、Base
      9bdf716a85c874bbf8df9e72fb9533b524682365 和 HARNESS_PORTABILITY_LOCAL：
      Windows 与 WSL2 Ubuntu-24.04 必须在同一精确候选 Commit/Tree 真实 PASS；
      macOS 只能 DEFERRED_NOT_CLAIMED；GitHub Actions 因 2,000/2,000、0 美元
      Stop usage 记 NOT_RUN_QUOTA 且 dispatch=0。一次性预算为 candidate 25、
      target 80、hard fuse 110 分钟。该证据不得泛化、复用、伪造 PASS、付费、
      公开仓库、添加 self-hosted runner、读取凭据或触发真实外发。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.CiExecutionPolicyTests scripts.harness.tests.test_harness.DeliveryPolicyTests scripts.harness.tests.test_harness.BacklogTests.test_task0012_owner_amendment_real_history_edge_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0062_rejected_authorization_projection_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0063_terminal_missing_reviewer_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0064_replacement_authority_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0066_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.IntegrationTests.test_command_registry_is_consumed_without_shell_commands
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0066
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0066
```

## 背景与用户可观察目标

TASK-0064 保留了本地 exact-tree fallback 实现，但其唯一 Windows canonical 真实
失败并已 REJECTED。TASK-0066 在新的精确 Base 和 Owner 一次性授权下，只前向
封闭该运行暴露的 0055 repair、0063 missing-reviewer 历史与 promotion 投影错误。
完成后，本地 fallback 在精确 TASK-0066 候选上取得 Windows/WSL PASS，且
TASK-0055 只有在 TASK-0066 ACCEPTED 后才可晋级。

## 范围内

- 修正 TASK-0064 已发生 repair 边的强类型批准识别，不改写该历史；
- 为 TASK-0063 无 Reviewer 的真实 REJECTED 终态增加固定 Commit、Tree、
  authorization projection 与冻结产物绑定的精确隔离；
- 新增 TASK-0064 → TASK-0066 唯一永久替代投影，并在合同授权后把
  TASK-0055 唯一依赖原子重接到 TASK-0066、重算六节 planning contract Hash；
- 修正 backlog projection 的阶段语义：0066 未 ACCEPTED 时不暴露 0055，
  精确接受投影中暴露 0055；
- 在现有 CI 执行真源中增加仅绑定 TASK-0066/Base 的一次性 recovery 记录；
- 为错误 SHA、Tree、authority、dependency、产物腐化与错误后恢复补充负例。

## 明确范围外

- TASK-0065 的 GitHub 显式 dispatch、配额调度或远端能力；
- `.github/workflows/**`、产品代码、TASK-0058 与 TASK-0056～TASK-0059；
- 回写、重开或把 TASK-0064/TASK-0063 表示为 ACCEPTED；
- 付费、公开仓库、自托管 runner、凭据、真实供应商、真实外发、Persona、
  安全政策、身份、Beta、TASK-0055/TASK-0013 实现或晋级；
- 大型 orchestrator/helper、第二套规则/计划/Evidence/Handoff。

## 输入和前置条件

- Base Commit `9bdf716a85c874bbf8df9e72fb9533b524682365`，Tree
  `57718eefe312c5048e8a334f96bbd22506b4315d`；fetch 后
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean；
- `activeTask=null`、`lastTerminalTask=TASK-0064`，TASK-0064 继续 REJECTED；
- TASK-0064 保留候选 `e28d147351f944a440faef6ff6e38a3d72649459` /
  Tree `c73bb8c8f706353d750e09a8a9faf8d43c966bec` 只作恢复输入；
- TASK-0064 原始 receipt/stdout/stderr 已各读取一次，SHA-256 分别为
  `e1864721b9c9b0e740af78ff89f23288d59c3551084735118a358c537fddcf9f`、
  `97262dedd0430e2eb20d3f463321a93e8242b5024457a68a3042246a222e2b6d`、
  `7b7f2998a285c97531c75b21479ed588c672ffc2b760802ef105b8ce44de70b0`；
- 新鲜 PowerShell 7 durable exit-7 smoke 真实 PASS，receipt SHA-256
  `47d4022ddcd2d1db5e6ba56baf022cb2e87286b4b51f50c733b0ef7dac8d4122`，
  该结果只证明 transport，不是候选 PASS；
- 固定 Temurin JDK 25 路径仅用于本任务环境，不修改系统 Java。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增合同只表达精确历史隔离、
一次性恢复授权、永久替代边和本地验证结果，不能成为其他任务或平台的 PASS 别名。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、离线 Git 历史、合成测试与本机命令输出；不读取凭据、
真实用户或模型数据，不访问真实供应商，不修改数据库、服务、账号、容器、
仓库可见性或权限范围。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 或
`REJECTED`。READY 前冻结 Base、Context、预算、授权、profile、平台身份、命令、
白名单与停止条件；后续仅允许生命周期字段变化。

顺序固定为唯一 targeted matrix 与一次 `git diff --check` → candidate Commit/Tree
→ fork_turns=none 独立 R1 → 可选一批修复和同一 Reviewer R2 delta →
Windows exact-candidate 一次 → Windows PASS 后 WSL exact-candidate 一次 →
唯一 pre-closure → terminal `[skip ci]` commit/push/remote 0/0。
Windows 失败则 WSL 记 `NOT_RUN_DUE_STOP_CONDITION`；任何身份变化均使结果失效。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套规则、任务、计划、ADR、Evidence、Handoff 或客户端入口。

## 验收标准

- TASK-0064 已发生 repair 边只在通用 `harness-change` 与精确 bootstrap 两条
  Owner 记录同时匹配时被观察；错误 scope、Base、authority 或 SHA 均失败；
- TASK-0063 仅以固定 terminal Commit/Tree、READY authority projection、
  REJECTED 状态、空 Reviewer、Evidence/Handoff 和冻结产物 Hash 隔离；
  任一腐化或另一 C4 无 Reviewer 均继续失败；
- TASK-0064 → TASK-0066 永久替代边唯一、强类型、单父且精确；
  TASK-0055 唯一依赖 TASK-0066，六节投影与 Hash 一致；
- 0066 未 ACCEPTED 时 `nextPromotable` 不得为 0055；精确 ACCEPTED 投影中
  依次暴露 0055→0056→0057→0058→0059，TASK-0013 继续等待；
- 冻结 targeted matrix 覆盖全部原始六项 Doctor 错误、两项 Harness 失败和
  SHA/Tree/authority/dependency/corruption/restore 负例；
- 同一最终 candidate Commit/Tree 上 Windows 与 WSL PASS；macOS
  `DEFERRED_NOT_CLAIMED`；GitHub Actions `NOT_RUN_QUOTA`、dispatch=0；
- Reviewer、pre-closure、Evidence/Handoff、terminal `[skip ci]`、push、
  `main == origin/main`、ahead/behind `0/0`、clean 全部真实闭环。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行一组 targeted
matrix 和一次 diff check。Windows 与 pre-closure 通过已 smoke 的 durable helper
各启动一次，约 60 秒只检查 receipt 是否存在；发布后只读一次 receipt 与完整
stdout/stderr。WSL 从精确候选 `git archive` 到 Ubuntu `mktemp` 后只运行一次。

## 回滚或前向修复

保持 `main`，不切分支、不建 worktree、不重写历史。最多一批集中修复，不删测、
不加 skip、不扩大 timeout、不泛化 SHA 例外、不修改冻结 profile 或把非 PASS
状态降级为 PASS。

## 停止条件

- 25 分钟仍无通过冻结 targeted matrix 的精确 candidate；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- Windows/WSL 必需结果失败，或 candidate identity/receipt 不能精确绑定；
- 110 分钟达到 task-specific hard fuse：立即停止实现、修复、Reviewer 与验证，
  只允许 Evidence/Handoff、唯一 pre-closure、terminal commit、push、remote
  0/0 的 closure-only overrun，并据实 REJECTED；
- 需要扩大白名单、修改 workflow/TASK-0058/产品代码、触发远端、读取凭据、
  付费或进入其他 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0066/` 并生成
`docs/handoffs/TASK-0066.json`；PASS 必须绑定实际执行和精确 SHA/Tree，
NOT_RUN、FAIL、UNKNOWN 与 DEFERRED_NOT_CLAIMED 永不转换为 PASS。
