# Virtual Companion

AI 虚拟陪伴系统的 Technical Alpha 单体仓库。身份会话、生成/记忆/安全领域内核、
PostgreSQL 持久化迁移、模型协议适配器和 uni-app H5 页面均已实现；Generation、Realtime、
Memory 的 HTTP 纵切（含异步 worker、Fetch-SSE 恢复流、记忆提取与召回闭环）已接通，但尚未达到
真实用户或生产发布条件。

## 快速开始

日常检查唯一入口（秒级仓库检查 + 前端测试与类型检查，1 分钟内）：

```bash
bash scripts/check.sh          # 全量
bash scripts/check.sh --quick  # 仅秒级仓库检查
```

后端（需 JDK 25）与数据库（OrbStack Docker）入口见下文「当前工程能力」。当前待办见
[`TODO.md`](TODO.md)；Agent 行为约定见 [`AGENTS.md`](AGENTS.md)。

## 当前工程能力

- Catalog、OpenAPI、关键技术契约和确定性生成物；
- Java 25 + Spring Boot 4.1 的 14 模块 Maven reactor，包含 Safety、Conversation、Model Runtime、
  Persistence 以及 Fake、Failure、OpenAI Chat Completions、Anthropic Messages adapters；
- PostgreSQL 18 + pgvector 的 V1-V54 迁移和完整 SQL/RLS/并发测试入口；
- 自托管 Auth 的 login、refresh rotation、logout、admin account provisioning、cookie/CSRF、输入边界、
  admission limiter 与 production profile fail-closed 配置；
- uni-app + Vue 3 + TypeScript + Pinia 的 Login、Chat、Memory、Reminder、Companion、Consent、
  Age、Data、Help、AI-Notice、Health、Incognito、Export、Memory-Detail、Conversations、Ops、Admin H5 页面、typed transport 与组件/状态测试；
- GitHub Actions 的后端、前端、数据库、供应链与快速检查门禁。

这些组件的存在不等于端到端产品已经接线。当前 runtime 固定提供：

- `GET /actuator/health`
- `GET /api/internal/baseline`
- `GET /api/v1/version`（公开，OpenAPI `getVersion`）
- `GET /api/v1/service-mode`（SVC-MODE：当前服务模式 FULL_AI / ZERO_LLM 与
  平实状态文案，FR-RES-005 用户透明度，需登录）

显式开启 Auth 及其 datasource 后，runtime 还提供：

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `DELETE /api/v1/auth/account`（ACCT-DELETE / FR-AUTH-004：自助注销，删除
  身份与全部业务数据并保留合规审计日志；注销墓碑使登录/刷新立即失效）
- `POST /api/v1/auth/admin/accounts`、`GET /api/v1/auth/admin/accounts`（账户列表）、
  `POST /api/v1/auth/admin/accounts/{accountId}/disable`（禁用，幂等；开通受
  betaGate maxEnabledAccounts=30 容量门禁约束）、`GET /api/v1/auth/admin/audit`
  （审计日志 keyset 分页，ADMIN-OPS）、`GET /api/v1/auth/admin/usage`（按日
  用量/成本汇总，ADMIN-OPS）、`POST /api/v1/auth/admin/service-class`、
  `GET /api/v1/auth/admin/service-classes`（ENT-SNAP 模拟权益分配 ECONOMY/PREMIUM，
  ADMIN-only，仅测试账号，绝不接订单）
- `POST /api/v1/relationships`、`GET /api/v1/relationships`、`GET/POST /api/v1/relationships/{relationshipId}`、
  `PATCH /api/v1/relationships/{relationshipId}`（COMP-CFG / FR-COMP-003：结构化角色配置，
  全量替换昵称/称呼/回复长度/主动程度/幽默/建议偏好/提醒许可/记忆共享范围/回避话题；
  目录码校验，名称只作标签）、
  `POST /api/v1/relationships/{relationshipId}/deactivate`（personaRef 按 persona-templates
  目录校验，当前唯一模板 gentle-listener，外部 provider 生成时注入其人设上下文与批准的偏好片段）、
  `GET /api/v1/relationships/{relationshipId}/clearance-preview`、
  `POST /api/v1/relationships/{relationshipId}/reset`、
  `DELETE /api/v1/relationships/{relationshipId}`（COMP-CLEAR / FR-COMP-004：预览将清除的
  会话/记忆/提醒数量；重置清除关系域数据但保留 Companion 行与结构化偏好；删除移除
  Companion 及关系域数据；账号级偏好不顺带抹掉；进行中 generation/memory-extract
  工作项先取消；同模板新建不继承旧已确认记忆；deactivate 仍只退出 active 槽）
