# TASK-0124 独立 C3 Intake-Failure Review R1

```yaml
taskId: TASK-0124
reviewerId: task0124_r1
verdict: FAIL
reviewedCommit: 2b34658fc6d7a5c2d8c9c4b0827c03ec27b96dc1
candidateTree: bac8ea7a88cb87830c0b12b0d7c4c491355acad0
```

- **Review Type**: `C3_INTAKE_FAILURE`
- **Base**: `68dc7f0a486e93768112fca856f9456cb7e31a2d`
- **reviewerRunsExpensiveFullTests**: `false`

## Findings

- **P0**: `0`
- **P1**: `1`
- **P2**: `0`
- **P3**: `0`

### P1-01：Context Fingerprint 错误，READY 授权不可执行

任务卡与 Context Lock 均声明 fingerprint
`6ac0b7d95a19f7456f20a9496a212deb364a0b1664de1d37a616d41e48d739d2`。独立核验 54 个 Base 输入的
SHA-256 均正确，但按 canonical `"\n".join(sorted(path + "=" + sha256))` 算法复算应为
`855d3fb37679a185be843c3843fb7a7e035f39c87f9ebd435694881265a6bb46`。声明值对应在 payload 末尾错误追加
一个 LF，与 READY Doctor 唯一错误完全一致。

`contextFingerprint` 是冻结的 authorization field；当前生命周期不允许 `READY -> DRAFT`。不得修改当前卡、
Context Lock、历史提交或复用 Task ID 追溯修正。

## Governance And Scope

- 历史是 Base -> DRAFT `a726a63a...` -> READY `952800e8...` -> binding `2b34658f...` 的严格单父链。
- DRAFT 只新增 card/Context，READY 只修改 card/project-state，binding 只填写 `authorizationCommit`。
- Base 到 reviewed HEAD 只有三个治理路径，无业务实现、测试、spec、生成物或范围外变更。
- HEAD/Tree 与冻结身份一致，工作树/Index clean；任务从未进入 IN_PROGRESS 或冻结业务候选。
- READY Doctor 真实 FAIL、exit 1、559435 checks；正式候选门禁均未运行。

## Decision

**FAIL。** TASK-0124 必须 REJECTED；Evidence 应记录 `candidateExecution: NOT_STARTED`，所有 candidate/time anchors
为 null 且不声称任何 PASS。后续只能通过 task-intake 新建永久 TASK-0125 并正确计算 Context fingerprint。
