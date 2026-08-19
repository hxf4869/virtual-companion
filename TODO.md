# TODO

产品待办（现状声明见 README）：

## 当前里程碑（2026-08-19 第四十三轮起）：V0.3 需求全文差距复审收尾

> 2026-08-19 逐章对照 `docs/source/虚拟对象_AI陪伴项目_V0.3_产品需求与技术方案.md`
> 复审后的剩余缺口，按 Alpha 内未竟 → Beta 前置 → 真实 provider/Beta 启动时分层。
> 2026-08-16 治理退役决策继续适用：不恢复 H0～H3 Harness/任务卡/Evidence 机制。
> 每条验收口径同前：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

### 在途收尾

- [x] B0-05 演练修复提交：本地演练发现 6 处实弹缺陷（含 pgjdbc
      「RETURNS void 函数用 update() 调用抛 a result was returned」），
      V67 + Java 修复 + 测试守卫已提交，演练记录归档
      `docs/beta-readiness/records/`（0915a643，2026-08-19）。

### R43 安全审核覆盖扩充（Beta 前置）——已完成（2026-08-19）

- [x] SAFETY-RULES-2 确定性规则扩充 §20.10/§20.11 最低覆盖：输出侧补
      排他依赖话术、阻碍退出、高风险专业断言（医疗/法律/金融）、隐私套取；
      输入侧补隐私套取、诈骗与重大财产风险、未成年人自称（高精度短语集，
      命中即硬规则，宁缺毋滥）。保持 fail-closed 与安全事件落库不变；
      真实 moderation 供应商接入时点见「待决」（§20.10 十二类、§20.11
      最终复核九项目前确定性版仅覆盖自伤危机与冒充真人两类）。
      交付：8 条新规则（未成年自称 R3 / 诈骗与验证码 R2 / 人肉查询 R2 /
      依赖排他 R2 / 阻碍退出 R2 / 医疗否定 R3 / 梭哈投资 R2 / 索取凭据 R3，
      含否定守卫正则），分类器测试 9→25，safety 42/42 + runtime 573/573 +
      check.sh 全绿；召回型类别（色情/暴力/仇恨/Prompt Injection）按设计
      留给真实 provider 分类器（R49）。

### R44 记忆生命周期收尾（A2-005 / §11.12，Alpha 声明范围内未竟）

- [ ] MEM-SUPERSEDE 显式替代：确认同类新候选时可选替代旧事实，
      SUPERSEDED 状态首次产生运行时路径（召回已只取 ACCEPTED，无需改召回）；
      不自动覆盖用户手工修改（§7.3.3「只实现显式替代、过期和删除墓碑」
      ——墓碑已交付，替代/过期未落地）。
- [ ] MEM-EVENT 事件记忆最小生命周期：事件字段（时间/状态/跟进）+ 到期
      惰性 EXPIRED；跟进只提问「之前提到的X后来怎么样了」，不编造结果
      （§11.12）。

### R45 Alpha 门槛测量与记忆评测（§26.3–26.7，Owner 2026-08-19 决定全部补做）

- [ ] MEASURE 规模化测量脚本（可重复执行、出可归档报告）：协议仿真
      ≥10,000 次（无「未持久化即 completed」）、越权规模化 ≥10,000 次
      （泄漏 0）、红队输出 ≥1,000 条（Critical 泄漏 0）、取消后迟到
      Token ≥500 次（覆盖 0）、故障注入 ≥1,000 次（消息持久化 100%）、
      全故障演练 50 次（无重复完成）、重试/断线 ≥1,000 次（无重复扣减）。
- [ ] MEM-EVAL 记忆评测集与指标（§26.4）：Agent 产出样本集与统计工具，
      人工标注由 Owner 投入——Memory Precision ≥90%（≥200 标注候选）、
      Recall Precision ≥95%（≥200 场景）、删除复活率 0（≥100 回归样本）、
      敏感自动保存率 0（≥200 敏感样本）、跨关系错误召回 0（≥1,000）。

### R46 可观测性与告警最小集（§22.10–22.12、§26.6，B0/B1 前置）

- [ ] METRICS-ALERT Micrometer 指标与暴露端点（generation 成功率/时延、
      provider attempt、token 用量、安全事件、DAU）；R3/R4 SLA 计时与
      超时在 admin 安全队列可见；DAU 上限告警与数据删除失败自动告警
      （§26.6）；P0/P1/P2 告警分级草案。告警通道（邮件/webhook）随部署
      环境定，见「待决」。现状仅 health 端点 + request-id 日志。

### R47 生产部署与备份基线（§14.6、§22.13、§21.7，B1 前置）

- [ ] DEPLOY 生产部署拓扑：Compose（runtime + PostgreSQL + TLS 反代）
      + production profile 部署演练；目标环境/域名/备案路径见「待决」。
- [ ] BACKUP 备份与恢复：全量备份 + WAL/PITR 策略、恢复演练脚本；恢复后
      验证 RLS、删除墓碑与记忆状态，而不只验证数据库能启动（§22.13）。
- [ ] H5-HARDEN H5 上线加固：robots/搜索收录策略、页面缓存控制、分享卡
      不含聊天内容、公共电脑退出与清理提示（§21.7）。

### R48 数据保留与静态加密（§16.5 / §16.7，Beta 前置，Owner 2026-08-19 决定都做）

- [ ] RETENTION data_retention_policy 版本化（目录或表）+ 分类清理任务：
      普通聊天、已删除聊天、记忆候选、被拒绝候选、模型调用明细、内容
      安全日志、导出残留、流式片段；现状仅身份审计日志有 180 天清理（V22）。