- `POST /api/v1/relationships/{relationshipId}/reminders`、`GET /api/v1/relationships/{relationshipId}/reminders`
  （结构化用户提醒，soonest-first keyset）、`PATCH/DELETE /api/v1/reminders/{reminderId}`
  （REMINDER / FR-NOTIFY-001：提醒是结构化记录而非 Prompt 指令；Alpha 仅存储与
  展示、无主动推送，recurrence=NONE/DAILY/WEEKLY、status=ACTIVE/DISMISSED）
- `GET /api/v1/usage-health`、`PUT /api/v1/usage-health`、
  `POST /api/v1/usage-health/heartbeat`、`POST /api/v1/usage-health/reminder`
  （USAGE-HEALTH / §20.7：连续使用由服务端计算，客户端只辅助；批准提醒间隔
  60/90/120/180 默认 120，会话中断间隔 15/30/45 默认 30；提醒是系统层事实，
  仅 CONTINUED 推迟下次提醒）
- `GET /api/v1/incognito-pref`、`PUT /api/v1/incognito-pref`（INC-PREF /
  FR-CHAT-005：下次新会话是否默认无痕；不翻转已有会话）
- `PUT /api/v1/consents`、`GET /api/v1/consents`（CONSENT / FR-AUTH-003/005：
  版本化同意记录，追加式落库、生效态按类取最新一行；未批准类型 400 拒绝；
  撤回 MODEL_TRAINING 不影响基本聊天）
- `POST /api/v1/exports`、`GET /api/v1/exports/{exportId}`、
  `GET /api/v1/exports/{exportId}/download`（DATA-EXPORT / FR-DATA-002：
  异步导出入队 + 状态轮询 + 一次性强鉴权下载；READY 时状态响应携带短效
  downloadUrl，token 消费一次即失效，过期自动清除文件内容）
- `POST /api/v1/conversations`（INC-MODE：请求可带 `incognito` 在创建时明确开启
  无痕会话，标志冻结在会话行且不可事后翻转）、`GET /api/v1/conversations`（会话列表，
  keyset + 最后消息预览 + incognito 标记）、
  `DELETE/PATCH /api/v1/conversations/{conversationId}`（删除级联清理、重命名写入 title）、
  `POST /api/v1/conversations/{conversationId}/end`（END-TODAY：结束今天的对话，
  取消进行中 work item；无痕会话同时清空消息正文，预览不再露出原文；不删会话行、
  不删 Companion）、
  `POST /api/v1/conversations/{conversationId}/generations`（CHAT-MODE：请求可带
  `mode` = AUTO/LISTEN/DISCUSS/CASUAL 的轮次级对话模式，首次接收时冻结在 generation 行并按
  idempotencyKey 重入不覆盖，AUTO 保持人设默认；GEN-VER：`sourceUserMessageId`
  对已有用户消息重新生成，不插入第二条用户消息，新版本成为默认可见版本）、
  `GET /api/v1/messages/{messageId}/generation-versions`、
  `POST /api/v1/generations/{generationId}/select`（界面默认只显示选中版本）、
  `GET /api/v1/conversations/{conversationId}/messages`、
  `DELETE /api/v1/conversations/{conversationId}/messages/{messageId}`（MSG-DELETE
  单条消息删除：同事务清理指向该消息的 memory_evidence，已确认记忆条目保留，
  助手消息删除时 generation 链接 SET NULL）
- `GET /api/v1/generations/{generationId}/snapshot`（含 finalize 结算后的 usage：
  输入/输出 token）、`POST /api/v1/generations/{generationId}/cancel`、
  `POST /api/v1/generations/{generationId}/feedback`（FR-CHAT-003 生成反馈，每
  (generation, kind) 幂等一行，kind 按 message-feedback-kinds 目录校验）
