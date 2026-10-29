# TODO

## V2 执行序列（ADR-0009，2026-10-27 起当前主线）

> 决策 `docs/decisions/0009-v2-sillytavern-host-direction.md`；每项的内容与验收入口见
> `docs/planning/2026-10-27-v2-execution-plan.md`；需求快照 `docs/source/v2-r3/`。
> 按执行计划第 2 节的顺序逐项推进，每项完成后按第 2.3 节格式回填本节。用例状态
> （PASS/FAIL/NOT_RUN/BLOCKED/NOT_APPLICABLE）记在对应条目下，跨阶段用例只记已具备的子项。B06 为 NOT_APPLICABLE（未选 F1）。本节之后的章节是 V2 前的历史记录。

- [x] `V2-W02a` 方向文档对齐（2026-10-27）：ADR-0009、`PRODUCT.md`、`AGENTS.md`、执行计划、本节，
      需求快照入库 `docs/source/v2-r3/`；catalog / OpenAPI 机器值按 ADR-0009 §5 随对应工作项修改。
- [x] `V2-W00` ST 宿主可行性验证：写入 / 最终请求 / 认证入口与补丁面，锁定上游版本。最先执行；
      W03、W05、W13 依赖其结论。
      结果：DONE（2026-10-28）；提交 `3791d293..25ac463e`；验证
      `node integrations/sillytavern/.local/scripts/smoke.mjs` PASS（连续两轮 19/19，退出码 0）；
      `git diff --check` PASS；版本锁 JSON 校验 PASS，四个固定提交与已核验的 10 个产物 SHA256 未改变。
      用例：C01 JSON 导入/世界书与扩展字段/首条可见开场子项 PASS（PNG、导出、其他开场 NOT_RUN）；
      C02 关键词/常驻条目进入实际请求子项 PASS（递归、预算、冷却等 NOT_RUN）；
      C04 Helper/EJS 加载、MVU 初始化值 10、原生落盘与刷新后重选角色读回子项 PASS；
      C04 状态栏、EJS 条件执行、10→15 更新及其他完整场景 NOT_RUN，不提前标整案 PASS；
      MODEL06 OpenAI Chat Completions 本地固定 provider 流式往返子项 PASS，Anthropic/Responses/真实模型 NOT_RUN；
      B01、B05、B07、MODEL07–MODEL08、S01 NOT_RUN（后续认证/F2/协议/剧情实现验收未执行）。
      已完成：四组件版本锁、三类入口与补丁候选盘点、真实宿主最小组合冒烟；结论与限制见执行计划 §6。
      修复：本机冒烟卡改现代脚本字段、修正 InitVar 标记并持久绑定主世界书；等待真实保存完成，
      刷新后恢复原生连接并检查可见发送按钮。未修改业务代码或上游核心，测试脚本保留在本机忽略目录。
      历史：此前三次修复暂停已在获准恢复后解除；Owner 已于 2026-10-28 明确确认进入 W01，
      W00 完成确认点已通过。Helper 未锁 CDN 资源须在 W03 接入时补齐。
      本次恢复用 ZCode GLM-5.3／最高思考主会话，2 个 general-purpose 子代理详情均显示 GLM-5.3；
      子代理思考级别无单独证据；两者均已结束。测试服务已关闭，合成数据保留，原有 ZIP 未改动。
- [x] `V2-W01` 现有工程盘点与旧数据清理：模块处置表；V2 前旧业务数据与本地备份不保留，盘点后删除。
      W00 结论为可行后执行。
      结果：DONE（2026-10-28）；提交 `e435f10a..6b75d8af`；验证清理前精确清单/类型/大小预检 PASS，
      清理后 `python3` 只读目录/保留项检查 PASS，`launchctl print gui/<uid>/com.virtualcompanion.daily-backup`
      确认任务未加载 PASS，`git diff --check` PASS；实际命令与 10 模块处置表见执行计划 §7。
      用例：B03 已定位本机旧业务副本清理子项 PASS；V2 初始化不接入旧来源的运行子项 NOT_RUN（W06）。
      清理：逐个删除 6 份加密备份（5,356,714 字节）和 5 份删除清单（995 字节），合计 11 文件、
      5,357,709 字节；两专用目录均空且目录本体保留；旧每日备份任务已卸载，plist/配置/凭据保留。
      数据库/对象存储：已核查配置、容器与命名卷范围未发现可用本项目实例；SQL/对象删除及逐表
      清空查询 NOT_RUN，不据此宣称匿名卷或全机数据均不存在；未创建空库，未动 Docker 容器/卷。
      保留：源码/测试/历史文档、W00 合成验证资产、原有 ZIP、配置/密钥/证书/日志及其他项目数据。
      本轮仅处置盘点与已定位副本，无业务重构；后续按第 2 节依次推进，无新增 Owner 确认门槛。
- [x] `V2-W02` 设计规范工作副本与 Stitch 桌面 / 手机稿。用例：UI01（设计来源）。
      结果：DONE（2026-10-28）；提交 `492956e7..dcabd5c9`；规范与 ST 集成映射见
      `docs/product/v2-design.md`，七类页面的 14 张桌面 / 手机 PNG 位于 `docs/product/v2-design-assets/`。
      Stitch project `2796557797507753149`、设计系统 `assets/6185810107007504198`；选定 screen ID 与图片
      对应关系见规范 §8.4。已核对主要布局与关键文案，修正生成器补入的错误存储、通知与多设备语义。
      验证：20 条本地来源/图片链接及 14 图映射检查 PASS，`git diff --cached --check` PASS；
      用例：UI01 设计来源子项 PASS；真实 ST 页面对应、UI02 手机与 UI03 配置运行子项 NOT_RUN（后续实现）。
      图中示例数据、静态禁用状态、键盘示意及导出像素尺寸均不作为真实运行证据；未引入生成 HTML 的
      依赖或模拟业务逻辑。ZCode 主会话 GLM-5.3／最高思考，2 个 general-purpose 只读子代理已完成。
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
- [x] `V2-W05` 认证、角色实例与 F2 全写入保护。用例：B01、B05、B07。
      结果：DONE（2026-10-28）；实现提交 `eea2b120`、`7a2d99ea`，均已推送。
      Go 密码/TOTP 为唯一可见登录；所有 ST 资源/API 在线核验 Go 会话，私有账号→handle 映射、
      页面期望身份、Go 注销与旧页拒绝已接通。CharacterInstance 复用 relationship，ConversationBinding
      复用 conversation；V141 解除单活跃约束，Catalog/OpenAPI 与 Owner/RLS 同步，不在 Go 复制聊天 revision。
      F2 覆盖普通/群聊保存、脚本/MVU metadata、编辑/swipe/删消息、改名/删 chat、分支父基线、导入、
      角色目录批量、群组删除、Data Maid 与启动旧格式迁移；内容和 live revision 同写 JSONL，
      身份墓碑阻止旧请求复活，force 不绕过；冲突保留本页草稿，Helper/MVU 迟到结果拒绝。
      验证：`scripts/check.sh` 10/10 PASS（23s，ST 211/211）；PostgreSQL 实例绑定并发 integration PASS
      （50.6s）；`run-rls-tests.sh` 176/176 PASS。真实 Chrome `auth-browser` / `f2-native` / `f2-browser`
      全部 PASS：密码/TOTP、未完成/伪造头/注销/过期/Go故障拒绝、账号数据隔离、共享 cookie 后旧页 409、
      全写入口与同基线并发一成一冲、草稿保留/显式重载、真实 Helper 迟到 updater 均通过。
      C04/C05 在受管认证/F2 下回归 PASS（真实 MVU 初始化/生成、swipe、分支、编辑重算、跨聊天迟到任务；
      console/page errors=0）。B04 的 Inbox+ACK 留到 W10；真实 Owner/目标手机、正式磁盘保护与远端部署
      沿用 W03/W04/W16 待办，本项合成验收不替代这些结果。
- [x] `V2-W06` 来源对账、E3 与跨存储数据权利。用例：B02、B03、R01–R05、D02–D05。
      结果：DONE（2026-10-28）；实现提交 `88855117` 已推送；本项边界见执行计划 W06 与集成 README。
      ST JSONL 保留稳定消息/候选身份与服务端 revision；Go 保存加密来源索引，CAS 对账区分删除、
      暂不可读和空聊天。记忆证据、有效召回与提取提交核对来源代次，失效来源及已遗忘内容不能被旧结果复活。
      ST 提取复用现有队列、attempt、租约与用量账本，使用独立 MEMORY_EXTRACTION_DEDUP_SUMMARY 用途；
      当前非空生成参数显式拒绝，W09 完成参数映射，不回落前台或环境 provider。
      E3/B03：按 ADR-0009 采用 W01 已清理基线，合成受管初始化不搬运旧聊天或激活旧派生数据；
      静态对账与本次初始化子项 PASS，未重新做全机旧数据审计，不恢复旧保管/导出入口。
      用例：B02 持久提交、失败重试、未稳定来源拒绝 PASS；R01–R05 的来源生命周期、跨聊天有效召回、
      漏报编辑/删 chat/改名、不可读恢复与迟到结果拦截子项 PASS；专用 ST 长期记忆注入及最终请求
      跨阶段验收 NOT_RUN（W07），不以本项来源过滤测试声称完成原生注入。
      D02–D04 当前在线域 PASS：ST 聊天/分支/私有角色/世界书与 Go 记忆、来源、摘要、任务结果、提醒/同意
      纳入副本；普通副本排除密钥，字符串 ID 保真，密码确认、一次性下载及到期限制沿用现有契约。
      导出/删号遇 ST 不可用保持原任务待处理并恢复；删除意图冻结晚到写入，全部在线域确认后才报完成。
      首次进入即登记 ST profile，无聊天或以后丢失通道配置也不丢导出/删除责任；不影响其他账号。
      D05 文案边界 PASS：原生扩展菜单的数据权利页说明记忆、原文、当前上下文与离线备份区别；
      未实现排除后续上下文能力，不把文案验收记为能力验收。手机宽度不替代 Owner 真机验收。
      验证：`bash scripts/check.sh` 10/10 PASS（24s，ST 246/246）；SQL/RLS 177/177 PASS；
      来源/提取真库测试 PASS；删号与导出真库定向复验 PASS（64.618s），无聊天 profile 在配置丢失后
      保留导出/删除范围的最后修正定向 PASS（53.565s）；`git diff --check` PASS。
      真实 Chrome `source-native`、`rights-browser`、`rights-native` 全部 PASS，结果目录
      `integrations/sillytavern/dev-managed/artifacts/accept-2026-10-28T12-14-52-500Z/`；
      C04/C05 与 `f2-browser` 实际回归 PASS，修复 live extra 与 swipe extra 别名导致的循环 JSON。
      全部使用合成账号/内容与本地 provider；受管进程和专用 PG/MinIO 已清理，原有 ZIP 保留。
      当前外部记忆引擎 NOT_APPLICABLE；Inbox/通知投产时随 W10 扩充清单，离线备份与恢复清理属 W16。
      该次按 Owner 要求在 W06 收尾后停止；ZCode 已停止。Owner 后续已授权 Codex 以 Goal 从 W07 持续推进。
- [x] `V2-W07` 相关检索、摘要与时间规范。用例：M01–M12（检索与日期子项）。
      结果：DONE（2026-10-28）；实现提交 `8ea57d0d..5de058e1` 已推送；实施边界见执行计划 W07 与集成 README。
      当前实例内分页扫描加密候选，按中文关键词与独立事件日期排序，替换最早 100 条/固定窗口同分路径；
      候选来源核对、去重与预算裁剪接入真实 ST 原生 USER 资料块，开关与 128–2048 token 预算可用。
      复用现有摘要表保存来源引用和有界用户摘录；来源失效/遗忘后不能通过摘要复活。同实例独立会话可共享，
      同族母/兄弟分支与 STORY 日常记忆拒绝；新发现分支归属和召回中目标改版/删除均在最终返回前重验。
      新来源冻结 timestamp/timezone，记忆加密保存记录时间与 eventDate/time；缺时区/歧义保持待澄清，
      日期不等于提醒时刻。重生成/工具续接沿用已保存问题的时间，不用执行时钟重解释。
      三协议最终转换后重核并替换/移除旧块；Responses 推理续接绑定实际资料快照，来源变化拒绝整轮续接，
      重核期间取消不发上游；资料跳过状态回到对应聊天页面。普通资料块不覆盖角色卡/世界书。
      用例：M01/M09 原生浏览器子项 PASS（101 条先行无关记忆后召回婚礼、明确日期与跨聊天摘要）；
      M02 显式更正后的旧记录排除、M03/M04 作用域、M05 遗忘抑制、M06 模式、M07 分支/来源有效性等
      检索子项 PASS；M11/M12 日期与待澄清子项 PASS。M08 完整工具结果、M10 世界/视角隔离与真实模型
      提取/纠正质量 NOT_RUN（分别随 W08/W11/W12–W13，未把子项证明写成全案通过）。
      验证：最终 `bash scripts/check.sh` 10/10 PASS（26s，ST 267/267）；SQL/RLS 178/178 PASS；
      来源/召回/摘要/日期真库定向测试 PASS（76.869s）；Responses/记忆定向测试 28/28 PASS；
      原生 `accept-managed.mjs --filter memory-browser` 最终 2 场景 PASS（含 catalog-admin，退出码 0），
      结果目录 `integrations/sillytavern/dev-managed/artifacts/accept-2026-10-28T13-46-24-604Z/`。
      浏览器三次原生发送逐次核对实际出站与持久回复：有资料、关闭无块、遗忘及旧源漏报编辑后无旧内容，
      每轮一条前台链，page errors=0；首轮默认开关等待的测试缺陷已修，未削弱最终请求断言。
      `git diff --check` PASS；测试进程与专用 PG/MinIO 已清理。真实模型连通与京东云 embedding 调查见 Owner 项，
      本项未启用外部记忆引擎、embedding 或常驻付费后台任务；私有模型配置未提交，原有 ZIP 保留。
      按 Owner 最新“准备收尾”要求在 W07 收尾后暂停 Goal，W08–W16 未开始，整体 V2 尚未完成。
- [x] `V2-W08` 记忆实现对照与管理闭环。用例：M01–M12、MODEL05。
      结果：DONE（2026-10-29）；提交 `d473ae98..db225522`（主线与链分支 `v2/w08e` 交替推进，经合并快进入 main）。
      决定：记忆域采用 MemoryCore（TencentDB-Agent-Memory@084bed45，MIT）作为本机独立服务，经适配层与少量补丁接入；
      记忆域明文（Owner 决定）；embedding 为本机 OrbStack `qwen3-embedding:0.6b`（1024 维，127.0.0.1:11438），抽取用私有
      agents.txt 模型。写路径 propose→Go 核验→commit→publish，Go 回调走能力令牌；检索在 KNN/FTS 前按允许集预过滤，
      低相关拒绝先于融合；画像按允许集指纹跨会话累积；会话摘要/画像经与记忆相同的相关度门（按行计分）与日期门。
      可靠性修复（7 轮真实评估驱动）：非流式等待用首 token 预算、超时同 attempt 重开与 journal、范围 revision 前进时换新
      operation 重提、引擎闭合码可见（去重解析缺陷 DEDUP_INVALID 已修）、遗忘画像按当前允许集重建、清理写失败记 PARTIAL、
      遗忘与删号后引擎库 secure_delete + WAL checkpoint，被删内容字节不留在 vectors.db / -wal。
      用例：第 7 轮真实评估（49 次真实调用，`cline-pass/deepseek-v4.1-flash-1017` 思考 max）硬门槛 H1 负例 6/6 为空、
      H2 日期门禁、H3 遗忘（DONE、所有层不含原事实、新画像已发布且保留其余事实）、H4 提取（无死信、无卡住操作，M12 为
      needs_clarification 且不调度提醒）全部 PASS；M01/M11/M12 日期 PASS；M02 改口新事实落库、旧引擎记录移出 L1，画像为
      「当前居住地：上海；曾居住地：北京」（评估以关键词判错，已核对原文为正确现状加历史）；正例命中 5/8（留出集，阈值偏精确，
      第 3 轮按留出问句调参曾过拟合，未再调）。受管 `memorycore-native`、`memory-browser` PASS。
      成本（usage.cost，币种未声明）：第 7 轮 0.0697，每条消息约 0.0063，每天 100 条约 0.63；持久化到可召回 P50 约 58s。
      验证：`bash scripts/check.sh` PASS；RLS 全量 PASS；integration 四包 PASS；ST 离线测试 569/569；`git diff --check` PASS。
      遗留：两条噪声来源空发布无决策码（与去重丢弃不可区分）；摘要门禁拒绝无计数日志；Responses/Anthropic 真实抽取未测。
      执行：Claude 调度与审查；Grok Build 与 Cursor grok-4.7 实现与评估。
