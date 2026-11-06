# 手机端 React 重建（MB2）方案与实施计划

- 日期：2026-11-06
- 决策依据：[ADR-0012](../decisions/0012-mobile-react-shared-engine.md)（Proposed，MB2-0 由 Owner 批准后生效）
- 分支：`mobile-react-rebuild`（自 main `f502c4b9` 起）；每个条目一个 worktree、一个写入 owner
- 进度：只按 ID 回填 `TODO.md`「MB2 手机端 React 重建」；条目清单见 Backlog L 节

> 给执行者（Codex）：先读 AGENTS.md、ADR-0012、本文第 0–6 节，再读当前条目所在小节。第 7 节是执行与调度约定，
> 第 8 节是暂停条件。批准前只允许做 MB2-0 与 MB2-1（文档与 Spike）。

## 0. 结论

手机端改为与电脑端共用同一个 React 工程和同一个独立引擎，只新做手机壳、导航与需要手机交互的展示层；
uni-app 界面与隐藏 ST 引擎不再继续。理由：

| 维度 | 继续 uni-app（`mb-mobile`） | React 共用（推荐） |
|---|---|---|
| 功能对齐 | 电脑端 8 个功能区、上百个组件需用 Vue 重写，之后每个新功能写两遍 | 业务逻辑、数据层、会话桥直接复用，只做手机布局 |
| 引擎 | 隐藏完整 ST 页面（`/native/`），冷启动 3.8–5.2 s、额外 10–20 MB 堆 | 电脑端独立引擎，不加载 ST 页面 |
| 复杂卡 / 剧情 / 酒馆配置 | 切到冻结的旧 ST 手机布局（“ST 视图”） | React 页面 + `standalone/cards`，与电脑端一致 |
| 维护 | 两套 UI 框架、两条引擎路径 | 一套 |
| 代价 | 已有约 1 万行 Vue 可用 | 手机壳与各页手机布局需新做；首屏性能需单独治理；Android 壳需重新选型 |

## 1. 现状（2026-11-06 核实）

### 1.1 电脑端（main）

- `integrations/sillytavern/desktop-ui`：React 19 / Vite 8 / Base UI / TanStack Router + Query / zustand。
  功能区：`chat`、`characters`、`memory`、`inbox`、`story`、`settings`、`tavern`、`appearance`（含 `models`）。
- 路由：`/chat`、`/chat/$conversationKey`、`/characters`、`/characters/$avatar`、`/memory`、`/inbox`、`/story`、
  `/story/$runId`、`/settings`、`/settings/$category`、`/settings/tavern/$section`（`src/app/router.tsx`）。
- 断点：`data-chrome="narrow|compact|regular|wide"`（< 744 / 744–1179 / 1180–1599 / ≥ 1600，`src/shell/useChrome.ts`）。
  `narrow` 已有单栏布局，390 宽度在 DR2-12 矩阵中验收过，但交互是电脑端的窄窗适配，不是手机产品。
- 引擎：`extension/vc-model-settings/desktop/standalone/{runtime.js,session.js,engine/**,cards/**}`，聊天准备入口与页面启动解耦。
- 主题：UX-35 极光 token、主题注册、全局与角色覆盖、气泡变体（`src/shell/usePreferences.ts` 等）。
- 构建：`scripts/build-desktop.mjs` → `server-plugin/virtual-companion/desktop/app/`（base `/desktop/`）。
  最大三个 JS 包 gzip 约 1.01 MB / 0.70 MB / 0.64 MB。
- 托管：`server-plugin/virtual-companion/lib/host-auth.js` 的 `serveMobile` 从 `mobile-dist/` 提供 `/m/`；
  缺产物时返回 503。2026-11-06 起过渡期手机直接使用电脑端窄窗版。

### 1.2 手机端（`origin/mb-mobile`，未合并）

- `mobile/`：uni-app 3 + Vue 3.4，约 1 万行；页面 `main/index`（一级页容器）、`chat/conversation`、`character/detail`、`settings/index`。
- 完成：MB-0 可行性、MB-2 骨架与主题、MB-3 隐藏 ST 引擎适配、MB-4 聊天、MB-5 一级页与设置、MB-7 语音输入与朗读、
  MB-8 H5 通话、MB-9 H5 来电、MB-10 场景背景。未完成：MB-6 Android 壳。