- `POST /api/v1/realtime/tickets`、`GET /api/v1/realtime/streams/{generationId}`（Fetch-SSE
  恢复流；非终态 generation 保持连接并实时直推 `chat.delta` 增量，断线经 durable 事件与
  snapshot 恢复，缺失 delta 永不补齐；realtime 请求与 REST 一样支持 401 单次静默刷新重放）
- 8 个 memory 端点（candidates/list/get/update/delete/confirm/reject/evidence）

`specs/openapi/virtual-companion.yaml` 的合同面已全部由 runtime controller 实现（version、
relationship、conversation、generation、snapshot、cancel、message、realtime、memory）。
Chat/Memory 页面、领域内核、provider adapters 和数据库函数是已实现的组成部分；纵切仅限本地开发与
CI 合成数据，不应被描述成已可供真实用户调用。真实 provider 默认关闭，具体 deployment、endpoint 和
凭据只允许由部署配置注入。

后端在运方面上还提供（2026-08-18 第二十轮）：

- 聊天页 AI 非真人标识（CHAT-AI-LABEL / §8.3）：顶栏持续写明「AI 陪伴 · 非真人」，
  有当前关系时同时展示角色名称；不编造头像，服务是否可用仍只看已有服务状态行。

后端在运方面上还提供（2026-08-18 第十九轮）：

- 独立会话列表页（CONV-LIST / §8.2）：H5 `/pages/conversations/conversations`
  复用既有会话 list/rename/delete/end；可按关系筛选、打开指定会话、两步删除
  与结束今天的对话；404 不披露存在性。聊天页接受 `conversationId` 查询参数。

后端在运方面上还提供（2026-08-18 第十八轮）：

- 独立记忆详情页（MEM-DETAIL / §8.2）：H5 `/pages/memory-detail/memory-detail`
  复用既有 GET `/memories/{id}` 与 GET `/memories/{id}/evidence`；记忆列表改为
  「详情」跳转，不再行内展开来源；404/403 一律「未找到或无权访问」。
- 管理端只读运行与合规页（ADMIN-OPS-RO / §8.2）：ADMIN-only 的
  `/pages/ops/ops` 复用 GET `/service-mode` 与 GET `/version`，静态写明 Alpha
  不对真实用户开放、不公开注册、不真实支付；公告只复述服务状态摘要，不编造
  provider 健康、不角色化事故。

后端在运方面上还提供（2026-08-18 第十七轮）：

- 无痕模式设置（INC-PREF / FR-CHAT-005）：V54 `incognito_pref` 账号级「下次新会话
  默认无痕」；OpenAPI GET/PUT `/incognito-pref`；独立说明页写明无痕 ≠ 无必要安全
  记录；聊天页用该默认预置开关，已有会话标志仍冻结。

后端在运方面上还提供（2026-08-18 第十六轮）：

- 安全 Markdown 与流式节流（MD-SAFE / STREAM-THROTTLE / §18.6）：助手回复只渲染
  白名单节点，原始 HTML 当文本；超长段落/代码截断；流式 draft 50ms 节流。

后端在运方面上还提供（2026-08-18 第十五轮）：

- 聊天历史精确虚拟滚动（VIRT-SCROLL / §18.6）：固定高度滚动容器 +
  `computeVirtualWindow`，长会话只挂载可视行，滚动换窗，短列表仍全量渲染。

后端在运方面上还提供（2026-08-18 第十四轮）：

- 生成版本（GEN-VER / FR-CHAT-003）：V53 `generation.source_user_message_id` /
  `selected`；重新生成复用原用户消息、默认历史只显示选中助手版本；已完成兄弟
  版本不再二次入队 MEMORY_EXTRACT。聊天页「重新生成」与版本 chips。

后端在运方面上还提供（2026-08-18 第十三轮）：

- 连续使用提醒（USAGE-HEALTH / §20.7 / 21.3.3）：V52 `usage_health_prefs` /
  `usage_session` / `usage_reminder_event` + trusted-owner SD（GET 只读、
  heartbeat 续计、未批准间隔拒绝、owner 错配 fail-closed、仅 vc_api 可执行；
  SHOWN 只记审计、CONTINUED 才推迟下次提醒）；OpenAPI 四个 usage-health 端点；
  H5「使用时长」页改批准间隔；聊天页系统层横幅「继续使用 / 结束今天的对话」，
  不用角色口吻挽留。

后端在运方面上还提供（2026-08-18 第七轮）：

