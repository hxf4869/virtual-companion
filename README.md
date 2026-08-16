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
- PostgreSQL 18 + pgvector 的 V1-V41 迁移和完整 SQL/RLS/并发测试入口；
- 自托管 Auth 的 login、refresh rotation、logout、admin account provisioning、cookie/CSRF、输入边界、
  admission limiter 与 production profile fail-closed 配置；
- uni-app + Vue 3 + TypeScript + Pinia 的 Login、Chat、Memory、Reminder、Consent、
  Admin H5 页面、typed transport 与组件/状态测试；
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
- `POST /api/v1/auth/admin/accounts`、`GET /api/v1/auth/admin/accounts`（账户列表）、
  `POST /api/v1/auth/admin/accounts/{accountId}/disable`（禁用，幂等；开通受
  betaGate maxEnabledAccounts=30 容量门禁约束）、`GET /api/v1/auth/admin/audit`
  （审计日志 keyset 分页，ADMIN-OPS）、`GET /api/v1/auth/admin/usage`（按日
  用量/成本汇总，ADMIN-OPS）、`POST /api/v1/auth/admin/service-class`、
  `GET /api/v1/auth/admin/service-classes`（ENT-SNAP 模拟权益分配 ECONOMY/PREMIUM，
  ADMIN-only，仅测试账号，绝不接订单）
- `POST /api/v1/relationships`、`GET /api/v1/relationships`、`GET/POST /api/v1/relationships/{relationshipId}`、
  `POST /api/v1/relationships/{relationshipId}/deactivate`（personaRef 按 persona-templates
  目录校验，当前唯一模板 gentle-listener，外部 provider 生成时注入其人设上下文）
- `POST /api/v1/relationships/{relationshipId}/reminders`、`GET /api/v1/relationships/{relationshipId}/reminders`
  （结构化用户提醒，soonest-first keyset）、`PATCH/DELETE /api/v1/reminders/{reminderId}`
  （REMINDER / FR-NOTIFY-001：提醒是结构化记录而非 Prompt 指令；Alpha 仅存储与
  展示、无主动推送，recurrence=NONE/DAILY/WEEKLY、status=ACTIVE/DISMISSED）
- `PUT /api/v1/consents`、`GET /api/v1/consents`（CONSENT / FR-AUTH-003/005：
  版本化同意记录，追加式落库、生效态按类取最新一行；未批准类型 400 拒绝；
  撤回 MODEL_TRAINING 不影响基本聊天）
- `POST /api/v1/conversations`（INC-MODE：请求可带 `incognito` 在创建时明确开启
  无痕会话，标志冻结在会话行且不可事后翻转）、`GET /api/v1/conversations`（会话列表，
  keyset + 最后消息预览 + incognito 标记）、
  `DELETE/PATCH /api/v1/conversations/{conversationId}`（删除级联清理、重命名写入 title）、
  `POST /api/v1/conversations/{conversationId}/generations`（CHAT-MODE：请求可带
  `mode` = AUTO/LISTEN/DISCUSS 的轮次级对话模式，首次接收时冻结在 generation 行并按
  idempotencyKey 重入不覆盖，AUTO 保持人设默认）、
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

后端在运方面上还提供（2026-08-16 第六轮）：

- 对话模式（CHAT-MODE）：`SendGenerationRequest.mode`（AUTO/LISTEN/DISCUSS）经 V34
  迁移冻结在 generation 行（幂等重入不覆盖）；组装器在外部 provider 分支把显式
  LISTEN/DISCUSS 翻译为固定的、经批准的轮次指令附加到人设 SYSTEM 块（AUTO 保持
  gentle-listener 默认倾听姿态），ZERO_LLM 确定性分支不受影响；前端输入区新增
  「自动/只听我说/一起聊聊」快捷模式 chips（FR-CHAT-002）。
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