- [x] `V2-W09` 跟进、时间与 G2 后台配置。用例：A01、A02、MODEL01–MODEL04（后台子项）。
      结果：DONE（2026-10-29）；提交 `639dc9ca..8d43b354`（链分支 `v2/w09`，合并 main 后快进入 main）。
      V160–V162、V166–V167：跟进与主动策略表（FORCE RLS），可触发跟进必须带记忆与来源且写入前核验；
      只从已发布、来源再核验的记忆与已保存 MemoryTime 建立，不重新规范化；来源失效/遗忘/替代/改期与有界
      「已有结果」整句规则取消且不复活。调度按用户时区安静时段（含跨午夜）、最近互动、日上限、模式与来源
      判定入队/延后/沉默，延后不改事件日期。后台问候冻结 BACKGROUND_GREETINGS 快照，参数能力不符拒绝且不发
      请求，经月度预留记账，正文经本地安全策略（拦截不落正文），未声明离线能力只记 WAITING_HOST；不可生成时
      6/12/24 小时退避、第 4 次转 SILENT，补绑定或重新开启后可再入队。主动策略默认关闭。
      用例：A01/A02 合成子项 PASS（跟进建立/取消、到期判定、安静时段与日上限、问候生成与安全拦截）；
      MODEL01 后台快照与前台改绑隔离 PASS（MemoryCore 回调快照随 W08 G9 修复）；MODEL02–MODEL04 后台子项
      PASS（未绑定/无价格/超预算零真实调用、按用途独立绑定）；A01 真实模型问候 NOT_RUN（后台日预算与用途
      正式绑定属 V2-OWNER-MODELS，本项未启用常驻付费任务）；inbox/通知属 W10，模型工具属 W11。
      验证：`bash scripts/check.sh` 10/10 PASS（29s）；RLS 全量 PASS；integration 三包（postgres/migrate/httpapi）
      全量 PASS；Go 单测与 ST 离线测试 PASS；`git diff --check` PASS。合并 W12 时修正 V160 导出函数包装名
      （与 V170 同名冲突）与 RLS 200 的合并后导出键期望。执行：Claude 调度，Grok Build 实现，调度者逐项审查复跑。
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
- [x] `V2-W12` 世界、角色视图与样例。用例：S01（世界与视图子项）。
      结果：DONE（2026-10-29）；提交 `517a2922..4eab850c`（链分支 `v2/w12`，经合并 main 后快进入 main）。
      V170 新增剧情局/根分支/参与者/事件表（FORCE RLS，写入经 go_assert_owner，局只能绑定同 owner 的 STORY
      会话且绑定后模式锁定），剧情状态纳入导出并随删号删除。雨夜客栈定义以 go:embed 为唯一真源；同一 STORY
      会话幂等开局（一根分支、四名参与者，NPC 不建角色实例）。ActorView 以白名单投影返回公开设定、NPC 公开
      人设、本人初始认知与可见事件，结构中无 GM 字段，他人私密按 known_by 排除；worldVersion 不符冲突。
      公开世界书样例「蓝窗书店」与雨夜整案分离。ST「剧情」页只以 player 读取视图，admin-bridge 只放行开局与
      player 视图。
      用例：S01 世界与视图子项 PASS（Go/HTTP 对整个响应体做私密与 GM 标记字符串检查；受管浏览器
      `story-view-browser` 校验 DOM/localStorage 不含标记、桌面与 390px 布局）；S01 三协议最终请求 NOT_RUN
      （W13）；行动、分支、回档、结局与陪伴入局属 W14。
      验证：`bash scripts/check.sh` 10/10 PASS（26s）；RLS 全量 PASS（含 200）；Go 单测与剧情/W08 相关真库
      integration PASS；ST 离线测试 364/364 PASS；`story-view-browser` PASS；`git diff --check` PASS。
      遗留到 W14：participant.relationship_id 当前 ON DELETE CASCADE（SET NULL 会触发 V103 删号屏障），映射陪伴
      实例时需重定删除语义。执行：Claude 调度，Grok Build（grok-4.7-build-fast / xhigh）实现，调度者逐项审查复跑。
- [x] `V2-W13` 三协议最终请求控制。用例：S01、MODEL07（剧情子项）。
      结果：DONE（2026-10-29）；提交 `5084e099..30b40f1d`（链分支 `v2/w12` 续做，合并 main 后快进入 main）。
      主防线：插件在 Chat/Anthropic 的最终出站钩子与 Responses 适配后的 body 上，把剧情回合整体重写为当前
      actor 的 ActorView 规范文本 + 本轮玩家话语 + 本轮工具记录，角色卡、世界书、宏、EJS、历史与晚注册追加
      一律不出站；缺 vc_story 的剧情请求拒绝且不回退原文。第二道防线：Go outbound-check（服务令牌，浏览器
      Origin 拒绝）对重写前后与原始 body 文本桶并集规范化后比对他人私密 fact/goal、标记与 GM 真相，拒绝体不
      回显；chatIdentity 必须是该局绑定会话。Responses 推理续接绑定 run/branch/actor/worldVersion。text
      completions、kobold、horde、novelai 四条未受校验出口以集中可重放补丁在联系上游前拒绝（每处 7 行，锁定
      上游不变，ADR-0009 §2 停止条件未触发）。前台在 EJS 之后写入单一 actor 的 vc_story，剧情不注入陪伴记忆。
      用例：S01 三协议最终请求子项 PASS、MODEL07 剧情子项 PASS（固定 provider，`story-outbound` 受管浏览器
      验收：三协议各 4 次上游请求/50 条断言，含工具后续轮与 Responses 续接不跨角色；世界书混入他人私密与缺
      身份时上游请求 0；DOM/localStorage 无标记）；真实模型叙事、流式取消与 usage 不在本项（MODEL 计量属 W11）。
      验证：`bash scripts/check.sh` PASS；RLS 全量 PASS；integration 三包全量 PASS；ST 离线测试 410/410；
      `assemble-managed` 补丁 SHA 复核 PASS；`git diff --check` PASS。
      已知取舍：剧情回合不带历史对话（同一聊天含他人 NPC 回复会泄露知情），对话连贯性由 W14 以带可见性的
      已提交对话事件经 ActorView 投影恢复，列为 W14 必做。执行：Claude 调度，Grok Build 实现，调度者逐项审查复跑。
- [x] `V2-W14` 行动、分支、结局与陪伴角色入局。用例：S02–S05。
      结果：DONE（2026-10-29）；提交 `02a8477d..8c6953fe`（链分支 `v2/w12` 续做，经 `v2/w11` 合入 main）。
      雨夜客栈规则引擎为纯函数（嵌入 JSON 唯一真源），行动/陈述按 (owner, run, action_id) 幂等，在当前分支头
      且 expectedWorldVersion 相等时与 STORY_PROJECTION 同事务提交；拒绝与重放不改状态。V200–V203：回档恢复
      该版本世界并取消此后未完成投影，旧头迟到提交冲突；参与者 relationship_id 改 ON DELETE SET NULL，删号屏障
      只放行置空；结局摘要放弃不写记忆，保存只建待确认共同经历。剧情页行动、回档、按 world_event_id 幂等补写
      聊天投影（用户删除的墓碑不补回）。NPC 台词不作为世界事件提交（批准方案：事件只来自行动）。
      用例：S02–S05 合成子项 PASS（`story-play` 受管七步 a1–a7 到 resolved、钥匙与怀表只转移一次、回档与投影
      补写含回执丢失）；S04 真实叙事 PASS（`story-real` 林岚/周澈各 2 轮，出站仅当前 actor 视图与本轮玩家话语，
      无泄露，4 次真实调用）。
      验证：`bash scripts/check.sh` PASS；RLS 全量 PASS（含 230–234）；integration 三包 PASS；ST 离线测试 PASS；
      `git diff --check` PASS。遗留到 W15：投影补写重试期间 F2 冲突对话框会弹出并阻塞页面。
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

- [ ] `V2-F01` 计费单价与预算可选、用量统计（Owner 2026-10-29 决定，见 V2-OWNER-MODELS）。未配单价放行并记 token（费用未知不记 0），
      未设预算不设上限，有价有预算时维持原预留与拒绝；记录输入/输出/缓存命中 token；模型页用量区按月、按用途展示。

### V2 Owner 项与运行配置（缺失只阻塞相关真实调用或验收）

- [x] `V2-OWNER-STITCH`：提供 Stitch 访问或设计稿（W02 与各页面实现项依赖）。
      2026-10-28 已验证工具访问，Owner 已协助登录浏览器；W02 已生成并保存七页面桌面 / 手机稿。
- [ ] `V2-OWNER-MODELS`：各用途 provider、Base URL、模型 ID 与凭据引用；真实模型验收总预算与币种；后台日预算。
      2026-10-28 Owner 提供本机私有 `agents.txt` 并明确授权本次真实模型测试；文件已本机 Git 排除，凭据不入库。
      指定 Chat Completions 模型 `cline-pass/deepseek-v4.1-flash-1017`，默认思考 `max`。已用合成短输入验证
      真实非流式和流式连通；非流式为 `{data, success}` 外层信封，流式为原生 SSE+[DONE]，接入时须保留实际语义。
      已解析的两次用量分别为 38/32 和 38/55 输入/输出 token，接口 `cost` 为 0.0000498、0.0000774（未声明币种）；
      此前两次诊断请求未读取内层 usage，完整成本未知，不报零费用。以上仅连通验证，不代表用途配置或记忆质量验收。
      京东云现有 `qwen3-embedding:0.6b`（Ollama 0.33.2、1024 维、CPU Q8_0）合成接口探测 PASS；服务未公开端口，
      通过 ssh-skill 调查，未改现有部署或启用隧道。W08 用同一中文用例对照后决定是否接入。
      其他协议真实目标、各用途正式绑定与日常后台预算仍待配置；本次测试授权不自动启用常驻后台付费任务。
      2026-10-28（W08 起）Owner 授权 Claude 调度会话与 Codex 子代理使用 `agents.txt` 中的模型做真实调用；
      embedding 优先在本机 OrbStack 运行与京东云同款的轻量模型，京东云实例作为对照或备选。
      2026-10-29 Owner 决定：前台用 agents.txt 的 `cline-pass/deepseek-v4.1-flash-1017`；单价与月度预算为可选——未配单价时照常发送，
      只记录输入/输出/缓存命中 token，费用记为未知而非 0；未设月度预算时不设上限；填了 USD 单价与预算后恢复按金额预留与拒绝。
      用量在模型页用量区查看（按月、按用途）。实现见 V2 后续项 `V2-F01`。
- [ ] `V2-OWNER-NOTIFY`：SMTP 服务、发件凭据与收件地址；飞书 Webhook、签名密钥与目标群。
      2026-10-29 Owner 决定：邮箱与飞书两个渠道都接；凭据由 Owner 在主动陪伴页渠道设置中自行填写，不经聊天传递。
      真实发送验证需 Owner 单次授权后进行。
- [ ] `V2-OWNER-DEVICE`：目标手机及邮件 / 飞书客户端通知设置（A04、UI02 真机验收）。
- [ ] `V2-OWNER-PROTECTION`：磁盘 / 卷保护、备份位置与保留期、密钥保管、ST 聊天保留期限（D01、D06）。
      W03 只读盘点确认本机 FileVault 关闭；正式数据所在磁盘 / 卷保护、实际备份与密钥保管配置仍待落实。
      先完成合成数据的权限与加密备份恢复验证，真实私人数据和正式 Key 接入保持待配置。
      2026-10-29 Owner 决定：不开启 FileVault，已知并接受磁盘明文（聊天、角色、记忆）在设备丢失/送修时可被读取的风险；
      不设定期备份，仅按需手动执行 `backup.sh`。
- [ ] `V2-OWNER-DEPLOY`：服务器常驻部署的目标与授权（1A；授权前在本机开发与验证）。

## 当前状态（2026-10-21，V2 前实现快照）

当前工作分支 `codex/audit-remediation`，本轮（VC-R04）起点 `480a2c79`。
2026-09-06 基线之后已完成批次包含：

- `d77e77c6` challenge 维度验证码限流隔离（httpapi 测试通过）；
- `aa6b14c2` 输入法回车守卫与流式导航等待态/页面 owner（前端测试与
  type-check 通过）；
- `480a2c79` 验证失效与错码区分、三路径重新登录及 TOTP 合成 cipher 夹具
  （前端测试与 type-check、`scripts/check.sh`、隔离 PostgreSQL 定向测试通过）；
- `04f2d0cf`（VC-R05，backend）数据导出失败单事务闭环，陈旧 claim 不击落
  导出并解除申请阻塞（已推送，验证细节见该提交）；
- `47f9590a`（VC-R06，backend）导出 worker 中断后过期 claim 终态恢复，
  解除 PENDING 申请重复阻塞（已推送，验证细节见该提交）。

2026-10-21 本轮（VC-R04）已落地聊天会话归属与恢复收口：hash 深链复现修复、
hash 编辑转等待后浏览器返回原会话不卡等待（去重基准改为最近 init 目标）、
KeepAlive 停用的隐藏缓存页不响应别的页面 hash 变化（活动实例约束）、
恢复核对会话归属 + turn 身份单飞（等待页先/后触发均不核对、不接管）、
会话窗口切换在途作废旧 run 终局；607 项前端测试与 type-check 通过。真机
中文 IME 验证见 `DOGFOOD-11`，仍为 Owner 人工项。

2026-10-21 数据副本前端（VC-R07）已落地：My 账号分组内联「聊天与记忆副本」
面板，当前密码申请、PENDING 手动查进度、READY 一次性下载、失败/过期可
重申；三 KEEP 导出 API 走既有 auth transport，下载用 `createAuthedFetch`
原始 `blob()`（超过 JS 安全整数的消息编号保真），成功消费清一次性 URL 后
主动作回到重新申请；账号切换重建面板清副本、必须改密的会话不出现入口。
Catalog snapshot 随 API scope 更新重新生成；`scripts/check.sh` 13s PASS，
全前端 641 项测试与 type-check 通过，终稿文案后 panel/account 定向 35/35
复核；本机浏览器 390x844 实测申请/进度/下载事件齐全且下载 JSON 与预期
原始字节一致，320x568 表单几何无横溢。真实手机系统浏览器上完成副本下载
与保存未验收，仍为 Owner 人工项（不对应任何已勾选条目，不改变
DOGFOOD/Beta/CI 现状）。

2026-10-21 会话身份代次收口（VC-R08～R10，已推送）：身份提交推进恢复代次
并收口迟到 probe 错误回填（`7cd0b772`）；换号身份交接清共享私有缓存并作废
在途 relationship/chat 列表读取（`07738d7d`）；旧请求的 401 不得退出新登录，
transport/authedFetch 按会话代次门控 onUnauthorized（`d2737bb9`）。

2026-10-21 缓存页面换号收口（VC-R11）：首页/全部会话/我的三页本地私有状态
（会话预览、密码/注销表单输入、设备列表、错误与忙态）在身份交接时清空，
页面私有的列表读取与动作失败 UI 回调按代次丢弃旧账号迟到结果（含改密/删号
迟到失败；不含认证写成功返回的排序），KeepAlive
重新激活按账号归属重载、隐藏页清理不抢发请求；同账号重新认证不把在途
加载判死（定向审计修复）。682 项前端测试与 type-check 通过；本机浏览器
390x844 合成 mock 缓存返回链（HomeA→会话A→ChatA→My→登出→登录B→返回
My/列表/Home）与受控延迟旧设备读取不回填实测通过。认证写请求跨新登录的
Cookie/Store.logout 响应排序当时为源码候选（普通登出一项已由 VC-R12 收口）；
真机浏览器换号验证为 Owner 人工项（不对应任何已勾选条目，不改变
DOGFOOD/Beta/CI 现状）。

