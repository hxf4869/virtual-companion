# DR2 独立审计与 T12 视觉终审（Claude）

- 审计者：Claude Opus 5.5，单代理，2026-11-05 开始
- 工作区：`/Users/hxf/projects/virtual-companion-desktop-rebuild`，分支 `desktop-react-rebuild`
- HEAD：`bb0d63475d50e1f3bef4be780dfda05762dbb29a`（与预期一致）；开始时工作区干净
- 不沿用 Ubuntu2 未完成审计的结论
- 依据：AGENTS.override.md、AGENTS.md（本分支版本，含「前端组件、布局与视觉验收」节）、
  `docs/superpowers/specs/2026-11-04-desktop-react-rebuild-design.md`、
  `docs/superpowers/plans/2026-11-04-desktop-react-rebuild.md`、`.review-queue/DR2/NOTES.md`、DESIGN.md

## 环境说明

- `integrations/sillytavern/node_modules` 与 `upstream` 是指向
  `~/.codex/worktrees/desktop-independent-frontend/...` 的软链接；该 node_modules 缺少 DR2 新依赖
  （`@tanstack/*`、`vitest`、`zustand` 等），在审计工作区原地无法构建/测试。
- 处理：`git archive HEAD` 导出到 `/tmp/vc-dr2-audit/src` 独立安装依赖后验证，不修改审计工作区与其他 worktree；审计结束已删除该目录，受管容器由场景自动移除，无残留。

## 进度

| 阶段 | 状态 |
|---|---|
| 0 版本与规则核对 | 完成 |
| 1 构建/类型/组件/离线测试 | 完成（见检查表） |
| 2 代码审计 | 完成（定向）：会话/卡片/桥接/叶子挂载/壳层断点/设计组件/图标/类名覆盖/角色/记忆/剧情/设置/酒馆接线；B7–B15 只核对接线与测试存在，未逐行审 |
| 3 截图逐张终审 | 完成：169/169 已逐张查看（21 组 ×8 + 22 ×1，文件清单已核对）；结论见上表 |
| 4 浏览器运行时验证 | 完成（部分）：只读探针确认 F1/F2/F12/F17/F23；F22 根因未测到（E3） |
| 5 结论 | 完成：**FAIL** |

## 截图逐张记录（已读 ≠ 通过）

