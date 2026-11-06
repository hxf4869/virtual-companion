# 手机端 React 重建（MB2）方案与实施计划

- 日期：2026-11-06
- 决策依据：[ADR-0012](../decisions/0012-mobile-react-shared-engine.md)（Accepted，Owner 2026-11-06 问答确认，记录见第 11 节）
- 分支：`mobile-react-rebuild`（自 main `f502c4b9` 起）；每个条目一个 worktree、一个写入 owner
- 进度：只按 ID 回填 `TODO.md`「MB2 手机端 React 重建」；条目清单见 Backlog L 节

> 给执行者（Codex）：先读 AGENTS.md、ADR-0012、本文第 0–6 节，再读当前条目所在小节。第 3.8 节适配约束与第 3.9 节组件选型是硬规则；
> 第 8 节是执行与调度约定，第 9 节是暂停条件。

## 0. 结论

手机端与电脑端共用同一个 React 工程和同一个独立引擎，只新做手机壳、导航与需要手机交互的展示层；
用 Capacitor 打包安卓与 iOS App，二者同时交付。uni-app 界面与隐藏 ST 引擎不再继续。

决定性约束：引擎（提示词组装）与角色卡脚本（Tavern Helper / EJS / MVU）依赖浏览器 DOM，任何路线的 App 都必须包含 WebView。

| 路线 | 界面流畅度 | 与电脑端共用 | 引擎与卡片 | 工作量与风险 |
|---|---|---|---|---|
| **React + Capacitor（采用）** | 系统 WebView（安卓 Chromium、iOS WKWebView），靠性能治理达标 | 业务逻辑、组件、引擎全部共用 | 与界面同页，直接调用 | 最小；新功能只写一次 |
| React Native（Expo） | 原生列表、手势、键盘 | 只能共用 TS 业务逻辑，界面全部重写 | 放隐藏 WebView 跨桥调用，与隐藏 ST 同类问题 | 大；两套界面 |
| Flutter / 原生 | 最好 | 几乎不能共用 | 同样依赖 WebView | 最大；换语言重写 |
| 继续 uni-app | WebView（App 内也是 web-view 加载 `/m/`） | 不能共用 | 隐藏完整 ST 页面，冷启动 3.8–5.2 s | 每个功能写两遍 |

后路：业务逻辑必须与框架解耦（第 3.1 节）。若 MB2-1 实测 WebView 达不到第 3.6 节预算，可只把会话列表与对话页改为 React Native，其余不变。

## 1. 现状（2026-11-06 核实）

### 1.1 电脑端（main）

- `integrations/sillytavern/desktop-ui`：React 19 / Vite 8 / Base UI / TanStack Router + Query / zustand。
  功能区：`chat`、`characters`、`memory`、`inbox`、`story`、`settings`、`tavern`、`appearance`（含 `models`）。
- 路由：`/chat`、`/chat/$conversationKey`、`/characters`、`/characters/$avatar`、`/memory`、`/inbox`、`/story`、
  `/story/$runId`、`/settings`、`/settings/$category`、`/settings/tavern/$section`（`src/app/router.tsx`）。
- 断点：`data-chrome="narrow|compact|regular|wide"`（< 744 / 744–1179 / 1180–1599 / ≥ 1600，`src/shell/useChrome.ts`）。
  `narrow` 是电脑端的窄窗适配，不是手机产品。
- 引擎：`extension/vc-model-settings/desktop/standalone/{runtime.js,session.js,engine/**,cards/**}`，聊天准备入口与页面启动解耦。
- 主题：UX-35 极光 token、主题注册、全局与角色覆盖、气泡变体（`src/shell/usePreferences.ts` 等）。
- 构建：`scripts/build-desktop.mjs` → `server-plugin/virtual-companion/desktop/app/`（base `/desktop/`）。
  最大三个 JS 包 gzip 约 1.01 MB / 0.70 MB / 0.64 MB。
- 托管：`server-plugin/virtual-companion/lib/host-auth.js` 的 `serveMobile` 从 `mobile-dist/` 提供 `/m/`，缺产物时 503；
  2026-11-06 起过渡期手机直接使用电脑端窄窗版。

### 1.2 手机端（`origin/mb-mobile`，不合并）

- `mobile/`：uni-app 3 + Vue 3.4，约 1 万行；页面 `main/index`、`chat/conversation`、`character/detail`、`settings/index`。
- 完成 MB-0、MB-2–MB-5、MB-7–MB-10 的 H5 部分；MB-6 Android 壳未实施。比 main 多 18 个提交、落后 100 个。
- **非 `mobile/` 的改动**（需迁移，见 MB2-2）：
  - 迁移 `V283__foreground_inbox_call.sql`、`V284__configured_tool_turn_bounds.sql` —— 与 main 的
    `V283__reminder_cooldown_pruning.sql` **编号冲突**，迁移时改为 V284、V285（按实际顺序从当前最大版本顺延）；
  - Go：`httpapi/inbox.go`（`POST /api/v1/inbox/{eventId}/call`，`respondInboxCall`）、`proactive/*`（来电触发）、
    `voice/service.go`、`provider/openai/*`（MDL-2 真实模型响应、思考深度、工具预算）、`store/postgres/{inbox,proactive,notification}.go`；
  - OpenAPI / catalog / 生成物；server-plugin `chat-completions.js`、`tool-loop.js`、`responses-adapter.js`、`model-usage.js`、`host-auth.js`；
  - 受管场景 `mb-engine`、`mb-pages`、`mb-incoming`、`mb-shell`、`mb0-spike` 与语音场景改动；`Dockerfile.st` 的 `mobile-dist` 步骤。
