# Virtual Companion 完善路线图与 Agent 实施 Backlog

> 版本：2026-08-22
> 初始审计快照：`485a87fa`；最近一次对账基线：`8c9711b5`
> 目的：在不重复现有能力、不越过 Technical Alpha 红线的前提下，给后续 Agent 提供可直接拆分和实施的功能路线图。
> 重要：本文是候选 Backlog，不自动授权真实用户开放、第三方写入、生产发布、付费、公开注册或新增生产依赖。
> 状态边界：提交号只记录对账基线，不是完成状态真源；派发任一 ID 前仍须核对当前代码、契约、测试和 `TODO.md`。

## 1. 结论先行

这个项目目前的主要问题已经不是“缺一个聊天后端”，而是三类未闭环：

1. **发布边界未闭环**：真实 moderation、真实 embedding、真实成年核验、紧急联系人发送、人工 case 处置、发布状态真源仍有缺口；部分契约或界面文案已经与实现漂移。
2. **用户旅程未闭环**：H5 更像完整的技术/合规控制台，认证导航、首次体验、弱网恢复、错误真实性、关系上下文、记忆溯源、异步任务恢复仍不够连续。
3. **真实运行未闭环**：provider 健康与服务状态、按 supplier 熔断和会话粘滞、多实例实时、队列运营、会话撤销、密钥轮换、真实浏览器 E2E 尚未形成生产级闭环。

下一阶段不应先堆语音、图片、多角色、恋爱模式或支付。最合理的顺序是：

```text
修正真源与确定性缺陷
  → 完成受控 Beta 的安全/身份/provider 闭环
    → 把已有接口纵切收束成连续用户旅程
      → 用真实 Beta 数据验证“低压力倾诉 + 可信记忆”
        → 再做差异化、规模化和公开版能力
```

### 1.1 当前对账摘要（`8c9711b5`）

下表只记录本次核对结果，不引入新的状态文件；后续派发仍须重新检查当前工作树和实现。

| 候选 | 当前判断 | 下一步边界 |
|---|---|---|
| `S0-03` | `DONE`（对账见 §S0-03） | 绑定已统一、校验与集成测试已补齐；后续派发前仍须按当前工作树复核 |
| `S0-02` | `PARTIAL`（子交付 A 完成，见 §S0-02） | 时间真源已统一：Beta contract 同步 10:00–22:00 并有 catalog↔contract 漂移检查与五点边界回归；剩余 readiness/发布状态同步与 Owner 人工项，不得代填真实责任人或 Beta 批准状态 |
| `S0-05` | `DONE`（对账见 §S0-05） | Help 已直达真实举报表单与本人处理状态，README 同步且不再有与 report 能力矛盾的现行说明；TODO.md 历史轮次记录按原样保留 |
| `S0-10` | `PARTIAL` | supplier 熔断、健康感知路由和单机会话粘滞已完成；剩余 `C` 为动态 service-mode 聚合，不得重做 `A/B` |
| `S0-25` | `PARTIAL / READY` | DB 撤回已实现，外发 Guard 仍依赖进程内镜像；需要补跨层“撤回后外发 0 次”闭环 |
| `S0-26` | `PARTIAL / BLOCKED` | 实际 payload 与默认授权类别不一致；技术映射可分析，完整收口需 Owner 确认必要同意与数据类别 |
| `S0-27` | `PARTIAL / BLOCKED` | DB 角色已定义，但部署仍复用 `postgres`；凭据和目标环境拆分需 Owner 决策 |
| `S0-33` | `PARTIAL / READY` | 当前实际依赖多个进程内状态；可加单副本硬门禁，多实例目标仍需 Owner 决策 |

## 2. 本文如何判断“值得做”

每个候选项至少满足一项：

- 直接降低越权、误删、未授权外发、错误安全放行或数据复活风险；
- 补齐已有能力的最后一公里，使用户能连续完成任务；
- 直接提升“低压力倾诉”或“可信记忆”两个核心假设；
- 为受控 Beta 提供真实可执行的人工运营、恢复或测量能力；
- 有明确消费者和可观察验收结果，而不是只新增抽象层或证明材料。

以下内容不作为优先级理由：页面显得更多、模仿竞品、理论扩展性、没有消费者的治理文件、为未来可能性预建复杂平台。

### 2.1 证据来源

仓库内基线：

- `README.md`、`TODO.md`；
- `specs/catalog/product-scope.yaml`、`specs/contracts/**`、`specs/openapi/virtual-companion.yaml`；
- 根 `pom.xml` 的 14 模块；
- `service/**`、`frontend/src/**`、V1–V77 migration、CI、部署/备份/测量脚本；
- `docs/beta-readiness/**` 和原始需求快照。

外部校准基线：

