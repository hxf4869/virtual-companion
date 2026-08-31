---
name: Virtual Companion — Quiet Loom / 静默织室
description: 温灰绿织面、近白事实表面与克制紫色主动作组成的中文陪伴与 Go Runtime 后台工作台。
colors:
  env: "#f1f4f1"
  env-raised: "#ffffff"
  env-hover: "#eaedeb"
  on-env: "#322638"
  on-env-muted: "#665d69"
  glow: "#6c56c7"
  border-env: "#d8ded9"
  border-env-strong: "#756d78"
  paper: "#f1f4f1"
  card: "#fefefe"
  sunken: "#eaedeb"
  ink: "#322638"
  muted: "#665d69"
  border: "#d8ded9"
  border-strong: "#756d78"
  primary: "#6c56c7"
  primary-hover: "#5842b3"
  primary-bg: "#eee9ff"
  primary-border: "#cfc5f8"
  on-primary: "#ffffff"
  disabled-surface: "#dddfe0"
  disabled-ink: "#665d69"
  success: "#3f725e"
  success-bg: "#dfeee6"
  success-border: "#b8d8c8"
  warning: "#785619"
  warning-bg: "#f3ead5"
  warning-on-env: "#785619"
  danger: "#a9433a"
  danger-bg: "#f7e5e2"
  danger-border: "#edbbb5"
  danger-on-env: "#a9433a"
  focus: "#5940bd"
  focus-on-env: "#5940bd"
  scrim: "rgba(50, 38, 56, 0.42)"