| 组 | 已读 | 结论 | 备注 |
|---|---|---|---|
| 02 chat-active ×8 | 8/8 | FAIL | F1、F2；390 宽标题按钮与搜索/档案按钮互相重叠（F1 无尺寸约束）；底部「1月1日 20:00」日期条悬浮在最后一条消息之后（F7）；用户/角色气泡为灰：对照 DESIGN §4 桌面 bubble-user #ededf0/#2c2c2e，**符合**（§17 accent 气泡属手机主题）；1920 角色面板动作行为原生按钮 |
| 03 chat-streaming ×8 | 8/8 | FAIL | F1、F2：流式中 `#mes_stop` 只剩蓝色圆、无停止图标，与发送键不可区分；1920 深色第 7 条回复文本在气泡内与气泡下方各出现一次（F5）；「正在回复…」条与日期条在 390 深色重叠（F7） |
| 04 chat-card ×8 | 8/8 | FAIL | 复杂卡 iframe 与 MVU 状态正常可见（正确）；F1、F2；390 浅色两条 toastr 默认绿色提示覆盖标题栏与首条消息（F9）；390 深色标题与搜索/档案按钮挤压重叠；「重新处理变量」卡片按钮贴在输入区上缘、左侧溢出面板圆角（F10）；1920 右栏动作为原生按钮 |
| 05 characters-grid ×8 | 8/8 | FAIL | 网格、导入/新建按钮、搜索、长名省略与卡片 token 正常；面板为不透明画布色（F11，深色纯黑最明显）；侧栏收起按钮 F1/F2；1920 网格未铺满（卡片约 250px，右侧留白，minor，未列缺陷） |
| 06 characters-detail ×8 | 8/8 | FAIL | 1440/1920 明暗：详情面板落入网格第二行（F12）；390/1024 明暗：覆盖层正常（1024 覆盖层遮住第二列卡片属设计「窄档浮层」）；「关闭」为纯文字按钮可接受 |
| 07 characters-wizard ×8 | 8/8 | FAIL | 向导 1/7 内容、遮罩、明暗、按钮态正常；右上关闭钮空白（F2）；字段标签「她的名字」与输入框同一行、「性别」单独一行，排版不一致（minor）；390 Dialog 宽度 min(设定宽,100vw-32) 正常；1024/1440 明暗 Dialog 玻璃几乎透明、底下卡片文字透出影响可读性，1920 则基本不透明——疑似 backdrop-filter 在不同宽度下的渲染/叠层差异，**未定性，需运行时复核**（列入证据不足） |
| 08 memory-timeline ×8 | 8/8 | FAIL | 三栏 240/720/320、长摘要换行、筛选 chip 明暗正常；F1/F2 侧栏按钮；1024 明暗：详情栏按 `@container ≤1080` 换到第二行，首屏底部截断属正常滚动（09-1024 截图已滚到详情，证实可滚动，**撤销**疑点）；1920 内容 max-width 1320 居中，左侧大片留白（minor） |
| 09 memory-detail ×8 | 8/8 | 有条件通过 | 1440 与 08 同画面（08 时已默认选中首条）；1024 滚动至详情，详情全宽、操作按钮可达、长文本换行正常；无新增问题（仅侧栏 F1/F2）；390/1920 与时间线同构，长文本换行正常 |
| 10 memory-diary ×8 | 8/8 | FAIL | 日记空态与月份条明暗正常；空态图标框为空（`book` 不在 sprite，F2）；1440/1024 日期条横向截断（31 日之后被裁，设计上横向滚动，可接受）；390：月份标题「11 月」被挤成两行、「下一月」与「Aa 手写体」相互挤压并右溢（F14） |
| 11 inbox ×8 | 8/8 | FAIL | 策略表单、通知渠道、投递状态、明暗、开关与分段控件正常；空态图标框为空（F2 inbox/clock 等）；390：静默三列不换行，标签断成「静默开/始」、值被截为「23:0」「Asia/」，收件箱分段文字两行挤压（F15）；1920 内容居中、左侧留白（minor） |
| 12 story-list ×8 | 8/8 | FAIL | 案件卡、五步向导、明暗正常；「打开模型设置」原生方角按钮（F16）；面板为不透明画布色（F11）；页标题为 17px 带分隔线的导航栏，与角色/记忆页 28/700 标题不一致（minor，记录不列缺陷）；390 案件标题「失踪的怀/表」断行可接受 |
| 13 story-stage ×8 | 8/8 | FAIL | 舞台标题、NPC、开场白卡与行动栏出现；顶部多一行可见的 `vc-sr` 案件名（F17）；「打开模型设置」「选择陪伴入局」原生方角按钮、标题栏关闭/历史为原生描边方块（F16/F17）；面板不透明（F11）；390 标题「雨夜旅馆 / 调查中」四行断行，开场白卡被行动栏遮住下半（滚动内容，可接受）；1024/1920 同构；**设计 §9 的案件卡 24 圆角、NPC 头像 64 打光、证物 150×86 翻面、线索墙等舞台视觉均未出现（ClueWall 被 `vc-sr` 隐藏意图却显示为纯列表，未见证物）**——舞台基本为未上皮肤的文档流 |
| 14 settings-model ×8 | 8/8 | 有条件通过 | 分类列 240、图标块、供应商列表、表单行、单选卡与明暗均正常，是目前最接近设计的页面；仅侧栏收起钮 F1/F2；1920 内容 max 760 居中致左侧约 320px 空白（minor）；「酒馆设置」组标题左缘比条目图标左缘外凸 12px（minor）；390/1024 分类收为标题左侧齿轮按钮，可接受 |
| 15 settings-voice ×8 | 8/8 | FAIL | 全部尺寸：表单行错列、双标题、原生 select/details（F18）；「聊天语音可用」等行未见开关（`VoiceForm.tsx:52` 渲染 toggle，截图中不可见，是否被隐藏需运行时确认，列 E2）；保存按钮禁用态正常 |
| 16 settings-appearance ×8 | 8/8 | 有条件通过 | 明暗主题选中态与实际主题一致、开关与分段可读；开关居中于控件列，而分段左对齐且轨道拉满整列、选项只占左侧（F19，低）；仅侧栏 F1/F2 |
| 17 tavern-reply ×8 | 8/8 | FAIL | 参数表单行、滑块+数值、开关明暗正常；左栏导航与产品设置不一致（F20）；顶部「输出上限」行被粘性标题压住半截（滚动位置，minor）；390 标题省略为「AI 回…」可接受；原生 select（详细程度、回复预设）；1920 预设按钮行中「导入」无按钮底，与相邻胶囊不一致（minor，疑为 label+file input 未套皮肤） |
| 18 tavern-world ×8 | 8/8 | 有条件通过 | 超长条目名换行不撑破、复选框 18px 与命中区、表单行与明暗正常；「导入」无按钮底（与 17 同，F21）；危险按钮「删除世界书」常态即实色红，按 DESIGN 危险操作一般为红字灰底（minor，待对照旧实现）；左栏 F20 |
| 19 overlay-menu ×8 | 8/8 | FAIL | 菜单锚定消息工具「…」、在视口内、分组与危险项红字正常；表情快捷行为原生方框按钮（F17）；菜单底下的消息文字清晰透出、几乎无模糊（`.vc-menu` 声明 glass-3 .82 + blur 40，见 E1，扩展为所有弹层）；390 菜单覆盖到侧栏上方，仍在视口内，可接受；1920 右侧角色面板：关闭钮为拉满整行的原生空白条（F1/F2/F4），「声音/记忆/设置」为原生描边小方块 + 文字（F17 `vc-circle`），面板头像与名字正常；已停止状态条为整宽原生灰条（F6） |
| 20 overlay-confirm ×8 | 8/8 | FAIL | 未保存离开保护按真实编辑触发（正确）、按钮主次与危险色正确、居中、遮罩明暗正常；警示图标圈为空（F2 `alert`）；对话框透出底层文字（F22）；390 宽 min(设定宽,100vw-32) 正常 |
| 21 overlay-conflict ×8 | 8/8 | FAIL | 真实 F2 409：冲突弹层出现、草稿保留在输入框与会话行「[草稿]」、notice 条文案正确（功能正确）；弹层透出后方消息（F22）；标题与正文、按钮行之间多一条分隔线贴住文字、正文与弹层左缘无内边距对齐问题（minor）；F1/F2 |
| 22 reduced motion+transparency ×1 | 1/1 | 有条件通过 | 玻璃变不透明、极光静止降亮度，符合 Review Focus 4；文字对比可读；仍带 F1/F2 |
| 01 chat-empty ×8 | 8/8 | FAIL | 全部带 F1（原生按钮）、F2（左上与标题栏空白图标、发送键无箭头）、F3（「选」头像）；1920 宽档角色面板只有一个被拉满整行的原生关闭按钮（F1 + F4）。布局分栏、明暗配色、长名省略正常；390 为列表态正确 |

