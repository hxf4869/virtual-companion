# TASK-0183：doctor task-ledger schema grandfather 派生校验（C4 harness-change）

```yaml
taskId: TASK-0183
state: ACCEPTED
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
baseCommit: 0391c1af3fab1436e2fd7a61df899a0ef1f8656f
authorizationCommit: "plan-approved-2026-08-12-doctor-ledger-grandfather"
contextFingerprint: 4deb540c7346d9ff37225bfec7b5f57ddb6907a08b17ebc2faf34aa685ed4987
contextFingerprintAlgorithm: SHA256_ORDINAL_SORTED_PATH_EQUALS_HASH_LF_V1
contextLock: docs/tasks/context/TASK-0183.context-lock.yaml
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
  intakeActivation: {anchor: DRAFT_COMMIT, terminal: READY_DOCTOR_TERMINAL, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  candidateExecution: {anchor: READY_DOCTOR_PASS_AND_IN_PROGRESS_COMMIT, notStartedOutcome: NOT_STARTED, notStartedEligibility: {readyDoctorNonPassRequired: true, readyDoctorPassForbidden: true, inProgressCommitForbidden: true, candidateFreezeForbidden: true}, candidateDeadlineMinutes: 45, targetWallMinutes: 60, hardFuseWallMinutes: 90, timeoutStatus: TIMEOUT, closureOnlyOverrunAllowed: true}
  reviewer: {maximumMinutes: 15, timeoutStatus: TIMEOUT, missingTerminalStatus: UNKNOWN}
complexityAssessment:
  policySource: .harness/task-delivery-policy.yaml
  evaluatedBefore: READY
  riskClass: C4
  surfaceId: TASK_0183_DOCTOR_LEDGER_GRANDFATHER_DERIVATION
  policySurfaces: [HARNESS]
  distinctCrossRiskSurfaces: 1
  reviewerMinutesEstimate: 12
  terminalCheckMinutesEstimate: 15
  estimatedWallMinutes: 40
  thresholdsTriggered: []
  splitRequired: false
  ownerIndivisibleAuthorization: false
validationPlan: {frozenBefore: READY, profile: precheck}
requiredCommands:
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --task TASK-0183
  - PYTHONPATH=scripts/harness:scripts/harness/tests PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python -m unittest test_harness.BacklogTests -v
  - PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0183
  - git diff --check
readAllowlist:
  - AGENTS.md
  - CLAUDE.md
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
  - docs/schemas/evidence-pack.schema.json
  - docs/schemas/handoff.schema.json
  - docs/tasks/task-card-template.md
  - docs/tasks/TASK-0181-authorization-snapshot-external-activation.md
  - docs/tasks/TASK-0182-realtime-ticket-http-api.md
  - docs/tasks/context/TASK-0182.context-lock.yaml
  - docs/evidence/TASK-0182/evidence-pack.json
  - docs/evidence/TASK-0182/review-r1.md
  - docs/handoffs/TASK-0182.json
  - scripts/harness/doctor.py
  - scripts/harness/harness_common.py
  - scripts/harness/precheck.py
  - scripts/harness/tests/test_harness.py
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
writeAllowlist:
  - scripts/harness/doctor.py
  - scripts/harness/tests/test_harness.py
  - docs/tasks/TASK-0183-doctor-task-ledger-grandfather-derivation.md
  - docs/tasks/context/TASK-0183.context-lock.yaml
  - .harness/project-state.yaml
  - .harness/task-ledger.yaml
  - docs/evidence/TASK-0183/**
  - docs/handoffs/TASK-0183.json
forbiddenPaths:
  - docs/tasks/TASK-017[0-9]-*
  - docs/tasks/context/TASK-017[0-9].context-lock.yaml
  - docs/evidence/TASK-017[0-9]/**
  - docs/handoffs/TASK-017[0-9].json
  - docs/tasks/TASK-018[0-2]-*
  - docs/tasks/context/TASK-018[0-2].context-lock.yaml
  - docs/evidence/TASK-018[0-2]/**
  - docs/handoffs/TASK-018[0-2].json
  - .gitattributes
  - AGENTS.md
  - CLAUDE.md
  - README.md
  - ci/**
  - requirements-harness.txt
  - docs/schemas/**
  - docs/source/**
  - docs/decisions/**
  - docs/planning/**
  - docs/architecture/**
  - docs/engineering/**
  - docs/tasks/task-card-template.md
  - .harness/agent-entrypoints.yaml
  - .harness/ci-execution-policy.yaml
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
  - scripts/dev/**
  - skills/**
  - .github/workflows/**
  - specs/catalog/**
  - specs/contracts/**
  - specs/generated/**
  - specs/openapi/**
  - service/**
  - "**/db/migration/**"
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
  - skills/harness-change/SKILL.md
  - skills/task-delivery-flow/SKILL.md
  - skills/task-intake/SKILL.md
  - docs/handoffs/TASK-0182.json
requiredInvariants:
  - INV-HARNESS-001
  - INV-HARNESS-002
  - INV-HARNESS-003
  - INV-HARNESS-005
  - INV-HARNESS-006
  - INV-HARNESS-007
humanApprovals:
  - scope: harness-change
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: a1b2c3d4-e5f6-7890-abcd-ef1234567890
    evidence: >-
      harness-change skill 1.1.7 授权修改 scripts/harness/doctor.py 的 task-ledger
      schema 校验逻辑（validate_task_ledger_entries 加 grandfather 派生分支）+ 对应
      test_harness.py 测试。根因：长检查补跑发现 task-ledger 的 TASK-0177~0182（连续
      6 张）追加时漏写 state+contractVersion 字段，doctor 报 30 errors、unittest 1 FAIL
      （同源）。因 validate_ledger_edge 对每个历史 parent edge 逐字段深比较，历史条目
      append-only 硬锁，无法回填 ledger。Owner 2026-08-12 现场审阅完整死结分析与三
      个候选方案（改 ledger 不可行 / doctor grandfather 派生 / doctor 显式例外表）后，
      拍板 B1（doctor grandfather 派生校验）：对恰好缺 state+contractVersion 的 3 字段
      历史条目，从绑定的 task card 派生校验（state 取 card.state、contractVersion 由
      authorizationCommit 推断）+ 发 warn 而非 error，保持 edge 校验/card 一致性/文件
      存在校验不变。不删检查、不吞退出码、不伪装 PASS（warning 保留可见性）。
  - scope: task-assignment
    approvedBy: repository-owner
    approvedAt: "2026-08-12"
    sourceThreadId: a1b2c3d4-e5f6-7890-abcd-ef1234567890
    evidence: >-
      Owner 2026-08-12 授权本卡作为 TASK-0182 闭环后的下一张卡（占用 TASK-0183，原 SSE
      resume 端点顺延 TASK-0184），优先修复 doctor 红态（每张新卡 doctor 都会 FAIL 的
      阻塞）。本卡是 idle DRAFT 治理例外，不进 backlog（与 TASK-0173..0182 同模式）。
      范围：仅改 doctor.py validate_task_ledger_entries + test_harness.py（pop 逻辑修
      复 + 3 个 grandfather 新测试），不碰 ledger 已有条目、不改 edge 校验、不修 policy
      测试卡住（独立问题）、不改 specs/service/migration/skills。
independentReview: required
reviewers:
  - id: task0183_r1
    kind: independent-review-gate
    verdict: PASS
    reviewedCommit: 0000000000000000000000000000000000000000
    evidencePath: docs/evidence/TASK-0183/review-r1.md
    reason: "R1 完整复核 PASS（candidate 回填）：C4 治理字段齐全；grandfather 分支仅对恰好缺 state+contractVersion 的 3 字段历史条目生效，派生判据与 L8081 一致；非 grandfather 路径完全不变（向后兼容）；edge/card/文件存在校验保留；测试 pop 逻辑修复正确；3 个新测试覆盖 grandfather 正/反/边界；doctor ledger 6 warnings/0 errors 验证通过。"
    candidateTree: 0000000000000000000000000000000000000000
```

