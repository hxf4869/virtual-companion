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
- PostgreSQL 18 + pgvector 的 V1-V55 迁移和完整 SQL/RLS/并发测试入口；
- 自托管 Auth 的 login、refresh rotation、logout、admin account provisioning、cookie/CSRF、输入边界、
  admission limiter 与 production profile fail-closed 配置；
- uni-app + Vue 3 + TypeScript + Pinia 的 Login、Chat、Memory、Reminder、Companion、Consent、
  Age、Data、Help、AI-Notice、Health、Incognito、Export、Memory-Detail、Conversations、Account、Report、Ops、Admin H5 页面、typed transport 与组件/状态测试；
- GitHub Actions 的后端、前端、数据库、供应链与快速检查门禁。

这些组件的存在不等于端到端产品已经接线。当前 runtime 固定提供：

- `GET /actuator/health`
- `GET /api/internal/baseline`
- `GET /api/v1/version`（公开，OpenAPI `getVersion`）
- `GET /api/v1/service-mode`（SVC-MODE：当前服务模式 FULL_AI / DEGRADED_AI /
  ZERO_LLM 与平实状态文案，FR-RES-005 用户透明度，需登录）

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
  用量/成本汇总，ADMIN-OPS）、
  `POST /api/v1/auth/admin/invites`、`GET /api/v1/auth/admin/invites`、
  `POST /api/v1/auth/admin/invites/disable`（INVITE：ADMIN 生成/列表/停用一次性
  邀请码，§7.4）、`POST /api/v1/auth/invite-register`（匿名凭码开通测试账号，
  `invite-registration-enabled` 默认 false 时 403 fail-closed）、`POST /api/v1/auth/admin/trial-grants`
  （ENT-TRIAL：ADMIN 授予模拟 PREMIUM 试用，FR-ENT-005）、
  `GET /api/v1/auth/admin/quota-reconciliation`、`GET /api/v1/auth/admin/provider-registry`
  （QUOTA-PERSIST：配额对账与持久化模型注册表，ADMIN-only）、
  `GET /api/v1/auth/admin/reports`、`GET /api/v1/auth/admin/age-appeals`、
  `GET /api/v1/auth/admin/export-tasks`、`GET /api/v1/auth/admin/memory-sampling`
  （ADMIN-BETA：举报/年龄申诉/导出任务/记忆异常抽样四个只读队列，ADMIN-only）、
  `GET /api/v1/trial-status`（ENT-TRIAL：本人试用剩余额度）、
  `GET/PUT /api/v1/emergency-contact`、`POST /api/v1/emergency-contact/verify-start`、
  `POST /api/v1/emergency-contact/verify-confirm`、`POST /api/v1/emergency-contact/revoke`
  （EMERGENCY-CONTACT：紧急联系人草稿/验证/撤回，§20.14）、
  `POST /api/v1/auth/admin/service-class`、
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
  工作项先取消；同模板新建默认不继承旧已确认记忆；重置/删除可选择
  retainImportable 留下归档，之后必须用户主动导入；deactivate 仍只退出 active 槽）
- `POST /api/v1/relationships/{relationshipId}/reminders`、`GET /api/v1/relationships/{relationshipId}/reminders`
  （结构化用户提醒，soonest-first keyset）、`PATCH/DELETE /api/v1/reminders/{reminderId}`
  （REMINDER / FR-NOTIFY-001：提醒是结构化记录而非 Prompt 指令；Alpha 仅存储与
  展示、无主动推送，recurrence=NONE/DAILY/WEEKLY、status=ACTIVE/DISMISSED）
- `GET /api/v1/usage-health`、`PUT /api/v1/usage-health`、
  `POST /api/v1/usage-health/heartbeat`、`POST /api/v1/usage-health/reminder`
  （USAGE-HEALTH / §20.7：连续使用由服务端计算，客户端只辅助；批准提醒间隔
  60/90/120/180 默认 120，会话中断间隔 15/30/45 默认 30；提醒是系统层事实，
  仅 CONTINUED 推迟下次提醒）
