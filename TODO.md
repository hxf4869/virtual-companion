# TODO

产品待办（现状声明见 README）：

## Go companion runtime（ADR-0007，2026-08-30 起）

实施基线：`docs/planning/2026-08-30-go-companion-runtime-redesign.md`。一次一个可验证 slice。

- [x] `G0` ADR/Catalog/OpenAPI scope 与 API consumer matrix（catalog/openapi check；不写 Go 业务代码）
- [x] `G1` Java 资源/事务基线与 benchmark workload（Linux 可重复报告：`docs/planning/g1-java-resource-baseline.md`；Owner Mac 门槛未冻结）
- [x] `G2` Go module、config、health、logging、metrics、shutdown、`api-migration/full` 硬隔离（unit/check；migration 模式无法启动 provider/jobs；不含 DB 业务 API）
- [x] `G3` pgx owner-bound 短事务、RLS/least-privilege、crypto（BCrypt、owner HMAC、enc1/enc2）与 Java JWT migration verifier（DB/golden vectors；不签发 JWT、不写 login/refresh/logout）

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

### 2026-08-24 Owner-only 本地 7 天 Dogfood（当前执行序列）

> 唯一决策真源：`docs/decisions/0006-owner-only-local-dogfood-boundary.md`。
> 这是 Owner 单账号探索性自测，不代替 D0、正式 Canary 或真实用户 Beta。派发时逐项
> 对照当前代码；已满足则报告 `ALREADY_DONE`，不得为完成编号重写。
> 2026-08-24 稳定化整改（DOGFOOD-STABILIZATION-01）后：checkbox 只在「代码与自动化
> 验证完成且无 Owner 人工步骤残留」时勾选；`[ ]` 条目标注 `READY_FOR_OWNER` 等
> 终态，其 Owner 人工项以各条内说明为准。

- [x] `DOGFOOD-00` Owner 决策冻结：人员、设备、provider、数据、记忆、保留、备份和
      明确不授权范围已写入 ADR-0006。
- [ ] `DOGFOOD-01` `READY_FOR_OWNER`（代码侧 2026-08-24 完成，真机 LAN 访问与
      证书信任为 Owner 人工项）：Caddy `default_sni` 修复 IP 无 SNI 握手、compose
      透传 `VC_BETA_GENERATION_ENABLED`、CANARY 绑定命令实测（fail-closed+成功+
      回退）、私有配置全部 0600；运行手册 `ops/deploy/DOGFOOD.md`。
- [x] `DOGFOOD-02` `TECHNICAL_DONE`（2026-08-24 稳定化整改完成）：V109/V110 对象
      生命周期——上传后封存失败先落 V110 指针（FAILED-with-pointer）再补偿删除，
      双败 P1 `EXPORT_OBJECT_ORPHAN_RISK`（无指针孤儿路径归零）；一次性下载成功后
      删对象清指针；EXPIRED+FAILED 双清扫、删除失败 JobRun 如实 FAILED；账号删除
      先清全部导出对象（失败即中止+P1，幂等可重试）；EXPORT_RESIDUE 清理跳过带
      指针行；对象内容为 RestFieldCipher AES-GCM envelope（明文 JSON 不出主机）；
      presigned 端口/TTL 配置/演练声明删除，口径改为「私有 bucket + 一次性应用
      下载 URL」；真实 MinIO 演练 + tests/160 + handler/scheduler/controller/
      coordinator 单测全绿。
- [ ] `DOGFOOD-03` `READY_FOR_OWNER`（脚本与演练 2026-08-24 稳定化完成，launchd
      装载与 passphrase 保管为 Owner 项）：`run-daily-backup.sh` 修复 EP_URL bug、
      bucket 不可达稳定脱敏 exit 4；备份升级 VCBAE1 认证加密（encrypt-then-MAC，
      PBKDF2-HMAC-SHA256，密钥不进 argv，篡改/错误口令在解密前失败）；演练改真实
      key 布局 `exports/{owner}/{exportId}.json` 并逐字节校验对象内容；备份前/
      后删除两场景防复活断言（账号、消息、记忆、向量、导出对象五类）；README
      如实声明 pg_dump 与 mc mirror 非原子快照；`run-restore-drill.sh` 全链路 PASS。
