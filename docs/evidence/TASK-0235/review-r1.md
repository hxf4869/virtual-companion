# TASK-0235 R1 Independent Review

- reviewerId: task0235_r1
- kind: independent-review-gate
- reviewedCommit: 0758f32
- evidencePath: docs/evidence/TASK-0235/review-r1.md

## 复核范围

无历史聊天上下文，仅以 Base `64889c9` → 候选 `0758f32` 的逐边 diff、冻结任务卡
`governanceContract` 与机器真源为输入。

## 结论

**APPROVE**。P0=0，P1=0，P2=0，P3=0。

## COMPLETE_MATRIX

- 实现范围恰为卡内 `governanceContract.exactPaths` 两条路径：`scripts/harness/doctor.py`
  （+177）与 `scripts/harness/tests/test_harness.py`（+140）。无越界路径。
- 三组校验全部落地并接入 `validate_evidence_and_handoffs`：
  1. `validate_task0235_accepted_evidence`：激活后 ACCEPTED 卡必须同时具备 READY
     Doctor PASS、canonical precheck PASS、pre-closure PASS 三个条目（exit 0）。
  2. `validate_task0235_gap_recognition`（恒启用，循环前调用一次）：TASK-0231
     quarantine JSON 的 LEGACY_VALIDATION_GAP_BATCH 恰好覆盖 14 个冻结 ID、
     每卡登记 preClosure=NOT_RUN、且 14 张卡当前 Evidence 的 pre-closure 条目
     仍为 NOT_RUN（未被追溯改写）。
  3. `validate_task0235_sources_of_truth_boundary`：激活后卡 sourcesOfTruth 必须
     含三个核心真源、不得引用 docs/source|decisions|planning、每个路径必须
     仓库内存在。
- 激活锚 `4ed3a78`（本卡 bind 提交）；历史卡不重判；gap 识别为正向前瞻断言。

## ACCEPTANCE

- 负例矩阵 6/6 全部按预期 FAIL：accepted 缺 pre-closure、accepted pre-closure
  NOT_RUN、gap registry 缺卡、gap preClosure 登记为 PASS、sot 引用 docs/source、
  sot 缺核心真源。
- 正例 3/3 PASS：accepted 三件套、gap 完整覆盖、sot 边界。
- 定向测试真实执行 `test_harness.Task0235AcceptanceEvidenceGovernanceTests`
  9/9 OK；TASK-0233/0234 回归 20/20 OK；全量 `doctor.py --summary` 真实
  PASS 1166236 checks / exit 0 / 0 errors（实现提交 0758f32 后），证明历史卡
  未因新校验出现任何新 error。
- canonical precheck 8 commands PASS（inner doctor exit 0 / 161.0s）。
- `git diff --check` exit 0。

## INVARIANTS

- INV-HARNESS-001/002/003：只改卡内精确 writeAllowlist 与 harness-change 批准的
  两条冻结路径；无 AGENTS.md/策略/Skill 改动。
- INV-HARNESS-005：新校验只新增 error，不转换任何既有记录；14 卡缺口断言是
  正向事实校验。
- INV-HARNESS-009：本卡通道冻结为 PRIMARY_REMOTE_EXACT_SHA；终态后推送、
  fetch、远端复核与正式 Doctor 释放绑定同 TASK-0234 流程。
- 历史制品零修改（diff 不含 docs/evidence/TASK-0231/**、docs/handoffs/TASK-0231.json
  或 14 张卡的任何路径）。

## ADJACENT_RISK

- gap 识别读 0231 quarantine JSON（groups 结构），0232 registry 的绑定一致性
  已由 TASK-0233 的 recognition 校验覆盖——两处互补，无重复判定。
- 激活后卡的 sourcesOfTruth 边界只约束「新卡」；历史卡卡面不重判。

## 复核命令

- `git diff 64889c9..0758f32 --stat` / `-- scripts/harness/doctor.py`（逐行复核）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0235AcceptanceEvidenceGovernanceTests`（9/9 OK）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0233GovernanceTemporalBindingTests
  test_harness.Task0234ExactTreeChannelGovernanceTests`（20/20 OK）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --summary`
  （PASS 1166236 / exit 0 / 0 errors）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0235`
  （PASS 8 commands）
