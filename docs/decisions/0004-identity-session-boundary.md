# ADR-0004：先冻结供应商中立的身份与登录会话安全边界

- 状态：Accepted
- 日期：2026-07-30
- 决策范围：Technical Alpha 身份与登录会话安全边界

## 背景

首个业务纵切需要可靠识别当前用户，但仓库尚未选择 IdP、登录渠道、账号供给、会话生命周期或公开 API。既有机器真源已经确定了所有权隔离、H5 凭据保护、错误码、成本约束，以及公开注册、真实 Beta 和真实支付门禁。若直接开始登录实现，Agent 必须自行补出产品与安全参数，形成不可审计的隐含决策。

## 决策

1. 以 `specs/contracts/identity-session-boundary-contract.yaml` 作为身份与认证登录会话安全边界的唯一机器真源。
2. 认证登录会话、Conversation、实时恢复 Ticket 和记忆 `SESSION` 作用域是四类不同概念。前三类使用各自显式分型的标识；记忆 `SESSION` 是 Catalog 作用域代码而不是会话标识，四者不得混用。
3. 外部身份至少以不透明的 `provider + subject` 进入成熟身份组件适配器；内部 `owner_user_id` 只能由服务端验证后的受控映射产生。请求体、Header、query、路径参数或共享固定生产身份不得成为所有权真源。
4. 身份组件必须位于项目自有的供应商中立端口之后。项目不从零实现认证协议或认证核心，核心运行时也不得以商业软件许可证、托管身份专属能力、企业版、付费插件或仅托管 SaaS 能力作为前置条件。
5. H5 保留 `HttpOnly + Secure + SameSite` Cookie 偏好、状态变更 CSRF 防护、Origin 校验和长期 Token 禁止项；实时恢复 Ticket 继续保持 45 秒、单次使用、服务端只存 Hash 且不携带长期凭据。Ticket 的 45 秒 TTL 不定义认证登录会话 TTL。
6. 未建立有效服务端认证上下文时使用 `AUTHENTICATION_REQUIRED`；一般授权拒绝使用 `ACCESS_DENIED`；资源不存在或跨 Owner 访问统一使用 `NOT_FOUND_OR_FORBIDDEN`；年龄门禁不满足时使用 `AGE_VERIFICATION_REQUIRED`。本决策不新增 Catalog Code，也不定义 HTTP 映射。
7. `COMPOSITE_OWNERSHIP_AND_FORCE_RLS` 契约被整体继承且不得弱化，包括 `owner_user_id` 列、唯一 `(owner_user_id, id)` 目标、应用 Owner 谓词、复合所有权外键、FORCE RLS 和运行角色无 `BYPASSRLS`。身份、账号、年龄和会话数据不得进入普通日志、URL 或模型上下文。
8. Beta 生成只允许 `ADULT_VERIFIED`；`AGE_VERIFICATION_REQUIRED` 不得阻断任一年龄状态均允许的数据权利、年龄验证或申诉。
9. 公开注册、真实用户 Beta、真实支付和 Beta 生成默认门禁保持关闭；Alpha 仍只使用 Fetch-SSE，WebSocket 保持关闭。
10. `realtime-contract.yaml` 中既有 `ticket.boundTo.sessionId` 按认证登录会话标识解释；新契约只补充类型语义，不要求本任务改名，也不得把该字段解释为 Conversation ID 或记忆 `SESSION` 作用域。

## 有意延后的决策

- 正式 IdP、登录渠道及其部署方式；
- Technical Alpha 账号供给、首次登录建档与邀请流程；
- Cookie 或 Bearer 的具体架构、Cookie 参数和跨域方式；
- 会话 TTL、刷新、轮换、撤销、多设备和并发上限；
- Account 与认证会话状态 Catalog；
- 外部身份绑定、合并、解绑和删除同步；
- API 路径、HTTP 状态与错误包络；
- 年龄验证供应商和申诉流程。

这些事项必须在后续 READY 任务中由 Owner 明确。本 ADR 不为其提供默认答案。

## 结果

- 后续身份实现可以替换成熟 IdP，而应用所有权和凭据安全边界保持稳定。
- 在具体 IdP 与会话策略获批前，仓库不会提供可运行登录或创建真实用户。
- 身份提供方未配置或不可用、映射缺失或冲突、认证会话未知、上下文不完整或必需边界字段缺失时必须失败关闭，不得降级为客户端用户 ID、开发 Header 或共享生产身份。
- 首个生产者或消费者出现前必须符合新 Contract，因此当前不存在旧客户端兼容或迁移窗口。
