# TASK-0095：修复 Doctor receipt cache-hit 完整 manifest TOCTOU

```yaml
taskId: TASK-0095
state: READY
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
baseCommit: d3e43de84cf1d10b0b5d0038f34ec326dd2afbb9
authorizationCommit: ""
contextFingerprint: d7e9aa40b0a7817a40be4211acee07a75d4996471a6ba817f6dbc51c691195d0
contextLock: docs/tasks/context/TASK-0095.context-lock.yaml
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
  surfaceId: TASK_0095_DOCTOR_RECEIPT_CACHE_MANIFEST_TOCTOU
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
  - docs/tasks/TASK-0095-doctor-receipt-cache-toctou.md
  - docs/tasks/context/TASK-0095.context-lock.yaml
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0095/**
  - docs/handoffs/TASK-0095.json
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
    sourceThreadId: zcode-audit-fix-20260808
    evidence: >-
      Owner 按 2026-08-08 审计交接文档正式分配独立任务 TASK-0095，仅修 TASK-0094 R2
      发现的 Doctor receipt cache-hit 完整 manifest TOCTOU；明确批准 C4 harness-change、
      独立 Reviewer、PRIMARY_REMOTE_EXACT_SHA、按仓库任务流创建原子提交并推送
      origin/main；禁止顺手修其他审计项。
independentReview: required
reviewers: []
requiredCommands:
  - python scripts/harness/precheck.py --task TASK-0095
  - python -m unittest scripts.harness.tests.test_harness.GitHistoryPolicyTests
  - git diff --check
```

> 本卡是由 repository-owner 于 2026-08-08 明确分配的独立任务，是 TASK-0094 失败关闭后的前向修复卡。TASK-0094 已 REJECTED，其历史提交、Evidence 与 Handoff 一律不得回退、amend 或改写。

## 背景与用户可观察目标

TASK-0094 R2 证明：初始 receipt manifest 与 cache 条目匹配后，cache-hit 路径只调用
`DoctorGitSnapshot.verify_unchanged()`，该复验仅覆盖 HEAD/index/flags/worktree；在初始
manifest 计算之后、返回 cache PASS 之前并发修改 Git history/config、timezone source、
environment、implementation identity 等新增 manifest 输入，仍可复用旧 PASS。

本卡完成后，用户能观察到：任何一次 cache PASS 返回前都必须基于当前真实状态重新计算完整
manifest 并与 lookup 使用的 manifest 常量语义一致；重算失败或任一输入变化都不得返回
cache PASS（按 cache miss 进入真实校验，或在无法建立稳定候选身份时失败关闭）。

## 范围内

- 仅调整 `scripts/harness/doctor.py` 的 cache-hit 返回路径：在返回 receipt PASS 前重新计算
  完整 manifest（`compute_doctor_receipt_manifest`），并与 lookup 使用的 manifest 做逐字段
  常量语义比较。
- 重算失败（返回 None）或与 lookup manifest 不一致时，本次不得命中 cache，进入真实校验；
  真实校验完成后不得把旧的 lookup manifest 写入新 receipt。
- 在 `scripts/harness/tests/test_harness.py` 增加竞态回归测试：lookup 与重算之间修改
  graft/replace refs、Git config、timezone source、environment 与 implementation identity
  任一输入，均不得返回 cache PASS。
- 保持既有语义：任务存在性校验先于 cache lookup；`--summary` cache hit 输出真实摘要；
  损坏/旧 schema/缺字段 cache 仍 miss；真实退出码与跨平台行为不变。

## 明确范围外

- 不修 Maven/根级 CI（P1-02）、master fixture（P2-20）、POSIX canonical python（P2-21）、
  项目状态结构校验（P2-22）或其他审计项。
- 不修改 machine policy、命令注册、Skill、Agent 入口、任务模板、Evidence schema、
  `harness_common.py`、`precheck.py` 或包装器。
- 不删除测试、不加 skip、不吞退出码、不降低阈值、不把 cache/失败/未知包装为新 PASS。
- 不改写 TASK-0094 或任何历史 Evidence/Handoff/ADR。

## 输入和前置条件

- Base Commit 固定为 `d3e43de84cf1d10b0b5d0038f34ec326dd2afbb9`，DRAFT 创建前工作树干净、
  `activeTask: null`。
- Context Lock 只绑定 Base Commit 内的仓库相对路径；外部交接/审计文档仅作 provenance。
- `scripts/harness/**` 是 C4 保护路径；本卡固定 `harness-change 1.1.6`、Owner 人工批准和
  独立 Reviewer。
- 复杂度评估只有 GOVERNANCE 一个风险面，预计 75 分钟，不触发拆卡；若实现需要修改
  machine policy、common helper 或其他保护路径，立即停止，不扩权。
- Canonical argv 保持机器策略规定的 `python`；本机通过仓库外受控 Python 环境提供该可执行
  文件，解释器身份必须进入 Evidence。

