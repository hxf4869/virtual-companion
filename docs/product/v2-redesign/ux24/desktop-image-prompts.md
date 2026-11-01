# UX-24 桌面体验优化设计图提示词

2026-11-02 Owner 问答定稿：聊天细节、功能、陪伴感三组全选，并采纳调研补充（`.review-queue/UX-24/research-C.md`、`research-D.md`，
以及 UX-23 的 `research-A.md`、`research-B.md`）。风格沿用 UX-11 选定的 B「沉浸景深」与 UX-23 聊天主参照 C1。
图只定方向与版式，数值以 DESIGN.md 第 16 节为准。每张图 = 公共块 + 页面块，生成到 `.review-queue/UX-24/images/<编号>-<序号>.png`。

## 公共块

```text
High-fidelity UI screenshot of a desktop AI companion chat app "Virtual Companion", Apple visionOS / macOS Sequoia
"immersive glass" style, intensity: immersive (variant B). Simplified Chinese UI text, SF Pro / PingFang SC look, crisp.
Full-window soft aurora background (no photo, no landscape) tinted by the current character's color (warm peach for the
character 小满), frosted-glass floating panels with 12px gaps, 24px radius, 1px white rim, soft depth shadow.
Single accent color Apple blue #0071E3 only for interactive elements and the user's own bubbles.
Thin rounded line icons (Lucide style). Clean pixel-aligned layout, realistic product screenshot, no device frame,
no browser chrome, no watermark, no lorem ipsum, no explanatory captions or annotation labels. Original anime-style
characters only (no real people). Calm, warm, intimate mood; restrained, Apple-like; no unnecessary secondary labels.
Layout: left glass sidebar 200px (聊天, 角色, 记忆, 陪伴, 剧情; bottom user avatar + 设置),
conversation list panel 320px (小满 日常, 林舟 剧情, 白芷 夜聊, 澄夏 旅行), large conversation panel.
Hard rules (do NOT violate): background is ONLY the soft aurora gradient — never a character portrait, photo or illustration
behind the panels; NO phone-call or video-call buttons; NO attachment or image buttons in the composer (only "+", emoji,
microphone, send); NO read-receipt double ticks and NO "在线" text; in the chat thread the character avatar appears ONLY next
to the LAST bubble of a consecutive group and the time appears ONLY once under the last bubble of a group; segmented
controls use a white sliding thumb on a light track (never a blue filled segment).
```

## E1 · 聊天主屏（最重要）

```text
Screen 1536x1024. 聊天 selected; 小满 row selected in the list.
Conversation header inside the panel: avatar 36 with a tiny soft-green presence dot, "小满" bold, and under it one gray
status line "黏人 · 在整理上次拍的照片"; right side round glass buttons: search, character panel, more.
Thread, top to bottom:
- A floating small glass date pill "10月31日 周五" hovering near the top edge of the thread (shown while scrolling).
- Character group: "早呀～" / "今天降温了，出门记得带围巾"; the second bubble has a tiny reaction badge "❤️" sitting on
  its bottom-right corner, overlapping the bubble edge.
- User group (Apple-blue bubbles, right): "收到！" / "你今天干嘛", tiny gray "已发送" under the last one.
- A thin centered divider line with small accent text "以下为新消息".
- Character group: a soft gray italic small-text action line "（抱着相机翻来翻去）" without a bubble, then bubbles
  "在整理上次拍的照片" / "有一张晚霞超好看，等下发你", then a large standalone emoji "🌇" rendered big (56px) without a bubble.
- Character voice message: a pill-shaped voice bar with play button, 24 thin waveform bars (first third colored peach =
  played), duration "0:08", a tiny "1x" speed chip, and a small blue text button "转文字" next to it.
- The last character message shows a minimal pager "‹ 2/3 ›" in small gray text under the bubble.
Above the composer, a row of three small glass suggestion chips: "发我看看！", "在哪拍的呀", "我也想去".
Composer: floating glass capsule max 720px: "+" button, input placeholder "发消息…", emoji/smile icon button,
microphone icon, round blue send button.
```

