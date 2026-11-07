# TODO

> 2026-11-06 重排：只保留进行中与未完成条目。此前全部记录（含已完成条目与历史快照）原样归档在
> [docs/history/TODO-2026-11-06.md](docs/history/TODO-2026-11-06.md)，查历史证据去那里。
> 进度按条目 ID 回填到下面对应主线；任务来源仍以 [handoff backlog](docs/planning/2026-10-31-handoff-backlog.md) 为准。

## 当前主线（Owner 2026-11-06：三线并行，先定聊天存储与分页接口）

### 服务端迁出 SillyTavern（SX）

- [x] SX-1（2026-11-06）：ADR-0013（Accepted，Owner 决定见 §6.1）、ST 依赖与补丁清单、接口契约草案、阶段 0 合成测量（1k 条每次保存 2.5 MiB / 234 ms，20k 条 50 MiB / 5.2 s）；提交 1f1dd9ef。
- [x] SX-2（2026-11-06）：聊天存储与分页历史接口契约经总调度审定后冻结进 OpenAPI / catalog（11 路径、15 操作、12 错误码，均 DEFER 待实现）：body `requestId` 幂等、keyset before/after 与 `anchorMessageId`、重排后 410、类型化 operations、`include=chat`。quick PASS。
- [x] SX-3（2026-11-07）：新增 V287 加密聊天/候选/顺序与 metadata、权威 epoch、幂等回执及事务 outbox，补齐无痕/清空删除；Go 离线、store/http 集成、RLS PASS；提交 bf3ba14b。
- [x] SX-4（2026-11-07）：五个聊天读接口、双向 keyset/changes/full/锚点及 Owner 批准的全聊 q；20k 无重漏，服务端分页 P95 41.74ms；Go/store/http/RLS/quick PASS；提交 787b48b4（契约 48439039）。
- [x] SX-5（2026-11-07）：原子消息/候选/metadata 操作、重排/fork、幂等、生成登记/终态及 inbox 去重；Go/store-http/RLS/Node1211/quick PASS；提交 2d42f2ee。
- [x] SX-6（2026-11-07）：共享 ChatStore、完整历史/窗口与脚本屏障、原子 insert、权威守卫及生成留稿；Go/store-http/RLS/check/组件与受管 C04/C05/nf-cards/nf-tavern PASS；提交 d72e5f8e。
- [x] SX-7（2026-11-07）：同事务来源/遗忘屏障、GO 对账与 inbox 同库投递、语音/记忆引用适配；Go/store-http/RLS/check、三项受管与离线记忆 22/22 PASS；提交 51b4f60f。
- [x] SX-7F（2026-11-07）：修复审计七项；有界搜索、真实管理桥、删除锁序、changes清理、画像栅栏与201回放；quick/Go全单测/整包库/RLS/npm1275/Vitest203/受管PASS；提交 b8ba95d0（夹具 f30115b8、契约 accd79b7）。
- [ ] SX-8–SX-16：见 Backlog M 节；本轮完成至 SX-7，未实施真实切换。

### 聊天与记忆质量（CM）

- [x] CM-0（2026-11-06）：聊天与记忆质量计划（管线审计、指标设计、真实模型评测与 ¥100 熔断、体验差距与 CM-1–10）；提交 cfa54ebb。
- [x] CM-1（2026-11-07）：数值阶段指标、配对比较及回复重复/规则/重写测量就绪；23项单测与800次浏览器采集器校准PASS，首字/末字最大偏差18.2/10.8ms，费用¥0；真实桌面性能与未启用规则不冒报通过；提交 be1f025c。
- [x] CM-2（2026-11-07）：默认不限金额计量，冻结单次完整流程参考，两倍token异常停止可取消在途与隔离栈，UNKNOWN估算及上下界单列，所有真实入口不得绕过；budget/report26、meter11、完整桌面203项PASS，首块附加p95=16.067ms，新增模型调用0/费用0；提交 ff33e9d4。
- [ ] CM-3（2026-11-07）：完整编辑/逐题恢复已修，真栈两次恢复/中断清理、Node功能1457与桌面203项PASS（计量初次20.867ms FAIL/单独17.193ms PASS）；提交dd8b27cb。新A校准11/12通过，提取后遇连续130次上游429而中止，core NOT_RUN；1326调用、已知5462837/估算6069209 tokens，156未知、0在途，资源归零；可信A/B、噪声与hold-out待上游恢复。
- [ ] CM-4（2026-11-07）：同步main7bd10436并接入ff6b0120窗口/逐事实发布清理；Go/PG/Node/桌面PASS，真实SQLite/出站AB、joint任一来源、助手edit/delete/swipe及重启撤回PASS（65本机调用/22出站/外部0）；新真实质量轮待跑，旧43/140退步不作新基线。
- [ ] CM-6–CM-10、CM-12–CM-13：见 Backlog N 节；CM-12 滚动摘要与 CM-13 去 AI 味按评测采用。
- [x] CM-11（2026-11-07）：[收编评估文档](docs/planning/2026-11-07-cm11-memorycore-go-postgres-assessment.md)完成，Owner决定是否实施；文档diff/引用检查PASS，无迁移/新增评测；提交 c5f60a13。
- [ ] CM-5（2026-11-07）：4a3321fc修复遗忘版本推进/旧意图重放，cd6da2b6补失败画像日志revision；修前均复现，Go 8/8、Node业务43/43、桌面203项PASS；完整真实出站闭环与历史版本漂移恢复未完成。

- [x] CM-1/2/3 工具拆分（2026-11-07）：cm-merge-1从main 79b4d72c按拓扑cherry-pick9个工具/修复提交，未含CM-4候选；代码73aa409e的quick、Go全单测、受影响store、Node1348、完整桌面203项PASS；进度提交eaafd647已推送，交Claude审计。

### MB2 手机端 React 重建（方案 `docs/planning/2026-11-06-mobile-react-rebuild-plan.md`）


