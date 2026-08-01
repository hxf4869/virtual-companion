# TASK-0069：Harness 可移植性本地绿线与历史隔离永久恢复

```yaml
taskId: TASK-0069
state: READY
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: 1.3.0
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions: {}
baseCommit: 20193286d7bb566d2e433d80811f582572df61da
authorizationCommit: 56a31d55f0bdeb5ab71446d5a21b042015b290ca
contextFingerprint: 9f81e92a279de69dad41614c4ec4cc116bd1b33ef5c85fa029859adb4287d170
contextLock: docs/tasks/context/TASK-0069.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryMode: single-card
deliveryBudgets:
  candidateDeadlineMinutes: 45
  targetWallMinutes: 115
  hardFuseWallMinutes: 150
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: HARNESS_PORTABILITY_LOCAL_HISTORY_RECOVERY
  policySurfaces:
    - GOVERNANCE
    - AUTHORIZATION
    - HISTORY
  distinctCrossRiskSurfaces: 3
  reviewerMinutesEstimate: 8
  terminalCheckMinutesObserved: 46
  estimatedWallMinutes: 115
  thresholdsTriggered:
    - CROSS_RISK_SURFACES
    - TERMINAL_CHECK_MINUTES
    - ESTIMATED_WALL_MINUTES
  splitRequired: false
  ownerIndivisibleAuthorization: true
  indivisibleReason: >-
    Owner 将本卡明确授权为单一不可拆 C4 恢复；TASK-0067/0068 精确历史隔离、
    planning repair、TASK-0055 frontier 投影、远端 UNKNOWN 诚实状态与 durable
    helper LF 三域共同决定同一 HARNESS_PORTABILITY_LOCAL Commit/Tree 是否可被
    接受。拆分会留下未授权依赖、未隔离终态或必失败 exact-tree 候选。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0069
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
    javaHome: G:/ai/hxf/.tools/temurin-25.0.4+7/jdk-25.0.4+7
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0069
    kernel: 6.6.87.2-microsoft-standard-WSL2
    python: 3.12.3
    bash: 5.2.21
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机没有受控 macOS 环境，不声称 macOS PASS；获得受控 macOS exact-tree
      环境后，必须对同一冻结 profile 与候选身份重新执行。
  remote:
    outcome: UNKNOWN_NOT_RUN
    reasonType: OWNER_QUOTA_EVIDENCE_EXPIRED
    previousResetDate: "2026-08-01"
    billingProbeStatus: HTTP_404_UNVERIFIABLE
    currentQuotaVerified: false
    dispatchCount: 0
    staleIncludedUsedClaimForbidden: true
    passClaimed: false
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
  - docs/evidence/TASK-0066/**
  - docs/evidence/TASK-0067/**
  - docs/evidence/TASK-0068/**
  - docs/handoffs/TASK-0066.json
  - docs/handoffs/TASK-0067.json
  - docs/handoffs/TASK-0068.json
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
  - docs/tasks/TASK-0069-harness-portability-local-history-recovery.md
  - docs/tasks/context/TASK-0069.context-lock.yaml
  - docs/evidence/TASK-0069/**
  - docs/handoffs/TASK-0069.json
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
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/tasks/TASK-0067-durable-command-canonical-byte-domain-recovery.md
  - docs/tasks/TASK-0068-harness-portability-acceptance-recovery.md
  - docs/tasks/context/TASK-0066.context-lock.yaml
  - docs/tasks/context/TASK-0067.context-lock.yaml
  - docs/tasks/context/TASK-0068.context-lock.yaml
  - docs/evidence/TASK-0066/**
  - docs/evidence/TASK-0067/**
  - docs/evidence/TASK-0068/**
  - docs/handoffs/TASK-0066.json
  - docs/handoffs/TASK-0067.json
  - docs/handoffs/TASK-0068.json
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
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/durable_command.ps1
  - scripts/harness/precheck.py
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0066-local-fallback-recovery-permanent-replacement.md
  - docs/tasks/TASK-0067-durable-command-canonical-byte-domain-recovery.md
  - docs/tasks/TASK-0068-harness-portability-acceptance-recovery.md
  - docs/evidence/TASK-0066/evidence-pack.json
  - docs/evidence/TASK-0067/evidence-pack.json
  - docs/evidence/TASK-0068/evidence-pack.json
  - docs/handoffs/TASK-0066.json
  - docs/handoffs/TASK-0067.json
  - docs/handoffs/TASK-0068.json
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
    approvedAt: "2026-08-01"
    evidence: >-
      Owner 明确授权 TASK-0069 只前向完成 TASK-0067/0068 已保留路径级 LF
      与三文件恢复输入缺失的 Doctor、tests、历史隔离和投影修复；固定 0067/0068
      的真实 REJECTED 状态并在同一最终候选上闭环 Reviewer、Windows 与 WSL。
      不得修改 workflow、产品代码、TASK-0058、durable helper 本体或旧任务产物。
  - scope: task-0069-harness-portability-local-history-recovery
    approvedBy: repository-owner
    approvedAt: "2026-08-01"
    evidence: >-
      Owner 原话：“GitHub Actions 免费分钟耗尽不能让长线停下，必须有备用方案，
      例如本地跑或者不跑。”授权精确绑定 TASK-0069、Base
      20193286d7bb566d2e433d80811f582572df61da、Base Tree
      7413d1554167d951c226ab24ca5dde2eb9616970 与
      HARNESS_PORTABILITY_LOCAL：Windows 和 WSL2 Ubuntu-24.04 必须在同一
      精确候选 Commit/Tree 真实 PASS；macOS 只能 DEFERRED_NOT_CLAIMED；
      当前 GitHub 额度因 resetDate 已到且只读 billing 请求返回 404 而不可验证，
      只能 UNKNOWN_NOT_RUN、OWNER_QUOTA_EVIDENCE_EXPIRED、dispatch=0。
      不得泛化、复用、伪造 PASS、购买额度、改预算、公开仓库、添加 self-hosted
      runner、扩大 gh 权限、读取凭据或触发真实外发。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_policy_is_registered_and_fail_closed scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_policy_rejects_unknown_quota_downgrade_and_false_platform_pass scripts.harness.tests.test_harness.CiExecutionPolicyTests.test_task0069_remote_unknown_local_recovery_is_exact_and_fail_closed scripts.harness.tests.test_harness.DeliveryPolicyTests.test_policy_registry_skill_and_entrypoint_projection scripts.harness.tests.test_harness.DeliveryPolicyTests.test_durable_command_canonical_byte_domain_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0067_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0067_terminal_missing_reviewer_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0068_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0068_terminal_missing_reviewer_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0069_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_backlog_projection_exposes_idle_order_and_repository_blockers scripts.harness.tests.test_harness.IntegrationTests.test_doctor_accepts_current_task
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0069
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0069
```