2026-10-21 普通登出迟到不破坏新登录（VC-R12）：logout 响应不再携带任何
Set-Cookie（服务端撤销仍是登出契约），迟到的普通登出不再删除较新登录的
vc_session/vc_csrf（Go httptest+真实 cookiejar 闸门复现红→绿；旧 token 服务
端 401、正常登出、撤销失败不清 Cookie、90 天 trusted-device 语义保持，0 条
Set-Cookie 回归护栏）；store.logout 以身份归属代次（credentialEpoch）门控本地
clear 并返回归属布尔——只有已提交新凭据（ACTIVE 登录/挑战完成，含同 ID 重
登）或不同账号交接才推进，登出挂起期间失败登录（仅意图）与同会话 probe 读回
ACTIVE（仅读取）都不阻止正常退出（两项定向审计修正均有先红后绿回归锁定），
account 与 AdminConsoleShell 仅在「归属本次调用且此刻无较新已认证身份」时
导航回登录页。689 项前端测试与 type-check、httpapi 定向 4/4 与整包、
`scripts/check.sh` 14s PASS；OpenAPI/catalog 契约文案与 dist/snapshot 同步再生成。
遗留候选（未声称解决）：revoke-session 自撤销/revoke-all/改密响应同类
Set-Cookie 竞态、logout 请求晚于新登录发出时服务端撤销新会话的请求侧排序。
未跑浏览器端到端（Cookie 证明走真实 Go httptest，不冒充 mock 为真实服务），
真机浏览器验证仍为 Owner 人工项（不对应任何已勾选条目，不改变
DOGFOOD/Beta/CI 现状）。

2026-10-21 陪伴设置页账号归属（VC-R13）：陪伴设置页补齐 watch
auth.accountId 身份交接清理（仅已知账号→不同/退出，null→X 不清）、
页面私有 load/save 代次独立门控（迟到成功/失败/finally 不回填、不解除
新账号忙态；同账号重新认证不作废在途流程）、KeepAlive 激活按内容归属
账号重载（busy 去重兼首触去重），同账号返回不重复请求、未保存草稿
保留；超时 unknown 语义保持。696 项前端测试与 type-check 通过（较
R12 +7，换号全走真实 AuthStore login/clear，含锁定空态起点的换号
用例）。浏览器 390x844 合成 mock：真实存活链实测（空关系陪伴设置→
去聊天压栈隐藏→chat 401 redirectTo login→登录 B→浏览器回退，同一
$vm.$.uid 实例复活显示 B 表单沈屿、无 A 残留；同账号返回零新请求、
表单保留）；VC-R13P 只读核验六类常规/hash 路径（headerBack/重进/
hash 回祖先/hash 到非祖先 index 及其 historyBack）均为全新实例，原始
实证为空态返回重载，不宣称常规返回缓存。记忆页无产品压栈出口、六类
路径均移除旧实例，本轮 NOT_REPRODUCED：模拟生命周期的防护与测试不
提交，两文件保持基线，迟到读/保存覆盖以组件测试为界。残余：真机
浏览器换号验证仍为 Owner 人工项（不对应任何已勾选条目，不改变
DOGFOOD/Beta/CI 现状）。

2026-10-21 二级页直接入口返回闭环（VC-R14）：navigate.ts 的 goBack 在
uni-h5 页面栈仅剩当前页（直接打开/刷新二级页）时不再走 navigateBack
（安装版会钳 delta=0 → history.go(0) 原地整页重载、不进 fail），改走
所属 tab 根 redirectTo；只读 uni-h5 实际提供的全局 getCurrentPages
（缺席时保持原委托）。新增 navigate.spec 3 用例（栈 1 走回退／栈 2 照常
弹栈／栈不可观测保持委托，均 stub 真实全局形态），699 项前端测试与
type-check 通过。浏览器
390x844 合成 mock（session vcr14，/api/v1 fail-closed 拦截）：直接入口
companion/memory 点击返回先 RED（原地整页重载、栈 1 不动、零报错），
修复后均回「我的」；栈 2 正常返回与 chat（redirectTo 进入栈 1、返回
回退首页）不回归。真机浏览器验证仍为 Owner 人工项（不对应任何已勾选
条目，不改变 DOGFOOD/Beta/CI 现状）。

2026-10-21 改密迟到成功不破坏较新登录（VC-R15）：改密 200 响应不再携带任何
Set-Cookie（服务端原子撤销全部 session 与 trusted device 仍是改密契约），迟到
的旧成功不再删除较新登录的 vc_session/vc_csrf/vc_trusted_device（Go
httptest+真实 cookiejar 闸门复现红→绿；旧 token 401、旧密码 404、旧可信设备
回 TOTP、新密码重登的撤销语义正向用例保持）。前端 onChangePassword 成功路径
以身份归属代次（credentialEpoch，新增只读出口、推进规则不变）门控：迟到成功
遇较新登录（含同 ID 重登）不清新身份、不导航登录页，失败登录意图与同会话
probe 读回不让位、正常改密退出保留（4 项回归覆盖较新登录让位与正常退出对照
——两项让位用例基线红、两项对照用例锚定不误让位，定向 66/66 通过）。浏览器
390x844 合成 mock（session vcr15，fail-closed）实测同链路先红后绿。OpenAPI
契约文案与 dist/snapshot 同步再生成；`scripts/check.sh` 14s PASS（含前端全量
与 type-check）。真机浏览器验证仍为 Owner 人工项（不对应任何已勾选条目，
不改变 DOGFOOD/Beta/CI 现状）。

2026-10-21 账号注销的归属与反馈收口（VC-R16）：注销 200 响应不再携带任何
Set-Cookie（当前密码校验、intent/cancel/cascade 等服务端契约不变），迟到的
旧成功不再删除较新登录的 vc_session/vc_csrf（Go httptest+真实 cookiejar
闸门红→绿；旧 token 401、已删账号登录 404、错误密码会话保留对照保持，
owner-aware fixture 只模拟认证侧注销、不冒充 SQL cascade 验证）。前端
onConfirmDelete 按提交时账号归属门控：注销是账号级后置条件（区别于 R15
credentialEpoch 凭据级），同账号 DELETE 完成前重登仍退出，换号 B/已匿名
静默让位不清不导航；非 ok/断连文案改「无法确认」（404 隐藏存在性、503
intent 可能已持久化、401 由 transport 处理不走该文案），busy=delete 期间
「取消」禁用、提交前取消保留（新增 6 用例：初跑 5 失败，其一初以 401
fixture 构造后按真实语义改 503；同账号锚定用例基线即绿）。OpenAPI
/api/v1/auth/account 补 cookieAuth 覆盖与 200 无 Cookie 语义并再生成。
浏览器 390x844 合成 mock（session vcr16，fail-closed）实测同链路先红后绿。
`scripts/check.sh` 14s PASS（含前端全量 709 项与 type-check）。请求侧排序、其余 API Cookie 竞态、全局 Bearer
契约留待后续模块核查；真机浏览器验证仍为 Owner 人工项（不对应任何已勾选
条目，不改变 DOGFOOD/Beta/CI 现状）。

2026-10-21 会话撤销响应归属收口（VC-R17）：DELETE /api/v1/auth/sessions/
{sessionId} 与 POST /api/v1/auth/sessions/revoke-all 成功响应不再携带任何
Set-Cookie（single 只撤 owner 指定会话、独立 trusted-device 不动；all 原子
撤销发起账号全部 opaque sessions 与 trusted-device；V116/V123 SQL 未动），
迟到的旧成功不再删除较新登录的 vc_session/vc_csrf（及 trusted）。Go
httptest+真实 cookiejar 闸门红→绿（single 2 条/all 3 条过期 Set-Cookie 的
红证据；旧 token 401、非目标会话 200、trusted 可用性对照保持，不冒充
SQL/RLS 集成验收）。OpenAPI 两 operation 补无 Cookie 语义并按真实
owner-404 契约纠正 single 200 描述（store ErrNotFound→404，新增 404 条目），
scope 两项仍 SIMPLIFY 且 currentH5Callers=[]、无 H5 入口，生成物工具再
生成；前端本轮零改动。`scripts/check.sh --quick` PASS、`GOPROXY=off go test -C backend -mod=vendor -count=1 ./internal/httpapi` PASS（含新增 2 项护栏）。请求侧排序与其余 API Cookie
竞态留待后续模块核查；真机浏览器验证仍为 Owner 人工项（不对应任何已勾选
条目，不改变 DOGFOOD/Beta/CI 现状）。

2026-10-21 认证契约元数据对齐（VC-R18）：OpenAPI 中当前 Go 注册 70 个
operation 的 45 个有效 bearerAuth（5 显式+40 继承根）改为 operation 级
唯一 cookieAuth，注册面现为 62 cookieAuth + 8 public、零有效 Bearer；
Go/前端零改动（运行时本就只认 vc_session Cookie），未恢复 JWT/Bearer。
cookieAuth 描述补真实写请求要求（X-CSRF-Token 匹配 vc_csrf；Origin 须
精确命中允许列表、缺失即拒）。54 个未注册 DEFER/RETIRE 与根级 security
未动，legacy 不代表现有 runtime。dist/snapshot 工具再生成；内联映射
验证与 `scripts/check.sh --quick` PASS；Owner 待办保持原状。

2026-10-21 真实本地首轮聊天旅程验收受阻（VC-R19）：以既有入口
`frontend/e2e/journeys/03-home-chat.spec.ts`（chromium、workers 1、retries 0、
trace off、专用端口 5197/18087/18437/19097、独立 /tmp/vcr19 state file）执行，
基础设施准备失败、测试层 NOT_RUN，无任何应用断言执行：MinIO/MC 两个
pinned digest 镜像经 canonical 与显式 registry-1.docker.io 前缀 pull 均真实
rc=1 拿不到；匿名 token 对两仓库未授予 pull（对照 library/hello-world 授予），
身份授权/上游分发/镜像链路原因待区分、不归因定论，解锁不预设必须改全局
daemon。测试依赖可复现性（含官方源码构建）后续可继续研究。上游
github.com/minio/minio（2026-04-25）与 github.com/minio/mc（2026-07-14）已
归档（源码分发；dl.min.io 旧 RELEASE 端点 410 仅证该端点不可用），MinIO
未来支持与生产存储选型为 Owner 待统一处理项，不擅自更换存储/发行版/版本
或接受 AIStor 条款。产品与测试零改动；专用端口与本轮容器清理复核通过。
真实旅程、Owner 人工、真 provider/Beta/CI 现状不变、不勾选。

2026-10-21 SSE 机器契约与真实帧对齐（VC-R20）：openRealtimeStream 的
OpenAPI 契约按 Go v1 真实现对齐——删 5 个退役 required ticket query 绑定
（ticketId/secret/sessionId/origin/streamEpoch）、保留 GenerationId，
Last-Event-ID optional 且 Go 忽略（前端本地伪序号），Origin optional
header（缺失允许、有值校验）；响应补 403/404/503，429 纠正为
INVALID_REQUEST（每代 8 live 订阅上限、Retry-After 固定 1s）；
RealtimeStreamEvent 改为 string 型 SSE 文本流 schema（七事件、两种 data
JSON 形状、无 id/epoch/seq 重放），200 example 给真实三帧。退役 POST
tickets 与其 schema、其余 operation/security 未动；Go/前端零代码改动
（前端只读核查确认仅发 generationId+cookie、不解析 SSE id: 行、七事件
白名单、无退役协议生产残余）。dist 工具再生成；结构化 diff 确认仅该
operation 与该 schema 变化，`scripts/check.sh --quick` 与
`git diff --check` PASS；R19 旅程 NOT_RUN 现状不变，不勾选任何
Owner/Beta/CI 条目。

2026-10-21 恢复可复现本地聊天验收环境（VC-R21）：修复 R19 确证的 E2E
准备故障，默认入口恢复可用。pinned OCI 镜像不可得属获取路径改变：新增
E2E-only `scripts/dev/Dockerfile.e2e-minio-tools`（scratch、arm64/amd64
双消费者 stage、`ADD --checksum` 固定官方 GitHub Release 同版本静态
二进制 minio RELEASE.2025-09-07T16-13-09Z 与 mc
RELEASE.2025-08-13T08-35-41Z、按 TARGETARCH 选 stage，非重建原 OCI
digest）；`scripts/dev/e2e-stack.sh` 以 stdin 空 context 构建并经
--iidfile 共享真实 image id（trap 清理），MinIO/mc 同镜像、PG 固定镜像
不动；mc 改只读私有 config v10（0600/0700）+ --config-dir、禁更新检查，
凭据不进 argv/日志/镜像层，bucket 初始化 rc 受检。验证均在本机
linux/arm64：两二进制 --version 与官方固定版本一致；隔离冒烟
health/mb/ls 与真实旅程 03-home-chat（chromium、专用端口
5197/18087/18437/19097）rc=0、1 passed 0 failed，栈清理核验通过；
quick/bash -n/git diff --check 均 PASS；amd64 stage 存在但本轮未构建/
执行，不等于两架构验证通过。R19 NOT_RUN 保留；MinIO 上游归档与生产
存储选型仍为 Owner 待统一处理；其余旅程未跑，不勾 Owner/Beta/CI/真
provider。

2026-10-21 断线与刷新后的真实聊天恢复（VC-R22）：04-realtime-recovery
两条旅程落地并修复首跑暴露的恢复链路缺陷——reload 时生成仍在途，
recoverInFlight 经 SSE 回放直完成，过渡行无真实消息 ID，历史到达后按
ID 去重失效，持久显示两条相同 assistant 气泡。修复复用既有有界
confirmFinalIdentity（快照核对真实 assistantMessageId，与 send() 对称），
保留 null-ID 过渡边界、不做正文比对，新增 chat.spec T-37c 回归。验证
（OrbStack linux/arm64、chromium/390×844）：初轮 1 FAIL 1 PASS rc=1
（失败证据保留 /tmp/vcr22）→ 修复后 2 PASS rc=0（38.6s）；user/assistant
各 1 与 generation POST 恰 1 为 GREEN 时实测；710/710 + type-check
PASS；栈清理核验通过（端口释放、本轮容器 0）。客户端 abort 与
FAILED_FINAL 不据此证明服务端 upstream 资源已释放；其他旅程与引擎未跑，
不勾 Owner/Beta/CI/真 provider。

2026-10-21 真实登录与受保护深链返回（VC-R23）：01-login-return
既有旅程首跑即通过、零代码改动——覆盖真实 UI 登录而非 shared 会话
（03/04 不能相互替代）：未登录深链→登录页保留 return→未知合成账号
错误凭据 POST 404+错误文案+账号焦点回位→uiLogin 真实登录
（authenticator 挑战）→回原深链见“全部会话”。验证（OrbStack
linux/arm64、chromium/390×844）：1 passed 0 failed rc=0（52.6s）；
端口释放、本轮容器 0 核验通过；无公开注册/单 Owner 边界不变，
不勾 Owner/Beta/CI/真机/真 provider。

2026-10-21 可信设备再次密码登录（VC-R24）：02-auth-trusted-device
既有旅程首跑即通过、零代码改动——首次 UI 登录勾“信任此设备 90 天”→
account 页退出→再次正确密码实际 POST /api/v1/auth/login ok、
nextStep=ACTIVE→首页且“验证登录”0 个；仅声明该观测，不外推未测
安全场景。验证（OrbStack linux/arm64、chromium/390×844）：
1 passed 0 failed rc=0（38.6s）；端口释放、本轮容器 0 核验通过；
无公开注册/单 Owner 边界不变，不勾 Owner/Beta/CI/真机/真 provider。

2026-10-21 陪伴偏好与记忆开关真实保存（VC-R25）：
12-companion-memory-pages
既有旅程首跑即通过、零代码改动——陪伴者名/回复长度/主动程度保存后
离页到 account 返回仍正确；memory 自动记忆默认 enabled、关闭后离页
回读 false 且空态、恢复 true。仅验证偏好与开关持久化/可见状态，
不声称记忆提取质量或完整记忆生命周期。验证（OrbStack linux/arm64、
chromium/390×844）：2 passed 0 failed rc=0（37.6s）；端口释放、本轮
容器 0 核验通过；不勾 Owner/Beta/CI/真机/真 provider。

2026-10-21 消除 OpenAPI 同名 Schema 覆盖（VC-R26）：canonical 源
`components.schemas.MemoryAutoSavePref` 重复定义 2 次（仅 description
不同，safe_load 静默取后者，违反 YAML 1.2.2 §3.2.1.1 键唯一）；
删除被覆盖的前 8 行定义、保留现生效后定义，safe_load 全树语义不变。
验证：yaml.compose 全文档重复键修复前仅此一组/修复后 0 组、该
schema 恰 1 次；safe_load 前后严格相等；dist 再生成 api-bundle 语义
严格相等（仅该块位置随源键唯一化移动、块内容逐字不变），snapshot
仅源 sha256 变；`scripts/check.sh --quick` 与 `git diff --check`
PASS。不改自动记忆默认值/接受语义/RETIRE；Go/前端零改动，不勾
Owner/Beta/CI/真 provider。

2026-10-21 供应商故障的真实产品反馈（VC-R27）：07-provider-faults
既有两阶段旅程首轮因过时文案期望 FAIL，对齐当前真实提示（仅一行
E2E 断言、产品代码零改）后 1 passed 0 failed rc=0（38.9s）：注入轮
“这句话暂时无法回应”、无正文、不泄露注入片段；timeout 轮 durable
FAILED_FINAL、错误文案与 retry 可见（仅断言可见，未实际点击）、无
Provider/SSE 等内部细节；首轮失败点后断言未到达不计入首轮。前端
710 用例+type-check PASS；仅本机合成故障路径，非真实供应商/临床
安全认证。端口释放、本轮容器 0 核验通过；不勾 Owner/Beta/CI/真机/
真 provider。

