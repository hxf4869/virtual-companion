# TASK-0068：Harness 可移植性验收恢复与历史绿线永久后继

```yaml
taskId: TASK-0068
state: REJECTED
resolutionReason: >-
  本卡冻结 candidate 计时从 2026-07-31 18:38:42 +08:00 开始；
  candidateDeadlineMinutes=35 的边界为 19:13:42，hardFuseWallMinutes=125
  的边界为 20:43:42。恢复执行于 2026-08-01 14:25:31 +08:00 只读复核时
  才重新观察到仓库，分别已超出 69,109 秒和 63,709 秒。任务卡、
  task-delivery-flow Skill 与机器策略均没有 systemError 暂停计时例外，
  因此不得自行忽略 deadline。冻结 targeted matrix、独立 Reviewer、
  Windows/WSL exact-tree 和 candidate canonical 均未运行，不能声称 PASS；
  macOS 保持 DEFERRED_NOT_CLAIMED，GitHub Actions 保持 NOT_RUN_QUOTA、
  dispatch=0。保留中断时已有的三文件未验证 worktree 工作，精确记录其
  SHA-256，但它没有形成冻结 Candidate Commit/Tree，不能释放 TASK-0055；
  hard-fuse 恢复后只执行 Evidence/Handoff、一次 pre-closure、终态提交、
  push 与 remote 0/0 收口，故本卡按事实 REJECTED。
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: 0be905ab953975476802a5f1e0eef68b978635d2
authorizationCommit: 31c4937fbe576c2ada3682ab2269006b824bea82
contextFingerprint: b1a452ee281211a2276aad246917c8e6d8953575cfbe2dfa76f7f64d09a6a01d
contextLock: docs/tasks/context/TASK-0068.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryBudgets:
  candidateDeadlineMinutes: 35
  targetWallMinutes: 105
  hardFuseWallMinutes: 125
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: HARNESS_PORTABILITY_ACCEPTANCE_RECOVERY
  policySurface: GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 8
  terminalCheckMinutesObserved: 16
  estimatedWallMinutes: 105
  splitRequired: false
  indivisibleReason: >-
    TASK-0067 路径级 LF 字节域、其未完成的历史/Reviewer/projection 闭环、
    TASK-0067 到 TASK-0068 的一次性恢复授权以及 TASK-0055 原子重接共同决定
    同一 HARNESS_PORTABILITY_LOCAL 候选是否可被接受；拆开会留下必失败历史边、
    未授权依赖或未隔离的真实 REJECTED 终态。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0068
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
    javaHome: G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0068
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
  - docs/evidence/TASK-0064/**
  - docs/evidence/TASK-0066/**
  - docs/evidence/TASK-0067/**
  - docs/handoffs/TASK-0064.json
  - docs/handoffs/TASK-0066.json
  - docs/handoffs/TASK-0067.json
  - docs/schemas/**
  - docs/tasks/**
  - requirements-harness.txt
  - scripts/harness/**
  - skills/**
writeAllowlist:
  - .harness/ci-execution-policy.yaml
  - .harness/project-state.yaml
  - .harness/task-backlog.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0068-harness-portability-acceptance-recovery.md
  - docs/tasks/context/TASK-0068.context-lock.yaml
  - docs/evidence/TASK-0068/**
  - docs/handoffs/TASK-0068.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
forbiddenPaths:
  - .gitattributes
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
  - docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/tasks/TASK-0067-durable-command-canonical-byte-domain-recovery.md
  - docs/tasks/context/TASK-0064.context-lock.yaml
  - docs/tasks/context/TASK-0066.context-lock.yaml
  - docs/tasks/context/TASK-0067.context-lock.yaml
  - docs/evidence/TASK-0064/**
  - docs/evidence/TASK-0066/**
  - docs/evidence/TASK-0067/**
  - docs/handoffs/TASK-0064.json
  - docs/handoffs/TASK-0066.json
  - docs/handoffs/TASK-0067.json
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
  - docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/tasks/TASK-0067-durable-command-canonical-byte-domain-recovery.md
  - docs/evidence/TASK-0064/evidence-pack.json
  - docs/evidence/TASK-0066/evidence-pack.json
  - docs/evidence/TASK-0067/evidence-pack.json
  - docs/handoffs/TASK-0064.json
  - docs/handoffs/TASK-0066.json
  - docs/handoffs/TASK-0067.json
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
      Owner 明确授权 TASK-0068 只前向封闭 TASK-0067 的八项 canonical 历史、
      Reviewer 与投影错误，保留路径级 LF 字节域修复，并以最小机器真源、
      Doctor 和测试完成 HARNESS_PORTABILITY_ACCEPTANCE_RECOVERY；不得修改
      workflow、产品代码、TASK-0058、durable helper 本体或旧任务产物。
  - scope: task-0068-harness-portability-acceptance-recovery
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: >-
      Owner 原话：“GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，
      例如本地跑或者不跑。”该授权精确绑定 TASK-0068、Base
      0be905ab953975476802a5f1e0eef68b978635d2、Base Tree
      d0aeef9857e0fd2b366bebe7162bb282d94ec830 与
      HARNESS_PORTABILITY_LOCAL：Windows 和 WSL2 Ubuntu-24.04 必须在同一
      精确候选 Commit/Tree 真实 PASS；macOS 只能 DEFERRED_NOT_CLAIMED；
      GitHub Actions 只能 NOT_RUN_QUOTA、dispatch=0。不得泛化、复用、伪造
      PASS、购买额度、改预算、公开仓库、添加 self-hosted runner、读取凭据或
      触发真实外发。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_policy_is_registered_and_fail_closed scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_policy_rejects_unknown_quota_downgrade_and_false_platform_pass scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_durable_command_canonical_byte_domain_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0067_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0067_terminal_missing_reviewer_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0068_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.IntegrationTests.test_doctor_accepts_current_task
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0068
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0068
```