- [x] `DOGFOOD-04` `TECHNICAL_DONE`（2026-08-24 稳定化整改完成）：composite
      hard rules first——本地非全净（非 R0/ALLOW/无违规）直接返回，计数测试钉死
      远程调用为 0；`ChatCompletionsSafetyClient` 复用 ProviderEgressPolicy 精确
      host 白名单 + EgressDnsGuard DNS 防重绑定 + 响应 128KiB 上限 + violations
      必须存在且非 null；远程调用受 `OwnerGatedSafetyClassifier` 门禁：ADR-0006
      五类必要同意（硬编码不依赖 yaml 默认空配置）、账号删除意图、provider
      ADMITTED 准入、条款未核验时仅放行本地敏感检查全净正文，任何拒绝或读取
      失败零 HTTP fail-closed；每轮输入/最终各最多一次、流式增量零远程（计数
      断言）。
- [ ] `DOGFOOD-05` `READY_FOR_OWNER`（代码侧 2026-08-24 稳定化完成，7 天运行与
      条款/revision 输入为 Owner 项）：R4 最终输出计为 canary 失败且最终复核
      通过前不记 supplier circuit 成功；durable rollback 失败时 P0 +
      `LocalDeploymentIsolation` 进程内隔离该精确 deployment（下一次路由零外发，
      注册表过滤测试钉死）；套餐 canonical key 全链一致
      （VC_PROVIDER_PLAN_*，VALID_UNTIL 拼写修正，无旧别名）；UNKNOWN 每日一条
      P2 且跨当日重启经持久 outbox 天窗去重（不新增状态文件）；smoke 对账：仓库
      内可复核记录为 2026-08-23 合成 smoke（in 25/out 5 tokens，脚本总时长 4.1s，
      首 token NOT_MEASURED，见
      `docs/beta-readiness/records/2026-08-23-S0-24-真实Provider合成Smoke.md`）；
      此前声称的 2026-08-24「2.2s COMPLETED、in12/out26」无仓库内可复核证据，
      改记 UNVERIFIED/NOT_MEASURED，本轮起不再调用真实 provider。
- [x] `DOGFOOD-06` `DONE`（仅影子评测，不切默认/不写现行空间）：
      `ShadowEmbeddingEvalTest`（环境变量门禁，默认跳过）Ollama qwen3-embedding:0.6b
      64 维（dimensions=64 MRL 可行）vs 确定性 64 维：Recall@3 1.000 vs 0.750、误召回
      0.125 vs 0.000@0.60、跨关系污染 0.167 vs 0.056；记录
      `docs/beta-readiness/records/2026-08-24-dogfood06-shadow-embedding.md`；
      不切默认/不写现行空间/不迁移 DB。
- [ ] `DOGFOOD-07` `READY_FOR_OWNER`（代码侧 2026-08-24 稳定化完成，真实清理由
      Owner 按序启用，不设 VC_RETENTION_DRY_RUN=false）：激活/回退 SQL
      `infra/db/dogfood/activate-normal-chat-30d.sql`（幂等，其余类别保持 DRAFT）+
      tests/159（dry-run 仅计 >30 天、真实 purge 只删过期、ACCEPTED 记忆保留）+
      稳定化：V111 `retention_category_active` 探针 + 调度器 DRAFT 类别记 SKIP、
      不发 P1、整 run 不因此 FAILED（tests/161 + 1 ACTIVE + 7 DRAFT 单测）；
      已激活类别读取/SQL 失败仍 fail-closed P1；启用顺序见 DOGFOOD.md §10。
- [x] `DOGFOOD-08` 高风险操作重新认证（2026-08-24 DONE）：账号删除/创建导出/撤回同意
      服务端同步校验当前密码（BCrypt + timing 均衡，错密码 404 同面 fail-closed，
      不复用 15 分钟 reauth 窗口）；OpenAPI 同步 + 三页密码输入 UI + 负例回归 +
      E2E 06 更新；index 页无密码注销入口改为跳转 account 页。
- [ ] `DOGFOOD-09` `READY_FOR_OWNER`（自动化侧 2026-08-24 稳定化完成，真机
      VoiceOver/TalkBack 冒烟为 Owner 人工项）：axe 无禁用规则、无对比度放行，
      四条历史禁用规则（label/landmark-one-main/region/page-has-heading-one）已
      真实修复——`src/platform/h5-a11y.ts` 全局 DOM 修补（uni-input aria-label
      落到内部原生 input、uni-button tabindex/role + Enter/Space 激活、
      uni-page-head banner）+ 每页 role=main 与一级标题语义；键盘断言含 Tab 到
      submit、Space 激活、Enter 完整登录；chromium/webkit-iphone/chromium-android
      三 project 19/19 全绿。