2026-10-21 双引擎移动端可访问性与页面适配（VC-R28）：08-accessibility
按 webkit-iphone、chromium-android 两 project 顺序实际执行（共 2 次）
首轮 2 passed 0 failed rc=0（42.0s）；Root 发现验收时机缺口（role=main
加载态即渲染，Axe 可能审到骨架），仅测试侧补每页成功内容等待
（home-hero、message-input、conversations-list/empty、account-email=
session.email 且 trusted-devices 出列表或明确空态；未新增生产
testid/sleep、未扩 helper），复跑 2 passed 0 failed rc=0（48.6s）；
前端 710 单测+type-check PASS，产品代码零改。属 Playwright 设备仿真
（iPhone 13/Pixel 5 viewport 的双引擎），非真机 VoiceOver/IME 或生产
验收。两轮栈清理核验通过（state/auth 无残留、4 端口释放、本轮容器
0）；不勾 Owner/Beta/CI/真机。

2026-10-21 消费者与管理端导航旅程（VC-R29）：10-navigation-smoke、
11-admin-console 两旅程在全新隔离栈一次通过 2 passed 0 failed rc=0
（40.0s）：三底栏精确顺序「首页/聊天/我的」、聊天上下文进入全部
会话二级页（无底栏）、我的页四设置区（陪伴/账号/安全/关于）与
AI 非真人标识、普通账号无管理入口且无内部术语泄漏、页面 fit 后
返 Home；合成 admin 共享 session 走四管理区（注册审核/账号/模型与
路由/运行状态）、路由顺序页与返回应用，旅程内 /api/v1/admin 写
请求 0。产品代码与测试零改动；零写仅覆盖旅程内导航，不声称全库
零写或权限全审，管理端为本地合成账号。栈清理核验通过（state/auth
无残留、4 端口释放、本轮容器 0）；不勾 Owner/Beta/CI/真机/真
provider。

2026-10-21 聊天与记忆副本真实下载链（VC-R30）：新增 13-data-export-
download 旅程并入既有双引擎 project（08/13 两 spec，--list 恰 4 例；
base chromium 照旧忽略）。chat 共享会话+既有合成当前密码真实 UI：
错密码 POST /exports 404 与诚实文案（仅声明被拒与可纠正再申请）、
正确申请 200→真实 worker（隔离 MinIO）PENDING→READY→浏览器 download
事件；原始字节校验文件名格式、int64 ID 字段+数字边界、唯一合成消息
锚点与结构计数；READY 有效期内及下载后 DOM/storage 不含真实
downloadUrl/token（布尔断言），download GET 恰 1 次且 UI 收敛「重新
申请」。首轮 13×2 FAIL 为测试侧 fixture（uni-input 定位、READY 移除
进度按钮竞态），旧 run2 中断记 NOT_COMPLETE；修正后 13×2 PASS（run2
1.0m）；收口前再加固（敏感值仅类型+长度布尔断言、下载后同查本次实际
URL/token）终版 13×2 PASS（run3 1.1m）。四例有效覆盖＝08 首轮×2
（2.3m）+ 13 终版×2，08 其后输入未变未复跑；710 单测+type-check
rc0，产品代码零改。本地合成数据+设备仿真，非真机/跨账号全审/生产/
临床验收。栈清理核验通过（state/auth/shared/iid 无残留、4 端口释放、
本轮容器 0）；不勾 Owner/Beta/CI/真机。

2026-10-21 Go 镜像实测（VC-R31）：`backend/Dockerfile` 按 OrbStack linux/arm64
真实构建 rc=0，inspect.Size（packed resources）9,401,540 bytes ≈ 8.97 MiB、
USER vc；api-migration 空依赖 `--network none` 隔离容器 health 200/UP、
healthcheck healthy、非 root。属当前 package 启动验证，非 full DB/MinIO/TLS
部署验收；G12 条目与口径见 `docs/planning/g12-go-capacity-sample.md` §6。

2026-10-21 自动记忆真实进程旅程（VC-R32）：12 旅程新增第三例（原两例
保留不变）。memory 共享会话+loopback provider 真实 UI 三段验证：低敏
「户外」偏好 A 经真实聊天落为自动保存 ACCEPTED 记忆（memories API 轮询
+页面「自动保存」徽标）；真实 PUT 200 关闭开关后同一关系新会话发偏好
B，从既有 provider 请求日志断言 A 恰好一次且仅在专属 [VC_MEMORY_DATA]
记忆块内实际召回（新会话无历史，非回显）；停新增负例以 runtime 现有
/actuator/prometheus 建立最小因果 barrier（B 的 COMPLETED 快照已证
handler 进入——终态只证进入；串行独占 runtime 下读到确实存在且解析
成功的 vc_generation_active===0 证整个 handler 连同同步 enqueue 决策
已返回——终态快照/父 job DONE 先于 enqueue 不构成退出证据），barrier
后断言 V125 开关已关闭时必须不建 MEMORY_EXTRACT 行（无兼容分支），页面
/API 复核 A 仍在、B 未新增，结束恢复默认开启。观测迭代如实：run1 第三
例 FAIL（等待语义按 handler 关闭）、run2 PASS；run3 假阴性源于
vc_generation_peak 只记录历史最大并发数（串行 A/B 峰值均 1，peak>
baseline 恒假；run4 诊断 rc=1、peak=1=baseline 佐证）；中间 claim 计数
版经根审收窄为 active-only 最小版后 run6 PASS（5.3s）；前两例 run1
PASS 后输入未变未复跑。产品代码零改，全程测试观测修正非产品修复，
不声称任何未观测到的 pending job 曾存在；710/type-check 沿用 R30
（src 输入未变）。本地合成数据，非真机/跨账号/生产验收。栈清理核验
通过（state/auth/shared/iid 无残留、4 端口释放、本轮容器 0）；不勾
Owner/Beta/CI/真机。

2026-10-22 核心页三档视口布局验收（VC-R33）：08 新增独立视口布局
case（原 a11y case 逐字保留）。三档 320×568/390×844/430×932 显式
setViewportSize 且断言 innerWidth/innerHeight 到位；匿名 login 三档后
仅一次 chat 共享 cookie 会话走四页 × 三档，复用 expectContentLoaded
成功态门，零新增登录。针对 shell 层 overflow clip 可能掩盖越界
的盲区改用元素包围盒：可见 main 左右入画布、底栏 .vc-bottom-nav__item
计数 3（uni-h5 渲染 uni-button）等宽 ±1px、图标/标签在格子与画布内、
nav 底边贴视口、composer/input/send 不越界不盖 nav、conversations
二级页底栏不重复。30 张截图（15/引擎）先于断言留证输出目录。一次
通过：--list 4 例后 4 passed 0 failed rc=0（47.5s 含栈启动；新 case
webkit 2.2s、chromium 2.4s）。前端 710/type-check 沿用 R30（src 未变）。
局限：Playwright 视口+UA/touch 仿真非真机键盘/安全区，本地合成数据。
栈清理核验通过（state/auth/shared 无残留、4 端口释放、本轮容器 0）；
不勾 Owner/Beta/CI/真机。

2026-10-22 聊天触摸尺寸与 AI 标识可读性修正（VC-R34）：composer
send/stop 按钮与末列 40→44px（DESIGN §9），头部 disclosure 10/14px→
12/18px 注释层（DESIGN §4.2 复用 --vc-text-xs），文案不变。前端 710
passed/type-check rc=0；08 layout --list 2 例后 2 passed 43.6s，30 截图
留 /tmp/vcr34；视口仿真非真机。栈清理核验通过（容器 0、4 端口释放、
state/auth/shared/secrets/iid 无残留）；不勾 Owner/Beta/CI/真机。

2026-10-22 Admin 旧退出确认的会话归属（VC-R39）：手机 390x844 原视口下
11 旅程先真实复现 R38 基线红——旧遮挡实为底栏 model-mobile-bar 与导航同层
（非 modal），抽屉改用既有 overlay/scrim 层级后点通，B GET 200 → 旧确认
logout 200 → B GET 401。AdminConsoleShell 在 confirmDiscardChanges 前捕获
transport 导出的 readCsrfCookie()（仅内存比较，不持久化/不打印），确认
返回后 CSRF 已变即撤销旧意图（不发 logout、不清本地身份、不导航）并以
role=status 提示「登录状态已更新，请重新确认退出」；同页二次确认正常退出
只撤 S1。前端 711 passed/type-check rc=0；11 --list 2 例后 2 passed 37.5s
（2.5s/1.3s）：撤销段 logout 请求 0 次且 B 保持 200，控制段 logout 200 →
A 回登录页 → B 401，磁盘共享 S0 不动；抽屉展开完成态 PNG（animations:
disabled）留 /tmp/vcr39。栈清理核验通过（容器 0、4 端口释放、
state/auth/shared/secrets/iid 无残留）。只收口确认前这一窗口：本地
credentialEpoch 仍不能感知另一标签页登录，其余请求侧 Cookie 时序未闭合；
视口仿真非真机；不勾 Owner/Beta/CI/真机，G12 维持未完成。

2026-10-22 完整现有核心 E2E 一次同绿（VC-R41）：无 file/project/grep
过滤，`--list` Total 18 tests in 10 files（LIST_RC 0）后一次跑完 18/18
PASS（18 passed/0 failed/0 flaky/0 skipped/0 not run；run.log 1.1m，
RUN_RC=0、ELAPSED=65s 含栈启动），3 projects＝chromium 12 + webkit-iphone
3 + chromium-android 3；配置 workers 1/retries 0/test 90s/expect 15s，CLI
trace off、output 指向 tmp。源输入 8c58a438（R40 17e8bd35 仅改独立 G12
driver，未改 app/E2E）；全程 E2E_RELEASE_MODE=full、OrbStack loopback
PG/MinIO 与 fake provider，本地合成数据与设备仿真，非真机/真实 provider/
生产验收。原始产物 /tmp/vcr41。栈清理核验通过（vc-e2e 命名容器/卷精确
查询 count 0、4 端口释放、owned 进程/state/auth/shared/secrets/iid/binary
无残留，42 份历史日志未动）；不勾 Owner/Beta/CI/真机，G12 维持未完成
（10 分钟 recovery/retained-stack/PSS 未补）。

2026-10-22 修复生产 MinIO 镜像获取失败（VC-R54，R50 只读决策落地）：
R19 确证 `ops/deploy/docker-compose.yml` 的 minio/minio 与 minio/mc 固定
tag@digest 在两个 registry 均实际不可取。新增生产封装 `ops/deploy/minio/`
（窄 context）：以 backend/Dockerfile 同一固定 `alpine:3.23.3@sha256` 为基座，
`ADD --checksum` 从 GitHub Release 固定获取与 R21 E2E scratch 镜像完全相同的
四份官方静态二进制校验值（minio RELEASE.2025-09-07T16-13-09Z、mc
RELEASE.2025-08-13T08-35-41Z，arm64/amd64 按 TARGETARCH 选 stage），入口分发
脚本让同一镜像服务 `minio`（server）与 `minio-init`；相同二进制新封装，不是
旧 OCI digest 复现，不换 vendor/版本/许可证。compose：两服务共用
`virtual-companion-minio:local` build 锚点，保留服务名/depends_on/命名卷/
credentials 变量/桶默认值；healthcheck 由缺失的 curl 改为 BusyBox wget 同
live 端点；minio-init 不再 `mc alias set`（root secret 曾在 argv），改为
镜像内 `minio-init.sh` 从环境读凭据、BusyBox awk 经 ENVIRON 做完整 JSON
转义（引号/反斜杠/换行/全部 C0 控制符）写入 compose tmpfs
`MC_CONFIG_DIR=/mc-config` 的 mc config v10（目录 0700、config.json 0600，
`MC_UPDATE=off`），桶创建与禁匿名校验语义不变；沿用旧官方 root 默认、不做
UID 迁移、不声明 VOLUME。验证（OrbStack linux/arm64）：新镜像真实构建
rc=0（11s），`minio --version`/`mc --version` 与既定版本一致；真实脚本函数在
镜像 BusyBox awk 下对含引号/反斜杠/CRLF/控制符/多字节值的转义经 python
JSON 解码往返一致；amd64 同 Dockerfile 真实构建 rc=0（20s）并在 Rosetta 下
两份 `--version` rc=0 版本一致。父以唯一 tag（vcr54-minio/companiond/caddy）
私有渲染 compose（127.0.0.1:18443→443 替换整份 ports、VC_HTTP_ORIGINS 含该
端口、绝对 build/db-init 路径）、私有 env 合成凭据、全新项目卷实际启动全链
DB→migrate→bootstrap→MinIO init→runtime healthy→Caddy，一次性任务 rc 全 0，
minio-init 仅输出 bucket created、secret 在 minio/minio-init 日志 0 命中、
Cmd=["minio-init"]；以本轮 Caddy 本地 CA 文件做真实证书链+hostname 验证
（无 -k）：/actuator/health 200 `{"status":"UP"}`、/api/v1/version 200、H5 壳
200 HTTP/2 no-cache；当前 Go 与当前 H5 产物按真实脚本构建。fixture 期间两处
非产品问题：合成 VC_CRYPTO_REST_KEY 须标准带填充 base64、渲染副本相对
`./db-init` 需绝对化（否则 runtime 角色缺失），均属 fixture 修正。独立只读
验证子（私有 project vcr54-credcheck、同镜像）7 项 PASS：含双引号+反斜杠
与含内嵌换行+制表符+单引号两组 secret（及含引号/反斜杠 access key，MinIO
实际接受）的新 init exit 0、桶 anonymous get 为 private、S3 put/cat 全字节一致、
Cmd/Entrypoint 与两容器日志凭据子串 0 命中、`HostConfig.Tmpfs` 含 /mc-config
且探针 stat 目录 700/配置 600、alias local 仅存在于私有配置；Root 追加的
防假绿见证——running 容器 `inspect --format '{{json .Config.Env}}'` 管道进
内存比较器，与按名传递的原始输入逐字节比对——ENV_EXACT_MATCH/USER/
PASSWORD 全 True（凭据与 base64 形态均不进 argv；首次执行因父提前删镜像
rc=125 阻塞，父同 Dockerfile 重建后完成）。两侧栈 down -v
后按 project label 核验容器/卷/网络 0、端口释放，四个本轮镜像 tag 已删，
留存日志（/tmp/vcr54/{smoke,credcheck}，600）凭据子串 0 命中。
`scripts/check.sh --quick` 与 `git diff --check` PASS；未重跑 Go/前端单测与
E2E（未改）。范围外事实：`infra/db/backup/run-restore-drill.sh` 与
`run-daily-backup.sh` 仍引用同一批不可得 minio/mc digest，未改、待单独处理；
amd64 生产部署未运行；MinIO 上游归档后维护与存储选型仍为 Owner 待决。

2026-10-22 常驻栈资源采集能力功能预检（VC-R57，G12 §19.1 B 边界，非采样）：以
ops/deploy 生产 Dockerfile/compose/Caddyfile 渲染私有 compose（project vcr57-probe、
合成凭据全新 DB、仅 Caddy 一枚 127.0.0.1:18446→443 TLS、init/migrate/bootstrap/runtime
同镜像），目标部署版本四组件（PG 0.8.5-pg18 digest、companiond、MinIO RELEASE.2025-09-07
本地封装、Caddy v2.11.7）up 全 healthy；init 三 one-shot exit 0，经 Caddy 内部 CA
（仅显式 --cacert）health/readiness 200 UP。PSS 探针：同版本镜像短命只读 reader
（--pid=container、--read-only、--network none、目标同实际 UID/GID、不同 cgroup、按
PID1 进程树过滤并排除 reader），4/4 组件 smaps_rollup 全可读 0 失败（db 12 进程
PSS 55082 kB vs RSS 173664 kB），默认权限即可（reader 无 SYS_PTRACE 亦成功）；
CPU 探针（子代理经 ~/.orbstack/run/docker.sock 只读 GET）：/version 200，
4 组件 stats one-shot 全 rc=200，total_usage 为容器启动以来累计纳秒，percpu 缺失
系 cgroup v2 规格，one-shot 无 precpu 差分，memory usage≠RSS/PSS，已退出 worker
是否计入属官方文档空白。十场景缺口与 A/B 同窗最小接入点（run.sh:300-308/334/341、
GO_BASE、expected-account=X-VC-Expected-Account-ID core.go:29）与全部结果见
`docs/planning/g12-go-capacity-sample.md` §8；S3/S4/S8/S9 缺失、S6 半缺、10 分钟窗
待补，G12 维持未完成、不冻结 Owner 门槛。fixture 事故如实记录：首轮渲染仅改顶层
project 致 4 个 volume 名仍为 deploy_*，被 Root 停止隔离，旧 7 容器按已捕获确切 CID
rm（rm rc0/验证 rc1）、旧 CID 探针结果一律 FIXTURE_INVALID；渲染修复为 volume/network
名称递归收窄本轮作用域后全探针重跑；4 枚 deploy_* 命名卷经 Root 以 up.log/up2.log 逐条
Creating/Created 与当前对象 label project=vcr57-probe、CreatedAt 12:11:32 双重证据核清
为本轮创建（非仅时间/前缀推断，非复用既有卷），随后由本轮 cleanup owner 逐卷复核
label/CreatedAt 同一与 daemon 引用 0 后按精确名称删除（四卷 rm rc0/inspect rc1/
ls count0）；R55 三枚未知归属卷仍独立为 UNVERIFIED，不与这 4 卷混称，亦不据此宣称
所有基线绝对未动。修正后 fixture down -v 并精确核验容器/四卷/网络
count0、三唯一镜像 tag 已删、端口释放、/tmp/vcr57 已删；纯文档改动仅
`git diff --check`，未跑无关 Go/前端/E2E。

