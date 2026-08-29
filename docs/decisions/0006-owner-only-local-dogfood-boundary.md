# ADR-0006：Owner-only 本地 7 天 Dogfood 边界

- 状态：Accepted（§3.3 / §3.4 / §5.2–5.4 / §6.1 由 ADR-0007 在对应 Go cutover 时替代；其余 Owner-only 边界继续有效。当前 Java 行为在替代契约生效前仍按本 ADR）
- 日期：2026-08-24
- 决策范围：Technical Alpha / Owner-only local dogfood

## 背景

当前没有可招募的真实用户，D0 所需的 15–20 次问题访谈和至少 10 次原型体验无法按
既定样本要求执行。Owner 决定先用唯一内部账号连续自体验 7 天，发现真实使用中的
产品与工程问题。该活动是探索性 dogfood，不代替 D0，不形成 `GO/PIVOT/STOP`，也不
解锁真实用户 Beta。

本 ADR 是本轮 Owner 决策的唯一记录。`TODO.md` 只跟踪执行状态，增强路线图只引用本
决策，不在其他文档复制一套 dogfood 规则。每天的原始对话和完整体验记录不得进入 Git；
只有脱敏后的问题摘要可以转成待办。

## 决策

### 1. 人员、环境与运行边界

1. 只允许一个 Owner 内部账号。Owner 同时是产品与发布责任人；没有真实协作者前不创建
   `CODEOWNERS`，每个 Agent 任务临时分配互不重叠的文件或模块 ownership。
2. 服务运行在 Owner 的 Mac，本机单实例；H5 与 API 按 ADR-0005 同源提供。手机通过同一
   局域网访问，不部署远端服务，不开放公开注册。
3. Owner-only dogfood 可全天使用。现有 Beta 10:00–22:00 时段和真实用户门禁不变；实现
   不得把全天范围扩散到其他账号或写成 Beta 默认值。
4. 主要验收设备为 iPhone Safari 和 Android Chrome，语言为简体中文。核心流程覆盖字体
   放大、对比度、焦点顺序、语义标签，并分别进行 VoiceOver 与 TalkBack 冒烟。
5. 本轮明确使用单 runtime 实例，不把多实例作为 dogfood 门禁。真实 Beta 是否需要多实例
   留待规模与可用性目标明确后决定。
6. 只有 Owner 本人处理故障，本轮不设置值班替补或外部告警接收端；告警保留在本机。该
   口径不满足真实用户 Beta 的值班门禁。

### 2. 体验周期与结论

1. 连续体验 7 天，每天至少完成一次核心旅程；两类目标手机都应在周期内覆盖。
2. 本轮不设置产品通过阈值。结束时汇总体验观察、缺陷、严重程度和建议顺序，不得把结果
   写成 D0 的 `GO/PIVOT/STOP` 或 Beta 放行结论。
3. Agent 默认不得读取原始对话。Owner 先提交脱敏问题；确需定位时，只能在 Owner 对具体
   片段再次明确授权后读取该片段，其他 Agent 仍无权访问。

### 3. Generation Provider 与动态套餐

1. generation 使用 WeChat ChatAPI 渠道的 OpenAI Chat Completions 兼容接口：
   `https://chatapi.weixin.qq.com/openai/v1/chat/completions`，模型标识
   `Deepseek-v4-flash`。这不是“DeepSeek 官方直连”的声明。
2. 上述公共 endpoint 只作为渠道 provenance 记录，不得硬编码成运行默认值。实际 endpoint
   binding、credential、账号标识、套餐名称与套餐限额只放仓库外的本机私有运行配置；
   credential 不得出现在 Git、日志、测试产物或文档中。
3. 套餐可能变化，代码、Catalog、路线图和 UI 不得写死截图中的 token 总量、请求次数或
   价格。私有配置应携带适用期；缺失或过期时状态为 `UNKNOWN`，允许唯一 Owner canary
   继续，但必须告警，不能显示 0 成本或虚构剩余额度。
4. canary 固定为一个内部账号；滚动最近 20 次至少 19 次成功，首 token P95 不高于 60 秒，
   单请求硬超时 240 秒。任何安全泄漏立即禁用 provider；连续 5 次失败触发熔断，恢复由
   Owner 决定。本 ADR 中的 canary 仅指 Owner-only dogfood 阶段，不是路线图 S0-24 的
   正式 Canary；这些门槛不构成扩大流量授权。

### 4. 数据外发与同意

1. 若供应商条款得到确认，允许的最大数据类别为 `MESSAGE_TEXT`、
   `ACCOUNT_METADATA`、`MEMORY_SNIPPET`；必要同意集合为 `SERVICE_TERMS`、
   `PRIVACY_POLICY`、`AI_CONTENT_NOTICE`、`THIRD_PARTY_MODEL_PROCESSING`、
   `SENSITIVE_DATA_PROCESSING`。
