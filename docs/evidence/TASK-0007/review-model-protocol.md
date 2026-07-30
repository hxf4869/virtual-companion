# TASK-0007 Model Protocol 独立复核

```yaml
taskId: TASK-0007
reviewerId: codex-task0007-model-protocol-reviewer
kind: model-protocol-boundary
verdict: PASS
reviewedCommit: 10ac4d35aa29bebe5c6f13c444423602380e2074
reviewedTree: 9c1fd4f4e21bbc0397ad81710bdc14a4fa1b6d0b
```

## 结论

PASS，无阻断项。Reviewer 未参与实现，未修改、提交或推送文件，并将结论绑定到精确实现提交及其 Git Tree。

## 授权、范围与依赖

- 授权链、Context Lock、Skill 版本和逐父边 Diff Scope 合法，全部变更位于任务白名单。
- 依赖方向为 `tests → adapters → modelruntime → catalog`，Runtime 仍仅依赖 Catalog。
- 公共端口保持供应商中立，不暴露模型名、API Key、供应商异常、SDK 或 Session 类型。
- 生产代码不访问网络、文件、时钟或随机源，也不创建线程。

## 合同边界

- Binding 携带完整 Owner 元组、执行 ID 与 Fence；外部 Attempt 强制 requested/execution 双授权快照。
- Fence Gate 使用完整 Binding 值相等比较，任一身份或 Fence 不匹配均丢弃。
- Fake/Failure 均拒绝外部 Attempt Binding；事件序号连续、唯一终态、终态后无事件，取消与关闭幂等。
- EOS 只终止 Attempt/Session；实现中没有 Generation 完成、最终消息、`chat.completed` 或跨 Attempt 拼接路径。
- Fake 流测试只证明内部归一化事件顺序，没有声称 SSE framing 或主协议符合性。

## 独立复验

- `git diff --check cbcffad9e0fa7311baa3cf9ba91d0cef86336881 10ac4d35aa29bebe5c6f13c444423602380e2074`：PASS。
- 目标 Maven Reactor：Catalog 2 项、modelruntime 7 项、集中合同测试 28 项全部通过。
- 全仓 `clean verify`：PASS，从零编译共 73 项测试通过。
- `doctor.py --summary` 与 `doctor.py --task TASK-0007`：PASS，各 14,756 项检查。
- Catalog validate、drift 与统一 Python precheck：PASS。
- Maven dependency tree：PASS；确认 Runtime 无 Adapter 依赖。首次附加诊断因 PowerShell 参数未引用而退出 1，修正命令引用后退出 0。
- 禁止 API、供应商标识和 Generation 完成路径静态扫描：无实现命中。

## 明确未运行边界

- `NOT_RUN`：OpenAI Chat Completions、Anthropic Messages 真实 Adapter 及本地 mock-server SSE/framing 合同。
- `NOT_RUN`：两类主协议 `offlineContractRequirement` 与真实 Deployment `alphaLiveRequirement`。
- `NOT_RUN`：真实网络、模型、API Key、Provider Registry、区域和合同准入。
- `NOT_RUN`：数据库 `provider_attempt`、RLS、授权撤回、最终化事务及真实并发 Fence。
- Reviewer 未重复运行 PowerShell 与 WSL precheck 包装器；主 Agent 已在精确实现快照上独立运行并记录。