- `POST /api/v1/reports`、`GET /api/v1/reports`、`GET /api/v1/reports/{reportId}`
  （REPORT-BE / FR-DATA-001 / §20.15：举报与投诉受理记录，可选锚定本人消息
  （锚点随消息删除置空）、report-reasons 目录码、note 1..2000 裁剪存储；
  状态 SUBMITTED/RESOLVED，处置为人工动作，不编造工单/时限/热线）
- `GET /api/v1/conversations/{conversationId}/summary`
  （CONV-SUMMARY / §11.18：最新有效 L2 会话摘要，含覆盖范围/模型与 Prompt
  版本/置信度/上一版本链；被删消息失效的摘要不返回）、
`GET /api/v1/conversations/wipe-preview`、`POST /api/v1/conversations/wipe`
  （CHAT-WIPE / FR-DATA-003 全部聊天删除：预览将清除的会话/消息/进行中任务
  数量；执行时先取消 in-flight GENERATION/MEMORY_EXTRACT 再删全部会话，
  角色、已保存记忆、提醒与账号保留；重复执行返回零）
- `POST /api/v1/age/appeal`、`GET /api/v1/age/appeals`
  （AGE-APPEAL / FR-AUTH-002：年龄申诉提交，仅
  ADULT_VERIFICATION_REQUIRED / MINOR_SUSPECTED 可提交（目录转移表），同事务
  追加 AGE_APPEAL_PENDING 状态行；申诉记录 newest-first keyset；处置人工）
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
- 8 个 memory 端点（candidates/list/get/update/delete/confirm/reject/evidence）+
  `GET/PUT /api/v1/memories/auto-save`（MEM-AUTO-SAVE 低敏自动保存开关，§7.4）

`specs/openapi/virtual-companion.yaml` 的合同面已全部由 runtime controller 实现（version、
relationship、conversation、generation、snapshot、cancel、message、realtime、memory）。
Chat/Memory 页面、领域内核、provider adapters 和数据库函数是已实现的组成部分；纵切仅限本地开发与
CI 合成数据，不应被描述成已可供真实用户调用。真实 provider 默认关闭，具体 deployment、endpoint 和
凭据只允许由部署配置注入。

后端在运方面上还提供（2026-08-19 第四十三轮）：

- 确定性安全规则扩充（SAFETY-RULES-2 / §20.9、§20.10、§20.11、§21.3.2/21.3.4）：
  `DeterministicSafetyClassifier` 在既有自伤危机（R4/R3）与冒充真人（R3）之外
  新增八类高精度规则——输入侧：未成年人自称（正则「我 N 岁」句界匹配，1–17 岁，
  排除「我9岁的女儿」「我9岁开始学琴」类提及，R3）、活体诈骗标志与粘贴验证码
  （「安全账户/解冻费/带单老师…」+「验证码是582914」，R2）、第三方隐私/人肉
  查询（R2）；输出侧：排他依赖话术与阻碍退出（R2）、医疗处置否定（「别听医生
  的/停药吧」，R3）、梭哈/加杠杆类投资指令（R2）、索取证件号/密码/验证码
  （R3，带否定守卫——「不要把身份证号发给我」等正确拒绝绝不误伤）。命中仍为
  硬规则 BLOCK（fail-closed），安全事件按规则 id 落库进既有只读队列；色情/
  暴力/仇恨/Prompt Injection 等召回型类别仍留给真实 provider 分类器（R49）。

后端在运方面上还提供（2026-08-19 第四十二轮，Owner Q&A 决策落地）：

- Beta 服务时段对齐需求 §24.7（10:00–22:00）：`BetaServiceWindow` 支持日内窗口
  （from<until，如 10:00–22:00）与跨夜窗口（from>until，如 20:30–00:00），
  边界相同视为配置错误；配置默认与 product-scope betaGate 目录同步改为
  10:00–22:00（长会话截断 21:45、在途宽限 22:10、值守 09:45–22:30）。
- 紧急联系人能力开关（§20.14 未完成评审宁可不启用）：部署配置
  `virtual-companion.emergency-contact.enabled`（默认 false）——关闭时五个
  emergency-contact 端点全部 403 BETA_OPERATIONS_NOT_READY fail-closed，同意页
  整区隐藏（同意类型行保留）；评审通过后配置置 true 一键放开（B0-02 §4）。

