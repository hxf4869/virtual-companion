---
name: Virtual Companion — 浅色陪伴
description: 浅色中性背景、白色内容面、冷蓝强调的中文 AI 陪伴产品视觉系统。
colors:
  env: "#f4f6f8"
  env-raised: "#ffffff"
  env-hover: "#edf0f4"
  on-env: "#1c2430"
  on-env-muted: "#5b6675"
  glow: "#3d6b99"
  border-env: "#e3e8ee"
  border-env-strong: "#76828f"
  paper: "#f7f8fa"
  card: "#ffffff"
  sunken: "#eef1f5"
  ink: "#1c2430"
  muted: "#5b6675"
  border: "#e3e8ee"
  border-strong: "#76828f"
  primary: "#3d6b99"
  primary-hover: "#335c85"
  on-primary: "#ffffff"
  success: "#2e6b4f"
  success-bg: "#e7f2ec"
  warning: "#8a5a00"
  warning-bg: "#f9f0dc"
  warning-on-env: "#8a5a00"
  danger: "#b3261e"
  danger-bg: "#faeae8"
  danger-on-env: "#b3261e"
  focus: "#2b5c8f"
  focus-on-env: "#2b5c8f"
typography:
  display:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.25
  headline:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
  title:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  input:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  icon:
    fontFamily: "PingFang SC, Hiragino Sans GB, Source Han Sans SC, Noto Sans CJK SC, Microsoft YaHei, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1
rounded:
  s: "8px"
  m: "12px"
  l: "16px"
  pill: "999px"
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
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    height: "44px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.m}"
    padding: "16px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.s}"
    height: "44px"
  nav-item-active:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.s}"
---

# Design System: Virtual Companion — 浅色陪伴

## Overview

**方向：熟悉、安静、清晰、浅色优先的移动端陪伴产品。**

这是 Operate 模式的产品界面，不是品牌海报。页面首先服务任务：继续一段对话、
确认记忆、管理提醒与隐私。以常见 iOS/Android 移动端产品为熟悉度基准：
浅色中性页面、白色内容面、接近黑色的主文字、一种克制的低饱和冷蓝
（#3d6b99）作为唯一品牌强调。中文系统字体，无外部字体。

密度正常、留白适度；每屏一个主动作。图标为代码原生 SVG 细线（1.6 线宽），
无 emoji、无装饰性图形。动效只允许 transform/opacity，且在
`prefers-reduced-motion` 下全部关闭。语义颜色按 WCAG 计算：正文 ≥4.5:1，
非文本控件边界 ≥3:1。

**明确禁止**：AI 紫粉、琥珀主题、大面积深蓝壳、墨蓝持久页头底栏、暖纸/
琥珀灯光/夜景隐喻、玻璃拟态、大面积渐变、卡片套卡片、每区块圆角容器、
chip/badge/pill 泛滥、emoji 结构图标、营销大标题、装饰性英文 kicker、
低对比灰字、阴影造层级、无功能装饰。

**Key Characteristics:**
- 页面（#f4f6f8）与内容面（#ffffff）的轻微分层；层级靠底色差与 1px 细线，
  不靠投影。
- 冷蓝 = 主动作。一屏一处；活动 tab、链接、选中态是它仅有的非按钮用法。
- 中文系统栈，靠字号（28/20/17/16/14/12）与字重（400/500/600/700）分层。
- 4px 间距基；卡面圆角 12px，按钮/输入 8px。
- 语义状态色先有事实再有色，永远配文字，不只靠颜色传达。

## Colors

浅色页面上一张白色内容面，冷蓝只负责"现在可以做什么"。

### Primary
- **品牌冷蓝**（#3d6b99）：唯一主动作色。主 CTA 填充（白字 5.5:1）、发送
  按钮、活动 tab、链接。悬停加深 #335c85。

### Neutral
- **页面底**（#f4f6f8）：页面背景、chrome 底色。
- **Chrome 表面**（#ffffff）：页头、底部导航。
- **内容面**（#f7f8fa）/ **卡面**（#ffffff）：内容区与卡片。
- **沉面**（#eef1f5）：用户气泡、次级填充。
- **Ink**（#1c2430）/ **Muted**（#5b6675）：主/次文字。
- **Border**（#e3e8ee）装饰细线；**Border Strong**（#76828f）承担控件边界
  （3.9:1）。

### 状态色
- 成功 #2e6b4f / 底 #e7f2ec；警告 #8a5a00 / 底 #f9f0dc；危险 #b3261e /
  底 #faeae8。

### Named Rules
**The One Action Rule.** 每屏至多一处冷蓝主动作；活动 tab 与焦点是它仅有
的非按钮用法。
**The Hairline Rule.** 分层靠底色差与 1px 细线（#e3e8ee）；不用投影造层级
（底部弹层 AppSheet 的一片柔和环境影是唯一例外）。

## Typography

