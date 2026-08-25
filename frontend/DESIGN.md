---
name: Virtual Companion — The Lit Window
description: 暮色墨蓝环境里一盏暖纸亮窗：克制暖光作主动作的中文 AI 陪伴产品视觉系统。
colors:
  env: "#151d2b"
  env-raised: "#1b2636"
  env-hover: "#232f42"
  on-env: "#e9eef7"
  on-env-muted: "#a3b1c6"
  glow: "#e5b566"
  border-env: "rgba(233, 238, 247, 0.18)"
  paper: "#f7f4ed"
  card: "#fffdf8"
  sunken: "#efe9df"
  ink: "#1f2b3a"
  muted: "#556478"
  border: "#d9d2c4"
  border-strong: "#857a67"
  primary: "#e8b45c"
  primary-hover: "#d9a441"
  on-primary: "#241a08"
  success: "#2e6b4f"
  success-bg: "#e6efe9"
  warning: "#8a5c00"
  warning-bg: "#f6ecd7"
  warning-on-env: "#e0a458"
  danger: "#b3261e"
  danger-bg: "#f9e7e4"
  danger-on-env: "#f0a8a0"
  focus: "#7d5a00"
  focus-on-env: "#f0c983"
typography:
  display:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.25
  headline:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.3
  title:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  s: "8px"
  m: "12px"
  l: "16px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  7: "32px"
  8: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.s}"
    height: "44px"
  button-env:
    backgroundColor: "{colors.env-raised}"
    textColor: "{colors.on-env}"
    rounded: "{rounded.s}"
    height: "44px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.l}"
    padding: "16px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    height: "44px"
  nav-item-active:
    backgroundColor: "{colors.env-hover}"
    textColor: "{colors.glow}"
    rounded: "{rounded.s}"
---

# Design System: Virtual Companion — The Lit Window

## Overview

**Creative North Star: "The Lit Window / 一盏仍亮着的窗"**

夜晚的墨蓝环境里，亮着一扇温暖的纸色窗。整个产品由三层构成：暮色墨蓝的**环境层**（外壳、页面头部、底部导航、页面底色）、清晰明亮的**纸面层**（活动内容面板，承载阅读与操作）、以及克制的**暖光**（琥珀色，只给主动作与活动态）。它表达产品的核心叙事：安静、在场、不喧哗的陪伴。

密度克制、留白充分；每个屏幕只有一个暖光主动作。图标全部为代码原生 SVG 细线（1.6 线宽），无 emoji、无装饰性图形。动效只允许 transform/opacity，且在 `prefers-reduced-motion` 下全部关闭。所有语义颜色均按 WCAG 计算：正文对比 ≥4.5:1，非文本控件边界 ≥3:1。

**Key Characteristics:**
- 环境（墨蓝）与内容（暖纸）的强分层；纸面永不沉入环境色。
- 暖光 = 主动作。一屏一处，稀缺即语义。
- 中文人文无衬线系统栈，无外部字体依赖。
- 4px 间距基；卡面圆角 12–16px，小控件 8px 或胶囊。
- 语义状态色（成功/警告/危险）先有事实再有色，永远配文字，不只靠颜色传达。

## Colors

暮色墨蓝的环境包裹一张暖纸，琥珀暖光只负责"现在可以做什么"。

### Primary
- **Window Amber / 窗光琥珀**（#e8b45c）：唯一主动作色。主 CTA 填充、发送按钮、活动 tab 指示。悬停加深为 #d9a441。深色文字 #241a08 保证 9.1:1。
- **Glow on Env / 环境暖光**（#e5b566）：暗面上的强调——活动导航项文字、暗面高亮（8.1:1）。

### Neutral — 环境层（暮色墨蓝）
- **Dusk Blue / 暮色墨蓝**（#151d2b）：页面底色、外壳、沉浸式聊天头部。
- **Env Raised / 环境浮面**（#1b2636）：底部导航、环境内按钮。
- **Env Hover**（#232f42）：环境内悬停/按压。
- **On Env**（#e9eef7）/ **On Env Muted**（#a3b1c6）：环境上的正文与次要文字。
- **Border Env**（rgba(233,238,247,0.18)）：环境内细线。

### Neutral — 纸面层（亮着的窗）
- **Warm Paper / 暖纸**（#f7f4ed）：内容页面底色。
- **Card / 卡面**（#fffdf8）：卡片与输入底。
- **Sunken / 沉面**（#efe9df）：输入沉面、次级面板。
- **Ink**（#1f2b3a）/ **Muted**（#556478）：纸面正文与次要文字（5.5:1）。
- **Border**（#d9d2c4）装饰细线；**Border Strong**（#857a67）承担控件边界（3.8:1）。

### 状态色（纸面 / 环境双版本）
- 成功 #2e6b4f / 底 #e6efe9；警告 #8a5c00（暗面 #e0a458）/ 底 #f6ecd7；危险 #b3261e（暗面 #f0a8a0）/ 底 #f9e7e4。