- 分支比 main 多 18 个提交、落后 100 个；合并基点 `f426bacc`（DR2 之前）。
- **非 `mobile/` 的改动**（需迁移，见 MB2-2）：
  - 迁移 `V283__foreground_inbox_call.sql`、`V284__configured_tool_turn_bounds.sql` —— 与 main 的
    `V283__reminder_cooldown_pruning.sql` **编号冲突**，迁移时改为 V284、V285；
  - Go：`httpapi/inbox.go`（`POST /api/v1/inbox/{eventId}/call`，`respondInboxCall`）、`proactive/*`（来电触发）、
    `voice/service.go`、`provider/openai/*`（MDL-2 真实模型响应、思考深度、工具预算）、`store/postgres/{inbox,proactive,notification}.go`；
  - OpenAPI / catalog / 生成物；server-plugin `chat-completions.js`、`tool-loop.js`、`responses-adapter.js`、`host-auth.js`；
  - 受管场景 `mb-engine`、`mb-pages`、`mb-incoming`、`mb-shell`、`mb0-spike` 及语音场景改动；`Dockerfile.st` 的 `mobile-dist` 步骤。
- 可参考移植的框架无关逻辑：`mobile/src/voice/{input,call,incoming}.mjs`、`theme/background.mjs`、`chat/format.mjs`；
  `engine/*` 依赖隐藏 ST，不移植。

### 1.3 设计规范

DESIGN.md 第 17 节（MB-1，Owner 2026-11-02 选图）给出手机 token、页面骨架、对话、通话与来电、背景、Android 系统界面数值；
第 1–3、6、8 节原则继续适用。第 17 节中“ST 视图”“酒馆条目打开 ST 视图”“剧情入口进 ST 视图”需随本计划修订。

## 2. 目标与非目标

**目标**

1. `/m/` 提供完整手机产品：电脑端现有全部功能在手机上可用（第 4 节矩阵），交互按 DESIGN.md 第 17 节。
2. 与电脑端共用一份聊天、一条生成链、一个引擎；复杂卡、MVU、EJS、剧情、酒馆配置在手机上原生可用，不依赖 ST 页面。
3. 首屏与引擎性能达标（第 3.6 节预算）。
4. Android 薄壳：系统能力按 ADR-0011 第 4、5 节。
5. 电脑端零回归：DR2 的 Vitest、离线测试、受管整组与 `dr2-layout` 保持通过。

**非目标**：iOS 与上架、系统推送服务、云打包、部署、改变电脑端外观、在 Go 复制生成链、为手机单独维护第二份业务状态。

## 3. 架构

### 3.1 代码组织

```
integrations/sillytavern/desktop-ui/
  index.html                电脑端入口（不变）
  mobile.html               手机入口（新增）
  src/
    app/                    电脑端 App 与路由（不变）
    data/ runtime/ design/  共用：查询、会话桥、token 与基础组件
    components/             共用基础组件
    features/<area>/        共用：业务逻辑 hooks、表单 schema、纯展示组件；
                            电脑端专用布局组件保留原位
    mobile/                 新增：手机专用
      app/                  MobileApp、路由树（手机导航模型）
      shell/                标签栏、页面栈、大标题、设置大 sheet、安全区、键盘避让、返回处理
      pages/<area>/         各功能区的手机页面（组合 features 的 hooks 与组件）
      components/           手机专用组件（左滑行、长按菜单、底部 sheet、全屏卡片页等）
      native/               Android 壳桥接（H5 下为 no-op）
```

规则：

- `features/**` 不得 import `mobile/**` 或电脑端壳层；`mobile/**` 可 import `features/**`、`data/**`、`runtime/**`、`design/**`、`components/**`。
  扩展现有 `tests/desktop-import-boundary.test.mjs` 强制该方向。
- 业务逻辑先抽到 `features/<area>` 的 hooks / 纯函数，再由电脑端与手机端各自组合；抽取时电脑端行为与 DOM 不变（MB2-4）。
- 不新增第二套断点体系：手机入口固定为手机布局（不读 `data-chrome` 切换电脑端布局）；组件内部尺寸差异用容器查询。
- 不重复实现键盘、焦点、弹层状态机：继续用 Base UI（Dialog / Popover / Menu 等）；底部 sheet 用 Base UI Dialog 的公开模式实现。

### 3.2 构建与托管

- Vite 增加手机入口：`mobile.html`，`base: '/m/'`，输出 `server-plugin/virtual-companion/mobile/app/`（忽略不提交，
  由 `scripts/build-desktop.mjs` 同一入口生成，`npm test` / `check.sh` 的 `desktop-build` 同时构建两端）。