- 角色删除/重置（COMP-CLEAR / FR-COMP-004）：V49 `preview_relationship_clearance` /
  `reset_relationship` / `delete_relationship`（trusted-owner、存在性隐藏、先取消
  该关系下 PENDING/CLAIMED 的 GENERATION 与 MEMORY_EXTRACT work item）；重置保留
  Companion 行及结构化偏好（含呈现字段），删除再删关系行并由 FK CASCADE 清会话树、
  记忆与提醒；账号级同意等不被顺带抹掉；同 `personaRef` 新建不继承已确认记忆。
  角色设置页危险区先预览范围再二次确认，文案只陈述将清除的数量。

后端在运方面上还提供（2026-08-16 第六轮）：

- 对话模式（CHAT-MODE）：`SendGenerationRequest.mode`（AUTO/LISTEN/DISCUSS/CASUAL）经 V34/V51
  迁移冻结在 generation 行（幂等重入不覆盖）；组装器在外部 provider 分支把显式
  LISTEN/DISCUSS/CASUAL 翻译为固定的、经批准的轮次指令附加到人设 SYSTEM 块（AUTO 保持
  gentle-listener 默认倾听姿态），ZERO_LLM 确定性分支不受影响；前端输入区
  「自动/只听我说/一起聊聊/轻松日常」快捷模式 chips（FR-CHAT-002）。
- 生成反馈（FEEDBACK）：V35 `vc.generation_feedback` 表 + `record_generation_feedback`
  SD 函数（trusted-owner 断言、未批准 kind 拒绝、每 (generation, kind) 幂等且首个
  note 生效、不存在不披露）；OpenAPI `POST /generations/{id}/feedback`；聊天页完成/
  审查阻断后展示「太机械/忘记了/越界/事实错误/不安全」一键反馈；反馈行经
  generation_id 可关联 generation_route（模型/供应商）、provider attempt 与授权快照
  （A4 负反馈可关联验收口径）。
- 最小内部管理台读取（ADMIN-OPS）：V36 `identity_auth_event_list`（追加式审计日志
  keyset 读取）与 `admin_usage_summary`（按日 generation 数/结算 token/实际成本），
  均 ADMIN-only 且在 SQL 内重验 ACTIVE ADMIN（V31 模式）；OpenAPI
  `GET /auth/admin/audit`、`GET /auth/admin/usage`；admin 页新增用量成本表与审计
  日志列表（FR-ADMIN 阶段边界：Alpha 最小内部页面）。
- 单条消息删除（MSG-DELETE）：V37 `delete_message` SD（trusted-owner 断言、同事务
  清理 `message:<id>` 证据行、不存在返回 FALSE 不披露、仅 vc_api 可执行）；
  OpenAPI `DELETE /conversations/{id}/messages/{messageId}`；聊天页逐条消息两步
  确认删除（FR-CHAT-004 / FR-DATA-003）。
- 服务状态透明（SVC-MODE）：`GET /api/v1/service-mode` 返回当前
  FULL_AI / ZERO_LLM 与平实运维文案（provider 主开关决定；DEGRADED/SAFETY/
  MAINTENANCE 在 Technical Alpha 不可达且永不虚报）；聊天页顶部明文展示服务
  状态，绝不角色化事故（FR-RES-005）。
- 无痕会话（INC-MODE）：V38 `vc.conversation.incognito`（创建时冻结，
  `create_conversation` p_incognito、`list_conversations` 回传）；无痕会话的
  finalize 跳过 MEMORY_EXTRACT 入队（不产生长期记忆候选），召回既有记忆、安全
  检查与法定日志不受影响；前端创建新会话前可开关「无痕」、列表与当前会话显式
  标记并明文说明「无痕 ≠ 无必要安全记录」（FR-CHAT-005）。
- 结构化提醒模块（REMINDER）：V39 `vc.reminder` 表（FORCE RLS owner_isolation、
  关系级联删除、recurrence/status/text CHECK）+ create/list/get/update/delete
  五个 trusted-owner SD 函数；OpenAPI 四个提醒端点；前端新增「提醒管理」页
  （关系选择、创建表单、soonest-first 列表、完成/删除）并接入边界台与聊天页
  导航（FR-NOTIFY-001：提醒是结构化记录，模型不能仅在 Prompt 里「记住以后
  提醒」；Alpha 无主动推送）。