- 可参考的框架无关逻辑：`mobile/src/voice/{input,call,incoming}.mjs`、`theme/background.mjs`、`chat/format.mjs`；`engine/*` 依赖隐藏 ST，不移植。

### 1.3 设计规范

DESIGN.md 第 17 节（MB-1，Owner 2026-11-02 选图，图在 `.review-queue/MB-1/images/`）给出手机 token、页面骨架、对话、通话与来电、背景、
Android 系统界面数值；第 1–3、6、8 节原则继续适用。“ST 视图”相关描述需随本计划修订。

## 2. 目标与非目标

**目标**

1. `/m/` 与安卓、iOS App 提供完整手机产品：电脑端现有全部功能可用（第 4 节矩阵），交互按 DESIGN.md 第 17 节与选定图。
2. 与电脑端共用一份聊天、一条生成链、一个引擎；复杂卡、MVU、EJS、剧情、酒馆配置在手机上原生可用，不依赖 ST 页面。
3. 性能达到第 3.6 节预算（验收门槛）。
4. 适配达到第 3.8 节约束与第 6 节设备矩阵（验收门槛）。
5. 系统能力：安卓按 ADR-0011 第 4、5 节；iOS 按 ADR-0012 第 6 点的限制范围。
6. 电脑端零回归：DR2 的 Vitest、离线测试、受管整组与 `dr2-layout` 保持通过。

**非目标**：上架应用商店、系统推送服务（含 APNs / VoIP）、云打包、部署、改变电脑端外观、在 Go 复制生成链、为手机维护第二份业务状态。

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
    features/<area>/        共用：业务逻辑 hooks、表单 schema、纯展示组件；电脑端专用布局组件保留原位
    mobile/                 新增：手机专用
      app/                  MobileApp、路由树（手机导航模型）
      shell/                标签栏、页面栈、大标题、设置大 sheet、安全区、键盘、返回
      pages/<area>/         各功能区的手机页面（组合 features 的 hooks 与组件）
      components/           手机专用组件（基于第 3.9 节选定的组件库封装，不自行实现交互）
      native/               App 壳桥接（H5 下为 no-op）