- `host-auth.js`：`/m/` 改为从 `mobile/app/` 提供，沿用 `serveMobile` 的路径校验、`nosniff`、assets 不可变缓存；
  页面入口注入与 `/` 相同的 `vc-account-id` / `vc-session-id` meta 并纳入 `pageEntry` 绑定逻辑；未构建时保持 503。
- `ops/deploy/v2/Dockerfile.st` 不需要单独的 H5 构建步骤（同一构建入口产出），核对镜像内含 `mobile/app/`。
- 许可：新依赖登记 `scripts/checks/license-inventory.yaml`；构建产物 notices 覆盖手机入口。

### 3.3 手机导航模型

- 一级页（标签栏）：聊天、角色、记忆、陪伴、剧情（DESIGN.md §17.3）；右上头像打开设置大 sheet。
- 二级页为页面栈（push / pop，带返回）：对话、角色详情、记忆详情、剧情运行、设置子页、酒馆配置子页、全屏卡片页、通话页。
- 路由：TanStack Router，手机路由树与电脑端分开定义，路径与电脑端同名参数（`$conversationKey`、`$avatar`、`$runId`、`$category`、`$section`），
  便于两端互链与通知深链接（`/m/chat/<key>`）。
- 返回：浏览器历史为唯一来源；Android 返回键经壳桥映射为 `history.back()`；离开保护复用 `useLeaveGuard`。
- 标签栏在对话、通话、二级页与键盘弹起时隐藏。

### 3.4 引擎与复杂内容

- 手机入口与电脑端一样，经 `src/runtime/session-bridge.ts` 使用独立引擎；会话桥、草稿、冲突、阅读位置逻辑共用。
- 引擎延迟加载：会话列表与历史先由服务端直读显示，进入对话后再准备运行模块（沿用 `runtime.js` 与页面启动解耦的设计）。
- 复杂卡：消息内 HTML / EJS / 状态栏由 `standalone/cards` 渲染到消息叶子；超出气泡宽度或需要交互的卡片，
  在消息位置显示占位行（DESIGN §17.4 「互动卡片 · <卡片名>」），点开进入**全屏卡片页**（同一卡片实例的 React 宿主，
  不是 ST 视图），关闭回到对话并保持状态。显式授权门槛（DR2-14）不变。
- 剧情：使用 `features/story` 的逻辑与舞台组件，做手机布局（MB2-10），不进 ST 视图。
- 酒馆九类配置：使用 `features/tavern` 的表单与编辑器，做“列表 → 详情”手机布局（MB2-11）；代码编辑器在手机上提供全屏编辑模式。

### 3.5 主题与背景

- 沿用 UX-35 的主题注册、全局与角色覆盖；DESIGN §17.2 的手机语义 token 以手机作用域（`[data-vc-device="mobile"]`）覆盖同名 `--vc-*`。
- 组件变体按 §17.1（气泡 `tail`、标签栏 `floating`、图标 `line`、提示音 `soft`）。
- 场景背景（MB-10 能力）：按角色选择酒馆背景或上传图，模糊、亮度与渐隐按 §17.6；存储沿用 MB-10 的角色卡手机专用字段（迁移时核对字段名）。

### 3.6 性能预算（MB2-1 测定基线，MB2-15 验收）

| 指标（MuMu 或真机 + Chromium 4× CPU 降速） | 目标 |
|---|---|
| `/m/` 首屏可交互（会话列表可见） | ≤ 2.5 s（热缓存 ≤ 1.2 s） |
| 进入对话到历史可见 | ≤ 0.5 s |
| 进入对话到可发送（引擎就绪） | 冷 ≤ 4 s、热 ≤ 2.5 s（须优于 MB-0 隐藏 ST 的 5.2 / 3.8 s） |
| 首屏 JS（gzip，不含引擎与按需路由） | ≤ 450 KB |
| 对话页滚动 | 无 > 50 ms 长任务，约 60 fps |
| 引擎运行时额外堆 | ≤ 隐藏 ST 方案的 10–20 MB |

### 3.7 Android 壳

- 首选 Capacitor：`mobile-shell/android`（工程入库，本地离线 Gradle 构建，签名材料不入库）。加载同源 `/m/`（远程 URL，不打包网页资源）。
- 网页侧 `src/mobile/native/bridge.ts` 定义唯一桥接口，H5 下全部为 no-op 或降级：
  `safeArea()`、`onBack(handler)`、`requestPermission('mic'|'notify')`、`startKeepAlive()` / `stopKeepAlive()`、
  `notify({title, body, conversationKey, kind: 'message'|'call'})`、`onNotificationReply(handler)`、`onShare(handler)`、`onResume(handler)`。