- [ ] `DOGFOOD-10 / A4` `READY_FOR_OWNER`：Owner 连续 7 天、每天至少一次核心旅程；
      每日体验入口/健康观察/脱敏反馈方式/双端手工清单已备好
      （`ops/deploy/DOGFOOD.md` §12+附录 A）。不设通过阈值，最终只提交脱敏问题摘要、
      严重程度和建议顺序，不形成 `GO/PIVOT/STOP` 或 Beta 放行结论。
- [ ] `OWNER-INPUT-PROVIDER-TERMS`：Owner 提供登录后条款/隐私页面截图或可核验 URL。
      在地区、保留、训练使用与删除机制确认前，只允许通过本地敏感检查的
      `MESSAGE_TEXT`，账号元数据、记忆片段与敏感内容外发保持关闭；该阻塞不得阻止
      `DOGFOOD-01/02/03/06/08/09` 以及上述降级范围内的 `DOGFOOD-10` 继续。
- [ ] `OWNER-INPUT-PROVIDER-REVISION`：确认渠道是否暴露不可变 model revision；若只提供
      `Deepseek-v4-flash` 别名，不得自造 revision，S0-24 正式 Canary 继续
      `BLOCKED_EXTERNAL`，但可在 ADR-0006 的收缩边界内如实记录 Owner dogfood 结果。

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

### R44 记忆生命周期收尾（A2-005 / §11.12，Alpha 声明范围内未竟）——已完成（2026-08-19）

- [x] MEM-SUPERSEDE 显式替代：确认同类新候选时可选替代旧事实，
      SUPERSEDED 状态首次产生运行时路径（召回已只取 ACCEPTED，无需改召回）；
      不自动覆盖用户手工修改（§7.3.3「只实现显式替代、过期和删除墓碑」
      ——墓碑已交付，替代/过期未落地）。
      交付：V68 以 superseded_at/superseded_by 墓碑列承载 SUPERSEDED（与删除
      墓碑同构，不动状态目录）；confirm 可选 supersedeMemoryId（同关系在存
      事实，否则 400）；召回（含语义）排除已替代行。
- [x] MEM-EVENT 事件记忆最小生命周期：事件字段（时间/状态/跟进）+ 到期
      惰性 EXPIRED；跟进只提问「之前提到的X后来怎么样了」，不编造结果
      （§11.12）。
      交付：V68 event_at/event_status/event_expires_at + 新目录
      memory-event-statuses；读路径惰性 EXPIRED；到期未完结事件在召回行
      附带「只能询问后续进展，不得编造结果」指令；OpenAPI/H5 表单与分组。
      验证：DB 123/123（新增 122）、runtime+上游 579/579、前端 740/740、
      check.sh 全绿。

### R45 Alpha 门槛测量与记忆评测（§26.3–26.7，Owner 2026-08-19 决定全部补做）

- [x] MEASURE 规模化测量脚本（可重复执行、出可归档报告）：协议仿真
      ≥10,000 次（无「未持久化即 completed」）、越权规模化 ≥10,000 次
      （泄漏 0）、红队输出 ≥1,000 条（Critical 泄漏 0）、取消后迟到
      Token ≥500 次（覆盖 0）、故障注入 ≥1,000 次（消息持久化 100%）、
      全故障演练 50 次（无重复完成）、重试/断线 ≥1,000 次（无重复扣减）。
- [x] MEM-EVAL 记忆评测集与指标（§26.4）——Agent 部分完成：
      人工标注由 Owner 投入——Memory Precision ≥90%（≥200 标注候选）、
      Recall Precision ≥95%（≥200 场景）、删除复活率 0（≥100 回归样本）、
      敏感自动保存率 0（≥200 敏感样本）、跨关系错误召回 0（≥1,000）。

### R46 可观测性与告警最小集（§22.10–22.12、§26.6，B0/B1 前置）——已完成（2026-08-22）