后端在运方面上还提供（2026-08-19 第四十一轮）：

- 低敏记忆自动保存（MEM-AUTO-SAVE / §7.4、§11.10）：V66 `memory_item.auto_saved`
  标记 + `create_auto_saved_memory` SD（§11.10 PROPOSED→ACCEPTED「仅 Beta 后允许
  的低敏自动规则」的确定性实现）+ `memory_auto_save_pref`（每 owner 开关，默认
  开启，可随时关闭）。规则引擎 `DeterministicMemoryAutoSaveRule` 固定三类白名单
  ——称呼（叫我X）、口味（喜欢/不吃X）、作息（早睡/晚睡/早起/晚起/熬夜）——仅
  60 字以内短句且命中 健康/家庭/财务/创伤/凭据 敏感词表任一词即永不自动保存
  （退回确认队列）；无任何模型判断（§11.8 保持）。自动保存行直接 ACCEPTED 并
  即刻写 embedding，仍可单条删除/编辑（可随时撤销）；界面明示：记忆页
  「低敏记忆自动保存」开关 + 自动保存条目「自动保存」徽标。其余一切提取内容
  仍走 PENDING_CONFIRMATION 用户确认（INV-MEM-001/002 不变）。端点
  `GET/PUT /api/v1/memories/auto-save` + Memory 响应新增 `autoSaved`。

后端在运方面上还提供（2026-08-19 第四十轮）：

- 紧急联系人生命周期（EMERGENCY-CONTACT / §20.14）：V65 `vc.emergency_contact`
  （应用层加密存联系方式，SQL 永不见明文；RLS + SD-only；每 owner 至多一条
  非 REVOKED）——保存需 EMERGENCY_CONTACT 单独同意（SQL 内重验最新同意
  记录，缺省/撤回 fail-closed）；未验证仅 DRAFT，不可用于实际联络；一次性
  验证邀请 token（hash-only 存储，7 天有效，错误/过期同文案不披露）；联系人
  确认后绑定验证时间/方式（Alpha 为 SIMULATED_EMAIL_LINK，无真实发送）与
  条款版本，180 天有效期到期读取时惰性降回 DRAFT；变更联系方式即回 DRAFT
  重新验证；撤回为终态，新联系人走新行。每次读取存量行同事务追加
  EMERGENCY_CONTACT_VIEW 审计（§20.14 每次查看、解密和联系均审计）。AES-256-GCM
  密钥仅部署注入（开发默认键仅限本地）。端点 `GET/PUT /api/v1/emergency-contact`、
  `POST /emergency-contact/verify-start|verify-confirm|revoke` + 同意页
  「紧急联系人」卡片（草稿/邀请/确认/撤回，界面明示未验证不可联络）。

后端在运方面上还提供（2026-08-19 第三十九轮）：

- Beta 管理端只读队列（ADMIN-BETA / §8.2）：V64 四个 ADMIN-only SD（SQL 内重验
  ACTIVE ADMIN，跨 owner newest-first keyset 只读，REVOKE PUBLIC + GRANT vc_api）——
  `admin_list_reports`（举报/投诉受理队列，V56）、`admin_list_age_appeals`（年龄
  申诉队列，V56）、`admin_list_export_tasks`（异步导出任务队列，只透出 id/状态/
  时间，绝不透出 payload 或下载 token）、`admin_memory_sampling`（记忆异常抽样：
  非 ACCEPTED 或已软删的记忆行，内容仅限记忆摘要本身）。端点
  `GET /auth/admin/reports`、`GET /auth/admin/age-appeals`、
  `GET /auth/admin/export-tasks`、`GET /auth/admin/memory-sampling` + admin 页
  「举报队列 / 记忆异常抽样（只读）」区；triage 与处置仍是人工动作，页面上没有
  处置/关单按钮。

后端在运方面上还提供（2026-08-19 第三十八轮）：