## 已确认正确

- 版本：HEAD `bb0d6347`、分支 `desktop-react-rebuild`、开始时工作区干净，与预期一致；169 张主截图文件清单 = 21 组×8 + 1。
- 构建与测试：tsc、双构建、Vitest 118/118、离线 1097/1097 均通过；`dr2-layout`、`dr2-settings`、`dr2-mvu-new` 受管场景在独立环境复跑通过。
- 架构反目标：电脑端单入口 `app/main.tsx` + TanStack Router（hash history）；只有 `useChrome.ts`/`useReducedMotion.ts` 读视口；三断点 744/1180/1600 写 `html[data-chrome]` 且幂等；
  CSS 无宽度 `@media`，`!important` 仅 `[hidden]` 与 reduced-motion 共 5 处；产物 index.html 只引 1 入口 JS + CSS；白名单离线测试存在（`tests/desktop-import-boundary.test.mjs`），电脑端构建不含 shell.js/chat-view.js/page.js/tavern-settings.js。
- 会话层修复（代码核对）：B1 先放开场白再 `cards.open`，MVU 等待对空会话直接就绪（`session.js:180-187`，`cards/index.js:445-450`）；
  B3 用 `metadataRevision` 判断保存期间是否有新改动（`session.js:86-99`）；B4 续写判断在释放 job 前完成，`GENERATION_ENDED` 只在续写链末尾发出（`session.js:322-371`）；
  B5 `bridge.open` 在 `rt.activate` 完成后才 resolve 'opened'，含取消/抢占返回 'superseded'（`session-bridge.ts:851-1186`）；
  B6 所有 `_bind` 包装执行 `assertFrame`，null frame 抛 `VC_STALE_CARD_RUNTIME`，并覆盖到 iframe `window.TavernHelper`（`cards/index.js:155-203`、`predefine.js:13-25`）；
  B12 `MessageLeaf` 只按稳定 `message.key` 重挂载，卡片 `renderMessage` 对同一节点改索引时 rebind 而不重建（`MessageLeaf.tsx:16-20`、`cards/index.js:371-383`）。
- B9 `PersonaEditor` 接 `useLeaveGuard`；B8/B14 世界书与预设引用清理在 `tavern-controller.js` 中实现并有组件测试；B15 删除角色后失效 characters/relationships/recentChats 查询。
- 截图中功能状态正确：复杂卡 iframe 与 MVU 值渲染、真实 SSE 流式与停止、未保存离开保护、F2 409 冲突后草稿保留与「[草稿]」标记、减弱动态+减弱透明度下玻璃变不透明。
- 视觉上基本达标的页面：设置›模型（14）、设置›外观（16，除 F19）、记忆详情（09）、世界书（18，除 F21）。

## 结论：FAIL

理由：存在多项影响所有页面的高严重度视觉/可用性缺陷，均有截图与运行时证据——
F1（15 处图标按钮与标题为原生按钮）、F2（13 个图标缺失，含发送/停止/关闭）、F5（分段回复文字重复显示）、F12（宽档角色详情错位遮挡）、
F17（约 510 个类无样式，`vc-sr` 隐藏文字直接显示）、F22（弹层透出底层文字）、F23（语音引擎开关宽 0 无法操作）。
这些直接命中设计第 2 节反目标「错位、遮挡、裁切、深色/皮肤未适配」与 G4「视觉保持现状」，T12 视觉终审不通过，不应进入 DR2-13。
现有自动检查全部通过却未发现上述问题：组件测试不加载 CSS，`dr2-layout` 只断言溢出/相交/可达，`assertInViewport` 只要求与视口有交集——
建议修复时同步补「元素皮肤/隐藏/图标存在/详情列位置」断言。

## 已确认问题

### F17 [高·根因] 大量组件引用旧全局类名，但电脑端已不加载旧 CSS，新 CSS 未补——F1/F5/F9/F16 均为其实例
- 事实：`desktop-ui/src/**/*.tsx`（不含 bridge/旧 components）中 className 引用的类，约 510 个在任何 desktop-ui CSS 中无定义
  （静态扫描，脚本思路：收集 desktop-ui CSS 中全部 `.class` 选择器，对比 tsx `className` 字面量；含部分仅作测试钩子/状态标记的类，非全部有视觉影响；另有类只在其他页面作用域下定义而当前页不匹配，如 F18 的 `vc-cell`，扫描未计入，实际缺口更大）。
  其中确有视觉后果的公共类：`vc-icon-btn`(15 处)、`vc-sr`（屏幕阅读器专用文字直接显示）、`vc-glass`(15 文件)、`vc-meta`(11)、`vc-circle`(12)、
  `vc-note`、`vc-dim`、`vc-link`、`vc-send`、`vc-thinking`、`vc-alert`，以及聊天分段 `vc-segs/vc-seg`、toastr 容器。
- 运行时证据：在应用页注入 `<p class="vc-sr">` 计算为 `position:static`、宽 1440、`clip:auto`——无任何视觉隐藏规则。
- 直接证据：`13-story-stage-*` 顶部多出一行「雨夜旅馆：失踪的怀表」——`Stage.tsx:770` `<p className="vc-sr">` 本应视觉隐藏；
  `ClueWall.tsx:152` 线索列表 `vc-sr` 同理会直接显示。
