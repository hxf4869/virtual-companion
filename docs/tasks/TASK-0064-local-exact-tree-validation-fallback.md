# TASK-0064：本地精确树验证备用通道与交付绿线恢复

```yaml
taskId: TASK-0064
state: IN_REVIEW
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-intake
  - harness-change
requiredSkillVersions:
  task-intake: 1.2.0
  harness-change: 1.1.0
targetSkillVersions:
  task-delivery-flow: 1.3.0
baseCommit: 8af24aba6225104833b4d5845a77bbe7e513eed7
authorizationCommit: 135453c30d34ad98d4424fa577757635e4fcf22d
contextFingerprint: 8c9de692a0a5555a62f9a9302ae12a0b2666d87dec17df287b2eb2e83b46e166
contextLock: docs/tasks/context/TASK-0064.context-lock.yaml
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
deliveryBudgets:
  candidateDeadlineMinutes: 45
  targetWallMinutes: 60
  hardFuseWallMinutes: 90
  maximumFixBatches: 1
  maximumReviewRounds: 2
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: DELIVERY_GREENLINE_FALLBACK
  policySurface: GOVERNANCE
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesObserved: 20
  estimatedWallMinutes: 60
  splitRequired: false
  indivisibleReason: >-
    Base canonical 的 TASK-0062 精确历史错误和真实 authorizationAmendments
    bootstrap 错误必须先清除，本地精确树备用通道才可能取得真实 PASS；反向地，
    GitHub Actions 额度耗尽时，该备用通道又是当前绿线恢复唯一可验收路径。
    两部分共同构成一个 DELIVERY_GREENLINE_FALLBACK 治理面，拆开任一半都不能
    独立交付 ACCEPTED。TASK-0055 重接只是永久替代结果的原子规划投影。
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
    argv: python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0064
    os: Windows-NT-10.0.26200
    python: 3.12.9
    powershell: 7.6.3
  wsl:
    requiredOutcome: PASS
    distribution: Ubuntu-24.04
    isolation: GIT_ARCHIVE_EXACT_CANDIDATE_TO_WSL_MKTEMP
    argv: bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0064
    kernel: 6.6.87.2-microsoft-standard-WSL2
    python: 3.12.3
    bash: 5.2.21
  macos:
    requiredOutcome: DEFERRED_NOT_CLAIMED
    residualRisk: >-
      本机无可用 macOS 执行环境，因此不声称 macOS PASS；后补条件是可获得受控
      macOS exact-tree 执行环境，并以相同冻结 profile 重跑。
  remote:
    outcome: NOT_RUN
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
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
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
  - .harness/commands.yaml
  - .harness/invariants.yaml
  - .harness/project-state.yaml
  - .harness/skills.yaml
  - .harness/sources-of-truth.yaml
  - .harness/task-backlog.yaml
  - .harness/task-delivery-policy.yaml
  - .harness/task-ledger.yaml
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0064-local-exact-tree-validation-fallback.md
  - docs/tasks/context/TASK-0064.context-lock.yaml
  - docs/evidence/TASK-0064/**
  - docs/handoffs/TASK-0064.json
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - skills/task-delivery-flow/SKILL.md
forbiddenPaths:
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - .harness/agent-entrypoints.yaml
  - .harness/license-policy.yaml
  - .harness/paid-feature-denylist.yaml
  - .harness/phase-scope.yaml
  - .harness/protected-paths.yaml
  - .harness/task-lifecycle.yaml
  - .harness/tools.lock.yaml
  - docs/tasks/TASK-0056-idle-planning-checkpoint-consumers-ci-closure.md
  - docs/tasks/TASK-0057-harness-timing-cross-filesystem-performance-engine.md
  - docs/tasks/TASK-0058-harness-path-aware-ci-wrapper-strategy.md
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/TASK-0063-authorization-history-greenline-recovery.md
  - docs/tasks/context/TASK-0062.context-lock.yaml
  - docs/tasks/context/TASK-0063.context-lock.yaml
  - docs/evidence/TASK-0062/**
  - docs/evidence/TASK-0063/**
  - docs/handoffs/TASK-0062.json
  - docs/handoffs/TASK-0063.json
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
  - scripts/harness/precheck.ps1
  - scripts/harness/precheck.sh
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0055-idle-planning-checkpoint-core-replacement.md
  - docs/tasks/TASK-0062-durable-command-permanent-replacement.md
  - docs/tasks/TASK-0063-authorization-history-greenline-recovery.md
  - docs/evidence/TASK-0062/evidence-pack.json
  - docs/evidence/TASK-0062/review-r1.md
  - docs/handoffs/TASK-0062.json
  - docs/evidence/TASK-0063/evidence-pack.json
  - docs/handoffs/TASK-0063.json
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
      Owner 原意：“不能因为 GitHub Actions 额度不够就不走了，肯定需要备用方案，
      例如本地跑或者不跑。”本卡据此获准把受控本地精确树验证固化为正式备用
      通道，并对确实不适用或外部不可获得的平台记录 NOT_RUN/DEFERRED；该授权
      绝不允许把未运行伪装成 PASS、无条件跳过所有验证、付费、公开仓库、安装
      自托管 runner 或访问凭据。
  - scope: task-0064-local-fallback-bootstrap
    approvedBy: repository-owner
    approvedAt: "2026-07-31"
    evidence: >-
      Owner 仅对 TASK-0064/Base 8af24aba6225104833b4d5845a77bbe7e513eed7
      一次性授权 HARNESS_PORTABILITY_LOCAL bootstrap：Windows 与 WSL2
      Ubuntu-24.04 两套真实完整验证必须 PASS；本机不可获得的 macOS 只能记
      DEFERRED_NOT_CLAIMED；GitHub Actions 因 2,000/2,000 分钟、0 美元预算和
      Stop usage 不运行且 dispatch=0。该证据不形成当前或后续任务可随意降低
      验证的泛化规则。
independentReview: required
reviewers: []
requiredCommands:
  - python -m unittest scripts.harness.tests.test_harness.CiExecutionPolicyTests scripts.harness.tests.test_harness.DeliveryPolicyTests scripts.harness.tests.test_harness.BacklogTests.test_task0062_rejected_authorization_projection_isolation_is_exact_and_fail_closed scripts.harness.tests.test_harness.BacklogTests.test_task0012_owner_amendment_real_history_edge_is_exact_and_atomic scripts.harness.tests.test_harness.BacklogTests.test_task0064_replacement_is_exact_and_atomic scripts.harness.tests.test_harness.IntegrationTests.test_command_registry_is_consumed_without_shell_commands
  - git diff --check
  - python scripts/harness/precheck.py --profile harnessPortabilityLocal --task TASK-0064
  - bash scripts/harness/precheck.sh --profile harnessPortabilityLocal --task TASK-0064
```