- 壳内不放业务逻辑、不存业务状态、不直连 Go / TTS / ASR（ADR-0011 §4）。通知正文与锁屏可见性按 DESIGN §17.7。
- 插件与许可在 MB2-1 Spike 中逐个核实（本地通知、前台服务、分享接收、状态栏 / 安全区、返回键）；不能满足时记录替代方案并暂停 MB2-13。

## 4. 功能对齐矩阵

优先级：P0 = 首个可用版本必需；P1 = 对齐电脑端；P2 = 系统能力 / 后续。来源列说明复用对象。

| 功能区 | 手机页面与交互（DESIGN §17） | 复用来源 | 优先级 | 条目 |
|---|---|---|---|---|
| 壳层 | 标签栏、大标题、页面栈、设置大 sheet、安全区、键盘避让、返回、极光背景、主题与角色覆盖 | `shell/Aurora`、`usePreferences`、`useLeaveGuard`、`design/**` | P0 | MB2-5 |
| 会话列表 | 卡片会话行、左滑操作、草稿 / 语音 / 卡片预览、未读、搜索 | `features/chat/{Conversations,ConversationList,QuickSwitch}` 逻辑 | P0 | MB2-6 |
| 对话 | 分组气泡（tail）、日期条、引用、长按菜单、编辑 / 删除 / 重新生成 / 候选 / 停止 / 继续、搜索、阅读位置、草稿与失败保留、冲突处理 | `MessageList`、`MessageItem`、`MessageMenu`、`Composer`、`ConflictSheet`、`useReadingPosition`、`session-bridge` | P0 | MB2-6 |
| 富内容 | 图片大图、表情包、语音条、互动卡片占位 + 全屏卡片页、MVU / EJS | `MessageLeaf`、`VoiceBubble`、`EmojiPanel`、`standalone/cards`、lightbox | P0 | MB2-6 |
| 对话增强 | 建议回复、表情包面板、状态卡 / 陪伴状态、收藏、稍后提醒、记忆检查 | `Suggestions`、`EmojiPicker`、`StatusCard`、`ChatStatusCard`、`MemoryInspector`、`MessageList` 提醒逻辑 | P1 | MB2-6 |
| 角色 | 两列角色卡、详情、实例、导入、创建向导、人设编辑 | `features/characters/**` | P1 | MB2-7 |
| 记忆 | 角色·实例选择、搜索、分段（全部 / 待核验 / 已失效）、详情、纠正、删除、钉住、来源定位、时间线、收藏、提醒、日记 | `features/memory/**` | P1 | MB2-8 |
| 陪伴 | 消息卡、未接来电卡 + 回电、跟进分组、静默时段、投递记录、通知渠道、重新验证 | `features/inbox/**`；`respondInboxCall`（MB2-2） | P1 | MB2-9 |
| 剧情 | 深蓝青极光、16:9 案件卡、开局向导、舞台、线索墙、NPC、证物、回档、结局记忆 | `features/story/**` | P1 | MB2-10 |
| 设置 | 账户、模型（提供方 / 用途绑定 / 用量 / 本地模型）、语音、通知、外观与主题、陪伴风格、表情包、数据权利、同意门 | `features/settings/**`、`features/models/**`、`features/appearance/**` | P1 | MB2-11 |
| 酒馆配置 | 九类：回复配置、提示词顺序、格式、世界书、人设、背景、界面、扩展 / Helper 脚本 / 正则、API 连接、角色卡 | `features/tavern/**` | P1 | MB2-11 |
| 语音 | 按住说话 / 上滑取消、语音条、朗读、转文字 | `VoiceRecorder`、`VoiceBubble`、`voice-logic.js`；参考 `mb-mobile` `voice/input.mjs` | P1 | MB2-12 |
| 通话与来电 | 全屏通话（§17.5）、开口打断、字幕；来电全屏、未接留言、回电 | 参考 `mb-mobile` `voice/{call,incoming}.mjs`、`VcCall.vue`、`VcIncoming.vue`；后端 MB2-2 | P2 | MB2-12 |
| 场景背景 | 按角色选择 / 上传、模糊与渐隐 | 参考 `mb-mobile` `theme/background.mjs` 与 MB-10 字段 | P1 | MB2-5 |
| 系统能力 | 前台保活、本地通知与快捷回复、来电全屏通知、分享给 TA、返回键、权限 | Capacitor 壳 + `mobile/native/bridge.ts` | P2 | MB2-13 |