- 测试掩盖：组件测试（happy-dom）不加载样式；`dr2-layout` 只做溢出/相交/可达断言，不检查元素是否「应隐藏而可见」或是否带皮肤。
- 最小修复：在 `design/base.css` utilities 层补 `vc-sr`（visually-hidden）、在 components 层为仍需的公共类（icon-btn、glass、meta、circle、note、dim、link）
  各补一处 token 皮肤或改用对应设计组件；加一个离线测试：tsx className 中 `vc-` 前缀类必须在 CSS 中有定义（可设白名单放行状态钩子）。

### F23 [高] 语音设置的引擎开关宽度为 0，不可见也无法点击
- 影响：「聊天语音 / 主动语音 / 语音输入」三个引擎启用开关在桌面不可操作，用户无法从电脑端开关语音能力。
- 位置：`features/settings/VoiceForm.tsx:3,47,52` 引用旧 `src/components/Switch`（默认 `className="vc-switch"`、Thumb 无类名），
  而新 `design/components/Switch.css:2-31` 的 `.vc-switch` 皮肤依赖 `.vc-switch__track/.vc-switch__thumb` 子结构；旧组件不渲染这些子节点。
- 运行时证据：探针在设置›语音读取 3 个 `button[role=switch]`：`width 0, height 36, opacity .4`（见附录探针摘要）；截图 15 组同样看不到开关。
- 同类风险：旧 `components/Switch` 另被 `SettingsOverview`、`inbox/Parts`、`memory/MemoryList`、`appearance/Appearance`、`models/LocalModels`、`models/ProviderPane`、`story/Stickers`、`tavern/TavernEditor` 使用；
  外观、模型、世界书截图中开关可见，说明部分调用方传了自定义类名，**未逐一运行时核对**。
- 计划偏差：计划 T3 要求「删除 `desktop-ui/src/components/*` 中被新组件替代的文件，bridge 仍用则移入 `src/bridge/components/`」；当前 `src/components/{Icon,IconButton,Switch,Segment,Overlays,Avatar,Sidebar}` 原地保留且被约 30 个电脑端 feature 文件引用。
- 最小修复：VoiceForm 及其余调用方改用 `design/components/Switch`；按计划把旧组件迁入 bridge 专用目录，阻止电脑端再引用。

### F1 [高] `.vc-icon-btn` 与聊天标题按钮无任何样式，渲染为浏览器原生按钮
- 影响：侧栏收起、会话搜索、标题栏返回列表/搜索/角色档案、角色面板关闭与圆形动作、聊天搜索上下条、表情按钮等 15 处图标按钮
  显示为原生灰底/描边矩形；标题 `<button class="vc-chat-header__title-btn">` 带原生边框与灰底。所有一级页面、四档宽度、明暗均可见。
  属设计第 2 节反目标「明显错位/深色未适配」与 AGENTS「公共图标按钮统一尺寸、双轴居中」。
- 位置：使用处 `desktop-ui/src/shell/Sidebar.tsx:134`、`shell/AppShell.tsx:278,339,353`、`app/router.tsx:173,185,194,203`、
  `features/chat/ConversationList.tsx:31`、`EmojiPicker.tsx:248`、`ChatCharacterPanel.tsx:166,191,207,220`、`ChatSearch.tsx:328,337`；
  `desktop-ui/src/**/*.css` 中无 `.vc-icon-btn`、`.vc-chat-header__title-btn` 任何规则（grep 为空），base.css reset 只继承 font/color。
- 运行时证据（探针，见附录）：`.vc-icon-btn` 计算样式 `appearance:auto; background rgb(239,239,239); border outset 2px; 34×28`，标题按钮同为原生 170×40。
- 截图证据：`01-chat-empty-1440x900-{light,dark}.png` 左上 `陪伴` 右侧、`会话` 右侧、标题栏左右按钮与标题均为原生矩形；NOTES.md 自列疑点同源。
- 最小修复：改用已有 `design/components/IconButton`（或在 components 层补 `.vc-icon-btn` 一处皮肤：透明底、36/44 命中区、双轴居中、hover/active token），
  标题按钮补 `appearance:none; background:none; border:0; padding:0; min-width:0`。

### F2 [高] 13 个图标名不在 Lucide sprite 中，渲染为空白（含 Dialog 关闭、发送、停止）
- 影响：sprite（`extension/vc-model-settings/ui/icons/lucide.svg`，54 个 symbol）缺下列名称，对应按钮/状态只剩空框或色块：
  `close`（Dialog 关闭 `design/components/Dialog.tsx:55`、Toast `Toast.tsx:66`、角色面板 `ChatCharacterPanel.tsx:170`、引用 `Composer.tsx:142`）、
  `send`（`Composer.tsx:201`、`inbox/Deliveries.tsx:20`）、`stop`（`Composer.tsx:191`）、`panel-left`（`Sidebar.tsx:140`、`AppShell.tsx:346`、`router.tsx:180`）、
  `edit`/`refresh`/`volume`（`MessageItem.tsx:421,408,447`）、`alert`（`AlertDialog.tsx:56`）、`chevron-down`（`Select.tsx:53`）、
  `clock`（`inbox/FollowUps.tsx:53`、`memory/Favorites.tsx:228`）、`star`（`Favorites.tsx:192`）、`book`（`memory/Diary.tsx:139`）、`inbox`（`inbox/InboxList.tsx:135`）。
  流式时 `#mes_stop` 与 `#send_but` 都只是无图标蓝色圆，用户无法分辨「停止」；全部 Dialog 右上关闭钮为空白胶囊。