## 背景与用户可观察目标

TASK-0067 保留了 durable helper 路径级 LF 修复，TASK-0068 又保留了 CI policy、
Backlog 与 TASK-0055 planning card 三文件恢复输入，但二者都在 Reviewer 前真实
REJECTED，历史隔离、Doctor/tests 与投影修复没有完成。本卡只封闭这一条恢复链，
让同一精确候选上的独立 Reviewer、Windows 与 WSL 本地验证真实通过。

## 范围内

- 将原始 0068 pre-closure 的 20 errors 和当前 terminal Base 的 23 errors 逐项
  映射到最小 Doctor 根因与 targeted tests；
- 对 TASK-0067 和 TASK-0068 的无 Reviewer 终态分别做固定 task/card、READY
  authority、terminal Commit/Tree、Evidence/Handoff、deadline 与 system-error
  精确隔离；其他 C4 仍必须有 structured Reviewer；
- 精确修复 TASK-0067、TASK-0068 已发生 planning repair 的授权与单父边观察，
  并新增只绑定 TASK-0069/Base/Owner/历史输入的一次性 recovery；
- 仅在 TASK-0069 合同成立后把 TASK-0055 唯一依赖从 TASK-0068 原子改为
  TASK-0069，重算六节 planningContractHash，保持 TASK-0055→TASK-0059 不变；
- 让 nextPromotable 停在 execution-order frontier TASK-0055：依赖 REJECTED
  时显式 blocked，不能跳到 TASK-0013；覆盖 idle、active、accepted 投影；
- 保留并验证 durable helper 的 Git Blob、Windows checkout、git archive
  三域同为 8819 bytes、236 LF、0 CRLF 与固定 SHA-256，覆盖去 override、
  CRLF、内容腐化、错误 Hash、错误路径负例；
- 将 GitHub 当前状态诚实记录为 UNKNOWN_NOT_RUN，保持 dispatch=0；通用远端
  调度和额度状态机仍归 TASK-0065。

## 明确范围外

- 修改 durable helper 本体、宽泛换行归一化、workflow、产品代码、TASK-0058、
  TASK-0056 至 TASK-0059；
- 重开、改写或把 TASK-0063/0064/0066/0067/0068 表示为 ACCEPTED；
- 实现 TASK-0065/TASK-0055/TASK-0013，或购买额度、改预算、公开仓库、添加
  self-hosted runner、扩大 gh 权限、读取凭据、真实外发；
- Provider、Persona、安全政策、身份、数据库、Beta 或第二套规则/计划/Evidence。

## 输入和前置条件

- Base Commit `20193286d7bb566d2e433d80811f582572df61da`，Tree
  `7413d1554167d951c226ab24ca5dde2eb9616970`；fetch 后
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean、
  `activeTask=null`、`lastTerminalTask=TASK-0068`；