- [x] MB2-0（2026-11-06）：规范修订与候选图已交付。审图分支 `review/mb2-0-images` 已独立推送（796c4b76、c16d7260、69e3096f），含84张候选及11张Spike同视口对比，不合入实现分支。Claude首次REVIEW已完成；按意见重出剧情回档、日记、全屏卡片、世界书列表及详情共10张浅深图，提示词追加并自查。ADR-0011/DESIGN§17既有数值保留，前端后台agy均带/boost。PASS：文档/文件完整性；重出后复审与Owner PICKS仍待完成，未代选。图与提示词见.review-queue/MB2-0/及审图分支。 2026-11-06：Claude 复审重出五页（`5302a78f`），经 Owner 授权由 Claude 代为确认 PICKS（`9bb1e40d`）；实现以选定图 + REVIEW 总则与逐页要求为准。
- [x] MB2-1（2026-11-06）：[Spike报告](docs/planning/2026-11-06-mb2-spike-report.md)已交付，固定暂停等待Owner确认。Chromium两案各5冷+5热、Android/iOS各冷/热单轮已测；构建与组件检查PASS，严格档性能FAIL（原生8轮历史均>300ms；A滚动/转场、iOS A冷首屏等未达标），Android Doze持续流FAIL（最长约25分16秒无帧）。A卡片同实例往返/MVU定向复验PASS；B卡片宿主契约与Toast遮挡FAIL；真机、系统字体全矩阵、纯引擎净堆NOT_RUN。条件推荐优先继续验证Ionic，未选定或放宽预算。原始数据、源码归档与截图见 [.review-queue/MB2-1/NOTES.md](.review-queue/MB2-1/NOTES.md)。测试设备与临时私钥/缓存已回收；通用SDK保留。报告/进度文档在本提交中交付，不含Spike产品代码。 Owner 2026-11-06 确认：采用 Ionic（A），其掉帧为 MB2-5/6 门槛；历史可见保持 300 ms，MB2-6 以预取与缓存验收；安卓锁屏休眠接受暂停 + 回前台继续，并提供可选“不受电池优化限制”；壳以 `server.url` 加载远程 `/m/`，原生桥只对顶层文档可用；候选图提交审图分支供 Claude 审核。
- [x] MB2-2a（2026-11-06）：迁移 MDL-2 成功信封解析、思考深度与工具预算，迁移按当前序列为 V284；Mac 开发库核对停在 V282，未执行旧手机 V283/V284，未改开发库。PASS：仓库约束/Go 全单测、Go store/http 集成、RLS 全组、桌面 Vitest 155 项、Node 离线 1187 项；受管 catalog-admin、hl-proactive、voice-chat、w11-tool-meter。W11 与 e2e-chat 合跑受前序预期失败账本影响，已在新隔离库单场景全断言通过，未削弱断言。原生账本/工具探针/超时出站已独立复核通过。提交：c6e6ea23；未调用真实模型、未部署。
- [x] MB2-2b（2026-11-06）：迁移来电主动触发、语音留言、收件箱 call 状态和响应接口；旧手机来电源 c642dcf8，迁移重编号 V285（总数 206）。同 UUID/同动作幂等，30 秒过期保留未接留言，owner/会话/CSRF 与 ST ACK 边界独立；按 ADR-0011/0012 保留 main 的邮箱/飞书 D2 与桌面普通提醒，未迁入旧分支会丢兜底的 call 排除。PASS：6 个 Go 影响包、Go store/http 集成、RLS、quick、Node bridge 21 项、受管 catalog-admin/hl-proactive/voice-chat/w11-tool-meter 四组、独立契约复核。受管首次因 worktree 未构建 bundle NOT_RUN，构建后四组全过。提交：653e2015；未改开发库、未部署。手机来电 UI 与 call 字段解析由 MB2-9/12 接入，不新增当前无消费者的前端 mutation。
- [x] MB2-3（2026-11-06）：增加手机空壳入口与 /m/ 同源鉴权托管，session-bridge 运行模块动态导入，首屏 JS/CSS gzip 静态依赖图预算门禁；空壳不加载引擎。PASS：check.sh 全量（52s）、桌面 Vitest、host-auth/导入边界/预算坏输入测试及独立契约审计。手机空壳 JS 104,566 B、CSS 4,812 B，低于 300,000/60,000 B；后续受管发现桌面预热时机回归，已由桌面入口显式 eagerRuntime 恢复，手机保持 idle，并让 gate 识别 Vite 动态准备模块；目标 35 项与预算坏输入 8 项、双端构建、nf-desktop 复验 PASS；不代表已实现手机页面的性能。提交：8107f672、0be25328、14639038；未合并 main、未部署。
- [x] MB2-4（2026-11-06）：七个功能区共享逻辑已完成，导航与桌面偏好通过适配器注入，原生独立消费者保留。最终组合 PASS：Vitest189项、Node1189项、类型/双端构建/导入边界、quick、完整dr2-layout（368s）与nf-tavern（26s）。同原始基线完整夹具流程生成169张图，记忆/陪伴/剧情/设置/酒馆代表390浅与1440深对照无布局、控件或换行变化；时刻、夹具端口和极光动态差异已说明，不宣称像素全同。见.review-queue/MB2-4-final及各功能区NOTES。未合并main、未部署。
- [x] MB2-4-tavern（2026-11-06）：抽取酒馆条件保存/冲突/草稿状态；代码编辑与弹窗保持视图owner，设置导航由桌面适配器注入。PASS：候选Vitest181项、Node1189项、nf-cards与nf-tavern、最终组合及视觉对照。首次并行压力下Monaco键入丢字，独立完整复跑、6倍CPU定向观察与最终整合复验全部通过；输入实现与基线相同，触发条件未确定，未引入推测性修复。提交：3ae32a41。
- [x] MB2-4-settings（2026-11-06）：设置表单保留共享dirty/保存/冲突状态，路由、离开保护、主题偏好由桌面适配器注入；原生独立消费者保持可用。PASS：独立审计、集成Vitest185项、候选Node1189项、类型/双端构建、nf-settings/dr2-settings整组。角色到声音设置的测试保留精确路由参数并补验注入能力；12张功能截图及最终同夹具视觉对照PASS，实际差异见本功能区NOTES。提交：ae96ff67。
- [x] MB2-4-story（2026-11-06）：抽取开局、舞台行动、回档与结局记忆业务状态；桌面适配器注入路由与离开保护，保留原 DOM/classes 与卡片叶子生命周期。PASS：候选 Vitest181项、Node1189项、构建/类型/导入边界、dr2-pages/nf-business整组；首次并发负载下的无关超时在原阈值与断言下限制worker后全绿。20张功能截图及最终同夹具视觉对照PASS，实际差异见本功能区NOTES。提交：cdc3fbd6。
- [x] MB2-4-inbox（2026-11-06）：抽取关系切换、策略表单、已读/会话定位、跟进、渠道和重新验证状态；导航与guard由桌面适配注入，系统通知权限保留视图。PASS：集成Vitest177项、Node1189项、dr2-pages/nf-business整组；当前生产导航/标记已读顺序与原实现一致。最终同夹具视觉对照PASS，实际差异见本功能区NOTES。提交：4c6727f1。
- [x] MB2-4-memory（2026-11-06）：抽取关系筛选、记忆详情/纠正、日记和收藏/提醒状态；来源定位保留稳定消息标识和导航后跳转，显式禁用原生DOM查询。PASS：集成Vitest171项、Node1189项、dr2-pages/nf-operations/nf-business全组、独立复审。最终同夹具视觉对照PASS，实际差异见本功能区NOTES。提交：7c4d9fb4。
- [x] MB2-4-characters（2026-11-06）：抽取角色搜索/选择、详情、创建与人设/实例表单状态，桌面注入导航和离开保护。修复删除查询先移除详情后丢导航，以及实例弹层失败重试复用被F2封锁标识两项抽取回归，创建向导原三阶段复用保留。PASS：集成Vitest166项、Node1189项、nf-business/dr2-mvu-new、V286后dr2-pages/dr2-layout；独立复核通过。完整受管截图采用与原基线相同的全流程，见.review-queue/MB2-4-characters；代表390浅/1440深对照无布局与控件差异，时刻/极光采样差异保留说明。提交：3ccfa7b0。
- [x] MB2-4-chat（2026-11-06）：抽取草稿/发送、稳定消息动作与聊天状态；导航、壳层状态和减弱动态由桌面注入，原 DOM/classes/原生独立组件路径保留。PASS：桌面 Vitest 163 项、Node 离线 1189 项、受管 dr2-layout（9 宽度与往返）/nf-chat/nf-operations；nf-desktop 的 MB2-3 预热问题在 0be25328 修复后复验 PASS。独立逻辑复核与7对截图抽样 PASS，169张候选与说明见 .review-queue/MB2-4-chat；时间戳/极光采样差异有说明，不宣称像素相同。提交：8e8ba71c。
- [x] MB2-DB1（2026-11-06）：Owner 追加授权后，隔离库真实双事务确认 40P01；V286 将 go_prepare_memorycore_call 的现有 owner barrier 放到 work_item 行锁之前，迁移总数207。PASS：并发回归红转绿（遗忘成功、调用CLAIM_LOST且无attempt）、Go migrate/store/http目标与store/http全组、RLS239项、独立锁序/权限审计。带V286的完整受管 dr2-pages 已复验 PASS（18.562s），原503阻塞解除；提交 d436615b。
- [ ] MB2-5（2026-11-07，Owner限定子范围已交付）：Ionic五标签/大标题/页面栈、设置大sheet和共享主题极光已接入，首屏引擎idle；复用共享主题store与Lucide图标、库路由/模态生命周期，未实现业务页面。PASS：组件全量首轮192/194，修复图标登记与无效token后受影响3文件15/15；Node1189/1189、类型/双构建/导入边界、quick、mb2-shell/mb2-layout。最终首屏JS196159B/CSS10229B。独立4×CPU正常动画下首次交互与热重复共619帧，P50/P95为16.7ms、最大16.8ms，>33.3ms帧0、>50ms长任务0；范围仅壳层转场，不含真实消息滚动/历史/冷首屏/引擎净堆。8张390/1440浅深截图与选图并排，自查差异见.review-queue/MB2-5/NOTES.md；实际极光与sheet边距不宣称像素相同。表单返回保护公开API限制见Backlog L；业务页面/原生安全区键盘/系统字体/折叠双栏及待选图部分未完成，整条保持未勾选。提交：本条目feat(MB2-5)。
- [x] MB2-DB2（2026-11-06）：`ValidateEngineProposal` 先取 owner barrier 再锁来源行，消除与遗忘的反向锁序（基准既有问题）。修复前双事务回归 40P01，修复后遗忘成功、校验返回既有冲突；Go store/httpapi 全组 PASS；未改迁移。
- [x] MB2-5F（2026-11-06）：全屏卡片路由统一为 `/m/chat/:conversationKey/card?message=`，与服务端入口白名单一致；同模式参数化页面改由 Context 取动态值，不再持有过期 props；导入边界检查覆盖手机入口的间接引用并移除过期白名单。PASS：修复前回归失败、修复后手机 Vitest 11/11、host-auth 11/11、边界 8/8、Node 1189/1189、两端构建与首屏预算、`mb2-shell`/`mb2-layout`。遗留：插槽分发为七层嵌套三元，MB2-6 接线时改为映射表；设置 sheet 全高时顶部透出底层大标题，按 M13-0 留出顶部间距（MB2-6 修正）。提交 9b62d94a 及本条。
- [x] 合并 main（2026-11-07）：`mobile-react-rebuild` 快进合入 main。被测提交 `8750831b`：本机 check.sh 全量、Go store/httpapi、RLS、`mb2-shell`/`mb2-layout` PASS；Mac 参考环境桌面与手机受管整组 19/19 PASS（0 重试），4×CPU 壳层采样 P95 16.7 ms、长任务 0、首屏 JS 196.6 KB / CSS 10.2 KB。结果见 `docs/history/2026-11-07-mb2-merge/`。之后仅文档变更。
- [ ] MB2-6–MB2-15：本轮未开始。[ADR-0012](docs/decisions/0012-mobile-react-shared-engine.md) 已获 Owner 批准（2026-11-06，React + Capacitor，安卓与 iOS 同时）；后续条目与验收见 [Backlog L](docs/planning/2026-10-31-handoff-backlog.md) L 节。