## API / 事件 / 数据契约

- 不修改产品 API、事件和数据库契约。
- Receipt/cache 是内部性能优化，不是第二套 Evidence；cache 命中只能复用与所有候选身份
  输入完全一致的已终止真实 PASS，且必须通过返回前的完整 manifest 重算复验。
- Cache schema/version 保持 v2 不变；本卡不升级 receipt 格式，只加固命中前的身份复核。

## 权限、RLS 和数据处理要求

- 不接触用户数据、凭据、数据库或网络服务。
- 不增加 bypass、override、环境开关、Git note/replace/graft 或可配置 allowlist；
  现有绑定字段保持敏感值只进不可逆摘要。

## 状态机和失败行为

- lookup 匹配后、返回 PASS 前：重算完整 manifest；`None` 或与 lookup manifest 不一致一律
  按 cache miss 处理（不得 PASS），继续真实校验。
- 真实校验结束时，只有结束时刻重算的 manifest 与本次初始 manifest 完全一致才允许写入
  新 receipt（沿用现有非 cache 路径语义）。
- 任务不存在、Context/授权不匹配、候选变化或输入未知时保持失败关闭；`--summary` 在
  cache hit 与 miss 下都输出项目状态摘要，hit 明确标识 receipt。
- Cache 文件损坏、并发读写或缺字段时按 miss 处理并运行真实校验，不得崩溃或 PASS。

## 模型、Prompt、记忆和安全边界

- 不修改模型、Prompt、记忆或 SafetyGate；不引入新依赖、SaaS 或付费运行时。
- 竞态测试只使用临时 fixture 仓库与环境变量/文件的临时修改，不触碰真实凭据或用户数据。

## 验收标准

1. 在已有合法 receipt 的前提下，lookup 之后、返回 PASS 之前修改以下任一输入，不得命中
   cache（输出无 `[receipt hit`，且不把旧 PASS 当结果）：graft/replace refs、Git config、
   timezone source（TZPATH/文件内容）、environment（受绑定键）、implementation identity。
2. 重算失败（如 Git 命令失败或绑定输入不可读）时不得返回 cache PASS，按 miss 进入真实校验。
3. lookup 与重算之间所有输入均未变化时，合法 cache hit 仍返回 PASS 并保留 `--summary`
   摘要输出与 `[receipt hit` 标识。
4. 任务存在性仍校验于 cache lookup 之前；损坏/旧 schema/缺字段 cache 仍 miss；真实退出码
   与跨平台语义不变（既有 receipt tests、`GitHistoryPolicyTests` 全部保持 PASS）。
5. 新增竞态测试覆盖 graft、replace、Git config、timezone source、environment、
   implementation identity 六类输入；定向测试、canonical Precheck、独立 Reviewer、
   PRIMARY_REMOTE_EXACT_SHA 全部真实 PASS。
6. Diff 仅包含 writeAllowlist，且不修改 machine policy、Skill、命令注册、业务路径或历史
   Evidence。

## 必跑检查

以 YAML `requiredCommands` 的精确 argv 为准。Canonical Precheck 只运行一次；定向
`GitHistoryPolicyTests` 是受影响模块测试；`git diff --check` 只运行一次。所有命令记录真实
状态、退出码、验证 Commit/Tree、解释器和环境身份。

## 回滚或前向修复

- 修复采用最小代码变更，只在 cache-hit 返回前增加完整 manifest 重算与常量比较；任何失败
  都回落到真实校验，不允许保留不可信 fast path。
- R1 如有阻塞发现，最多一个 fix batch；R2 只验证 finding closure、delta、adjacent risk 和
  新 P0/P1，禁止第三轮。
- READY 后如需增加路径或改变条款，只能停止并走 Backlog 强类型 Owner amendment；不得倒推
  扩权。

## 停止条件

- Context、Owner 批准、Skill、白名单、候选身份、Reviewer、canonical、remote exact-SHA
  任一缺失或失败，立即失败关闭并按 lifecycle 转 BLOCKED/REJECTED。
- 修改需要跨出 `doctor.py` 与 `test_harness.py`，或需要改变 machine policy/命令/Skill/
  模板时停止并询问 Owner。
- 90 分钟 hard fuse 到达后停止实现、修复、Reviewer、canonical 和 CI；若仓库已活动，仅允许
  按策略做 closure-only overrun。

## Evidence Pack

输出 `docs/evidence/TASK-0095/evidence-pack.json`、`pre-closure-request.json`、
`review-r1.md`/必要的 `review-r2.md`，并生成 `docs/handoffs/TASK-0095.json`。所有 PASS
绑定真实候选 Commit/Tree、精确 argv、解释器、环境、Reviewer 和 remote exact-SHA；Handoff
`nextAction` 与终态 project-state 逐字一致。
