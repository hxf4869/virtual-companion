# R1 独立复核：GATE-IDENTITY-PROVIDER-SESSION gate-approval idle edge bootstrap

- 复核人角色：独立 R1 reviewer（未参与实现）
- 复核 commit：`e126c12`（bootstrap）+ `40f59e9`（test fix）+ `1a33128`（P2-1 闭环），diff = `1041c5f..HEAD`
- 复核日期：2026-08-07
- 复核性质：harness self-bootstrap（选项 A，Owner 授权）——扩展 `derive_idle_planning_checkpoint` 支持 gate-approval idle edge

## Verdict：PASS

当前 HEAD（1a33128）经本 reviewer 实测：`python scripts/harness/doctor.py --summary` → **PASS (419175 checks, 243.9s)**，summary 显示 `Next promotable: TASK-0034`、`Blocked by: NONE`、gate 已 APPROVED；`IdlePlanningCheckpointTests` 独立运行 **7/7 PASS**（22.3s，含 3 个新增 gate-edge 测试）。三处 doctor 改动与备份 `/tmp/doctor.py.bak` 对比仅落在声明范围内（diff 共 4 hunk，全部位于 3 个改动点）。复核结论：逻辑正确、测试修复合理、P2-1 已闭环、无 P0/P1。

## 逐项结论

### 1. 复核矩阵完整性（PASS）
- `git show --stat e126c12`：`.harness/project-state.yaml`（1 行）、`.harness/task-backlog.yaml`（+25/-6）、`scripts/harness/doctor.py`（+83）。
- `git show --stat 40f59e9`：仅 `scripts/harness/tests/test_harness.py`（+15/-1）。
- `git diff 1041c5f..HEAD`：仅上述 4 文件，共 +117/-8，无越界文件。
- commit 图：`1041c5f`（TASK-0033 终态）→ `e126c12`（单父）→ `40f59e9`（单父）。reflog 显示曾有两次被 reset 放弃的旧提交（e6c981b、11a9717），不在 HEAD 祖先中，不影响校验。

### 2. doctor.py 改动（PASS，3 处均为声明范围）

**a. gate approval edge（`scripts/harness/doctor.py:10105-10163`）**
- 检测条件 `len(added)==0 and len(approved_gate_ids)==1`（10117）正确：approved_gate_ids 只统计「child 为 APPROVED 且 parent 非 APPROVED」的既有 gate；新增 gate 直接 APPROVED 不被计数（fail-closed）。
- approval 结构校验（10122-10127）：`approvedBy=="repository-owner"`、`approvedAt` 通过 `is_valid_approval_timestamp`、`decisionEvidence` 为 dict 且非空。
- 路径校验（10129-10135）：`{backlog, state}` 或 `{backlog, state, scripts/harness/doctor.py}` 精确相等，禁止 extra path。
- project-state idle（10136-10145）：去掉 nextAction 后父子 state 全等，且 child `activeTask`/`activeTaskCard` 均为 None。
- nextAction（10147-10162）：经 `derive_backlog_promotion_projection` 取 `nextPromotable`，要求 nextAction 中 TASK 提及集合 `== {gate_next}`。
- **不破坏既有 resolution edge**：gate edge 仅在 `len(added)==0` 时进入并 `continue`；`len(added)==1` 的 resolution 分支（10163 之后）原样保留，仅追加、无删除。

**b. validate_diff_scope（`scripts/harness/doctor.py:16716-16724`）**
- `target_commit` 非 None 时 `changed = changed_paths_across_history(base, target)`（不含工作树）；None 时保留原行为（history(HEAD) ∪ working-tree）。
- 语义正确：idle 时 lastTerminal 的 diff scope 被截断在终态 commit，governance commit（gate approval）不再污染前一任务。
- 其他调用行为不变：`changed_override` 路径（implementation headCommit 校验 16348 行调用）与 active/pending 任务（target=None）均走原逻辑。