2026-10-22 常驻栈同窗 A/B 采集接入与 --probe 功能验证（VC-R58，G12 §19.1，非采样）：
`scripts/measure/g12-go-capacity/run.sh` 测量对象改为 ops/deploy 生产派生常驻栈
（渲染 `-p` 收窄资源名+双重校验、唯一 trial tag、唯一 127.0.0.1:18447→443 TLS 口），
流量经 Caddy TLS，A=runtime PID1（observer 共享 netns 读 metrics + smaps_rollup）、
B=四组件容器 cgroup（Engine 累计 CPU + 逐进程 smaps 求和，reader/observer 独立
cgroup 不计 B）；缺进程记 PARTIAL、计数 reset/单端点记 invalid，不 clamp 成 0。
`--probe` 实测 PASS（FUNCTIONAL_ONLY：one-shot 全 exit0、TLS readiness、37 帧字段/
归属/排除/聚合、1gen+1SSE 全链路、provider 差分 1），无数值性能结论。独立子任务
实测 Engine 累计 CPU 对已退出 child **RETAINED**（CLK_TCK=100、下界 931 ticks、
退出后 19 采样恒 11,555,394,000 ns 零回落），B 侧 CPU 差分即覆盖退出 PG worker
语义。资源安全回归落实（R57 冻结名拒绝测试、预检失败零 Docker 写入实测、create
后即时清单、镜像 identity 基线比对 untag、禁 remove-orphans、down 后逐名 count0）。
默认档断言未减弱且 idle/recovery 默认改 600 s；NO_PERF 本轮未跑性能档，S3/S4/S8/S9
缺、S6 半缺、S1/S2/S7 待补，G12 维持未完成、不冻结 Owner 门槛；细节见
`docs/planning/g12-go-capacity-sample.md` §9。

2026-10-22 G12 夹具所有权收口与 CPU 采样窗口有效性（VC-R59，非采样）：R58 的
"预检空→up 后按 project label 收养"被复核否决，改为一次性 nonce 注入渲染 compose
全部 service/volume/network label 的 create receipt 所有权：`compose create
--build --no-recreate` 只创建不启动→立即记录 nonce 收据（容器/卷 driver+CreatedAt/
网络不可变 Id/已 build 镜像 Id，中途失败也记录）→启动门对照最终渲染配置核全量
服务（含 one-shot 与 fake-provider）、卷网与实际 Mounts 均有本轮收据（预期名被
外来者占用即拒绝 start）→`up -d --no-build --no-recreate` 只启动已证容器。清理
仅消费本轮记录、逐项身份校验（同名替代者保留）、消失证明只认 rc0 查询 count 0
（daemon 错误不判 gone、镜像"未 build"与"未知"区分）、EXIT trap 显式 exit 传播
清理失败并保留归属清单；输出目录原子独占拒绝重用/并发接管，tag 带 nonce 前缀
防共享 project 互覆；collector helper 改为 docker run 取 CID 后先持久化再
inspect。CPU 分析层交付显式 VALID/PARTIAL/INVALID（epoch=State.StartedAt 判同
CID 重启含 counter 上升型、缺帧/缺 epoch 至多 PARTIAL、sampled_at 为响应接收
时刻非 Engine read 时刻），scenario/probe/idle/soak 消费者按 status 断言与呈现。
单元 test_resources.py 27 例+test_collector.py 27 例全绿；最终单次真实 `--probe`
（vcg12c-vcr59-final、18448、FUNCTIONAL_ONLY）PASS rc=0：36/36 帧、1gen+1SSE、
provider 差分 1、CPU 四组件全 VALID，清理后独立 daemon 查询 project/nonce 对象、
卷、网、tag 全 count 0；另有中间验证 probe1 同 PASS 且核清。Root 终审后同范围
补齐三处：启动门拒绝 `{name, identity:None}`/nonce 不符的卷网 receipt（以 probe2
真实 receipt 重放验证）、capture 对 list→inspect 窗口内同名替换者记 unverified
不提升且 cleanup 输入边界拒绝 nonce 不符记录、reader/observer 写帧前 umask 077
（frames 不再 0644）、cleanup 的 required 回执缺失/不可读/坏 JSON 三态化记
unverified 非 0（已确认部分仍按 identity 清、原记录与 config 保留、显式空记录
与未知区分，纯 stub 负例验证 direct rc 与恢复记录保留；collectors 缺失可选仅
限 launch 未尝试，run.sh 调 launch 前落标记并传 --collectors-required，此后
missing 同样 unverified）；单元增至
test_resources 42+test_collector 27 全绿，正常
协议未变故未重跑 probe。G12 维持未完成、不冻结 Owner 门槛；细节见
`docs/planning/g12-go-capacity-sample.md` §10。

2026-10-22 S4 独立场景与真实首 delta 流式计时（VC-R60，G12 §19.1 场景4，非采样）：
`workload.py` Client.sse 弃用 resp.read() 全量读+字节占比伪指标，改为有界增量解析
（read1 逐块、帧按空行切分、注释/心跳行不产出事件、跨块重组），时间戳为事件所在
socket chunk 的接收时刻；live delta 规则按 realtime/hub.go 真实契约（订阅先收 catch-up
snapshot、终态前另有落库回放 snapshot+>16KiB 切片）：终态已到或第 2 枚 snapshot 已现时，
最后 snapshot 之后的 delta 为回放切片不计；中断尝试的 delta 保留。三基线显式：
from_send（POST 发出）/from_accept（202 返回）/from_subscribe（SSE 尝试起点），无
delta 留原因（failed/replay_only/terminal_without_delta/no_terminal/connect_failed）
不伪造 0；订阅/重试全程一个绝对 deadline：逐块检查、每次阻塞 read1 前把连接
socket timeout 重设为剩余预算（Root 复核实测旧缺陷：0.4s budget 下 burst 后静默
0.710s 才返回，因 read1 沿用连接时旧 timeout）、deadline 后收到的 chunk 整块
丢弃不解析（0.55s 过期终态旧实测 0.562s ok=True，修复后 ok=False），响应必关。
s4=1gen+1SSE 独立
scenario，probe 真实走 s4 分支；s4.summary 记录 fake provider 已知
holdMs+firstTokenMs 的 qualified adjusted 值（含 intake/claim/HTTP/SSE 订阅偏移，
非纯服务处理时间，不断言任何 ms 门槛，§19.2 仍 Owner 冻结）；coverage 以
catch-up snapshot 文本长度为证（0=先于首 delta 加入）。S5/S10/100turn/峰值/
反重放/600s 断言未削弱，未新增其他 scenario；Go/frontend/SQL/生产 compose 零改动，
fake_provider.mjs 零改动（stats 已含 config）。新增 test_workload.py 26 例
（脚本化流+假时钟+真实 socket 三类，含 Root 两例真实 deadline 回归与脚本化
过期 chunk 丢弃/settimeout 序列断言），deadline 修正后直接 rc=0 全绿；
test_collector 27+
test_resources 42 复跑全绿、bash -n/py_compile/git diff --check 过。deadline
修正的 TLS 路径未随本轮重跑 probe（Root 指示不重启；TLS/明文同为 sock.makefile
结构，下次真实运行自然覆盖）。最终单次真实
`--probe`（vcg12c-vcr60-probe1、18448、独立 OS 控制器 Popen rc=0/99.4s 未触
1200s deadline；首次尝试因控制器误预建输出目录被 run.sh 独占门拒绝，Docker 零
写入后修正重试）PASS rc=0：1gen+1SSE、provider 差分 1、37/37 帧完整、四组件
CPU 全 VALID、first_delta 三基线有效（from_send/accept/subscribe =
1022.3/1004.5/222.1 ms，live_deltas=8=chunks、joined_before_first_delta=1），
FUNCTIONAL_ONLY 不作性能结论。清理核清：project/nonce 容器卷网、trial tag、
18448 端口全部 rc0 count0，leftovers 空 `{}`、归属记录已删；控制器日志/记录
0600（写前 umask 077，Root 复核指出 0644 后修）。仍缺 S1/S2/S3/S6/
S7/S8/S9 与真实采样，G12 维持未完成、不冻结 Owner 门槛；细节见
`docs/planning/g12-go-capacity-sample.md` §11。

2026-10-22 S3 三路静默 SSE 场景接入与真实状态证明（VC-R61，G12 §19.1 场景3，非采样）：
场景语义按产品真实约束重定义并写入报告方法——SSE 绑定 generation，静默订阅只能是
**同一个等待 fake provider 的 generation 的 3 路已建立订阅**，非零 generation idle、
不改产品 API。`fake_provider.mjs` stats 最小新增 contentChunkWrites（实际写出内容
chunk 计数）；`workload.py` 新增 s3 场景（1gen+3SSE）、--sse-timeout 显式绝对
deadline（hold+20s 协调）与纯函数 observer_quiet_runs：静默采样单位为去重 observer
记录（Tailer 复用使 frame.ts 增长不是新鲜证据），仍有效重复记录去重不涨时长，
失效/缺失观测先断窗（Root 负例证实并修正：原实现去重先于 ok 检查会丢中间失效帧
拼假窗口；collector 真实可产生同 ts 缓存记录过期 ok=false）、坏样本不筛除不拼接、
ts 非严格递增同断窗、span 为 observer 跨度。`run.sh` provider_config_put 改
`compose exec -T fake-provider node`（归属已证容器内执行、有界 5s 超时、失败非零
退出，替代 Root 指出的无 receipt `docker run --rm` helper），holdMs 恢复闭环（Root
复验二轮修正）：原值在首次 PUT 前登记为待恢复状态（PUT 响应丢失/超时时服务端
可能已应用），正常路径恢复成功后清除，首 PUT 失败/watchdog/正常路径均有界尝试
恢复，cleanup EXIT 对仍 pending 的状态恰再做一次有界恢复（G12_KEEP=1 亦执行），
成功即清除不重复、失败保留非零并记录；run_scenario_s3 直接后台启动 python3（$! 即 python
进程，cleanup 按准确 PID TERM→有界→KILL→reap，不留孤儿），发起前边界 scrape 取
基线、窗口确立后窗口内边界 scrape、断窗/预算/退出三收束；默认 profile 于 s4 后
接入 s3 且既有断言全保留，新增 --probe-s3 短入口（仅 S3 链）。测试：test_workload
+9（含 Root 准确负例）共35、test_resources +4（cleanup 收割残留 workload；首 PUT
不可达替身三次恢复尝试 rc=1、首 PUT 响应丢失恢复恰一次不重复、pending EXIT 成功
一次+正常清除后零恢复——以 run.sh 文本提取真实函数经 bash -n 后驱动）共46、
test_collector 27 不变；bash -n/py_compile（run.sh 全部 heredoc 提取编译）/
node --check 过。单次真实 `--probe-s3`（vcg12c-vcr61-probe1、18448、独立控制器
umask077/独立进程组/真实 rc/1200s 未触）：rc=0、122.7s，静默窗口 5 个去重独立
observer 采样/跨度4.0s/内容写出全程==基线0，窗口内边界 scrape 证 subscribers=3/
gen=1/provider=1，3/3 SSE 收束、first delta 3 且全部先于首 delta 加入、provider
差分1、内容 chunk 差分8==配置、结束后 active/subscribers 全回0、A/B 同窗 A PID1
帧+8完整帧+四组件 CPU 全 VALID、errors=[]；量级自洽（stream 6707ms≈hold6000+
200+8×50）但 FUNCTIONAL_ONLY 不作性能结论。核清：project/nonce 容器卷网、三个
trial tag、18448、残留进程全 count0，leftovers 空{}，config set6000/restore0 有
记录。仍缺 S1/S2/S6/S7/S8/S9 与真实采样，G12 维持未完成、不冻结 Owner 门槛；
细节见 `docs/planning/g12-go-capacity-sample.md` §12。

2026-10-22 S6 取消与断线重连功能验证（VC-R62，G12 §19.1 S6 cancel/reconnect 两
子场景，非采样）：slow subscriber 仍明确未完成（现有 realtime 测试慢读者直连
hub，不证明 HTTP 慢读者，未用普通重连冒充）。`fake_provider.mjs` 按Root补充
增加客户端断开感知（close+writableEnded 区分、断开即停写该次 content chunks、
abortedStreamRequests/completedStreamRequests 分开计数，普通 close 永不算 abort；
本地实测 RST 与纯 FIN 均检测）。`workload.py` 提取 stream_events 共享帧读取
（bytes 精确计数保留、ended 结束原因；break 提前退出不设 ended 即主动关闭证据），
新增 subscribe_until_live_delta（首 live delta 后主动断开）、
subscribe_snapshot_terminal（终态后订阅持进程内全文）、
subscribe_cancel_after_first_delta（Root 复核修正：claim 前空流+EOF 同 deadline
重试、首 live delta 后 response 锁定、EOF/error 无取消终态即败不重连冒充；回调
异常 callback_error 上报不被吞；回调 snapshot/cancel 共享流 deadline 按剩余预算
设 timeout）、cancel 空 body 携带 CSRF（后端写路径强制 CSRF——probe1 实栈 403
暴露）与 run_scenario_s6（全文内存比较仅出布尔/长度）。`run.sh` run_scenario_s6
（deltaMs 临时加宽、S6_PENDING_RESTORE_DELTA 首次 PUT 前登记全路径恢复+cleanup
EXIT 恰一次有界重试；基线只读 config.deltaMs——Root 指出顶层双读必 NA 已修并
以真实 stats 形状验证解析/恢复值路径；断言 abort/completed 差分恰 1/1、chunks∈
(chunks,2*chunks)、请求差分恰2、worker/provider/subscribers 回 0、A/B 同窗帧与
四组件 CPU 有效性）；--probe-s6 短入口；default profile 于 s3 后接入 s6 且既有
断言全保留。测试：test_workload +12 共47（含 Root 精确 2-response claim 前竞态
正例、锁定流 EOF 不重连负例、回调异常上报、同长不同文本全文比较负例、stub 消费
真实 dict 形状与回调剩余预算断言）、新增 test_fake_provider.py 2 例（自然完成
计 completed、中途断开计 abort 且停写；须先 resp.close() 释放 buffered reader
fd 引用否则连接半开 fixture 正确地看不见）、test_resources 46/test_collector 27
不变；bash -n/23 heredoc 编译/node --check 过。首次实栈 probe-s6（vcr62-probe1）
rc=1 如实暴露 B 的 CSRF 403 被吞缺陷（A 全过），修复后其资源经 EXIT cleanup 完整
回收；单次成功实栈 `--probe-s6`（vcg12c-vcr62-probe2、18448、独立控制器 umask077/
独立进程组/真实 rc/1200s 未触）rc=0/95.8s：A 断线重订阅 chat.completed+7 live
delta、终态后 44 字符 snapshot 全文==唯一 assistant 消息、assistant=1；B 原连接
chat.cancelled 且 eof 收束、cancel 200/CANCELLED、前置 IN_PROGRESS、终态
CANCELLED、assistant=0；provider 请求差分2（aborted1/completed1、chunks9∈(8,16)
被取消流未写完）、worker/subscribers/provider active 全回0、deltaMs 400→50
set/restore 有记录、A/B 同窗 A PID1+10完整帧+四组件 CPU 全 VALID、errors=[]。
核清：project/nonce 容器卷网、三个 trial tag、18448、残留进程全 count0（两次
probe 均然）、leftovers 空{}；vc-g3、DT 18380/18581/18590/18591、KB 及他人项目
未触碰。S6 其余子场景（slow subscriber）、S1/S2/S7/S8/S9 与真实采样仍缺，G12
维持未完成、不冻结 Owner 门槛。Root 恢复验收后三项收尾（成功 probe 之后、未再
跑实栈）：回基线改有界真实状态等待（wait_s6_baseline 单一 monotonic 共享预算、
每次恰用同一次 collector scrape 取三值、每次调用 timeout=恰为剩余预算不放宽、
采样返回先判过期再接受零状态、慢 scrape 按本 Popen PGID 连同派生 docker CLI
整组 kill+有界收割、ended 移至 settle 确认后、30s 预算超时显式失败；两轮 Root
复核修正均落地：过期成功 1.27s 复现后重写、max(0.5,·) 放宽与生产 seam 否决后
收敛为无旁路单入口，测试以 run.sh 文本提取真实函数并把 $HERE 指向临时 stub
collector.py，覆盖延迟收束/永不收束/慢 scrape 被组杀且 pid 有界消失三路径）；test_fake_provider 去 SkipTest 改 Node 缺失明确
AssertionError；/tmp/vcr62 控制器超时路径改以整组收束为
清理条件（实际 PGID 探测判组存活、循环先 reap leader 防 zombie 占组，leader
被 reap 绝不代替组结束）：进程组 TERM（15s 有界等组）→组仍存活则组 KILL（10s
有界复核），leader_rc/group_cleared/unreaped 如实记录，真实调用显式携带
G12_TRIAL_ID/G12_HTTPS_PORT（vcr62-probe2/18448）不落默认；两个自测负例实测
（deadline 0.5s、TERM/KILL 各 0.3s）：leader-honors（Root 实跑负例——父响应
TERM 先退 rc=-15、同组子忽略 TERM 存活）TERM 后组仍存活→组 KILL→
group_cleared=True 无残留，all-ignore（全组忽略 TERM）TERM 无效→组 KILL→
rc=-9 组清无残留；成功 probe 未触超时不算已验证，两路径现均经实测、未重跑
实栈。收尾后仅重跑受影响检查：bash -n/24 heredoc 编译、
test_resources 49（46+3）、test_fake_provider 2；test_workload 47/test_collector
27 输入未变未重跑。Root 独立证据：回调预算 30→28→25 耗尽不发 cancel 且失败、
preclaim 重试/首 delta 锁定回放、config.deltaMs 解析、空 JSON cancel 携 CSRF 与
expected account 均通过；probe1/2 各 21 项 exact 查询 rc0/count0、leftovers={}。
细节见 `docs/planning/g12-go-capacity-sample.md` §13。