## 背景与用户可观察目标

TASK-0067 保留了路径级 LF 修复，但 candidate deadline 与平台 SYSTEM_ERROR
使 targeted、Reviewer、Windows 和 WSL 均未形成 PASS；其 REJECTED closure
又暴露八项历史与投影错误。本卡只前向封闭这些精确错误，并在新候选上完成
Reviewer、Windows 与 WSL 本地精确树验收。

## 范围内

- 精确隔离 TASK-0067 的空 Reviewer REJECTED 终态，只绑定其 Card、READY
  authority、terminal Commit/Tree、Evidence/Handoff、deadline 与 system-error
  历史；其他 C4 任务仍要求 structured Reviewer；
- 修正 TASK-0067 已发生 planning repair 的精确授权和单父边观察；
- 新增只绑定 TASK-0068/Base/Owner/历史失败输入的一次性 recovery，并建立
  TASK-0067 到 TASK-0068 的永久替代边；
- 仅在 TASK-0068 授权成立后把 TASK-0055 唯一依赖原子改为 TASK-0068，
  重算其六节 planningContractHash，保持 TASK-0055 到 TASK-0059 不变；
- 修正 nextPromotable 的 execution-order frontier 语义并覆盖 idle、active、
  accepted 投影；不得为消错直接晋级 TASK-0013；
- 保留并验证 durable helper 的 Git Blob、Windows checkout、git archive
  路径级 LF 同字节域，覆盖去 override、CRLF、内容腐化、错误 hash 与错误路径。

## 明确范围外

- 修改 durable helper 本体、全部 PowerShell 换行策略、workflow、产品代码、
  TASK-0058、TASK-0056 至 TASK-0059；
- 重开、改写或把 TASK-0063/0064/0066/0067 表示为 ACCEPTED；
- TASK-0065 的远端 dispatch、付费、预算、公开仓库、自托管 runner、凭据、
  真实外发、Persona、安全政策、身份、Beta 或 TASK-0055/TASK-0013 实现。

## 输入和前置条件

- Base Commit `0be905ab953975476802a5f1e0eef68b978635d2`，Tree
  `d0aeef9857e0fd2b366bebe7162bb282d94ec830`；fetch 后 main 与 origin/main
  相等、ahead/behind 0/0、index/worktree clean、activeTask=null；
