# TASK-0067：Durable helper canonical 字节域恢复与本地双平台绿线

```yaml
taskId: TASK-0067
state: IN_REVIEW
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: b48984d1fbb61f809711f936066610576ad9426f
authorizationCommit: 35b93065dd760ffb698e315c703de7987e00165a
contextFingerprint: 5e11c9bb792efa7fe26440771283b5ba33f4ddaf5a931b95a3f92e35580792de
contextLock: docs/tasks/context/TASK-0067.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryBudgets:
  candidateDeadlineMinutes: 20
  targetWallMinutes: 85
  hardFuseWallMinutes: 105
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: HARNESS_PORTABILITY_CANONICAL_BYTES
  policySurface: GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesObserved: 14
  estimatedWallMinutes: 85
  splitRequired: false
  indivisibleReason: >-
    路径级 Git attribute、受治理 helper 的 Blob/checkout/archive 字节一致性、
    TASK-0066 到 TASK-0067 的一次性恢复授权，以及 TASK-0055 依赖重接共同决定
    同一 HARNESS_PORTABILITY_LOCAL 候选能否在 Windows 与 WSL 真实通过；拆开会
    留下一个必失败平台或一个未授权依赖投影。TASK-0055 仍只在本卡 ACCEPTED 后
    才可晋级，不构成第二实现风险面。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0067
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
    javaHome: G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0067
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
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/workflows/ci.yml
  - .harness/**
  - docs/evidence/TASK-0062/**
  - docs/evidence/TASK-0063/**
  - docs/evidence/TASK-0064/**
  - docs/evidence/TASK-0066/**
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
  - docs/handoffs/TASK-0064.json
  - docs/handoffs/TASK-0066.json
  - docs/schemas/**
  - docs/tasks/**
  - frontend/package.json
  - frontend/pnpm-lock.yaml
  - pom.xml
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .gitattributes
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0067-durable-command-canonical-byte-domain-recovery.md
  - docs/tasks/context/TASK-0067.context-lock.yaml
  - docs/evidence/TASK-0067/**
  - docs/handoffs/TASK-0067.json
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
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/tasks/context/TASK-0062.context-lock.yaml
  - docs/tasks/context/TASK-0063.context-lock.yaml
  - docs/tasks/context/TASK-0064.context-lock.yaml
  - docs/tasks/context/TASK-0066.context-lock.yaml
  - docs/evidence/TASK-0062/**
  - docs/evidence/TASK-0063/**
  - docs/evidence/TASK-0064/**
  - docs/evidence/TASK-0066/**
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
  - docs/handoffs/TASK-0064.json
  - docs/handoffs/TASK-0066.json
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
  - .gitattributes
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
  - docs/tasks/TASK-0063-authorization-history-greenline-recovery.md
  - docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/evidence/TASK-0063/evidence-pack.json
  - docs/evidence/TASK-0064/evidence-pack.json
  - docs/evidence/TASK-0064/review-r1-r2.md
  - docs/evidence/TASK-0066/evidence-pack.json
  - docs/evidence/TASK-0066/review-r1.md
  - docs/handoffs/TASK-0063.json
  - docs/handoffs/TASK-0064.json
  - docs/handoffs/TASK-0066.json
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
      Owner 明确授权 TASK-0067 只前向修复 scripts/harness/durable_command.ps1
      在 Git Blob、Windows checkout、git archive 与 WSL 解包之间的 canonical
      byte-domain 不一致，并以最窄路径级 LF attribute、Doctor、测试和必要机器
      真源闭环；不得修改 workflow、产品代码、TASK-0058 或旧任务冻结产物。
  - scope: task-0067-canonical-byte-domain-recovery
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: >-
      Owner 原话：“GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，
      例如本地跑或者不跑。”该授权精确绑定 TASK-0067、Base
      b48984d1fbb61f809711f936066610576ad9426f、Base Tree
      f660c9e1823285ac98d7c8824a519405f23db72c 与
      HARNESS_PORTABILITY_LOCAL 的一次性换行/归档哈希恢复：Windows 与 WSL2
      Ubuntu-24.04 必须在同一精确候选 Commit/Tree 真实 PASS；macOS 只能
      DEFERRED_NOT_CLAIMED；GitHub Actions 只能 NOT_RUN_QUOTA、dispatch=0。
      不得泛化、复用、伪造 PASS、购买额度、改预算、公开仓库、添加 self-hosted
      runner、读取凭据或触发真实外发。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_policy_is_registered_and_fail_closed scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_policy_rejects_unknown_quota_downgrade_and_false_platform_pass scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_durable_command_canonical_byte_domain_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0067_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.IntegrationTests.test_doctor_accepts_current_task
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0067
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0067
```