- [ ] CRYPTO-REST 聊天正文与高敏记忆应用层加密：密钥部署注入、密钥与
      数据分离、存量数据迁移，与导出/摘要/向量/RLS 测试兼容；复用 V65
      紧急联系人 AES-256-GCM 模式。

### R49 真实 provider 接线硬化（Beta 启动时）

- [ ] MODERATION-PROVIDER SafetyClassifierPort 真实 moderation 实现，
      确定性规则降为兜底（成本边界已允许 MODEL_MODERATION）。
- [ ] EMBED-PROVIDER EmbeddingPort 真实 embedding 供应商实现（现为确定性
      64 维哈希；§11.17 换型不改表）。
- [ ] ROUTE-HARDEN 熔断/限流（连续失败摘除部署 + 半开恢复，补充现有
      有界重试）+ 会话模型粘滞（同部署偏好，健康变化才在轮次边界切换；
      §12.12、§12.8）。
- [ ] BUDGET-HALT 硬预算停机：provider 累计成本达部署配置上限时
      fail-closed 停止外发并告警（§22.18、§12.33 触发条件之一）。
- [ ] MODEL-ROLL 模型版本升级/灰度流程：登记→评测→小流量→回滚的流程
      文档与配置位（§12.14、§7.4「模型灰度和实际成本测量」）。

### B1 测量与对账工具（Beta 运行期）

- [ ] B1-SURVEY 被理解感评分与产品指标采集（随机会话后 1–5 分，n≥200；
      §26.5 五项产品门槛的数据来源，现无任何采集入口）。
- [ ] B1-COST 实际单位成本与供应商账单对账报告（§25.9、§22.19；
      现有 admin_usage_summary 是模拟口径）。

### D0 产品发现（Beta 前置门禁，§7.2 / §24.1，Owner 2026-08-19 决定正式补做）

- [ ] D0-PLAN 招募条件、筛选问卷与访谈提纲（Agent 代拟，Owner 执行）。
- [ ] D0-RUN 15–20 次问题访谈 + ≥10 次原型体验（现有 H5 + 测试账号作
      原型载体）；7 天内二次回访邀请不带情绪施压。
- [ ] D0-DECIDE Go/Pivot/Stop 决策写入 `docs/decisions/`（ADR）；不达线
      优先调整人群或价值主张，不默认进 Beta。不阻塞 R43+ 代码轮。

### Owner 人工项（不阻塞代码轮；清单见 docs/beta-readiness 各文档 [待填]）

- [ ] B0 材料人工项：安全责任人/替补与值班表、法务审定、评审结论、
      演练执行与归档。
- [ ] 紧急联系人能力开关评审（`emergency-contact.enabled` 默认 false）；
      若 Beta 启用，需真实验证发送渠道（现 SIMULATED_EMAIL_LINK 无真实发送）。
- [ ] A4 内部验收：5 名内部测试者连续使用 7 天（§25.7）。

## 已完成（2026-08-19 第三十一～四十一轮）：需求文档差距收尾（R31-R41）

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> Owner 决定（2026-08-19）：代码先行，B0 材料在代码轮完成后由 Agent 代起草
> （人工事项留 Owner）；SAFETY 分类器与 COORD/QUOTA 提前纳入；成年核验继续
> 模拟（真实供应商留到 Beta 启动时选型）；紧急联系人保留在计划内；低敏记忆
> 自动保存用确定性规则起步。

### R31 合规收尾

- [x] REPORT-BE 举报/申诉最小闭环：V56 表 + trusted-owner SD + OpenAPI
      POST/GET `/reports` + 举报页接提交表单 + 消息举报可提交 + 「我的数据」
      展示举报申诉状态（FR-DATA-001、§20.15）。
- [x] AGE-APPEAL 年龄申诉提交接口：落申诉记录、按 age-states 目录进入申诉态，
      处置仍人工；成年核验页接入（FR-AUTH-002、§21.3.6）。
- [x] COPY-LABEL 复制 AI 生成标识提示：助手消息复制反馈携带「内容由 AI 生成，
      请核实后使用」（§21.4.1/21.4.2，提示方案）。

### R32 数据权利补全

- [x] CHAT-WIPE 全部聊天删除：预览将清除的会话/消息数量 + 两步确认 + 取消
      in-flight work item，保留账号与角色（FR-DATA-003 六粒度的最后一项）。
- [x] MEM-SUPPRESS 删除防重学：删除记忆时对来源消息建立「禁止再次提取」最小
      规则（§11.16；只存阻止重学所需最小信息）。

### R33 安全分类器接线 I：确定性输入/输出审核

- [x] SAFETY-WIRE：SafetyClassifierPort + 确定性规则实现；激活输入检查、最终
      输出复核与增量复核——只有通过增量审核的片段才产生 `chat.delta`；安全
      事件落库（risk-levels / safety-classifier-outcomes 目录）（FR-CHAT-001、
      §20.10/§20.11）。

### R34 安全分类器接线 II：高风险处置与退出语义

- [x] SAFETY-QUEUE：R3/R4 高风险人工队列 + admin 只读队列页 + 危机资源现实
      求助提示；处置动作仍人工（§20.5、FR-RES-004）。
- [x] NL-EXIT：自然语言退出/求助意图确定性识别——立即停止新一轮生成、取消
      在途流式、最多一条简短确认、可审计退出事件（§21.3.4）。

### R35 Beta 运行边界与邀请

- [x] INVITE 邀请码开通：ADMIN 生成邀请码、凭码开通测试账号（§7.4；
      Alpha 默认关闭）。