- TASK-0068 last committed activity `101a3c7b5e711b3fcea049a60a8ed332149c4cc9`
  / Tree `5e160c07de7ab81a03c5007c7d3c10895a53bfa5` 只作恢复输入；
- 三文件恢复输入 SHA-256：`.harness/ci-execution-policy.yaml`
  `70de802d950fc329d8517b6772d1a73439038555ecb408a7f99f43a4d24cb281`、
  `.harness/task-backlog.yaml`
  `a82eab59828d2c4f8b2009a3263b47cce0a62f8b3ddbe87bbe6d164e79b50a66`、
  TASK-0055 card
  `1b449462ad10989256987b7d26315812c4dcb2929c6ce7568633dec76f9c4394`；
- TASK-0068 closure pre-closure inner exit 1、754.948s、20 errors、
  245221 checks，receipt
  `35766ac55593211942c99419a98ed0d01ea71199f8c1a73442622a0c867c82a4`；
- 当前 Base 的只读 Doctor summary inner exit 1、765.538s、23 errors、
  247053 checks，receipt
  `faaa8229e21faefc74d1ce43bba3480db02607a93f78006cd5a168cae04c850f`；
- DRAFT 前新鲜 durable exit-7 transport smoke inner exit 7，receipt
  `5bd46f9980fe62b0c901947607602a86134b9645e1a71f0db8b56673b49f387b`；
  transport smoke 与旧任务结果都不是候选 PASS。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增机器合同只描述固定历史
隔离、一次性 TASK-0069 恢复授权、永久替代边与真实本地验证结果。

## 权限、RLS 和数据处理要求

只处理治理元数据、离线 Git 对象、合成测试和本机命令输出；不读取凭据、真实用户
或模型数据，不访问真实供应商，不修改数据库、容器、账号、仓库权限或可见性。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED` 或
`REJECTED`。冻结前只实施；Reviewer 前仅运行一次 targeted matrix 与一次
`git diff --check` 并保存原子 receipt。R1 无 P0/P1 后依次只运行一次 Windows、
一次 WSL，失败立即停止；最多一批集中修复和同 Reviewer R2，不得有 R3。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套状态、规则、任务、计划、Evidence 或 Handoff。

## 验收标准

- 原始 20 errors 与当前额外 terminal-history errors 全部精确关闭；错误
  SHA/Tree/authority/artifact/deadline/system-error/repair edge/corruption/
  restore 均失败关闭；
- TASK-0055 只依赖 TASK-0069，六节 Hash 一致；0069 未 ACCEPTED 时
  nextPromotable 停在 blocked TASK-0055，精确接受投影后依次暴露
  TASK-0055→TASK-0059，TASK-0013 继续等待；
- durable helper 三域均为 8819 bytes、236 LF、0 CRLF、SHA-256
  `fca79cb77c2391e25bbac3144eae70ff9258eba15975a1a0eef3ca756d531180`；
- GitHub 为 `UNKNOWN_NOT_RUN / OWNER_QUOTA_EVIDENCE_EXPIRED / dispatch=0`，
  不是 PASS；macOS 为 `DEFERRED_NOT_CLAIMED`；
- 同一最终 Candidate Commit/Tree 上 targeted、diff、独立 Reviewer、Windows
  与 WSL 全部真实 PASS；
- Evidence/Handoff、唯一 pre-closure、terminal `[skip ci]`、push、
  `main == origin/main`、ahead/behind `0/0` 与 clean 全部真实闭环。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准。targeted matrix 与 diff check 通过
durable helper 各执行一次并保存完整 stdout/stderr/receipt/real exit；Windows
与 pre-closure 也各只启动一次。约 60 秒只检查 receipt 存在，发布后只读一次
receipt 与完整输出。WSL 从精确候选 `git archive` 到 Ubuntu `mktemp` 后只运行
一次；禁止 standalone Doctor/canonical 和重复 canonical 子命令。

## 回滚或前向修复

保持 `main`，不切分支、不建 worktree、不改写历史。最多一批集中修复和同一
Reviewer R2 delta；不得删测、加 skip、扩大 timeout、泛化例外或把非 PASS
转换为 PASS。

## 停止条件

- 45 分钟仍无通过冻结 targeted matrix 的精确 candidate；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- Windows/WSL 必需结果失败，或 candidate/receipt 身份无法精确绑定；
- 150 分钟达到 hard fuse 后只允许 Evidence/Handoff、一次 pre-closure、
  terminal commit、push 与 remote 0/0 的 closure-only overrun；
- 需要扩大白名单、修改 workflow/TASK-0058/产品、触发远端、读取凭据、扩权
  或付费。

## Evidence Pack

输出 `docs/evidence/TASK-0069/` 和 `docs/handoffs/TASK-0069.json`；PASS 只绑定
实际执行和精确 Commit/Tree，FAIL、NOT_RUN、UNKNOWN、DEFERRED 永不转为 PASS。