## V2 遗留未完成（ADR-0009）

- [ ] `V2-W03` 原生宿主、C1 保护基线、模型目录与三协议基础。用例：C01、C02、C03、C06、C07、D01、
      MODEL06–MODEL08（基础）、UI03。
      结果：READY_FOR_OWNER（2026-10-28）；代码提交 `7ba20e6d..dbb0fe1a` 已推送；
      实现边界见执行计划 W03，运行入口与验收命令见 `integrations/sillytavern/README.md`。
      验证：最终 `bash scripts/check.sh` 10/10 PASS（25.4s，检查期间源码未变，含 ST 166/166 单测）；
      SQL/RLS、Store 真库及直接消费者检查 PASS；`git diff --check` PASS。
      用例：`accept.mjs` 的 C01/C02/C03/C06/C07 PASS；CHARX 导出 NOT_APPLICABLE（上游不支持），
      原生建群高亮等已知诊断已在结果 error_notes 中说明，不影响对应持久化与交互断言。
      `accept-managed.mjs --filter` 全 15 场景（含 `ui03-browser`）一次 PASS、退出码 0；MODEL06–MODEL08
      基础合成子项 PASS，覆盖三协议流式 / 非流式、工具续接、取消、上下文预算、配置偏离拒绝、
      Key 撤销、版本冲突、续接隔离；真实 ST / Go / PostgreSQL / MinIO 配合本地合成 provider。
      UI03 桌面真实界面子项 PASS：保存读回、409 保留草稿、Key 只显状态、身份快照写入保护、
      用途绑定与参数投影、保存 / 绑定零上游请求、显式连接及三协议原生输入发送，出站捕获与回复对应。
      D01.d 合成备份恢复子项 PASS：正常应用产物加密备份后隔离恢复，11 项目录与配置比对一致，
      目录 / 文件权限及错误口令拒绝通过；本轮受管进程和专用 PG / MinIO 容器已清理。
      Owner 待配置：D01.a BLOCKED（FileVault 关闭，正式磁盘 / 卷保护未落实）；建议确认加密存储位置、
      备份目标 / 保留期和密钥保管后补 D01 正式配置验收。此前只使用合成数据，不接入真实私人数据或正式 Key。
      真实模型效果、真实费用和真机子项 NOT_RUN（缺对应 Owner 输入），不以合成结果替代；
      不阻塞依赖已满足的后续独立代码工作。原有用户 ZIP 保留且未纳入提交。
