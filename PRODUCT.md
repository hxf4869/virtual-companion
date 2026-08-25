# Product

<!-- impeccable:product-schema 1 -->

> 本文件于 2026-08-26 在 Owner 无需同步答复的前提下建立。带“假设”标记的内容来自
> 当前机器真源，尚未经过 D0 或真实用户验证；其余内容均为当前仓库已冻结的 Technical
> Alpha / Owner-only dogfood 事实。Owner 尚未逐条批准本文件，它在本轮只作为暂定产品
> 上下文；Owner 回来后的确认或更正优先。视觉方向不属于本文件。

## Platform

web

## Users

- 当前获准使用者只有仓库 Owner：一个内部账号，在本机单实例环境中通过 iPhone Safari
  和 Android Chrome 使用简体中文 H5。
- **待验证的产品假设**：主要面向 25–35 岁、晚间需要低压力倾听的职场成年人。
- D0 尚未完成；Owner-only dogfood 不代表目标人群已验证，也不形成真实用户 Beta 结论。

## Product Purpose

- **基于 Catalog 的产品假设**：通过文字对话提供低压力倾听，并以透明、可控的长期记忆
  让同一段陪伴关系保持连续。
- 当前 Technical Alpha 的成功仅指 Owner 能稳定完成核心旅程并发现问题，不代表产品、
  模型或运营已经可向真实用户开放。

## Positioning

- 当前产品不是通用助手或功能门户，而是一段单一、持续的 `gentle-listener` 陪伴关系。
- 差异化机制是实时文字对话与关系级记忆闭环：模型产生的记忆候选默认由用户确认，用户
  能查看来源、编辑、拒绝、删除或替代记忆。

## Operating Context

- Owner 在晚间和日常间隙通过手机 H5 继续或开始对话，必要时查看会话、确认记忆、管理
  提醒与隐私数据。
- 当前运行环境为 Owner Mac 上的本地单实例，H5 与 API 同源，手机经同一局域网访问。
- 当前主旅程为：登录与准入 → 成年状态 → 必要同意 → 建立唯一陪伴关系 → 聊天 →
  记忆确认；提醒、隐私、帮助与账号安全是次级任务。

## Capabilities and Constraints

- Technical Alpha 只支持文字 H5、HTTP Fetch-SSE、一个 active companion、一个
  `gentle-listener` persona，以及 `SESSION` / `RELATIONSHIP` 两种记忆范围。
- 必须持续明确 AI 非真人；服务状态、发送失败、恢复结果和安全边界必须如实呈现，不能
  伪造完成、联系人通知、人工处置时限或 Provider 能力。
- 禁止公开注册、真实支付、恋爱模式、语音、图片、WebSocket、真实用户 Beta、远端部署
  和生产发布；不得通过视觉重构暗示这些能力已开放。
- Alpha 提醒只存储和展示，没有主动推送。紧急联系人能力保持隐藏。成年状态由服务端
  决定，不能以客户端勾选替代。
- 真实 Provider、额度、价格、条款、处理区域、保留与训练使用均不得在界面中写死或
  杜撰；凭据、原始对话和真实账号数据不得进入仓库、日志、截图或测试产物。

## Brand Commitments

- `Virtual Companion / 虚拟陪伴` 是当前工作名称，不视为已完成品牌命名。
- 用户界面必须采用平实、尊重、不施压的简体中文，并持续保留“AI 陪伴 · 非真人”等
  透明度承诺。
- **开放决策**：正式品牌名称、Logo、插画风格和完整视觉识别尚未由 Owner 确认。

## Evidence on Hand

- 产品范围与用户假设：`specs/catalog/product-scope.yaml`。
- 当前实现、运行能力与发布状态：`README.md`、OpenAPI、Catalog、现有代码与测试。
- Owner-only dogfood 边界：`docs/decisions/0006-owner-only-local-dogfood-boundary.md`。
- 当前执行状态：`TODO.md` 的 `DOGFOOD-*` 段。
- 没有经验证的用户评价、商业数据、正式品牌资产或真实用户素材；后续设计不得编造。

## Product Principles

> 以下原则由当前 Catalog、实现边界与 Owner-only dogfood 目标推导，暂待 Owner 确认。

1. 对话优先：每个顶层页面服务于开始、继续或理解一段陪伴关系，而不是展示功能数量。
2. 记忆可信：说明记住了什么、为什么记住、来自哪里，并始终允许用户控制。
3. 复杂度渐进披露：高频任务直接可见，低频管理、安全和内部能力按上下文分组。
4. 状态如实：加载、离线、恢复、降级、阻断和失败都提供明确下一步，不用空白或假成功掩盖。
5. 边界可见但不喧宾夺主：安全、隐私和 AI 身份持续可达，同时不把工程控制台当作产品首页。

## Accessibility & Inclusion

- 当前主要设备为 iPhone Safari 与 Android Chrome；关键流程需支持触摸、键盘、字体放大、
  语义标签、焦点顺序、状态播报、减少动效，以及 VoiceOver / TalkBack 人工冒烟。
- 正常正文和关键状态不能仅靠颜色传达；危险操作必须有明确文本、预览与确认。
