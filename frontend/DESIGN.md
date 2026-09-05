---
name: Virtual Companion — Warm Familiarity / 熟悉的温度
description: 面向普通用户的暖色、安静、对话优先的跨端设计系统，以及同品牌的功能型 H5 管理后台。
status: 2026-09-01 frontend-redesign-baseline
platforms:
  consumer: [uni-app-h5, future-mp-weixin]
  admin: [uni-app-h5-only]
component-foundation: Wot UI v2
color-mode: light
colors:
  canvas: "#F7F3EC"
  surface: "#FFFFFF"
  surface-soft: "#EFE8DC"
  ink: "#25231F"
  ink-muted: "#6E6A63"
  hairline: "#DDD5C8"
  primary: "#8A3621"
  primary-pressed: "#6F2818"
  secondary: "#58766F"
  success: "#39765B"
  warning: "#99621D"
  error: "#B43B3B"
rounded:
  control: "10px"
  card: "12px"
  hero: "16px"
  full: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  7: "32px"
  8: "40px"
  9: "48px"
---

# Design System：熟悉的温度

## 1. 设计北极星

产品应像回到一处熟悉、安静、有人在等你的空间。暖象牙底色降低工具感，炭黑文字保证阅读，陶土色只
强调当前最重要的动作，鼠尾草绿提供克制的辅助层级。页面有温度，但不扮演真人，也不使用典型的
“AI 紫色渐变、霓虹光、玻璃卡片”来证明自己是 AI 产品。

消费者端借鉴 Claude 的温暖编辑感与 Airbnb 的清楚层级、自然留白和单一阴影层级；只吸收原则，不复制
页面或品牌资产。管理后台沿用相同的颜色与文字气质，收束为高密度、任务优先的 **Warm Control Room**。

参考来源：

