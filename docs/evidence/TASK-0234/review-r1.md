# TASK-0234 R1 Independent Review

- reviewerId: task0234_r1
- kind: independent-review-gate
- reviewedCommit: b425898
- evidencePath: docs/evidence/TASK-0234/review-r1.md

## 复核范围

无历史聊天上下文，仅以 Base `494146b` → 候选 `b425898` 的逐边 diff、冻结任务卡
`governanceContract` 与机器真源为输入。

## 结论

**APPROVE**。P0=0，P1=0，P2=0，P3=0。

## COMPLETE_MATRIX

- 实现范围恰为卡内 `governanceContract.exactPaths` 两条路径：`scripts/harness/doctor.py`
  （+308）与 `scripts/harness/tests/test_harness.py`。无越界路径。
- `validate_task0234_exact_tree_channel` 落地并接入 `validate_evidence_and_handoffs`
  的 ACCEPTED/REJECTED 分支（0233 校验之后），且 `validate_evidence_and_handoffs`
  新增 `allow_uncommitted_terminal` 参数由主流程 `args.pre_closure` 传入。
- 激活判定复用 `task0233_is_ancestor(TASK_0234_ACTIVATION_COMMIT=f8cc840, base)`；
  特判卡（TASK-0064/0066/0067/0074/0075/0076/0077）豁免；历史卡不重判。
- LOCAL_EXACT_TREE_FALLBACK：要求 validationChannels 完整记录——policy/channel
  绑定、OWNER_SUPPLIED_QUOTA_EXHAUSTED 强类型 6 字段、results 覆盖 20 个
  resultRecordRequiredFields、notCovered 显式存在。
- PRIMARY_REMOTE_EXACT_SHA：`allow_uncommitted_terminal` 时豁免（pre-closure
  暂存态在推送前）；提交态要求 remote-tracking ref 存在、tip 本地可达、
  evidence.headCommit 是 tip 祖先（候选已真实推送到恢复分支）。

## ACCEPTANCE

- 负例矩阵 6/6 全部按预期 FAIL：fallback 缺 validationChannels、fallback 缺
  receipt 字段、fallback 缺强类型远端证据、fallback 缺 notCovered、primary
  未推送 headCommit、primary 缺 remote-tracking ref。
- 正例 2/2 PASS：fallback 完整记录、primary 暂存态豁免。
- 定向测试真实执行 `test_harness.Task0234ExactTreeChannelGovernanceTests`
  8/8 OK；TASK-0233 测试回归 12/12 OK；全量 `doctor.py --summary` 真实
  PASS 1160307 checks / exit 0 / 0 errors（实现提交 b425898 后），证明历史卡
  与特判卡未因新校验出现任何新 error。
- canonical precheck 8 commands PASS（inner doctor exit 0 / 152.4s）。
- `git diff --check` exit 0。

## INVARIANTS

- INV-HARNESS-001/002/003：只改卡内精确 writeAllowlist 与 harness-change 批准的
  两条冻结路径；无 AGENTS.md/策略/Skill 改动。
- INV-HARNESS-005：新校验只新增 error，不转换任何既有记录。
- INV-HARNESS-009：本卡验证通道冻结为 PRIMARY_REMOTE_EXACT_SHA；终态后推送
  恢复分支、fetch 并跑正式 Doctor 验证 PRIMARY_REMOTE_RELEASE_BOUND。
- 历史制品零修改（diff 不含任何 docs/evidence/TASK-*、docs/handoffs/TASK-*、
  docs/tasks/TASK-0231/0232/0233 路径）。

## ADJACENT_RISK

- 远端校验依赖本地 remote-tracking ref 的新鲜度；正式 Doctor 前必须 fetch。
  缺失时错误信息明确指示 push + fetch，不会静默通过。
- 激活锚为 bind 提交 f8cc840（与 TASK-0233 同一先例：严格单活动卡串行下
  等价于终态激活）。

## 复核命令

- `git diff 494146b..b425898 --stat` / `-- scripts/harness/doctor.py`（逐行复核）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0234ExactTreeChannelGovernanceTests`（8/8 OK）
- `PYTHONPATH=scripts/harness:scripts/harness/tests python -m unittest
  test_harness.Task0233GovernanceTemporalBindingTests`（12/12 OK）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/doctor.py --summary`
  （PASS 1160307 / exit 0 / 0 errors）
- `PATH=/Users/hxf/.zcode/venvs/vc-harness/bin:$PATH python scripts/harness/precheck.py --task TASK-0234`
  （PASS 8 commands）
