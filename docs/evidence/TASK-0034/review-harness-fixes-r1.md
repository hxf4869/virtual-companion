# R1 独立复核：harness 修复（gate-approval companion edge + nextAction 放宽）

- 复核人角色：独立 R1 reviewer（未参与实现）
- 复核 commit：`672889b`（companion edge）+ `ddc98d1`（nextAction 放宽），diff = `d17f023..ddc98d1`
- 复核日期：2026-08-07
- 复核性质：C4 harness-change 独立复核（进入 TASK-0034 IN_PROGRESS 的前置闸门）

## Verdict：PASS（无 P0/P1）

独立 Reviewer 实测 `python -m unittest scripts.harness.tests.test_harness.IdlePlanningCheckpointTests -v` → **10/10 PASS（22.850s）**，含 3 个新增测试与既有 7 个 edge 测试全部绿色。两处修复逻辑正确、失败关闭、不变量未削弱。两条 P3 非阻塞发现记录于下。

## 逐项确认

### 1. 正确性（PASS）
- 分支顺序正确：gate 审批分支（`added==0 ∧ approved==1`）在前，companion 分支（`added==0 ∧ approved==0`）居中，resolution require（`len(added)==1`）兜底；三分支在 `added`/`approved` 轴上互斥。companion 判定失败时落回 resolution 报错且 `expected_parent` 不更新，双重复位。
- `required_for` 取值安全：list→set、非 list→空集；空集时 `allowed_next={gate_next}` 语义等价旧逻辑（严格更严而非更宽）。
- nextAction 放宽后仍收敛：`gate_next ∈ mentioned ∧ mentioned - ({gate_next} ∪ required_for) = ∅`。真实 gate2 审批 `d17f023` nextAction 提到 {TASK-0034, TASK-0035}、`requiredFor=[TASK-0035]`，新逻辑通过、旧逻辑必然失败——修复真实且必要。
- 关键验证：TASK-0034 卡 `baseCommit=ddc98d1`，完整链 `1041c5f→e126c12→40f59e9→1a33128→16c01b4→d17f023→672889b→ddc98d1` 在修复后逐 edge 全部合法。

### 2. 失败关闭（PASS）
- 越界路径全覆盖拦截：`.harness/**`、`AGENTS.md`、`skills/`、`docs/tasks/`、业务代码均不在允许路径集（`doctor.py` 精确 + `scripts/harness/tests/`、`docs/evidence/` 前缀），混入即拒绝（`test_rejects_gate_approval_companion_edge_with_extra_path` 实证）。
- state/backlog 全等比较为第二道防线，捕获路径计算漏洞。
- 非 idle 阻断：`child_state.activeTask`/`activeTaskCard` 任一非 None 即拒。

### 3. 不变量（PASS）
- INV-HARNESS-002/003/007 均未削弱；doctor.py 属保护路径仍须 skill+审查（本次即该机制）；交付策略机制未触碰。

### 4. 测试充分性（PASS，附 P3-1）
- `test_accepts_gate_approval_companion_edge`：正向、fail-safe。
- `test_rejects_gate_approval_companion_edge_with_extra_path`：边界负向，钉住白名单。
- `test_rejects_gate_approval_edge_next_action_extra_task`：负向钉住「不越界」下限。

### 5. 相邻风险（PASS）
- 三个调用点（baseCommit 边界、idle 终端历史、DRAFT 锚点）均匀受益；resolution edge 的 nextAction 校验未放宽，设计一致。

## Findings（非阻塞）

- **P3-1**：ddc98d1 的接受路径无正向单测——「nextAction 同时提到 gate_next 与**不同** requiredFor 任务并被接受」的场景未被单元测试覆盖（fixture 中 gate_next 与 requiredFor 恒同值）。回归会被真实仓库 doctor 运行立即暴露（校验 TASK-0034 baseCommit 链），故为覆盖增强点，非活动缺陷。
- **P3-2**：companion 判定接受父链上「任一」APPROVED gate 的 added==0 提交（比 docstring 描述宽），但路径白名单 + 全等比较 + activeTask 为空已充分兜底，无法变更任何治理状态。