- 模拟权益快照（ENT-SNAP）：V40 `vc.service_class_assignment`（ADMIN 分配
  ECONOMY/PREMIUM，仅测试账号）+ `vc.entitlement_snapshot`（每轮不可变快照，
  UNIQUE owner+generation：重试解析同一快照、事后改级不重写历史）；组装器在
  守卫 prepare 事务内铸造快照并以快照类（替代硬编码 SIMULATED）进入确定性
  路由（A3-001/FR-ENT-004 路由审计）；admin 页新增权益分配区（分配表单 +
  注册表）。
- 版本化同意记录（CONSENT）：V41 `vc.consent_record`（追加式版本化表，FORCE
  RLS owner_isolation、8 类 type CHECK、version 1..64）+ `record_consent`/
  `list_consents` trusted-owner SD 函数（owner 上下文强断言、仅 vc_api 可执行、
  list 返回每类最新生效行，历史不重写）；OpenAPI `PUT/GET /api/v1/consents`
  （未批准类型 400 拒绝）；前端新增「同意管理」页（8 类同意目录 + 生效状态 +
  同意/撤回按钮，Alpha 演示版本固定「2026-08」，MODEL_TRAINING 注明撤回不
  影响基本聊天；FR-AUTH-003/005，授权快照执行时复核机制保持不变）。
- 异步数据导出（DATA-EXPORT）：V42 `vc.export_request`（FORCE RLS
  owner_isolation、status CHECK、payload 内联存储——Alpha 无对象存储）+
  create/count/complete/fail/get/consume/expire 七个 trusted-owner SD 函数；
  入队复用 V5/V25 worker 队列（DATA_EXPORT work item），运行时
  `DataExportWorkItemHandler` 聚合会话与消息（含逐条 aiGenerated 标识）、
  记忆、提醒与同意记录为 JSON 文档并封存短效一次性 token（默认 24h）；
  `vc.consume_export` 同语句消费 token，`vc.expire_stale_exports` 定时清扫
  过期行并清除 payload（FR-DATA-002：异步、短期有效、一次性/强鉴权、AI 内容
  标识、留痕、过期自动删除）；前端「我的数据」页只读汇总账号/关系/会话/
  记忆/提醒/同意与当前服务模式（FR-DATA-001，举报申诉未接通）；前端新增「数据导出」页（发起/刷新/下载 +
  内容预览，Alpha 手动轮询不自动轮询）。
- 账号注销（ACCT-DELETE）：V43 `vc.identity_account_delete`（自助注销 SD：
  仅删除本人 ACTIVE 账号，先落 ACCOUNT_DELETE 审计再删 `vc_user` 根行——
  级联清除身份、refresh 会话与全部业务数据；`consent_record` 补 owner FK
  级联；`identity_auth_event` 无 FK 保留为合规审计）；已删除/已禁用账号
  返回 FALSE 不披露；登录路径查无此用户、refresh 会话已级联删除，构成
  删除墓碑使恢复登录不可能；OpenAPI `DELETE /api/v1/auth/account`（同时
  清除会话 cookie）；边界台新增两步确认「注销账号」危险区，文案说明
  保留期与无法立即清除的合规日志（FR-AUTH-004）。
- 请求关联日志（REQUEST-ID）：`RequestIdFilter` 为每个 HTTP 请求生成或透传
  `X-Request-Id`（合法短 token 原样回显，否则服务端 UUID；非法头绝不入
  日志/响应），写入 MDC（`logging.pattern.level` 输出 `[req=...]`）并在
  响应头回显（CORS exposedHeaders 已放开）；FR-CHAT-001 的 request_id
  落地，跨请求排查链路（匿名/被拒/基线请求同样带 id，与 auth 开关无关）。
- 消息复制（MSG-COPY）：聊天页每条已持久化消息新增「复制」按钮——异步
  剪贴板 API 优先、legacy textarea 回退，纯前端无网络调用，按钮短暂显示
  「已复制」反馈（streaming 占位行不渲染）。
