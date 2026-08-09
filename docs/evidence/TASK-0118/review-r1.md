# TASK-0118 Independent Review R1

```yaml
taskId: TASK-0118
reviewerId: task0118_r1
reviewer: "Codex independent reviewer R1 (/root/check_audit_report)"
reviewedCommit: 7a6c01864db978fc5271491c1130723e11ad4ad9
candidateTree: 1450ddbc76992bab8607b2a2df27e6559e414d2a
baseCommit: f77198abd1514b1414b1999e48c3dc8fc4a6bb94
candidateParent: bdf5e474db20cdc9e6897d699d99c809b7d123ee
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

- HEAD、候选 Commit/Tree 和直接父提交分别精确匹配 `7a6c0186`、`1450ddbc` 和 `bdf5e474`。
- Base 至候选为无 merge 的单父五提交任务链：DRAFT、READY、授权绑定、IN_PROGRESS、候选实现；
  `authorizationCommit=937bfd1c4ba5925a91b2cfec11c43529a7d30012` 与历史一致。
- Context Lock 的 85 个 Base 输入 SHA-256 全部匹配；重算 fingerprint 为
  `a8cf6143b276fa1e747cb5b382efbf11078540d1c1c7ebecaaba8fdd6a4696c4`。
- 实现提交只修改两个 Anthropic 生产文件和三个授权测试文件，全部位于 writeAllowlist；没有 forbidden、
  公开协议、SizeLimits、OpenAI、runtime 生产、session/stream、specs、数据库、前端或 CI 变更。

## Acceptance Matrix

1. PASS：`AnthropicMessagesConfig` 定义独立 package-private 8192 上限，以无溢出的整数比较接受
   `1..8192` 并拒绝 0、负值、8193 与 `Integer.MAX_VALUE`；没有 silent clamp，错误不含敏感值。
2. PASS：`AnthropicMessagesCodec` 在序列化和 HTTP dispatch 前复用同一校验；合法值作为 JSON 数值
   原样写入，非法内部值归一化为无详情 codec failure。
3. PASS：runtime 生产调用链不变；config 构造发生在 registry register 之前。启用 deployment 的
   8193/`Integer.MAX_VALUE` fail-fast，8192 正常注册；disabled 在构造前跳过，master-off 仍由既有
   条件配置阻止整个 provisioner。
4. PASS：contract test 证明 1、1024、2048、8192 的实际请求 JSON 原值和成功事件链；非法 config
   构造使计数 HttpClient 保持零调用。共享 drain 同时验证 binding、连续 sequence、Usage、唯一且最后的 terminal。
5. PASS：私有上限没有复用 `SizeLimits.MAX_OPENAI_OUTPUT_TOKENS`；路由、secret 读取、messages/schema、
   authorization、streaming/session 和 response-side 边界均未改变。
6. PASS（Reviewer 前置部分）：候选允许进入正式门禁；Reviewer 未运行或声称 canonical、正式定向 reactor、
   root verify 或无参数 `git diff --check` 为 PASS。

## Iteration Evidence

评审时现存 Surefire 报告显示 Config 3/3、MaxTokens contract 2/2、Provisioner 11/11、master-off 1/1
通过。这些只作为迭代证据，不替代正式 requiredCommands。

## Gate Decision

PASS，允许对同一 Commit/Tree 执行任务卡冻结的四条正式 `requiredCommands`。