### Named Rules
**The One Lit Window Rule.** 每屏至多一处琥珀主动作；活动 tab 与焦点是它仅有的非按钮用法。它的稀缺就是它的语义。
**The Paper Never Sinks Rule.** 可读内容只出现在纸面层（#f7f4ed/#fffdf8）或环境层高对比文字上；禁止在墨蓝底上直接排正文段落。

## Typography

**Display/Body/Label Font:** 同一人文无衬线系统栈（"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif）。无外部字体、无衬线标题、无等宽正文。

**Character:** 中文阅读优先的人文无衬线；靠字重（400/500/600/650/700）与字号分层，不靠字族切换。

### Hierarchy
- **Display**（700，30px，1.25）：登录页主张、关系首页伴侣名。
- **Headline**（650，24px，1.3）：页面主标题（PageHeader 层级）。
- **Title**（600，17px，1.4）：卡片标题、区块题。
- **Body**（400，15px，1.6）：正文与控件文字；行宽随纸面容器。
- **Body-sm**（400，13px，1.6）：摘要、辅助说明。
- **Label**（500，12px，1.4）：字段标签、状态字、meta 行。

### Named Rules
**The Weight-Not-Face Rule.** 层级只由字号与字重表达；不得引入新字族、字距眉标（kicker）或装饰性大写微标签。

## Layout

移动优先的单列产品：375–390px 为基准视口，内容列在宽屏（≥768px）居中收束，底部导航固定于视口底。页面结构 = PageHeader（环境色，含返回）+ role=main 纸面内容 + 底部导航（四入口：首页/对话/记忆/我的）。内部页（运维/管理）用同 token 的高密度行式变体。间距全部取 4px 基刻度（4/8/12/16/20/24/32/48）。触摸目标 ≥44×44px（.vc-tap）。全局 border-box 盒模型（含 padding 与 border 计宽，杜绝小屏 1–2px 溢出）。

## Elevation & Depth

分层靠色温与明度，不靠投影：环境（最冷最暗）→ 纸面（最亮）→ 卡面（亮上加亮）。唯一的 box-shadow 是底部弹层（AppSheet）的一片柔和环境影 `0 -8px 32px rgba(10,15,24,0.35)`，只表达"浮在内容之上"。焦点环 2px（--vc-focus / 暗面 --vc-focus-on-env，offset 2px）。

### Named Rules
**The Temperature Rule.** 深度 = 色温与明度差（墨蓝→暖纸→卡面），禁止用投影造层级；弹层环境影是唯一例外。

## Shapes

卡面 16px（--vc-radius-l）；卡片内嵌块与中卡 12px（--vc-radius-m）；按钮、输入、chips 8px（--vc-radius-s）；底栏弹层顶角 16px、≥600px 视口下四角 16px 居中。无圆形卡片、无切角、无描边双线。

## Components

### Buttons
- **Shape:** 8px 圆角（胶囊仅限聊天发送等小圆控件），高 ≥44px。
- **Primary:** 琥珀填充（#e8b45c）+ 墨棕文字（#241a08）；hover #d9a441；一屏一处。
- **Env Button:** 环境浮面（#1b2636）+ On Env 文字，用于头部动作与暗面次级操作。
- **Focus:** 2px 焦点环（暗面 --vc-focus-on-env）；无渐变、无投影、无 emoji 图标。

### Cards / Containers
- **Corner:** 16px；**Background:** 卡面 #fffdf8 于暖纸底上；**Border:** 细线 #d9d2c4（装饰性）；**Padding:** 16px 起步；**Shadow:** 无。

### Inputs / Fields
- **Style:** 卡面或沉面底、8px 圆角、控件边界 #857a67（3.8:1）；**Focus:** 边界加深 + 2px 焦点环；**Error:** 危险色边 + 文字说明（不只靠颜色）。

### Navigation
- **BottomNav（四入口）:** 环境浮面底栏，图标为 1.6 线宽 SVG；活动项文字用暖光 #e5b566；44px 触摸目标。
- **PageHeader:** 环境色条，左返回、中标题（Headline 级）、右上下文动作；沉浸式聊天用同语言的全宽变体。

### Status Chip
- 状态胶囊：语义底色（success/warning/danger-bg）+ 同族深色文字 + 8px 圆角；永远带文字标签。

## Do's and Don'ts

### Do:
- **Do** 每个新页面只用语义 token（`--vc-*`），从 `design-system/base.css` 取值；对比度不合格的颜色不进入系统。
- **Do** 保持"环境/纸面/暖光"三层结构：内容进纸面，动作给暖光，其余归环境。
- **Do** 图标用 `design-system/AppIcon.vue` 的原生 SVG（1.6 线宽），动效只用 transform/opacity 并尊重 prefers-reduced-motion。
- **Do** 状态变化同时给文字（状态 chip + 说明行），不只靠颜色。

### Don't:
- **Don't** 新增 raw hex、页面私有导航色或未计算的对比度组合。
- **Don't** 用 emoji 作结构图标；不用渐变文字、kicker/眉标、硬偏移投影造层级。
- **Don't** 让琥珀出现在一屏多处；非主动作一律用环境按钮或纸面次级样式。
- **Don't** 引入外部字体或第二字族；层级靠字号与字重。