- [x] METRICS-ALERT Micrometer 指标与暴露端点（generation 成功率/时延、
      provider attempt、token 用量、安全事件、DAU）；R3/R4 SLA 计时与
      超时在 admin 安全队列可见；DAU 上限告警与数据删除失败自动告警
      （§26.6）；P0/P1/P2 告警分级草案。
      交付：主体 2026-08-21（10b8ca32：VcMetrics + /actuator/prometheus +
      Webhook 告警通道 + DAU 触顶/注销失败/retention 失败/BUDGET 四处
      自动告警 + V69 安全队列 SLA + 07 分级文档）；2026-08-22 收尾四缺口
      ——终态计数收敛 worker finally 单点（completed/failed 全路径不再
      漏计）、`vc_beta_dau` gauge（V77 job SD + 60s 轮询）、admin 队列
      前端展示 ageHours/slaBreached（超时行「SLA 超时」标记）、07 补
      抓取凭据口径与告警码登记。2026-08-24 飞书应用机器人真实群投递
      PASS；替补、升级路径与 SLA 阈值复核见 07 §6 Owner 待填。

### R47 生产部署与备份基线（§14.6、§22.13、§21.7，B1 前置）

- [x] DEPLOY 生产部署拓扑：Compose（runtime + PostgreSQL + TLS 反代）
      （本机冒烟演练全通:fail-closed 拒启+健康/H5/API 探针;远端落地待
      Owner 提供服务器信息）
      + production profile 部署演练；目标环境/域名/备案路径见「待决」。
      2026-08-24 S0-27：migrator/runtime 分离登录与 Secret、startup 权限实检及匿名
      role-separation drill 已完成；完整 Compose smoke PASS。
- [x] S0-30 账号即时失效与高成本端点保护：session epoch/durable access snapshot 已覆盖
      禁用、降权、logout、会话撤销和改密；V84 共享 generation/export/report 频率窗，
      V106 HMAC 化 login/refresh 来源窗与 generation/SSE 并发租约已接入；429 +
      Retry-After、SQL 135/150/155、Java 单测、OpenAPI/catalog 和 production fail-closed
      预检均通过；紧急联系人明确不限流。
- [x] S0-31 可靠告警与定时任务：V85 outbox 的去重/认领/崩溃回收/HMAC/allowlist/
      有界退避/dead-letter 与短故障恢复已验证；V86 maintenance lease、pause、聚合
      run history 已覆盖四类任务，retention DB/部署 dry-run 真实估算并记录 DRY_RUN；
      V107 last-success/latest-status 及失败、stale/hung 固定 P1 告警已接入。真实替补
      endpoint/接收人和完整人工升级链仍为 Owner 外部项。
- [x] S0-32 会话摘要加密：V79 dual-read/keyset 回填 + V108 encrypted-only runtime
      writer 已收口；旧 SQL plaintext writer 删除，普通/turn 写在 JDBC 前即 enc2，读取边界
      解密；incognito 无 metadata，单消息删除移除覆盖摘要，conversation/清空/注销级联。
      SQL 118/130/157 与 summary/backfill/controller/worker 定向测试通过；生产 KMS、旧 key
      保留与备份取回演练仍需 Owner。
- [x] S0-33 单副本硬门禁：Compose `replicas:1`、所有 profile 声明预检、dedicated
      PostgreSQL advisory-lock 成员排他与 watchdog/exit-87 fail-stop 已接通；所有 connection
      和 DataSource unwrap 入口均 fail-closed。单测覆盖 HELD/REFUSED/UNAVAILABLE/lost lease，
      Compose smoke 覆盖声明 2、实际 scale 2 拒绝及缩回 1 恢复；S2-37 触发/退出条件已入文档。
- [x] BACKUP 备份与恢复：全量备份 + WAL/PITR 策略、恢复演练脚本；恢复后
      验证 RLS、删除墓碑与记忆状态，而不只验证数据库能启动（§22.13）。
- [x] H5-HARDEN H5 上线加固：robots/搜索收录策略、页面缓存控制、分享卡
      不含聊天内容、公共电脑退出与清理提示（§21.7）。

### R48 数据保留与静态加密（§16.5 / §16.7，Beta 前置，Owner 2026-08-19 决定都做）

- [x] RETENTION 本地技术闭环：V70 分类策略/清理 + V104 显式 DRAFT/ACTIVE/RETIRED、
      policy-bound runtime wrapper、默认 dry-run、逐类统计/失败隔离、legal hold 与
      PITR digest tombstone reconcile；真实 policy 周期、manifest 外部存储和真实 purge
      仍需 Owner/法务批准，当前开关 false/dry-run true。
- [x] CRYPTO-REST 聊天正文与高敏记忆应用层加密：密钥部署注入、密钥与
      数据分离、存量数据迁移，与导出/摘要/向量/RLS 测试兼容；复用 V65
      紧急联系人 AES-256-GCM 模式。（交付：正文+记忆摘要全行加密,
      RestFieldCipher 网关式接入,V71 回填助手,生产 fail-closed 密钥守卫;
      见 docs/beta-readiness/09）