- [x] SVC-WINDOW 服务时段/单日活跃上限/停服开关运行时强制与透明提示（消费
      betaGate 既有声明；配置默认关闭不影响本地开发）（§24.7、FR-RES-002/004）。

### R36 权益与配额深化

- [x] ENT-TRIAL 模拟 FREE/TRIAL 权益 + 试用开始/结束/剩余额度/防滥用 + 失败
      冲正统计与「应得 vs 实际」Service Class 记录（FR-ENT-005/006）。
- [x] QUOTA-PERSIST 持久化模型注册表与配额账本对账（§12.4、§12.26；补齐
      真实 provider 外发门禁「持久化 quota/registry」未满足项）。

### R37 记忆深化

- [x] EMBED-RECALL：`memory_embedding` 表 + EmbeddingPort（Alpha 确定性实现）
      + 语义召回与结构化召回合并去重（§11.13/§11.15/§11.17）。
- [x] DEGRADED-AI 降级档位运行时可达 + 应得/实际 Service Class 落路由决策
      （§12.10、FR-RES-005 三态展示）。

### R38 会话摘要

- [x] CONV-SUMMARY L2 会话摘要：覆盖起止 ID/摘要模型与 Prompt 版本/置信度/
      上一版本；低质模型不覆盖高质摘要；补 FR-CHAT-004 会话摘要引用检查（§11.18）。

### R39 Beta 管理端只读页

- [x] ADMIN-BETA：安全事件中心（R34 已交付）、举报队列、年龄申诉队列、
      导出任务队列、记忆异常抽样只读页（§8.2 管理端；复用 R31-R34 数据，
      处置动作仍人工）。

### R40 紧急联系人

- [x] EMERGENCY-CONTACT：验证/变更/撤回/加密存储与最小流程；不自动联系未
      验证联系人（§20.14；紧急联系人同意类型已存在）。

### R41 低敏记忆自动保存（确定性规则版）

- [x] MEM-AUTO-SAVE：固定低敏类别白名单 + 确定性规则自动保存、可随时撤销、
      界面明示哪些条目是自动保存（§7.4；模型置信度判定留待真实 provider 后）。

### 代码轮完成后：B0 材料起草（Agent 代起草，人工项留 Owner）

- [x] R3/R4 人工处置 Runbook、紧急联系人验证流程、真实用户协议/隐私/测试告知
      文本、PIA 草案、高风险演练与供应商故障演练脚本（§24.6 门禁八项）。
      产出：`docs/beta-readiness/01..05 + README`。人工项（责任人/法务审定/
      评审结论/演练执行与归档）留 Owner，见各文档内清单。

## 已完成（2026-08-19 第四十二轮）：Owner Q&A 决策落地

- [x] R42 服务时段对齐 §24.7（10:00–22:00，跨夜窗口支持，目录同步）+
      紧急联系人能力开关（`emergency-contact.enabled` 默认 false，未完成
      评审宁可不启用；详见 README「第四十二轮」）。

## 已完成（2026-08-19 第三十轮）：会话清理、首登下一步与页面跳转

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] LOGOUT-MORE：登出再清同意/导出/提醒/年龄/无痕/我的数据内存缓存。
- [x] MEM-IMPORT-CHAT：聊天页在当前角色有归档时弹出导入，必须用户点「导入」或「不要导入」。
- [x] NEXT-STEP：登录后与边界台按 §8.1 给出下一步（成年核验 → 协议 → 创建角色 → 聊天）。
- [x] REQ-ID-UI：transport 记住 `X-Request-Id`，登录失败/聊天初始化失败/数据加载失败展示请求号。
- [x] DATA-JUMP：我的数据各域跳到已有页面，不编造新接口。
- [x] CONV-FILTER / MEM-FILTER：会话与记忆本地按标题/内容筛选。
- [x] MEM-TIME / CHAT-TITLE：记忆展示创建时间；聊天顶栏展示当前会话标题。

## 已完成（2026-08-19 第二十九轮）：旧关系记忆导入

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] MEM-IMPORT 旧关系记忆导入（FR-COMP-004）：重置/删除默认硬清；勾选
      `retainImportable` 才归档已确认 RELATIONSHIP 记忆；导入必须另一次明确
      点击；「不要导入」丢弃归档；同模板新建不会自动继承。

## 已完成（2026-08-18 第二十八轮）：会话列表加载更多

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] CONV-MORE 会话列表 keyset 分页：首屏 `limit=20`，满页才出「加载更多」，
      用最后一条 conversationId 作 after，追加不覆盖；短页不再加载。

## 已完成（2026-08-18 第二十七轮）：登出清理内存缓存

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] LOGOUT-CLEAR：logout / 会话清除时丢掉聊天、记忆、关系、使用时长的
      内存缓存，避免下一账号看到上一账号的正文（§18.7）。

## 已完成（2026-08-18 第二十六轮）：聊天顶栏角色呈现

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] CHAT-PRES 聊天顶栏使用已保存的角色昵称和审核头像占位；无昵称时回退
      人设目录名；不上传照片、不编造新素材。

## 已完成（2026-08-18 第二十五轮）：举报和申诉说明页

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] REPORT-PAGE 独立举报和申诉页：只标明受理接口尚未接通，没有表单、
      不编造工单；边界台与帮助页可进入。

## 已完成（2026-08-18 第二十四轮）：账号与注销页

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] ACCT-PAGE 独立账号与注销页：展示账号编号与角色；登出走既有 POST
      `/auth/logout`；注销复用 DELETE `/auth/account` 两步确认与保留期说明；
      未登录不展示危险操作。