## 背景与用户可观察目标

GitHub Actions 本周期 2,000/2,000 分钟已耗尽，付费预算为 0 美元且 Stop usage
已启用；最近五个 REJECTED 终态矩阵已消耗大量折算分钟。交付不能因此永久停摆，
也不能把未运行伪装为 PASS。本任务建立一个最小声明式、精确绑定候选 Commit/Tree
的本地备用验证通道，并清除 Base 中两条会让本地 canonical 必败的历史绿线错误。

成功后，仓库能在远端 CI 有强类型不可用证据时，按 READY 前冻结的受控 profile
运行列明的本地平台和命令，清楚区分 PASS、NOT_RUN 与
DEFERRED_NOT_CLAIMED；TASK-0055 的唯一依赖改为已 ACCEPTED 的 TASK-0064。

## 范围内

- 新增唯一机器真源 `.harness/ci-execution-policy.yaml`，只声明
  `PRIMARY_REMOTE_EXACT_SHA`、`LOCAL_EXACT_TREE_FALLBACK` 和五种冻结 profile；
- 复用现有 `precheck.ps1`、`precheck.sh`、Python canonical、durable helper、
  Doctor 与 Evidence 结构；不新造 CI 编排框架；
- `HARNESS_PORTABILITY_LOCAL` 在同一精确候选 Tree 上运行 Windows 完整
  Harness/canonical 与 WSL2 Ubuntu-24.04 POSIX 完整 Harness/canonical；
- `BACKEND_LOCAL`、`FRONTEND_LOCAL`、`FULL_STACK_LOCAL` 只运行受影响模块并加
  必要 Linux/Windows Harness 门；命令与版本绑定当前 pom、package/lock、workflow
  和 tools lock，不猜测；
- `TERMINAL_METADATA_ONLY` 只允许已验证实现候选后的纯
  Evidence/Handoff/lifecycle 终态提交或 REJECTED closure；必须证明实现 Tree
  不变、提交含 `[skip ci]`，且绝不表示 CI PASS；
- 用强类型 `OWNER_SUPPLIED_QUOTA_EXHAUSTED` 固定 2,000/2,000、0 美元、
  Stop usage、重置日期和 dispatch=0；额度未知不得默认跳过；
- 本地 receipt 绑定精确 Commit/Tree、clean index/worktree、完整 argv、OS、
  解释器/工具链/依赖、环境摘要、stdout/stderr/receipt hash；候选输入变化重跑；