typography:
  display: {fontFamily: '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: "34px", fontWeight: 700}
  headline: {fontSize: "28px", fontWeight: 700}
  relationship: {fontSize: "22px", fontWeight: 700}
  title: {fontSize: "18px", fontWeight: 700}
  console-title: {fontSize: "clamp(24px, 2.2vw, 32px)", fontWeight: 780, lineHeight: 1.15, letterSpacing: "-0.025em"}
  body: {fontFamily: '"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: "16px", fontWeight: 400, lineHeight: 1.6}
  body-sm: {fontSize: "14px"}
  admin-control: {fontSize: "14px", fontWeight: 680}
  label: {fontSize: "12px", fontWeight: 500}
  input: {fontSize: "16px"}
  mono: {fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'}
  icon: {fontSize: "24px"}
rounded: {s: "4px", m: "8px", l: "12px", pill: "999px"}
spacing: {1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 7: "32px", 8: "48px"}
components:
  button-primary: {backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "0", height: "44px"}
  button-secondary: {backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "{rounded.s}", height: "44px"}
  relationship-panel: {backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "{rounded.s}", padding: "{spacing.4}"}
  open-list-row: {backgroundColor: "transparent", textColor: "{colors.ink}", rounded: "0", height: "66px"}
  input: {backgroundColor: "{colors.sunken}", textColor: "{colors.ink}", rounded: "{rounded.s}", height: "44px"}
  nav-item-active: {backgroundColor: "transparent", textColor: "{colors.primary}", rounded: "{rounded.m}", height: "52px"}
  admin-button: {backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "0", height: "44px"}
  admin-button-primary: {backgroundColor: "{colors.primary}", textColor: "{colors.on-primary}", rounded: "0", height: "44px"}
  admin-nav-active: {backgroundColor: "{colors.card}", textColor: "{colors.primary}", rounded: "0", height: "44px"}
  admin-change-ledger: {backgroundColor: "{colors.card}", textColor: "{colors.ink}", rounded: "0", padding: "{spacing.5}"}
---

# Design System: Virtual Companion — Quiet Loom / 静默织室

## Overview

**Creative North Star: "静默织室 / Quiet Loom"**

这是 Operate 模式的中文移动 H5：一段低压力、可持续且不冒充真人的陪伴关系。温灰绿环境
像安静织面，近白事实表面承载真实内容，墨紫正文保持阅读稳定；克制紫色只标记当前选择
与唯一主动作，绿色表示关系延续，红色/珊瑚色只标示需要处理的事实。

同一套静默织室语言在授权后台收束为 **Quiet Loom Control Room / 变更账本工作台**：固定
侧栏、开放式账本、细分隔线和近白工作面，让当前生效配置与本次待应用变更同时可核对。
后台只呈现 Go Runtime 公开的模型提供方、模型、路由和运行探针事实，不用假指标、缓存结果
或未实现的管理域填充界面。

**Key Characteristics:**

- 温灰绿环境与近白事实面做轻微层级；后台工作面以 1px 细缝组织内容。
- 紫色只承担当前选择和每屏唯一填充主动作；绿/红/黄状态始终配事实文字。
- 后台以固定 rail、事实账本、开放列表和右侧变更轨迹表达可追溯性，不做卡片海。
- 4px 间距基；后台按钮与导航保持直角，字段使用小圆角，关键触达至少 44px。
- 低透明度材质只辅助环境；动效只用 opacity/transform 并服从 reduced-motion。

## Colors

温灰绿环境、近白事实表面、墨紫正文和克制紫色主动作构成安静底色；语义绿/珊瑚红/谨慎黄
只服务可验证的运行与保存状态。

### Primary

- **静默紫**（primary/glow）：用于继续、发送、检查并保存/应用、当前后台导航与选中提供方；
  按压态使用 primary-hover。后台每个视口保持一个填充主动作层级。

### Neutral

- **温灰绿织面**（env/paper）承托页面和后台 rail；**白色 chrome**（env-raised）承托页头与
  移动固定操作条；**近白事实面**（card）承托账本、表单和状态面板；**沉面**（env-hover/
  sunken）用于输入和次级环境层。
- **墨紫正文**（on-env/ink）用于事实与标题；**静紫辅助文字**（on-env-muted/muted）用于
  meta、帮助和诊断说明；border-env/border 是默认细缝，border-env-strong/border-strong 是
  表单控件边界。

### Semantic states

- **关系延续绿**（success/success-bg/success-border）表示正常、已启用、已确认或保存成功。
- **待处理珊瑚红**（danger/danger-bg/danger-border）表示不可用、校验阻断或保存失败；
  **谨慎提示**（warning/warning-bg）表示需要先处理的未保存、重新认证或能力边界。
- disabled 使用 disabled-surface/disabled-ink；焦点使用 focus/focus-on-env；移动导航抽屉
  使用 scrim。任何语义色都必须和文字事实一起出现。

### Named Rules

**The One Purple Action Rule.** 每屏至多一个填充紫色主动作；活动导航、当前选择和固定移动
操作条是其有限的非按钮用法。

**The Fact-Before-Color Rule.** 先写清运行、保存或阻断事实，再用绿/红/黄辅助识别；颜色不能
独立传达状态。

## Typography

**Display/Body/Label Font:** PingFang SC、Hiragino Sans GB、Source Han Sans SC、Noto Sans
CJK SC、Microsoft YaHei、system-ui、-apple-system、Segoe UI、sans-serif。代码、provider/model
ID、版本和诊断值使用 ui-monospace、SF Mono、Menlo、Consolas、monospace；不引入外部字体。

**Character:** 中文阅读优先，靠字号和字重建立稳定层级；后台命令密度较高，但不缩小关键事实和
输入文字。

### Hierarchy

- **Display**（700，34px）：登录准入页主标题。
- **Headline**（700，28px）：较强层级标题；后台页头使用 24–32px 的 console-title（780，
  1.15 行高，略收紧字距）。
- **Relationship**（700，22px）：消费首页当前陪伴名；后台状态标题可使用同级视觉重量。
- **Title**（700，18px）：页头、分组和账本标题。
- **Body**（400，16px，1.6）：对话、表单、密码输入和关键运行事实；Body-sm（14px）用于
  辅助说明。后台命令标签按实现使用 admin-control（14px/680），但触达不低于 44px。
- **Label**（500，12px）：字段标签、状态 meta 和时间；Mono 仅用于代码样值。
- **AppIcon** 默认 24px，由 size prop 覆盖；图标不是文字字形。

### Named Rules

**The 16px Reading Rule.** 关键正文、字段/密码输入和可读运行事实不低于 16px；14px 只用于
后台命令标签与辅助说明，交互触达仍至少 44px。

## Layout

消费层继续移动优先单列：ConsumerShell、PageHeader、BottomNav 内容最大 520px 并居中；
消费主区移动端内边距 16px，768px 以上为 20px，固定底栏处理 safe-area。间距取 4px 基准
（4/8/12/16/20/24/32/48px），关系面板、细缝和开放列表表达连续关系。

后台由 `AdminConsoleShell` 统一包裹四个当前路由：

- `/pages/admin/admin` — **运行总览**：Go Runtime 生效状态、提供方/模型/主路由与需要关注。
- `/pages/admin-models/admin-models` — **模型服务**：提供方索引、连接/凭据状态、模型目录和
  本次变更。
- `/pages/admin-routing/admin-routing` — **路由策略**：全部启用路由的确定性优先级、影响说明
  与本次变更。
- `/pages/admin-system/admin-system` — **系统状态**：存活/就绪探针、服务模式、构建版本和
  本次检查时间线。

桌面后台使用 232px 固定左 rail；stage 为剩余视口，顶部 sticky chrome 高 88px，主工作面
最大宽度 1560px，内边距为 `clamp(24px, 3vw, 48px)`。总览与系统状态是主事实区 + 右侧
关注/检查栏；路由是顺序表 + 340px 变更栏；模型服务是 220px 提供方索引 + 表单工作区 +
320px 变更栏。变更栏桌面 sticky，1180px 左右降为主内容下方的整行。

`820px` 以下 rail 变为最大 `min(84vw, 300px)` 的抽屉，主区无左边距；页头变为 72px，菜单
按钮和 scrim 控制抽屉，页头隐藏副标题。模型提供方索引变为横向滚动行，字段与路由/系统事实
堆叠；模型和路由将保存动作放入带 safe-area 的底部固定操作条。总览与系统右栏改为纵向段落，
不以横向压缩换取完整信息。

后台变更语法是“当前生效配置”对照“本次变更”：模型页表单编辑会列出字段/模型差异，路由页
列出位置变化；刷新、切换、添加或离开前有未保存变更时阻止覆盖草稿。保存失败继续保留草稿，
只有成功重新读取远端配置后才重置基线。

## Elevation & Depth

默认平面分层靠温灰绿、近白和 1px 细缝，不靠普通阴影。后台 rail、topbar、事实面、表单工作区
和变更栏均以色调、边界与留白分层；topbar 的半透明白色与 12px blur 只属于 sticky chrome，
不扩展为玻璃表面。移动抽屉用 scrim 表达遮挡；唯一浮层环境影仍是 AppSheet 的
`vc-shadow-floating`（`0 18px 48px rgba(50, 38, 56, 0.16)`）。

### Named Rules

**The Hairline Depth Rule.** 普通后台容器无阴影；优先用 1px border、背景色差和留白表达层级，
只有真实浮层可以使用环境影。

## Shapes

消费关系面板和常规控件使用小圆角（s=4px、m=8px、l=12px、pill=999px）；后台工作台进一步
收紧为方正账本：rail、按钮、导航项、表格行和变更栏保持 0px，字段与少量状态面使用 4px，
状态时间线节点保持圆形。列表与表格以底部细线分隔，选中提供方用紫色底面/内嵌线，非装饰性
圆点仅用于有文字伴随的状态或时间线节点。

## Components

### Buttons

- **Primary:** `--vc-primary` 填充、白字、直角，后台最小高 44px；“检查并保存/应用”是每页
  唯一填充主动作，按压/悬停使用 primary-hover。
- **Secondary:** card 或透明表面、墨紫文字和可见控件边界；用于刷新、发现模型、撤销、返回等
  次级操作。
- **Danger / quiet:** 危险操作用 danger 边界/文字；放弃变更与返回保持 quiet，不和主保存动作
  争夺填充层级。
- **Focus / disabled:** 全局 2px focus 环、outline-offset 3px；disabled 使用实际 disabled
  token。所有图标按钮仍保持至少 44px。

### Cards / Containers

- **事实账本：** card 近白表面、1px border 或细缝、无阴影；总览用纵向事实链，系统状态用
  检查时间线。
- **后台工作区：** 模型表单按“基础连接/模型目录”分组，单个模型行使用淡中性底与边界；
  不把每个字段或每条表格行包成圆角卡片。
- **变更账本：** 桌面位于右侧并保持可见，列出差异/位置变化、验证问题、重新认证状态、消息
  和保存动作；移动端下移，并由固定操作条提供主要提交入口。

### Inputs / Fields

- 字段有可见 label 和帮助文字；provider/model ID、URL、版本等代码样值使用 mono。
- 输入/选择控件最小高 44–46px、16px 字号、card 或 sunken 背景、border-strong 边界和 4px
  圆角；聚焦时使用 primary 边界 + 全局 focus 环。
- 密钥是 password 输入；新建时必填，编辑时留空表示保留现有密钥。保存后只显示“已配置”，
  不回显明文或片段。

### Navigation

- **AdminConsoleShell rail：** 232px 固定侧栏，品牌标记“织 / 静默织室 / Go Runtime 控制台”，
  四个入口按“总览 → 模型服务 → 路由策略 → 系统状态”排列；当前项用近白底、紫色文字、字重和
  菱形标记，并配 `aria-current="page"`。
- **Topbar：** sticky 白色 chrome、底部细线、页名 + 简体中文副标题；右侧放刷新或本页唯一主动作。
  820px 以下只保留页名和 44px 菜单按钮。
- **Admin footer：** rail 底部显示管理员与当前/本地环境，并提供“返回应用”“退出登录”；退出
  同样经过未保存变更确认。

### Status, Messages & Re-authentication

- 状态行以文字 + 8px 色点或边界 badge 表示；正常/启用/已确认用 success，不可用/校验/失败用
  danger，需要先处理或重新认证用 warning。加载使用真实 refresh 图标和 `role="status"`，
  错误/无权限使用 `role="alert"`，不展示缓存事实或假成功。
- 访问后台先处于“正在确认后台会话”；服务不可用时明确“不会展示缓存数据”，非 ADMIN 时明确
  拒绝原因并返回账号。总览和系统只读取真实运行探针、服务模式、版本与当前配置。
- 模型保存、模型发现和路由应用属于敏感写操作：提交前进入“重新认证”，使用当前管理员密码，
  成功后本次会话 15 分钟内可执行敏感写操作；失败保留编辑内容和认证面板，403 会清除认证状态
  并要求重新认证。凭据永不进入页面回显。
- 模型保存成功提示“新配置从下一轮对话开始生效”；路由保存成功提示“从下一轮开始生效”，
  不暗示正在进行的对话被中断。系统检查明确“不保存检查历史”。

### Unsaved Changes

- 模型页和路由页把基线与草稿对照，提交前可检查、验证、重新认证；“放弃变更/撤销全部调整”
  明确恢复基线。
- 刷新、切换提供方、添加提供方、后台导航、返回应用、退出登录和浏览器离开均不静默丢弃草稿。
  应用内使用“放弃并离开 / 继续编辑”确认；浏览器离开使用 `beforeunload` 原生提示。
- 未保存变更时刷新远端数据会被阻止并给出下一步；保存失败保留本地草稿，成功保存后重新载入
  生效配置并清空差异轨迹。

## Do's and Don'ts

### Do:

- **Do** 只消费 `design-system/base.css` 的 `--vc-*` 语义 token；后台专属中性层保持在现有
  灰绿/近白材质内，不新增品牌色。
- **Do** 把“当前生效”与“本次变更”并排/相邻展示，让操作者能先核对事实再提交。
- **Do** 用真实 Go Runtime 返回、文字状态、`role="status"`/`role="alert"`、可见 label、
  `fieldset/legend`、表格语义和 `aria-current` 支撑操作与读屏。
- **Do** 保持 44px 触达、关键正文/输入 16px、safe-area、键盘焦点和 `prefers-reduced-motion`
  行为；默认动效只用 opacity/transform。
- **Do** 让错误、无权限、空状态、加载、重新认证、保存成功/失败和未保存离页都有如实的下一步。

### Don't:

- **Don't** 把后台做成 KPI 仪表盘、卡片墙、长锚点页、模态表单或多层圆角容器；账本和开放列表
  必须保留可扫描的细缝结构。
- **Don't** 伪造运行指标、缓存状态、自动恢复或联系人处置；不把读取失败写成正常。
- **Don't** 展示 API 密钥、密钥片段或诊断中的敏感值；不把密码写入草稿、日志或设计示例。
- **Don't** 让紫色泛滥、让状态只依靠颜色、让控件小于 44px，或把关键正文/输入缩到 16px 以下。
- **Don't** 引入渐变、玻璃拟态、emoji/头像/机器人拟人暗示、外部字体或未实现的后台能力。