- [ ] `V2-W04` 复杂状态卡与首轮手机体验。用例：C04、C05、UI01 / UI02（基础）。
      结果：READY_FOR_OWNER（2026-10-28）；代码提交 `7d34aa2b..fb22abc6` 已推送；
      原创原生导出卡 `integrations/sillytavern/fixtures/chengxia-complex.json`，运行/验收入口见集成 README。
      验证：`bash scripts/check.sh` 10/10 PASS（25s）；最终受影响 ST 离线测试 172/172 PASS（4.6s）；
      原生 `accept.mjs --only C04,C05` PASS；受管 `accept-managed.mjs --filter ui04-browser` 中 C04/C05 PASS，
      UI02 修复后按 `VC_W04_CASES=UI02` 定向复验 PASS（含 catalog-admin，退出码 0）；`git diff --check` PASS。
      实际浏览器 Google Chrome 156.0.8078.48；真实 ST/Go/PG/MinIO 与本地合成 provider，未调用真实模型。
      用例：C04 当前宿主子项 PASS（真实 Helper iframe/MVU/EJS；10→15；下一轮条件上下文；刷新、原生保存）；
      C05 当前宿主子项 PASS（候选8、15/8切换、分支隔离、末条编辑后显式重算、重生成与迟到任务完整结束后不串写）。
      修复上游 MVU 3秒全局节流吞掉快速新候选事件；补丁只作用于自托管派生 bundle，保留原始上游锁。
      受管装配复用原生 bootstrap 安装锁定 Helper/EJS/MVU 与同源资源；不复制原生聊天、设置或凭据。
      UI01 聊天/导航实现子项 PASS；UI02 桌面与390/360窄屏基础子项 PASS（真实状态栏、原生角色抽屉、模型页、
      草稿保留、短视口输入可达、发送与停止）；修复 ST transform 包含块导致手机模型页遮罩高度为0。
      原生角色抽屉关闭动画已单独核对结束状态，截图中间态不作为残留遮挡缺陷；验收等待实际 display:none。
      Owner 项：目标手机、真实软键盘/触控及真实模型体验 NOT_RUN；不能用窄视口替代真机，条目暂不勾选。
      F2 与长期记忆的跨阶段复查 NOT_RUN（分别随 W05/记忆工作项补齐）；更早楼层编辑沿用 MVU 显式回放，
      不承诺任意历史编辑自动级联重算。受管进程及专用PG/MinIO容器已清理；原有 ZIP 保留。
- [ ] `V2-W10` Inbox 与邮箱＋飞书通知。用例：C08、B04、N01–N03、A04。
      结果：READY_FOR_OWNER（2026-10-29）；提交 `f46cb148..857b969f`（链分支 `v2/w10`，合并 main 后快进入 main）。
      V180–V181：inbox（ST 投递、已读、链接 present/removed/invalidated 分列）、渠道配置（凭据仅字段密文、不进
      导出）、投递（pending/accepted/failed/unknown/stopped，唯一键含 owner），FORCE RLS，删除意图下函数与触发器
      双重拒绝；撤回 PUSH_NOTIFICATION、取消与过期只停未发送投递。inbox 领取只决定谁尝试写入，经 F2 当前基线保存
      并在消息 metadata 写入 inbox_event_id、读回后才 ACK，ACK 前崩溃按已有事件关联不重复，删除/回档不补投，
      WAITING_HOST 不写聊天。邮箱用 go-mail v0.8.1（MIT，隐式 TLS、强制证书校验），飞书群 Webhook 用标准库（官方
      签名，HTTP 与业务结果分判，不跟随重定向）；发送前检查渠道开关、安静时段、通知日上限（独立常量 20）、删除意图
      与当前同意，正文经本地安全策略，默认无正文预览，飞书注明群成员可见；凭据按渠道行解密，缺失不回退；接收后连接
      中断有界重试后记 unknown 并承认可能重复；accepted 不充当 ST ACK。.gitattributes 令 vendor 逐字保存。
      用例：B04 PASS（ACK 后旧整份快照被 F2 拒绝且链接仍 present，离线与受管端到端）；N01–N03 合成子项 PASS
      （`w10-inbox-notify` 受管场景用本地 SMTP 与本地 Webhook：两渠道 accepted、无正文预览、含受登录保护会话链接、
      删除后 removed 不补投、WAITING_HOST 只发「有待继续的互动」、安静时段保持 pending、撤回同意后停发）；C08 合成
      子项 PASS；真实邮件/飞书发送与手机显示 NOT_RUN（真实发送未授权，属 V2-OWNER-NOTIFY）；A04 NOT_RUN（需 Owner
      配置真实目标并在手机关闭网页后观察，属 V2-OWNER-NOTIFY / V2-OWNER-DEVICE）。
      验证：`bash scripts/check.sh` PASS；RLS 全量 PASS；integration 三包全量 PASS；ST 离线测试 423/423；`git diff
      --check` PASS。合并时保留 W13 的 guardUnmanagedGeneration 与 W10 的 attemptInboxDelivery 两个桥方法。
      执行：Claude 调度，Grok Build 实现，调度者逐项审查复跑。
