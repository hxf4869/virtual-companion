# TASK-0115 Independent Review R1

```yaml
taskId: TASK-0115
reviewerId: task0115_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: b9fb4a3f4f65fdc8a88edd1a6721005a33821f36
candidateTree: eab31c2b9329c6527a83d530962a64b3479924d6
baseCommit: ffc838cad053873d3fca2668de4e039475823c7c
candidateParent: 618c6e1efc366bd26636369b114af026c0bdff6a
riskClass: C3
verdict: PASS
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Verdict

PASS. Commit、Tree、直接父提交与冻结身份一致；工作树和 Index 干净。未发现阻止候选进入正式门禁的
P0、P1、P2、P3、correctness、acceptance、scope 或 invariant 问题。

## Findings

- P0：无。
- P1：无。
- P2：无。
- P3：无。

## Identity And Governance

- HEAD、候选 Commit/Tree 和直接父提交分别精确匹配 `b9fb4a3f`、`eab31c2b` 和 `618c6e1e`。
- 工作树和 Index 干净；Base 至候选为线性五提交任务链：DRAFT、READY、授权绑定、IN_PROGRESS、候选实现。
- Context Lock 的 89 个 Base 输入 blob SHA-256 全部匹配；重算指纹为
  `f39dbd9d7131cea9e72f11aad5c561a6660db446dcc26df543e25c3b52bbe0b8`。
- 逐父边 Diff Scope 合法；实现提交只修改任务 `writeAllowlist` 中的累计器、OpenAI、Invoker 与测试路径。
- 未修改 forbidden paths、历史 TASK-0109 至 TASK-0114、Anthropic、SizeLimits、specs、数据库、runtime app、前端或 CI。
- C3 `model-routing-change` Skill、独立 Reviewer 与保护规则均满足。

## Acceptance Matrix

1. PASS：`SizeLimits` 常量和完整字符串语义未改；累计器的成功状态等价于已接受 chunk 拼接后的 UTF-8 字节数，拒绝原子且状态不变。
2. PASS：direct tests 覆盖 ASCII、同 chunk 非 BMP、跨 chunk pair exact/one-over、多 pair、空 chunk、孤立和畸形 surrogate、null 与负 maximum。
3. PASS：OpenAI streaming text 的跨 delta exact 成功，one-over 在 offending delta 前失败，无违规 delta、Usage/EOS，body 关闭且后续 sentinel 不读取。
4. PASS：OpenAI structured streaming 复用同一累计器；跨 delta overflow 不形成成功 payload，只产生既有 MalformedResponse。
5. PASS：LiveModelInvoker text/structured exact 成功；one-over 显式 cancel，返回 ZERO_LLM、MalformedResponse、NON_RETRYABLE_FAILED audit，并按 ALL_FAILURE 恢复 quota。
6. PASS：多个跨 delta pair 无累计漂移；空 delta 保留 pending high surrogate；孤立或连续畸形 surrogate 与完整拼接计数一致。
7. PASS：生产代码变更仅限累计器、OpenAI session 与 LiveModelInvoker；Anthropic、SizeLimits、specs、runtime app、数据库、前端和 CI 未变更。
8. PASS（Reviewer 前置部分）：候选可进入正式门禁；Reviewer 未运行或冒充四条冻结 requiredCommands。

## Iteration Evidence

评审时现存相关 Surefire 报告共 241 项，`failures=0 errors=0 skipped=0`。新增重点为
`Utf8ByteAccumulatorTest` 6 项、`LiveModelInvokerTest` 26 项和
`OpenAiChatCompletionsBoundaryContractTest` 32 项。它们仅是实现迭代证据，不等同于正式 targeted
reactor、root verify、canonical 或 `git diff --check`。

## Residual Risk

Anthropic `maxTokens` 仍只有正值约束；OpenAI/Anthropic 事件 queue 与 backpressure 仍无界；连续
comment/empty-data frame 没有连接级累计 raw byte 预算。它们均在本卡范围外，候选未错误宣称关闭。

## Gate Decision

PASS，允许对同一 Commit/Tree 执行任务卡冻结的四条正式 requiredCommands。