## 5. 设计流程

1. MB2-0 修订 DESIGN.md 第 17 节：标题改为“手机界面”，删除 uni-app 与 ST 视图描述，补“全屏卡片页”“酒馆配置手机布局”规则；数值不变。
2. MB-1 已选图覆盖：一级页、对话、通话、来电、背景、设置、分享与通知。未覆盖、需先出图由 Owner 选定的页面：
   剧情舞台与开局、酒馆九类配置、收藏 / 提醒 / 日记、记忆时间线与纠正、陪伴投递与渠道、角色创建向导与人设编辑、
   模型用途与用量、表情包管理、建议回复与状态卡、全屏卡片页。出图提示词沿用 `docs/product/v2-redesign/mobile/image-prompts.md` 的风格约束。
3. 未选图的页面不进入实现（AGENTS.md：改变外观先出图并取得 Owner 确认）；同一条目内已选图的部分可先做。

## 6. 验证体系

| 层级 | 内容 | 入口 |
|---|---|---|
| 单元 / 组件 | 手机壳、导航、各页组件；Happy DOM，先建 DOM 再导入 bundle | `npm --prefix integrations/sillytavern run test:desktop` |
| 导入边界 | `features` 不依赖 `mobile` / 电脑壳；手机入口不打包电脑端专用壳 | 扩展 `tests/desktop-import-boundary.test.mjs` |
| 离线 | 两端构建 + 既有离线测试 | `npm --prefix integrations/sillytavern test`、`bash scripts/check.sh` |
| 受管（手机） | 新增 `mb2-shell`、`mb2-chat`、`mb2-cards`、`mb2-pages`、`mb2-settings`、`mb2-voice`、`mb2-call`、`mb2-perf`、`mb2-layout`；视口 390×844 / 360×780 / 430×932，浅深色；真实用户动作，不删节点 / 不改 pointer-events | `scripts/accept-managed.mjs --filter …`（新场景放 `scripts/mobile-*-accept.mjs`，在 `scripts/managed-scenes.mjs` 注册） |
| 受管（电脑端回归） | DR2 整组 17 项（`catalog-admin,dr2-layout,dr2-mvu-new,dr2-settings,dr2-pages,nf-*,f2-browser,f2-native`） | 同上 |
| 后端 | Go 单测、集成、RLS | `go test`、`infra/db/run-go-store-tests.sh`、`infra/db/run-rls-tests.sh` |
| Android | ADR-0011 MB-0 清单中的壳能力；MuMu + adb，Doze 模拟锁屏；真机项标“待真机” | MB2-13 记录 |
| 视觉 | 390 / 360 / 430 × 浅深，截图入 `.review-queue/MB2-<n>/` 附 NOTES.md；Claude 终审 | MB2-15 |

受管场景以 Mac 参考环境结果为合并门槛（AgentBox ARM Linux 环境已知有 9 项电脑端场景的环境性失败，见 TODO DR2-16）。

## 7. 实施条目

依赖图：

```
MB2-0 ─► MB2-1 ─┬─► MB2-3 ─► MB2-4 ─► MB2-5 ─┬─► MB2-6 ─► MB2-12
                │                            ├─► MB2-7
MB2-2 ──────────┤（与 MB2-3 并行，后端唯一 owner）├─► MB2-8
                │                            ├─► MB2-9（依赖 MB2-2）
                │                            ├─► MB2-10
                │                            └─► MB2-11
                └─► MB2-13（依赖 MB2-1 壳结论、MB2-5、MB2-12）
全部 ─► MB2-14 ─► MB2-15
```

MB2-7 至 MB2-11 可并行（不同 `features/<area>` 与 `mobile/pages/<area>`）；共享文件（`mobile/app/router`、`mobile/shell/**`、
`design/**`）只由 MB2-5 的 owner 修改，其他条目需要改动时提交给该 owner 串行整合。

### MB2-0 决策与规范（文档；Owner 批准门）

- 内容：Owner 批准 ADR-0012（状态改 Accepted）；ADR-0011 头部标注第 1、2、4 节被 ADR-0012 替代；DESIGN.md 第 17 节按第 5 节第 1 点修订；
  Backlog L 与 TODO「MB2」登记；列出待出图页面并交付出图提示词。
