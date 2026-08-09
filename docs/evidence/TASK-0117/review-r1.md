# TASK-0117 Independent Review R1

```yaml
taskId: TASK-0117
reviewerId: task0117_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: ee4a503b3d2be4e9cea806ad5a2f9e92fbeb0b63
candidateTree: 387b86a59f683bef67845b4be417c41865898053
baseCommit: 714fcd328c88d2977b58619090f72f5be85e9a48
candidateParent: d51310b7c8e92528401ce39c2ca4080441b12208
riskClass: C3
verdict: PASS
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Verdict

PASS. Commit、Tree、直接父提交与冻结身份一致，工作树和 Index 干净。未发现阻止同一候选进入正式
门禁的 P0、P1、correctness、scope 或 invariant 问题。

## Identity And Governance

- HEAD、候选 Commit/Tree 和直接父提交分别精确匹配 `ee4a503b`、`387b86a5` 和 `d51310b7`。
- Base 至候选为单父线性五提交任务链：DRAFT、READY、授权绑定、IN_PROGRESS、候选实现。
- Context Lock 的 84 个 Base 输入 SHA-256 全部匹配；重算 fingerprint 为
  `b3dc4e598b3f4c095da6da0de41237c1e916a1e581a92594a030879f684fe742`。
- 逐父 Diff Scope 合法；实现提交只修改 Anthropic session 并新增独立 backpressure contract test，
  均位于 `writeAllowlist`，forbidden path 未变化。
- C3、`model-routing-change` Skill、保护规则和独立 Reviewer 要求均满足。

## Acceptance Matrix

1. PASS：`ArrayDeque` 配合同一 `stateLock`；最多 64 个待消费 OutputDelta，显式容量检查保证绝对
   不超过 67 个事件引用；第 65 个输出在释放锁的 `wait()` 中阻塞。
2. PASS：单 parser producer；consumer dequeue 后通知，producer 醒来后循环复核容量；队列修改、
   sequence 分配和 terminal 仲裁均在同一锁内，binding 不变。
3. PASS：满载 cancel/close 不等待空闲位置；先追加唯一取消终态，再于锁外关闭 I/O 并中断
   parser/worker；终态保持最后，重复操作幂等。
4. PASS：total timeout 可在 64 个输出后追加唯一 `Timeout(TOTAL)` 失败终态并中断背压等待，
   不产生 Usage/EOS 或 late delta。
5. PASS：`next()` 中断恢复 interrupt flag 后触发取消；terminal 后 `onStreamEvent` 返回 false，受控
   structured sentinel 场景证明终态边界后的 provider frame 未读。
6. PASS：structured streaming 和 non-stream success 在锁内预检并原子加入三事件；failure/cancel
   只需一个保留位，provider control frame 不分配 sequence。
7. PASS：生产代码只改 Anthropic session，测试只新增一个 backpressure contract 文件；OpenAI、
   modelruntime、SizeLimits、specs、runtime app、数据库、前端和 CI 无变化。
8. PASS（Reviewer 前置部分）：候选允许进入正式门禁；Reviewer 未运行或声称 canonical、正式定向
   reactor、root verify 或 `git diff --check` 为 PASS。

## Initial Test-Precision Notes

R1 初次报告提出两个非阻塞精度问题：是否有显式逐事件 sequence/binding、terminal 后 empty 断言，
以及 slow-consumer 场景是否足以证明一次 dequeue 最多放行一个 producer。候选未变化；这些问题交由
同一独立 Reviewer 的 R2 只读 finding-closure 核对，结果见 `review-r2.md`。

## Iteration Evidence

评审时现存迭代 Surefire 报告显示 Backpressure 7/7、Success 11/11、TimeoutCancellation 6/6 PASS。
这些仅是迭代证据，不替代正式 requiredCommands。

## Gate Decision

PASS，允许对同一 Commit/Tree 执行任务卡冻结的四条正式 `requiredCommands`。