> 本卡不在 Backlog 中，不写 `planningBacklog` 或 `planningContractHash`。它是 generation/companion
> 纵切的 harness 治理修复卡，承接 TASK-0182 闭环后长检查补跑发现的 doctor 红态，沿用
> `owner-authorization://longline-2026-08-09` 长线授权（hash `cc0f91c1...`），与
> TASK-0173..0182 同属 idle DRAFT 治理例外，不进 backlog。**触碰 C4 保护路径**
> `scripts/harness/**`（doctor.py + tests/test_harness.py，harness-change skill + humanApproval），
> 不触碰任何 C3 契约/catalog/generated 路径、C4 migration/safety 路径。

## 背景与用户可观察目标

TASK-0182 闭环后补跑长检查（precheck + harness unittest）发现 doctor 与 unittest 同源红态：

- **doctor FAIL 30 errors**：`.harness/task-ledger.yaml` 的 TASK-0177~0182（连续 6 张）追加时
  漏写 `state` + `contractVersion`，只有 3 字段 `{taskCard, evidence, handoff}`，而 schema 要
  5 字段。0176 及之前格式正确。根因是交接策略"跳过 doctor"连续 6 张未拦截（人为漏写）。
- **unittest 1 FAIL**：`BacklogTests.test_planning_terminal_card_is_atomic_and_does_not_consume_task_ledger`
  扫描真实 ledger，对 0177-0182 报 "terminal task ... is not registered"，与 doctor 同源。