2. `MODEL_TRAINING`、`PUSH_NOTIFICATION`、`EMERGENCY_CONTACT` 保持关闭，不授权其他
   数据类别。
3. WeChat ChatAPI 的处理地区、供应商保留期、训练使用、删除机制和适用条款尚无权威证据。
   在 Owner 提供登录后页面截图或可核验条款 URL 且完成复核前，运行时有效范围必须自动
   降级为“仅通过本地敏感检查的 `MESSAGE_TEXT`”；`ACCOUNT_METADATA`、
   `MEMORY_SNIPPET` 和敏感内容不得外发。条款未知不能被当作已同意。

### 5. Safety 分类

1. 本地确定性硬规则先执行，且始终保留对流式增量片段的审核。
2. 远程分类使用同一 WeChat ChatAPI / `Deepseek-v4-flash`，通过 Chat Completions 做严格
   JSON 分类；不假设该渠道提供 `/moderations`。
3. 每轮最多对输入调用一次、对最终完整输出调用一次。远程分类请求不携带 persona、记忆
   或其他上下文，输出预算保持最小。
4. timeout、HTTP 失败、无效 JSON、字段冲突或不确定结果一律 fail-closed。远程分类只能
   提升风险，不能覆盖本地硬规则的阻断结论。

### 6. 记忆与 Embedding

1. 7 天体验的默认路径继续使用现有确定性 64 维向量。它只用于验证记忆生命周期和基础
   召回，不得据此声称中文语义记忆质量已经可靠。
2. 并行使用本机 Ollama 的 `qwen3-embedding:0.6b`（上游模型
   [`Qwen/Qwen3-Embedding-0.6B`](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)）做
   64 维影子评测。评测只使用合成样本
   和 Owner 明确提供的脱敏样本，比较同义改写 Recall@3、误召回、无匹配拒绝、跨关系
   隔离与删除防复活。
3. 影子评测不改变默认召回，不写入现行向量空间，不迁移数据库。只有结果显示明确收益后，
   才另行决定切换 64 维模型或建立 256/512 维新空间并执行受控 re-embed。
4. 不引入 Mem0、Letta、Graphiti 等完整框架接管 canonical memory；现有确认、授权、RLS、
   替代、删除和保留链路继续是真源。

### 7. 本地数据、对象存储与恢复

1. 对话正文保留 30 天后自动清除。已确认结构化记忆独立保留，直到 Owner 主动删除、撤回
   相关同意或被新记忆替代。本约定只适用于本地 dogfood，不直接批准 Beta retention 草案。
2. 应用层加密密钥来自仓库外环境变量或本机私有配置；私有文件权限为 `0600`。正式 KMS、
   previous key 保留和轮换责任人仍是实际 Beta 前置条件。
3. 本机通过 OrbStack 运行 MinIO，使用私有 bucket；导出下载入口只有一次性
   token 的应用端点（服务端读取并解密对象、成功后删除），不存在可在 TTL 内
   反复访问的签名 URL。不接云对象存储。
   导出下载链接保持一次性；刷新、过期或成功下载后必须重新发起导出。
4. 每天生成一次覆盖 PostgreSQL 与 MinIO 对象的本地加密备份并保留 7 天，不同步云端。
   删除 tombstone manifest 保存在恢复数据库和对象备份之外的独立加密位置，并至少执行
   一次“恢复后先 reconcile、再开放读取”的演练。
5. 紧急联系人能力保持关闭；危机场景只展示现实支持资源，不声称已通知任何联系人。
6. 成年核验只使用该内部账号的模拟成年人状态，不收集证件或生物信息。真实成年核验供应商
   继续作为真实 Beta 前置事项。
7. 本地管理员只有 Owner 一个账号；删除、导出、撤回同意等高风险操作要求重新输入密码
   确认。MFA、外部身份源和多人角色分离留到真实 Beta 前决策。

## 执行后果

- 后续 Agent 先按当前 `HEAD`、契约、代码和测试做 fit-check；已满足的项只验证并报告
  `ALREADY_DONE`，不得为完成编号重写。
- provider 条款证据缺失只阻止敏感/记忆外发和真实 Beta，不阻止同源本地环境、MinIO、
  本地备份、可访问性、确定性修复或开源 embedding 影子评测继续执行。
- dogfood 中发现的问题以脱敏摘要进入 `TODO.md`；原始正文、账号、密钥、套餐截图数值和
  本机绝对私有配置不得提交。

## 明确不授权

本 ADR 不代表 D0 已完成，不代表 `GO`，不代表受控 Beta 或真实用户 Beta 获批；不授权
公开注册、远端部署、真实支付、真实年龄供应商、紧急联系人外呼、云端备份或生产发布。