- 完成 TASK-0062 精确 REJECTED 授权投影隔离；任何固定字段、SHA、Hash、唯一
  35→45 差异、终态或绑定产物变化均失败，且不得称 TASK-0062 获授权；
- 修复真实 `2a55335e695c8fc5434c0dbc867288842c804e74` →
  `1b9eafd46649b76ab1a1b4e93f8cba8feaa7d6ad` amendment bootstrap：父根字段
  仅允许完全缺失或严格 `{}`，child 与 `authority.owns` 只允许精确追加；
- 保持 TASK-0063 REJECTED 及其冻结 Card/Evidence/Handoff 字节不变，新增
  0063→0064 永久替代记录；TASK-0055 唯一依赖从 TASK-0062 原子重接至
  TASK-0064，同步 Backlog、六节投影、planningContractHash、Doctor 和测试。

## 明确范围外

- 修改 `.github/workflows/**`，实现 `workflow_dispatch`、配额调度器或远端节流；
  这些属于 TASK-0065；
- 侵占或改写 TASK-0058 path-aware CI 合同，或修改 TASK-0056～TASK-0059；
- 创建大型 CI runner/helper/编排框架；只有现有机器验证无法表达时才允许小 helper，
  当前冻结方案不需要新 helper；
- 触发 GitHub Actions、提高预算、付费、公开仓库、安装自托管 runner、读取或扩大
  GitHub token scope；
- 修改 TASK-0062/TASK-0063 冻结 Card、Context、Evidence、Handoff 或 R1；
- 实现或晋级 TASK-0055、TASK-0013；产品、Provider、数据库、API、H5、身份、
  模型、凭据、Persona、安全政策、外发或 Beta。

## 输入和前置条件

- Base 固定为 `8af24aba6225104833b4d5845a77bbe7e513eed7`，Tree
  `f3d330153dfc85e537256c6301c525f8ec27e6cc`；创建前已 fetch 并确认
  `main == origin/main`、ahead/behind `0/0`、index/worktree clean、
  `activeTask=null`；
- TASK-0063 为 REJECTED，其 Handoff 和 Evidence 均存在；快照
  `e6b087740c9b524419979ad0136fc0b33f325f96` 只是 Base 历史中的未验证、
  非候选半成品；
- Base Doctor 继承已知 authorization-history 错误。DRAFT/READY 依机器策略记
  `NOT_RUN/INHERITED_KNOWN_FAILURE`，不重复运行、不伪造 PASS；
- 系统 TEMP、无仓库副作用的 PowerShell 7.6.3 durable exit-7 smoke 已 PASS：
  inner exit 7，stdout/stderr 与 receipt SHA-256 均已捕获，原子 receipt 发布且
  临时文件清理完成；该结果只证明长命令传输，不是候选验证；
- 复杂度在 DRAFT 前评估为一个不可拆 C4 `DELIVERY_GREENLINE_FALLBACK` 面：
  distinct=1、Reviewer 预计 12 分钟、单项 terminal 预计 20 分钟、总墙钟 60
  分钟，均未满足 `splitWhen`；若实际超过 90 分钟则按硬熔断失败关闭。

## API / 事件 / 数据契约

不修改业务 API、事件、数据库、Catalog 或产品协议。新增合同仅描述验证通道、
profile、receipt、平台覆盖和终态 metadata-only 语义。`LOCAL PASS` 只代表
Evidence 中列明的 OS、工具链和命令；未覆盖平台必须进入 `notCovered/deferred`。

## 权限、RLS 和数据处理要求

只处理仓库治理元数据、离线 Git 历史、合成测试和本机命令输出；不读取凭据、
真实用户或模型数据，不访问真实供应商，不修改服务、数据库、容器、账号、仓库
可见性或权限范围。WSL 只使用 Ubuntu-24.04 的精确候选隔离临时目录，结束后清理。

## 状态机和失败行为

严格执行 `DRAFT -> READY -> IN_PROGRESS -> IN_REVIEW -> ACCEPTED`。READY 前
冻结本卡标题、正文、目标、预算、validation profile、精确命令、WSL 隔离方式、
Owner bootstrap、macOS deferred 语义与完整白名单；READY 后除 lifecycle 明确
允许字段外字节不可变。

顺序固定为最小 targeted → candidate Commit/Tree → `fork_turns=none` 独立 R1
→ 可选一批前向修复/R2 delta → Windows candidate canonical 一次 →
WSL Ubuntu candidate canonical 一次 → Evidence → 唯一 pre-closure →
ACCEPTED terminal `[skip ci]` push → remote 0/0/clean。R1 无阻断不做 R2；
R2 出现新结构性 P0/P1 立即 REJECTED；禁止第三轮。