mobile-shell/                Capacitor 工程（android/、ios/、capacitor.config）
```

规则：

- `features/**` 不得 import `mobile/**` 或电脑端壳层，也不得依赖具体路由库 API（导航通过注入的回调）；
  `mobile/**` 可 import `features/**`、`data/**`、`runtime/**`、`design/**`、`components/**`。扩展 `tests/desktop-import-boundary.test.mjs` 强制。
- 业务逻辑先抽到 `features/<area>` 的 hooks / 纯函数，再由两端各自组合；抽取时电脑端行为与 DOM 不变（MB2-4）。
  这也是 React Native 后路的前提：hooks 与数据层不得依赖 DOM。
- 不新增第二套断点体系：手机入口固定为手机布局；尺寸差异按第 3.8 节用容器查询与设备类别。

### 3.2 构建与托管

- Vite 增加手机入口 `mobile.html`，`base: '/m/'`，输出 `server-plugin/virtual-companion/mobile/app/`（忽略不提交，
  由 `scripts/build-desktop.mjs` 同一入口生成，`npm test` / `check.sh` 的 `desktop-build` 同时构建两端）。
- `host-auth.js`：`/m/` 改为从 `mobile/app/` 提供，沿用 `serveMobile` 的路径校验、`nosniff`、assets 不可变缓存；
  页面入口注入与 `/` 相同的 `vc-account-id` / `vc-session-id` meta 并纳入 `pageEntry` 绑定逻辑；未构建时保持 503。
- `ops/deploy/v2/Dockerfile.st` 不需要单独的 H5 构建步骤，核对镜像内含 `mobile/app/`。
- 许可：新依赖登记 `scripts/checks/license-inventory.yaml`；构建产物 notices 覆盖手机入口。

### 3.3 导航与入口

- 一级页（标签栏）：聊天、角色、记忆、陪伴、剧情（DESIGN §17.3）；右上头像打开设置大 sheet。
- 二级页为页面栈（带侧滑返回）：对话、角色详情、记忆详情、剧情运行、设置子页、酒馆配置子页、全屏卡片页、通话页。
- 路由路径与电脑端同名参数（`$conversationKey`、`$avatar`、`$runId`、`$category`、`$section`），便于互链与通知深链接（`/m/chat/<key>`）。
  路由库随第 3.9 节组件选型确定（Ionic 方案用其页面栈路由；无样式方案用 TanStack Router）。
- 返回：浏览器历史为唯一来源；Android 返回键经壳桥映射为页面内返回；离开保护复用 `useLeaveGuard` 的逻辑。
- 标签栏在对话、通话、二级页与键盘弹起时隐藏。
- 入口：手机浏览器打开 `/` 不跳转；电脑端 `narrow` 档在设备为触屏手机时显示“打开手机版”入口（需出图）。
- App 内：最短边 ≥ 744 的设备（iPad、大平板）加载 `/`（电脑端布局），其余加载 `/m/`；旋转或分屏不改变已加载的入口。

### 3.4 引擎与复杂内容

- 手机入口与电脑端一样，经 `src/runtime/session-bridge.ts` 使用独立引擎；会话桥、草稿、冲突、阅读位置逻辑共用。
- 引擎延迟加载：会话列表与历史先由服务端直读显示，进入对话再准备运行模块；可在会话列表空闲时预热。
- 复杂卡：消息内 HTML / EJS / 状态栏由 `standalone/cards` 渲染到消息叶子；超出气泡宽度或需要交互的卡片，
  在消息位置显示占位行（DESIGN §17.4「互动卡片 · <卡片名>」），点开进入**全屏卡片页**（同一卡片实例的 React 宿主，不是 ST 视图），
  关闭回到对话并保持状态。显式授权门槛（DR2-14）不变。
- 剧情：用 `features/story` 的逻辑与舞台组件做手机布局（MB2-10）。
- 酒馆九类配置：用 `features/tavern` 的表单与编辑器做“列表 → 详情”手机布局（MB2-11）；代码编辑器在手机上提供全屏编辑模式。

### 3.5 主题与背景

- 沿用 UX-35 的主题注册、全局与角色覆盖；DESIGN §17.2 的手机语义 token 以 `[data-vc-device="mobile"]` 覆盖同名 `--vc-*`。
- 组件库的样式变量全部映射到这些语义 token，不使用组件库默认主题（AGENTS.md）。
- 组件变体按 §17.1（气泡 `tail`、标签栏 `floating`、图标 `line`、提示音 `soft`）。
- 场景背景（MB-10 能力）：按角色选择酒馆背景或上传图，模糊、亮度与渐隐按 §17.6；存储沿用 MB-10 的角色卡手机专用字段（迁移时核对字段名）。
- 玻璃模糊分级：设备性能档低或 `prefers-reduced-transparency` 时，`backdrop-filter` 降级为同色半透明底（由 token 控制，不改布局）。

### 3.6 性能预算（Owner 选定严格档；MB2-1 测基线，MB2-15 验收）

测量环境：安卓模拟器（MuMu 或 Android Studio 中端配置）与 Chromium 4× CPU 降速；iOS 模拟器与真机各一次；冷启动 = 清缓存、进程重启。

| 指标 | 目标 |
|---|---|
| `/m/` 首屏可交互（会话列表可见可点） | 冷 ≤ 1.5 s，热 ≤ 0.8 s |
| 进入对话到历史可见 | ≤ 0.3 s |
| 进入对话到可发送（引擎就绪） | 冷 ≤ 2.5 s，热 ≤ 1.5 s |
| 首屏 JS（gzip，不含引擎与按需路由） | ≤ 300 KB |
| 首屏 CSS（gzip） | ≤ 60 KB |
| 滚动与页面切换 | 无 > 50 ms 长任务，约 60 fps；侧滑返回跟手 |
| 引擎运行时额外堆 | ≤ 15 MB |

未达标先报告 Owner（第 9 节），可选措施：路由与组件拆包、引擎模块按需加载、空闲预热、Service Worker 缓存静态资源、
减少玻璃层数；仍不达标再评估会话列表与对话页的 React Native 后路。

### 3.7 App 壳（Capacitor，安卓 + iOS 同时）

- `mobile-shell/`：Capacitor 8 工程，`android/`（本地离线 Gradle 构建，APK 自行安装）与 `ios/`（Mac + Xcode，Owner 付费账号签名）。
  壳加载同源 `/m/`（远程 URL，不打包网页资源）；签名与 keystore、描述文件不入库。
- 网页侧 `src/mobile/native/bridge.ts` 定义唯一桥接口，H5 下全部为 no-op 或降级：
  `deviceClass()`、`safeArea()`、`onBack(handler)`、`requestPermission('mic'|'notify')`、`startKeepAlive()` / `stopKeepAlive()`、
  `notify({title, body, conversationKey, kind: 'message'|'call'})`、`onNotificationReply(handler)`、`onShare(handler)`、`onResume(handler)`、`haptic(kind)`。
- 候选插件（均已查 npm，许可需在 MB2-1 再核）：`@capacitor/{app,keyboard,status-bar,local-notifications,haptics}`（MIT，官方）、
  `@capacitor-community/safe-area`（MIT）、`@capawesome-team/capacitor-android-foreground-service`（MIT）、
  `@capgo/capacitor-share-target`（MPL-2.0，需登记；不合适时自写最小原生代码）。
- 平台差异（ADR-0012 第 6 点）：

| 能力 | 安卓 | iOS |
|---|---|---|
| 后台保活 | 前台服务，后台 30 分钟流式不断 | 无前台服务；约 30 s 后挂起，回前台提示“继续” |
| 本地通知与快捷回复 | 支持；锁屏隐藏正文 | 支持（App 存活时）；锁屏隐藏正文 |
| 来电 | 全屏来电通知 | App 打开时全屏来电页；后台为普通通知 + 未接留言 |
| 分享给 TA | 分享接收 | Share Extension（单独 target） |
| 麦克风 | WebView `getUserMedia` + 权限 | WKWebView `getUserMedia`（iOS 14.3+）+ 权限 |

- 壳内不放业务逻辑、不存业务状态、不直连 Go / TTS / ASR（ADR-0011 §4）。通知正文与锁屏可见性按 DESIGN §17.7。

### 3.8 适配约束（硬规则）

电脑端历史上的适配问题多来自手写布局与覆盖规则。手机端按以下规则实现，并由第 6 节的几何断言强制：

1. **不手写已有组件能提供的交互**：页面栈与侧滑返回、标签栏、底部弹层 / 抽屉、左滑操作、长按菜单、下拉刷新、长列表虚拟化、
   安全区、键盘避让、Toast、日期时间选择，全部使用第 3.9 节选定的库或 Capacitor 插件。确需补充时，先在 GitHub / 官方文档查现成实现并在 PR 说明中记录查找结果。
2. **视口与安全区**：高度用 `100dvh` / `100svh` 与组件库的安全区处理，不用 `100vh`；顶部、底部、左右使用 `env(safe-area-inset-*)`；
   刘海、灵动岛、安卓手势条与三键导航栏都不得遮挡内容或操作。
3. **键盘**：输入区随键盘上移且不被遮挡；安卓与 iOS 分别验证（Capacitor Keyboard 的 resize 模式在 MB2-1 选定）；键盘弹起时隐藏标签栏。
4. **尺寸**：内容区不写死高度；最小宽度 320 不横向滚动；触控目标 ≥ 44×44；文字可换行或按规范省略，不截断操作。
5. **字体缩放**：安卓系统字体 1.3× 与 iOS 动态字体最大常规档下布局不破坏（可滚动、不重叠、按钮可点）。
6. **组件内部用容器查询**，壳层只按设备类别（phone / foldable，见第 3.3 节）切换双栏，不读 `innerWidth` 分支逻辑。
7. **禁止**：负 margin 与逐元素位移修对齐、`!important` 覆盖、为单个截图追加覆盖规则（AGENTS.md 前端规则）。
8. **方向**：竖屏与横屏都可用；横屏时对话、通话、剧情舞台无横向滚动、输入区不被遮挡；旋转后保留滚动位置与草稿。
9. **深浅色与主题**：所有页面在浅、深、自动及角色主题覆盖下检查；不写字面颜色。
10. **减弱动态**：`prefers-reduced-motion` 时动效直接到终态。

### 3.9 组件选型（MB2-1 对比后定）

| 方案 | 组成 | 优点 | 待验证 |
|---|---|---|---|
| A | Ionic React 9（MIT）：`IonApp`、`IonTabs`、页面栈与侧滑返回、`IonModal` sheet、`IonItemSliding`、`IonRefresher`；聊天列表 react-virtuoso | 手机交互与安全区、键盘、iOS / 安卓风格现成，与 Capacitor 同团队 | 与电脑端 TanStack Router、Base UI 弹层共存；用 DESIGN token 完全覆盖默认样式；包体积 |
| B | 继续 Base UI + vaul（抽屉）+ motion（动效与页面过渡）+ @use-gesture（手势）+ react-virtuoso / @tanstack/react-virtual | 与电脑端技术栈一致、包小 | 页面栈与侧滑返回需组装，适配风险更高 |

评估标准（MB2-1 报告逐项给数据）：第 3.8 节各条的达成难度、第 3.6 节性能指标、包体积、与共享 features 的集成成本、
DESIGN 第 17 节还原度（同一页面两版截图对比）、维护活跃度与许可。结论报告 Owner 确认后写入本节并作为后续条目的唯一选型。

## 4. 功能对齐矩阵

优先级：P0 = 首个可用版本必需；P1 = 对齐电脑端；P2 = 系统能力 / 后续。

| 功能区 | 手机页面与交互（DESIGN §17 + 选定图） | 复用来源 | 优先级 | 条目 |
|---|---|---|---|---|
| 壳层 | 标签栏、大标题、页面栈、设置大 sheet、安全区、键盘、返回、极光背景、主题与角色覆盖、场景背景 | `shell/Aurora`、`usePreferences`、`useLeaveGuard`、`design/**` | P0 | MB2-5 |
| 会话列表 | 卡片会话行、左滑操作、草稿 / 语音 / 卡片预览、未读、搜索 | `features/chat/{Conversations,ConversationList,QuickSwitch}` 逻辑 | P0 | MB2-6 |
| 对话 | 分组气泡（tail）、日期条、引用、长按菜单、编辑 / 删除 / 重新生成 / 候选 / 停止 / 继续、搜索、阅读位置、草稿与失败保留、冲突处理 | `MessageList`、`MessageItem`、`MessageMenu`、`Composer`、`ConflictSheet`、`useReadingPosition`、`session-bridge` | P0 | MB2-6 |
| 富内容 | 图片大图、表情包、语音条、互动卡片占位 + 全屏卡片页、MVU / EJS | `MessageLeaf`、`VoiceBubble`、`EmojiPanel`、`standalone/cards`、lightbox | P0 | MB2-6 |
| 对话增强 | 建议回复、表情包面板、状态卡 / 陪伴状态、收藏、稍后提醒、记忆检查 | `Suggestions`、`EmojiPicker`、`StatusCard`、`ChatStatusCard`、`MemoryInspector` | P1 | MB2-6 |
| 角色 | 两列角色卡、详情、实例、导入、创建向导、人设编辑 | `features/characters/**` | P1 | MB2-7 |
| 记忆 | 选择胶囊、搜索、分段与计数、详情、纠正、删除、钉住、来源定位、时间线、收藏、提醒、日记 | `features/memory/**` | P1 | MB2-8 |
| 陪伴 | 消息卡、未接来电卡 + 回电、跟进分组、静默时段、投递记录、通知渠道、重新验证 | `features/inbox/**`；`respondInboxCall`（MB2-2b） | P1 | MB2-9 |
| 剧情 | 深蓝青极光、16:9 案件卡、开局向导、舞台、线索墙、NPC、证物、回档、结局记忆 | `features/story/**` | P1 | MB2-10 |
| 设置 | 账户、模型（提供方 / 用途绑定 / 用量 / 本地模型）、语音、通知、外观与主题、陪伴风格、表情包、数据权利、同意门 | `features/settings/**`、`features/models/**`、`features/appearance/**` | P1 | MB2-11 |
| 酒馆配置 | 九类：回复配置、提示词顺序、格式、世界书、人设、背景、界面、扩展 / Helper 脚本 / 正则、API 连接、角色卡 | `features/tavern/**` | P1 | MB2-11 |
| 语音 | 按住说话 / 上滑取消、语音条、朗读、转文字 | `VoiceRecorder`、`VoiceBubble`、`voice-logic.js`；参考 `mb-mobile` `voice/input.mjs` | P1 | MB2-12 |
| 通话与来电 | 全屏通话（§17.5）、开口打断、字幕；来电页、未接留言、回电 | 参考 `mb-mobile` `voice/{call,incoming}.mjs`；后端 MB2-2b | P2 | MB2-12 |
| 系统能力 | 保活、本地通知与快捷回复、来电通知、分享给 TA、返回键、权限、触感 | Capacitor 壳 + `mobile/native/bridge.ts` | P2 | MB2-13 |
| 入口 | 电脑端窄窗“打开手机版”入口；App 按设备类别选择入口 | `shell/**`（电脑端）、`mobile-shell` | P1 | MB2-14 |

## 5. 设计流程（严格按图）

1. **出图**：执行者（Codex 调度，可交 agy）按 DESIGN.md 第 17 节、MB-1 已选图风格与 `docs/product/v2-redesign/mobile/image-prompts.md` 的约束写提示词并出图。
   每个页面给浅色、深色各 1 张；有多个合理版式时给 A / B 两版。需出图的页面：
   剧情（列表、开局向导、舞台、线索墙、回档）、酒馆九类配置（列表、详情、代码编辑全屏）、收藏 / 提醒 / 日记、记忆时间线与纠正、
   陪伴投递与渠道、角色创建向导与人设编辑、模型提供方 / 用途绑定 / 用量、表情包管理、建议回复与状态卡、全屏卡片页、
   折叠屏双栏、横屏对话与通话、电脑端窄窗“打开手机版”入口。
   产出放 `.review-queue/MB2-0/images/<页面>/`，附 `PROMPTS.md`。
2. **审核**：Claude 审图（与 DESIGN 第 17 节数值、MB-1 已选图风格、可实现性、组件库能力是否一致），写 `REVIEW.md` 列出需重出的图。
3. **选图**：Owner 在 `PICKS.md` 选定；选定后由执行者把新增数值写入 DESIGN.md 第 17 节（只补充，不改已有数值）。
4. **实现与验收**：每个页面以选定图与 DESIGN 数值为准；视觉验收时把实现截图与选定图并排放入 `.review-queue/MB2-<n>/`，
   列出差异与原因。未选图的页面不进入实现；同一条目内已选图的部分可先做。

## 6. 验证体系

**设备矩阵**（受管场景视口与模拟器）：

| 类别 | 视口 / 设备 | 方向 |
|---|---|---|
| 小屏手机 | 320×568、360×780 | 竖 / 横 |
| 主流手机 | 390×844、393×852、412×915 | 竖 / 横 |
| 大屏手机 | 430×932 | 竖 / 横 |
| 折叠屏 / 小平板 | 673×841（展开）、768×1024 | 竖 / 横（双栏变体） |
| iPad / 大平板 | 820×1180、1024×1366 | App 内加载电脑端，验证入口选择与触控可用 |
| 附加条件 | 浅 / 深色、系统字体 1.3×、键盘弹起、安卓三键导航栏与手势条、刘海与灵动岛安全区 | — |

| 层级 | 内容 | 入口 |
|---|---|---|
| 单元 / 组件 | 手机壳、导航、各页组件；Happy DOM，先建 DOM 再导入 bundle | `npm --prefix integrations/sillytavern run test:desktop` |
| 导入边界 | `features` 不依赖 `mobile` / 电脑壳 / 路由库；hooks 不依赖 DOM | 扩展 `tests/desktop-import-boundary.test.mjs` |
| 离线 | 两端构建 + 既有离线测试 | `npm --prefix integrations/sillytavern test`、`bash scripts/check.sh` |
| 受管（手机） | `mb2-shell`、`mb2-layout`（设备矩阵 × 第 3.8 节几何断言：无横向滚动、标签栏 / 输入区 / 安全区不遮挡、触控目标 ≥ 44、字体 1.3×、键盘、旋转保持状态）、`mb2-chat`、`mb2-cards`、`mb2-pages`、`mb2-settings`、`mb2-voice`、`mb2-call`、`mb2-perf`（第 3.6 节指标） | `scripts/accept-managed.mjs --filter …`（场景放 `scripts/mobile-*-accept.mjs`，在 `scripts/managed-scenes.mjs` 注册） |
| 受管（电脑端回归） | DR2 整组 17 项 | 同上 |
| 后端 | Go 单测、集成、RLS | `go test`、`infra/db/run-go-store-tests.sh`、`infra/db/run-rls-tests.sh` |
| App | 安卓模拟器 + adb（Doze 模拟锁屏）；iOS 模拟器 + 真机；ADR-0011 MB-0 清单 App 项与第 3.7 节平台差异逐项记录 | MB2-1、MB2-13 记录 |
| 视觉 | 设备矩阵 × 浅深截图，实现与选定图并排；Claude 终审 | MB2-15 |

受管场景以 Mac 参考环境结果为合并门槛（AgentBox ARM Linux 环境已知有 9 项电脑端场景的环境性失败，见 TODO DR2-16）。
受管场景只用真实用户动作，不删节点、不改 pointer-events、不清背景层（AGENTS.md）。

## 7. 实施条目

依赖图：

```
MB2-0 ─► MB2-1 ─┬─► MB2-3 ─► MB2-4 ─► MB2-5 ─┬─► MB2-6 ─► MB2-12
（出图贯穿全程）  │                            ├─► MB2-7
MB2-2 ──────────┤（与 MB2-3 并行，后端 owner）  ├─► MB2-8
                │                            ├─► MB2-9（依赖 MB2-2b）
                │                            ├─► MB2-10
                │                            └─► MB2-11
                └─► MB2-13（依赖 MB2-1 壳结论、MB2-5、MB2-12）
全部 ─► MB2-14 ─► MB2-15
```

MB2-7 至 MB2-11 可并行（不同 `features/<area>` 与 `mobile/pages/<area>`）；共享文件（`mobile/app/**`、`mobile/shell/**`、`design/**`、
`mobile/components/**`）只由 MB2-5 的 owner 修改，其他条目需要改动时提交给该 owner 串行整合。每个页面开工前确认其选定图存在。

### MB2-0 规范与出图

- 内容：ADR-0011 头部标注第 1、2、4 节与“iOS 另行立项”被 ADR-0012 替代；DESIGN.md 第 17 节标题改为“手机界面”，删除 uni-app 与 ST 视图描述，
  补“全屏卡片页”“酒馆配置手机布局”“设备类别与双栏”“玻璃降级”规则（数值不变）；按第 5 节完成出图与 Claude 审核，交 Owner 选图。
- 验收：`git diff --check`；`.review-queue/MB2-0/` 含 `PROMPTS.md`、`REVIEW.md` 与全部图；Owner 填写 `PICKS.md`。
- 提交：`docs(MB2-0): 修订手机规范并交付待选设计图`（图在忽略目录，不提交）

### MB2-1 Spike：性能、组件选型与 App 壳可行性（只写验证代码，不做产品界面）

- 引擎与性能：最小 `mobile.html` 入口 + 会话列表 + 对话（复用电脑端逻辑），按第 3.6 节环境测全部指标；
  2 个复杂卡（MVU、EJS）在手机视口的渲染与全屏卡片页原型。
- 组件选型：方案 A（Ionic React）与方案 B（Base UI + vaul + motion + @use-gesture + react-virtuoso）各做同一页面的会话列表与对话页，
  按第 3.9 节评估标准给数据与截图。
- App 壳：Capacitor 最小工程（安卓 + iOS）加载 `/m/`，逐项验证：Cookie 保持、`getUserMedia`、软键盘与 resize 模式、返回键 / 侧滑返回、
  安卓前台服务 30 分钟流式不断、本地通知快捷回复回传（两端）、系统分享（安卓分享接收、iOS Share Extension）、安全区、恢复刷新；
  核对每个插件的许可与维护状态。
- 产出：`docs/planning/2026-11-xx-mb2-spike-report.md`（指标数值、通过 / 不通过、组件选型推荐、插件清单与许可、待真机项、预算是否需调整）。
  Spike 代码放任务 worktree，不合入产品目录。**报告完成后停止，等 Owner 确认。**
- 提交：`docs(MB2-1): 手机性能、组件选型与 App 壳可行性报告`

### MB2-2 后端与契约迁移（后端 owner：Codex；与 MB2-3 并行）

- 从 `origin/mb-mobile` 移植非 `mobile/` 改动，分两条提交（一个条目最多一个迁移）：
  - **MB2-2a MDL-2**（`bedf0320` 等）：OpenAI 适配层真实响应兼容、思考深度、工具预算配置；`V284__configured_tool_turn_bounds.sql` 按顺序重编号；
    server-plugin `chat-completions.js`、`tool-loop.js`、`responses-adapter.js`、`model-usage.js`。
  - **MB2-2b 来电后端**：`V283__foreground_inbox_call.sql` 重编号；`respondInboxCall`、`proactive` 来电触发、`voice/service.go`、
    `store/postgres/{inbox,proactive,notification}.go`；OpenAPI / catalog 先行，生成物用工具生成。
- 不移植：`mobile/**`、`mb-*` 受管场景（MB2 重写）、`Dockerfile.st` 的 `mobile-dist` 步骤、`host-auth.js` 的 `mobile-dist` 相关改动。
- 逐文件与 main 当前实现对比，冲突以 main 语义为准；迁移从当前最大版本顺延，同步 `migrate_test.go` 计数。
- 风险核对：Mac 开发数据库若已执行 `mb-mobile` 的 V283 / V284，切换前备份并给出处理方案，不手改线上数据。
- 验收：`bash scripts/check.sh --quick`、Go 单测、`infra/db/run-go-store-tests.sh`、`infra/db/run-rls-tests.sh`；
  受管 `catalog-admin`、`hl-proactive`、`voice-chat`、`w11-tool-meter` 整组。
- 提交：`feat(MB2-2a): 迁移 MDL-2 模型响应与工具预算`、`feat(MB2-2b): 迁移角色来电后端与契约`

### MB2-3 构建与托管

- 内容：第 3.2 节；`mobile.html` + `src/mobile/app/MobileApp.tsx` 空壳；host-auth 改为从 `mobile/app/` 提供 `/m/` 并注入身份 meta；
  导入边界测试扩展；`check.sh` 的 `desktop-build` 覆盖两端；首屏包体积检查（超过第 3.6 节预算即失败）。
- 测试：host-auth 单测（路径穿越、未构建 503、身份 meta、`pageEntry` 绑定与 401 重定向）；电脑端 Vitest 与离线全量不回归。
- 提交：`feat(MB2-3): 手机入口构建与 /m/ 同源托管`

### MB2-4 共享层抽取（电脑端零行为变化）

- 内容：按第 4 节矩阵，把被手机复用的业务逻辑抽为 `features/<area>/use*.ts` hooks 与无布局假设的展示组件；
  导航改为注入回调；hooks 不依赖 DOM。按功能区分批提交（chat、characters、memory、inbox、story、settings、tavern）。
- 约束：电脑端 DOM、类名、交互与截图不变；既有测试不删弱；每批跑 Vitest、离线全量与受影响电脑端受管场景。
- 提交：`refactor(MB2-4-<area>): 抽取<功能区>共享逻辑`

### MB2-5 手机壳

- 内容：第 3.3、3.5、3.8 节；按选定组件方案实现标签栏、大标题、页面栈与侧滑返回、设置大 sheet、安全区、键盘、返回、角标、离开保护、
  主题与角色覆盖、极光与场景背景（含上传、模糊、渐隐）、玻璃降级、设备类别与折叠屏双栏骨架。
- 测试：组件测试；受管 `mb2-shell`、`mb2-layout`（全设备矩阵）。
- 提交：`feat(MB2-5): 手机壳层、导航与主题`

### MB2-6 聊天（P0）

- 内容：矩阵“会话列表”“对话”“富内容”“对话增强”；全屏卡片页；草稿、失败保留、冲突、阅读位置、搜索、候选、停止 / 继续；横屏对话。
- 测试：组件测试；受管 `mb2-chat`（发送、流式、停止、重新生成、候选、编辑、删除、引用、搜索、草稿与失败保留、F2 冲突、刷新与旋转恢复）、
  `mb2-cards`（MVU 空会话开场白、EJS、状态栏、全屏卡片页往返状态一致、普通内容不获得执行权限）、`mb2-perf`。
- 提交：`feat(MB2-6): 手机聊天与互动卡片`

### MB2-7 角色与人设

- 内容：两列角色卡、详情、实例、导入、创建向导、人设编辑；折叠屏双栏。
- 测试：组件测试；受管 `mb2-pages` 角色段。
- 提交：`feat(MB2-7): 手机角色与人设`

### MB2-8 记忆

- 内容：选择胶囊、搜索、分段与计数、详情、纠正、删除、钉住、来源定位跳回对话、时间线、收藏（分页）、提醒、日记。
- 测试：组件测试；受管 `mb2-pages` 记忆段（含来源定位与收藏分页）。
- 提交：`feat(MB2-8): 手机记忆、收藏、提醒与日记`

### MB2-9 陪伴

- 内容：消息卡、未接来电卡与回电（依赖 MB2-2b）、跟进分组、静默策略、投递记录、通知渠道、重新验证。
- 测试：组件测试；受管 `mb2-pages` 陪伴段、来电留言回电。
- 提交：`feat(MB2-9): 手机陪伴与收件箱`

### MB2-10 剧情

- 内容：案件卡列表、开局向导、舞台（手机竖屏与横屏）、线索墙、NPC、证物翻面、回档、结局记忆；减弱动态时直接终态。
- 测试：组件测试；受管 `mb2-pages` 剧情段（开局、行动、回档、迟到响应）。
- 提交：`feat(MB2-10): 手机剧情`

### MB2-11 设置与酒馆配置

- 内容：设置大 sheet 下的账户、模型、语音、通知、外观与主题、陪伴风格、表情包、数据权利、同意门；酒馆九类“列表 → 详情”布局，
  代码编辑器全屏模式，409 冲突与草稿保护沿用电脑端。
- 测试：组件测试；受管 `mb2-settings`（模型用途保存竞态、预算不足提示、重新验证、酒馆预设另存与世界书引用清理、409）。
- 提交：`feat(MB2-11): 手机设置与酒馆配置`

### MB2-12 语音、通话与来电

- 内容：按住说话 / 上滑取消、语音条与朗读、转文字；全屏通话（分段收音 → Go ASR → 引擎短回复 → Go TTS，开口打断，字幕，
  通话文字写入同一聊天并标明来源）；来电页、拒绝 / 接听 / 回消息、未接留言。每引擎并发 1、不改推理参数。
- 测试：单测（移植 `mb-mobile` 的 `voice-input`、`call`、`incoming` 用例语义）；受管 `mb2-voice`、`mb2-call`（合成音频，不用真实麦克风）。
- 提交：`feat(MB2-12): 手机语音、通话与来电`

### MB2-13 App 壳（安卓 + iOS）

- 内容：按 MB2-1 结论实现 `mobile-shell/`（android、ios）与 `src/mobile/native/bridge.ts`；按第 3.7 节平台差异实现
  本地通知（正文 / 锁屏隐藏 / 快捷回复 / 标为已处理）、来电通知（安卓全屏，iOS 前台来电页）、安卓前台服务保活、iOS 回前台“继续”、
  分享给 TA（安卓分享接收、iOS Share Extension）、返回键、权限、恢复刷新、通知深链接、设备类别入口选择（iPad / 大平板加载电脑端）。
- 构建：安卓本地离线 Gradle 出 APK；iOS 在 Mac + Xcode 用 Owner 账号签名；构建步骤写入 `mobile-shell/README.md`，签名材料不入库。
- 测试：桥接口单测（H5 no-op）；安卓模拟器 + adb 与 iOS 模拟器 + 真机的逐项记录，真机项标注。
- 提交：`feat(MB2-13): 安卓与 iOS App 壳及系统能力`

### MB2-14 入口与清理

- 内容：电脑端窄窗“打开手机版”入口（按选定图）；`/native/` 手机宿主与旧手机外壳移除（**须在 MB2-15 验收通过且 Owner 确认后执行**，
  先核对仍有的消费者）；`mb-mobile` 分支归档说明；README、AGENTS、ADR-0011 中手机相关描述更新。
- 验收：电脑端受管整组、手机受管整组、`check.sh` 全量。
- 提交：`feat(MB2-14): 手机版入口`、`chore(MB2-14): 移除 /native/ 手机宿主`（两次提交，后者在 Owner 确认后）

### MB2-15 全量验收、视觉终审与合并准备

- 内容：同一候选上 `check.sh` 全量、Go 集成与 RLS、电脑端受管 17 项、手机受管整组（Mac 参考环境）、性能预算、设备矩阵截图与选定图对照、
  App 两端逐项记录；Claude 终审；问题回到对应条目修复。
- 停止条件：全部通过、文档回填。合并 main 与部署由 Owner 另行决定。
- 提交：`docs(MB2-15): 手机端重建验收与回填`

## 8. 执行与调度约定（Codex）

- 调度者：Codex（`gpt-6-astra`，xhigh），负责派任务、审 diff、跑验证、集成到 `mobile-react-rebuild`、小步提交并立即推送当前跟踪分支（AGENTS.override.md）。
- 前端执行：Gemini 4 Argon High，经 `ai-run agy --model gemini-4-argon-high --dangerously-skip-permissions -p "/boost …"`；
  后端、构建与 App 壳由 Codex 实施或另起 Codex 子任务。外部 CLI 一律经 `ai-run` 包装并后台运行，日志路径写入任务记录。
- 每个条目一个 worktree（`../vc-mb2-<n>`），一个写入 owner；执行者只产生未提交 diff，由调度者审计后提交。
- 每条前端任务提示词需包含：AGENTS.md、ADR-0012、本文第 0–6 节与对应条目、DESIGN.md 第 17 节、选定图路径、
  “先写失败测试再实现、不删弱测试、不改电脑端外观、只改条目文件范围、遵守第 3.8 / 3.9 节”。
- 审 diff 时逐项检查第 3.8 节：出现手写页面栈 / 手势 / 弹层 / 虚拟列表 / 安全区处理、`100vh`、负 margin、`!important`、读 `innerWidth`，一律退回。
- 每个条目完成后：按 ID 回填 TODO「MB2」，记录提交、验证命令与 PASS / FAIL / NOT_RUN；截图入 `.review-queue/MB2-<n>/`。
- Docker 与产物：受管容器用 `com.vc.w03=managed` 标签，结束前回收本条目产生的测试卷、临时镜像与 worktree（OP-11）。

## 9. 暂停条件

以下情况暂停依赖部分，继续其他可独立完成的条目，并在 Backlog L 对应条目下写 **[问]**：

- MB2-1 报告完成（固定停点，等 Owner 确认组件选型与预算）；
- 页面未选图；
- 任一性能指标或 App 壳能力不通过；
- 需要新增未登记许可的依赖、费用、推送服务、云打包、上架或部署；
- 迁移冲突涉及已有数据库的数据处理；
- 电脑端出现无法在条目内修复的回归；
- `/native/` 移除前（须 Owner 确认）。

## 10. 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| 独立引擎在低端 WebView 上过重 | 进入对话慢、发热 | MB2-1 测基线；拆包、按需加载、空闲预热、缓存；仍不达标评估 React Native 后路 |
| 玻璃模糊在手机 WebView 上掉帧 | 滚动卡顿 | 第 3.5 节降级；`mb2-perf` 覆盖 |
| 抽取共享逻辑时影响电脑端 | DR2 回归 | MB2-4 分批，每批跑电脑端受管与 Vitest；DOM 不变 |
| 复杂卡依赖桌面宽度 | 卡片显示错乱 | 全屏卡片页；`mb2-cards` 覆盖 MVU / EJS |
| 组件库与现有栈冲突 | 集成成本高 | MB2-1 双方案对比后定 |
| iOS 后台与来电限制 | 体验差异 | ADR-0012 第 6 点如实说明；不接推送 |
| 插件许可或能力不足 | MB2-13 受阻 | MB2-1 先核实；不合适时自写最小原生代码 |
| `mb-mobile` 迁移编号与数据 | 开发库迁移失败 | MB2-2 重编号，核对 Mac 开发库后再切换 |
| 受管环境差异 | 结果不可比 | 合并门槛以 Mac 参考环境为准 |

## 11. Owner 决定记录（2026-11-06 问答）

1. 技术路线：React + Capacitor；性能预算作门槛，达不到时会话列表与对话页可评估 React Native。
2. 安卓与 iOS 同时做；Owner 已有或将开通付费 Apple 开发者账号。
3. 安卓：本机构建 APK 自行安装，不上架。
4. iOS 首版不接推送：后台为普通通知，App 打开时显示来电页。
5. 手机浏览器打开 `/` 不跳转，电脑端窄窗放“打开手机版”入口。
6. 出图交执行者，Claude 审核后 Owner 选定；开发严格按图。
7. 适配严格约束，优先使用现成组件与开源实现，少造轮子（第 3.8、3.9 节）。
8. 组件选型：Ionic React 与无样式组合在 MB2-1 对比后定。
9. 性能预算：严格档（第 3.6 节）。
10. 设备范围：手机竖屏 320–430、手机横屏、折叠屏 / 小平板（双栏），iPad / 大平板在 App 内用电脑端；常见情况都要考虑。
11. `/native/`：手机版验收通过并经 Owner 确认后移除。
