# UX-23 聊天页设计图提示词

2026-11-01 Owner 决定：聊天默认改为即时通讯气泡；补成组气泡与日期条、引用回复与右键菜单、草稿保存与失败回填、会话内搜索；
状态只显示真实发生的「已发送 → 正在输入 → 回复」；整体参考微信、Telegram、iMessage 等主流聊天软件。
风格沿用 UX-11 选定的 B「沉浸景深」（`.review-queue/UX-11/images/PICKS.md`）。图只定方向与版式，数值以 DESIGN.md 为准。

每张图 = 公共块 + 页面块。生成到 `.review-queue/UX-23/images/<编号>-<序号>.png`。

## 公共块

```text
High-fidelity UI screenshot of a desktop AI companion chat app "Virtual Companion", Apple visionOS / macOS Sequoia
"immersive glass" style, intensity: immersive (variant B). Simplified Chinese UI text, SF Pro / PingFang SC look, crisp.
Full-window soft aurora background tinted by the current character's color (warm peach for the character 小满),
frosted-glass floating panels with 12px gaps, 24px radius, 1px white rim, soft depth shadow.
Single accent color Apple blue #0071E3 only for interactive elements and the user's own bubbles.
Thin rounded line icons (Lucide style). Clean pixel-aligned layout, realistic product screenshot, no device frame,
no browser chrome, no watermark, no lorem ipsum. Original anime-style characters only (no real people).
Layout: left glass sidebar 200px (聊天 selected, 角色, 记忆, 陪伴, 剧情; bottom avatar + 设置),
conversation list panel 320px (小满 日常 selected, 林舟 剧情, 白芷 夜聊, 澄夏 旅行), large conversation panel.
```

## C1 · 桌面聊天：即时通讯气泡（最重要）

```text
Screen 1536x1024. Conversation panel shows an instant-messaging thread like iMessage / Telegram adapted to glass:
- Header inside the panel: avatar 36 + "小满" bold + gray "日常"; right side round glass buttons: search, character panel, more.
- A centered small date pill "昨天 22:14" at the top, later a centered time pill "今天 08:02" (gap over 20 minutes).
- Character messages: left-aligned light glass bubbles (white 72% opacity), 18px radius; consecutive messages from the
  same sender are grouped: avatar 32 shown only next to the LAST bubble of the group, inner corners of grouped bubbles
  smaller (6px), 4px gap inside a group, 12px gap between groups. Time shown once at the end of a group in small gray text.
- User messages: right-aligned Apple-blue bubbles with white text, grouped the same way; under the last user bubble a tiny
  gray status "已发送".
- One character bubble contains a quoted reply block at its top: a thin left accent bar with gray small text
  "你：周末要不要去看展？" then the reply "好呀！我查了一下，周六下午人少一点。".
- Example thread (Chinese): 小满: "早呀～" / "今天降温了，出门记得带围巾" ; 你: "收到！" / "你今天干嘛" ;
  小满: "在整理上次拍的照片" / "有一张晚霞超好看，等下发你".
- At the bottom, a typing indicator bubble on the left with three animated gray dots and gray small "正在输入".
- Composer: floating glass capsule max 720px: "+" button, multi-line input with placeholder "发消息…", emoji icon,
  microphone icon, round blue send button.
```

## C2 · 桌面：右键菜单与引用

```text
Screen 1536x1024, same layout as C1. The user right-clicked a character bubble "有一张晚霞超好看，等下发你":
- That bubble is slightly lifted (scale 1.02, soft shadow), the rest of the thread dimmed very slightly.
- A glass context menu (radius 14, rows 36px, icons 16px) anchored next to it with items:
  "引用" (quote icon), "复制", "朗读", divider, "编辑", "重新生成", divider, "删除" in red.
- In the composer above the input, a quote bar is visible (from a previous action): thin blue left bar, small gray text
  "引用 小满：有一张晚霞超好看，等下发你", and a small x close button on the right.
```

## C3 · 桌面：会话内搜索

```text
Screen 1536x1024, same layout. The conversation header turned into a search bar: magnifier, input with text "晚霞",
result counter "2 / 5", up/down chevron buttons, "完成" text button. Matching words in bubbles are highlighted with a
soft yellow marker; the current match bubble has a subtle blue outline. The rest of the thread stays readable.
```

## C4 · 桌面：发送失败与草稿

```text
Screen 1536x1024, same layout. The last user bubble "那我们几点出发？" shows a small red circular exclamation icon to its
left and red small text under it "没有发送成功 · 重试" (重试 is a blue text button). The composer contains the restored
draft text "那我们几点出发？要不要带相机" with the cursor at the end. No other error banners.
Also show in the conversation list panel: the row 白芷 has a gray "草稿：明天再聊" preview in place of the last message.
```

## C5 · 手机聊天：即时通讯气泡

在公共块后追加：`Mobile phone screen 1024x1536, iOS 26 style. No sidebar or list; full-screen conversation.`

```text
Mobile conversation with 小满: top navigation with round glass back button, centered avatar + name "小满" capsule,
right round glass search button. Same grouped bubble rules as C1 (blue user bubbles right, light glass character bubbles
left, avatar only beside last bubble of a group, date pill "今天 08:02", status "已发送" under the last user bubble),
a typing indicator bubble at the bottom, and a floating glass composer above the home indicator.
Aurora background is subtle on mobile.
```

## C6 · 桌面深色

C1 页面块 + 公共块，并在末尾追加：

```text
Dark mode: near-black base #07070A, aurora glows brighter, glass panels smoky dark gray, character bubbles
rgba(255,255,255,0.10) with off-white text, user bubbles Apple blue, secondary text #B2B2B7.
```
