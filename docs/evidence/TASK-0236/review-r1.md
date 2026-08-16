# TASK-0236 R1 Independent Review

- reviewerId: task0236_r1
- kind: independent-review-gate
- reviewedCommit: c91b5f4
- evidencePath: docs/evidence/TASK-0236/review-r1.md

## 复核范围

无历史聊天上下文，仅以 Base `ef7eddd` → 候选 `c91b5f4` 的逐边 diff、冻结任务卡
`governanceContract` 与机器真源为输入。

## 结论

**APPROVE**。P0=0，P1=0，P2=0，P3=0。

## COMPLETE_MATRIX

- 实现范围恰为卡内 `governanceContract.exactPaths` 两条路径：`scripts/harness/doctor.py`
  （+155）与 `scripts/harness/tests/test_harness.py`，外加卡 writeAllowlist 内的
  登记 JSON `docs/evidence/TASK-0236/task0235-evidence-gap-registry.json`。无越界路径。
- 缺陷登记 JSON 落地：0235 终态提交 ef7eddd、猜测 SHA 0758f322db42...、真实候选
  0758f32c1b.../tree 9dec374f、c06dbf6 坏 YAML (commit, path) 全部冻结。
- `validate_task0236_evidence_gap_recognition` 恒启用：断言 0235 Evidence 的
  checks 中猜测 SHA 缺陷事实保持 + 登记 JSON 存在且与 Doctor 冻结常量一致。
- 三处定向豁免全部以「登记存在」为前置（recognition 失败则 Doctor 必然 FAIL）：
  1. `validate_task0233_commit_tree_binding` 对 TASK-0235 跳过；
  2. `validate_authorized_task_history` 对 (c06dbf6, 0236 卡) 跳过解析；
  3. `first_task_state_commit_from_base`、authorization dominance 循环、
     `task_state_sequence`、`validate_task_state_graph` 对同一组合跳过。

## ACCEPTANCE

- 负例矩阵 4 项全部按预期：registry 缺失/漂移 → matcher FAIL；0235 evidence
  猜测 SHA 被改写 → recognition FAIL；豁免后绑定校验对 0235 不报错（正例）；
  真实候选与终态链关系逐项断言 PASS。
- 定向测试真实执行 `test_harness.Task0236EvidenceGapRecognitionTests`
  6/6 OK；TASK-0233/0234/0235 回归 29/29 OK。
- 全量 `doctor.py --summary` 真实 PASS 1175735 checks / exit 0 / 0 errors
  （实现提交 c91b5f4 后）——0235 不再产生绑定 error，全部历史卡无新 error。
- canonical precheck 8 commands PASS（inner doctor exit 0 / 166.1s）。
- `git diff --check` exit 0。

## INVARIANTS

- INV-HARNESS-001/002/003：只改卡内精确 writeAllowlist 与 harness-change 批准的
  两条冻结路径 + 本卡 Evidence 登记 JSON；无 AGENTS.md/策略/Skill 改动。
- INV-HARNESS-005：TASK-0235 的 3 errors 未被改成 PASS——它们由「缺陷登记 +
  定向豁免」取代，豁免的存在性本身成为恒启用断言；登记缺失即 FAIL。缺陷事实
  （猜测 SHA）仍原样保留在 0235 Evidence 中并被 Doctor 正向断言。
- TASK-0235 历史制品零修改（diff 不含 docs/evidence/TASK-0235/**、
  docs/handoffs/TASK-0235.json、0235 任务卡）。

## ADJACENT_RISK

- 豁免粒度精确到 (commit, path) 二元组与 TASK-0235 单卡，无通用 override。
- 本卡激活后新增提交若再次引入坏 YAML 不会被豁免（豁免只绑定冻结二元组）。

## 复核命令

- `git diff ef7eddd..c91b5f4 --stat` / `-- scripts/harness/doctor.py`（逐行复核）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0236EvidenceGapRecognitionTests`（6/6 OK）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0233GovernanceTemporalBindingTests
  test_harness.Task0234ExactTreeChannelGovernanceTests
  test_harness.Task0235AcceptanceEvidenceGovernanceTests`（29/29 OK）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --summary`
  （PASS 1175735 / exit 0 / 0 errors）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0236`
  （PASS 8 commands）