## 已完成（2026-08-18 第二十三轮）：记忆已删除分组

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] MEM-DELETED 已删除记忆分组：OpenAPI Memory 增补 `deletedAt`；
      GET `/relationships/{id}/memories?includeDeleted=true` 回显删除时间；
      记忆中心单独成组并标明不作为已保存事实；软删行不进入 canonical。

## 已完成（2026-08-18 第二十二轮）：消息举报入口（未接通工单）

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] MSG-REPORT 聊天消息「举报」：只标明受理接口尚未接通、没有可提交表单；
      不发请求、不编造工单；流式占位行不展示。

## 已完成（2026-08-18 第二十一轮）：记忆中心按范围/状态分组

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] MEM-GROUPS 记忆中心分组：已保存按 RELATIONSHIP / SESSION 分列；
      REJECTED / EXPIRED 单独成组且标明不作为已保存事实；不编造品类标签，
      不改合同（已删除仍需 includeDeleted + deletedAt，本轮不做）。

## 已完成（2026-08-18 第二十轮）：聊天页 AI 非真人标识

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] CHAT-AI-LABEL 聊天顶栏持续展示「AI 陪伴 · 非真人」，有当前关系时同时
      展示角色名称；不编造头像资源，在线/降级仍只看已有服务状态行。

## 已完成（2026-08-18 第十九轮）：独立会话列表页

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] CONV-LIST 独立会话列表：复用既有 GET/PATCH/DELETE `/conversations` 与
      POST `/conversations/{id}/end`（不改合同）；关系筛选、打开指定会话、
      改名、两步删除、两步结束今天的对话；404 存在性隐藏；聊天页按
      `conversationId` 打开，不再总是落到最新一条。

## 已完成（2026-08-18 第十八轮）：记忆详情页与管理端只读运行页

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] MEM-DETAIL 独立记忆详情与来源页：复用既有 GET `/memories/{id}` 与
      GET `/memories/{id}/evidence`（不改合同）；列表「详情」跳独立页，不再
      行内展开来源；404/403 存在性隐藏；空来源不渲染证据容器。
- [x] ADMIN-OPS-RO 管理端只读运行与合规页：ADMIN-only，复用 GET `/service-mode`
      与 GET `/version`；静态写明 Alpha 不对真实用户开放、不公开注册、不真实
      支付；公告只复述服务状态摘要，不角色化事故、不编造 provider 健康。

## 已完成（2026-08-18 第十七轮）：无痕模式设置页

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] INC-PREF 无痕模式设置页：OpenAPI GET/PUT `/incognito-pref` + V54
      默认无痕偏好（缺省 false，trusted-owner，仅 vc_api）+ 独立说明页
      （无痕 ≠ 无必要安全记录，已有会话标志不可事后翻转）+ 聊天页用该默认
      预置「下次新会话」开关 + SQL/单元/组件测试（FR-CHAT-005）。

## 已完成（2026-08-18 第十六轮）：安全 Markdown 与流式节流

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] MD-SAFE / STREAM-THROTTLE（§18.6）：助手回复只解析白名单
      （段落 / **强调** / *斜体* / `行内代码` / 围栏代码 / 无序列表）；原始 HTML
      当文本、不走 v-html、javascript: 不当链接；段落与代码超长截断；流式
      draft 50ms 节流。用户消息仍按字面展示。

## 已完成（2026-08-18 第十五轮）：聊天历史精确虚拟滚动

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] VIRT-SCROLL 精确虚拟滚动：固定高度历史容器 + `computeVirtualWindow`
      （估计行高 / 可选实测高度 / overscan）只挂载可视切片；去掉 200 条截断
      提示；滚动换窗；短列表仍全量渲染；domain + 聊天页测试（§18.6）。

## 已完成（2026-08-18 第十四轮）：生成版本选择器

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] GEN-VER 生成版本：OpenAPI `sourceUserMessageId` + GET
      `/messages/{id}/generation-versions` + POST `/generations/{id}/select`
      + V53 source/selected + receive 复用原用户消息 + list_messages 默认只露
      选中助手版本 + 重新生成不重复入队 MEMORY_EXTRACT + 聊天页「重新生成」与
      版本 chips + SQL/单元/组件测试（FR-CHAT-003）。

## 已完成（2026-08-18 第十三轮）：使用时长 / 健康设置

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] USAGE-HEALTH 连续使用提醒：OpenAPI GET/PUT `/usage-health`、POST
      `/usage-health/heartbeat`、POST `/usage-health/reminder` + V52 prefs/
      session/event + trusted-owner SD（默认 120/30，批准间隔 60/90/120/180 与
      15/30/45，仅 CONTINUED 推迟下次提醒）+ 使用时长页 + 聊天页系统层横幅
      （继续 / 结束今天的对话，无挽留文案）+ SQL/单元/组件测试（§20.7 / 21.3.3）。

## 已完成（2026-08-18 第十二轮）：模型与 AI 标识说明

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] AI-NOTICE 模型与 AI 标识页：只读说明助手回复是 AI 生成、服务模式是运维事实；
      不提供模型选择或供应商切换；边界台导航 + 页面测试。

## 已完成（2026-08-18 第十一轮）：CASUAL 对话模式

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。

- [x] CHAT-CASUAL：OpenAPI InteractionModeCode 增补 CASUAL + V51
      generation_mode_check / receive_generation 批准码 + 组装器固定轮次指令
      + 聊天页「轻松日常」chip + SQL/单元/组件测试（FR-CHAT-002）。

