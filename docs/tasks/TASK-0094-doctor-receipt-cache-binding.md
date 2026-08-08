# TASK-0094：修复 Doctor receipt cache 输入绑定与前置校验

```yaml
taskId: TASK-0094
state: DRAFT
owner: repository-owner
riskClass: C4
requiredSkills:
  - task-delivery-flow
  - task-intake
  - harness-change
requiredSkillVersions:
  task-delivery-flow: "1.3.6"
  task-intake: "1.2.6"
  harness-change: "1.1.6"
targetSkillVersions: {}
baseCommit: c09e83246054225f7bc29fb202ecc6976a88ceb1
authorizationCommit: ""
contextFingerprint: 8d7ef321aa3dc1dfba0fd4aa020f062932b6ab730645f419a33d6c6071260a28
contextLock: docs/tasks/context/TASK-0094.context-lock.yaml
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
  surfaceId: TASK_0094_DOCTOR_RECEIPT_CACHE_BINDING
  policySurfaces: [GOVERNANCE]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 15
  terminalCheckMinutesEstimate: 20
  estimatedWallMinutes: 75
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, policySource: .harness/ci-execution-policy.yaml, selectedChannel: PRIMARY_REMOTE_EXACT_SHA, profile: precheck}
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
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0077-permanent-harness-recovery-and-quarantine.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/context/TASK-0090.context-lock.yaml
  - docs/evidence/TASK-0059/evidence-pack.json
  - docs/evidence/TASK-0077/evidence-pack.json
  - docs/evidence/TASK-0090/evidence-pack.json
  - docs/handoffs/TASK-0059.json
  - docs/handoffs/TASK-0077.json
  - docs/handoffs/TASK-0090.json
  - skills/task-intake/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/harness-change/SKILL.md
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/precheck.ps1
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/check_beta_gate.py
  - scripts/harness/tests/test_harness.py
writeAllowlist:
  - docs/tasks/TASK-0094-doctor-receipt-cache-binding.md
  - docs/tasks/context/TASK-0094.context-lock.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0094/evidence-pack.json
  - docs/evidence/TASK-0094/pre-closure-request.json
  - docs/evidence/TASK-0094/review-r1.md
  - docs/evidence/TASK-0094/review-r2.md
  - docs/handoffs/TASK-0094.json
forbiddenPaths:
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
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - .github/**
  - ci/**
  - requirements-harness.txt
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/precheck.sh
  - scripts/harness/precheck.ps1
  - scripts/harness/catalog_tool.py
  - scripts/harness/check_paid_features.py
  - scripts/harness/check_beta_gate.py
  - skills/**
  - docs/schemas/**
  - docs/planning/**
  - docs/source/**
  - docs/decisions/**
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/tasks/TASK-0077-permanent-harness-recovery-and-quarantine.md
  - docs/tasks/TASK-0090-generation-terminal-persistence.md
  - docs/tasks/context/TASK-0090.context-lock.yaml
  - docs/evidence/TASK-0059/**
  - docs/evidence/TASK-0077/**
  - docs/evidence/TASK-0090/**
  - docs/handoffs/TASK-0059.json
  - docs/handoffs/TASK-0077.json
  - docs/handoffs/TASK-0090.json
  - service/**
  - frontend/**
  - specs/**
  - infra/**
  - db/**
  - deploy/**
  - ops/**
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
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - docs/tasks/TASK-0059-harness-snapshot-receipt-evidence-gate.md
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
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
    approvedAt: "2026-08-08"
    sourceThreadId: codex-current-task-20260808
    evidence: >-
      Owner 要求按 2026-08-08 审计报告逐项修复，并明确要求不确定、大改动、风险或需决策时先询问。
      Agent 随后精确说明首卡分配 TASK-0094、仅修 Doctor receipt cache P1-01、C4 Harness
      保护路径、独立复核与直接原子提交并推送 origin/main；Owner 回复“继续”，批准上述两项决策。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0094
  - python -m unittest scripts.harness.tests.test_harness.GitHistoryPolicyTests
  - git diff --check
```

> 本卡是由 repository-owner 于 2026-08-08 明确分配的独立非 Backlog 延续卡。`TASK-0091`、`TASK-0092`、`TASK-0093` 目前只存在于非规范规划资料和旧 `nextAction` 文本中，不是可执行机器任务；本卡不创建、取消、替代或复用这些 ID。

## 背景与用户可观察目标

2026-08-08 仓库外只读审计在当前 `main` 上复现：先命中合法 Doctor receipt 后，执行 `doctor.py --task TASK-DOES-NOT-EXIST` 仍返回同一个 PASS。根因是 receipt manifest 没有绑定任务、完整调用与工作树等候选身份，且 cache lookup 早于任务存在性和授权校验。

本卡完成后，用户能观察到：无效任务、变化后的候选或不同调用不能继承旧 PASS；合法且身份完全一致的 cache hit 仍可保留性能收益；`--summary` 在 cache hit 时仍输出真实项目摘要。

## 范围内