## E2 · 聊天主屏深色

E1 页面块 + 公共块，并在末尾追加：

```text
Dark mode: near-black base #07070A, aurora glows dimmer but richer, glass panels smoky dark gray, character bubbles
rgba(255,255,255,0.10) with off-white text, user bubbles Apple blue, secondary text #B2B2B7.
```

## E3 · 生成中、停止、拍一拍与回到最新

```text
Screen 1536x1024, same layout as E1. The user has scrolled up a little while reading.
Thread:
- A centered small gray system line (no bubble): "你拍了拍小满" , and the character's avatar next to the following group
  looks slightly tilted as if just nudged; she replies "干嘛啦～" / "我在呢".
- A long character reply whose FIRST line is aligned near the top of the viewport (long-reply landing).
- Further down, a character bubble that was stopped mid-sentence: text ends with "……" fading out, and under it a small gray
  "已停止" followed by a blue text button "继续".
- At the very bottom, a typing indicator bubble with three gray dots.
Floating above the composer at the right edge of the reading column: a round 36px glass button with a down-arrow and a
small blue badge "3" (jump to latest).
Composer: while generating, the send button became a round stop button (square icon).
```

## E4 · 右键：回应条与扩展菜单

```text
Screen 1536x1024, same layout as E1. The user right-clicked the character bubble "有一张晚霞超好看，等下发你":
- That bubble is slightly lifted (scale 1.02, soft shadow); the rest of the thread is very slightly dimmed.
- Directly above the bubble, a compact glass pill reaction bar with six emoji: ❤️ 👍 😂 😮 😢 🤗 and a small "+".
- Below/next to it, a glass context menu (radius 14, rows 36px, icons 16px): "引用", "复制", "朗读", "收藏",
  "稍后提醒 ›", divider, "编辑", "重新生成", divider, "删除" in red.
- The "稍后提醒" item is hovered and opens a small submenu: "20 分钟后", "今晚 21:00", "明天早上", "选择时间…".
```

## E5 · 表情与贴纸面板

```text
Screen 1536x1024, same layout as E1. Above the composer, anchored to the emoji button, a glass popover 360x380:
- Top segmented control (white slider style): "表情" | "贴纸"; "贴纸" selected.
- A small "最近" row of 6 sticker thumbnails, then a grid of cute original cartoon stickers (4 columns) of a chibi peach-haired
  girl with Chinese tag captions under each: 开心, 害羞, 委屈, 抱抱, 晚安, 得意, 困, 生气.
- One sticker is hovered and shown enlarged as a preview bubble.
- A search field at the top "搜索表情".
```

## E6 · 图片查看

```text
Screen 1536x1024. The chat is behind a dark blurred scrim (black 60% + blur). Centered: a large sunset-over-lake photo
(the "晚霞" photo the character sent) with rounded 16px corners, scaled in. Top right: round glass buttons "下载", "复制",
"关闭". Left and right edges: round glass chevron buttons for previous / next image. Bottom center: small gray text
"小满 · 今天 08:03" and a tiny page indicator "2 / 5". No other UI.
```

## E7 · 角色状态卡

```text
Screen 1536x1024, same layout as E1. The user clicked the avatar in the conversation header; a glass popover card 340 wide
drops down from it:
- Large avatar 72 with a soft glow ring in peach; name "小满"; gray "日常".
- A mood row: small emoji "🥰" + "今天：黏人" and a one-line note "想多和你说说话".
- "在做什么": "在整理上次拍的照片" with gray "10 分钟前".
- Three slim horizontal meters with labels: "亲近", "心情", "精力" (soft peach fill, no numbers).
- A relationship line: "认识第 42 天 · 聊过 1,286 条".
- A small upcoming milestone chip: "再过 58 天是我们认识 100 天".
- Bottom row of two glass buttons: "拍一拍", "查看记忆".
```