**死结（代码核实）**：`doctor.py:7954 validate_ledger_edge` 对每个历史 parent edge 逐字段深比较
（`child_entries.get(task_id) == entry`），doctor 遍历全部 touching commit 的 edge。任何对已存在
条目的修改（即使补缺失字段）都会在 introduction-commit→修复-commit 边上报 `rewritten`。
**历史条目 append-only 硬锁，改 ledger 不可行**。

**方案 B1（Owner 2026-08-12 拍板）**：改 doctor 的 `validate_task_ledger_entries`，对恰好缺
`state`+`contractVersion` 的历史 3 字段条目，从绑定的 task card 派生校验（state 取 `task.get("state")`、
contractVersion 由 `authorizationCommit` 推断，判据与 L8081 一致），通过则发 `warn` 而非 `error`。
保持 edge 校验、card 一致性校验、文件存在性校验不变。ledger 不动（append-only 完整性保持）。

用户可观察结果（本卡完成后）：

- **doctor 绿**：`doctor.py --task TASK-0183` 与无 task 全量均 0 errors；0177-0182 产出 6 条
  schema-incomplete warning（可见但不阻塞）；后续每张新卡 doctor 不再因 ledger 漂移红。
- **unittest 绿**：改造的 `test_planning_terminal...` + 3 个 grandfather 新测试全 PASS。
- **precheck 绿**：`precheck.py --task TASK-0183` 全 7 命令 PASS（修复后第一次完整绿）。

## 范围内

1. **`scripts/harness/doctor.py` `validate_task_ledger_entries`（L8042-8110）**：加 grandfather 分支。
   若 `set(raw_entry) == {"taskCard","evidence","handoff"}`（恰好这 3 字段）→ `audit.warn` +
   派生 state（须 terminal，否则 error）+ 派生 contractVersion（2 if authorizationCommit else 1）；
   跳过"恰好 5 字段"/state 显式/contractVersion 显式/contractVersion 与 card 一致/state 与 card 一致
   五条 require；taskCard/evidence/handoff 路径精确、文件存在、taskCard==task._path 仍严格校验。
   若 `set(raw_entry) == TASK_LEDGER_FIELDS`（5 字段）→ 现有严格路径不变。其他字段组合 → 维持
   `fields must be exactly` error（只容忍恰好缺 state+contractVersion）。