- [ ] `V2-W11` 有限工具与统一调用计量。用例：A03、MODEL01–MODEL05。
      结果：READY_FOR_OWNER（2026-10-29）；提交 `092929b3..95dead13`（链分支 `v2/w11`，合并 main 后快进入 main `76b052cc`）。
      V190 工具执行事实（两阶段提交、幂等键、FORCE RLS）；`POST /api/v1/st/tools/execute` 只认会话绑定的 chat，
      仅查询跟进与创建/取消提醒，模型台词与越权关系记失败执行。V191–V195 前台、MemoryCore、问候与工具回合共用
      月度预留池：按 min(单次天花板, 估算) 预留，超时记 UNKNOWN 不按 0 释放，缺价/缺预算/超限不发送。ST 插件
      有界工具循环（每步先问 Go，出站工具内容等于 Go 结果，8 步上限，未验证 toolCalls 与未计量 MVU 额外生成在
      发送前拒绝；剧情回合剥离陪伴工具且不因工具能力未验证被拒）。预留失败即关闭 `VC_USAGE_CLOSED`；原生
      Chat/Claude 用 node-fetch，补丁在响应后结算、抛错按 UNKNOWN 取消，再武装时取消旧预留（Go 不回收 HELD）。
      受管 custom 源按界面值发送推理等级（ST 会把 max 收成 high 且只给 OpenAI 名单写该字段）。
      用例：A03 合成子项 PASS（`w11-tool-meter` 三协议工具续接、入账、取消后不再发下一步）；MODEL01–MODEL05
      合成子项 PASS（四用途同池、并发预留不超帽、无价零调用、超时 UNKNOWN、受管结束无 HELD 残留）；真实模型
      计量旁证 PASS（`story-real` 4 轮 reasoning_effort=max、FOREGROUND_CHAT 均 SETTLED，测试单价与供应商
      usage.cost 吻合）。READY_FOR_OWNER：各用途正式绑定、单价与月度预算属 V2-OWNER-MODELS；合入后无单价的模型
      一律被 NO_PRICE 拒绝。
      验证：`bash scripts/check.sh` PASS（31s）；RLS 全量 PASS；integration 三包 PASS；ST 离线测试 477/477；
      受管 `story-outbound,w11-tool-meter`、`story-real` PASS；`git diff --check` PASS。
      执行：Claude 调度，Grok Build 实现，调度者逐项审查复跑。
- [ ] `V2-W15` 完整界面、手机与性能；删除旧 Vue / uni-app 前端。用例：UI01–UI03。
      结果：READY_FOR_OWNER（2026-10-29）；W15 提交 `79b67385`、`209bbfe6`、`0acf49eb`、`f9fa4755`、`067d6ae4`、`051585fb`、
      `d19c095b`、`36fa63a7`，合并 `2e707c06`、`7d9a482f`、`952fada0`（其间夹有 W11/W16 提交，不以区间表示范围）。
      ST 扩展七页（聊天、角色、记忆、主动陪伴、剧情、模型、账户/数据）经导航可达，桌面左侧、手机底栏「更多」；F2 冲突按规范文案
      「查看最新 / 保留草稿」，两条路径都把未保存输入放回输入框且无强制覆盖；剧情投影补写静默冲突、读写之间宿主新增消息时拒绝覆盖；
      聊天断线接 ST 在线状态与浏览器 online/offline；数据页常驻恢复限制说明；模型页按账本 ledgerPrice 显示「未配置单价」「仅美元计价可用于发送」，
      发送被拒（NO_BUDGET/OVER_LIMIT）后显示预算不足；账户页改密、验证器、会话。旧 Vue/uni-app 前端与其 CI、check.sh 入口已删除。
      用例：UI01 七页与状态合成 PASS（受管 `w15-ui`、离线页测试与 harness；设计稿 14 张可追溯，运行页与 Stitch 逐屏对应、换主题未断言）；
      UI02 窄屏 390/360、触控 ≥44px、复杂卡同屏状态栏合成 PASS，软键盘与真机 NOT_RUN（V2-OWNER-DEVICE），历史滚动由宿主 #chat 承担未单独断言；
      UI03 三协议原生发送、保存不试连、409 保留草稿、Key 不回显、预算不足真实拒绝且上游 0 次合成 PASS（`ui03-browser`、`w15-ui`），
      真实供应商与真实时延 NOT_RUN（V2-OWNER-MODELS）。§4.1 性能仅 n=1 固定 provider 样本（发送→上游约 0.43s，首字→完成约 3.6s），
      无扩展关/开对照，不作 p95 或容量结论。
      验证：受管 9 场景 PASS（catalog-admin、ui03-browser、memory-browser、story-view-browser、w11-tool-meter、w10-inbox-notify、
      story-outbound、story-play、w15-ui）；ST 离线测试 551/551；w15 harness 三套 failures 为空；`check.sh` 全量 PASS（19s，已不含前端）。
      遗留：真机/软键盘（V2-OWNER-DEVICE）、真实模型与时延（V2-OWNER-MODELS）；generation/realtime Go 路由与 Hub 是否退役另案（catalog 仍为 core-outcome）。
      执行：Claude 调度与审查；Grok Build 与 Cursor grok-4.7-xhigh-fast 实现。