## E8 · 主动消息：横幅、未读与新消息

```text
Screen 1536x1024. The user is on another conversation (林舟 selected). Top-right corner of the window: a glass notification
banner 360 wide: small 小满 avatar, bold "小满", gray "现在", preview "到家了吗？今天风好大", subtle shadow.
In the conversation list: the 小满 row shows a blue unread badge "2" and bold preview text; 白芷 row shows gray
"草稿：明天再聊".
Inset (as the right panel content, as if the user then opened 小满): the thread shows a centered divider
"以下为新消息", then a proactive voice-message card from 小满 (voice bar + "0:06" + "转文字"), then a celebratory
milestone card centered in the thread: a soft glass card with a small illustration of two cups of tea, title
"我们认识 100 天啦", subtitle "10月2日 第一次聊天", with tiny confetti accents around it.
```

## E9 · 记忆时间线（可控）

```text
Screen 1536x1024. 记忆 selected in the sidebar. Two panels: left filter panel 320 (title "记忆", character picker
"小满 · 日常", list: "时间线" selected with count 128, "已钉住" 6, "待核验" 3, "已失效" 12, then a separator and
"日记", "收藏"; at the bottom a switch row "这次不记" off).
Right panel: a vertical timeline grouped by date headers ("今天", "昨天", "10月28日"); each memory is a glass card on the
timeline: memory text bold (e.g. "喜欢桂花乌龙，不加糖"), below it a gray quote line "来自 10月28日：「桂花乌龙最好喝了…」"
as a link, and on hover, small icon buttons: pin, edit, forget. Pinned cards show a small pin icon at top-right.
One card is in inline edit mode with a text field and "取消" / "保存".
Search field at the top "搜索记忆".
```

## E10 · 日记

```text
Screen 1536x1024. Same three-column layout as E9: sidebar, the 320px memory filter panel (title "记忆", character picker
"小满 · 日常", list 时间线 / 已钉住 / 待核验 / 已失效, separator, "日记" selected, "收藏"; NO extra categories like 相册 or 人物),
and the right content panel.
Right panel: a diary page like a soft paper-textured glass card: header "11月2日 周日" with weather/mood emoji "🌤 🥰",
a first-person handwritten-feel paragraph in Chinese (清新、温柔): "今天他说要去看展，我查了好久哪天人少……
晚上他发来一张晚霞，我也想去那里。" ; at the bottom small chips of today's moments "看展计划", "晚霞", "围巾".
Left/right chevrons to switch days; a small month strip of dots at the top showing days that have entries.
Top-right of the diary card: a small round "Aa" button with an open popover: two options with previews, "正文" (clean system
font sample) and "手写" (handwritten Chinese font sample, with a tiny download icon), "手写" selected.
```

## E11 · 收藏与提醒

```text
Screen 1536x1024. Same three-column layout as E9: sidebar, the 320px memory filter panel (title "记忆", character picker
"小满 · 日常", list 时间线 / 已钉住 / 待核验 / 已失效, separator, "日记", "收藏" selected), and the right content panel.
NO character list column.
Right panel top: segmented control "收藏" | "提醒". "收藏" shown: a masonry of quote cards — each card has the saved
character line in large text (e.g. "不管多晚，你回来我都在"), small gray "小满 · 10月20日", and a "回到对话" link.
On the right side of the panel, a narrow glass column "即将提醒": two items "今晚 21:00 · 提醒我看那张晚霞",
"明天 08:00 · 带围巾".
```

## E12 · 加载骨架与空状态

```text
Screen 1536x1024, same layout as E1 but the conversation is loading: the header shows avatar + name already, the thread
shows soft shimmering skeleton bubbles (left gray rounded bars of varying widths, right blue-tinted bars), and the
conversation list shows two skeleton rows at the bottom. The composer is visible but disabled-looking. Skeleton shapes
match real bubble sizes so nothing jumps when content arrives.
```