**c. 调用点（`scripts/harness/doctor.py:17118-17127`、17137）**
- 条件 `not active_task and not pending_draft and selected_task_id == last_terminal_task` 时 `diff_target = canonical_terminal_commit(selected, {ACCEPTED, REJECTED})`。idle 时 `select_task_for_diff_scope` 必返回 lastTerminalTask，故该守卫在 idle 时恒真、active/pending 时恒假，正确隔离。
- 实测 doctor 通过证实该路径生效（selected task diff scope 阶段 0.436s 无错误）。

### 3. 测试修复（PASS）
- `test_harness.py:4213`：`load_inputs()` 后立即将 gate 强制为 PENDING，使「PENDING gate 阻断 DRAFT」断言独立于真实 gate 状态。最小且正确。
- `test_harness.py:4513-4521`：fixture backlog 文本 replace，pattern 含完整 gate 名 `GATE-IDENTITY-PROVIDER-SESSION:\n kind: HARD_OWNER_DECISION\n status: APPROVED`，count=1；GATE-LIVE-MODEL-PROVIDER 名称不同且本就 PENDING，不误伤。若 backlog 块将来改格式导致 replace 落空，断言会因找不到 PENDING blocker 而响亮失败（fail-safe），不会静默通过。
- 两测试均验证 gate-PENDING-blocks-DRAFT 行为与真实 gate 状态解耦，修复合理。

### 3b. P2-1 闭环 commit `1a33128`（PASS，仅改 `scripts/harness/tests/test_harness.py`）
- `initialize` 在 IdlePlanningCheckpointTests 的 fixture 中播种 `GATE-FIXTURE`（PENDING，requiredFor TASK-1001），使 gate approval edge 可被检测。
- `approve_gate` fixture helper（test_harness.py:6628-6671）：构造 gate PENDING→APPROVED + repository-owner approval（含 decisionEvidence dict）+ nextAction 提交，支持 invalid_approval/extra_path 两种注入。
- 3 个新测试（test_harness.py:6682-6730）：
  - `test_accepts_single_gate_approval_edge`：`result == target` 断言 require 走通 gate edge（added=0 时若 gate edge 不触发，resolution require len(added)==1 必然失败 → 测试不可能假阳）。
  - `test_rejects_gate_approval_edge_with_invalid_approval`：approvedBy="agent" → 拒绝，错误含 "gate approval edge"。
  - `test_rejects_gate_approval_edge_with_extra_path`：extra.txt → 拒绝，错误含 "gate approval edge"。
  - 两个拒绝用例均断言错误文案含 "gate approval edge"，若 gate edge 分支被删除则文案变更为 resolution 报错 → 测试会响亮失败（fail-safe），非空转。
- 实测：`python -m unittest scripts.harness.tests.test_harness.IdlePlanningCheckpointTests -v` → **7/7 PASS（22.3s）**，既有 4 个 resolution-edge 测试（no_tail/serial、optional_next_action、merge/empty/split/multiple/extra、mode_contract）不受 GATE-FIXTURE 播种影响，确认 seed 未改变既有测试语义（GATE-FIXTURE 仅 gating TASK-1001，既有用例均 resolve/reject TASK-1001 故阻断随之解除）。
- diff 1041c5f..HEAD 最终仍为 4 文件（+214/-9），1a33128 仅触碰 test 文件，不影响 doctor 校验面。

### 4. backlog gate 内容（PASS）
- `.harness/task-backlog.yaml:159-193`：status APPROVED；approval 含 approvedBy=repository-owner、approvedAt="2026-08-07"（ISO date 有效）、evidence 非空、decisionEvidence dict。
- **decisionEvidence keys == requiredDecisions 精确**：3 项逐字一致；每项 `value`+`evidence` 均非空。
- HEAD 级 `validate_task_backlog_data`（`doctor.py:10920-10964`）要求 APPROVED gate 的 approval 字段集精确等于 BACKLOG_GATE_APPROVAL_FIELDS、approvedBy==repository-owner、decisionEvidence 覆盖全部 requiredDecision 且每项 value/evidence 非空——实测通过。