- 运行时证据：`<use href=#panel-left>`、`#arrow-up` 等 getBBox 为 0×0，`#search`/`#user-round` 正常 13.5×13.5。
- 证据：脚本扫描 `desktop-ui/src/**/*.tsx` 的 `<Icon name>` 与 `icon=` 对 sprite id；截图 01 左上/发送键、03 停止键、07 向导右上角空白关闭钮。
- 最小修复：改用 sprite 已有名称（close→x、edit→pencil、refresh→refresh-cw、volume→volume-2、alert→circle-alert、send→arrow-up、stop→square），
  其余（panel-left、chevron-down、clock、star、book、inbox）把 Lucide 原 symbol 补进 sprite；并加离线测试比对 Icon 名与 sprite id。

### F3 [低] 无会话时侧栏底部头像显示「选」
- 位置：`shell/AppShell.tsx:229-231` 用占位标题「选择一个会话开始聊天」作为 `characterName` 传给 `Sidebar`，`Sidebar.tsx:186` 取首字做首字头像。
- 证据：`01-chat-empty-1440x900-*.png` 左下圆形头像为「选」。
- 最小修复：Sidebar 只接收真实角色名，占位标题仅用于标题栏。

### F4 [低] 宽档无会话时角色面板默认展开但为空，仅显示被拉伸的关闭按钮
- 位置：`features/chat/ChatCharacterPanel.tsx:163-171`（关闭按钮在 flex column 中无宽度约束、无样式）；无会话时 `characterName` 为空，其余内容不渲染。
- 证据：`01-chat-empty-1920x1080-{light,dark}.png` 右栏顶部一条 300px 宽原生按钮，其余空白。
- 最小修复：随 F1 给关闭按钮皮肤并 `align-self:flex-end`；无会话时不展开面板或显示空态。

### F5 [高] 分段回复文本重复显示（原文 + 分段气泡同时可见）
- 影响：COMPANION 模式下多句/超长回复经 `renderReplyBubbles` 生成 `.vc-segs`，同时原 `.mes_text` 仍可见，同一段话出现两次；
  分段气泡也没有气泡皮肤。属正常聊天主路径。
- 位置：`extension/vc-model-settings/desktop/standalone/cards/index.js:121-124` 调用 `reply-bubbles.js:144-166`（给宿主加 `vc-segmented`、插入 `.vc-segs`、仅给 `.mes_text` 加 aria-hidden）；
  旧实现靠 `3131d92b:extension/vc-model-settings/chat-view.css:322-370` 把 `.vc-segmented .mes_text` 视觉隐藏并给 `.vc-seg` 上皮肤；
  `desktop-ui/src/**/*.css` 中无 `vc-segmented` / `vc-segs` / `vc-seg` 任何规则，电脑端也不再加载 chat-view.css。
- 证据：`03-chat-streaming-1920x1080-dark.png` 第 7 条回复：气泡内一行 + 下方两段分句重复；grep 结果为空。
- 最小修复：把上述 5 条规则（去掉 `!important`，用 `@layer features`）迁入 `features/chat/chat.css`，并在受管场景对分段回复断言 `.mes_text` 不可见、`.vc-seg` 数量正确。

### F6 [中] 「正在回复…」状态条为整宽原生样式横条
- 证据：`03-*` 全部，输入框上方一条与面板同宽的浅色/灰色带；与日期条在 390 深色重叠。
- 位置：待定位（Composer 上方 notice 区）；记为视觉问题，修 F1 时一并核对。

### F7 [中] 底部浮动日期条在贴底状态下也停留可见，叠在最后一条消息/状态条上
- 位置：`features/chat/MessageList.tsx:336-343` `#vc-date-chip` 绝对定位 `bottom:16px`（`chat.css:523-549`）；`useReadingPosition.ts:623-637` 只在 `getGap() > ATTACH_PX` 时显示，
  但截图在离底很近时仍可见（截图前刚发生滚动，隐藏需等 `CHIP_HIDE_MS`）。
- 证据：`02-chat-active-*`（1440/1024/1920/390 深色）最后消息下方「1月1日 20:00」；`03-chat-streaming-390x844-dark.png` 与「正在回复…」条重叠。
- 判定：截图时序可能放大该问题，但 390 深色已出现遮挡；归为中，需运行时复核贴底后是否隐藏。
- 最小修复：贴底（`gap <= ATTACH_PX`）时立即隐藏；chip 定位避开 notice 条。

### F9 [中] 卡片/MVU 的 toastr 提示无桌面皮肤，默认绿色大块覆盖标题栏和消息
- 位置：`desktop/standalone/cards/index.js:47-48` 加载 `/lib/toastr.min.js` 与原版 css；旧实现 `3131d92b:chat-view.css:828-880` 把 `#toast-container` 重定位到对话区顶部并上玻璃皮肤；
  desktop-ui CSS 无 `toast-container` 规则。
- 证据：`04-chat-card-390x844-light.png` 顶部两条「[MVU]已更新…」绿色提示盖住标题、搜索按钮和第一条消息。
- 最小修复：在 `chat.css` 补 `#toast-container` 定位与 token 皮肤（或将 toastr 端口桥到 Base UI Toast）。