- 验收：`git diff --check`；引用与规则一致性核对。
- 提交：`docs(MB2-0): 批准手机端 React 共用方案并修订手机规范`

### MB2-1 Spike：引擎性能与 Android 壳可行性（只写验证代码，不做产品界面）

- 引擎：最小 `mobile.html` 入口 + 会话列表 + 对话（复用电脑端组件），在 Chromium 4× 降速与 MuMu 上测第 3.6 节各项基线；
  测 2 个复杂卡（MVU、EJS）在手机视口的渲染与全屏卡片页原型。
- 壳：Capacitor 最小工程加载 `/m/`，逐项验证 ADR-0011「MB-0 必须验证」中的 App 项（Cookie、`getUserMedia`、软键盘、返回键、
  前台服务 30 分钟流式不断、本地通知快捷回复回传、系统分享），并核对每个插件的许可与维护状态。
- 产出：`docs/planning/2026-11-xx-mb2-spike-report.md`（数值、通过 / 不通过、待真机项、推荐的壳与插件、预算是否需调整）。
  Spike 代码放 `mobile-spike/` 或任务 worktree，不合入产品目录。
- 不通过的处理：引擎指标不达标 → 先提出拆包 / 预热方案并请 Owner 确认预算；壳任一项不通过 → 回到 ADR-0012 修订，不在壳里补业务逻辑。
- 提交：`docs(MB2-1): 手机引擎与 Android 壳可行性报告`

### MB2-2 后端与契约迁移（后端 owner：Codex；与 MB2-3 并行）

- 从 `origin/mb-mobile` 移植非 `mobile/` 改动，按两组分别提交：
  1. **MDL-2**（`bedf0320` 等）：OpenAI 适配层真实响应兼容、思考深度、工具预算配置；迁移 `V284__configured_tool_turn_bounds.sql` 改为 **V285**
     （或按实际顺序重排，保证从当前最大版本顺延）；server-plugin `chat-completions.js`、`tool-loop.js`、`responses-adapter.js`、`model-usage.js`。
  2. **来电（MB-9 后端）**：`V283__foreground_inbox_call.sql` 改为 **V284**；`respondInboxCall`、`proactive` 来电触发、`voice/service.go`、
     `store/postgres/{inbox,proactive,notification}.go`；OpenAPI / catalog 先行，生成物用工具生成。
- 不移植：`mobile/**`、`mb-*` 受管场景（MB2 重写）、`Dockerfile.st` 的 `mobile-dist` 步骤、`host-auth.js` 中 `mobile-dist` 相关改动（MB2-3 重做）。
- 逐文件与 main 当前实现对比，冲突以 main 为准合并语义；一个条目最多一个迁移的规则：两组分别作为 MB2-2a / MB2-2b。
- 风险核对：Mac 开发数据库若已执行 `mb-mobile` 的 V283 / V284，切换前按 AGENTS 规则备份并给出处理方案，不手改线上数据。
- 验收：`bash scripts/check.sh --quick`、Go 单测、`infra/db/run-go-store-tests.sh`、`infra/db/run-rls-tests.sh`、
  `migrate_test.go` 计数；受管 `catalog-admin`、`hl-proactive`、`voice-chat` 与 `w11-tool-meter`（存在者）整组。
- 提交：`feat(MB2-2a): 迁移 MDL-2 模型响应与工具预算`、`feat(MB2-2b): 迁移角色来电后端与契约`

### MB2-3 构建与托管

- 内容：第 3.2 节；`mobile.html` + `src/mobile/app/MobileApp.tsx` 空壳（只显示标签栏占位）；host-auth 改为从 `mobile/app/` 提供 `/m/`
  并注入身份 meta；导入边界测试扩展；`check.sh` 的 `desktop-build` 覆盖两端。
- 测试：host-auth 单测（路径穿越、未构建 503、身份 meta、`pageEntry` 绑定与 401 重定向）；构建产物存在性；电脑端 Vitest 与离线全量不回归。
- 提交：`feat(MB2-3): 手机入口构建与 /m/ 同源托管`

### MB2-4 共享层抽取（电脑端零行为变化）

- 内容：按第 4 节矩阵，把各功能区被手机复用的业务逻辑抽为 `features/<area>/use*.ts` hooks 与无布局假设的展示组件；
  电脑端组件改为组合这些 hooks。按功能区分批提交（chat、characters、memory、inbox、story、settings、tavern）。