## 已完成（2026-08-18 第十轮）：结束今天的对话、帮助页、无痕清正文

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。

- [x] END-TODAY 结束今天的对话：OpenAPI POST `/conversations/{id}/end` + V50
      `end_conversation`（取消 in-flight GENERATION/MEMORY_EXTRACT，保留会话行
      与 Companion）+ 聊天页「结束今天的对话」二次确认，平实文案，不替代
      deactivate / 删会话。
- [x] HELP 帮助与安全支持页：只读说明使用边界、何时寻求现实帮助、本服务不是
      真人/急诊；无举报/申诉表单；边界台导航。
- [x] INC-CLEAR 无痕结束后清正文：V50 仅对 incognito 会话把 `message.content`
      置空，list 预览与 history 不再露出原文；generation / 同意 / 审计行保留；
      非无痕正文不动。

## 已完成（2026-08-18 第九轮）：数据查看页

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。
> 举报申诉没有独立接口，本页只标明尚未接通，不编造工单。

- [x] DATA-VIEW 独立数据查看页：复用既有 relationships/conversations/memories/
      reminders/consents/service-mode 列表读取，展示账号编号与角色、关系、会话、
      记忆、提醒、同意与模型说明；边界台入口；API/store/页面测试（FR-DATA-001）。

## 已完成（2026-08-18 第八轮）：成年核验 H5 闭环

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。
> 真实成年核验供应商、申诉提交接口不做；本轮只把已有 GET/POST /age/* 接到 H5。

- [x] AGE-UI 成年核验页：复用既有 `GET /api/v1/age/state` 与
      `POST /api/v1/age/verification`（不改合同、不改 SD）；H5 展示 catalog
      状态平实文案、可核验态走模拟核验、未成年/申诉中/暂停 fail-closed 不发写；
      无「我已成年」勾选；申诉入口标明尚未接通；边界台导航 + API/store/页面测试
      （FR-AUTH-002 UI 闭环，Alpha 仍不开放真实用户）。

## 已完成（2026-08-18 第七轮）：角色删除/重置闭环

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。
> 旧关系记忆导入（FR-COMP-004「必须用户主动选择」）本轮不做，默认硬清。

- [x] COMP-CLEAR 角色删除/重置：OpenAPI GET `/relationships/{id}/clearance-preview`、
      POST `/relationships/{id}/reset`、DELETE `/relationships/{id}`（contract-first
      重新生成 dist）+ V49 trusted-owner SD（预览计数、重置保行+偏好、删除级联、
      先取消 PENDING/CLAIMED 的 GENERATION/MEMORY_EXTRACT work item、存在性隐藏）
      + 角色设置页危险区（预览范围 + 二次确认 + 平实文案）+ SQL/单元/组件测试
      （FR-COMP-004）。`deactivate` 仍只退出 active 槽，不被本切片替代。

## 已完成（2026-08-16 第六轮）：对话模式、单条消息删除与反馈

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。

- [x] CHAT-MODE 对话模式：OpenAPI SendGenerationRequest.mode
      （AUTO/LISTEN/DISCUSS，contract-first 重新生成 dist）+ V34 迁移
      （vc.generation.mode 冻结 + receive_generation p_mode + CHECK 约束 + 仅
      vc_api 可执行）+ 组装器外部分支把显式模式翻译为固定轮次指令附加到人设
      SYSTEM 块（AUTO 保持 gentle-listener 默认）+ 前端输入区「自动/只听我说/
      一起聊聊」快捷 chips + SQL/单元/组件测试（FR-CHAT-002）。
- [x] FEEDBACK 生成反馈：catalog 新增 message-feedback-kinds（TOO_MECHANICAL/
      FORGOT_CONTEXT/CROSSED_BOUNDARY/FACTUAL_ERROR/UNSAFE）+ V35 迁移
      （vc.generation_feedback 表 + record_generation_feedback SD：trusted-owner
      断言、未批准 kind 拒绝、(generation, kind) 幂等首个 note 生效、不存在不披露）
      + OpenAPI POST /generations/{id}/feedback + 聊天页一键反馈 chips（FR-CHAT-003，
      A4 负反馈可关联口径）。
- [x] ADMIN-OPS 最小内部管理台读取：V36 identity_auth_event_list（审计日志
      keyset）+ admin_usage_summary（按日 generation/token/成本），ADMIN-only
      且在 SQL 重验；OpenAPI GET /auth/admin/audit、GET /auth/admin/usage；
      admin 页新增用量成本表 + 审计日志列表（FR-ADMIN 阶段边界，B0-005 slice）。
- [x] MSG-DELETE 单条消息删除：V37 delete_message SD（trusted-owner 断言、同事务
      清理 message:<id> 证据行、已确认记忆保留、助手消息删除时 generation 链接
      SET NULL、不存在不披露）+ OpenAPI DELETE /conversations/{id}/messages/{mid}
      + 聊天页逐条消息两步确认删除（FR-CHAT-004 / FR-DATA-003）。
- [x] SVC-MODE 服务状态透明：GET /api/v1/service-mode（FULL_AI/ZERO_LLM +
      平实文案，provider 主开关决定，DEGRADED/SAFETY/MAINTENANCE 不可达不虚报）
      + 聊天页顶部明文状态行（FR-RES-005）。
- [x] INC-MODE 无痕会话：V38 conversation.incognito（创建时冻结 +
      create_conversation p_incognito + list_conversations 回传）+ 无痕会话
      finalize 跳过 MEMORY_EXTRACT 入队（不产生记忆候选）+ 前端新会话无痕开关、
      列表/当前会话标记与明文说明（FR-CHAT-005）。
- [x] REMINDER 结构化提醒模块：V39 vc.reminder（FORCE RLS owner_isolation +
      关系级联 + CHECK 约束）+ create/list/get/update/delete 五个 SD 函数 +
      OpenAPI 四个提醒端点 + 前端「提醒管理」页（关系选择/创建表单/列表/
      完成/删除）+ 边界台与聊天页导航（FR-NOTIFY-001）。
- [x] ENT-SNAP 模拟权益快照：V40 service_class_assignment（ADMIN 分配
      ECONOMY/PREMIUM）+ entitlement_snapshot（每轮不可变，UNIQUE
      owner+generation 重试同一快照）+ 组装器 prepare 段铸造并以快照类路由
      （替代硬编码 SIMULATED）+ admin 页权益分配区（A3-001/FR-ENT-004）。
- [x] CONSENT 版本化同意记录：V41 vc.consent_record（追加式版本化表 + FORCE
      RLS owner_isolation + type CHECK + version 1..64）+ record_consent/
      list_consents trusted-owner SD 函数（owner 上下文强断言、仅 vc_api
      可执行、list 返回每类最新生效行）+ OpenAPI PUT/GET /api/v1/consents
      （未批准类型 400 拒绝）+ 前端「同意管理」页（8 类同意目录、生效状态、
      同意/撤回按钮，版本 2026-08 Alpha 演示，MODEL_TRAINING 注明撤回不影响
      基本聊天）+ SQL/单元/组件测试（FR-AUTH-003/005）。
- [x] DATA-EXPORT 数据导出：V42 vc.export_request（FORCE RLS + status CHECK +
      payload 内联存储）+ create/count/complete/fail/get/consume/expire
      七个 SD 函数 + 入队复用 work_item 队列（DATA_EXPORT 类型）+ OpenAPI
      POST /api/v1/exports、GET /exports/{id}、GET /exports/{id}/download
      （状态响应 READY 时携带短效一次性 downloadUrl）+ 运行时
      DataExportWorkItemHandler 聚合会话/消息（aiGenerated 标识）/记忆/提醒/
      同意为 JSON + 过期定时清扫（payload 清除）+ 前端「数据导出」页（发起/
      刷新/下载 + 内容预览）+ SQL/单元/组件测试（FR-DATA-002）。
- [x] ACCT-DELETE 账号注销：V43 identity_account_delete（自助注销 SD：
      仅本人 ACTIVE 账号、先 ACCOUNT_DELETE 审计后删 vc_user 根行级联清
      身份/refresh/全部业务数据 + consent_record 补 owner FK 级联 +
      审计事件表保留）+ OpenAPI DELETE /api/v1/auth/account（清会话
      cookie）+ 注销墓碑（登录查无此人、refresh 级联失效，恢复不可能）+
      边界台两步确认「注销账号」危险区（说明保留期与合规日志）+
      SQL/单元/组件测试（FR-AUTH-004）。
- [x] REQUEST-ID 请求关联日志：RequestIdFilter（X-Request-Id 透传/生成、
      非法头替换、MDC requestId + 日志 pattern [req=...]、响应头回显、
      CORS 暴露）+ 单元测试（FR-CHAT-001 的 request_id）。
- [x] MSG-COPY 消息复制：聊天页已持久化消息「复制」按钮（异步剪贴板 +
      legacy 回退、短暂「已复制」反馈、streaming 占位行不渲染）+ 组件测试。
- [x] MEM-NEG 不记住负向标记：V44 vc.message.no_memory（§16.2.5 规格）+
      set_message_no_memory SD（存在隐藏、可逆）+ list_messages 追加式
      重定义透出 out_no_memory（DROP+CREATE，权限重新收紧）+ 提取 worker
      跳过 no_memory 用户消息 + OpenAPI PATCH /messages/{messageId}
      （body {noMemory}）+ 聊天页「不记住/恢复记忆」按钮（仅用户消息）+
      SQL/单元/组件测试。
- [x] AGE-MIN 成年识别端口：V45 vc.age_verification（追加式结果历史，
      仅存结果/年龄段/时间/供应商凭证，不存身份证）+ record/get
      trusted-owner SD（9 状态 CHECK）+ AgeVerificationPort 独立接口 +
      SimulatedAgeVerifier（catalog 转移图路径落历史，已认证幂等、
      未成年/申诉/暂停 fail-closed）+ AgeStateTransitions 镜像转移表
      （测试钉死）+ OpenAPI GET /age/state、POST /age/verification +
      SQL/单元测试（FR-AUTH-002，Beta 门禁依赖，Alpha 不开放真实用户）。
- [x] VIRT-LIST 聊天列表渲染窗口：§18.6 列表性能——DOM 渲染上限 200 条
      最近消息 + 明文截断提示条（「已隐藏更早的 N 条消息」），配合既有
      keyset 分段加载限制长会话 DOM 规模；流式/自动滚动行为不变；精确
      虚拟滚动（固定高度滚动容器改造）留待 Beta 前端专项 + 组件测试。
- [x] AUTH-RECHECK 撤回失效快照：V46 withdraw_authorization_snapshots
      （trusted-owner SD，ACTIVE→WITHDRAWN 返回行数、幂等）+ 同意撤回
      时同事务失效全部 ACTIVE 快照（ConsentService.record granted=false
      接线）+ ExecutionAuthorizationGuard 执行前对 WITHDRAWN fail-closed
      （FR-AUTH-005：撤回后未执行任务不得用旧授权对外发送；新任务以当前
      授权重新铸造）+ SQL/单元测试。
- [x] COMP-CFG 角色结构化配置：catalog companion-prefs + V47 relationship
      偏好列与 update/get/list SD + OpenAPI PATCH /relationships/{id} +
      组装器批准片段（名称消毒，禁止自由 Prompt）+ 前端「角色设置」页 +
      SQL/单元/组件测试（FR-COMP-003）。
- [x] COMP-PRES 性别与形象呈现：catalog companion-presentation（CompanionGender
      FEMALE/MALE/NEUTRAL + CompanionAvatar 平台审核素材引用）+ V48 relationship
      性别/头像列与 update/get/list SD + OpenAPI PATCH /relationships/{id}
      增补 gender/avatarRef + 组装器性别批准片段（明示仅呈现，不改变行为/安全/
      记忆规则）+ 前端「角色设置」页性别选择与平台素材头像选择（CSS 占位视觉，
      无照片上传；所有角色固定成年人设定）+ SQL/单元/组件测试（FR-COMP-002）。

## 已完成（2026-08-16 第五轮）：生成对账、上下文预算、采样配置与会话一致性

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。

- [x] GEN-RECONC 生成重试/崩溃对账：V33 幂等化 promote_generation（RETRY-A 重试
      重跑 prepare-tx 不再因 IN_PROGRESS→IN_PROGRESS 抛异常而把 generation 永久
      卡死）；prepare 重跑时闭合遗留 CREATED attempt intent（abandon_late 死代码
      接线）且 chat.accepted 不重复落库；新增卡死对账清扫（work_item 已终态但
      generation 仍 IN_PROGRESS 的孤儿由调度任务终态化 FAILED_FINAL + chat.failed，
      前端补友好文案）。
- [x] CTX-BUDGET 上下文 token 预算：把 contextplan 的 ContextBudget 接进
      LiveInvocationAssembler——确定性 token 估算，按输入预算从最新消息回溯裁剪
      历史与召回记忆（保留既有 64 条/64KiB/单条 500 字钳制），为真实 provider
      的上下文窗口与计费打底。
- [x] SAMPLE-CFG 采样参数部署配置：ModelProviderProperties 增加 temperature/
      maxTokens 部署级默认，OpenAI/Anthropic codec 透传（替代 OpenAI 硬编码
      max_tokens），回复风格成为可运营杠杆；请求级透传留给真实 provider 接入。
- [x] RT-REVIVE realtime 会话恢复：authed-fetch 注入 renewAccessToken——realtime
      ticket 铸造/resume/snapshot 遇 401 先静默刷新一次并重放（对齐 REST
      transport 的 SESS-REVIVE），避免 token 过期后实时流被误报为「未找到或
      无权访问」。
- [x] VERSION-UI 版本可见性：前端 version API client + 边界台展示后端版本/
      构建信息（既有 GET /version 端点零前端消费）；顺带修正 README/AGENTS 的
      模块数声明（14 而非 15）。

## 已完成（2026-08-16 第四轮）：失败原因、会话恢复、管理与人设

> 每条验收口径同前几轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。

- [x] FAIL-REASON 失败原因展示：chat store 暴露终态事件 payload 的 fault，
      聊天页把内部诊断串映射为固定友好文案（模型未启用/超时/审查阻断/重试耗尽…），
      不原样透出内部细节。
- [x] SESS-REVIVE 会话恢复体验：页面挂载接线 tryRefresh（刷新页免登录，7 天
      refresh cookie 生效）；authed transport 401 时先静默 refresh 一次并重放
      原请求（防风暴的单次重试）；聊天页/边界台提供登出按钮（吊销 cookie）。
- [x] PERSONA-WIRE persona 目录与接线：catalog 新增 persona-templates 目录
      （gentle-listener：显示名/语气/默认模式，只用既有骨架字段不新编人设内容），
      关系创建按目录校验 personaRef；外部 provider 生成请求注入 persona SYSTEM
      上下文；前端关系选择改目录下拉、当前关系显示显示名。
- [x] ADMIN-ACCTS 账户列表与禁用：V31 迁移新增 list_accounts/disable_account
      SD 函数（trusted-owner 断言 + 存在性不披露），OpenAPI 补 GET /accounts 与
      POST /accounts/{id}/disable，admin 页补列表与禁用按钮；开通时强制
      maxEnabledAccounts=30 容量门禁（product-scope 声明但从未强制）。
- [x] CONV-MGMT 会话删除与重命名：V32 迁移新增 delete_conversation/rename_conversation
      SD 函数（级联清理已由 FK 保证 + in-flight work item 取消防悬空 ref），
      OpenAPI 补 DELETE/PATCH /conversations/{id}，前端会话面板补删除（两步确认）
      与重命名；复用闲置的 conversation.title 列（list_conversations 补 out_title）。

## 已完成（2026-08-16 第三轮）：终态语义、体验与透明度收尾

> 每条验收口径同前两轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线仍不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。

- [x] TERM-SEM 终态语义化：前端识别全部四种 durable 终态事件（completed/cancelled/
      blocked/failed）并区分展示（"已取消/内容未通过审查/生成失败/连接中断"），终态原因
      由 GenerationSnapshot.status（generation-states 目录码）承载；5xx 统一
      ErrorEnvelope（error-codes 目录新增 INTERNAL_ERROR，契约宣称 uniform 的缺口）。
- [x] STREAM-ECHO 流式回显与重试：发送中的用户消息即时回显占位（待回复），
      终态失败后提供一键重试（复用内容，新 idempotencyKey）。
- [x] USAGE-VIZ 用量读取链路：OpenAPI GenerationSnapshot 增加 usage（输入/输出 token，
      复用已落库的 vc.generation_usage），前端完成态展示本轮 token 用量。
- [x] MEM-MANUAL 手动记忆候选录入：memory 页新增候选录入区（scope + summary，复用
      POST candidates），补齐 8 个 memory 端点的最后一块 UI 闭环。
- [x] PROV-TMPL provider 部署配置模板：新增 application-provider 示例模板与凭据注入
      指引（不含任何真实凭据），README 说明"只允许部署配置注入"的具体做法。

## 已完成（2026-08-16 第二轮）：实时增量流与产品收尾

> 每条验收口径同第一轮：「代码 + 测试 + 契约/文档同步 + check.sh 全绿」。
> 安全分类器接线不在本轮：2026-08-15 Owner 决定 SAFETY 维持现状。

- [x] STREAM-LIVE 实时增量流：chat.accepted 首发事件 + 模型流式增量经进程内 broker 直推
      Fetch-SSE（复用 V8 `vc.advance_realtime_seq` 为 delta 预留 seq 块，catalog 语义「delta 占号
      不落库」），前端增量渲染，收尾 gap 走既有 snapshot 恢复（INV-RT-001 不补齐缺失 delta）。
- [x] ADMIN-UI ADMIN 账户开通页：auth API client 补 `createAccount`，新增 H5 管理页，
      index 边界台提供入口（仅 ADMIN 可见），闭环：管理员开通 → 用户登录。
- [x] MEM-PROMPT 记忆候选提示：聊天页在轮次完成后查询待确认候选（含异步提取延迟的二次
      复核），有候选时提示并跳转记忆页确认，把 MEM-LOOP 的产出接到用户眼前。

## 已完成（2026-08-16 第一轮：记忆闭环与用户回流）

- [x] CONV-HIST 会话历史导航：OpenAPI 新增 GET /api/v1/conversations（contract-first，重新生成
      dist 产物）+ V30 `vc.list_conversations` 迁移（含最后消息预览）+ H5 会话列表/切换/恢复
      + 历史消息 load-more（after 游标）。
- [x] MEM-LOOP 记忆闭环：finalize 入队 MEMORY_EXTRACT 工作项，确定性提取器把本轮用户发言
      变成待确认候选（复用既有 claim/lease/fence 基础设施）；recall 把已确认记忆注入生成上下文。
      入口与出口两端接通后，对话 → 候选 → 确认 → 长期记忆 → 下次生成携带记忆形成完整闭环。
- [x] REL-DEACT 关系解除 H5 UI：复用既有 `relationshipStore.deactivate()`，加二次确认交互。

## 已完成

- [x] 接通 Generation 完整 HTTP 纵切（controller ↔ 领域内核 ↔ provider adapters）
- [x] 接通 Realtime/Message 纵切与 SSE 流式链路
- [x] 接通 Memory 纵切（含 snapshot 接口）
- [x] 实现 OpenAPI 已定义但尚无 controller 的合同面：version、relationship、message、snapshot 等
- [x] production profile 对显式 `false` 的 Auth/datasource 开关改为启动失败强制（当前仅文档要求）
- [x] production profile 显式拒绝 `VC_AUTH_COOKIE_SECURE=false`（TLS-A 收尾）
- [x] provider 失败有界重试 + dead-letter（RETRY-A：最多 2 次 attempt、确定性退避、耗尽后 FAILED_FINAL；安全/授权失败不重试）
- [x] H5 取消接后端 cancel API + process-local 协作中断（CANCEL-A）

> 注：后三项来自 2026-08-15 owner-gates 批次的 Owner 决定（2026-08-16 逐项确认：
> COORD/SAFETY/QUOTA 维持现状，TLS/RETRY/CANCEL 落地）。

> 注：旧 backlog 中 13 张未交付规划卡（TASK-0039~0041、0043~0047、0049~0053）均为旧治理体系自身的
> 提速任务，随治理机制于 2026-08-16 退役而全部作废；历史规划见 `docs/archive/task-backlog.yaml`。

## 待决（需要你拍板后再做）

- 真实成年核验供应商选型（决定启动受控 Beta 时再定；申诉提交接口已在 R31）。
- 真实 moderation / embedding 供应商选型与启用时点（Beta 启动时；R43 先扩
  确定性规则，R49 预留接线位）。
- Beta 部署目标环境、域名与备案路径（R47 的前置输入；§21.7）。
- 告警通知通道（邮件/webhook，R46 的前置输入）。
- 真实支付、公开注册、语音/图像/WebSocket/恋爱模式/主动推送（公开付费版前）。
- 公开付费版其余前置（§7.5、§25.10）：第二真实供应商或可执行备用路径、
  公开管理后台 RBAC + Case Access/break-glass（FR-ADMIN-001/002）、真实
  套餐/订单/退款/财务对账、任务级权益完整账本（FR-ENT-003）、老年用户
  可用性与反诈骗、服务终止与供应商退出、H3 发布门禁。

> SAFETY 分类器接线与 COORD/QUOTA 深化已按 2026-08-19 Owner 决定翻案，
> 分别纳入 R33/R34 与 R36。
> 2026-08-19 差距复审四项 Owner 已拍板：① 安全分类先扩确定性规则，
> 真实 moderation 供应商 Beta 启动时接入（R43/R49）；② 验收测量全部
> 补做，含 §26.4 记忆人工标注评测集（R45）；③ 数据保留版本化与应用
> 层静态加密都在 Beta 前完成（R48）；④ 正式补 D0 产品发现后再进 Beta，
> 不阻塞代码轮（D0 节）。