- 不记住负向标记（MEM-NEG）：V44 `vc.message.no_memory`（按需求 §16.2.5
  规格）+ `set_message_no_memory` trusted-owner SD（存在隐藏、可逆）；
  `vc.list_messages` 追加式重定义并透出 `out_no_memory`（DROP+CREATE 跨
  OUT 类型变更，权限重新收紧）；记忆提取 worker 跳过 no_memory=true 的
  用户消息，负向意图在源头生效、不被历史重提取；OpenAPI
  `PATCH /conversations/{id}/messages/{messageId}`（body {noMemory}）；
  聊天页用户消息新增「不记住/恢复记忆」按钮（assistant 消息无此操作）。
- 成年识别端口（AGE-MIN）：V45 `vc.age_verification`（追加式结果历史，
  仅存验证结果/年龄段/时间/供应商凭证，**不保存身份证号码**，9 状态
  CHECK 对应 age-states catalog）+ record/get trusted-owner SD；运行时
  独立 `AgeVerificationPort` 接口（供应商无关，避免绑定单一服务）+ 确定性
  `SimulatedAgeVerifier`（Alpha 演示：按 catalog 转移图
  AGE_UNKNOWN→SELF_DECLARED→VERIFICATION_REQUIRED→ADULT_VERIFIED 落历史，
  已认证幂等、未成年/申诉/暂停态 fail-closed）；`AgeStateTransitions`
  镜像 age-states.yaml 转移表并由测试钉死；OpenAPI
  `GET /api/v1/age/state`、`POST /api/v1/age/verification`；H5「成年核验」页
  读取状态并在可核验态走模拟核验（无「我已成年」勾选，未成年/申诉/暂停不发写，
  申诉提交接口尚未接通）
  （FR-AUTH-002，Beta 门禁依赖 ageStateRequired=ADULT_VERIFIED，Alpha 不
  开放真实用户）。
- 聊天列表虚拟滚动（VIRT-SCROLL）：§18.6 列表性能——历史消息按段加载
  （keyset load-more），固定高度容器按滚动位置只挂载可视切片加 overscan；
  不再用 200 条截断条丢掉更早的已加载行。
- 撤回失效快照（AUTH-RECHECK）：V46 `vc.withdraw_authorization_snapshots`
  （trusted-owner SD，把 owner 全部 ACTIVE 快照置 WITHDRAWN 并返回行数）；
  任一同意记录撤回（`ConsentService.record` granted=false）时在同事务
  失效全部 ACTIVE 快照——排队中的任务持有旧快照时，
  `ExecutionAuthorizationGuard` 在执行前 fail-closed 拒绝对外发送
  （FR-AUTH-005：撤回后未执行任务不得使用旧授权；新任务以撤回后的当前
  授权重新铸造快照）。
- 角色结构化配置（COMP-CFG）：V47 `vc.relationship` 偏好列 + `update_relationship_prefs`
  SD（trusted-owner、未批准目录码拒绝、名称控制字符/超长拒绝、回避话题去重排序）；
  OpenAPI `PATCH /relationships/{id}` 全量替换；组装器把目录码翻译为固定批准片段
  （昵称/称呼只作引号标签），`memoryShareScope=SESSION` 时召回只保留会话记忆；
  前端新增「角色设置」页（FR-COMP-003，A4 角色初始化）。
- 性别与形象呈现（COMP-PRES）：V48 `vc.relationship` 性别/头像列（默认
  NEUTRAL + AVATAR_NEUTRAL_01）+ `update_relationship_prefs` 全量替换（新目录码
  companion-presentation：CompanionGender FEMALE/MALE/NEUTRAL、CompanionAvatar 平台
  审核素材引用）；OpenAPI `PATCH /relationships/{id}` 增补 `gender`/`avatarRef`
  （FR-COMP-002：性别呈现与人格分离、所有角色固定成年人设定、头像只来自平台审核
  素材、第一版不支持上传照片）；组装器把性别翻译为固定批准片段（明示仅呈现、
  不改变行为/安全/记忆规则）；「角色设置」页增性别选择与平台素材头像选择
  （CSS 占位视觉，无照片上传）。

后端在运方面上还提供（2026-08-16 第五轮）：

- 生成重试/崩溃对账（V33）：`promote_generation` 幂等化使 RETRY-A 重试重跑 prepare 不再卡死
  generation；prepare 重跑闭合遗留 CREATED attempt intent 且 `chat.accepted` 不重复落库；
  调度任务周期清扫 work_item 已终态但 generation 仍 IN_PROGRESS 的孤儿（终态化为 FAILED_FINAL +
  `chat.failed`，前端有对应友好文案）。