### F10 [低] 卡片动作按钮「重新处理变量」贴住输入区上缘并越出面板左圆角
- 位置：`features/chat/MessageList.tsx:117` mountCardActions 宿主（定位样式未单独核对）。
- 证据：`04-chat-card-*` 全部，按钮左缘与面板外框重合，底边与分隔线相切。
- 最小修复：给卡片动作宿主内边距（与阅读列左缘对齐）并与 composer 留 8px。

### F11 [中] 角色页与剧情页面板改为不透明画布色，丢失沉浸玻璃
- 影响：角色、剧情两个一级页面面板在浅色为实色 #f5f5f7、深色为纯黑 #000，极光被完全遮住，与聊天/记忆等玻璃面板不一致；
  属设计 G4「视觉保持现状」与非目标「不改材质」。
- 位置：`features/characters/characters.css:12`、`features/story/story.css:12` `background: var(--vc-canvas)`；
  对照 `3131d92b:extension/vc-model-settings/desktop/characters.css:7` 为 `var(--vc-glass-2)` + blur + rim（与 AppShell `.vc-panel` 同）。
- 证据：`05-characters-grid-*-dark.png` 主面板纯黑无极光；浅色为平灰。
- 最小修复：两处改为沿用 `.vc-panel` 玻璃（或直接 `background: transparent` 由外层 `.vc-panel` 提供）。

### F12 [高] 角色详情面板在宽档（容器 ≥920，即 1440/1920）掉到网格第二行，压住卡片且底部被裁切
- 影响：1440/1920 打开任一角色详情时，400px 面板不在右侧列，而落在左下（行 2 列 1），覆盖第二排卡片、内容被裁切；属反目标「错位、遮挡、裁切」。
  390、1024（容器 <920）为绝对定位覆盖层，表现正常。
- 位置：`features/characters/characters.css:2-20`：`.vc-characters-route` 自身声明 `container-type/name: vc-characters`，而两列规则
  `@container vc-characters (min-width:920px) { .vc-characters-route.has-detail {…} }` 作用在容器元素**自身**；容器查询只匹配祖先容器，故该规则永不生效，
  grid 保持单列，详情被自动放进第二行。`:217-226` 的窄档规则作用在后代 `.vc-character-detail`，所以 <920 正常。
- 运行时证据：1440 下 `.vc-characters-route` 宽 1178、`grid-template-columns: 1178px`（单列），详情 `position:static`、位于 (0,433) 400×417，右侧空 778px；1920 同（单列 1658px，详情在 y=554）；1024 下详情 `absolute` 贴右（正常）。
- 截图证据：`06-characters-detail-1440x900-*`、`06-characters-detail-1920x1080-*` 面板落在左下；1024/390 正常。
- 测试掩盖：`scripts/desktop-rebuild-accept.mjs:398-414` `assertInViewport` 只要求盒子与视口有任意交集；`06-characters-detail` 仅用它断言，`dr2-layout` 未对角色详情做列位置断言。
- 最小修复：把 `container-type/name` 移到外层包裹（如所在 `.vc-panel`），或给 grid 子项改 `.has-detail .vc-characters-main` 等后代写法；场景断言详情右缘贴面板右缘且与卡片网格不相交。

### F14 [低] 日记工具行在窄档挤压：月份换行、「Aa 手写体」被裁
- 位置：`features/memory/Diary.tsx` 工具行（flex 未设 wrap/min-width），`memory.css` 未给窄容器分行。
- 证据：`10-memory-diary-390x844-*` 「11」与「月」分两行，「下一月」与「Aa 手写体」相贴，后者右缘越出卡片。
- 最小修复：月份 `white-space:nowrap`，工具行 `flex-wrap: wrap`，手写体按钮在窄容器换到下一行。

### F15 [中] 陪伴策略在窄档：静默时间三列不折行，值被截断；收件箱分段文字竖排挤压
- 位置：`features/inbox/PolicyForm.tsx` 静默开始/结束/时区三列网格与 `inbox.css`（无窄容器折行规则）；收件箱 `Segment` 无最小宽度/横向滚动。
- 证据：`11-inbox-390x844-*`：「静默开始」断为两行，输入值显示「23:0」「08:0」「Asia/」；「待写入/已写入/链接失效」每段两行。
- 影响：窄窗下看不到完整时间与时区，属反目标「裁切」。设计要求窄档「可用即可」，但裁掉输入值不满足可用。
- 最小修复：容器 <480 时三列改单列；分段控件 `white-space:nowrap` 并允许横向滚动。

### F16 [中] 剧情页沿用旧类名 `vcms-btn` / `vc-note vc-glass`，新 CSS 无对应规则
- 影响：剧情列表的配置提示「打开模型设置」渲染为原生方角按钮（浅色白底黑框、深色灰块），提示块无玻璃/note 皮肤。
- 位置：`features/story/StoryList.tsx:76-88` 用原生 `<button className="vcms-btn">` 与 `vc-story-config vc-note vc-glass`；
  `.vcms-btn` 只在 `features/settings/model-settings.css:40` 以 `[data-vc-model-section]` 作用域定义，`vc-story-config/vc-note/vc-glass` 在 desktop-ui CSS 中无规则。
  同组件内 `StartWizard.tsx:223` 已改用设计组件 `Button variant="gray"`，两处不一致。
- 证据：`12-story-list-*` 全部，标题下方方角按钮。
- 最小修复：改用 `design/components/Button`（variant gray），提示块用已有 note/EmptyState 皮肤。