## 背景与用户可观察目标

TASK-0066 的精确候选已在 Windows 通过，但 WSL 从 `git archive` 解包后失败。
失败不是 helper 内容逻辑差异，而是 `.gitattributes` 的全局 PowerShell CRLF
导出规则把 LF-only Git Blob 改写为 CRLF archive entry，使冻结 SHA 门禁按事实
失败。本卡只修复该 canonical 字节域，并以新的永久 ID 重新授权和验证本地
fallback；成功后 TASK-0055 的唯一依赖改为 ACCEPTED 的 TASK-0067。

## 范围内

- 为 `scripts/harness/durable_command.ps1` 增加精确路径级 `text eol=lf`，
  保持其他 PowerShell 文件的 CRLF 策略不变；
- 让 Doctor 对受治理 helper 的有效 attribute、Git index Blob、当前 checkout
  和 index-tree `git archive` entry 做不归一化的精确字节与 SHA 校验；
- 增加 LF 正例，以及 CRLF、非换行内容腐化、错误 attribute、错误 expected hash
  负例，证明换行规则不会掩盖其他字节腐化；
- 在 CI 执行真源中增加只绑定 TASK-0067/Base/Owner 授权/旧失败哈希的一次性
  recovery 记录，不复用 TASK-0066 的结果；
- 新增 TASK-0066 → TASK-0067 唯一永久替代历史，并仅把 TASK-0055 依赖从
  TASK-0066 原子重接到 TASK-0067，重算其六节规划投影 Hash；
- 保持 TASK-0055 → TASK-0056 → TASK-0057 → TASK-0058 → TASK-0059 不变，
  且本卡 ACCEPTED 前不暴露 TASK-0055 为可晋级。

## 明确范围外

- TASK-0065 的 GitHub 显式 dispatch、额度治理或远端能力；
- `.github/workflows/**`、产品代码、TASK-0058、TASK-0056～TASK-0059；
- 重跑、重开、回写或改写 TASK-0063/TASK-0064/TASK-0066；
- 修改 `durable_command.ps1` 内容、把全部 `.ps1` 改为 LF、移除或跳过 hash
  校验、先归一化后放弃原始字节校验；
- 付费、改预算、公开仓库、自托管 runner、凭据、真实供应商、真实外发、
  Persona、安全政策、身份、Beta、TASK-0055/TASK-0013 实现或晋级；
- 大型 helper/orchestrator、第二套规则、任务、计划、Evidence 或 Handoff。

## 输入和前置条件

- Base Commit `b48984d1fbb61f809711f936066610576ad9426f`，Tree
  `f660c9e1823285ac98d7c8824a519405f23db72c`；fetch 后
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean；
- `activeTask=null`、`lastTerminalTask=TASK-0066`，0063/0064/0066 均继续
  REJECTED；TASK-0065 保留，TASK-0055 仅依赖 REJECTED TASK-0066；
- 原始候选 `46ba60fda712ec88a1a6156682a3e63fa787348d` / Tree
  `28c95c0337cf35e36c930b30fd61636e31a6f61e` 只作恢复输入，不复用 PASS；
- 0064 Windows FAIL、0066 Windows PASS、0066 WSL FAIL receipt SHA-256
  分别为 `e1864721b9c9b0e740af78ff89f23288d59c3551084735118a358c537fddcf9f`、
  `5e27c275fccf933ec8c886a7c5a20c659e2168efa642e2750f5a07066f827373`、
  `1b82e6d6ee7092ea52809bc917c629dbc5c44ea856a36d7e71186474b5ae9da9`；
- DRAFT 前 exit-7 transport smoke 真实通过；唯一 attributes/archive probe
  复现 Blob/checkout `8819 bytes, 236 LF, 0 CRLF, fca79c…` 与 archive
  `9055 bytes, 236 CRLF, 85e569…`，并实证路径级 `eol=lf` 恢复同一字节。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增机器合同仅描述精确
