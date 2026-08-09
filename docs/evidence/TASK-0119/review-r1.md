# TASK-0119 Independent Review R1

```yaml
taskId: TASK-0119
reviewerId: task0119_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: 64df08d197972b551e79e7ed2b63b4ff2b13d1f0
candidateTree: 575fb720f56ab49e0479b2278fd6ab694facc43c
baseCommit: d112171e504ce86d8aa0e46cbd24cfc33559337e
candidateParent: de33a5c2b64073016459770dd25e3151f115638a
riskClass: C3
verdict: PASS
reviewerRunsExpensiveFullTests: false
canonicalPrecheckRunByReviewer: false
rootMavenVerifyRunByReviewer: false
```

## Verdict

PASS。Commit、Tree、直接父提交与冻结身份一致，工作树和 Index 干净。最终 findings 为
`P0=0，P1=0，P2=0，P3=0`，允许同一候选进入正式门禁。

## Identity And Governance

- HEAD、候选 Commit/Tree 和直接父提交分别精确匹配 `64df08d1`、`575fb720` 和 `de33a5c2`。
- Base 至候选为无 merge 的单父五提交任务链：DRAFT、READY、授权绑定、IN_PROGRESS、候选实现；
  `authorizationCommit=77939f3b1c3c89f44847a6f0fbc96f266e513478` 与历史一致。
- Context Lock 的 80 个 Base 输入 SHA-256 全部匹配；重算 fingerprint 为
  `ea364625ff88eab52cde5e31df3db5f7ccdc0bed2c2fc9a0c01fa8fb005a4946`。
- 实现提交只修改两个 Anthropic 生产文件、一个 decoder test，并新增一个 raw-budget contract test；
  全部位于 writeAllowlist，没有 forbidden、SizeLimits、BoundedInputStream、OpenAI、公开协议或 CI 变更。

## Acceptance Matrix

1. PASS：`AnthropicMessagesSession` 定义 adapter-private `8L * 1024 * 1024` streaming raw 上限，
   没有复用或修改 non-stream `SizeLimits` 常量。
2. PASS：`SseDecoder` 使用正 `long` 参数和全连接累计；每次真实 byte 读取后、处理前检查，exact 允许，
   one-over 仅读取 budget+1，违规 byte 不进入 parser/consumer，计数永不按 frame/data/control 重置。
3. PASS：data/event/comment framing、payload、CR、LF、CRLF、blank、empty-data 和 control 的每个实际 byte
   均经过同一计数点；EOF 不计数，`Long.MAX_VALUE` 边界不溢出。
4. PASS：raw overflow 抛无详情 `AnthropicCodecException` 并归一化为唯一 MalformedResponse；真实
   `IOException` 仍为 Disconnected，既有 SSE、strict UTF-8、unknown field 和 event/line fence 不变。
5. PASS：生产级测试覆盖 8 MiB exact 成功，以及合法 delta 后 control/raw flood one-over；读取精确
   budget+1、sentinel 未读、既有 delta 保留、无 Usage/EOS、body close，binding/sequence/terminal 不退化。
6. PASS：cancel/close、first-token timeout、已有内容后的 total timeout 均用受控阻塞流覆盖，终态
   first-wins、重复操作幂等、body 关闭且终态后无 late event。
7. PASS（Reviewer 前置部分）：候选允许进入正式门禁；Reviewer 未运行或声称 canonical、正式定向 reactor、
   root verify 或无参数 `git diff --check` 为 PASS。

## Iteration Evidence

评审时现存 Surefire 报告显示 `SseDecoderTest 15/15`、
`AnthropicMessagesRawBudgetContractTest 5/5` 通过。这些只作为迭代证据，不替代正式 requiredCommands。

## Gate Decision

PASS，允许对同一 Commit/Tree 执行任务卡冻结的四条正式 `requiredCommands`。
