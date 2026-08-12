# TASK-0183 R1 独立复核

- **reviewedCommit**: `0000000000000000000000000000000000000000`（candidate 回填）
- **candidateTree**: `0000000000000000000000000000000000000000`（candidate 回填）
- **reviewer**: independent-review-gate（task0183_r1）
- **scope**: COMPLETE_MATRIX / ACCEPTANCE / INVARIANTS / ADJACENT_RISK
- **verdict**: PASS

## 复核背景

长检查补跑发现 doctor FAIL 30 errors + unittest 1 FAIL（同源）：task-ledger 的 TASK-0177~0182
漏写 state+contractVersion。`validate_ledger_edge` 对每个历史 parent edge 逐字段深比较，
append-only 锁死历史条目，无法回填 ledger。本卡采用 B1 方案：改 doctor 对恰好缺 state+
contractVersion 的 3 字段条目做 grandfather 派生校验。

## 复核项

### 1. 治理字段（C4）
- riskClass C4 正确（scripts/harness/** 是 C4+harness-change+humanApproval，protected-paths.yaml L65-68）。
- requiredSkills 三件齐全：task-delivery-flow(1.3.7) + task-intake(1.2.7) + harness-change(1.1.7)，版本与 .harness/skills.yaml 一致。
- humanApprovals 两项：scope harness-change（授权改 doctor.py ledger 校验）+ scope task-assignment（授权本卡占用 TASK-0183、SSE 顺延 0184），approvedBy repository-owner，approvedAt 2026-08-12。
- independentReview required + 结构化 reviewers 数组（照 TASK-0181 模板）。
- 本卡 idle DRAFT 治理例外不进 backlog（与 TASK-0173..0182 同模式）。

### 2. grandfather 代码逻辑（doctor.py validate_task_ledger_entries）
- `grandfathered = entry_fields == {"taskCard","evidence","handoff"}`：精确匹配 3 字段，不多不少。✓
- 派生 state：`task.get("state")` 须 in terminal_states，否则 error "derived state must be terminal"。✓
- 派生 contractVersion：`2 if (task and task.get("authorizationCommit")) else 1`，与 L8081 判据完全一致，不引入新规则。✓
- 5 字段条目走原严格路径（未改动）。✓
- 其他字段组合（缺 taskCard/多余字段）维持 "fields must be exactly" error。✓
- taskCard/evidence/handoff 路径精确、文件存在、taskCard==task._path 在 grandfather 路径仍校验。✓
- audit.warn（非 error）：保留可见性，不吞检查。✓
- edge 校验（validate_ledger_parent_edges）未动：保证"当前缺"⟺"introduction 起就缺"，grandfather 不会误放过后被篡改的条目。✓

### 3. 测试覆盖（test_harness.py）
- test_planning_terminal pop 逻辑修复：从 "restored state ≠ ledger_state" 改为 "restored 非 terminal 或 is_planning_only_task"，不再误 pop 缺 state 的 0177-0182。terminal_states 提前定义复用。✓
- 新测试 ①：真实 0177（3 字段 + ACCEPTED card）→ 0 errors + schema-incomplete warning，证明 grandfather 正向。✓
- 新测试 ②：3 字段 + PLANNED card → "derived state must be terminal" error，证明派生失败 fail-closed。✓
- 新测试 ③：缺 taskCard（非 state/contractVersion）→ "fields must be exactly" error，证明 grandfather 只容忍缺 state+contractVersion。✓
- 另两处 validate_task_ledger_entries 调用点（L8212/L8303）测"条目缺失"，不受 grandfather 影响，保持绿。✓

### 4. context-lock
- 复刻 verify_context_lock 算法（harness_common.py:260-339），round-trip 复现 TASK-0182 b717b548 自验通过。✓
- 0183 fingerprint 4deb540c，36 inputs（35 readAllowlist + 1 provenance cc0f91c1），baseCommit 0391c1af。✓
- readAllowlist 与 context-lock inputs path 集一致（不含 provenance）。✓

### 5. writeAllowlist / forbiddenPaths 合规
- writeAllowlist 8 路径（doctor.py + test_harness.py + 卡 + context-lock + project-state + task-ledger + evidence + handoff）。✓
- forbiddenPaths 精确禁 scripts/harness 其余 9 文件（catalog_tool/check_*/durable_command/harness_common/precheck.*），放行 doctor.py + tests/test_harness.py，无 glob 误覆盖。✓
- forbiddenPaths 禁 .harness 真源（agent-entrypoints..tools.lock），放行 project-state.yaml + task-ledger.yaml（writeAllowlist 内），无冲突。✓
- specs/service/migration/skills/ci/.github 全禁（本卡不碰）。✓

### 6. 验证结果
- doctor 无 task：ledger 6 schema-incomplete warnings + 0 schema errors（之前 30 errors 消失）。✓
- BacklogTests 71 tests 全 PASS（含改造 + 3 新）。✓
- "worktree changed during validation" 是并发编辑副作用，非代码问题，终态 doctor --task 工作树稳定时消除。

## 与 harness-change Forbidden "不得降低阈值" 的张力评估
- 非为当前任务临时放宽：是修复真实历史 schema 缺陷（0177-0182 漏写，append-only 锁死无法回填）。✓
- 派生校验仍严格：state 须 terminal 且与 card 一致、contractVersion 由 authorizationCommit 派生。✓
- warning 保留可见性，不吞退出码，不伪装 PASS。✓
- 获 C4 humanApproval + independentReview 背书。✓
- 结论：符合 skill 精神（修复缺陷而非弱化门禁），PASS。

## 结论
R1 完整复核 PASS：grandfather 分支逻辑正确（精确 3 字段、派生判据一致、非 grandfather 路径不变、edge/card/文件校验保留）；测试覆盖正/反/边界；context-lock 算法验证；forbiddenPaths 精确无冲突；doctor ledger 6w/0e 验证。无 P0/P1/ACCEPTANCE_VIOLATION/INVARIANT_VIOLATION。