### 5. project-state nextAction（PASS）
- `.harness/project-state.yaml:11`：nextAction 含 "TASK-0034"（两次），无其他 TASK-#### 提及 → `mentioned == {TASK-0034} == {nextPromotable}`。

## Findings

### P0：0 条
### P1：0 条
### P2：1 条
- **P2-1 [已闭环，1a33128] 新增 gate edge 无直接单元测试**（`doctor.py:10105-10163`）：已由 commit 1a33128 补齐——`approve_gate` fixture + 3 个 IdlePlanningCheckpointTests 用例（合法接受 / 非 owner approvedBy 拒绝 / extra path 拒绝），实测 7/7 PASS，覆盖合法与两类非法形态，原 P2-1 升级为已解决。
- **P2-2 gate 批准身份无加密背书**（`doctor.py:10122`、`10927`）：`approvedBy=="repository-owner"` 仅为 YAML 内容比对，任何有提交权限者可伪造。与 harness 既有信任模型一致（resolution 的 `decidedBy` 同样为内容声明），且 HEAD 校验仍要求每项 requiredDecision 的完整决策证据，故不阻断本次 bootstrap；但该机制为永久可用原语，建议 Owner 将后续 gate 批准视为需线下核实的硬决策（或加每 gate 一次性 bootstrap 白名单）。

### P3：3 条
- **P3-1 doctor.py 例外无条件放行**（`doctor.py:10129-10135`）：`{"scripts/harness/doctor.py"}` 附加路径非一次性限定，未来任意 gate-approval commit 均可捆绑修改 doctor.py。风险低（普通任务 commit 本就可改 doctor.py），但建议以 commit-hash 白名单限定到 e126c12 单次。
- **P3-2 gate edge 跳过 backlog 历史一致性校验**（`doctor.py:10117` continue 之前）：gate edge 不调用 `validate_backlog_history_edge`/`validate_task_backlog_data` 校验 child backlog 全量，理论上可在 gate-approval commit 中顺带改动其他 backlog 字段；HEAD 级 `validate_task_backlog_data` 会兜底捕获任何持久化到 HEAD 的损坏，且 resolution edge 亦不校验 gate 数据。风险被兜底限制。
- **P3-3 两处不对称**：（i）`gate_next is None` 时 gate edge 不校验 nextAction（resolution edge 要求确定性 pause 文案，`doctor.py:10277-10280` vs 10154-10162）；（ii）idle + `target_commit` 时跳过 `validate_current_index_snapshot`（`doctor.py:16724-16731`），工作树非 harness 文件不再被 diff-scope 标记；TASK-0033 为 ledger v2 且 ledger 无 authorizationCommit，idle 终态 HEAD 检查（`validate_idle_terminal_history`）亦被跳过，此两点为既有限制被本改动延续而非新引入。

## 关键发现
- 实测当前 HEAD doctor PASS（419175 checks），gate 已解锁、nextPromotable=TASK-0034、无 blocker，bootstrap 目标达成且未破坏既有 resolution edge 与 active/pending 任务的 diff scope 行为。
- IdlePlanningCheckpointTests 独立实测 7/7 PASS：3 个新增 gate-edge 用例（合法接受、非 owner 拒绝、extra path 拒绝）均为非空转断言；既有 4 个 resolution-edge 用例不受 GATE-FIXTURE 播种影响。
- diff 截至 base=1041c5f 仅 4 文件；doctor.py 与备份对比无声明范围外改动；历史中两次被放弃的旧提交已 reset 干净。
- 主要残余风险集中在「gate 批准机制缺乏一次性约束（P3-1）」，不构成阻断。

## 一句话总结
gate-approval idle edge 实现正确、scope 截断安全、测试修复精准，P2-1 已由 1a33128 闭环且本 reviewer 独立复验 7/7 PASS，当前 HEAD 全量通过，可放行；建议后续将 doctor.py 例外收敛为一次性（P3-1）。