- 上下文 token 预算（CTX-BUDGET）：`virtual-companion.generation.context-budget.*` 配置输入/
  输出 token 与轮次预算，组装器按确定性估算（UTF-8 字节/4）从最新消息回溯裁剪历史，召回记忆占
  输入预算三分之一。
- 采样参数部署配置（SAMPLE-CFG）：`model-providers.deployments[].temperature` 与 OpenAI 的
  `max-tokens` 由 codec 透传进每次请求（OpenAI 0..2、Anthropic 0..1，缺省 1.0）。

## 真实 provider 部署配置（Technical Alpha 默认关闭）

真实 provider 默认关闭：`virtual-companion.model-providers.enabled=false` 时 runtime 不装配任何
live provider，外部 attempt 在路由层 fail-closed（无 eligible deployment），且不读取任何凭据。
启用方式（凭据只允许部署配置注入，绝不进入仓库）：

- 模板：`ops/model-providers.example.yml`（结构与占位符，不含任何凭据）。复制为部署环境的
  `application-provider.yml` 或注入等效环境变量，逐项填写 endpoint/model 并置 `enabled: true`。
- 凭据注入（`ProviderSecretReader` 约定，二选一）：环境变量 `VC_MODEL_SECRET_<NAME>`
  （secret 名大写、`-` 改为 `_`），或 Docker secret 文件 `/run/secrets/<name>`
  （内容即 bearer token / API key）。`credential-secret` 字段只写 secret 名，永远不写值。

启用真实 provider 不改变发布门禁：真实用户 Beta 的前置条件（PIA、成年验证、值班、安全演练等）
未满足前不得对真实用户开放；凭据不得进入仓库、日志或提交。

后端需要 JDK 25：

```powershell
.\mvnw.cmd --batch-mode --no-transfer-progress verify
```

```bash
./mvnw --batch-mode --no-transfer-progress verify
```

前端使用 Node.js 22 和 pnpm 11：

```text
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend test:run
pnpm --dir frontend type-check
pnpm --dir frontend build
```

数据库全迁移与 SQL/RLS/并发测试使用 OrbStack Docker：

```bash
bash infra/db/run-rls-tests.sh
```

Windows + WSL2 Docker 的本机辅助入口位于 `scripts/dev/*.ps1`。这些脚本是该主机环境的便利工具，不是 macOS/Linux 的必要前置；其他平台直接使用 Maven Wrapper、pnpm 和 `scripts/check.sh`。

## 文档与历史档案

- 架构决策：`docs/decisions/`；技术基线：`docs/engineering/technology-baseline.md`
- 检查与流程设计原则：`docs/engineering/checks-principles.md`（新增任何检查前必读，防过度工程化复发）
- 仓库边界：`docs/architecture/repository-structure.md`；原始需求快照：`docs/source/`（仅历史来源）
- 机器契约：`specs/catalog/`、`specs/contracts/`、`specs/openapi/`；`specs/generated/**` 为生成物，禁止手改
- 2026-08-16 退役的旧任务治理体系（任务卡、Evidence、Handoff、账本）只读保留在
  `docs/tasks/`、`docs/evidence/`、`docs/handoffs/`、`docs/archive/`，仅供追溯
- 当前待办：[`TODO.md`](TODO.md)

## 安全与发布状态

当前只允许本地开发和 CI 使用合成数据。普通 profile 的 Auth 与 live provider 均默认关闭；production profile
要求 Auth 和 datasource 两个开关显式为 `true`：缺少任一配置或显式 `false` 都会启动失败（fail-closed，
由配置代码自身强制），但这不代表生产就绪。系统未开放注册、未启用真实支付、未授权保存真实用户数据。
generation/realtime/memory 纵切已接通，但仅限本地开发与 CI 合成数据，不面向真实用户。

Duty-roster 检查通过不等于 Beta 获批；`realUserBeta` 在 PIA、伦理适用性、成年人验证、责任人、值班和安全
演练形成证据前保持 `BLOCKED`，`realPayment` 在 Technical Alpha 保持 `FORBIDDEN`。真实 provider 外发还必须
满足授权快照、最终安全审查、持久化 quota/registry、部署和密钥治理等独立门禁。
