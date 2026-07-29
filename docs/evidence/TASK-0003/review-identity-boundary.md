# TASK-0003 身份与登录会话边界独立复核

```yaml
taskId: TASK-0003
reviewerId: codex-identity-boundary-reviewer
kind: security-contract
verdict: PASS
reviewedCommit: 3645416657455a54b00725d77b3d7043c51e394b
reviewedTree: f9b9f7e83ae6e8e6fb2cb1f8346c691b9d1f0630
```

## 结论

PASS，无 P0/P1 阻断项。Reviewer 未参与文件修改，并将结论绑定到精确实现提交及其 Git Tree。

## 失败场景核验

- 客户端伪造请求体、Header、query、路径中的 `owner_user_id` 不能建立所有权；所有权只能来自服务端验证后的受控映射。
- IdP 未配置、外部身份不可验证、映射缺失或冲突、认证会话未知、上下文不完整或边界字段缺失均失败关闭，不降级到开发 Header 或共享固定生产身份。
- 用户资源不存在和跨 Owner 访问统一使用 `NOT_FOUND_OR_FORBIDDEN`，并完整继承 Owner 谓词、复合所有权外键、FORCE RLS 与无 `BYPASSRLS` 要求。
- H5 长期 Token 禁止进入 `localStorage`、URL、query 和实时连接参数；Cookie 偏好、CSRF、Origin 及 45 秒单次 Hash-only Ticket 边界均保留。
- 商业软件许可证、managed-identity-only、企业版、付费插件和 hosted-SaaS-only 能力均不得成为核心运行前置。

## 一致性核验

- 记忆 `SESSION` 是 Catalog 作用域代码，不是会话 ID；认证会话、Conversation 与实时 Ticket 使用各自类型化标识。
- `realtime-contract.yaml` 的旧 `ticket.boundTo.sessionId` 只补充为认证会话引用语义，没有暗改字段或迁移窗口。
- Beta 生成只允许 `ADULT_VERIFIED`，但数据权利、年龄验证和申诉不会被年龄门禁阻断。
- 公开注册、真实用户 Beta、真实支付、Beta 默认生成和 WebSocket 门禁均未放宽。
- IdP、登录渠道、账号供给、Cookie/Bearer 架构、会话 TTL/撤销、多设备、状态 Catalog、API 和年龄供应商仍是显式延后决策，没有隐含默认值。

## 独立复验

- `git rev-parse 3645416657455a54b00725d77b3d7043c51e394b^{tree}`：`f9b9f7e83ae6e8e6fb2cb1f8346c691b9d1f0630`。
- 精确提交为单父提交，只新增 ADR-0004 与身份/会话边界 Contract。
- 提交中的 YAML 解析通过。
- `git diff --check 3645416657455a54b00725d77b3d7043c51e394b^ 3645416657455a54b00725d77b3d7043c51e394b`：PASS。

## 非阻断边界

本次只冻结供应商中立的安全边界，不提供可运行登录。正式 IdP、公开 API、账号与认证会话状态、生命周期及持久化仍需后续 Owner 决策和独立 READY 任务。