**Display/Body/Label Font:** 同一中文系统栈（"PingFang SC", "Hiragino Sans
GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui,
sans-serif）。无外部字体、无衬线标题、无等宽正文。

**Character:** 中文阅读优先；靠字号与字重分层，不靠字族切换。

### Hierarchy
- **Display**（700，28px，1.25）：登录页主张。
- **Headline**（600，20px，1.35）：页面主标题。
- **Title**（600，17px，1.4）：卡片标题、页头标题。
- **Body**（400，16px，1.6）：正文与控件文字。正文与输入一律 ≥16px——
  这同时是 iOS Safari 聚焦自动缩放的硬阈值。
- **Body-sm**（400，14px，1.55）：辅助说明、摘要。
- **Label**（500，12px，1.4）：字段标签、meta 行。
- **Mono**（400，13px，1.5，ui-monospace/"SF Mono"/Menlo/Consolas 栈）：
  请求 id 等代码样文本。

图标不是文字：AppIcon 以 24px 为默认基线（`1em` 缩放，size prop 覆盖），
不进入文字字号阶梯。

## Layout

移动优先单列：390×844 主设计（375×812 小屏、812×375 横屏、768×1024 平板），
≥768px 内容列居中收束——桌面是移动布局的自然扩展，不另造 Dashboard。底部
导航固定于视口底（四入口：首页/对话/记忆/我的，图标+文字）。二级页使用
统一返回页头，不重复底栏层级。间距取 4px 基刻度。触摸目标 ≥44×44px
（.vc-tap）。全局 border-box。无横向溢出；处理 safe-area；键盘打开时输入
不被遮挡。

## Elevation & Depth

分层靠底色差（页面 #f4f6f8 → 内容面 #f7f8fa → 卡面 #ffffff）与 1px 细线。
唯一 box-shadow 是底部弹层（AppSheet）的柔和环境影，只表达"浮在内容之上"。
焦点环 2px（#2b5c8f，offset 2px），不得移除。

## Shapes

卡面 12px（--vc-radius-m）；按钮、输入 8px（--vc-radius-s）；chips 少用，
必要时用胶囊（--vc-radius-pill）；底栏弹层顶角 16px。无圆形卡片、无描边
双线。

## Components

### Buttons
- **Shape:** 8px 圆角，高 ≥44px。
- **Primary:** 冷蓝填充（#3d6b99）+ 白字；hover #335c85；一屏一处。
- **Secondary:** 白底 + 控件边界 + Ink 文字，用于次级操作。
- **Danger:** 危险色文字/边界；破坏性操作与普通操作明显分离，放独立区域。
- **Focus:** 2px 焦点环；无渐变、无投影、无 emoji 图标。

### Cards / Containers
- 卡片仅用于真实分组；不得把每一行都变成卡片，不得卡片套卡片。
- **Background:** #ffffff；**Border:** 1px #e3e8ee；**Padding:** 16px；
  **Shadow:** 无。

### Inputs / Fields
- 白底、8px 圆角、控件边界 #76828f；字号 16px；**Focus:** 边界加深 + 2px
  焦点环；**Error:** 危险色边 + 文字说明（不只靠颜色）；字段有可见 label。

### Sensitive Task Sheets

- 长敏感表单在可滚动内容内将身份确认区固定在顶部、取消/保存动作固定在底部；
  身份确认失败就地显示，不关闭弹层，也不清除已填写内容。
- 写入后不可读取的 secret 不预填、不回显任何片段；编辑态只用文字说明是否已配置，
  并明确留空会保留现有值。

### Navigation
- **BottomNav（四入口）:** 白底 + 顶部细线；图标为 1.6 线宽 SVG；活动项 =
  冷蓝图标 + 文字 + 字重 600 + aria-current；52px 触摸目标。
- **PageHeader:** 白底 + 底部细线，左返回、中标题（Title 级）、右上下文动作。

## Do's and Don'ts

### Do:
- **Do** 每个新页面只用语义 token（`--vc-*`），从 `design-system/base.css`
  取值；对比度不合格的颜色不进入系统。
- **Do** 保持"页面/内容面/卡面"的浅色分层：内容进卡面，动作给冷蓝。
- **Do** 图标用 `design-system/AppIcon.vue` 的原生 SVG（1.6 线宽）；动效只
  用 transform/opacity 并尊重 prefers-reduced-motion。
- **Do** 状态变化同时给文字（状态行 + 说明），不只靠颜色。

### Don't:
- **Don't** 输入控件字号低于 16px；正文低于 16px。
- **Don't** 新增 raw hex、页面私有导航色或未计算的对比度组合。
- **Don't** 用 emoji 作结构图标；不用渐变、kicker/眉标、投影造层级。
- **Don't** 让冷蓝出现在一屏多处；非主动作一律用次级样式。
- **Don't** 引入外部字体或第二字族。
- **Don't** 首页做成功能仪表盘、聊天页做成状态控制台。