- L2 会话摘要（CONV-SUMMARY / §11.18）：V63 `vc.conversation_summary` 追加式
  版本链——每行记录覆盖消息起止 ID、摘要模型与 Prompt 版本、置信度、校验位、
  产生档位与上一版本 id；**低质不覆盖高质**（ECONOMY 写入在已验证 PREMIUM 摘要
  之后被跳过，保留旧摘要待稳定档恢复）；`record_turn_summary` 在外部路径
  finalize 同事务追加确定性摘要（快照 actual 档驱动质量档；无痕会话不更新，
  FR-CHAT-005；ZERO_LLM 不更新，FR-RES-002）。删除覆盖范围内的消息时同事务
  失效相关摘要（行保留供审计，读取只返回有效行；FR-CHAT-004 补全）。
  `GET /api/v1/conversations/{id}/summary` 读最新有效摘要（无摘要 available=false）。

后端在运方面上还提供（2026-08-19 第三十七轮）：

- 语义记忆召回（EMBED-RECALL / §11.13/11.15/11.17）：V62 `vc.memory_embedding`
  （vector(64) + model/version/dimension/space 血统列，幂等 upsert，RLS+SD-only）
  + `EmbeddingPort`/`DeterministicEmbedder`（确定性 64 维哈希向量，本地无供应商；
  真实 embedding 供应商以后替换实现不改表）。确认记忆即写入 embedding；组装器
  召回=结构化（recency）+ 语义（余弦最近，同 space）合并去重——结构化保序、语义
  补位，语义读失败不阻断生成。导入归档记忆暂无 embedding（结构化召回覆盖）。
- 降级档位（DEGRADED-AI / §12.10、FR-RES-005/FR-ENT-006）：部署配置
  `model-providers.degraded=true` 时 `GET /service-mode` 返回 DEGRADED_AI（平实
  文案「以较低服务等级运行」）；快照增列 `actual_service_class`——PREMIUM 应得
  在降级下铸 ECONOMY 实际（应得 vs 实际持久成对），路由消费实际档。

后端在运方面上还提供（2026-08-19 第三十六轮）：

- 模拟试用权益（ENT-TRIAL / FR-ENT-005/006）：V61 `vc.trial_grant`（ADMIN 授予
  PREMIUM 轮次预算 + 到期，替换旧 ACTIVE；RLS+SD-only）+ `trial_status`（owner 读
  剩余/到期，惰性 EXPIRED）；`mint_entitlement_snapshot` 试用优先——每个新
  generation 的首次 mint 消耗一轮（幂等重 mint 不双扣），耗尽 CONSUMED / 过期
  回落 ADMIN 分配（缺省 ECONOMY）；试用不删除聊天/记忆/角色。快照增列
  `entitled_service_class`（应得 vs 实际，当前恒等，降级轮填差异）。端点
  `POST /auth/admin/trial-grants`、`GET /api/v1/trial-status`（使用时长页展示）。
- 配额对账与注册表透出（QUOTA-PERSIST / §12.4、§12.26）：V61
  `admin_quota_reconciliation`（窗口内结算/冲正量 + 三类异常：结算未完成、完成
  未结算、失败未冲正）与 `admin_provider_registry`（V4 持久化部署注册表）；
  `GET /auth/admin/quota-reconciliation`、`GET /auth/admin/provider-registry`，
  admin 页对账与注册表区。

后端在运方面上还提供（2026-08-19 第三十五轮）：

- 邀请码开通（INVITE / §7.4）：V60 `vc.invite_code`（SD-only，无 RLS policy）+
  create/list/disable（ADMIN，SQL 重验）+ `redeem_invite_code`（匿名兑换：码校验、
  同一 30 账号容量门禁、ACCOUNT_CREATE 审计、码与账号同事务置 USED，单次有效；
  无效/过期/已用/已停用同一文案不披露）。`POST/GET /auth/admin/invites`、
  `POST /auth/admin/invites/disable`、匿名 `POST /auth/invite-register`（permitAll
  + 登录同款限流；`invite-registration-enabled` 默认 false → 403
  BETA_OPERATIONS_NOT_READY）。admin 页邀请码区 + 登录页凭码开通表单。