- [awesome-design-md / Claude](https://github.com/voltagent/awesome-design-md/blob/main/design-md/claude/DESIGN.md)
- [awesome-design-md / Airbnb](https://github.com/voltagent/awesome-design-md/blob/main/design-md/airbnb/DESIGN.md)
- [Design.md 约定](https://github.com/VoltAgent/design-md/blob/main/README.md)

## 2. 设计权威

实现页面前必须依次读取：

1. `PRODUCT.md`：产品范围和行为边界。
2. `docs/product/frontend-redesign.md`：页面职责、流程与状态。
3. 本文件：视觉、组件、响应式和工程约束。
4. `docs/design/stitch-reference.md`：已验收页面的构图参考。

旧页面、旧 CSS、历史截图和 Stitch 自动生成代码都不是新版设计权威。Stitch 参考图如果违反本文的
安全区、可访问性、真实数据或跨端规则，以本文为准并修正后再实现。

## 3. 体验原则

### 必须

- 每屏一个主要任务、一个最突出动作。
- 先展示用户能理解的结果，再按需提供低频设置。
- 使用自然简体中文，持续可见的字段标签不能由占位符替代。
- 列表优先于卡片墙，分隔线优先于层层阴影。
- 状态靠文字和结构表达，颜色只做辅助。
- 真实能力才有入口；空状态不使用假数据填满页面。

### 禁止

- 紫蓝渐变、霓虹、玻璃拟态、发光边框、背景噪点和装饰性 3D。
- 每段内容一个卡片、卡片嵌套卡片、首页功能宫格和后台 KPI 卡片墙。
- 超大营销标题、无意义英文眉题、全大写标签或为了“高级感”降低正文对比度。
- 在消费者页面展示模型、Token、Prompt、路由、Provider、内部 ID、状态码或原始错误。
- 为尚未开放的功能保留灰色入口、锁图标或“即将推出”。
- 用 Emoji、图标字体、Material Symbols 连字名称或单独英文单词充当产品图标。

## 4. 设计令牌

代码中的产品令牌统一以 `--vc-*` 命名。组件和页面只能引用语义令牌，不能散落十六进制颜色。

### 4.1 颜色

| 语义 | CSS 令牌 | 值 | 用途 |
| --- | --- | --- | --- |
| 页面底色 | `--vc-color-canvas` | `#F7F3EC` | 消费者页面背景 |
| 主表面 | `--vc-color-surface` | `#FFFFFF` | 输入、浮层、必要卡片 |
| 柔和表面 | `--vc-color-surface-soft` | `#EFE8DC` | 用户消息、选中区、低强调区 |
| 正文 | `--vc-color-ink` | `#25231F` | 标题与正文 |
| 次要文字 | `--vc-color-ink-muted` | `#6E6A63` | 时间、说明、辅助信息 |
| 分隔线 | `--vc-color-hairline` | `#DDD5C8` | 1px 边界与列表分隔 |
| 主色 | `--vc-color-primary` | `#8A3621` | 每屏唯一主动作、当前导航 |
| 主色按下 | `--vc-color-primary-pressed` | `#6F2818` | pressed 状态 |
| 辅助色 | `--vc-color-secondary` | `#58766F` | 次级状态与克制点缀 |
| 成功 | `--vc-color-success` | `#39765B` | 成功事实 |
| 警告 | `--vc-color-warning` | `#99621D` | 需要注意但可继续 |
| 错误 | `--vc-color-error` | `#B43B3B` | 错误与危险动作 |

管理后台覆盖 `--vc-color-canvas: #F3EFE8`、`--vc-color-surface-soft: #F8F5F0`、
`--vc-color-hairline: #D9D1C5`；其余品牌色保持一致。

正文与交互文字必须达到 WCAG AA 对比度。浅色标签不能承载唯一状态文字；成功、警告、错误都要配
简体中文。

### 4.2 字体

统一字体栈：

```css
font-family: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB",
  "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif;
```

| 层级 | 字号 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| 页面标题 | 28 / 36px | 600 | 首页问候、登录主标题 |
| 普通页标题 | 24 / 32px | 600 | 全部会话、我的 |
| 区块标题 | 18 / 26px | 600 | 最近对话、设置分组 |
| 正文 | 16 / 26px | 400 | 消费者正文、消息 |
| 控件 | 16 / 24px | 500 | 按钮、输入 |
| 辅助 | 14 / 22px | 400 | 时间、说明 |
| 注释 | 12 / 18px | 400 | 非关键元信息 |
| 后台正文 | 14 / 22px | 400 | 表格与详情 |

中文标题不使用负字距。正文最小 14px；关键流程、输入和聊天正文使用 16px。文本允许自然换行，禁止用
固定窄列把中文逐字挤成竖排。

### 4.3 间距、圆角与深度

- 4px 基准：`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48px`。
- 消费者页面左右 gutter：20px；紧凑小屏可以降到 16px。
- 控件圆角 10px，内容卡 12px，首页主视觉 16px，状态胶囊使用全圆角。
- 管理后台控件和面板使用 8px 圆角。
- 只允许一档浮层阴影：`0 8px 24px rgb(37 35 31 / 10%)`，用于弹窗、抽屉和浮动菜单。
- 普通卡片、列表、底部导航和后台面板使用底色或 1px 分隔线，不叠加阴影。

## 5. 组件策略

### 5.1 基础层：Wot UI v2

当前 uni-app Vue 3 工程保留，实施时引入 `@wot-ui/ui` 的 Wot UI v2 兼容版本。Wot UI 提供跨端基础
行为，不定义产品页面长相。

实现时以 [Wot UI 官方文档](https://wot-ui.cn/)、[自定义主题](https://wot-ui.cn/guide/custom-theme.html)
和 [v2 迁移说明](https://wot-ui.cn/guide/migration-v2.html) 为准，不从旧页面猜测组件 API。

适合直接作为基础层的能力包括：Button、Input、Form、Popup、Dialog、Toast、Loading、Tabs、Switch、
Picker 等。所有跨页面产品语义通过自有组件封装，页面不复制长串 Wot 属性和样式覆盖。

Wot UI 接入规则：

- 产品令牌在 `theme/tokens.scss` 定义；只在 `theme/wot-adapter.scss` 映射到当前安装版本的
  `--wot-*` 变量。
- `App.vue` 根部使用 ConfigProvider；`page` 与 `.wd-root-portal` 同步基础主题和字体。
- 需要 Toast、MessageBox 等宿主的页面显式声明宿主，兼容 H5 与微信小程序生命周期。
- 禁止在业务页面使用 `:deep(.wd-*)`、全局覆盖 Wot 内部类或靠 `!important` 修组件。
- 禁止引入另一套全量 UI 库来补后台；确有缺失时先做最小 `admin-*` 组件。

### 5.2 产品组件层

组件名前缀统一为 `vc-`。组件接受业务状态和语义属性，不接受页面随意注入整块 CSS。

| 领域 | 组件 |
| --- | --- |
| 认证 | `vc-auth-shell`、`vc-auth-field`、`vc-email-code-field`、`vc-totp-code-input`、`vc-authenticator-setup`、`vc-recovery-code-card`、`vc-approval-pending` |
| 首页 | `vc-home-hero`、`vc-continue-conversation-card`、`vc-home-section`、`vc-session-preview`、`vc-bottom-navigation` |
| 会话 | `vc-session-list`、`vc-session-row`、`vc-session-summary`、`vc-session-actions` |
| 聊天 | `vc-chat-shell`、`vc-message-list`、`vc-message-bubble`、`vc-chat-composer`、`vc-context-prompt` |
| 我的 | `vc-profile-header`、`vc-settings-section`、`vc-security-summary`、`vc-authenticator-status` |

约束：

- 首页主卡是自有组件，不能用通用 `wd-card` 拼出产品身份。
- TOTP 验证码必须由真实 input 支撑粘贴、自动填充和键盘访问，不能使用支付密码键盘模拟。
- 会话默认用开放列表，不默认加入滑动操作。
- 导航和核心动作图标由 `vc-icon` 渲染仓库内的内联 SVG；不依赖网络字体或图标字体。

### 5.3 管理后台组件层

后台使用 `admin-` 前缀的自有骨架：`admin-shell`、`admin-sidebar`、`admin-header`、
`admin-queue`、`admin-data-table`、`admin-detail-panel`、`admin-status-row`。表单、按钮、弹窗等基础交互
仍复用 Wot UI。

## 6. 消费者端布局

### 6.1 应用骨架

- 设计基准宽度为 390px；H5 在宽屏上居中，内容最大宽度 520px。
- 页面使用 `min-height: 100dvh`；不写死设备高度。
- 页面只有一个纵向滚动所有者。固定头部、底部导航和聊天输入区不能再创建互相竞争的页面滚动。
- 所有 flex/grid 子项默认 `min-width: 0`；所有元素使用 `box-sizing: border-box`。
- 横向滚动只能出现在明确的横向内容组件，整个页面绝不能出现横向滚动条。

### 6.2 底部导航——强制规范

底部导航固定三项“首页 / 聊天 / 我的”，任何页面不得增减或改变顺序。

- 容器宽度始终等于应用视口宽度，H5 宽屏时与最大 520px 的应用壳对齐。
- 使用 `display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));`。
- 可见导航层高度 52px；真实设备只在其下方动态增加 `env(safe-area-inset-bottom, 0px)`，不再附加固定安全区或额外白色空条。
- 导航层和安全区均使用 `--vc-color-canvas`，顶部使用 1px `--vc-color-hairline`，不做纯白大底座。
- 每项 `width: 100%; min-width: 0; height: 52px`，图标 20px，标签 12/16px，图标与标签间距 1–2px。
- 激活态只使用主色和 600 字重；焦点环和点击反馈必须留在自己的三等分单元内。禁止下划线、放大、负 margin 或绝对定位越界。
- 页面滚动内容底部留白至少为 `64px + safe-area-inset-bottom`，即 52px 导航与 12px 呼吸空间。
- 不允许通过 `overflow: hidden` 掩盖错误；图标、文字、焦点环本身必须完整位于画布内。

以下任一情况都视为阻断缺陷：图标被截、标签超出画布、第三项变窄、激活态跨单元、内容被导航遮住。

### 6.3 聊天底部区域

- 底部导航仍占 `52px + safe-area`。
- 输入区固定在导航上方，最小高度 64px，可随多行输入自然增高，但应设置合理最大高度后内部滚动。
- 消息列表底部留白等于“输入区当前高度 + 底部导航高度 + 16px”。
- 键盘出现时依赖 uni-app 提供的视口/键盘能力更新布局，不使用猜测设备型号的固定像素补丁。
- 发送按钮、语义标签、加载态和失败重试不能移出输入区边界。

### 6.4 中文与图标防错

- 文本容器必须有真实可用宽度；flex 子项设置 `min-width: 0`。
- 正文使用自然换行，长邮箱和不可分割字符串才使用 `overflow-wrap: anywhere`。
- 页面不得渲染 `format_quote`、`home`、`person` 等图标字体连字文本。
- 核心图标使用有明确 `viewBox` 的本地 SVG，并提供可访问名称；纯装饰图标从辅助技术中隐藏。

## 7. 代表页面构图

### 首页

- 顶部问候与陪伴者身份。
- 一个主要的“继续上次对话”区域。
- “最近对话”采用紧凑列表，不重复堆叠大卡。
- “全部会话”为清楚的文本入口。
- 空状态将主动作替换为“开始第一次对话”。

### 登录与验证

- 单列窄表单，字段标签持续可见。
- 登录字段使用“账号”，接受用户名或邮箱；不要在客户端用邮箱格式校验拦截合法用户名。
- 主按钮占满内容宽度；说明文字与表单保持 16–24px 间距。
- 登录步骤不显示底部导航。
- 6 位验证码的视觉分格不破坏真实 input、粘贴和自动填充。
- “信任此设备 90 天”使用紧凑的单行复选控件，默认未选中；不为它增加大卡片、弹窗或技术说明。

### 聊天

- 陪伴者消息开放排版，用户消息使用柔和燕麦色气泡。
- 时间和状态降低权重；正文对比度不降低。
- 不用大头像墙、消息卡片套卡片或背景插画干扰长文本阅读。

### 我的

- 使用分组列表，不使用功能宫格。
- 安全状态采用文字事实和次级颜色，不展示风险分数。
- 可信设备作为安全分组内的普通列表展示，提供到期事实和撤销动作，不建立新的顶级导航。

## 8. 管理后台布局

- 目标桌面视口：1280px 及以上；设计验收主视口为 1440 × 900。
- 固定 232px 左侧栏，固定 72px 顶栏，内容区 24–32px 内边距。
- 导航固定四项：“注册审核 / 账号 / 模型与路由 / 运行状态”。全部使用简体中文。
- 审核页采用队列 + 详情双栏；表格行高约 48px，操作留在详情区。
- 面板使用白色或柔和表面与 1px 分隔，不使用装饰性阴影。
- 900px 以下侧栏变为抽屉，双栏改为列表进入详情；后台仍不为手机小程序设计。
- 后台可以使用真实专业术语，但不能中英文随意混排，也不能暴露与操作无关的内部实现。
- 禁止假 KPI、假趋势图、假风险分数和没有真实探针的数据。

## 9. 交互与动效

- 点击反馈 120–160ms，页面内显隐和抽屉 180–220ms。
- 只动画 `opacity` 与 `transform`；不动画大面积模糊、阴影或布局尺寸。
- 系统启用 `prefers-reduced-motion` 时移除非必要位移。
- 所有触摸目标至少 44 × 44px；主要按钮建议 48px 高。
- 键盘焦点使用 2px 高对比焦点环，不能被圆角容器或 `overflow` 截断。
- 错误提示与字段建立语义关联；状态不能只靠 Toast，也不能只靠颜色。

## 10. AI 开发协议

AI 实现任何页面时必须遵守以下顺序：

1. 先写出该页面在产品文档中的唯一任务、主动作和允许状态。
2. 对照 Stitch 参考确认构图，但不复制其生成 HTML/CSS。
3. 先选择 Wot UI 基础能力，再选择现有 `vc-*` / `admin-*` 组件；没有消费者时不新增通用抽象。
4. 页面只能使用本文件令牌；禁止临时发明颜色、圆角、阴影和第二套导航。
5. 不继承旧页面信息架构，不顺手保留旧入口，不增加未来功能占位。
6. 实现加载、空内容、失败、正常内容；只为真实可达状态增加分支。
7. 完成后进行截图和交互验收，再进入下一页。

AI 不得自行决定以下事项：新增顶级页面、改变三项底部导航、开放注册、增加认证方式、引入另一套 UI 库、
改变品牌主色、加入深色模式、让后台进入微信小程序。确需改变时先更新产品/设计决策并取得确认。

## 11. 截图与构建验收

### 消费者 H5

每个核心页面至少检查 320 × 568、390 × 844、430 × 932：

- 无横向滚动、逐字竖排、截字或焦点环裁切。
- 三项底部导航等宽，图标和标签全部在画布内。
- 页面内容不被安全区、导航、聊天输入区或键盘遮挡。
- 浏览器字体加载失败时仍不会出现图标名称文本。

### 管理后台 H5

至少检查 1280 × 800 和 1440 × 900：侧栏、表格、详情和操作区均完整；简体中文不截断；没有整页横向
滚动。窄于 900px 时检查抽屉与单栏详情。

### 微信小程序（启用目标后）

- 消费者端可以构建并完成登录、首页、聊天冒烟。
- 管理后台路由、样式、DOM API 和 H5 专用依赖不进入产物。
- Wot UI 主题、反馈宿主、SVG 图标和安全区行为与 H5 保持一致。

## 12. 当前非目标

- 深色模式、主题切换、品牌插画库和复杂动效。
- 为所有理论屏幕宽度建立独立布局。
- 为尚未启用的微信能力或未知平台预建抽象层。
- 把设计文档变成组件属性百科；组件 API 只在实现并存在真实调用者时落到代码附近。
