# TASK-0233 R1 Independent Review

- reviewerId: task0233_r1
- kind: independent-review-gate
- reviewedCommit: a0914b1
- evidencePath: docs/evidence/TASK-0233/review-r1.md

## 复核范围

无历史聊天上下文，仅以 Base `e5d88e3` → 候选 `a0914b1` 的逐边 diff、冻结任务卡
`governanceContract` 与机器真源为输入。

## 结论

**APPROVE**。P0=0，P1=0，P2=0，P3=0。

## COMPLETE_MATRIX

- 实现范围恰为卡内 `governanceContract.exactPaths` 两条路径：`scripts/harness/doctor.py`
  （+224/-1）与 `scripts/harness/tests/test_harness.py`（+203）。无越界路径。
- 三组校验全部落地并接入 `validate_evidence_and_handoffs`：
  1. `validate_task0233_temporal_integrity`：startedAt ≥ anchor commit 时间；
     endedAt ≤ 终态提交时间 + 600s；readyDoctorPassAt ≤ IN_PROGRESS 提交时间 + 600s。
  2. `validate_task0233_commit_tree_binding`：candidateCommit/verifiedCommit 必须位于
     base..terminal 链（双向 is-ancestor）；candidateTree 必须等于 candidateCommit^{tree}。
  3. `validate_task0231_0232_invalidity_recognition`：0231 恒断言 REJECTED +
     resolutionReason 含「投影漂移」+ Evidence 保留真实 precheck FAIL exit 1；
     0232 恒断言 ACCEPTED + registry 绑定 0231 终态制品 blob/sha256 +
     handoff 声明 LOCAL_EXACT_TREE_FALLBACK 缺口。
- 激活锚 `fd87ac4`（本卡 bind 提交）；`task0233_is_activated` 仅对 baseCommit 为其
  后代的卡启用新校验 → 历史卡（14 张 + 0231/0232）不被重判，符合卡内
  `historicalCompatibility` 与 TASK-0196「撤回 blanket 重判」契约。

## ACCEPTANCE

- 负例矩阵 8/8 全部按预期 FAIL：temporal future endedAt、temporal predated
  startedAt、binding wrong tree、binding off-chain candidate、binding off-chain
  verified、recognition 0231 missing reason、recognition 0232 blob drift、
  recognition 0232 missing gap declaration。
- 正例 4/4 PASS：temporal positive、binding positive、recognition 0231 positive、
  recognition 0232 positive。
- 定向测试真实执行 `test_harness.Task0233GovernanceTemporalBindingTests`
  12/12 OK；全量 `doctor.py --summary` 真实 PASS 1154444 checks / exit 0 / 0 errors
  （实现提交 a0914b1 后），证明历史卡未因新校验出现任何新 error。
- canonical precheck 8 commands PASS（inner doctor 1154444 / 146.8s）。
- `git diff --check` exit 0。

## INVARIANTS

- INV-HARNESS-001/002/003：只改卡内精确 writeAllowlist 与 harness-change 批准的
  两条冻结路径；无 AGENTS.md/策略/Skill 改动。
- INV-HARNESS-005：新校验只新增 error，不转换任何既有 PASS/FAIL/NOT_RUN 记录。
- INV-HARNESS-007/009：本卡 validationPlan 冻结为 PRIMARY_REMOTE_EXACT_SHA；
  终态后按 Owner 授权推送专用恢复分支并做远端精确 SHA/Tree 复核。
- 0231/0232 未被追溯改写：diff 不含 `docs/evidence/TASK-0231/**`、
  `docs/evidence/TASK-0232/**`、`docs/handoffs/TASK-0231.json`、
  `docs/handoffs/TASK-0232.json` 或两卡的任务卡。

## ADJACENT_RISK

- 600s 容差是记录窗口（写 Evidence 到提交的间隙），不构成豁免：超容差即 error。
- 激活锚用 READY bind 提交而非终态提交：在本仓库严格单活动卡串行下，READY 之后
  直到本卡终态之间不存在其它卡，语义等价且更严格（更早生效）。
- `timedelta` 导入为唯一新增依赖，标准库内。

## 复核命令

- `git diff e5d88e3..a0914b1 --stat` / `-- scripts/harness/doctor.py`（逐行复核）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0233GovernanceTemporalBindingTests`（12/12 OK）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --summary`
  （PASS 1154444 / exit 0）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0233`
  （PASS 8 commands）