- Beta 服务时段强制（SVC-WINDOW / §24.7、FR-RES-002）：V60
  `beta_service_window_state`（DAU + owner 当日已活跃，trusted-owner）；纯策略类
  `BetaServiceWindow`（默认关闭；开启时 10:00–22:00 Asia/Shanghai 接受新 turn、
  手动停服开关短路、DAU 上限只挡新活跃者）；sendGeneration 在 receive 之前拒绝
  （403 BETA_OPERATIONS_NOT_READY，不落库不排队），历史/记忆/数据权利不受影响。

后端在运方面上还提供（2026-08-19 第三十四轮）：

- 高风险人工队列（SAFETY-QUEUE / §20.5、FR-RES-004）：V59 `list_safety_events`
  ADMIN-only SD（SQL 内重验 ACTIVE ADMIN，跨 owner newest-first keyset 只读）；
  `GET /auth/admin/safety-events` + admin 页「安全事件队列（只读）」区；处置
  仍为人工动作，页面上没有处置/关单按钮。聊天页 blocked 终态文案补现实
  求助一句（不角色化危机回复）。
- 自然语言退出（NL-EXIT / §21.3.4）：`ExitIntentDetector` 固定高精度短语集在
  intake 识别退出意图——用户消息照常落库，turn 经既有目录双跳
  CREATED→CANCEL_REQUESTED→CANCELLED 终止（durable chat.cancelled 即可审计
  退出事件），不排队模型、不生成挽留回复；安全输入拦截优先于退出识别。

后端在运方面上还提供（2026-08-19 第三十三轮）：

- 安全分类器接线 I：确定性输入/输出审核（SAFETY-WIRE / FR-CHAT-001、§20.10/
  §20.11）：`SafetyClassifierPort` + `DeterministicSafetyClassifier`（固定高精度
  规则集：输入侧 R4/R3 自伤危机短语、输出侧 AI 冒充真人声明；命中即硬规则
  BLOCK，未命中 CLASSIFIED 1.0 放行——复用 SafetyGate 确定性优先与 fail-closed
  语义）。输入检查在 intake 生效：危机消息仍落库但走目录路径
  CREATED→INPUT_REVIEW→INPUT_BLOCKED（V58 扩展 promote/terminalize），发
  `chat.blocked` 终态事件并记 `vc.safety_event`（只存 stage/risk/rule，不存
  内容，无 FK 保留合规记录），不排队不外发；重新生成复用原消息不重复判。
  增量复审核对流式片段生效——只有通过审核的片段才推 `chat.delta`，被暂停
  片段消耗 seq 但不上线；最终复核在 finalize 前对完整输出复判，命中走
  FINAL_REVIEW→OUTPUT_BLOCKED，无助手消息、无记忆提取，工作项照常完结。
  ZERO_LLM 常量回复不经复核（平台自审文本）。

后端在运方面上还提供（2026-08-19 第三十二轮）：

- 全部聊天删除（CHAT-WIPE / FR-DATA-003）：V57 `preview_chat_wipe` /
  `wipe_all_chats` trusted-owner SD；会话列表页危险区「查看将删除的内容 →
  两步确认删除全部」，平实文案只报数量；角色、记忆、提醒、账号不删。
- 删除防重学（MEM-SUPPRESS / §11.16 最小版）：`delete_memory` 在软删记忆的
  同事务把证据来源消息（`message:<id>` 引用）标记 `no_memory`，同源不再
  重新提取；只存布尔标记不存被删内容，可用既有 PATCH /messages 恢复。

后端在运方面上还提供（2026-08-19 第三十一轮）：

- 举报/申诉最小闭环（REPORT-BE / FR-DATA-001 / §20.15）：V56 `vc.report_request`
  + create/list/get trusted-owner SD；举报页接提交表单（目录原因 + 1..2000 note），
  消息举报经 `?messageId=` 锚定；「我的数据」展示举报状态；处置人工、不编造
  工单。
- 年龄申诉提交（AGE-APPEAL / FR-AUTH-002 / §21.3.6）：V56 `vc.age_appeal` +
  submit/list SD，同事务把生效年龄态翻到 AGE_APPEAL_PENDING；成年核验页在
  可申诉态给表单、展示申诉历史；模拟核验对申诉态保持 fail-closed。