- 约束：电脑端 DOM、类名、交互与截图不变；既有测试不删弱；每批跑 Vitest、离线全量与受影响电脑端受管场景。
- 提交：`refactor(MB2-4-<area>): 抽取<功能区>共享逻辑`

### MB2-5 手机壳

- 内容：第 3.3、3.5 节；标签栏、大标题、页面栈、设置大 sheet、安全区、键盘避让、返回、角标、离开保护、主题与角色覆盖、
  极光与场景背景（含上传、模糊、渐隐）。
- 测试：组件测试；受管 `mb2-shell`、`mb2-layout`（320–430 无横向滚动、标签栏 / 输入区不遮挡、键盘弹起、返回栈、深浅色）。
- 提交：`feat(MB2-5): 手机壳层、导航与主题`

### MB2-6 聊天（P0）

- 内容：矩阵“会话列表”“对话”“富内容”“对话增强”；全屏卡片页；草稿、失败保留、冲突、阅读位置、搜索、候选、停止 / 继续。
- 测试：组件测试；受管 `mb2-chat`（发送、流式、停止、重新生成、候选、编辑、删除、引用、搜索、草稿与失败保留、F2 冲突、刷新恢复）、
  `mb2-cards`（MVU 空会话开场白、EJS、状态栏、全屏卡片页往返状态一致、普通内容不获得执行权限）、`mb2-perf`。
- 提交：`feat(MB2-6): 手机聊天与互动卡片`

### MB2-7 角色与人设

- 内容：两列角色卡、详情、实例、导入、创建向导、人设编辑（选图后）。
- 测试：组件测试；受管 `mb2-pages` 角色段。
- 提交：`feat(MB2-7): 手机角色与人设`

### MB2-8 记忆

- 内容：选择胶囊、搜索、分段与计数、详情、纠正、删除、钉住、来源定位跳回对话、时间线、收藏（分页）、提醒、日记（选图后）。
- 测试：组件测试；受管 `mb2-pages` 记忆段（含来源定位与收藏分页）。
- 提交：`feat(MB2-8): 手机记忆、收藏、提醒与日记`

### MB2-9 陪伴

- 内容：消息卡、未接来电卡与回电（依赖 MB2-2b）、跟进分组、静默策略、投递记录、通知渠道、重新验证。
- 测试：组件测试；受管 `mb2-pages` 陪伴段、来电留言回电。
- 提交：`feat(MB2-9): 手机陪伴与收件箱`

### MB2-10 剧情

- 内容：案件卡列表、开局向导、舞台（手机布局）、线索墙、NPC、证物翻面、回档、结局记忆；减弱动态时直接终态。
- 测试：组件测试；受管 `mb2-pages` 剧情段（开局、行动、回档、迟到响应）。
- 提交：`feat(MB2-10): 手机剧情`

### MB2-11 设置与酒馆配置

- 内容：设置大 sheet 下的账户、模型、语音、通知、外观与主题、陪伴风格、表情包、数据权利、同意门；酒馆九类“列表 → 详情”布局，
  代码编辑器全屏模式，409 冲突与草稿保护沿用电脑端。
- 测试：组件测试；受管 `mb2-settings`（模型用途保存竞态、预算不足提示、重新验证、酒馆预设另存与世界书引用清理、409）。
- 提交：`feat(MB2-11): 手机设置与酒馆配置`

### MB2-12 语音、通话与来电

- 内容：按住说话 / 上滑取消、语音条与朗读、转文字；全屏通话（分段收音 → Go ASR → 引擎短回复 → Go TTS，开口打断，字幕，
  通话文字写入同一聊天并标明来源）；来电全屏、拒绝 / 接听 / 回消息、未接留言。每引擎并发 1、不改推理参数。
- 测试：单测（移植 `mb-mobile` 的 `voice-input`、`call`、`incoming` 用例语义）；受管 `mb2-voice`、`mb2-call`（合成音频，不用真实麦克风）。
- 提交：`feat(MB2-12): 手机语音、通话与来电`

### MB2-13 Android 壳

- 内容：按 MB2-1 结论实现 `mobile-shell/android` 与 `src/mobile/native/bridge.ts`；本地通知（正文 / 锁屏隐藏 / 快捷回复 / 标为已处理）、
  来电全屏通知、前台服务保活、分享给 TA 大 sheet、返回键、权限、恢复刷新、通知深链接。本地离线构建，签名与 keystore 不入库。
