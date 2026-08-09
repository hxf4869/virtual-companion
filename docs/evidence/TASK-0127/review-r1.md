# TASK-0127 Independent Review R1

```yaml
taskId: TASK-0127
reviewerId: task0127_r1
verdict: FAIL
reviewedCommit: 4a569e6abf499e56ea59b817f799e562fe455f9a
candidateTree: ee864e735df92f96d4dba707daf8aa2f4a714c90
baseCommit: 86389bd2fca56ec1f3afea638c5eda1869a12555
reviewerRunsExpensiveFullTests: false
```

## Findings

- **P0**: `0`
- **P1**: `0`
- **P2**: `2`
- **P3**: `0`

### P2-01 OpenAPI 未接线矩阵遗漏 version

README 列出 relationship、generation、message、snapshot 和 memory 合同面，却遗漏 OpenAPI 已定义、
runtime 同样没有 controller 的 `GET /api/v1/version`。这不满足“其余 route 明确标记为未接线”的验收。

### P2-02 Production 配置保证表述过度

README 声称 production profile 要求“开启” Auth 与 datasource；实际配置只强制两个环境变量存在，
显式 `false` 不会被拒绝。该文案把部署政策误述成代码强制保证。

## Verified Matrix

- health、baseline 与四个条件 Auth route 的 runtime 分类正确。
- V1-V15、15-project Maven reactor、Login/Chat/Memory、provider adapters 与 Beta/payment 闸门均准确。
- TASK-0090 与全部历史 Task/Evidence/Handoff 零 diff；后续 Evidence 标签和 append-only 规则准确。
- Context Lock 的 65 个 Base 输入与 canonical fingerprint 全部匹配；候选只修改 README。

## Decision

**FAIL。** 两项范围内 P2 必须在唯一 README fix batch 关闭；正式 requiredCommands 保持 PENDING。