### F18 [中] 语音设置表单无行布局：标签与输入错列、标题重复、原生 select/details
- 影响：「超时（秒）[60] 每日上限」与下一行「60」交错——下一项的标签挤在上一项输入框右侧；页面标题「语音」与卡片内「语音」重复两次；
  频率下拉为原生 select，「场景指令/发送比例/心情语速」为原生 details 三角。与相邻「模型」页（表单行 200 标签列、36 控件）明显不一致。
- 位置：`features/settings/VoiceForm.tsx:41-42` 用 `vc-group`/`vc-cell`/`vc-grow`/`vc-value`；这些类只在 `settings.css:346-359` 的 `.vc-consent` 作用域与
  `model-settings.css:67` 的 `[data-vc-model-section]` 作用域定义，语音区不匹配；`VoiceSection.tsx:263-264` 另渲染页标题，与 SettingsFrame 标题重复。
- 证据：`15-settings-voice-1440x900-{light,dark}.png`、390 版标题「语音」上下各一次。
- 最小修复：VoiceForm 改用已有 `design/components/Field` + `TextInput` + `Select` 行（与模型页同一 200/36 规格），去掉 section 内重复标题。

### F19 [低] 外观页控件列对齐不一致：开关居中，分段轨道拉满但选项左挤
- 证据：`16-settings-appearance-*`：「减弱动态效果/建议回复/关键词特效」开关位于控件列中部；「外观/回复样式」分段灰轨占满控件列，选中项只在左端。
- 最小修复：控件列统一 `justify-self:start`（或统一右对齐），分段 `width:fit-content`。

### F20 [中] 酒馆设置复制了一份设置分类导航，与产品设置导航样式不一致，切换分类时左栏跳动
- 影响：从「外观」切到「AI 回复配置」时，左栏标题由 17px「设置」变为 28px，组标题「酒馆设置」变「酒馆」并换字号，全部条目整体下移约 15px；
  同一个导航在两类分类间视觉不连续。
- 位置：`features/tavern/TavernRoute.tsx:225-256` 自行渲染 `<h1>设置</h1>`、`<h2>酒馆</h2>` 与按钮列表；产品设置用 `features/settings/SettingsNav.tsx:57-90`（组标题「酒馆设置」）。
- 证据：对比 `16-settings-appearance-1440x900-light.png` 与 `17-tavern-reply-1440x900-light.png` 左栏。
- 最小修复：酒馆路由复用 `SettingsNav`（传当前 section），删除重复导航。

### F21 [低] 酒馆预设/世界书操作行中「导入」无按钮皮肤，与相邻胶囊不一致
- 位置：`features/tavern/TavernEditor.tsx:26-33` `Action` 对 `accept` 动作渲染同一 `Button` 加隐藏 file input；截图中仅该项无底色（类名 `vc-btn vc-btn-gray` 不对应 `Button.css` 的 `vc-btn--gray`，其余按钮底色来源未逐一定位）。
- 证据：`17-tavern-reply-1920x1080-*`、`18-tavern-world-*`。
- 最小修复：统一使用 `design/components/Button variant="gray"`。

### F22 [高] 弹层（AlertDialog / Dialog / Menu）背景模糊不生效，底层文字透过弹层与弹层文字重叠
- 影响：未保存确认、新建向导、消息菜单等弹层内文字与底下表单/消息文字叠在一起，可读性明显下降；属反目标「遮挡、对比不足」。
- 证据：`20-overlay-confirm-1440x900-*`：对话框内可读到底层「模型 / vc03m-chat / 8192 / 2048 / 输出上限」；`20-…-1920x1080-*` 同；
  `19-overlay-menu-*` 菜单项与后方消息文字重叠；`07-characters-wizard-1024/1440` 同。`1024` 版 20 组透出较少，说明与内容位置有关、非恒定。
- 位置：`design/components/AlertDialog.css:15-27`、`Dialog.css:15-30`、`Menu.css:6-13` 均声明 `background: var(--vc-glass-3)`（浅 .82/深 .82）+ `backdrop-filter: blur(40px)`；
  截图中可见度远高于 .82 不透明叠加应有效果，推测 backdrop-filter 未生效或弹层被放入带 `backdrop-filter`/`isolation` 的祖先（`AppShell.css:134` `isolation:isolate`、
  Portal 宿主 `#vc-overlay-host` 位置）形成新 backdrop root。**根因未在运行时确认**。
- 最小修复：确认 Portal 挂载点不在 `.vc-panel` 等带 backdrop-filter 的祖先内；弹层面板背景至少用 `--vc-glass-opaque` 兜底（减少透明度模式已有此 token）。

## 未完成或缺少证据

- `dr2-pages` 受管场景 BLOCKED（需本机 11438 嵌入服务，Owner 本地栈未发布该端口），角色导入/新建、记忆纠正删除、陪伴策略保存、剧情开局行动的端到端**未复跑**，沿用 Codex 报告不作为本审计证据。
- NOT_RUN：`bash scripts/check.sh` 全量（含 Go 单测）、Go 后端测试、`infra/db/run-rls-tests.sh`、计划 T11 列出的 `nf-*`、`f2-browser`、`f2-native`、`mb-engine` 等其余受管场景、`--capture` 重新出图。
- 未审：本分支对 `codex/desktop-independent-frontend` 的 Go/OpenAPI/migration 改动（`backend/**`、`specs/openapi/**` 有变更）与 `/native/` 手机路径；B10（`/native/` 恒用手机布局）只确认单测存在，未运行时验证。
- 旧电脑端 `extension/vc-model-settings/desktop/*.js` 仍有 14 个文件、`desktop-ui/src/components/*` 旧组件仍被约 30 个电脑端文件引用——属 DR2-13/T3 收尾项，记录为未完成，不单列缺陷（F23 是其直接后果）。