2. **`scripts/harness/tests/test_harness.py`**：
   (a) 修 `test_planning_terminal_card_is_atomic...`（L7345-7359）pop 逻辑：从"restored state ≠
       ledger_state 才 pop"改为"restored 非 terminal 或 planning-only 才 pop"（用 `is_planning_only_task`），
       不再误 pop 缺 state 的 0177-0182。
   (b) 加 3 个 grandfather 测试：① 真实 0177（3 字段 + ACCEPTED card）→ 0 errors + warning 非空；
       ② 3 字段 + PLANNED card → "derived state must be terminal" error；③ 缺 taskCard（非
       state/contractVersion）→ "fields must be exactly" error（grandfather 只容忍缺 state+contractVersion）。
3. 终态治理闭环：doctor 0 errors/6 warnings + BacklogTests 全 PASS + precheck 全 7 绿 +
   git diff --check + 结构化 review-r1 + Evidence/Handoff + 单父 [skip ci]/push/远端 0/0。

## 明确范围外

- **改 task-ledger.yaml 的 0177-0182 已有条目**（append-only edge 校验锁死，不可行）。
- **改 `validate_ledger_edge` / `validate_ledger_parent_edges`**（历史 edge 校验不动）。
- **修 `CiExecutionPolicyTests.test_policy_rejects_backend_and_frontend_local_profile_drift`
  卡住问题**（独立问题，本卡不修，记 knownRisk，建议后续单独查）。
- **改 specs/contracts/catalog/generated、service、migration、skills、modelruntime/safety**（保护路径）。
- **SSE resume 端点**（原 TASK-0183 内容顺延 TASK-0184，仅 nextAction 文本体现）。

## 输入和前置条件

- Base `0391c1af3fab1436e2fd7a61df899a0ef1f8656f` = TASK-0182 ACCEPTED terminal（已 push、
  HEAD==origin/main、0/0、clean；nextAction 三处 sha256 `c30657d9...` 一致）。
- DRAFT 前已复核：doctor validate_task_ledger_entries（L8042-8110）+ validate_ledger_edge
  （L7954-7964）+ validate_ledger_parent_edges（L7981-8039）+ TASK_LEDGER_FIELDS（L1237-1243）+
  Audit.warn（L2037-2039）+ is_planning_only_task（L7058-7067）+ contractVersion 判据（L8081）；
  test_harness 三处 validate_task_ledger_entries 调用点（L7354/L8212/L8303）影响面；0181 C4
  reviewers 模板；0182 治理字段模板；task-ledger 0177-0182 实际条目（缺 state+contractVersion）。
- context lock 输入钉在 Base（36 inputs = 35 readAllowlist + 1 provenanceOnly
  `owner-authorization://longline-2026-08-09` hash `cc0f91c1...`）；contextFingerprint
  `4deb540c...` 由复刻 verify_context_lock 算法生成并 round-trip 自验（先复现 TASK-0182
  `b717b548...` 通过，再生 0183）。
- 受控 Python：`PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH`。本卡不碰 Java/DB/OpenAPI。

## Harness 契约与治理边界

- doctor 的 ledger schema 仍由 `TASK_LEDGER_FIELDS = {"state","contractVersion","taskCard",
  "evidence","handoff"}` 定义；grandfather 不改 schema 定义，只对历史 3 字段条目加派生容差。
- 派生判据与现有 L8081 完全一致（`2 if task.get("authorizationCommit") else 1`），不引入新规则。
- grandfather 仅对"恰好缺 state+contractVersion 的 3 字段条目"生效；任何其他字段组合（缺
  taskCard、多余字段等）仍走严格 `fields must be exactly` error。
- edge 校验（validate_ledger_parent_edges）保证：条目从 introduction commit 起逐字段不变；
  故"当前条目缺 state+contractVersion" ⟺ "introduction 起就缺"（在 edge 校验通过前提下），
  grandfather 不会误放过"后来被篡改"的条目。