- 中国网信办《[人工智能生成合成内容标识办法](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm)》要求生成内容在交互、复制、下载和导出场景保持相应标识；
- 中国网信办《[生成式人工智能服务管理暂行办法](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)》明确了适用人群说明、防范未成年人过度依赖、投诉举报和反馈处理等要求；
- [NIST AI RMF / Generative AI Profile](https://www.nist.gov/itl/ai-risk-management-framework) 强调贯穿生命周期的测试、评估、验证与监测；
- [OWASP GenAI/LLM 风险清单](https://owasp.org/www-project-top-10-for-large-language-model-applications/) 覆盖 Prompt Injection、敏感信息泄漏、输出处理、向量/Embedding、错误信息和无界消耗；
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) 用作 H5 无障碍目标基线。

这些来源只用于校准优先级；具体合规结论仍需有资质的专业人员结合最终主体、部署和功能判断。

## 3. 已经具备的能力：后续 Agent 不要重做

| 领域 | 已有能力 | 主要证据 |
|---|---|---|
| 工程契约 | Catalog、OpenAPI、关键技术契约及确定性生成物 | `specs/catalog/**`、`specs/openapi/**`、`specs/generated/**` |
| 后端 | Java 25 + Spring Boot 4.1 的 14 模块 reactor | `pom.xml`、`service/**/pom.xml` |
| 数据库 | PostgreSQL 18 + pgvector，V1–V77，RLS/SD/并发测试 | `service/platform/persistence/**`、`infra/db/tests/**` |
| Auth | login、refresh rotation、logout、cookie/CSRF、管理员开通/禁用、邀请注册默认关闭 | `runtime/auth/**`、OpenAPI auth paths |
| 角色 | 单活跃角色、结构化偏好、性别/审核头像、重置/删除/导入预览 | relationship API、V47–V49、H5 companion 页 |
| 会话 | 创建/列表/分页/改名/结束/删除/全部清空、无痕、模式、生成版本 | conversation/generation API、V30–V57 |
| 生成 | 持久化后接收、worker lease/fence、provider adapter、重试/dead-letter、取消、最终化 | `GenerationController`、`GenerationWorkItemHandler`、modelruntime |
| 实时 | Fetch-SSE ticket、Last-Event-ID、gap/reset/snapshot、增量安全审核 | realtime API、`LiveDeltaBroker`、V8 |
| 记忆 | 候选/确认/拒绝/编辑/删除/证据、自动保存白名单、语义召回、替代/事件/过期 | memory API、V11–V13、V55、V62、V66、V68 |
| 安全 | 确定性输入/增量/最终审核、退出意图、高风险队列、危机静态响应 | safety module、V58–V59、V69 |
| 数据权利 | 同意、导出、单消息/会话/全部聊天/角色/账号删除、举报、年龄申诉 | V41–V57、相关 H5 页面 |
| Beta 边界 | 邀请码、服务时段、DAU 上限、停服开关、模拟权益/试用 | V60–V61、`BetaServiceWindow` |
| 运维 | Prometheus 指标、Webhook 告警通道、部署 Compose、备份/PITR 演练、保留任务骨架 | V69–V77、`ops/deploy/**`、`infra/db/backup/**` |
| 前端 | 20+ H5 页面、typed transport、401 单次刷新、Pinia、组件/状态测试 | `frontend/src/**` |
| CI | 后端、前端、数据库、供应链、快速检查 | `.github/workflows/ci.yml` |
| 评测基线 | 1,000 条确定性安全红队测试；记忆候选/召回评测生成器和统计工具 | `MeasureRedTeamCorpusTest`、`docs/beta-readiness/10-记忆评测与统计.md` |

特别不要重复实现：本地标题/记忆筛选、聊天虚拟滚动、安全 Markdown、生成版本选择、记忆删除墓碑、低敏自动保存、会话摘要版本表、服务模式横幅、举报提交接口、异步导出、请求号、复制 AI 标识提示。

## 4. 优先级定义

原始需求已经使用 `P0` 表示“公开付费版准备”。为避免混淆，本文使用 `S0–S3`：

| 优先级 | 含义 | 开工门槛 | 完成判断 |
|---|---|---|---|
| **S0** | 当前缺陷、受控 Beta/真实 provider 阻塞项 | 可修确定性缺陷；外部渠道任务需 Owner 给出平台/区域/凭据注入方式 | 不解决就不得开放真实用户或会形成明显错误/安全风险 |
| **S1** | 受控 Beta 的核心体验和运营闭环 | D0 至少给出继续/缩减方向；S0 的相关依赖完成 | 能直接改善倾诉、可信记忆、可退出或人工运营 |
| **S2** | Beta 数据验证后的质量、留存和规模化 | 有真实使用数据和指标基线 | 指标证明有价值，且不会靠依赖诱导提升留存 |
| **S3** | 公开版或独立探索项目 | 独立立项、ADR、成本/安全/隐私评审 | 不能混入当前 Alpha/Beta 小步任务 |

S0 也不是全部并行。凡是同时修改 OpenAPI、Catalog 或同一 migration 链的任务必须串行；`chat.vue`、`index.vue`、`admin.vue` 等热点文件同一时刻只给一个写入 owner。

这里的编号是**候选需求编号**，不保证等于一个 Agent 的实现单元。像 S0-10、S0-11、S0-14、S0-17、S0-24、S0-31 这样的跨模块项属于 Epic，开工前必须按第 11.4 节切成单一写入 owner 的子交付。

## 5. S0：当前应优先处理的 33 项

### S0-A · 真源和确定性正确性

#### S0-01 执行 D0 产品发现并形成 Go / Pivot / Stop 决策

- **现状证据**：`TODO.md` 中 D0-PLAN、D0-RUN、D0-DECIDE 仍未完成；`docs/beta-readiness/06-产品发现-D0-计划.md` 已有草案。
- **价值**：避免在“目标人群是否需要低压力倾诉、可信记忆是否真有价值”尚未验证前继续平台化扩张。
- **最小交付**：Owner 完成 15–20 次问题访谈、至少 10 次原型体验；Agent 只负责匿名化汇总、价值排序和 ADR 草案。
- **依赖**：真实联系方式和原始访谈数据不进入仓库；需 Owner 决定招募渠道和同意方式。
- **验收**：ADR 明确 `GO`、`PIVOT` 或 `STOP`，列出证据、阈值、被否定假设和下一阶段范围。
- **停止条件**：未达到发现门槛时停止新增 S1/S2 产品功能，只允许修 S0 正确性和安全问题。

#### S0-02 统一 Beta 时间、门禁与发布状态真源

- **当前对账（2026-08-22，子交付 A：时间真源统一）**：`product-scope.yaml`
  betaGate 确定为机器真源；`beta-gate-contract.yaml` 窗口/值守字段已同步
  10:00–22:00 族（opensAt 10:00、长会话截断 21:45、新代截止 22:00、在途宽限
  22:10、值守 09:45–22:30）；`catalog_tool.py validate` 新增 catalog↔contract
  关键字段漂移检查、`hardDefault=beta_generation_enabled_false` 钉住与时序
  不变量校验；09:59/10:00/21:45/22:00/22:10 五个边界在运行时策略测试与目录
  检查中口径一致；`betaGenerationEnabledByDefault=false` 不变。
- **剩余**：readiness/发布状态文档与真实状态同步；责任人、目标环境、PIA、
  值班与审核结论仍为 `[待填]`，真实 Beta 保持默认关闭。
- **最小交付**：确定 `product-scope.yaml` 为机器真源；同步 Beta contract、README、部署默认和 readiness 文档；增加有业务价值的关键字段漂移检查，而不是恢复旧治理体系。
- **验收**：09:59/10:00/21:45/22:00/22:10 边界测试一致；`betaGenerationEnabledByDefault=false`；所有“已就绪/未就绪”声明不互相矛盾。
- **停止条件**：Owner 未给出真实责任人、目标环境或审核结论时只能标记 `BLOCKED/待填`，不得代填“已完成”。

#### S0-03 修复上下文预算配置绑定漂移

- **当前对账**：已修复——组装器改经类型安全 `ContextBudgetProperties`（唯一路径
  `virtual-companion.context-budget.*`，`VC_CONTEXT_*` 注入生效）；正数值与
  「输出<输入」组合校验在绑定层执行，非法值启动失败；绑定/接线/边界测试齐备。
- **现状证据**：`application.yaml` 使用 `virtual-companion.context-budget.*`，`AuthDataSourceConfig` 读取 `virtual-companion.generation.context-budget.*`，部署变量可能静默回退到默认值。
- **最小交付**：改为类型安全 `@ConfigurationProperties`；统一路径；校验 input/output/turn 数值和组合；增加绑定集成测试。
- **验收**：注入 `VC_CONTEXT_MAX_INPUT_TOKENS=4000` 后组装器确实使用 4000；非法值启动失败；历史、召回和输出预算均有边界测试。
- **风险**：这是成本与截断正确性缺陷，不要顺手重写整个上下文组装器。

#### S0-04 建立服务端 Beta Admission Gate

- **现状证据**：`GenerationController` 强制服务时段/DAU，但未看到 `ADULT_VERIFIED` 聚合门禁；前端 `next-step` 只是提示，读取 age/consent 失败时可能仍展示“去聊天”。
- **最小交付**：服务端在创建新 generation 前原子检查账号有效、Beta 启用、成年状态、必要同意、服务时段/DAU；返回可枚举错误码与下一步。前端只呈现服务端结果，不成为安全真源。
- **验收**：未核验、申诉中、必要同意缺失、门禁读取失败都不能创建外部 generation；已有历史/记忆/数据权利仍可用；重生成不得绕过门禁。
- **停止条件**：必要同意集合、版本和适用阶段未由产品/法务确认时先冻结为配置和 fail-closed，不自行猜测。

#### S0-05 修复 H5 Help/Report 与 README 的状态漂移

- **当前对账（2026-08-22，已完成）**：`help.vue` 举报和申诉区删除「受理接口尚未
  接通」，改为如实说明举报页的提交表单、成功/失败呈现与本人处理状态入口，
  `help.spec.ts` 断言导航直达 `/pages/report/report` 且不出现编造热线/工单/SLA；
  README 同步四处旧声明（REPORT-PAGE、MSG-REPORT、「我的数据」举报申诉括注、
  AGE-MIN 申诉句），现行说明与 report 能力一致；report API/页面/成功失败分支
  复用既有实现与测试（65 文件 745 用例 + type-check + check.sh 全绿）。
  TODO.md 各轮「已完成」为带日期的历史记录，按原样保留。
- **现状证据**：`frontend/src/pages/help/help.vue` 仍称“受理接口尚未接通”，但 report API、表单和本人列表已经存在；README 也保留类似旧声明。
- **最小交付**：Help 直达真实举报表单和本人状态；删除过时文案；保留“不编造热线、工单号和处理时限”的边界。
- **验收**：用户从 Help 能完成提交；成功/失败真实显示；仓库全局不再存在与当前 report 能力矛盾的说明。

#### S0-06 明确 H5/API 同源或跨域部署契约

- **现状证据**：安全配置的 CORS 方法缺 `PUT`、`allowCredentials(false)`；前端 transport 使用 `credentials: include` 且多个接口为 PUT；refresh/CSRF cookie 当前为 `SameSite=Lax`。同源 Caddy 会掩盖前两项，不同站点部署则还会受 cookie/浏览器第三方策略影响。
- **最小交付**：优先正式锁定同源反代；若只需同站不同源，使用精确 origin allowlist、允许 PUT 和 credentials、保留 CSRF/Origin 校验。若业务明确要求跨站，再独立验证 `SameSite=None; Secure`、host-only/Domain、第三方 cookie 限制和 CSRF 威胁模型；禁止 wildcard。
- **验收**：部署模型写入 ADR/README；同源 smoke 通过；支持的分域模型必须在 Chrome/Safari 真实浏览器完成 login/refresh/cookie/PUT；未授权 origin 失败；不能只凭 CORS 单测声称跨站可用。
- **停止条件**：不能为了“让 CORS 工作”关闭 CSRF、放开任意 origin 或把 token 写 localStorage。

### S0-B · 身份、安全、Provider 与数据处理

#### S0-07 接通真实 moderation 的 fail-closed 复合分类器

- **现状证据**：`OpenAiCompatModerationClient` 已存在，但不实现 `SafetyClassifierPort`；运行时始终注入 `DeterministicSafetyClassifier`；provider 响应缺 `results[0]` 时当前解析可能得到 clean。
- **最小交付**：实现 `CompositeSafetyClassifier`：确定性硬规则先行，provider 只能提升风险；超时、无响应、错 schema、低置信或冲突一律阻断；输入/增量/最终三阶段共用；请求用 Jackson 序列化。
- **依赖**：Owner 决定供应商、区域、数据保留、成本上限和 Secret 注入；默认关闭。
- **验收**：异常响应没有 delta/completed；硬规则不可被 provider 降级；只记录 provider/model/版本/延迟/结果码，不记录正文或密钥；安全合同测试通过。

#### S0-08 建立 Prompt Injection 与 Memory Poisoning 专项防线

- **现状证据**：确定性分类器明确将 Prompt Injection 留给真实 provider；现有上下文虽然分 system/persona/memory/user，但没有完整的注入/记忆污染策略与回归集。
- **最小交付**：上下文分区加不可混淆标签；记忆只作为低优先级数据；禁止 assistant 自述成为 user fact；检测系统提示索取、跨关系记忆索取、凭据/内部信息泄漏；异常候选进入人工确认。
- **依赖**：S0-07；现有 owner/RLS/授权快照保持不变。
- **验收**：合成红队样本无法越权、泄漏其他关系或污染 accepted memory；所有候选具有 owner、relationship、来源和确认状态；用户手工事实不会被模型自动回写。
- **停止条件**：不开放工具调用、数据库查询、跨用户检索来“测试防护”。

#### S0-09 接通真实 EmbeddingPort 与安全迁移

- **现状证据**：`OpenAiCompatEmbedder` 是独立 client，不实现 `EmbeddingPort`；运行时固定 `DeterministicEmbedder`；未形成真实向量维度/finite/space 校验和 re-embed 流程。
- **最小交付**：provider adapter、配置/Secret、dimension/space/model/version 校验；失败时退回结构化召回；后台 re-embed job 支持 checkpoint、双 space 迁移和旧 space 退役。
- **验收**：空向量、错维度、NaN/Infinity 拒绝；不同 space 永不混用；provider 故障不阻断聊天、手工记忆和删除；删除/替代行不会因旧索引复活。
- **停止条件**：真实 Embedding 默认关闭；数据处理授权、区域和成本未确认不得启用。

#### S0-10 完成按 supplier 熔断、会话粘滞和动态服务状态

- **当前对账**：`8c9711b5` 已完成按实际 supplier 记账、健康感知选路、半开探针和单机会话粘滞；
  `ServiceModeService` 仍只读取静态 `enabled/degraded`，不反映实际健康、预算、人工停服和可用候选。
- **剩余最小交付**：只实施子交付 `C` 的动态 service-mode 聚合，并消费现有 route health；不要重做 breaker、router 或 affinity。
- **验收**：A 故障不摘除 B；半开仅一个 probe；切换不重复外发/扣减；授权快照中的 provider 与实际 outbound 一致；用户看到的状态与真实可用性一致。

#### S0-11 将持久化 Registry、路由决策和权益配额对齐

- **现状证据**：runtime 使用内存 Registry 与近似无限 synthetic quota；`JdbcProviderDeploymentRepository`、quota reconciliation 主要用于持久化/管理读取；实际路由按简单确定性顺序。
- **最小交付**：让 DB admission 成为运行真源；形成不可变 route decision（候选、拒绝原因、选中部署、策略版本、应得/实际等级、fallback）；对调用次数/token/模拟权益等产品 quota 做共享 reserve/settle/release。货币价格、成本上限和供应商账单只归 S0-29。
- **验收**：重启不丢权益额度；并发不超卖；未 admitted/未授权部署绝不外发；可以重建“为什么选它、为何降级、为何冲正”；不在本任务建立货币账本。
- **停止条件**：不把套餐直接绑定供应商模型，不提前接真实订单。

#### S0-12 接入真实成年核验 Adapter 和申诉处置

- **现状证据**：`AgeVerificationPort` seam、状态机和申诉 intake 已有，但只注入 `SimulatedAgeVerifier`，申诉队列只读。
- **最小交付**：真实 adapter 只保存 age band/result/providerRef/时间；不保存证件或生物原文；provider 失败/冲突 fail-closed；增加人工 resolve/deny/reverify 状态变化与审计。
- **依赖**：供应商、处理区域、保留/删除策略、申诉责任人；S0-04。
- **验收**：无法核验或申诉中不能生成；provider 不可用不退化为自称成年；申诉不能自助改为 verified；普通用户页面不显示原始 providerRef。
- **停止条件**：Technical Alpha 继续 simulated；真实 Beta 未获批前不能收真实证件数据。

#### S0-13 接通紧急联系人真实 Webhook 渠道

- **现状证据**：联系人保存、加密、邀请 token、确认、变更、撤回都已实现，但 `verify-start` 仍返回模拟 token；功能默认关闭；TODO R50 未完成。
- **最小交付**：企业微信/飞书/自建 webhook 三选一；签名、超时、有界重试、幂等 delivery、发送审计；payload 最小化；验证链接一次性且短效。
- **依赖**：Owner 选平台、提供部署 Secret、确认数据处理；按 `docs/beta-readiness/02` 完成演练。
- **验收**：覆盖新建、重复发送、验证、变更、撤回、过期、5xx/超时；未验证/过期/撤回联系人绝不发送；失败不让模型声称“已联系”。
- **停止条件**：演练未完成前 `emergency-contact.enabled=false`。

#### S0-14 建立举报、安全事件、年龄申诉的 Case Workflow

- **现状证据**：report/safety/appeal 只有 intake 和 admin 只读列表；`ReportRecord` 虽有 RESOLVED，但没有 assign/ack/escalate/resolve API；当前仅有单一 ADMIN 角色。
- **最小交付**：统一或相互关联的 case 状态机；severity、SLA、assignee、处置原因、内部备注；`SAFETY_REVIEWER`/`PRIVACY_OPERATOR`/`OPS_VIEWER` 最小分权；默认脱敏摘要，正文访问需 case scope。
- **验收**：R3/R4 可自动升级；状态变化和正文访问均审计；普通 admin 不能随意浏览全量聊天；用户只看自己的状态和公开说明，不看到内部备注。
- **停止条件**：不编造热线、监管工单号、处置承诺或尚未批准的 SLA。

#### S0-15 补 Refresh 会话/设备撤销、凭据重置与管理员 Re-auth

- **现状证据**：已有 refresh rotation、logout、账号删除，但没有活动 refresh family/会话列表、单设备撤销、revoke-all、密码修改/安全重置。
- **最小交付**：refresh family/device registry；当前/最近登录；单会话与全部撤销；受控 Beta 先做管理员发起的一次性重置并强制首次改密；管理员操作 re-auth，公开版前再上 MFA/WebAuthn。
- **验收**：撤销后的 refresh 不能再换取 access；refresh replay 撤销 family；改密撤销旧 family；不显示 token、完整 IP 或敏感设备指纹。现存 access token 的即时失效和业务限流只归 S0-30，本任务仅与其做契约集成。
- **停止条件**：未选邮件/短信渠道前不伪造“找回密码已发送”。

#### S0-16 账号删除前终止 owner 的在途 Provider 调用

- **现状证据**：V43 会级联删除数据，但 `AuthService.deleteAccount()` 未先 cancel `ActiveInvocationRegistry` 中的 owner 调用；晚到 finalize 通常会被 fence 拒绝，但供应商调用仍可能耗时、计费或保留数据。
- **最小交付**：先写 deletion/withdrawal intent；阻止新任务；按 owner 取消 in-flight generation/session；执行前再校验账号和授权；跨实例通过持久化取消意图协作。
- **验收**：注销后无新 outbound；晚到结果不写 message/memory/vector/export；取消与供应商终止结果可审计；删除失败触发现有告警而不误报完成。

#### S0-17 激活前补齐 Retention、通用密钥版本基础和删除防复活

- **现状证据**：V70 policy 仍是 DRAFT、scheduler 默认关闭；`RestFieldCipher` 已覆盖主要正文，但通用 key ID/version/rotation、向量/导出/备份恢复后的删除传播还未完全闭环。
- **最小交付**：A）Owner/专业人员批准 ACTIVE policy，补 dry-run/统计/分类失败隔离/legal hold；B）只建立通用 key ID/version、dual-read/single-write 和 checkpoint re-encrypt 基础；C）明确 export/vector/backup 的删除墓碑传播。`conversation_summary` 的字段接线和数据回填只归 S0-32。
- **验收**：通用轮换基础不中断读写；purge 可重试且不影响其他类别；从 PITR 恢复后墓碑继续阻止消息、记忆、向量和导出重新投入使用；本任务不直接改写 summary 数据。
- **停止条件**：只有合成数据时可演练；政策未批准不得打开真实 purge。

### S0-C · H5 连续性与真实验收

#### S0-18 统一认证路由守卫和登录后回跳

- **现状证据**：`main.ts` 只初始化 Pinia/auth store；各页面自行 refresh；没有公开/登录/成年/同意/admin 路由矩阵；登录后通常回边界台。
- **最小交付**：统一导航守卫；保存原 path + query；登录后恢复；前端门禁状态使用 `unknown/blocked/ready`，读取失败不显示已就绪。
- **验收**：未登录直达 chat/memory/export 会去登录并完整回跳；普通用户直达 admin/ops 不渲染数据；401 只刷新一次，失败后清缓存。
- **说明**：服务端 S0-04 才是安全真源，前端守卫只负责正确体验。

#### S0-19 修复关系/会话上下文跨页传递

- **现状证据**：Data 页打开角色、聊天、提醒时部分链接缺 relationshipId；memory detail 返回不保留关系；关系列表刷新后可能保留已不存在的 current ID。
- **最小交付**：集中 `buildContextHref()`；所有深链携带并校验关系；conversation 自带关系优先；关系删除/停用后清理旧选择。
- **验收**：从“我的数据”、会话列表、记忆证据、提醒跳转始终落到正确关系；不存在的 ID 不会沿用；不得只靠前端 ID 决定 owner。

#### S0-20 完成移动网络/后台切换下的 Realtime 生命周期恢复

- **现状证据**：客户端最多固定 8 次 resume，普通 transport 异常直接 exhausted；生成状态只在内存；没有 online/offline、visibility、前后台恢复。
- **最小交付**：区分网络/权限/服务/终态；退避与抖动；页面恢复后以 generation snapshot 为权威；保留未确认输入但不自动创建第二个 generation。
- **验收**：断网后 pending 不消失；恢复从连续游标继续且不重复 delta；刷新不伪造完成；取消、阻断、失败、超时显示不同终态。
- **停止条件**：不要把 access token 或聊天正文长期写入 localStorage 来换取恢复。

#### S0-21 统一 `idle/loading/ready/partial/error` 与重试模型

- **现状证据**：多个 store 在请求失败时保持旧值或把失败域变成空数组；用户会把“加载失败”误解为“没有记忆/提醒/数据”。
- **最小交付**：共享 `AsyncState`、`ErrorNotice`、`RetryButton`、`RequestIdNotice`、`EmptyState`；部分成功明确列出失败域；写操作均有 pending/success/failure。
- **验收**：memory/reminder API 失败绝不显示空数据；加载更多可独立重试；旧数据保留并标为可能过期；错误显示请求号但不含正文。

#### S0-22 补危险操作确认与内部字段脱敏

- **现状证据**：记忆删除目前单击即请求，而会话/角色/全部聊天已有二次确认；年龄页直接显示原始 `providerRef`；部分页面展示 raw persona/template 标识。
- **最小交付**：记忆删除确认显示摘要、范围和来源影响；删除失败保留行；普通用户只看友好核验方式/状态/时间；raw provider/persona ID 仅留受控诊断。
- **验收**：第一次点击不发删除请求；确认后才执行；错误可重试；用户页面不暴露内部 providerRef、prompt/model secret 或未经设计的目录码。

#### S0-23 建立真实浏览器关键旅程 E2E

- **现状证据**：已有大量 Vitest/Node/happy-dom 测试，但无 Playwright/Cypress、真实浏览器、axe、移动视口、弱网/后台切换 E2E。
- **最小交付**：用隔离 Postgres、runtime、worker、Fake/Failure provider 和真实 H5，先只覆盖 6 条高价值旅程：登录/回跳、首次门禁、创建角色→聊天、SSE 断线恢复、记忆确认/删除/溯源、导出刷新恢复；再加键盘/焦点和窄屏。
- **验收**：测试跑真实 HTTP/SSE 和 worker 链路；能注入 provider timeout/safety block；失败能定位请求号；不依赖生产凭据；CI 耗时符合 `docs/engineering/checks-principles.md`，新增长检查前另行说明。
- **停止条件**：不为了 E2E 恢复旧 Evidence/Harness 体系，不为每个按钮复制低价值脚本。

#### S0-24 建立真实 Provider 的分阶段启用与回滚门禁

- **现状证据**：provider adapter、模型 rollout 文档、预算 guard、指标已有，但真实 moderation/embedding、实际健康状态、真实成本和部署 smoke 尚未共同验收。
- **最小交付**：合成流量 smoke → 固定 eval/red-team → 单个内部账号 canary → 小流量 Beta；每步绑定 model/prompt/config 版本、阈值、自动/人工回滚条件和告警接收端。
- **验收**：验证首 token/完成时延、429/5xx/断流、审核异常、预算停机、降级文案、账单漂移；任一门禁失败都不能扩大流量；凭据仅部署注入。
- **停止条件**：D0 未给出 GO、S0-04/07/12 未完成、告警无人接收或值班不可持续时不得开放真实用户。

### S0-D · 审计发现的授权、部署与运行边界缺口

#### S0-25 让同意撤回立即作用于实际执行授权

- **当前对账（2026-08-22，已完成）**：外发前授权复核改为读取 DB 权威
  `vc.authorization_snapshot`（`AuthDataSourceConfig` 新增
  `JdbcAuthorizationSnapshotStore` authority bean；`ApprovedModelProviderConfig`
  的 guard 与 invoker 执行快照身份复核均经 `preOutboundAuthority` 优先接 DB），
  进程内镜像从生产链路移除（`JdbcAuthorizationSnapshotProvider` 不再 mirror）；
  `ExecutionAuthorizationGuard`/`LiveModelInvoker` 权威读取失败一律 deny
  fail-closed（与「快照缺失」区分审计原因）。跨层闭环测试
  `WithdrawnConsentOutboundBlockTest`（铸快照→撤回→排队任务执行→adapter 调用
  0 次；并发撤回不复活；多实例共享权威；陈旧镜像不可救；DB 断连 fail-closed）
  + `PreOutboundAuthorityWiringTest` + guard/invoker 单测 + DB 测试 126
  （撤回提交后权威读只见 WITHDRAWN、历史审计可读、重复撤回 0 行）。
  线性化点为 prepare 事务内的权威读：撤回在其后提交的在途外发按已授权完成，
  重试/下一次外发必被拒。无 Redis、无消息总线、无 Auth 重构。
- **现状证据**：撤回会把数据库 snapshot 改为 `WITHDRAWN`，但外发 guard 使用的 `InMemoryAuthorizationSnapshotStore` 可能仍保留 ACTIVE；多实例时镜像更不一致。
- **最小交付**：以 DB 为执行前权威状态，或实现可靠共享撤回状态；每次外发前复核 requested/execution 双快照；权威读取失败 fail-closed。
- **验收**：先铸快照、再撤回、最后执行排队任务时 provider HTTP 调用数为 0；并发撤回和多实例测试均拒绝；历史审计仍可读取但不能继续处理。

#### S0-26 让授权快照的数据类别与真实 Provider Payload 一致

- **现状证据**：组装器会发送历史消息、记忆片段、persona 等数据，但默认快照主要声明 `MESSAGE_TEXT`；辅助 consent coverage 校验未形成强制链路。
- **最小交付**：建立“payload 字段 → processing purpose → data category → provider/region”映射；组装后、外发前计算实际类别并与当前同意逐项求交；删去未授权上下文或拒绝外发。
- **验收**：审计可以解释每一类数据为何被发送；缺 `MEMORY_SNIPPET` 授权时记忆不外发；新增 provider/region 超出授权时不能静默启用。
- **停止条件**：不能靠 Prompt 声称“不要使用记忆”来代替删除未授权 payload。

#### S0-27 分离 runtime、worker、coordinator 与 migrator 数据库权限

- **现状证据**：部署 Compose 中 runtime/migrator 仍可能使用 `postgres`，与既有 `vc_api`、`vc_worker`、coordinator、migrator 权限设计不一致。
- **最小交付**：迁移专用角色；runtime API/worker/job 分凭据或最小可行角色；撤销运行时 DDL、BYPASSRLS、无必要 schema/table 权限；Secret 分开注入。
- **验收**：权限测试证明 runtime 不能 CREATE/ALTER/DROP、不能直读受保护表/密钥、不能跨 owner；migrator 仍可从空库和上一版本升级。

#### S0-28 对齐 Anthropic 与 OpenAI 的 Egress/SSRF 策略

- **现状证据**：OpenAI adapter 接收部署 allowlist；Anthropic config 仍固定 defaults，额外批准主机不生效，容易促使运营绕过正确的统一入口。
- **最小交付**：两个协议适配器消费同一 `ProviderEgressPolicy`；覆盖自定义合法主机、私网、metadata、DNS 变化、重定向和端口测试。
- **验收**：批准主机可达；未批准/私网/metadata/危险重定向失败；Authorization/API key 不随重定向泄露。

#### S0-29 将硬预算改为原子预留、结算和释放

- **现状证据**：BudgetGuard 主要读取已结算 `actual_cost`，真实成本当前仍可能为 0；并发请求可同时通过检查后超支。
- **最小交付**：版本化价格表；DB 原子 cost reservation；完成时 actual settle，失败/取消/安全阻断 release；80/95/100% 阈值和未知价格 fail-closed。
- **验收**：并发测试不超过 ceiling；retry 不重复预留；账单对账在批准容差内；ZERO_LLM 和危机模板不计模型费用。
- **停止条件**：这是 provider 成本保护，不授权真实订单、支付或向用户收费。

#### S0-30 使账号禁用/降权即时失效，并限制高成本业务端点

- **现状证据**：access JWT 默认可在生命周期内无 DB 校验继续使用；禁用/角色变更主要在 login/refresh 生效；认证 abuse guard 为进程内且未覆盖 generation/SSE/export/report。
- **最小交付**：短 TTL + session epoch/token version 或受控 introspection；禁用、降权、logout、改密递增 epoch；共享限流覆盖登录、生成并发、导出频率、SSE 连接/时长和举报滥用。
- **验收**：禁用/降权后的下一次敏感请求即拒绝；两实例共享限额；稳定返回 429 + retry hint；不记录原始凭据或把危机求助误限流掉。

#### S0-31 让告警和定时任务具备可证明的送达与单实例执行

- **现状证据**：Webhook 告警目前 fire-and-forget，失败仅 WARN；DAU/retention scheduler 没有 leader/lease、run history、freshness；多副本可能重复 purge 或保持旧 gauge。
- **最小交付**：有限 outbox/retry、HMAC 签名、host allowlist、去重、delivery 指标；scheduler leader/lease；记录开始/结束/分类计数/last-success；dry-run、pause、legal hold。
- **验收**：接收端短故障后可恢复送达且有重试上限；恶意 URL 拒绝；两实例只有一个 purge；任务过期/失败自动告警；消息不含用户正文。

#### S0-32 加密会话摘要及其迁移/删除链路

- **现状证据**：消息正文和记忆摘要已进入 `RestFieldCipher`，但 `conversation_summary.summary` 仍按明文 text 读写，可能包含敏感事实。
- **依赖**：先完成 S0-17-B 的通用 key ID/version 与 dual-read/single-write 基础；本任务是 summary 字段接线和存量 summary backfill 的唯一 owner。
- **最小交付**：摘要写读接入通用 cipher/key version；可重入 summary backfill；导出边界解密；删除覆盖消息时失效；备份/轮换流程纳入。
- **验收**：数据库与备份中的有效 summary 为加密格式；API/模型边界才解密；日志无明文；回填中断可继续；无痕/删除/账号注销无残留。

#### S0-33 在共享状态完成前硬性限制单副本部署

- **现状证据**：durable realtime resume 已有，但 live delta、在途取消、授权镜像、quota 和部分熔断状态仍是进程内实现；无证据表明当前部署会拒绝 runtime 副本数大于 1。
- **最小交付**：在 Compose/部署配置、startup preflight 和运维文档中将 Technical Alpha/Beta runtime 副本数固定为 1；若发现集群 membership 或声明副本数大于 1 则启动/发布失败；明确列出外置状态清单和进入 S2-37 的指标门槛。
- **验收**：单副本正常；副本数大于 1 的合成部署被硬阻断，而不是仅告警；故障恢复不会误起两个 active runtime；门禁不能被普通 feature flag 远程绕过。
- **停止条件**：本项只诚实限制当前能力，不授权顺手引入 Redis、消息总线、WebSocket 或 HA 平台。

## 6. S1：受控 Beta 核心价值和运营闭环（37 项）

S1 只在 D0 给出继续方向、相关 S0 依赖完成后进入。下面每一行都应独立成任务；不要把同一表的一整组交给一个 Agent。

### 6.1 首次体验、导航和聊天（S1-01～S1-12）

| ID | 功能 | 最小交付 | 依赖 | 可观察验收 |
|---|---|---|---|---|
| S1-01 | 连续首次使用向导 | AI 身份/18+ → 必要同意 → 角色偏好 → 首次聊天，3–5 步，可恢复 | S0-04、S0-18 | 新账号刷新/返回后能继续；必要步骤不可跳过；无内部术语 |
| S1-02 | 用户端 App Shell/首页 | 当前角色、最近会话、待确认记忆、提醒、服务状态；用户端与 ops/admin 分离 | S1-01 | 普通用户无需理解 Runtime/Technical Alpha 即可开始和回到最近任务 |
| S1-03 | Chat 空状态与开聊提示 | 受审核 starter prompts、模式解释、明确输入入口 | S1-01 | 新用户无需猜如何开聊；starter 只是填入/发送普通消息，不绕过审核 |
| S1-04 | 滚动锚定与“回到最新” | near-bottom 判断、阅读历史不被流式输出抢滚动、未读提示 | S0-20 | 长会话阅读历史时 UI 稳定；回到底部后继续自动跟随 |
| S1-05 | 会话摘要状态与用户视图 | A）W3 只接状态/覆盖范围并隐藏 deterministic 占位正文；B）S1-37 后才展示通过校验的真实摘要 | 展示正文严格依赖 S1-37 和产品确认 | “会话进展摘要（确定性）”永不作为内容摘要展示；删除覆盖消息后隐藏；不泄露 prompt/provider 字段 |
| S1-06 | 本地草稿最小化保存 | 默认只保当前页面；用户可选设备草稿；登出/换号清除 | 隐私决策、S0-20 | 离线草稿标明“未发送”；不缓存历史、token 或记忆；手动重试才发送 |
| S1-07 | 多标签页会话一致性 | BroadcastChannel 只广播 logout/invalidation/version；visibility 刷新 | S0-15、S0-18 | Tab A 登出/注销后 Tab B 清业务缓存；不广播 token/正文 |
| S1-08 | 会话服务端搜索 | 标题、消息正文的 owner-scoped 搜索；时间/关系过滤；keyset 分页 | OpenAPI + DB 搜索设计 | 结果带关系/会话上下文；加密正文搜索方案明确；无跨租户结果 |
| S1-09 | 会话置顶/归档/日期分组 | 独立状态，不复用删除/结束；列表稳定分页 | S1-08 | 归档不进入默认列表但可恢复；不影响记忆、导出或删除权利 |
| S1-10 | 生成反馈深化 | 在现有 kind 上加可选短说明、原因聚合和本人反馈历史 | 安全/隐私字段审查 | 不重复提交；内部聚合不暴露正文；可回溯 model/prompt/generation 版本 |
| S1-11 | 本轮“为什么这样回答” | 展示模式、服务等级、使用的已确认记忆 ID/友好摘要，不展示系统 Prompt | provenance contract | 无证据时明确“暂无可展示”；不泄露其他关系、provider secret 或安全规则 |
| S1-12 | 角色设置预览与离开保护 | 友好解释结构化选项、dirty state、保存前预览；不新增自由 Prompt | 现有 companion catalog | 未保存离开会提醒；刷新后以服务端值为准；预览不写正式会话 |

### 6.2 可信记忆深化（S1-13～S1-24）

| ID | 功能 | 最小交付 | 依赖 | 可观察验收 |
|---|---|---|---|---|
| S1-13 | 结构化记忆抽取 | 严格 JSON：类型、subject/value、时间、敏感度、置信度、evidence、scope | S0-07～09 | 模型不能直写 ACCEPTED；非法/敏感/缺证据全部 pending/rejected |
| S1-14 | 记忆类型与标签 | 偏好、沟通边界、近期事件、长期目标、共同经历等机器目录 | 先确认真实消费者 | 目录进入 Catalog/OpenAPI/DB/TS；不靠自由字符串分组 |
| S1-15 | 记忆服务端搜索/分页 | 关键词、类型、状态、时间、scope；只查 owner + relationship 许可范围 | S1-14 | 结果稳定分页；删除/过期/替代默认不混入当前事实 |
| S1-16 | 批量候选处理 | 小批量确认/拒绝/删除；逐条结果，不做全有或全无伪成功 | 现有单条状态机 | 跨关系、状态竞争和部分失败均安全；高敏仍逐条明确确认 |
| S1-17 | 冲突建议工作台 | subject+predicate/语义近似只生成“可能冲突”建议，不自动覆盖 | S1-13 | 用户手工事实优先；不明确则询问；旧事实保留替代链 |
| S1-18 | 陈旧记忆复核 | 根据久未使用、事件到期、用户纠错提示复核；非强迫、可忽略 | last-used/provenance | 忽略不会影响聊天；未确认不得自动删除或改写 |
| S1-19 | 事件跟进收件箱 | 展示待跟进/已过期事件；用户选择更新、完成、取消或暂不处理 | 现有 event fields | 过期事件不作为当前事实；模型不编造结果；不后台主动联系 |
| S1-20 | 记忆溯源 Deep Link | evidence 映射到会话/消息/时间；来源删除时显示不可用 | 安全的 evidence contract | 每条记忆可解释来源或明确不可用；不返回越权正文片段 |
| S1-21 | 召回使用记录 | 记录哪条已确认记忆进入哪次 ContextPlan、为何命中、何时最后使用 | S1-11 | 用户可见友好解释；日志不记录无关正文；删除后记录不再可用于生成 |
| S1-22 | 记忆纠错传播 | 编辑/替代后重建 embedding，失效相关摘要/缓存，不覆盖原审计链 | S0-09 | 旧向量不召回；摘要不继续引用旧事实；失败可重试 |
| S1-23 | Re-embed 运营任务 | checkpoint、限速、失败隔离、space 进度、暂停/恢复 | S0-09、worker 控制面 | 重启可续跑；不混 space；删除行不进入任务 |
| S1-24 | 召回质量反馈 | “记错/不相关/边界被触碰”绑定 generation+memory，进入评测而非自动删改 | S1-10、S1-21 | 反馈不会立即改真源；可计算 precision/错误召回/纠错闭环 |

### 6.3 提醒、数据权利、身份与运营（S1-25～S1-37）

| ID | 功能 | 最小交付 | 依赖 | 可观察验收 |
|---|---|---|---|---|
| S1-25 | 提醒生命周期增量 UI | 复用现有 PATCH/status 完成 H5 编辑；只为缺口补暂停/恢复、skip-next、due/overdue 和时区呈现 | 现有更新/完成 API；新增字段前先核对真实缺口 | 编辑不重建记录；重复规则幂等；UTC/本地时间一致；不重做已有 CRUD，不声称已外部推送 |
| S1-26 | 站内提醒收件箱 | 只投递用户明确创建的 reminder；delivery record、已读/稍后提醒 | S1-25 | 重试不重复投递；角色主动程度不能后台创建消息 |
| S1-27 | 安静时段和通知预览 | 设置时区/静默时段/渠道；外部通知仍保持关闭 | S1-25、同意策略 | 用户能预览何时会提醒；未同意时无外发 |
| S1-28 | 导出任务跨刷新恢复 | 本人最近导出任务列表、有界轮询、READY/FAILED/EXPIRED；token 不持久化 | OpenAPI 扩展 | 页面刷新能找回任务；一次性 URL 不被轮询消费；失败可重建 |
| S1-29 | 导出格式完善 | JSON（机器可读）+ Markdown/HTML（人可读），所有 AI 内容保持标识 | S1-28、标识规则 | 下载/复制/导出均保留 AI 标识；大导出不占满 runtime heap |
| S1-30 | 删除任务进度与回执 | 对长删除提供状态、失败域、完成时间；回执不含被删正文 | S0-16/17 | 不能在实际失败时显示完成；重复请求幂等；可向支持提供 request ID |
| S1-31 | 同意影响预览 | 撤回前列出将停止的处理目的和未执行任务，不恐吓用户 | 授权快照 | 撤回后新/排队外发停止；基本数据权利和安全能力仍可用 |
| S1-32 | 隐私中心 | 汇合同意、保留期、导出、六粒度删除、本地缓存清理 | S1-28～31 | 用户能区分消息/会话/关系/全部聊天/账号删除范围 |
| S1-33 | Worker 运营控制面 | backlog、lag、attempt、dead-letter、lease age；安全 cancel/requeue | S0-14 RBAC | replay 重验 owner/授权/安全且不重复 message/memory/usage；操作审计 |
| S1-34 | Provider/队列健康台 | 实际健康、熔断、延迟、错误率、预算、queue lag；只读起步 | S0-10/11、metrics | 页面状态来自运行事实；不能直接暴露密钥、endpoint 凭据或用户正文 |
| S1-35 | 服务公告与维护状态 | 版本化公告、影响范围、开始/结束；只有给出数据时才显示预计恢复 | S0-02、service mode | 事故文案不角色化、不编造 ETA；状态变化可审计 |
| S1-36 | 管理端 Prompt/Persona/Model 版本只读 Registry | 展示已批准版本、适用模型、上线/回滚状态，不在 UI 任意编辑自由 Prompt | S0-24 | 生产使用版本可追溯；未 approved 版本不可路由 |
| S1-37 | 真实异步会话摘要 | 新增 summary work item；严格 schema、覆盖范围、事实/安全校验、model/prompt/version/confidence；失败保留旧摘要或不写 | S0-07、S0-32、S0-24 | 不总结未覆盖/跨关系消息；删除/无痕立即失效；低质量不覆盖高质量；确定性占位不冒充真实内容摘要 |

## 7. S2：Beta 数据验证后的质量、体验与规模化（50 项）

S2 不是“等 S0 做完就自动开始”。每项都必须先写出要改善的指标、当前基线和停止阈值；没有真实消费者、没有基线或只能靠增加依赖感提高留存时，不立项。

### 7.1 模型、Prompt、记忆与评测（S2-01～S2-12）

| ID | 功能 | 最小交付 | 开工证据 | 可观察验收 |
|---|---|---|---|---|
| S2-01 | Prompt Registry 与不可变版本 | system/persona/safety/summary/extraction Prompt 分类型、审批状态、兼容模型、回滚点 | 至少两个真实 Prompt 版本需要并行管理 | 每次 generation 可追溯确切版本；运行中不可静默覆盖；不提供生产自由编辑器 |
| S2-02 | 对话质量 Golden Set | 合成/明确授权且去标识样本，覆盖倾听、建议边界、退出、重复、长对话 | D0 已定义“好回答” | 固定 rubric、盲评和版本差异；不能只以模型自评作为发布门禁 |
| S2-03 | 扩展现有安全红队评测 | 在已有 1,000 条确定性 corpus 上增加 Prompt Injection、跨关系泄漏、依赖诱导、未成年人、PII 和 provider 输出绕过 | S0-07/08 完成 | 保留现有回归；关键越权/泄漏为 0；新增事故样本进入 corpus；失败阻断 rollout |
| S2-04 | 扩展结构化记忆抽取评测 | 复用现有候选评测生成/统计入口，新增类型、证据、敏感度、时间、scope、冲突和拒绝样本 | S1-13 有真实实现 | 同一入口统计 precision/recall、敏感误存率、缺证据率；不另造无人消费 harness |
| S2-05 | 扩展记忆召回离线评测 | 复用现有召回评测工具，新增跨关系、已删/过期/替代负例和真实 embedding 分层 | S0-09 与 S1-21 | 删除复活和跨关系召回为 0；质量阈值按语言/长度/类别分层；旧基线继续可比 |
| S2-06 | 会话摘要事实性评测 | 覆盖、遗漏、幻觉、过期事实、删除后残留、跨关系泄漏 | S0-32、S1-37 | 摘要只引用覆盖范围；关键幻觉/泄漏为 0；低质量不覆盖高质量 |
| S2-07 | 在线反馈回灌评测集 | 反馈只作为待标注候选，去标识、采样、访问审计、保留期 | S1-10/24 且 PIA 允许 | 用户反馈不会直接训练或改变事实；标注结果可追溯到 release |
| S2-08 | Shadow / Canary 比较 | 合成流量优先；真实流量仅在明确同意、最小化和供应商合同允许时双跑 | S0-24、预算和同意批准 | shadow 输出不展示、不写记忆；成本可限；异常能自动停止 |
| S2-09 | 质量/成本/延迟联合路由 | 基于已批准 deployment 的实测指标选择，不让模型自选供应商 | 至少两个可替代 deployment、有足够样本 | route decision 可解释；硬安全/授权/预算优先于质量优化；无无限 fallback |
| S2-10 | Context Budget 可观测性 | 按块记录 token 估算/实际、被裁剪原因、记忆命中和输出预算 | S0-03 稳定 | 能回答“为何丢上下文”；指标不含正文；超限可定位到策略版本 |
| S2-11 | 第二 Provider 协议路径 | 用独立 adapter 证明路由/授权/熔断不是单供应商特例 | 第一路径稳定且业务需要容灾/议价 | 相同 contract suite 通过；故障隔离；供应商间不传递会话数据 |
| S2-12 | 模型退役与回滚编排 | deprecated/blocked/rollback 状态、会话轮次边界迁移、embedding space 迁移计划 | 真实模型出现版本替换 | 禁用模型不再新路由；旧 generation 仍可审计；不在流式中途换模型 |

### 7.2 用户价值深化（S2-13～S2-24）

| ID | 功能 | 最小交付 | 开工证据 | 可观察验收 |
|---|---|---|---|---|
| S2-13 | 可选“整理一下”反思卡 | 用户主动触发，把本轮内容整理成可编辑要点；默认不写记忆 | 访谈显示用户确有收束需求 | 不作心理诊断；用户确认后才保存；删除会话后同步失效 |
| S2-14 | 非医疗化状态 Check-in | 用户自选词/量表记录当下状态，可跳过、可删除，不推断疾病 | D0/Beta 明确有此需求并经安全评审 | 不把低分变成诊断；不以连续打卡制造压力；危机文本仍走安全路径 |
| S2-15 | 用户确认的周期回顾 | 只使用本人已确认记忆和选定会话，预览后生成周/月回顾 | S1-20/21 且用户主动开启 | 来源可点开；错记可纠正；默认关闭；不发送“你很久没来了”类诱导 |
| S2-16 | 消息高亮与书签 | 用户手动收藏某条消息/摘要，独立于记忆事实 | Beta 中有回看需求 | 可搜索/取消；删除源消息后书签失效；不自动把 assistant 话语当用户事实 |
| S2-17 | 用户控制的会话重现 | 在首页展示用户固定或明确选择的旧会话，不由模型猜“你该回顾什么” | S1-09 与用户研究 | 可完全关闭；敏感/已归档默认不浮现；不以怀旧文案诱导依赖 |
| S2-18 | 第二角色受控实验 | 只增加一个审核角色，固定人格边界和独立 relationship/memory scope | 单角色指标证明角色差异是主要需求 | A/B 指标预注册；不跨角色泄漏；无自由 Prompt 或用户上传人设 |
| S2-19 | 外部通知 Adapter | Web Push/原生通知的统一 consent、模板、quiet-hours、delivery receipt | S1-25～27 且用户明确需要离站提醒 | 默认关闭；只发用户创建提醒/服务通知；无聊天正文；一键撤回 |
| S2-20 | 提醒投递历史与 Snooze | 渠道结果、去重、重试、稍后提醒、时区变化处理 | S2-19 或站内提醒数据足够 | 不重复轰炸；失败可见但不伪称送达；snooze 有上限和取消 |
| S2-21 | 用户消息纠正与分支 | 编辑已发送内容时创建新分支/版本，不原地改写模型已看过的历史 | 用户确有纠正上下文需求 | 原版本可审计；新分支独立 generation/memory；删除语义明确 |
| S2-22 | 会话分支比较与命名 | 只比较用户主动创建的两个分支，选定主线，不自动合并记忆 | S2-21 已证明被使用 | 选择主线不删除旁支；记忆来源显示分支；无跨分支事实污染 |
| S2-23 | 多语言与 i18n | 先抽取 UI 文案和错误目录，再支持一门有真实用户需求的语言 | 有目标用户、审核和安全语料 | 安全分类/危机模板/导出标识同语言可用；缺翻译时不静默混用 |
| S2-24 | 安装型 PWA 外壳 | manifest、更新提示、公开静态壳离线；敏感 API/聊天数据禁止默认缓存 | H5 留存数据证明安装有价值 | 更新不会卡旧契约；离线明确不可生成；Cache Storage 无 token/正文/记忆 |

### 7.3 H5 产品工程与可用性（S2-25～S2-36）

| ID | 功能 | 最小交付 | 开工证据 | 可观察验收 |
|---|---|---|---|---|
| S2-25 | 设计 Token 与共享组件 | 色彩、排版、间距、焦点、状态页、确认框、表单错误；从真实重复处提取 | 至少三处同类实现发生漂移 | 页面不再各自定义状态语义；主题变化有视觉回归；不先造大而全组件库 |
| S2-26 | 热点页面按业务缝拆分 | `chat.vue`、`index.vue`、`admin.vue` 仅按已稳定的 composable/store/component 边界拆 | 文件冲突或测试维护已成为真实成本 | 行为不变、测试先固定；每个新模块有一个消费者以上；不做顺手改版 |
| S2-27 | 服务端状态缓存层 | query key、失效、去重、重试和 owner 切换清理；评估轻量实现后再选依赖 | 多页重复请求/失效 bug 有数据 | logout/换号零残留；写后失效准确；错误不回退成旧账号数据 |
| S2-28 | 统一页面异步状态机 | 复用 S0-21 的状态模型覆盖列表、详情、异步任务和部分成功 | 已有至少三类状态漂移 | 同一错误码呈现一致；保留成功子结果；重试只重做失败动作 |
| S2-29 | 移动浏览器/软键盘矩阵 | iOS Safari、Android Chrome、横竖屏、safe-area、输入法遮挡、粘贴和返回 | 目标设备比例明确 | 输入框始终可见；滚动不跳；后台恢复不重复发送；窄屏无关键遮挡 |
| S2-30 | 前端性能预算 | 首屏、chat 长列表、内存峰值、bundle、流式渲染频率；基于中低端设备 | 先测得真实瓶颈 | 设回归阈值；列表只虚拟化真实热点；不牺牲可访问性或错误真实性 |
| S2-31 | WCAG 2.2 AA 审计闭环 | axe 自动检查 + 键盘/读屏/缩放/对比度人工路径，优先登录/聊天/记忆/隐私 | Beta 面向真实用户前 | 关键旅程无阻断级问题；焦点顺序/状态播报可验证；不只追求扫描分数 |
| S2-32 | 平台能力 Adapter 层 | 只为通知、存储、剪贴板、文件下载等真实差异建立 H5/native seam | 确定第二平台后 | 业务 store 不直接散落平台判断；H5 行为不退化；无第二平台则不做 |
| S2-33 | 本地数据隐私面板 | 展示并清理草稿、偏好和安装缓存；说明哪些内容从不落本地 | S1-06/07、S2-24 | 一键清理后可证明无敏感缓存；不会误删服务端数据；换号自动清理 |
| S2-34 | 最小化产品漏斗分析 | 只记事件类型、阶段、耗时、固定失败码；禁止正文/自由属性/稳定跨站标识 | D0 指标定义和 PIA 允许 | 能测门禁→首聊→记忆确认；事件字典有用途/保留期；opt-out 生效 |
| S2-35 | 前后端契约生成/漂移防护 | 从 OpenAPI 生成或验证核心 DTO/error code，逐域迁移，不一次重写 API 层 | 已发生两次以上字段漂移 | CI 能抓必需字段/枚举破坏；生成物只由脚本产生；错误仍保留 request ID |
| S2-36 | 关键页面视觉回归 | 固定视口/主题/状态的少量截图，对登录、聊天、记忆、隐私中心做差异审阅 | 设计 Token 稳定 | 只覆盖高风险布局；动态时间/ID 已稳定化；不把所有像素变化当失败 |

### 7.4 平台、发布、可靠性与治理（S2-37～S2-50）

| ID | 功能 | 最小交付 | 开工证据 | 可观察验收 |
|---|---|---|---|---|
| S2-37 | 多实例状态 ADR 与实现 | 在 S0-33 门禁基础上，按实际瓶颈外置 realtime/cancel/auth/quota/breaker | 有扩容/HA 目标 | 未完成共享状态前副本数>1 继续失败；完成后跨节点测试通过；仍用 Fetch-SSE |
| S2-38 | API 与 Worker 进程拆分 | 仅当队列/资源数据证明需要，分离资源上限、身份和扩缩策略 | p95/队列/故障域数据证明单进程受限 | API 故障不丢任务；worker 无多余 Web 权限；部署/回滚可演练 |
| S2-39 | 合成数据 Staging 环境 | 与生产同版本/权限/网络策略，使用 Fake/Failure provider 与合成账号 | 真实发布链路需要预演 | 无生产凭据/用户数据；migration、SSE、失败注入、回滚能重复执行 |
| S2-40 | 全纵切 Release E2E | Compose/Postgres/runtime/worker/H5，覆盖生成、SSE、阻断、撤回、导出、删除 | S0-23 基础真实浏览器链路稳定 | release job 必须通过；失败保留脱敏诊断；不拖入秒级日常检查 |
| S2-41 | 定期恢复演练与 RTO/RPO | 从备份/PITR 恢复到隔离环境，验证密钥、RLS、数据完整性和恢复后禁外发 | 已有生产数据责任和恢复目标 | 演练有实际 owner/时间/结果；恢复环境默认断 egress；失败触发行动项 |
| S2-42 | 零停机 Schema 演进 | expand/contract、兼容窗口、旧 worker drain、migration lock/超时策略 | 开始滚动部署或多版本并存 | N/N-1 兼容路径有测试；回滚不需破坏性 migration；生成物真源一致 |
| S2-43 | Edge 浏览器安全策略 | CSP report-only→enforce、Permissions-Policy、API/SSE `no-store`、必要 COOP/CORP | 第三方资源清单稳定 | H5 smoke 不破坏；聊天/导出不被缓存；未知脚本/连接被阻断并可观察 |
| S2-44 | 异步全链路 Trace | W3C trace 从 HTTP→work item→provider attempt→finalize→SSE，内容脱敏 | request ID 已不足以定位事故 | 一次合成请求可完整串联；trace/log 无正文、token、key 或联系人 |
| S2-45 | 供应链硬门禁 | 传递依赖、容器、secret、SBOM/provenance；高危例外有 owner/期限 | 发布面对真实用户/供应商前 | 无例外高危阻断 release；到期例外自动失败；构建可追溯且不泄密 |
| S2-46 | 管理员 MFA / Step-up | 优先接托管 IdP/WebAuthn；高影响操作需要近期验证、事由和审计 | 有真实远程管理员 | 无 step-up 不能禁用账号、导出、admit provider 或处置紧急 case；恢复流程可演练 |
| S2-47 | 审计型 Feature Flag/Remote Config | 只管理有真实 rollout 消费者的开关，含环境、owner、到期、变更审计 | 开关已散落且发布风险真实存在 | 无 owner/过期开关报警；安全默认值 fail-closed；不能远程打开红线能力 |
| S2-48 | SLO/事故状态台 | generation 成功/安全阻断/queue lag/SSE/通知/数据权利任务的新鲜度与事件时间线 | 有值班和告警接收人 | 状态来自运行事实；公开文案不泄密、不角色化、不编造 ETA |
| S2-49 | 大导出对象存储路径 | 大文件异步流式生成、加密、短期一次性下载、过期删除、重建 | 内联 DB payload/heap 已成瓶颈 | URL 有短 TTL；对象按 owner 隔离；删除/过期可证明；小导出无需复杂化 |
| S2-50 | 架构边界与实际 Ownership | 更新真实 14 模块图；仅在 Owner 确定后添加平台可消费的 CODEOWNERS | 出现多团队/多 agent 冲突 | PR 能自动找到真实负责人；迁移、安全、provider、前端热点有 owner；不建无人消费清单 |

## 8. S3：公开版或独立探索项目（30 项）

以下项目并非当前承诺。它们都需要独立立项，不能由“完善项目”自动授权；涉及外部账户、真实支付、新供应商、新生产依赖或敏感数据时，必须由 Owner 先批准范围和平台。

### 8.1 渠道、商业化与身份（S3-01～S3-08）

| ID | 探索项 | 为什么可能有价值 | 独立门槛/主要风险 |
|---|---|---|---|
| S3-01 | 公开注册与反滥用 | 扩大可用人群 | 当前明确禁用；需 PIA、成年核验、验证码/风控、申诉、容量和值班全部完成 |
| S3-02 | 订阅、权益与真实支付 | 可持续成本回收 | 当前明确禁用；需订单/退款/对账/税务/客服/未成年人隔离，不能复用 simulated entitlement 冒充真实账务 |
| S3-03 | 邀请/候补名单产品化 | 在公开前控制增量和容量 | 需要公平规则、反倒卖、隐私说明；不能形成暗中公开注册 |
| S3-04 | 原生 iOS 应用 | 更好的通知、后台和系统集成 | App Store、隐私清单、账号删除、端侧存储、审核和平台适配 |
| S3-05 | 原生 Android 应用 | 覆盖更多设备和通知能力 | 商店/渠道差异、后台限制、设备碎片、安全存储 |
| S3-06 | 小程序渠道 | 低门槛触达 | 平台内容审核、登录身份、网络/流式限制、数据处理主体和用户退出路径 |
| S3-07 | 企业/组织受控部署 | 为特定组织提供隔离环境 | 绝不能让组织管理员读聊天正文；租户、合同、数据处理和支持边界需重做 |
| S3-08 | 多区域/数据驻留 | 满足地域合规与灾备需求 | 数据复制、密钥、供应商区域、删除传播、RTO/RPO 和跨境评估 |

### 8.2 角色和交互形态（S3-09～S3-18）

| ID | 探索项 | 为什么可能有价值 | 独立门槛/主要风险 |
|---|---|---|---|
| S3-09 | 多角色关系 | 不同倾听/整理风格 | 先证明 S2-18；记忆必须按 relationship 隔离；切换不能伪装成同一主体 |
| S3-10 | 审核角色目录 | 提供有限选择而非自由 Prompt | 每个角色要有安全评测、版本、年龄适用和退役策略；禁止用户公共 Prompt 市场 |
| S3-11 | 用户自定义外观 | 提高亲近感但不改变事实边界 | 只允许审核选项；上传图像涉及审核、存储、版权和删除 |
| S3-12 | 语音转文字输入 | 降低输入门槛 | 明确录音指示、临时音频删除、方言准确率、敏感环境和供应商数据处理 |
| S3-13 | 文字转语音播放 | 改善无障碍和陪伴感 | 明确 AI 声音；禁止未经授权仿真人；后台/锁屏隐私和耳机路由 |
| S3-14 | 实时双工语音与打断 | 更自然的对话 | 延迟、回声、增量审核、危机打断、录音同意和高成本；不等同于直接换 WebSocket |
| S3-15 | 审核头像/场景图生成 | 丰富视觉表达 | 生成内容标识、内容审核、版权、成本、缓存/删除；不得仿真人或诱导关系误认 |
| S3-16 | 图片理解 | 用户可分享场景/物品 | EXIF/人脸/第三方/位置隐私、图片审核、供应商能力与数据类别授权 |
| S3-17 | 文件/长文本附件 | 帮助用户整理自己提供的材料 | 恶意文件、版权、PII、Prompt Injection、保留和向量污染；需沙箱和大小上限 |
| S3-18 | 端侧小模型/离线回复 | 隐私、成本和弱网体验 | 能力/安全不一致、模型更新、设备资源；离线回复必须显式标注且不能假装云端已同步 |

### 8.3 外部知识、工具和可携带性（S3-19～S3-30）

| ID | 探索项 | 为什么可能有价值 | 独立门槛/主要风险 |
|---|---|---|---|
| S3-19 | Web 搜索与引用 | 对时效事实给出可核验来源 | 搜索结果 Prompt Injection、版权、隐私查询泄漏、引用真实性；默认不用于纯陪伴回答 |
| S3-20 | 用户个人知识库 RAG | 让用户基于自己的材料整理/回顾 | ACL、删除传播、文件攻击、embedding space、引用；与“用户事实记忆”严格分库 |
| S3-21 | 只读日历接入 | 帮助回顾用户选择的计划 | OAuth 最小 scope、撤权、时区、第三方内容注入；默认不写日历 |
| S3-22 | 日历写入/任务工具 | 用户确认后创建事件或任务 | 每次外部写入预览+确认、幂等/补偿、审计；绝不由角色自主执行 |
| S3-23 | 可穿戴设备接入 | 用户主动引用睡眠/活动趋势 | 健康数据属于高敏；不得诊断；授权粒度、驻留、删除和供应商合同独立评审 |
| S3-24 | 受控 Tool Calling 框架 | 扩展少量明确动作 | schema allowlist、最小权限、超时、幂等、预览确认、Prompt Injection 隔离和费用上限 |
| S3-25 | 第三方任务/笔记连接器 | 把用户确认结果写到常用工具 | 每个连接器独立 OAuth/权限/撤权/失败补偿；不能因插件可用就默认安装或连接 |
| S3-26 | 公共开发者 API | 支持经审核的生态集成 | OAuth、scope、速率、审核、数据处理协议、版本和滥用处置；不得暴露内部 Prompt/跨用户记忆 |
| S3-27 | 数据可携带导入 | 从规范化 JSON 导入会话/记忆草稿 | schema 版本、来源可信度、恶意内容、重复/冲突；导入事实只能 pending |
| S3-28 | 本地优先加密同步 | 提高隐私和多端连续性 | 密钥恢复、多端冲突、搜索/审核/删除语义非常复杂；需单独架构研究 |
| S3-29 | 服务退出/长期可读档案 | 产品终止时让用户安全取回数据 | 标准格式、密钥/下载期限、删除、供应商终止；不承诺 AI 角色永久存在 |
| S3-30 | 灾难恢复第二站点 | 降低区域级故障 | 只有 RTO/RPO 与业务规模证明需要；跨区密钥、RLS、复制和外发门禁必须演练 |

## 9. 明确不建议加入当前 Backlog 的能力

这些不是“低优先级”，而是与当前定位、红线或风险不相容；除非产品方向被正式重写并完成独立评审，否则 Agent 不应实现：

- 面向未成年人的生成式陪伴，或以“家长同意”简单绕过 18+ 边界；
- 仿冒真实人物、明星、在世/已故亲友，或未经授权的声音/肖像克隆；
- 当前阶段的恋爱、成人、性化角色和排他性“唯一伴侣”叙事；
- 用户自由 Prompt/角色公共市场、无审核角色分享、排行榜或社交私信；
- 以连续签到、吃醋、冷落惩罚、失忆付费墙、“你只能和我说”等机制制造依赖；
- 未经逐次确认替用户发送消息、下单、付款、发帖、联系紧急联系人或操作外部账户；
- 默认用私人聊天训练模型，或把“改进服务”同意混入必要服务同意；
- 让运营/管理员默认浏览原始聊天正文，以此替代严格 case 范围和审计；
- 把系统包装成心理治疗、医疗诊断，或提供自动化法律、金融、高风险健康决策；
- 在 Technical Alpha 打开公开注册、真实支付、语音、图片、WebSocket 或未批准 provider。

## 10. 推荐实施顺序与依赖

这里的 Wave 表示依赖顺序，不承诺日期。一个 Wave 内也只能并行修改互不重叠的模块；发现共享真源或热点文件时必须串行。

| Wave | 目标 | 任务范围 | 进入下一 Wave 的门槛 |
|---|---|---|---|
| W0 · 真源止血 | 修确定性错误，确认项目是否继续 | S0-01～06、S0-25～27、S0-17-B→S0-32～33 | D0 有结论；通用密钥版本先于摘要回填；时间/准入/同意/数据分类/DB 权限/单副本边界不再漂移 |
| W1 · 安全 Provider 路径 | 外发可授权、可阻断、可计费、可回滚 | S0-07～12、S0-24、S0-28～31 | 合成流量下 moderation/embedding/routing/budget/告警全闭环，默认仍关闭 |
| W2 · Beta 人工运营 | 真实身份、安全事件、退出和队列有人处置 | S0-13～16、S0-17-A/C、S1-33～36 | Owner 完成 TODO A4 单人连续使用验收；值班/申诉/case/worker 恢复演练通过 |
| W3 · 连续 H5 旅程 | 把现有接口变成真实可用的用户纵切 | S0-18～23、S1-01～04、S1-05-A、S1-06～12、S1-25～32 | 真实浏览器关键旅程通过；移动弱网不假成功、不丢上下文；占位摘要正文保持隐藏 |
| W4 · 可信记忆深化 | 证明记忆/摘要确实提升体验且不越权 | S1-13～24、S1-37→S1-05-B | 召回/纠错/删除/溯源/摘要指标达到预设阈值，跨关系和复活为 0 |
| W5 · 数据驱动投资 | 只做有基线和明确改善目标的能力 | S2-01～50 | 每项独立达到指标或停止；没有“大包全做” |
| W6 · 独立探索 | 公开版、商业化、多模态、工具 | S3-01～30 | 每项另有 ADR、Owner 授权、成本/隐私/安全/运营结论 |

### 10.1 当前最值得先派发的 16 个任务

按“风险降低 × 价值 × 可验证性 × 依赖解除”排序：

1. `S0-03` 上下文预算配置绑定；
2. `S0-02` Beta 时间/状态真源；
3. `S0-05` Help/Report 状态漂移；
4. `S0-25` 同意撤回即时生效；
5. `S0-26` Payload 与数据分类一致；
6. `S0-27` 数据库最小权限角色；
7. `S0-33` 单副本部署硬门禁；
8. `S0-04` 服务端 Beta Admission Gate；
9. `S0-07` 真实 moderation fail-closed；
10. `S0-08` Prompt Injection/Memory Poisoning；
11. `S0-09` 真实 embedding 与 space 迁移；
12. `S0-10C/11` 动态服务状态和 Registry/Quota 真源；
13. `S0-12` 成年核验真实 Adapter；
14. `S0-14` Case Workflow 与细粒度 RBAC；
15. `S0-13` 紧急联系人可靠发送；
16. `S0-18～23` H5 导航、关系上下文、弱网和真实浏览器闭环。

其中 1–3 是短路径确定性修复；4–15 是 Beta/真实 provider 门禁；第 16 项必须继续拆成 6 个独立任务，不能交给一个 Agent 一次改完。

### 10.2 关键依赖图

```text
D0 决策 S0-01
├─ 真实用户路径 ─ S0-02/04/12/14/15 ─ S1 首次体验/运营
├─ 真实 Provider ─ S0-07/08/25/26/28/29 ─ S0-09/10/11/24
├─ 数据权利 ─ S0-16/17/32 ─ S1-28～32 ─ S2-41/49
├─ H5 纵切 ─ S0-18～23 ─ S1-01～12 ─ S2-25～36
└─ 可信记忆 ─ S0-07/08/09 ─ S1-13～24 ─ S2-04～07/13～17

单副本硬门禁 S0-33
├─ 先收口局部跨进程缺口 S0-10/25/30/31
└─ 有扩容证据后才进入 S2-37/38
```

## 11. 给其他 Agent 的派发边界

### 11.1 唯一规则入口

通用开发流程、检查命令、报告格式和历史档案边界只以根 `AGENTS.md` 与
`docs/engineering/checks-principles.md` 为准；本文只补充候选项特有的依赖、热点文件和拆分顺序。

### 11.2 写入 Ownership 和并行约束

- 一个 Agent 只认领一个小任务、一个 Epic 子交付或一个紧密耦合的任务对；同一文件/模块同时只有一个写入 owner。不要因为有一个编号就把跨模块 Epic 整包交给单个 Agent。
- 修改 `product-scope.yaml`、OpenAPI、Catalog、migration 链的任务串行；先改真源，再运行现有生成脚本，禁止手改 `specs/generated/**`。
- `AuthDataSourceConfig.java` 是 provider/auth/memory 的公共热点：moderation、embedding、admission、授权接线应由一个集成 owner 串行落地，其他 Agent 只写独立 adapter/test。
- `chat.vue`、`index.vue`、`admin.vue` 是前端热点：先固定测试，再按任务逐个改；不要让“拆组件”和“改交互”同时写同一页面。
- migration 只前进，不改已经发布的 V1–V77；新迁移号在开工时由单一 owner 协调。
- 外部 webhook、年龄供应商、通知、支付、对象存储等任务，只有 Owner 给出平台与授权后才能写真实集成；此前只允许定义 seam、contract 和 fake，不自动安装插件或连接账户。
- 发现工作区已有改动时先识别归属并绕开；无法绕开则报告冲突，不通过 reset/checkout 清理。

### 11.3 建议的首轮 Agent 批次

| 批次 | 任务/次序 | 文件重叠控制 | 批次出口 |
|---|---|---|---|
| A | S0-02、S0-03、S0-05 | contract/check、runtime config、H5 help 各一个 owner | 三个确定性漂移均有回归测试 |
| B | S0-25+26、S0-27+33、S0-04 | 25/26 同一授权 owner；27/33 同一部署/DB owner；04 等公共 config 空闲后集成 | 撤回、类别、权限、单副本、准入五条负例全 fail-closed |
| C | S0-07、S0-09、S0-28 | adapter/test 可并行；Spring wiring 最后交单一集成 owner | 合成 provider contract 通过，默认开关仍关闭 |
| D | S0-08、S0-10+11、S0-29 | injection/memory、routing、budget 分模块；route decision 契约由单一 owner | 红队、故障隔离、并发预算测试通过 |
| E1 | S0-14 | 单一 owner 先冻结 case/RBAC、OpenAPI 和 migration；年龄申诉也是该 case 契约的消费者 | case 状态和角色边界可供 adapter 接入 |
| E2 | S0-12、S0-13 | 年龄 adapter 复用 E1，不再自建申诉状态；紧急 webhook 可在独立模块并行 | 成年核验和紧急事件在 fake 接收端可演练 |
| E3 | S0-15 | 等 auth/admin 公共文件空闲后单独实施 refresh family/重置/re-auth | 会话撤销与凭据重置负例通过 |
| F1 | S0-18→19→20→21→22 | 按箭头串行；先导航/上下文，再 realtime/状态，最后危险操作页面 | H5 行为和共享状态在稳定候选上冻结 |
| F2 | S0-23 | E2E Agent 只在 F1 稳定候选上写 harness/tests，不反向改产品行为 | 6 条关键旅程真实浏览器通过 |

批次 B 以后是否继续，应由批次出口的结果决定；不要提前同时派发全部 S0/S1。

### 11.4 跨模块 Epic 的建议子交付

| Epic | 子交付切法 | 必须串行的集成点 |
|---|---|---|
| S0-10 | A supplier key/失败分类（已完成）；B session affinity（已完成）；C service-mode 聚合（下一子交付） | C 只消费已稳定的 route health/decision，不重做 A/B |
| S0-11 | A DB admission 真源；B route-decision 审计；C 非货币权益 quota | router wiring 和公共配置由一个集成 owner |
| S0-14 | A case schema/state；B RBAC；C assign/resolve API；D 脱敏 UI | schema/OpenAPI 先冻结，后续只消费 |
| S0-17 | A retention policy/runner；B 仅做通用 key version/dual-read/single-write；C PITR 删除防复活 | B 先于 S0-32；summary 接线/backfill 只归 S0-32；deletion taxonomy 和 migration 号统一协调 |
| S0-24 | A 合成 smoke/eval；B canary 阈值；C rollback/告警 | 只有 A PASS 才允许内部 canary |
| S0-31 | A 可靠 webhook outbox；B scheduler leader/history | 共用告警码/指标契约，DB migration 串行 |

S0-15 与 S0-30、S0-11 与 S0-29 已按责任拆开：前者分别负责 refresh family 与 access 失效/业务限流，后者分别负责产品权益 quota 与货币成本预算。实现 Agent 不得再把它们合并成一个“大 Auth”或“大计费”重构。

## 12. 验收入口

本文不另建通用 Definition of Done 或第二套验证矩阵。每个候选项自己的“验收”和“停止条件”是产品输入；
实际开发、检查与结果报告统一执行根 `AGENTS.md` 和 `docs/engineering/checks-principles.md`。

## 13. 指标：衡量价值，不衡量依赖

### 13.1 必守安全/权利指标

- 未授权 provider outbound：`0`；
- 跨 owner/relationship 数据泄漏：`0`；
- 已删除记忆/消息/摘要复活：`0`；
- 模型直接写入已确认高敏记忆：`0`；
- 同意撤回、账号禁用或删除后新增外发：`0`；
- AI 内容在交互、复制、下载、导出场景的标识遗漏：`0`；
- 数据权利任务“假完成”：`0`。

### 13.2 核心价值指标

- 从门禁完成到首轮有效对话的完成率和耗时；
- 用户主动结束后认为“被理解/没有被评判”的反馈，不用总时长替代；
- 记忆候选确认率、纠错率、误召回率、敏感误存率；
- 记忆溯源打开后完成确认/纠错的比例；
- SSE 重连恢复率、重复发送率、终态一致率；
- reminder 的用户主动创建、按时处理和关闭率，而不是通知点击率；
- 导出、删除、撤回、申诉一次完成率和失败恢复率。

### 13.3 反指标

以下增长不能作为成功：夜间停留更久、连续签到天数、离开后被主动拉回次数、用户表达“只有 AI 理解我”、关闭通知/删除账号受阻、通过误记制造更多互动。

## 14. 开工前仍需 Owner 明确的决策

这些信息不能由 Agent 猜测或代填：

1. D0 的招募方式、样本是否足够，以及最终 `GO/PIVOT/STOP`；
2. Alpha/Beta 唯一服务时间、目标环境、实际值班人和告警接收端；
3. H5 是否永久强制同源、只需同站不同源，还是必须支持会受第三方 cookie 限制的跨站部署；
4. 首个真实 generation/moderation/embedding 供应商、区域、模型、价格和数据处理条款；
5. 成年核验、紧急联系人 webhook、通知和对象存储平台；
6. 必要同意集合、外发数据类别、摘要/埋点的敏感级别和保留期；
7. 当前部署是明确单副本，还是 Beta 前必须多实例；
8. 管理员身份源、MFA/step-up 方案和 case 细粒度角色；
9. Beta 的目标浏览器/设备、语言以及无障碍验收范围；
10. 真实模块 Owner，之后才有资格添加 CODEOWNERS 或生产发布审批。
11. TODO A4 的单人连续使用验收由谁执行、使用何种合成/内部账号，以及通过/停止结论。

缺少上述决策时，Agent 可以继续完成与其无关的确定性修复、fake/contract 和测试，但必须停在真实启用、外部写入或生产配置之前。

## 15. 文档维护边界

- 本文初始审计基于 `485a87fa`，最近对账到 `8c9711b5`，不是新的机器真源；实现后以 Catalog、OpenAPI、代码、migration 和 README 为准。
- 完成任务时修正对应项的现状证据或在真实工作跟踪系统中关闭任务；不要恢复旧 `docs/tasks/evidence/handoffs` 流程，也不要为每项创建证据包。
- 仓库继续演进后，应删除已完成项、合并被实现取代的候选、补充新证据；不要让路线图永久累积成愿望清单。
- 若实现发现本路线图的前提错误，以代码/契约/真实测量为证据修正文档，不为了“完成编号”硬做功能。

当前总计：`S0 33 + S1 37 + S2 50 + S3 30 = 150` 个候选编号；其中只有 S0 和经 D0 许可的 S1 可进入近期排期，跨模块 Epic 必须先拆成单一 owner 子交付。