- [ ] `V2-W16` 保护、恢复与运行说明。用例：D06、O01；最终报告。
      结果：READY_FOR_OWNER（2026-10-29）；提交 `fb340d90`、`6beb7489`、`e58a83c8`、`455bbc44`、`643a22c6`、`badf96be`、`eb186a5d`
      与各自合并提交。运行说明（`integrations/sillytavern/README.md`「本机运行说明」）中启动/状态/停止/日志/备份/恢复到空目录均在本机
      合成环境实测，升级/回退只描述未执行；根 README 与 ops/deploy 标明 Compose 不是 V2 栈、远端部署未授权。
      D06：备份纳入 `_vc_accounts/`、`.vc-f2/` 并在归档外另存最新删除清单；恢复先关恢复门，按「当前库 ∪ 当前数据根 ∪ 清单」删除
      已删内容，MemoryCore 权利只取交集，当前库不可达退出 5 且保持关闭；companiond 恢复门关闭时不领取任务、不开放记忆读取。
      演练（含把库回滚到删除前再恢复）被删内容不复活，合成 PASS。O01：重启演练 `scripts/w16-restart-accept.mjs` 15/15 PASS
      （聊天、绑定、记忆、inbox 不重投、通知不倒退不重发、跟进过期租约回收、HELD 超时转 UNKNOWN、剧情世界一致与未确认投影补写、删除屏障）。
      聚焦审查（ST 插件边界与 Go 权利/计费两组）修复：剧情身份未齐拒绝出站、原生预留按请求隔离、流式与工具循环中止收口、删除意图
      期间拒绝计费/跟进/剧情读、跟进同尝试不重发、时区校验、通知发送前锁内复核与 sending 崩溃回收。
      最终报告（截至 `db225522`）：
      - 用例状态：W00–W02、W05–W09、W12–W14 DONE；W03、W04、W10、W11、W15、W16 READY_FOR_OWNER（依赖下列 Owner 项）。
      - 三协议：Chat Completions / Responses / Anthropic 固定 provider 合成 PASS（含剧情出站与工具续接）；真实模型仅 Chat Completions
        （`cline-pass/deepseek-v4.1-flash-1017`）：连通、W08 记忆 7 轮评估、剧情 `story-real`；Responses / Anthropic 真实供应商 NOT_RUN。
      - 两渠道：本地 SMTP 与本地飞书 Webhook 合成 PASS（N01–N03）；真实邮件 / 飞书 / 手机显示 NOT_RUN（V2-OWNER-NOTIFY / DEVICE）。
      - 真实费用（usage.cost 汇总，币种未声明，不含早期未读到 usage 的诊断调用与 G19 单样本探针）：W08 第 2–7 轮约 0.343，`story-real` 两次约 0.0048，
        连通约 0.0001，合计约 0.35；后台日预算与正式用途绑定、单价属 V2-OWNER-MODELS（无 USD 单价的模型一律 NO_PRICE 拒发）。
      - 时延：W15 固定 provider n=1（发送→上游约 0.43s，首字→完成约 3.6s），W08 持久化→可召回 P50 约 58s；无 p95 与容量结论。
      - E3 旧数据：V2 不迁移、不保留旧业务数据；W01 已删除 `~/.virtual-companion/backups` 6 份与 `deletion-manifests` 5 份，
        配置、口令与日志保留，未做全机审计；不提供旧聊天导入。
      - 验证（main `b49b058c`，其后仅 W08 引擎 JS 变更另跑 ST 测试与受管 memorycore 场景）：`bash scripts/check.sh` 8 项 PASS（18s）；
        `infra/db/run-rls-tests.sh` ALL PASS；integration postgres/jobs/httpapi/migrate PASS；ST 离线测试 569/569。
      遗留：备份位置 / 保留期 / 口令存放 / FileVault（V2-OWNER-PROTECTION）；MinIO 导出对象不在备份内；restore.sh 不恢复 PostgreSQL；
      Responses 工具续接为进程内存态，重启不可续；远端部署（V2-OWNER-DEPLOY）；generation/realtime 旧链是否退役另案。
      执行：Claude 调度与审查；Grok Build 与 Cursor grok-4.7 实现。
- [ ] `V2-F03` 前端 Apple 风格重设计（Owner 2026-10-29 确认交互原型为基线）。设计真源 `DESIGN.md` 第 2 版（`6bf76812`），
      实现计划 `docs/planning/2026-10-29-frontend-redesign-plan.md`（第 4 节已改成实际批次）。状态：F0 DONE（`baa0f5ae`，合并 `6d547f3b`；新外观默认关闭，`localStorage vc-ui=on` 启用）；
      F1 外壳已合并（`4a397a56`，合并 `1cb88083`；`≥1180` 三栏在这一批）；F2 聊天视图已合并（`d4c55ff4`）；F3 设置与酒馆已合并（`d4548671`，合并 `26a159b3`）；
      F4a 记忆+陪伴已合并（`7b01ffec`，合并 `f64a588c`）；F4b 角色+剧情已合并（`ca9e6c16`，合并 `7b380996`）。以上在 vc-ui 开启时生效。
      INT 已合并（`61666060`，合并 `169c25ae`）：抽屉页层级、设置入口接 F3、`w15-ui` 计价样本因端口变成 `:undefined` 而 HTTP 400。
      F5 已合并（全站走查与 DOM 映射；744–1179 进入对话后收起列表已写入 `DESIGN.md` 第 11 节，不是未做的两栏）；新外观现默认开启，`localStorage vc-ui=off` 退回旧界面。
      2026-10-30 main `411f1654` 最终验收：受管默认集 14 场景 PASS；`f2-chat-ui,f3-settings,ui03-browser,auth-browser,memory-browser,vc-ui-walkthrough`（走查 390/1440）PASS。
      走查逐页审出 FIX-FE 第三轮并已合并：浅色模型页按钮与配置行、浅色背景抽屉、1440 账户页遮罩竖带、提示词格式警告条对比度、外壳空 data-settings 导致点击即开设置盖住剧情舞台（≥744）。
      走查改为四组 context 并行并修掉图标就绪空等，单跑 1248s → 44s。合并后 main 复核：node --test 720 PASS、默认集 14 场景 PASS、f3-settings 与走查 PASS。整项待 Owner 人工验收，不勾选。
      待查：`story-real`（真实模型，默认关闭的旧剧情对话框）两次在“NPC 对白提交”等待超时（日志 `npc_reply_not_auto_committed`，林岚/周澈各一次）；
      F4b 对 `story-page.js` 只有新增、旧路径未改，判断为真实模型行为或既有问题，需在 main 上单独复查。
      Owner 2026-10-29 决定：embedding 与重排作为默认本机模型在模型页显示名称与状态、重排可一键开关，暂不提供更换；
      LM 已合并（`2bb78e8a`，合并 `862e22fa`；V266 `vc.owner_memory_rerank`，GET/PUT `/api/v1/admin/local-models*`），页面在 F3。日后更换模型须带记忆向量重建与重排阈值重新校准的完整流程。
      PERF 即已勾选的 `V2-F04`（`17948db3`，合并 `4871d104`）。