### R49 真实 provider 接线硬化（Beta 启动时）

- [ ] MODERATION-PROVIDER SafetyClassifierPort 真实 moderation 实现，
      确定性规则降为兜底（成本边界已允许 MODEL_MODERATION）。
- [ ] EMBED-PROVIDER EmbeddingPort 真实 embedding 供应商实现（现为确定性
      64 维哈希；§11.17 换型不改表）。
- [x] ROUTE-HARDEN 熔断/限流（连续失败摘除部署 + 半开恢复，补充现有
      有界重试）+ 会话模型粘滞（同部署偏好，健康变化才在轮次边界切换；
      §12.12、§12.8）。
      交付：SupplierCircuitBreaker 以供应商粒度接入路由决策与出站门禁——
      路由健康感知选路（粘滞的健康部署优先 → 首个健康候选 → 冷却期满的
      半开探针兜底；候选全 OPEN 时降级 ZERO_LLM/NO_ELIGIBLE）；worker 把
      allow() 门禁移到 attempt intent 落库之前（拒绝不产生 intent 行，走
      既有 RETRY-A 有界预算，死信口径不变）；外部成功按会话记录部署粘滞
      （进程内 conversation→deployment，单机 Compose 口径，重启后由首次
      成功重建）；CLOSED→OPEN 触发 P2 PROVIDER_CIRCUIT_OPEN 告警并在
      docs/beta-readiness/07 登记。验证：modelruntime 209/209、runtime 及
      上游 608/608、check.sh 全绿（无契约/DB/前端改动面）。
- [x] BUDGET-HALT 硬预算停机：provider 累计成本达部署配置上限时
      fail-closed 停止外发并告警（§22.18、§12.33 触发条件之一）。
- [x] MODEL-ROLL 模型版本升级/灰度流程：登记→评测→小流量→回滚的流程
      文档与配置位（§12.14、§7.4「模型灰度和实际成本测量」）。

### R50 紧急联系人真实发送渠道（Beta 启动时；2026-08-22 评审决定启用）

- **2026-08-24 对账：`BLOCKED_EXTERNAL`**。本地 V65 生命周期与默认关闭门禁已复验；
  平台/endpoint/签名协议/Secret、联系人侧页面、话术责任人和端到端演练均未提供，
  不以假 webhook 或手工 token 冒充真实发送。

- [ ] EMERGENCY-CHANNEL webhook 外发：真实发送替代 SIMULATED_EMAIL_LINK
      （企业微信/飞书/自建接口类 webhook，平台选型见「待决」，凭据只允许
      部署注入），验证链接可达与验证/变更/撤回语义不回退（§20.14）；
      启用前置：执行 `docs/beta-readiness/02` §4 端到端演练并留证
      （2026-08-19 高风险演练未含紧急联系人加练）；交付后随 Beta 部署
      置 `emergency-contact.enabled=true`。

### B1 测量与对账工具（Beta 运行期）

- [x] B1-SURVEY 被理解感评分与产品指标采集（随机会话后 1–5 分，n≥200；
      §26.5 五项产品门槛的数据来源，现无任何采集入口）。
- [ ] B1-COST `BLOCKED_EXTERNAL`：真实供应商账单抓取与批准容差报告待 Beta 输入；
      本地 V105 versioned unit price + 原子 reserve/settle/release、正常完成 actual USD
      usage、月度 snapshot 与并发 ceiling 已完成，不以模拟口径冒充真实账单对账。

### D0 产品发现（Beta 前置门禁，§7.2 / §24.1，Owner 2026-08-19 决定正式补做）

- [ ] D0-PLAN `DEFERRED_NO_SAMPLE`：当前没有可招募用户；招募条件、筛选问卷与访谈
      提纲保留，Owner dogfood 不计入正式样本。
- [ ] D0-RUN 15–20 次问题访谈 + ≥10 次原型体验（现有 H5 + 测试账号作
      原型载体）；7 天内二次回访邀请不带情绪施压。
- [ ] D0-DECIDE Go/Pivot/Stop 决策写入 `docs/decisions/`（ADR）；不达线
      优先调整人群或价值主张，不默认进 Beta。不阻塞 R43+ 代码轮。