任何候选后实现输入变化都使两套本地结果失效并要求重跑，禁止跨 SHA/Tree 复用。
额度未知、receipt 绑定不全、本地必需平台失败或把 deferred 写成 PASS 均失败关闭。

## 模型、Prompt、记忆和安全边界

不修改模型、Prompt、Canonical Memory、安全政策、Persona 或产品能力；不引入
第二套 Markdown 计划、状态、Evidence、Handoff 或客户端规则。Windows 长命令
仅复用 durable helper；WSL 隔离目录不得与 Windows 工作树混用或写回仓库。

## 验收标准

- 唯一 CI 执行真源、Sources/Invariants/Commands/Doctor/tests 与
  task-delivery-policy/Skill 1.3.0 同步，AGENTS 保持薄入口；
- `HARNESS_PORTABILITY_LOCAL` 在 TASK-0064 同一精确候选 Commit/Tree 上：
  Windows PASS、WSL2 Ubuntu-24.04 PASS、macOS
  `DEFERRED_NOT_CLAIMED`；GitHub Actions `NOT_RUN/QUOTA_EXHAUSTED` 且
  dispatch=0；
- 每个本地结果绑定 clean snapshot、argv、cwd、OS、解释器/工具链/依赖、环境、
  stdout/stderr/receipt hash；未覆盖平台和残余风险完整列出；
- TASK-0062 仍为 REJECTED，固定 READY auth、首次违规 SHA、前后 projection
  Hash、唯一 35→45 差异、Ledger/Evidence/Handoff/R1 FAIL 全部精确绑定；
- 真实 amendment 父边正例通过；错误 authority、额外字段、错误边、null/list/
  非空父对象、corruption/restore 全部负例通过；
- TASK-0063 保持 REJECTED 且冻结产物不变，0063→0064 替代唯一；TASK-0055
  唯一依赖已 ACCEPTED TASK-0064，0055→0056→0057→0058→0059 严格单父链、
  TASK-0058 字节/合同不变、TASK-0013 不抢先；
- 独立 R1/可选 R2、唯一 pre-closure、terminal SHA/Tree、push、
  `main == origin/main`、ahead/behind `0/0`、clean 全部真实闭环。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Reviewer 前只运行一次冻结 targeted
矩阵和一次 `git diff --check`。R1 PASS 后，Windows 候选 canonical 通过 durable
helper 只启动一次；无 PTY 时约 60 秒只检查 receipt 存在，发布前不读 PID/status/
log、不重复运行，发布后只读取一次 stdout/stderr/exit。WSL 使用精确候选隔离目录
运行一次 POSIX wrapper。canonical 已覆盖的子命令不重复。

Base DRAFT/READY 的已知 Doctor 失败明确记录为
`NOT_RUN/INHERITED_KNOWN_FAILURE`，不是 PASS。GitHub Actions 因强类型额度证据
`NOT_RUN`，禁止 dispatch、探针或重试。

## 回滚或前向修复

保持当前 `main`，不切分支、不创建 worktree、不重写历史。实现最多一批精确前向
修复；不得删测、加 skip、扩大 timeout、泛化历史 SHA 例外、改变冻结 profile，
或把未运行降级为 PASS。terminal metadata-only commit 只提交治理闭环文件并保留
已验证实现 Tree。

## 停止条件

- 墙钟 45 分钟仍无通过冻结 targeted 的精确 candidate Commit/Tree；
- R2 出现新结构性 P0/P1，或需要 R3、第二批实现修复；
- Windows 或 WSL2 Ubuntu 必需本地验证失败且无法在单批修复内恢复；
- 总墙钟达到 90 分钟：立即停止实现、修复、Reviewer 和验证，只允许
  Evidence/Handoff、一次 pre-closure、terminal commit、push、远端 0/0 的
  closure-only overrun，并据实 REJECTED；
- 需要扩大白名单、修改冻结标题/正文/immutable metadata、触发远端 CI、修改
  workflow/TASK-0058 合同、进入付费/凭据/权限或其他 Owner 决策闸门。

## Evidence Pack

输出到 `docs/evidence/TASK-0064/`，并生成
`docs/handoffs/TASK-0064.json`。Evidence 必须将本地 PASS 与平台覆盖范围、macOS
deferred、远端 quota NOT_RUN、dispatch=0 分开记录，不把任何 NOT_RUN/DEFERRED
表示为 CI PASS。