- 调整 `scripts/harness/doctor.py` 的 receipt manifest、cache lookup 时机和 cache-hit 输出。
- Receipt identity 至少绑定规范化仓库根、完整 argv/任务 ID/调用模式、HEAD、index、tracked worktree、untracked candidate、解释器/版本、Doctor 实现身份，以及会影响检查结果的环境与 Git config 摘要；敏感环境值只能进入不可逆摘要，不能明文落入 cache。
- 参数解析、任务存在性、任务状态/Context/授权和候选身份中所有能影响 cache 适用性的校验必须先于 cache PASS；不得让不存在任务或错误仓库命中旧结果。
- 增加不存在任务、task/argv 变化、unstaged/untracked、不同仓库、解释器/实现身份变化和 `--summary` cache hit 的自动测试。
- 保持失败关闭、真实退出码和现有跨平台入口语义。

## 明确范围外

- 不修审计 P2-20 的 Git `master` fixture；不得通过注入 `init.defaultBranch=master` 掩盖它。
- 不修根 Maven stale contract test、canonical `python`/`python3` 策略、CI workflow、依赖锁或其他审计项。
- 不修改 machine policy、命令注册、Skill、Agent 入口、任务模板、Evidence schema、业务代码、数据库、前端、contracts/catalog。
- 不删除测试、不加 skip、不降低阈值、不吞退出码、不把失败/未知/缓存命中包装为新 PASS。

## 输入和前置条件

- Base Commit 固定为 `c09e83246054225f7bc29fb202ecc6976a88ceb1`，DRAFT 创建前工作树干净、`activeTask: null`。
- Context Lock 只绑定 Base Commit 内的仓库相对路径；外部审计报告仅作 provenance，不作为可复验输入。
- `scripts/harness/**` 是 C4 保护路径；本卡已固定 `harness-change 1.1.6`、Owner 人工批准和独立 Reviewer。
- 复杂度评估只有 GOVERNANCE 一个风险面，预计 75 分钟，不触发拆卡；若实现需要改 machine policy、common helper 或其他保护路径，立即停止，不扩权。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供该可执行文件，解释器身份必须进入 Evidence。

## API / 事件 / 数据契约

- 不修改产品 API、事件和数据库契约。
- Receipt/cache 是内部性能优化，不是第二套 Evidence；cache 命中只能复用与所有候选身份输入完全一致的已终止真实 PASS。
- Cache schema/version 变化必须向前失效旧条目，不能把旧格式猜测为兼容。

## 权限、RLS 和数据处理要求

- 不接触用户数据、凭据、数据库或网络服务。
- Cache manifest/receipt 不得保存明文 secret、token、完整敏感环境值或用户数据；需要绑定的环境信息使用稳定的不可逆摘要。
- 不增加 bypass、override、环境开关、Git note/replace/graft 或可配置 allowlist。

## 状态机和失败行为

- 不存在任务、Context/授权不匹配、候选变化、输入未知、cache 格式旧或摘要不一致时，必须绕过/失效 cache 并执行真实校验；真实校验失败保持非零退出。
- `--summary` cache hit 必须输出与非 cache 模式同等的项目状态摘要和明确的 receipt-hit 标识。
- Cache 文件损坏、并发读写或缺字段时不得崩溃或 PASS；按 cache miss 处理并运行真实校验。
- 任何为了修复当前卡而放宽治理规则、跳过检查或扩大路径的需要，均转 BLOCKED。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆或 SafetyGate。
- 不引入新依赖、SaaS 或付费运行时。
- 环境摘要必须避免凭据泄露和跨仓库关联风险。

## 验收标准

1. 在已有合法 receipt 的前提下，`--task TASK-DOES-NOT-EXIST` 不命中 PASS，返回非零并报告任务不存在。
2. task/argv、仓库根、HEAD/index、tracked worktree、untracked candidate、解释器/Doctor 实现或相关环境/Git config 任一变化时，不复用旧 PASS；输入恢复完全一致后才允许新的真实 PASS 建立 cache。
3. Cache manifest 不含明文敏感环境值；旧 schema、缺字段和损坏文件全部 fail-safe 为 cache miss。
4. `--summary` 在 cache hit 和 miss 时都输出项目状态摘要；cache hit 明确标识 receipt，但不跳过调用特有的前置校验。
5. 新增自动测试覆盖上述场景；既有 receipt tests、定向 `GitHistoryPolicyTests`、canonical Precheck 和 `git diff --check` 全部真实 PASS。
6. Diff 仅包含 writeAllowlist，且不修改 machine policy、Skill、命令注册、业务路径或历史 Evidence。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；定向 unittest 是受影响模块测试；`git diff --check` 只运行一次。所有命令记录真实状态、退出码、验证 Commit/Tree、解释器和环境身份。

## 回滚或前向修复

- 修复采用 cache schema 向前失效和最小代码变更；失败时回到真实校验，不允许保留不可信 fast path。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和新 P0/P1，禁止第三轮。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment；不得倒推扩权。
- 本卡 ACCEPTED 后另建新卡修复 P2-20 fixture 与 P1-02 Maven baseline。

## 停止条件

- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA 任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 修改需要跨出 `doctor.py` 与 `test_harness.py`，或需要改变 machine policy/命令/Skill/模板时停止并询问 Owner。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0094/evidence-pack.json`、`pre-closure-request.json`、`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0094.json`。所有 PASS 绑定真实候选 Commit/Tree、精确 argv、解释器、环境、Reviewer 和 remote exact-SHA；Handoff `nextAction` 与终态 project-state 逐字一致。