- [ ] `V2-OWNER-MODELS`：各用途 provider、Base URL、模型 ID 与凭据引用；真实模型验收总预算与币种；后台日预算。
      2026-10-28 Owner 提供本机私有 `agents.txt` 并明确授权本次真实模型测试；文件已本机 Git 排除，凭据不入库。
      指定 Chat Completions 模型 `cline-pass/deepseek-v4.1-flash-1017`，默认思考 `max`。已用合成短输入验证
      真实非流式和流式连通；非流式为 `{data, success}` 外层信封，流式为原生 SSE+[DONE]，接入时须保留实际语义。
      已解析的两次用量分别为 38/32 和 38/55 输入/输出 token，接口 `cost` 为 0.0000498、0.0000774（未声明币种）；
      此前两次诊断请求未读取内层 usage，完整成本未知，不报零费用。以上仅连通验证，不代表用途配置或记忆质量验收。
      远端服务器现有 `qwen3-embedding:0.6b`（1024 维、CPU Q8_0）合成接口探测 PASS；服务未公开端口，
      通过 ssh-skill 调查，未改现有部署或启用隧道。W08 用同一中文用例对照后决定是否接入。
      其他协议真实目标、各用途正式绑定与日常后台预算仍待配置；本次测试授权不自动启用常驻后台付费任务。
      2026-10-28（W08 起）Owner 授权 Claude 调度会话与 Codex 子代理使用 `agents.txt` 中的模型做真实调用；
      embedding 优先在本机 OrbStack 运行与远端服务器同款的轻量模型，远端实例作为对照或备选。
      2026-10-29 Owner 决定：前台用 agents.txt 的 `cline-pass/deepseek-v4.1-flash-1017`；单价与月度预算为可选——未配单价时照常发送，
      只记录输入/输出/缓存命中 token，费用记为未知而非 0；未设月度预算时不设上限；填了 USD 单价与预算后恢复按金额预留与拒绝。
      用量在模型页用量区查看（按月、按用途）。实现见 V2 后续项 `V2-F01`。
- [ ] `V2-OWNER-NOTIFY`：SMTP 服务、发件凭据与收件地址；飞书 Webhook、签名密钥与目标群。
      2026-10-29 Owner 决定：邮箱与飞书两个渠道都接；凭据由 Owner 在主动陪伴页渠道设置中自行填写，不经聊天传递。
      真实发送验证需 Owner 单次授权后进行。
      2026-10-29 部署配置 PASS：Owner 提供私有文件并授权导入；邮箱 SMTP 与飞书渠道经既有 Store 字段加密入库，
      两条渠道与正文预览均保持关闭，投递记录为 0；临时导入文件已删除，原始输入只在服务器私有目录 root/0600 保管。
      真实 SMTP 认证、邮件/飞书发送及手机接收 NOT_RUN，继续等待 Owner 对该次发送单独授权；不将配置成功视为送达成功。
- [ ] `V2-OWNER-DEVICE`：目标手机及邮件 / 飞书客户端通知设置（A04、UI02 真机验收）。
      2026-10-29 已提供远端 HTTPS 登录入口；390/360 宽、软键盘、返回手势、复杂卡及关闭网页后的真机通知仍为 NOT_RUN，需 Owner 本人操作。
- [ ] `V2-OWNER-PROTECTION`：磁盘 / 卷保护、备份位置与保留期、密钥保管、ST 聊天保留期限（D01、D06）。
      W03 只读盘点确认本机 FileVault 关闭；正式数据所在磁盘 / 卷保护、实际备份与密钥保管配置仍待落实。
      先完成合成数据的权限与加密备份恢复验证，真实私人数据和正式 Key 接入保持待配置。
      2026-10-29 Owner 决定：不开启 FileVault，已知并接受磁盘明文（聊天、角色、记忆）在设备丢失/送修时可被读取的风险；
      不设定期备份，仅按需手动执行 `backup.sh`。
- [ ] `V2-OWNER-DEPLOY`：服务器常驻部署的目标与授权（1A；授权前在本机开发与验证）。
      2026-10-29 基础部署上线（main `12eaee94`），同日升级至 `da2d6586`；本次升级、自动检查及 Owner 人工登录验收 PASS，其余未执行项保留，故本条暂不勾选。
      - PASS：首次升级配置准备、服务单元安装与重载；手动加密备份包含 PostgreSQL，并通过解密后的逐字节自校验。
      - PASS：本机 linux/amd64 构建、传输与镜像导入；上游锁、vendor 和核心补丁校验；受管设置扩展更新并逐文件核对。
      - PASS：整体强制重建与健康等待；新增 V250、V265 迁移成功，目标版本全部 186 个迁移已应用；常驻服务健康，一次性任务退出码均为 0。
      - PASS：Go health/readiness、MemoryCore readyz 三项、登录页、HTTPS 与跳转、未登录私有资源 401、非法 Origin 403、登录限流 429；
        外部端口范围保持不变，服务重启后健康与持久化配置核对通过。
      - PASS：Owner 账号保留且原密码校验成功；Owner 人工确认已成功登录并进入主界面。
      - PASS：通知渠道仍为 2 条，渠道和正文预览均关闭，投递记录仍为 0。
      - 该次 NOT_RUN：Owner 改初始口令与 TOTP 绑定操作、真实模型调用、真实通知发送、手机真机和整机重启；后续升级与真实聊天验收见 `V2-DEPLOY`。