canonical 字节域、一次性恢复授权、永久替代边与实际验证结果；不能成为其他
任务、Commit、Tree、平台或命令的 PASS 别名。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、离线 Git 对象、合成测试与本机命令输出；不读取凭据、
真实用户或模型数据，不访问真实供应商，不修改数据库、服务、账号、容器、
仓库可见性或权限范围。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 或
`REJECTED`。READY 前冻结 Base、Context、预算、授权、profile、平台身份、命令、
白名单与停止条件；后续只允许生命周期字段变化。

顺序固定为唯一 targeted matrix 与一次 `git diff --check` → candidate
Commit/Tree → `fork_turns=none` 独立 R1 → 可选一批集中修复和同一 Reviewer
R2 delta → Windows exact-candidate 一次 → Windows PASS 后 WSL exact-candidate
一次 → 唯一 pre-closure → terminal `[skip ci]` commit/push/remote 0/0。
任一必需平台失败立即触发停止条件，未运行平台如实记录 NOT_RUN。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套规则、状态或交付制品。所有 durable request/stdout/stderr/receipt 只位于
系统 TEMP；WSL 只使用精确候选 archive 的 Ubuntu `mktemp` 隔离目录。

## 验收标准

- `.gitattributes` 保留 `*.ps1 text eol=crlf`，仅以更具体规则把受治理 helper
  固定为 LF；Git Blob、Windows checkout、git archive entry 都是
  `8819 bytes / 236 LF / 0 CRLF /
  fca79cb77c2391e25bbac3144eae70ff9258eba15975a1a0eef3ca756d531180`；
- Doctor 不做语义换行归一化，CRLF、非换行字节腐化、错误 attribute 或错误
  expected hash 任一出现都失败关闭；
- TASK-0067 recovery 只接受固定 Base/Tree、READY authority、两条精确 Owner
  批准、旧候选与三份 receipt Hash；错误 scope/Base/authority/hash/复用标志失败；
- TASK-0066 → TASK-0067 替代边唯一、强类型、单父且精确；TASK-0055 唯一依赖
  TASK-0067，六节投影与 planningContractHash 一致；
- 0067 未 ACCEPTED 时 `nextPromotable` 不是 0055；精确 ACCEPTED 投影依次暴露
  0055→0056→0057→0058→0059，TASK-0013 继续等待；
- 同一最终 candidate Commit/Tree 上 Windows 与 WSL PASS；macOS
  `DEFERRED_NOT_CLAIMED`；GitHub Actions `NOT_RUN_QUOTA`、dispatch=0；
- Reviewer、pre-closure、Evidence/Handoff、terminal `[skip ci]`、push、
  `main == origin/main`、ahead/behind `0/0`、clean 全部真实闭环。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只执行一次冻结
targeted matrix 和一次 diff check。Windows 与 pre-closure 通过已 smoke 的
durable helper 各启动一次，约 60 秒只检查 receipt 是否存在；发布后只读一次
receipt 与完整 stdout/stderr。WSL 从精确候选 `git archive` 到 Ubuntu
`mktemp` 后只运行一次。

## 回滚或前向修复

保持 `main`，不切分支、不建 worktree、不重写历史。最多一批集中修复，不删测、
不加 skip、不扩大 timeout、不泛化 SHA/历史/当前任务例外，不修改冻结 profile，
不把非 PASS 状态降级为 PASS。

## 停止条件

- 20 分钟仍无通过冻结 targeted matrix 的精确 candidate；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- Windows/WSL 必需结果失败，或 candidate identity/receipt 不能精确绑定；
- 105 分钟达到 task-specific hard fuse：立即停止实现、修复、Reviewer 与验证，
  只允许 Evidence/Handoff、唯一 pre-closure、terminal commit、push、remote
  0/0 的 closure-only overrun，并据实 REJECTED；
- 需要扩大白名单、修改 workflow/TASK-0058/产品代码、触发远端、读取凭据、
  付费或进入其他 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0067/` 并生成
`docs/handoffs/TASK-0067.json`；PASS 必须绑定实际执行和精确 SHA/Tree，
NOT_RUN、FAIL、UNKNOWN 与 DEFERRED_NOT_CLAIMED 永不转换为 PASS。