- 测试：桥接口单测（H5 no-op）；MuMu + adb 场景记录（ADR-0011 App 项全部），真机项标“待真机”。
- 提交：`feat(MB2-13): Android 薄壳与系统能力`

### MB2-14 切换与清理

- 内容（每项先确认）：手机访问 `/` 时是否自动跳转 `/m/`（Owner 决定，默认不跳转、在电脑端窄窗显示“打开手机版”入口）；
  `/native/` 手机宿主与旧手机外壳的移除评估（核对仍有的消费者）；`mb-mobile` 分支归档说明；README、AGENTS 中手机相关描述更新。
- 验收：电脑端受管整组、手机受管整组、`check.sh` 全量。
- 提交：`chore(MB2-14): 手机入口切换与旧宿主清理`

### MB2-15 全量验收、视觉终审与合并准备

- 内容：同一候选上 `check.sh` 全量、Go 集成与 RLS、电脑端受管 17 项、手机受管整组（Mac 参考环境）、性能预算（第 3.6 节）、
  390 / 360 / 430 × 浅深截图矩阵与 Claude 终审；问题回到对应条目修复。
- 停止条件：全部通过、文档回填。合并 main 与部署由 Owner 另行决定。
- 提交：`docs(MB2-15): 手机端重建验收与回填`

## 8. 执行与调度约定（Codex）

- 调度者：Codex（`gpt-6-astra`，xhigh），负责派任务、审 diff、跑验证、集成到 `mobile-react-rebuild`、小步提交并立即推送当前跟踪分支（AGENTS.override.md）。
- 前端执行：Gemini 4 Argon High，经 `ai-run agy --model gemini-4-argon-high --dangerously-skip-permissions -p "/boost …"`；
  后端与构建契约由 Codex 自己实施或另起 Codex 子任务。外部 CLI 一律经 `ai-run` 包装并后台运行，日志路径写入任务记录。
- 每个条目一个 worktree（`../vc-mb2-<n>`），一个写入 owner；执行者只产生未提交 diff，由调度者审计后提交。
- 每条前端任务提示词需包含：AGENTS.md、ADR-0012、本文第 0–6 节与对应条目、DESIGN.md 第 17 节、相关选图路径、
  “先写失败测试再实现、不删弱测试、不改电脑端外观、只改条目文件范围”。
- 每个条目完成后：按 ID 回填 TODO「MB2」，记录提交、验证命令与 PASS / FAIL / NOT_RUN；截图入 `.review-queue/MB2-<n>/`。
- Docker 与产物：受管容器用 `com.vc.w03=managed` 标签，结束前回收本条目产生的测试卷、临时镜像与 worktree（OP-11）。

## 9. 暂停条件

以下情况暂停依赖部分，继续其他可独立完成的条目，并在 Backlog L 对应条目下写 **[问]**：

- ADR-0012 未批准（只可做 MB2-0、MB2-1）；
- 页面未选图；
- MB2-1 任一壳能力或性能指标不通过；
- 需要新增未登记许可的依赖、费用、iOS、推送服务、云打包或部署；
- 迁移冲突涉及已有数据库的数据处理；
- 电脑端出现无法在条目内修复的回归。

## 10. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 独立引擎在低端 Android web-view 上过重 | 进入对话慢、发热 | MB2-1 测基线；路由拆包、引擎预热、按需加载锁定模块 |
| 抽取共享逻辑时影响电脑端 | DR2 回归 | MB2-4 分批，每批跑电脑端受管与 Vitest；DOM 不变 |
| 复杂卡依赖桌面宽度 | 卡片显示错乱 | 全屏卡片页 + 卡片视口元信息；`mb2-cards` 覆盖 MVU / EJS |
| Capacitor 插件许可或能力不足 | MB2-13 受阻 | MB2-1 先核实；不通过回到 ADR 修订 |
| `mb-mobile` 迁移编号与数据 | 开发库迁移失败 | MB2-2 重排编号，核对 Mac 开发库后再切换 |
| 受管环境差异 | 结果不可比 | 合并门槛以 Mac 参考环境为准 |

## 11. 待 Owner 确认

1. 批准 ADR-0012（React 共用、单引擎、放弃 uni-app 界面）。
2. Android 壳首选 Capacitor，最终以 MB2-1 结论为准。
3. 性能预算（第 3.6 节）是否接受。
4. 待出图页面清单（第 5 节第 2 点）与出图安排。
5. MB2-14 中手机访问 `/` 的处理方式与 `/native/` 移除时机。