- **与 harness-change Forbidden"不得降低阈值"的张力**：已论证——非为当前任务临时放宽，是修复
  真实历史 schema 缺陷；派生校验仍严格（state 须 terminal 且与 card 一致、contractVersion 由
  authorizationCommit 派生）；warning 保留可见性不吞掉；获 C4 humanApproval + independentReview 背书。

## 状态机和失败行为

- validate_task_ledger_entries：5 字段条目 → 现有严格路径（不变）；3 字段条目（恰好 taskCard/
  evidence/handoff）→ grandfather：warn + 派生 state 须 terminal（否则 error "derived state
  must be terminal"）+ 派生 contractVersion；其他字段组合 → error "fields must be exactly"。
- grandfather 不影响 "terminal task must be registered" 检查（L8102-8110）：0177-0182 仍在 entries
  里，PASS。
- 正式门禁非 PASS → 停止 promotion；hardFuse 90min → closure-only overrun。

## 模型、Prompt、记忆和安全边界

不涉及模型/Prompt/记忆/业务数据（纯 harness 工具链修复）。安全边界：doctor 是治理门禁
（INV-HARNESS-002/003 enforcement），本卡不弱化其越界 Diff/缺失 Skill/Context 漂移检测能力，
仅对历史 ledger schema 缺陷加可审计的 grandfather 容差（warning 可见）。

## 验收标准

1. `doctor.py validate_task_ledger_entries`：5 字段严格路径不变；3 字段（恰好 taskCard/evidence/
   handoff）grandfather 派生（warn + state 须 terminal + contractVersion 派生）；其他字段组合 error。
2. `test_harness.py`：`test_planning_terminal...` pop 逻辑修复（基于 restored task 终态/planning-only
   判断，不再误 pop 缺 state 条目）；3 个 grandfather 新测试覆盖正/反/边界。
3. `doctor.py --task TASK-0183`：0 errors，0183 diff scope PASS；无 task 全量：0177-0182 产出 6 条
   schema-incomplete warning，0 schema errors。
4. `BacklogTests` 全 PASS（含改造的 test_planning_terminal + 3 个新测试）。
5. `precheck.py --task TASK-0183`：全 7 命令 PASS（doctor 这次绿）。
6. `git diff --check` exit 0。
7. Evidence 如实记录；policy 测试卡住、authorizationCommit 占位符记 knownRisk。
8. 终态单父 `[skip ci]` 提交、push 后 `HEAD==origin/main`、`0/0`、clean。

## 必跑检查

以 YAML `requiredCommands` 精确 argv 为准（doctor --task 一次；BacklogTests 一次；precheck 一次；
同一无参 `git diff --check` 一次）。完整 `unittest discover` 因 `CiExecutionPolicyTests` 卡住
（独立问题）改为单独跑 BacklogTests 类，记 knownRisk。

## 回滚或前向修复

- 若 BacklogTests 暴露 grandfather 分支问题：最多 1 fix batch 修 doctor.py/test_harness.py。
- 若 doctor --task TASK-0183 暴露 diff scope 越界：收紧 writeAllowlist/forbiddenPaths（不扩权）。
- 若 R1 发现阻塞项：最多 1 fix batch → R2 只验 closure/delta/adjacent risk；R3 禁止。
- 若实测必须改 edge 校验或 ledger 已有条目：立即停止（超出本卡授权，需新卡）。

## 停止条件

- writeAllowlist 外路径被修改；forbiddenPaths 被触碰（0170-0182 产物、其他 scripts/harness 文件、
  .harness 真源、specs、service、migration、skills 等）。
- doctor --task / BacklogTests / precheck / diff check 任一非 PASS。
- 候选身份（Commit/Tree）变化或越界。
- hardFuseWallMinutes 90 到达：停止实现/修复/Reviewer/canonical，只允许 closure-only overrun。

## Evidence Pack

输出到 `docs/evidence/TASK-0183/`（evidence-pack.json、review-r1.md），并生成 `docs/handoffs/TASK-0183.json`。