- [ ] 陪伴体验后续（2026-10-31 起由接手 agent 执行）：任务清单 `docs/planning/2026-10-31-handoff-backlog.md`，语音 `docs/planning/2026-10-31-voice-plan.md`，规则见 `AGENTS.md`「接手开发」。按 ID 在下方回填（提交、验证、`.review-queue/<ID>/`、是否已部署）。
        - [ ] 保留缺口 M09-direct：「我们上次谈到哪一步了？」缺少主题词时仍未召回。真实效果评测原始正向 6/8、负向 6/6；带主题改写问已定向修复，不把它改写成整组效果评测全通过。本轮不增加上下文补全。
  - 已完成子项见归档 `docs/history/TODO-2026-11-06.md`「陪伴体验后续」。
- [ ] 全项目审查修复（Owner 2026-10-30）：A/B/C 全部处理。FIX-GO 已合并（`52d30932`：工具验证竞态、预算边界、用量口径、隔离）。FIX-MC 已合并（`6c75e74c`：并集截断、错误归属、子句重排、缓存隔离）。F5、FIX-FE 第一/二轮已合并（`62c7e571`、`6f34eaf3`）。FIX-OPS 第二轮已合并（`24031186`：场景注册拆模块、受管提速、重排目录、写前重认证与验收断言）。FIX-FE 第三轮已合并。A/B/C 修复全部合入，待部署与 Owner 验收。本条不勾选。
- [ ] 线上验收后续（Owner 2026-10-30）：2026-10-30 18:27 以一条命令部署 `e70e99fe` 上线（191 迁移/V270，全部健康，`VC_SESSION_TTL=720h` 生效）；首次真实部署修正了构建上下文缺 upstream、无标签数据卷、服务器访问 GitHub 超时（改为 bundle）、--resume 续传混合、Linux stat、MemoryCore 备份、镜像目录权限（中途一次 ST 起不来，已回退后重部署，中断约数分钟）。待 Owner 登录同意五项后确认首次记忆提取 DONE。
      - 登录：信任此设备 90 天（默认关）、二维码/一键添加验证器、六格验证码自动提交、恢复码复制/下载门控、登录页按 DESIGN 重做；账户页已信任设备与撤销（`ec016bcf`、`cf5d224f`、`a3f59594`）。登录有效期 30 天待部署时写入 `runtime.env` 的 `VC_SESSION_TTL=720h`。
      - 五项必要同意：线上 `vc.consent_record` 为空导致记忆提取一直被拒；首次进入「开始之前」一键同意，账户页「隐私与同意」查看/撤回（`d78d0b9d`）。部署后 Owner 需同意一次。
      - 记忆提取：systemMessage 未声明并入首条 user 消息、准入拒绝按具体原因关闭（`52219ecf`）；线上已有死信不重放。
      - 召回：无候选时 embedding/重排预取失败不再拖垮召回（PERF 回归，`971a851d`；线上不受影响）。
      - 剧情旧对话框保留未提交对白（`7cd7a00e`）；头像缩略图 WASM 补丁（`d70c2ee4`）；FIX-FE 第四轮 A/B（`4df2cfa6`、`36d2a075`）。
      - 工具：一条命令部署 `ops/deploy/v2/deploy.sh`（`6ed9d527`，未真实执行；服务器缺 `/etc/virtual-companion/st-backup.pass`，首次部署前需建立）；本机常驻测试环境 `scripts/local/dev.sh`（`42504c23`，同步线上含通知凭据且不关闭通知，`edaac24b`）。
      - 前端验收改为 Sonnet 初筛 + Claude 裁决；第一轮 39 条中确认问题由 UI-PAGES / UI-SETTINGS 两路修复中。待办：`memorycore-native` 偶发重排 timeout（第 72 条检索）。

## 冻结（不推进；Beta / Dogfood 序列 2026-10-27 起冻结，见 ADR-0009；详情见归档）

- [ ] `DOGFOOD-01` `READY_FOR_OWNER`（代码侧 2026-08-24 完成，真机 LAN 访问与
- [ ] `DOGFOOD-03` `READY_FOR_OWNER`（脚本与演练 2026-08-24 稳定化完成，launchd
- [ ] `DOGFOOD-05` `READY_FOR_OWNER`（代码侧 2026-08-24 稳定化完成，7 天运行与
- [ ] `DOGFOOD-07` `READY_FOR_OWNER`（代码侧 2026-08-24 稳定化完成，真实清理由
- [ ] `DOGFOOD-09` `READY_FOR_OWNER`（自动化侧 2026-08-24 稳定化完成，真机
- [ ] `DOGFOOD-10 / A4` `READY_FOR_OWNER`：Owner 连续 7 天、每天至少一次核心旅程；
- [ ] `DOGFOOD-11` `READY_FOR_OWNER`（代码侧 IME Enter/229 composition 守卫与
- [ ] `OWNER-INPUT-PROVIDER-TERMS`：Owner 提供登录后条款/隐私页面截图或可核验 URL。
- [ ] `OWNER-INPUT-PROVIDER-REVISION`：确认渠道是否暴露不可变 model revision；若只提供
- [ ] MODERATION-PROVIDER SafetyClassifierPort 真实 moderation 实现，
- [ ] EMBED-PROVIDER EmbeddingPort 真实 embedding 供应商实现（现为确定性
- [ ] EMERGENCY-CHANNEL webhook 外发：真实发送替代 SIMULATED_EMAIL_LINK
- [ ] B1-COST `BLOCKED_EXTERNAL`：真实供应商账单抓取与批准容差报告待 Beta 输入；
- [ ] D0-PLAN `DEFERRED_NO_SAMPLE`：当前没有可招募用户；招募条件、筛选问卷与访谈
- [ ] D0-RUN 15–20 次问题访谈 + ≥10 次原型体验（现有 H5 + 测试账号作
- [ ] D0-DECIDE Go/Pivot/Stop 决策写入 `docs/decisions/`（ADR）；不达线
- [ ] B0 材料人工项（逐项活状态以 docs/beta-readiness 各文档内清单为准）。
- [ ] A4 内部验收 `IN_PROGRESS`：按 ADR-0006 调整为 Owner 单人连续 7 天探索性
- [ ] `G12` Resource/capacity 验收与 Go-only dogfood（三次独立 runtime-only 测量均 PASS（2026-08-30，60s idle 口径）：idle RSS…