- E2 → 已运行时确认，升级为 F23。
- E3 消息菜单 F22 的运行时根因：探针未找到消息「…」触发器选择器（`menu: more-button-not-found`），未测得 `.vc-menu` 计算样式与祖先链；F22 仅以截图为证据。
- E1 → 已升级为 F22（截图直接证据）；根因待运行时定位。

## 实际执行的检查

| 检查 | 结果 |
|---|---|
| `npm run check:desktop`（tsc） | PASS（/tmp 导出副本，HEAD bb0d6347） |
| `npm run build:desktop`（bridge + app） | PASS；产物 index.html 引 1 入口 JS + 2 CSS，assets 5.5M |
| `npm run test:desktop`（Vitest） | PASS 33 文件 / 118 用例 |
| `node --test tests/*.test.mjs`（独立离线 PG 容器名） | PASS 1097/1097，0 fail/skip |
| 反目标 grep：组件读视口 | PASS：仅 useChrome.ts、useReducedMotion.ts；另 `src/components/Overlays.tsx` 读 innerWidth，但无电脑端消费者（仅 bridge） |
| 反目标 grep：`!important` | PASS：base.css `[hidden]`、reduced-motion 共 5 处，均属允许类别 |
| 受管 `--filter dr2-mvu-new,dr2-settings,dr2-pages,dr2-layout`（含前置 catalog-admin；/tmp 副本，独立端口 879x、容器 vc-w03-dr2-claude-*，结束已自动移除） | catalog-admin PASS、dr2-layout PASS 17.1s、dr2-settings PASS 12.6s、dr2-mvu-new PASS 5.8s；**dr2-pages BLOCKED**：场景要求本机 `127.0.0.1:11438` 嵌入服务，Owner 本地栈 `vc-local-dev-embedding-1` 未发布该端口 → `fetch failed`（环境前置，非产品断言失败）；未改 Owner 栈 |
| 受管只读探针 `claude-audit-probe`（仅 /tmp 副本临时注册，不入仓库；catalog-admin + 探针） | PASS 5.1s；页面无 pageerror；测量摘要见附录；容器已自动移除 |
| 构建产物 CSS 中 `.vc-icon-btn` / `.vc-chat-header__title-btn` | 0 条规则（佐证 F1） |
| 反目标 grep：`@media` 宽度断点 | PASS：CSS 无宽度 media query；布局用 `[data-chrome]` 与 `@container` |

## 附录：运行时探针摘要（1440×900，浅色，合成账号）

| 项 | 结果 |
|---|---|
| `vc-icon-btn vc-side-collapse` | bg rgb(239, 239, 239), border outset 2px, appearance auto, 34×28, icon `panel-left` bbox [0, 0] |
| `vc-icon-btn` | bg rgb(239, 239, 239), border outset 2px, appearance auto, 34×28, icon `search` bbox [13.5, 13.5] |
| `vc-icon-btn` | bg rgb(239, 239, 239), border outset 2px, appearance auto, 34×28, icon `panel-left` bbox [0, 0] |
| `vc-chat-header__title-btn` | bg rgb(239, 239, 239), border outset 2px, appearance auto, 170×40, icon `None` bbox None |
| `vc-icon-btn vc-desk-search-toggle` | bg rgb(239, 239, 239), border outset 2px, appearance auto, 34×28, icon `search` bbox [13.5, 13.5] |
| `vc-icon-btn` | bg rgb(239, 239, 239), border outset 2px, appearance auto, 34×28, icon `user-round` bbox [12, 13.5] |
| 角色详情 @1440 | route 1178px, grid `1178px`, detail position static at (x0, y433) 400×417, 右侧空 778px |
| 角色详情 @1920 | route 1658px, grid `1658px`, detail position static at (x0, y554) 400×476, 右侧空 1258px |
| 角色详情 @1024 | route 906px, grid `906px`, detail position absolute at (x506, y0) 400×734, 右侧空 0px |
| 语音引擎开关 | 3 个 switch，宽 [0, 0, 0]，高 36，opacity 0.4 |
| `.vc-sr` 计算样式 | position static, width 1440, clip auto |
| pageerror | 0 |

未定义类（节选，按字母序前 40 个，共约 510 个）：`fa-circle-check` `fa-circle-info` `fa-cloud-arrow-down` `fa-code-merge` `fa-copy` `fa-key` `fa-plug-circle-check` `fa-plug-circle-xmark` `fa-plus` `fa-rotate-right` `fa-share-nodes` `fa-solid` `fa-trash-can` `fa-triangle-exclamation` `fa-user-shield` `fa-xmark` `is-danger` `is-editing` `is-loading` `is-new` `is-short` `is-solid` `is-sticker` `name` `name_text` `t` `tab` `vc-account-avatar` `vc-account-card` `vc-account-cards` `vc-account-device` `vc-account-device-meta` `vc-account-device-name` `vc-account-reauth` `vc-account-security` `vc-account-session` `vc-alert` `vc-alert__btn--danger` `vc-avatar-fallback` `vc-btn--primary`
