# TASK-0008 Generation Reducer 独立复核

```yaml
taskId: TASK-0008
reviewerId: codex-task0008-generation-reducer-reviewer
kind: generation-reducer-boundary
verdict: PASS
reviewedCommit: e0057cdec700fb730b48c66907c94429f2672c2b
reviewedTree: 5e5cb0c302fa2c4cfb11012d2f5af538090fafe4
```

## 结论

PASS，无阻断项或非阻断遗留项。Reviewer 未参与实现，未修改、暂存、提交或推送文件，并将结论绑定到精确实现提交及其 Git Tree。

## 范围、依赖与公共边界

- 变更只新增纯内存 `conversation` 模块、集中 Generation 合同测试及根 Maven 模块登记。
- 依赖方向为 `generation tests → conversation → modelruntime → catalog`；Runtime 未新增依赖。
- Production 代码没有网络、文件系统、Spring、JPA、JDBC、供应商 SDK、路由、重试、最终化或消息发布能力。
- `FrozenGenerationCandidate` 无公共构造器；其字符串表示不暴露模型正文、Binding 或授权快照标识。
- `AttemptOutcome` 明确为非持久化的本地归约结果，不承担 Provider 状态、路由、重试或最终化职责。

## 合同边界

- Reducer 使用完整 Binding、Fence 和连续 sequence 隔离一个 Attempt；不匹配或迟到事件无副作用。
- 文本只在同一 Binding 内拼接；结构化值只接受一次；混合内容、重复 Usage、空 EOS 和序号耗尽均失败关闭。
- Failed、Cancelled 和非法流会清除暂存内容且不生成 Candidate；成功 EOS 只冻结 Candidate，不推进 Generation。
- `GenerationStateRules` 显式穷举全部 14 个 Catalog 状态且无 `default`；6 个终态全部拒绝，8 个非终态原值保留。
- 内容地址严格使用 `SHA-256(type + NUL + UTF-8 content)`，不做 Unicode 规范化或 JSON Canonicalization。
- Candidate Set 校验完整 Ownership、Candidate ID 唯一，并只允许显式、幂等的单一选择。

## 独立复验

- `git diff --check 7bfa82399765ff9014d445eba0bcc4095d7d75d3 e0057cdec700fb730b48c66907c94429f2672c2b`：PASS。
- JDK 25 目标模块 `clean verify`：PASS，共 43 项测试。
- JDK 25 全仓 `clean verify`：PASS，共 107 项测试。
- `doctor.py --task TASK-0008`：PASS，共 18,262 项检查。
- Catalog validate 与 drift：PASS。
- Maven 依赖树与禁止边界静态扫描：PASS。

## 明确未运行边界

- `NOT_RUN`：真实 Provider、模型、网络、API Key、区域、合同准入或线上部署。
- `NOT_RUN`：OpenAI Chat Completions、Anthropic Messages HTTP/SSE Adapter 与本地 mock-server 主协议合同。
- `NOT_RUN`：数据库、Migration、RLS、Worker Lease/Fence、Outbox 与最终化事务。
- `NOT_RUN`：Runtime API、前端、实时 SSE、最终 Assistant Message 端到端。
- `NOT_RUN`：路由、重试、Fallback、配额、成本和安全政策。
- Reviewer 未重复运行独立 PowerShell 与 WSL precheck 包装器；主 Agent 已对精确实现快照运行并记录。