2026-10-22 真实 HTTP 慢订阅者隔离与退出 + UTF8 事件切分修复（VC-R63，Go httpapi/
realtime 层功能回归，非采样、非实栈）：行为——SSE 每次写与 Flush 前设 per-write
deadline（config.HTTP.SSEWriteTimeout 默认 10s，VC_HTTP_SSE_WRITE_TIMEOUT，>0 校验），
写成功后清除（provider 静默等待不继承过期期限），handler 退出前再设以保护收尾写；写与
Flush 错误经 statusRecorder 新增 FlushError 透传（ResponseController.Flush 否则命中
void Flush 吞错），错误即退出且 snapshot 失败不继续 terminal，覆盖 header/event/
committed snapshot/terminal/durable fallback 全部写路径。realtime/event.go fit() 由
逐字节重编码（转义文本 O(n²)）改为完整原串上 ClampUTF8+精确 encodedLen 判定的有界
二分（空前缀向右、超限向左、hi=min(len,max)）：单中文/emoji/é 不丢不乱码（Root 三轮
direct 回归：长 `<`、`🙂`×5000、短值三例均在坏候选红后修复绿），逐帧 UTF8 有效、JSON
解码重建全文一致、每帧≤16KiB、snapshot 首帧/delta 后续语义保持。真实 TCP 回归
TestRealHTTPSlowSubscriberIsolatedAndExits：慢客户端走 Server.Handler() 全链
（SO_RCVBUF 4096、包装既有 listener SetWriteBuffer 8KiB 失败直报）只读响应头，`<`
负载 6 倍线上放大（逻辑 200KiB<256KiB、单帧~6KiB<16KiB，不放宽生产上限）制造真实内核
回压，发布按 fast 实际帧进度步进；正常 live 流（hub 队列~126KiB 线上低于内核吸收点）
断言隔离与有界退出、可结束为 keep-alive Idle；真实受阻的 catch-up/durable 单流
~1.2MiB 必须由服务端关闭（严格 StateClosed），drain 仅认 EOF/ECONNRESET；健康流全文+
唯一 terminal 完整收束、subscriber 计数归零。有效红：HEAD HTTP 两文件（realtime.go/
server.go）Go -overlay 自然失败 2.62s rc1（观察仅支持有界窗口内未退出/连接未关）；
此前 throttledConn 人工 Write 等待被 SIGQUIT 强制的 173.5s 不算有效红。验证（
go1.27.1 darwin/arm64，go.mod 声明 1.26.7）：realtime/httpapi/config 三包与 race
最新 rc0（Root 冻结 overlay 七类实际输入×snapshot/delta 14 路径全过；16KiB 诊断
ASCII 356µs、`<` 文本 2.362ms，非性能采样/门槛）。边界：完成/commit 由测试 fixture
代行（非真实 provider/DB）；Caddy/H5 仅只读配置与代码事实（/api/* flush_interval -1
无第二层缓冲、10s deadline 无反证、H5 断开按普通重连由 chat.snapshot 替换语义收敛），
不构成实栈性能结论；G12 §19.1 S6 slow 实栈、G12 整体验收与 Owner gate 仍开放。

2026-10-22 物理备份/PITR 演练验证与清理收口（VC-R56）：前置完成 R55 记录两处
最小事实纠正——UNVERIFIED 三卷口径「不可恢复」改「已删除、未恢复」（未核验
Owner 备份/快照，不绝对化）、末尾「未动基线卷」改「无法证明上述 3 卷是否属于
基线」，其余历史实测保留。R55 已证 `--rm`+手动 `rm -f` 竞态会残留 PG 匿名卷且
run-restore-drill.sh 已修，本轮收口最后一个同源消费者 `run-backup-drill.sh`：
cleanup 两处 `docker rm -f` 最小补 `-v`（R53/R55 同源真实现象），阶段、断言与
退出码语义不变。验证：bash -n + git diff --check 后，以直接子进程父控制器
（/tmp/vcr56 0700、产物日志 0600、VC_DB_LOG_DIR/TMPDIR 显式其下、
DOCKER_CONTEXT=orbstack 不改全局、start_new_session 记录真实 PID/PGID=53446、
单调计时、900s 观察窗口仅超时才对本轮独立进程组 TERM→有界 KILL/reap）一次
真实跑完整现有两阶段入口（直接 rc=0、178.7s 自然结束，未触发窗口）：Phase A
全 135 迁移+种子→pg_dump -Fc 1033608B→备份后 dave 删除 digest-only manifest→
drop/recreate→pg_restore→墓碑 dry-run/apply 双命中→五类业务断言+RLS 01/02/70
对恢复库全 PASS；Phase B pg_basebackup 55113216B+5 个 WAL→全新容器
recovery.signal 回放归档 WAL→post-basebackup marker 行断言 PASS（ALL BACKUP
DRILL PHASES PASS）。自然 EXIT 清理验证：本轮实际两容器 3b4a64930bfd
（drill）/d9103d72d106（pitr）与各自匿名卷 30e8247f…/3feab618…（运行中
inspect Mounts 实录）在脚本自身 cleanup 后经 daemon 精确查询——容器
`ps -aq --filter id=` 与卷 `volume ls -q --filter name=` 均 rc0 且 count0、
inspect rc1——确认不存在，无需兜底 rm（自然清理 PASS）；未动任何既有卷/容器、
未 prune、未跑无关 Go/前端/E2E（两阶段通过后仅复核脚本语法+diff）。
范围外事实：amd64 未跑；WAL 归档生产落位与加密方式、RPO/RTO 复核仍为 Owner
待办。

2026-10-22 备份/恢复链 MinIO 客户端与凭据传输修复（VC-R55，R54 范围外事实
收口）：`run-daily-backup.sh` 的 MC_IMAGE_DEFAULT 与 `run-restore-drill.sh` 的
MINIO_IMAGE/MC_IMAGE 仍指 R19 已证不可取的旧 minio/mc digest；daily 本机分支用
`MC_HOST_local=<userinfo URL>`（secret 进 env 工具 argv 且保留字符未编码）、
Docker 分支与 restore `mc_with` 三行凭据文件 + 容器内 `mc alias set`（secret 进
mc 进程 argv），且拒收含 LF/CR 的有效凭据。修复：两脚本默认改用 R54
`virtual-companion-minio:local` 本地封装（restore 新增 `VC_RESTORE_DRILL_MINIO_IMAGE`
server 覆盖；`VC_BACKUP_MC_IMAGE` client 覆盖保留原语义，Docker 客户端统一
`--entrypoint mc`，标准 minio/mc 覆盖镜像与本地封装都兼容；server 仍走镜像
dispatcher `server /data`）；默认镜像本地缺失即 fail-fast 提示先
`docker compose build minio`（daily 退出 4 / drill 退出 7），绝不自动 pull/升级。
凭据传输改为新增共享 helper `mc_alias_config.py`（python3 标准库）：按名环境
变量读原值 → 私有单 alias mc config v10（0700 目录/0600 config.json，位于归档
工作树之外、退出即删），mc 经 `--config-dir` 读取；不再构造 userinfo URL、不再
`mc alias set`，本机分支 `env -u MC_HOST_local -u MC_CONFIG_DIR` 防继承覆盖，
`MC_UPDATE`/`MINIO_UPDATE` 显式 off；移除 LF/CR 单行拒收（JSON 转义保留原值）。
VCBAE1 加密格式、SQL 生产模型、退出码语义、7 天保留、MAC 先验后解、
reconcile-before-read 与两场景防复活不变；`infra/db/backup/README.md` 同步
（镜像前置/私有配置/退出 4 含默认镜像缺失）。验证（OrbStack，本轮唯一 tag
`vcr55-minio:local` 自 ops/deploy/minio 实构，minio/mc 版本与 R54 一致）：真实
mc 探针——config-v10-only alias 携含 quote/backslash/LF/CR 的 secret 完成
ready/mb/cp/cat 且内容逐字节一致，mc 自身初始化的 config v10 字段布局与 helper
一致（首次探针容器内误用 127.0.0.1 endpoint 且无单次超时，记 FIXTURE_INVALID，
不作产品结论）；主以直接子进程父控制器在稳定候选上一次通过完整
`run-restore-drill.sh` 14 阶段（直接 rc=0、实测 81s：全迁移+五类种子、两次
daily FULL（env passphrase/0600 keyfile）、三个 MAC 篡改/错密负例解密前拒绝、
drop→gate A dave 五类复活、manifest reconcile gate B 五类归零+COMPLETED 墓碑、
对象 gate C/C2/D/E 含 sha256 逐字节比对与墓碑前缀过滤、不可达 endpoint 退出 4
脱敏且备份目录不变、恢复后业务断言+RLS 01/02/70 全绿；父控制器为直接子进程
取真实 rc/耗时，但 900s 仅为轮询观察窗口（超窗只 TERM、无 KILL/reap，非硬
上限；该次 81s 自然结束未触发），后续长验证需实现真正进程组 TERM+KILL/reap）；
独立子以官方同版
Darwin mc（GitHub release 单二进制官方 sha256 核验，私有目录临时使用，不全局
安装）验证本机分支，两轮结论按凭据格式区分：attempt A（AK 含 CR/LF）是
该格式下的真实被拒——宿主 mc mb/cp/ls/stat 全 rc=1（Go net/http 拒绝含 CTL
的 SigV4 Authorization 头值）、daily 真实 fail-closed 退出 4，属真实负例证据
而非产品缺陷；attempt B（AK 仅 quote/backslash、SK 含 quote/backslash/LF/CR
的有效复杂凭据）mc 全 rc=0、FULL 备份直接 rc=0、解封解密展开后对象逐字节
一致、tar 无任何 mc 配置、日志与 ps 采样秘密 not-found、TMPDIR 无残留、自有
容器清理 count 0。明确口径：「JSON 能无损编码 CR/LF」≠「AK 可用于 HTTP
认证」——AK 字符范围受 S3 有效凭据/SigV4 头约束（R54 已证 MinIO 端接受、
secret 侧只参与签名不受此限）；helper/README/脚本头文案已按此收窄，helper
只承诺凭据不进 process argv（传输载体即调用方环境），不再声称对一切 ps/
环境读取形态不可见。清理（按实际查清范围）：本轮全部命名前缀容器精确查询
count 0、唯一镜像 tag 已删、私有明文（dump/object/mc 配置/passphrase/临时
native CLI）已清、留存日志无凭据子串；卷侧如实更正并留未决记录——我在
92d45fa7 提交前 84s 曾以「CreatedAt 当日窗口 + dangling 过滤」为据删除 3 枚
匿名卷（3a04b4ed…/8c187f52…/17de74f9…，destroy 事件与 rm 命令吻合），但该
依据不构成归属证据：本轮三枚 PG 容器卷经 Root daemon events 与子任务
fixture.log Mounts 记录分别证明为 be29bf3e…（drill PG23858，Root 精确删除）、
b80…（native PG29375）、fce8b775…（native PG31658），均不属于我删的 3 枚；
我删的 3 枚 create/mount 事件已滚出 256 事件环、无容器关联可证，归属记
**UNVERIFIED**（已删除、未恢复、不伪造归属、不再按时间窗口/悬空状态删除任何卷）；
Root 侧另证 drill PG 匿名卷 be29 曾在 `--rm`+手动 `rm -f` 竞态下残留
（引用查询 count0→volume rm rc0→复查 count0 由 Root 精确清除），据此 drill
cleanup 的 `docker rm -f` 最小补 `-v`（R53 同源真实现象），并以最小真实消费者
探针验证（真实创建同镜像 --rm PG→inspect
Mounts 捕获真实匿名卷→执行补丁后同一清理语义→容器 count0 且捕获卷精确查询
不存在，直接 rc=0）；b80/fce8 当前精确查询均不存在；未全局 prune、无法证明
上述 3 卷是否属于基线。范围外事实：amd64 侧本轮
未重跑；本机无全局 mc，生产本机分支需 Owner
安装 mc 或走 Docker 分支；launchd 装载仍由 Owner 手工执行。

2026-10-22 本地 E2E 清理补删匿名卷（VC-R53）：PG18 镜像自带匿名 VOLUME，
`docker rm -f` 不带 `-v` 时数据卷在每次 E2E 后残留累积（R52 收尾后 Root 以
Docker events 定位并已精确清除本轮遗留的那枚卷）。两条既有、supervisor PID
严格约束的删除路径改为 `docker rm -fv`：`scripts/dev/e2e-stack.sh` cleanup()
与 `frontend/e2e/global-teardown.ts` removeContainers()；KEEP/synthetic-eval
限制、进程归属校验与 secret 清理语义不变，MinIO scratch 镜像无 VOLUME，
`-v` 为无害 no-op。验证按真实消费者（非参数镜像单测）：主探针真实启动
e2e-stack.sh（隔离端口 18438/18088/55198/19098、私有 STATE 路径、full、
KEEP0、orbstack），PG 容器实际创建并捕获确切匿名卷后立即 TERM，
supervisor rc=130，容器/该卷/进程组/4 端口/state/auth/shared/secret/iid/
binary 按实际启动范围全清、`volume ls` 前后无新增残留（探针日志
/tmp/vcr53）；验证子以本机缓存同 digest 镜像 `docker create`（network
none、未启动）得到真实匿名卷、自有 sleep holder 为合法 supervisor PID，
node 22 直调真实 global-teardown 默认导出（rc=0、0.55s），holder 退出、
容器与确切卷删除、state 派生五文件清空。R52 20/20 历史按当时输入保留；
前端 vitest/vue-tsc 仅覆盖 `src/**`（不含 e2e/），该文件以真实入口探针为
准。不勾 Owner/Beta/CI/真机，G12 维持未完成（R46 trial2 HOLD/NOT_RUN）。

2026-10-22 跨 Tab 错账号操作收口（VC-R52，R51 审计 F1 选定修复落地）：
服务端 core 入口强制期望账号前置条件——认证核心写在任何业务 effects 前必须
携带 `X-VC-Expected-Account-ID` 且等于 cookie principal 账号（读带该头时比对；
身份发现 GET /auth/session 显式省略，公共登录/挑战流不要求该前置条件），缺失/
失配 409 + 新 catalog
错误码 `ACCOUNT_CONTEXT_CHANGED`，无业务 effects、无 Set-Cookie、不撤销新会话；
principal/RLS/current-password 仍以 cookie 为权限真源，头绝不选择 owner。前端
transport/authedFetch 在请求入口一次性捕获页面已知账号带头，精确 409 且代次
归属成立后先本地 `clear()` 作废旧身份探测与旧动作收尾、再以 omit 头发现当前
Cookie 身份（共享 `reconcileAccountContext` 入口接入全部 provider 站点），账号页
清旧表单并给出 role=status「登录状态已更新，请重新确认操作」、恢复后按真实
账号重载安全区，不 logout、不自动重放；E2E helpers 写请求同步绑定会话账号。
R49 的陈旧 A 提交不再创建 B 副本（E2E13 R48 用例由基线红转绿，并补齐拒收→
恢复到 B→用户重新确认成功的正向路径），B 服务端会话保持有效。既有消费者
（Go 测试 fixture、强制改密流程、无头资源读）按新契约更新，未在服务端放行
缺头写。验证：backend `go test ./...` 20 包 ok（含 4 个新回归：失配/缺头写拒
+store 见证、password/delete 预 effects 拒、强制改密流程保留、读三态）；前端
735 项测试与 type-check（含旧 A 探测不被恢复复用、旧 logout 不作废 B 恢复、
password/delete 不误显错密码、B 安全区重载且旧列表不回流等定向竞态回归）；
`scripts/check.sh` 14s PASS；无过滤核心 E2E `--list` 20 tests in 10 files 后
20/20 通过（1.9m；验收依据 Playwright 原始报告 20 passed 与
test-results/.last-run.json passed，Root 独立核对；R48 用例 webkit-iphone
19.9s / chromium-android 24.9s），R41 历史 18/18 记录按当时输入保留。G12 采样客户端固定绑定种子账号
（2000001，workload/run.sh），文档 §7 三次 CPU 数值改标 soak 负载窗并注明
recovery CPU 未采（R51 F2）；R46 trial2 维持 HOLD/NOT_RUN。真机浏览器跨 Tab
验证仍为 Owner 人工项；同账号重登的请求侧 Cookie 时序未闭合（R12/R15-R17
原范围，R52 只覆盖跨账号场景）。

2026-10-23 生产派生 TLS 全旅程（VC-R79～R84）：复用既有 20 条浏览器实例，
新增显式 E2E_STACK_KIND=tls 入口；每轮重建 H5、由生产 Compose 渲染独立合成
Go/PostgreSQL/MinIO/Caddy/provider 栈，按本轮 nonce、实际 CID 与挂载收据
启动和清理。先验证本轮 CA 证书链、localhost 主机名及实际 ALPN h2，再放行
浏览器；保留 Secure Cookie、真实 hash JS/CSS 的 MIME/gzip/immutable/安全头
与 SPA shell no-cache 断言。Caddy 静态路由修复实际 /assets/ 构建资源缓存；
生产 uni-h5 不注入 globalThis.uni，六个现有调用模块改取可被编译器识别的
六项 uni API，恢复导航、可信设备重登与后台未保存草稿确认窗；共享测试会话
在 hash-only 导航时才重新加载文档，避免沿用匿名 Store。启动器拒绝继承
VC_* 生产配置，pnpm 明确禁止可选 watcher 的安装脚本，依赖锁文件未变。
验证：首轮 TLS 15/20 定位上述生产差异，修后相同矩阵无过滤、无 skip、
retries=0 全部 20/20（chromium 12 / webkit-iphone 4 / chromium-android 4，
2.5m）；前端 746 项单测与 type-check、资源所有权 53 项、栈渲染 31 项、
TLS 启动器 6 项、仓库 quick 与界面机械扫描均通过。退出后的独立资源缺失
核验 rc=0、空清单，临时会话/合成配置/CA 清除、所有权收据保留。
仅本地合成数据；NO_PERF、真实 provider、Owner/Beta/真机/CI 门槛保持未验收。

2026-10-23 默认 HTTP 回归栈归属与异常收尾（VC-R86～R96）：启动器取消按
PID 拼接容器名预删和忽略删除失败的路径，复用现有 resources.py；PG 测试卷、
PG/MinIO/初始化容器与工具镜像按本轮 nonce、实际 CID、挂载及构建收据创建、
核验、回收。HTTP v4 状态记录 supervisor/三个宿主进程的 OS 启动时间，匹配
PID 与进程组后才发信号；旧 v2 缺少归属信息时保留并报错。状态首次原子独占
创建，已有 state/auth 不覆盖、不删除；日志给出状态和运行目录。移除本机旧
Go 1.26.7 的 PATH 硬编码，实际回归使用已有 Go 1.26.10 SDK，未改全局工具链。
实栈发现退出父进程尚未被上层回收时 kill(pid,0) 仍成功，原等待误判 110s；
真实 Z 态探针先复现超时、修后正常结束。synthetic-eval 进入时登记恢复义务，
只有验证回到 SYNTHETIC/eval=false 后解除；恢复失败时启动器被停止仍保留
进程、容器与记录。收尾兜底同步删除本轮已确认的编译产物和创建标记。
验证：HTTP 无过滤 20/20（3 projects，12/4/4，2.1m），最终 TLS 兼容定向
1/1（启动、真实 TLS/H2、静态交付及共享收尾）；前端 758 项与 type-check、
HTTP 生命周期 10 项通过。真实 KEEP 验证准入恢复与父进程 Z 态后的子组回收，
进程/容器/卷、本轮工具镜像标签与会话、编译产物均核清。隔离 DB 可逆故障注入证明
恢复被拒后停止启动器仍保留现场；同一函数修复后回收成功，独立资源缺失
核验空清单。R91 原失败保留原记录，其现场已按实际收据恢复回收，未改写为 PASS。
显式安全关闭入口与验证见下项。Owner/Beta/真机/真实 provider/性能与远端 CI
门槛保持原状。

2026-10-23 保留 HTTP 调试栈显式关闭（VC-R98～R101）：新增
scripts/dev/close-http-e2e-stack.mjs --state 入口，完整 HTTP v4 收据与实际容器
标签、初始化容器原始绑定目录核对后才执行准入恢复及收尾；只调用当前仓库
既有清理引擎，不执行状态文件指定的程序。正式评估仍要求 BETA/eval=true；
显式关闭独立处理已恢复 SYNTHETIC 的栈，无需先切回 BETA。归属不符、旧版、
不完整记录或恢复失败保持可见失败。验证：关闭逻辑 9 项、真实命令行 6 项，
前端全量 767 项与 type-check；三个独立真实 KEEP 栈均关闭并经独立资源
缺失核验确认空清单，进程、会话状态与本轮编译产物清除。覆盖普通 full、
恢复函数被可逆拒收后的现场保留与修复回收，以及正式收尾已恢复 SYNTHETIC
后直接关闭。首轮因 pnpm 本地依赖设置差异失败，原记录保留失败；其资源已
单独核验回收，冻结锁文件离线对齐后使用新一轮验证通过。Owner 门槛保持原状。

2026-10-23 生产二级页返回与共享收尾加载（VC-R103～R108）：uni-h5 生产
模式不暴露 globalThis.getCurrentPages，原返回逻辑因此无法识别单页栈，
直接打开或刷新陪伴设置后点击返回只会原地重载。改为编译器可注入的裸
getCurrentPages 标识符；无父页回所属 tab，有父页保持既有 navigateBack。
新增 14 返回旅程，以 iPhone/WebKit 与 Android/Chromium 两实例分别覆盖
陪伴设置、记忆管理、全部会话刷新后的返回及正常站内返回，并断言无整页重载。
生产 WebKit 基线实际 1 failed（仍停留陪伴设置），原失败记录保留；同轮发现
上一轮共享收尾中的 import.meta 无法由 Playwright CommonJS 转换加载，
路径定位移入 ESM 命令入口，再显式传入共享关闭函数，状态文件仍不能选择程序。
验证：前端 767 项、type-check、命令行 6 项通过；新生产 TLS 候选无过滤、
无 skip、retries=0 全部 22/22（12/5/5），正式收尾 framework errors=0、
独立资源缺失核验空清单。另用真实 full KEEP 栈确认命令入口解析的既有清理
引擎正常回收，伪造元数据程序未执行，本轮进程、会话与编译产物清除。
仅本地合成数据；Owner/Beta/真机/真实 provider/容量与远端 CI 门槛保持原状。

2026-10-23 同账号退出只读审计（VC-R110）：一主两只读子核对请求与服务端
链路后，Root 审查并要求撤回把“旧页面上的新点击”判为旧意图的建议。普通
退出在点击到 fetch 之间无现存 await 闸门，按当前 Cookie 撤销 S2 符合
现有 logout 契约；R39 的确认等待窗口已有保护。未新增 CSRF 快照拦截或
会话协议，未将全局请求侧时序开放边界标为完成。修订报告保存在本轮 ZCode
会话，未为无已证缺陷的普通点击行为修改生产代码。

2026-10-23 TLS 状态与恢复记录归属（VC-R111～R113）：启动器首次写 state
改为同目录私有临时文件加 os.link 原子独占，普通文件、符号链接或目录已
存在时在 daemon/build 前拒绝；仅实际取得 STATE_OWNED 后允许原子更新及
删除该轮 state/auth/shared。Python finally 仅删除本次创建的临时句柄，
移除旧的 .tmp.PID 删除；v3 契约、90s 收据引擎、KEEP 与失败保留语义保持。
正向生命周期 fixture 由真实 write_state 取得归属；恢复此前失效的继承
VC_* 隔离断言，并用临时故障注入证明它会拒绝，恢复后再验。旧脚本在三种
已有对象负例均 RED，修后本地 mock 生命周期 7 项、bash -n 与 diff-check
通过；只读子核对当前 Playwright 1.62.1 的 webServer 失败不会注册全局
teardown，所以未修改消费者。真实 TLS 单条既有导航/静态交付兼容探针
1/1，通过本轮 CA/主机名/ALPN h2 自证；framework errors=0，状态权限0600，
本轮 state/会话及私有合成配置清除，独立资源缺失核验空清单。仅合成数据，
Owner/Beta/真机/真实 provider/容量与远端 CI 门槛保持原状。

2026-10-23 聊天未确认提交与下一条草稿（VC-R115～R125）：页面保存原提交
快照，未确认结果时「重试原消息」仍发送原文并复用既有幂等键；用户后来写下、
编辑或清空的草稿不改变重试目标，正文完全相同的新草稿也不再被重试清空。
草稿消费按提交意图及失败回填归属区分；未编辑的自动回填原文成功重试后仍
清空，显式发送新草稿才消费它并使用新键。建会话失败不误取更早一轮 pending；
重开页/新对话按既有归属入口清快照，generation 重连/终态重试语义保持。
旧代码由真实请求体断言复现误发草稿、清空后入口消失，以及同文重试 2xx
成功后丢草稿；既有断言保留，修后前端 55 文件、774 项与
type-check 通过。生产 TLS 全套无过滤、无 skip、retries=0 全部 26/26
（chromium 12 / webkit-iphone 7 / chromium-android 7，164.4s）。
双引擎分别覆盖同文与不同文草稿：真实提交原请求后丢弃浏览器响应，重试
返回同一 generation、原文与键不变、原用户消息仅一条；成功重试后草稿仍在，
显式发送才新增用户消息并使用新键，服务端历史恰为两次明确提交各一条。
两移动视口的同文重试界面已查看、无横向溢出；framework errors=0，独立资源
缺失核验空清单，状态权限0600，本轮 state/会话及私有合成配置清除。仅本地
合成数据；Owner/Beta/真机/真实 provider/容量与远端 CI 门槛保持原状。

2026-10-23 G12 S9 登录与会话撤销并发（VC-R127～R130）：既有 runner
接入 `--probe-s9` 及完整 profile 的 S9，两个隔离合成账号经公开密码、
TOTP setup/confirm 与可信设备登录，验证并发登录/指定会话删除、越权 404、
因果有序的全部撤销，以及**同一个旧可信 Cookie**重新登录必须 TOTP、
不签新会话；原测量会话不受影响。workload 58 项、资源所有权 53 项、
`bash -n` 与 26 个 heredoc 编译通过。真实 TLS/PG 探针退出码0、98.2s、
22 次公开调用，并发请求区间实际重叠，provider 增量0、活动量回到0。
后续独立只读核清确认本轮8个业务容器、5个采集器、收据内卷/网络、3个
镜像标签均不存在，私有配置已清除。仅 FUNCTIONAL_ONLY；详见
`docs/planning/g12-go-capacity-sample.md` §14，G12/性能/Owner 与 Beta
门槛保持未关闭，未修改后端、契约或生产依赖。

2026-10-23 S6 验收口径校正（VC-R133）：已有 Go 真实 TCP 背压回归，
覆盖慢连接退出、正常订阅者隔离及退订；README 和测量摘要不再误写为
“仅直连 hub”。Caddy/TLS/真实进程部署链实测仍待完成；未实施超出当前
生产输出预算的大回复夹具，未修改生产参数或增加测试矩阵。详见 G12
采样记录 §15，未据此关闭 G12/Owner 门槛。

2026-10-23 G12 S8 流式崩溃恢复功能探针（VC-R140～R142）：既有 runner
接入 `--probe-s8`（FUNCTIONAL_ONLY 独立入口，默认 profile 不含 S8）：
公开链路取得首 live delta 后确认 DB CLAIMED/live lease、唯一 attempt
CREATED、无 assistant、provider 流在途（stream/active/chunks 各 1），
再 docker kill runtime 并显式重启同 CID，验证恢复协议在默认 claim 租约
270s 与恢复 tick 5s 下把原任务收敛为 FAILED_FINAL（snapshot
chat.failed/external-failed、事后 SSE chat.failed、assistant 0、attempt
ABANDONED_LATE、work_item FAILED/PROVIDER_OUTCOME_UNKNOWN），同会话独立
健康对照消息 chat.completed 且 COMPLETED、assistant 恰 1；provider 新旧
epoch 不跨进程差分，新 epoch 自健康检查前计数全 0 起算，终态
stream/completed 1、总请求 2。workload 67 项（含 9 个 S8）、资源所有权
53 项、`bash -n` 与 40 个 heredoc 编译通过；真实 OrbStack/TLS/PG 探针
退出码 0、349.8s，为唯一一次完整运行（此前 Root 启动包装在 Python 执行
前即因换行语法错误失败、未建栈，不计为试验）。清理后独立只读核清本轮
8 容器/4 卷/1 网络/3 镜像标签均不存在、leftovers 为空。探针仅覆盖
attempt-CREATED 崩溃点；claim-before-intent 与 SUCCEEDED-before-finalize、
S6 部署链慢读者、完整三次长窗容量与 Owner/Beta/真机/真实 provider 门槛
均未关闭。详见 `docs/planning/g12-go-capacity-sample.md` §16，未修改
后端、契约、生产参数或依赖。

2026-10-23 G12 S8 成功落库后崩溃恢复探针（VC-R145～R147）：既有 runner
接入 `--probe-s8-before-finalize`（FUNCTIONAL_ONLY 独立入口，默认 profile
不含 S8，复用 S8 生命周期并在 collector 启动前分支），由独立 crash helper
控制 generation 行锁把 worker 钉在 CREATED 阶段，实测观察到唯一 attempt
SUCCEEDED 独立提交、generation 仍 IN_PROGRESS 且 assistant NULL、job
CLAIMED 租约在效、同一 finalize worker 事务被控制 PID 行锁阻塞，provider
旧 epoch 已完成 1 流且 abort 0，此时 docker kill runtime（exit 137）。
身份核对在末次 SQL 前，以 max(query/xact/outcome age) 加 monotonic 往返
计时并取首/末读较早者截止，3.5s 保守窗且默认 DB 语句超时 5s 不变；本次
kill 返回时 outcome 年龄上界 0.454307s、未越窗，且先于控制锁释放完成；
2 条真实 psql 子进程 reap exit 0，控制 backend 已消失。恢复后 attempt 仍
恰 1 个且 SUCCEEDED，generation FAILED_FINAL 无 assistant，work_item
FAILED/CANDIDATE_LOST_AFTER_ATTEMPT 且无 Pending/Claimed；公开视图
original=FAILED_FINAL（fault external-failed、事后 SSE chat.failed、
assistant 0），同会话独立健康对照 chat.completed/COMPLETED/assistant 1，
且健康请求后 original 仍 FAILED_FINAL。旧 epoch stream 1/completed 1/
abort 0/active 0；同 CID runtime/provider 重启，真实 /proc/1/ns/net 由
net:[4026533613] 变为 net:[4026533713] 并重新一致，新 epoch 初始及
health 前计数全 0，health 后 stream 1/completed 1/abort 0/active 0、
总请求 2（含非流式调用，不写作总请求 1）；deltaMs 恢复 50。R146 真实
OrbStack/TLS/PG 探针退出码 0、344.59s；清理后按收据独立确认本轮 8 容器/
4 卷/1 网络/3 构建镜像标签全无，cleanup_leftovers={}、
private_files_remaining=[]、collector 从未启动，5 个用户保护文件字节与
测试运行代码输入/HEAD 均未变。最终本地验证：helper 单测 17 项 PASS
（真实本机 Popen 管道/selector/os.read/reap，覆盖身份慢、kill 晚、
max 3 年龄及首读 deadline 不被重置）、run.sh 清理集成 RunShStubTest
13 项 PASS（真实 shell 直系 helper 合作退出 6s 及 grandchild 回收，
TERM 宽限 16s）、`bash -n`、3 个 Python 源码与全部 42 个 run.sh Python
heredoc 编译、`git diff --check` 均 PASS；未重跑无关的 workload/
collector/provider 或全量 check，亦不把早期 54 项 resource 基线或本轮
17+13 写成当前完整 55 例全跑。本轮只关闭 C 点（SUCCEEDED-before-finalize）
功能缺口；A 点 claim-before-intent、S6 部署链 slow-reader、完整长窗三次
容量与 Owner/Beta/真机/真实 provider 仍开放，G12 不勾选、不冻结 Owner
门槛。详见 `docs/planning/g12-go-capacity-sample.md` §17。

2026-10-23 G12 S8 claim-before-intent 崩溃恢复探针（VC-R148～R150）：
既有 runner 接入 `--probe-s8-before-attempt`（FUNCTIONAL_ONLY 独立
入口，默认 profile 不含 S8，复用 S8 生命周期并在 collector 启动前
分支），由同一 crash helper（`s8_finalize_crash.py --crash-point
before-attempt`）在公开会话准备后、唯一公开 generation POST 前取得
`vc.attempt_intent` SHARE 表锁（pg_locks granted 实证），把唯一
companiond worker 的 prepare INSERT 钉在 RowExclusiveLock 未获准；
A 点不加宽 deltaMs、不注册 pending restore，恢复只用生产默认参数
（claim 租约 270s、恢复 tick 5s），run.sh 只读 DB 轮询等待默认租约
过期后重放并先固定恢复后状态，`s8-verify --s8-expect completed`
复核公开视图。R149 由 Root 经本项目 ZCode 终端实跑一次（trial
vcr149-mvkwdc27，HTTPS 18460）：真实 OrbStack/TLS/PG 探针退出码 0、
346.89s。崩溃门两次真实 SQL 均为原 gid/conv IN_PROGRESS、无
assistant、attempts=[]、job CLAIMED 租约在效，唯一 worker（PID 109）
被控制 backend（PID 146）阻塞、query_start 同为
2026-10-23T11:51:03.491795UTC；kill 窗按 max(query_age,xact_age) 加
读前 monotonic 往返、取首/末读较早者截止（3.5s 保守窗、DB 语句超时
5s 不变），kill 返回时事务年龄上界 0.473305s 且先于 ROLLBACK，
exact nonce 收据 CID exited 137/PID 0，2 条真实 psql（host 70421/
70424）reap exit 0、控制 backend 消失；helper 总 1.36122s、
lock→gate 0.51977s、hit→kill 0.42198s（仅门控事实，不作性能结论）；
deltaMs 全程 50 未加宽（delta_ms_set=null），旧 epoch baseline/门处/
事后 requests/stream/completed/abort/active/chunks 全 0。同 CID
runtime/provider 重启（PID 1318499→1319108/1318564→1319457），真实
/proc/1/ns/net 由 net:[4026533613] 变为 net:[4026533713] 并重新一致，
新 epoch 初始计数全 0。默认租约恢复后只读断言通过：原 gid 恰 1 个
SUCCEEDED attempt、generation COMPLETED 且 assistant 非空、work_item
DONE、无 PENDING/CLAIMED 残留；公开视图 original COMPLETED（事后 SSE
chat.completed、assistant 1），独立健康对照消息自身 COMPLETED、
assistant 2，health 之后 original 仍 COMPLETED；新 epoch health 前
stream/completed 1、abort 0/active 0/chunks 8、总请求 2（含非流式
调用），health 后 stream/completed 2、abort 0/active 0/chunks 16、
总请求 4，无重复模型流式调用。清理后按收据独立核清本轮 8 容器/
4 卷/1 网络/3 构建镜像标签均不存在（verify_absent=[]）、
cleanup_leftovers={}、private_files_remaining=[]、collectors 0（从未
启动）；Root 另确认 controller 69996/probe 70001/两条 psql 进程全不
在、own shell 无子进程、18460 无 listener，5 个用户保护文件与
run.sh/helper/workload 运行输入字节和 HEAD（6d4beedc）均未变。最终
本地验证：helper 29 项 PASS（C 点原 17 + A 点新增 12）、workload
72 项 PASS、resources 57 项 PASS、`bash -n`、5 个相关 Python 源码与
全部 43 个 run.sh Python heredoc 编译、`git diff --check` 通过；
run.sh Python 式裸字符串续行 Bash 错误已修复，RunShStubTest 增加
真实 Bash A/B/C 元数据三分支执行，向临时副本注入旧坏写法后回归以
rc127 command-not-found 失败证明可抓原缺陷，未删/skip 或放宽原 B/C
失败断言。本轮只关闭 A 点（claim-before-intent）功能缺口，单次 A
运行不构成整套 S8 矩阵、完整资源容量或 G12 验收通过；S6 部署链
slow-reader、完整长窗三次容量与 Owner/Beta/真机/真实 provider 仍
开放，G12 不勾选、不冻结 Owner 门槛。详见
`docs/planning/g12-go-capacity-sample.md` §18。

2026-10-23 G12 S6 部署链慢读预检与文档收口（VC-R151～R155）：R151/R152
两轮 INCONCLUSIVE 保留（R151 观测只读 `/proc/net/tcp` 漏 IPv4-mapped
tcp6；R152 双表修正后"唯一连接才启动"假设被 Caddy keepalive 池连接
否定）；R153 改为慢客户端在同一条 SSE 上直接读取首个真实 live delta
后停读（拒绝终态 snapshot 续片冒充 live、live 后不换连接；定向 12 项
与双栈解析 15 项小例分别通过）。R154 以冻结候选单次实跑（trial
vcr154-20261023T134323Z，HTTPS 18463，exit 1/233.2s）：生产预算未改，
8192 逻辑字符=2048 输出 token 估算、2048 片×10ms、provider wire
254274B≤256KiB；慢订阅 3.752s 取得自身首 live 后停读
（same_response/same_socket/still_suspended/frames_unchanged 全真），
同 gid 健康读者空 catchup、3.754s 首 delta、29.24s 恰一次
chat.completed，live/replay/post-terminal 三份 8192 文本与唯一
committed assistant 全相等；provider 总 requests 3（含 2 次非流式
调用），其中 stream/completed 各 1、abort/active 0、chunks 2048，
worker/subscribers 回 baseline 0；健康读者 29.24s 完成，慢连接保持
停读至约 110s 观测窗结束。
95 份有效样本 `vc_realtime_slow_disconnect_total` 原值全 0.000000000
（实际增量 0，判定 NOT_TRIGGERED；汇总 metrics_diff=null 是私有 int
解析小数字符串的展示缺陷，非缺采）；缓冲吸收仅为解释假设，无各层
buffer 实测；handler 退出 UNPROVEN。清理核清 8 容器/4 卷/1 网络/3
构建标签 absent、leftovers {}、敏感 env/CA/compose 已删、子进程/端口
释放、9 输入原字节与 HEAD（a4762556）未变。三次长窗容量授权待人类
回复；G12、S6 保护触发/handler、Owner/Beta/真机/真实 provider 仍开放
不勾。详见 `docs/planning/g12-go-capacity-sample.md` §19。

2026-10-24 登录链弱网时限与会话前置（VC-R165/R166/R167/R168/R169）：
R165 logout 15s 总时限（复用 transport timeoutMs）；R166 登录主链四等待
点同款时限、二维码失败如实可重试（仅 challenge-unavailable 进失效）、
VcAuthField/VcTotpCodeInput 修复 uni 100ms 节流窗口下的旧值提交（blur/
confirm 先同步）；R168 单 store loginFlowSeq 作废迟到登录/挑战结果（页面
seq 守卫+模式切换/卸载仅作废本页流程）。R169 会话级前置：身份响应新增
REQUIRED 非凭据 sessionId，core 写强制 X-VC-Expected-Session-ID 且匹配
（读有则匹配），同账号 relogin 后旧页写 409 并经既有 reconcile 恢复；
GET persist 发现同账号新会话推进 credentialEpoch+loginFlowSeq。不覆盖
已发出旧 Cookie 请求排序与 unauth 登录 Set-Cookie 竞争；H5/API 需一起
更新、旧缓存需刷新。验收与边界见 README「当前状态/工程待核」。

2026-10-24 S6 应用处理函数返回证据补齐（VC-R156/R160/R161）：私有探针按
收尾前完成计数严格对账全部订阅请求，发送结果不明则保持 UNPROVEN；
R160 发送失败红例有 2 条新增断言失败，修复后 49 项定向断言和编译检查
均 exit 0。R161 单次真实部署短预检（vcr161-20261024t083236z，HTTPS
18464，冻结 HEAD 66b4180d，exit 1/183.0s）保持 R154 预算形状与生产
参数：计数 0+慢 4 次+健康 6 次=10，无归属不明，两条 live 流的应用
handler 均已返回；TCP 关闭及 net/http goroutine 退出未证明。慢读者同
响应停读，健康读者恰一次 completed、三份 8192 文本等于唯一持久化
回复；98 份有效样本 drop 增量仍 0，整体 NOT_TRIGGERED。清理核清，
9 输入原字节及 HEAD 未变。S6 保护触发、G12、Owner/Beta/真机/真实
provider 仍开放；三次完整长窗容量仍待人类授权。新事实见
`docs/planning/g12-go-capacity-sample.md` §20，R154 历史记录保留。

验证证据见 README「当前状态」。2026-09-06 批次 N-00～N-08 的逐项状态与
验收仍以对账记录为准，不按提交名回溯勾选。项目仍未达公开生产可发布条件；
provider 条款/revision/费用外发、真实用户 Beta 前置、真机 IME 与无障碍等
Owner 人工项见下文对应条目（DOGFOOD/`READY_FOR_OWNER` 均保持原状）。
CI 远端运行 NOT_RUN（CI 仅由 `main` 触发；工作分支已推送但不触发 CI）。
本文件其余条目维持原状。验证以本地入口为准（`bash scripts/check.sh`、
`infra/db/` 隔离脚本、定向 Vitest）。

## 2026-09-06 修复轮状态（历史快照）

当时基线 HEAD `02c1fe91367b015443ec059264fd4d5273691ca0`。授权批次
N-00～N-08（对应评审发现 F-01～F-08）为在途修复，逐项状态与验收以对账
记录为准。

产品待办（现状声明见 README）：

## Go companion runtime（ADR-0007，2026-08-30 起）

实施基线：`docs/planning/2026-08-30-go-companion-runtime-redesign.md`。一次一个可验证 slice。

      2026-10-29 Owner 表示也要在手机上使用，部署由 Codex 执行；方案见 `docs/planning/2026-10-29-v2-deploy-plan.md`（执行前 Owner 确认目标主机与访问方式）。
- [x] `G0` ADR/Catalog/OpenAPI scope 与 API consumer matrix（catalog/openapi check；不写 Go 业务代码）
- [x] `G1` 旧后端资源/事务基线与 benchmark workload（历史报告：`docs/planning/g1-java-resource-baseline.md`；不再复跑）
- [x] `G2` Go module、config、health、logging、metrics、shutdown、`api-migration/full` 硬隔离（unit/check；migration 模式无法启动 provider/jobs；不含 DB 业务 API）
- [x] `G3` pgx owner-bound 短事务、RLS/least-privilege、crypto（BCrypt、owner HMAC、enc1/enc2）与历史数据兼容向量
- [x] `G4` OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 三协议 provider adapter（本地 mock contract；Fake/Failure 仅为测试 fixture；不含 real provider shadow、Companion Core 或真实外网调用）
- [x] `G5` Companion Core、Context、Persona、Safety、Budget（unit/Golden Set；不含 tools、memory write、RealtimeHub/SSE、业务 HTTP API、真实 provider 外网调用）
- [x] `G6` RealtimeHub 与 authenticated SSE（fan-out/reconnect/leak；同源 HttpOnly cookie + Origin；无 ticket 兼容层、无业务 CRUD API、无 Memory/Consent、无真实外网 provider）
- [x] `G7` Relationship/Conversation/Message core API（OpenAPI KEEP 最小面；隔离 PostgreSQL E2E；api-migration 写路由硬禁；不含 generation plane、Memory/Consent、opaque auth 生产切换）
- [x] `G8` Memory/Consent/Report/Data rights（OpenAPI KEEP 最小面；隔离 PostgreSQL lifecycle/RLS/E2E；无 auto-save/semantic platform；api-migration 写路由硬禁；不含 opaque auth 生产切换、jobs/generation worker）
- [x] `G9` Opaque Auth + H5 transport 实现和离线验证（session/CSRF/reauth E2E 对隔离 PostgreSQL；api-migration 不启用 opaque 生产切换；不含 JWT/opaque 双 issuer、generation worker、Phase 5 切流）
- [x] `G10` Jobs、generation worker、finalize/cancel/provider integration（V117 additive migration + go_* 函数族：intake/claim/attempt outcome/billing reservation/finalize/terminalize/cancel/queue timeout/§16.2.1 恢复协议；loop/scheduler/export handler；隔离 PostgreSQL contract 测试 + httpapi E2E：send→202→claim→fake provider→hub snapshot/delta/completed→durable snapshot、cancel-during-stream、outstanding 429+Retry-After；realtime-events 补 chat.snapshot；send 202/Retry-After 2/配置默认 1·8·5min 对齐 §19.5；jobs claim/recovery 指标）
- [x] `G11` Auth/H5 + generation plane maintenance/drain/cutover/rollback rehearsal（17/17 PASS；演练工具在 G13 完成后退役，切流事实见 ADR-0008）
- [ ] `G12` Resource/capacity 验收与 Go-only dogfood（三次独立 runtime-only 测量均 PASS（2026-08-30，60s idle 口径）：idle RSS 18.894–19.631 MiB、16gen+64SSE 实际并发峰值 16/16 且零错误；管理员三协议 provider/model 配置与有界主备链已就绪；2026-10-21 Go image 已实测：linux/arm64 inspect.Size（packed resources）9,401,540 bytes ≈ 8.97 MiB、USER vc，api-migration 空依赖 `--network none` 隔离容器 health 200/UP，属 package 启动验证非 full DB/MinIO/TLS 验收；报告与候选门槛见 `docs/planning/g12-go-capacity-sample.md`。2026-10-22 已按 §19.1 场景 2 补三次独立 600s ready-idle runtime-only 测量：idle RSS 21.022–22.168 MiB、16gen+64SSE 峰值 16/16 零错误（VC-R35，见同文档 §7）。仍待 Owner 冻结 runtime gate，并补齐 10 分钟 recovery、retained-stack 与 real-provider dogfood）
- [x] `G13` 默认部署完成 Go-only 切流：旧 runtime 停止，V119 已应用，
      `companiond full` 接管常驻流量；Compose/镜像/CI/部署文档切到 Go，真实环境
      health、version、opaque login、ADMIN provider list 均返回 200；SQL 真源迁入 Go，
      旧后端源码、构建工具、生成物和运行脚本已经全部移除。

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

### 2026-08-24 Owner-only 本地 7 天 Dogfood（2026-10-27 起冻结，见 ADR-0009）

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
- [ ] `DOGFOOD-11` `READY_FOR_OWNER`（代码侧 IME Enter/229 composition 守卫与
      流式导航等待态已落地，合成 composition 事件与桌面模拟验证不代替真机）：
      真机中文输入法验证——候选词确认路径不误触发送、Enter 语义符合预期、
      软键盘弹起不遮挡聊天输入区与最新消息；未经 Owner 真机实测不得标记
      完成。
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

## 2026-08-24 S0 本地技术收口验证（历史，已由 Go-only G13 替代）

- [x] 旧后端当时的全量验证曾 PASS；对应构建链和源码现已退役并删除。
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