- TASK-0067 retained candidate `627ab81c664fccc97c00473b852c5da7a39a00bb`
  / Tree `3cc7b5481d2e7a1e8dd8a04216b8b6f47584d824` 只作恢复输入；
- 0067 targeted 为 UNKNOWN_NOT_OBSERVED，Reviewer/Windows/WSL 为 NOT_RUN；
  closure pre-closure inner exit 1、8 errors、233193 checks，receipt
  `53d3de966de5e51386e400fc7228f10bd9b6789c5cdaff2be3d0729b2165b0c8`；
- DRAFT 前 durable exit-7 smoke 于 2026-07-31 18:38:42 +08:00 真实 PASS，
  inner exit 7，receipt SHA-256
  `cc3617be45c3acd8a2200132a7d81f75108ceae6790a05c234c8c617db3a12d1`；
  该结果只证明 transport，不是候选 PASS；
- 原计划可见 TASK-0068 任务约 18:34 启动后约 7 秒即 systemError，error=null，
  无 assistant/tool 证据；精确外部时间不可获得，不推断根因。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增合同只描述精确历史隔离、
一次性恢复授权、永久替代边与真实验证结果，不能成为其他任务或平台的 PASS 别名。

## 权限、RLS 和数据处理要求

只处理治理元数据、离线 Git 对象、合成测试与本机命令输出；不读取凭据、真实用户
或模型数据，不访问真实供应商，不修改数据库、容器、账号或仓库权限。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 或
`REJECTED`。Reviewer 前仅运行一次冻结 targeted matrix 和一次 diff check；
无阻断后依次仅运行一次 Windows、一次 WSL、一次 pre-closure。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Memory、安全政策、Persona 或产品能力，不建立第二套规则、
任务、计划、Evidence 或 Handoff。

## 验收标准

- 0067 八项历史/投影错误精确关闭，错误 SHA、Tree、authority、artifact、
  deadline/system-error 字段、repair edge、dependency 和 corruption/restore
  均失败关闭；
- TASK-0055 只依赖 TASK-0068，六节 Hash 一致，0068 未 ACCEPTED 时无
  nextPromotable，接受投影后依次暴露 0055 至 0059，TASK-0013 继续等待；
- durable helper 三域均为 8819 bytes、236 LF、0 CRLF、SHA-256
  `fca79cb77c2391e25bbac3144eae70ff9258eba15975a1a0eef3ca756d531180`；
- 同一最终候选上 Reviewer、Windows 与 WSL PASS；macOS
  DEFERRED_NOT_CLAIMED；GitHub NOT_RUN_QUOTA、dispatch=0；
- Evidence/Handoff、pre-closure、terminal `[skip ci]`、push、remote 0/0 和
  clean 全部真实闭环。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Windows 和 pre-closure 仅通过
已 smoke 的 durable helper 各启动一次；约 60 秒只检查 receipt 存在，发布后
只读一次 receipt 与完整 stdout/stderr。WSL 从精确候选 git archive 到 Ubuntu
mktemp 后仅运行一次。

## 回滚或前向修复

保持 main，不切分支、不建 worktree、不改写历史。最多一批集中修复和同一
Reviewer R2 delta；不得删测、加 skip、扩大 timeout、泛化例外或把非 PASS
转换为 PASS。

## 停止条件

- 35 分钟仍无通过冻结 targeted matrix 的精确 candidate；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- Windows/WSL 必需结果失败，或 candidate/receipt 身份无法精确绑定；
- 125 分钟达到 hard fuse 后只允许 Evidence/Handoff、一次 pre-closure、
  terminal commit、push 和 remote 0/0 的 closure-only overrun；
- 需要扩大白名单、修改 workflow/TASK-0058/产品、触发远端、读取凭据或付费。

## Evidence Pack

输出 `docs/evidence/TASK-0068/` 和 `docs/handoffs/TASK-0068.json`；PASS 只绑定
实际执行和精确 Commit/Tree，NOT_RUN、FAIL、UNKNOWN、DEFERRED 永不转为 PASS。