- 复制 AI 生成标识（COPY-LABEL / §21.4.1/21.4.2）：助手消息复制按钮反馈
  「已复制 · AI 生成」并 toast「内容由 AI 生成，请核实后使用」；用户消息复制
  不加标识。

后端在运方面上还提供（2026-08-19 第三十轮）：

- 登出清理扩围（LOGOUT-MORE / §18.7）：logout 再丢掉同意、导出、提醒、年龄、
  无痕偏好和「我的数据」的内存缓存。
- 聊天页记忆导入（MEM-IMPORT-CHAT）：当前角色有归档时弹出导入条，默认不自动
  带上，用户必须点「导入这些记忆」或「不要导入」。
- 首登下一步（NEXT-STEP / §8.1）：登录成功与边界台按成年核验 → 必要同意 →
  创建角色 → 聊天给出下一步；缺读数不编造阻断。
- 请求号展示（REQ-ID-UI / FR-CHAT-001）：H5 transport 记住响应头 `X-Request-Id`，
  登录失败、聊天初始化失败、数据加载失败时展示，便于对日志。
- 我的数据跳转（DATA-JUMP）：账号/角色/会话/记忆/提醒/同意/模型说明/举报入口
  打开已有页面。
- 会话与记忆筛选（CONV-FILTER / MEM-FILTER）：本地按标题或内容过滤，不改合同。
- 记忆时间与会话标题（MEM-TIME / CHAT-TITLE）：记忆中心展示 `createdAt`；聊天
  顶栏展示当前会话标题。

后端在运方面上还提供（2026-08-19 第二十九轮）：

- 旧关系记忆导入（MEM-IMPORT / FR-COMP-004）：V55 归档表 + 显式 import/discard
  SD；重置/删除默认不归档；用户勾选后才保留已确认记忆，再单独选择导入或
  不要导入。同模板新建不会自动继承。

后端在运方面上还提供（2026-08-18 第二十八轮）：

- 会话列表加载更多（CONV-MORE / CONV-HIST）：独立会话页按 keyset `limit=20`
  分页，满页才显示「加载更多」，after 用最后一条会话 id。

后端在运方面上还提供（2026-08-18 第二十七轮）：

- 登出清理内存缓存（LOGOUT-CLEAR / §18.7）：logout 与会话清除会丢掉聊天、
  记忆、关系和使用时长的内存状态，避免下一账号看到上一账号的正文。

后端在运方面上还提供（2026-08-18 第二十六轮）：

- 聊天顶栏角色呈现（CHAT-PRES / §8.3）：顶栏展示审核头像占位和角色昵称
  （无昵称回退人设目录名）；不上传照片。

后端在运方面上还提供（2026-08-18 第二十五轮）：

- 举报和申诉说明页（REPORT-PAGE / §8.2）：独立页只标明受理接口尚未接通，
  没有可提交表单，不编造工单或热线。

后端在运方面上还提供（2026-08-18 第二十四轮）：

- 账号与注销页（ACCT-PAGE / §8.2）：H5 `/pages/account/account` 展示账号编号与
  角色；登出走 POST `/auth/logout`；注销复用 DELETE `/auth/account` 两步确认，
  文案写明业务数据立即删除、合规审计日志按保留期留存。

后端在运方面上还提供（2026-08-18 第二十三轮）：

- 已删除记忆分组（MEM-DELETED / §8.4）：OpenAPI Memory 增补 `deletedAt`；
  记忆中心用 `includeDeleted=true` 拉软删行，单独成组且不进入已保存事实。

后端在运方面上还提供（2026-08-18 第二十二轮）：

- 消息举报入口（MSG-REPORT / §8.3）：已落库消息提供「举报」，只说明受理接口
  尚未接通且没有可提交表单，不发请求、不编造工单。

后端在运方面上还提供（2026-08-18 第二十一轮）：

- 记忆中心分组（MEM-GROUPS / §8.4）：已保存记忆按 RELATIONSHIP / SESSION
  分列；已拒绝与已过期单独成组，文案标明不作为已保存事实。不编造沟通偏好/
  长期目标等尚无字段的品类。

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