### Owner 人工项（不阻塞代码轮；清单见 docs/beta-readiness 各文档 [待填]）

- [ ] B0 材料人工项（逐项活状态以 docs/beta-readiness 各文档内清单为准）。
      已有 2026-08-22 Owner 记录：紧急联系人「法律评审」「安全/专业评审」
      落实、书面结论 Beta 启用（`docs/beta-readiness/02` §4 已勾选）。
      按仓库现状仍未闭环：值班表载体为不入库的
      `docs/beta-readiness/duty-roster.local.md`（.gitignore 忽略），当前
      工作区副本四类角色均「待填」、升级路径未勾选，待 Owner 复核填写并
      对齐 `01` §1；三份协议/隐私文本法务审定定版（`03` §5 发布前清单
      未勾选）；演练执行与归档（`records/` 仅 2026-08-19 本地自动化留证，
      双人值守/升级模拟/台账等正式演练环节仍待组织）。
- [x] 紧急联系人能力开关评审（`emergency-contact.enabled` 默认 false）：
      2026-08-22 Owner 评审结论为 Beta 启用，真实发送渠道走 webhook 类
      （企业微信/飞书/自建接口类，凭据部署注入），接线任务见 R50；
      接线交付前开关维持 false，不在无真实外发的情况下启用。
- [ ] A4 内部验收 `IN_PROGRESS`：按 ADR-0006 调整为 Owner 单人连续 7 天探索性
      dogfood，不设通过阈值；执行后只回填脱敏问题和体验观察，不替代 D0 或 Beta 门禁。

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

## 2026-08-24 S0 本地技术收口验证

- [x] JDK 25 全量 `./mvnw ... verify`：15 个 reactor 模块成功，runtime 815 tests
      PASS（0 failure/error/skip）。
- [x] PostgreSQL 18 + pgvector：V1–V108 迁移、157 个 DB/RLS SQL tests、独立
      migrator/runtime role drill 全部 PASS。
- [x] `scripts/check.sh`：Catalog/OpenAPI validate+drift、付费边界、license、前端
      Vitest 与 type-check 全 PASS；Playwright 隔离真实栈 7/7 PASS。
- [x] production Compose smoke：缺密钥拒启、声明/实际双副本拒绝、单实例健康与缩容
      恢复 PASS；logical backup+RLS restore+外部删除墓碑+PITR+summary ciphertext PASS。
- [x] 验证后已清理临时容器/监听端口和 smoke Secret 文件；Provider/年龄/retention
      真实开关保持关闭，无生产部署、付费 Canary、push/PR 或真实用户放量。

## 待决（真实 Beta / 外部条件；Owner-only dogfood 不关闭这些事项）

- D0 产品发现形成 Go / Pivot / Stop；未有结论前不进入真实用户 Beta。即使 GO，
  PIA、成年验证、值班/升级链、伦理适用性和受控名单仍须逐项批准。
- 真实成年核验供应商、处理区域、PIA/DPA、费用、Secret 与申诉责任人选型；
  默认关闭的 Adapter 和人工处置本地能力已完成（S0-12），外部批准前不得启用。
- WeChat ChatAPI 已获准用于 Owner-only dogfood，但其权威条款、处理区域、保留/删除、
  训练使用和费用仍未核验；这不等于真实用户 Beta 的 moderation/generation 供应商批准。
  本地 Qwen embedding 仅做影子评测，也不等于真实 embedding 已接入。
- S0-24 正式 Canary/Beta：immutable model revision、真实费用/账单容差、值班替补和
  放量/回滚批准仍缺失；Owner 单账号 dogfood 不能把该条目标记 DONE。
- 紧急联系人真实 webhook endpoint/签名/接收人及端到端演练；Owner dogfood 已决定
  保持关闭，但不得因此删除未来 Beta 阻塞，也不得用假 URL 冒充真实送达。
- retention ACTIVE 周期、legal hold 责任人、真实 purge 批准、删除 manifest 外部
  加密存储；生产 KMS、current/previous key 保留/销毁与备份取回演练。
- Beta 部署目标环境、域名、备案路径和运维账号；本机同源、MinIO、备份和单副本
  dogfood 不代表远端发布授权。
- 告警替补接收人、独立 signed webhook endpoint、升级链与 SLA 阈值复核；主飞书
  应用机器人已真实收件，但不能代替完整值班闭环。
- 导出链接继续保持一次性；刷新、过期或下载后由 Owner 重新发起导出，不扩展为可重复 URL。
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
