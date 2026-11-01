# MB-1 移动端设计图提示词（uni-app 手机界面）

依据：[ADR-0011](../../../decisions/0011-mobile-uniapp-ui-st-engine.md)。风格沿用 UX-11「B 沉浸景深」
（`.review-queue/UX-11/images/PICKS.md`）与 UX-23 C5 手机聊天（`.review-queue/UX-23/images/C5-1.png`）。
图只定方向、层次与版式；选定后翻译成 DESIGN.md 手机 token，开发只认 token，不按图逐像素还原。

## 使用方法

1. 每张图 = **公共块** +（对话类页面再加 **背景块 A 或 B**）+ **页面块**，原样拼接。尺寸 `1024x1536` 竖版，质量 high。
2. 背景块只用于对话类页面 M2–M6（对话、长按、富内容、通话、来电）；其他页面不加背景块。
   第一轮：M2–M6 各出 A、B 两张，其余页面各一张，共 19 张，全部浅色。选定后再用同一背景出深色版（追加深色块）。
3. 文件名 `<编号>-<A|B|0>-<light|dark>-<序号>.png`（不分背景的页面用 `0`），例如 `M2-B-light-1.png`。
   存到仓库根目录 `.review-queue/MB-1/images/`（Git 忽略，不提交）。
4. 生成方式见 `docs/planning/2026-11-02-session-handoff.md` §1.3（Codex CLI，关闭标准输入，可并行）。
5. 挑选结果写在同目录 `PICKS.md`：每页一行「编号 → 选中文件 + 保留什么 / 不要什么」，允许跨图组合。
6. 图里的错字、乱码不影响挑选；图中出现产品没有的能力（见公共块「不要画」）一律不采用。

全部内容为合成示例：角色是原创虚构动漫风人物，不使用真实人物、品牌标志或真实数据。

统一合成内容：角色「小满」（暖桃色氛围，短发少女），实例「日常」；其他会话「林舟 · 剧情」（冷蓝，少年）、
「白芷 · 夜聊」（淡紫，长发少女）、「澄夏 · 旅行」（橙色）。用户称「你」。

---

## 公共块（每张必带）

```text
High-fidelity mobile app UI screenshot, 1024x1536 portrait, for a private AI companion chat app "Virtual Companion".
Visual language: Apple iOS 26 app grammar with "Liquid Glass" materials, intensity "immersive depth" (variant B):
soft aurora light tinted by the current character's color (warm peach for 小满) glowing behind content,
frosted-glass floating controls (navigation buttons, tab bar, composer, menus) with strong blur, 1px white rim,
soft depth shadow; content surfaces are calm solid cards. Simplified Chinese UI text, SF Pro / PingFang SC look, crisp.
Single accent color Apple blue #0071E3 only for interactive elements and the user's own bubbles.
Status = small colored dot + text. Thin rounded line icons (Lucide style). Touch targets at least 44px.
Root pages: large title at top-left, round avatar button at top-right (opens settings), and a floating glass capsule
tab bar at the bottom with 5 tabs with icons and labels, icons exactly: 聊天 = speech bubble, 角色 = person,
记忆 = open book, 陪伴 = heart, 剧情 = clapperboard. The tab bar is hidden inside a conversation.
Pages without a background block use only the soft aurora, never an illustrated picture. Respect the status bar (time 9:41, no carrier name) and the home indicator safe area.
No page subtitles or explanatory paragraphs; layout explains itself.
Do NOT draw: read receipts, "online" status or presence dots on avatars, message reactions, ads, VIP, coins, follower counts, real brand logos.
Realistic product screenshot, pixel-aligned, no device frame, no watermark, no lorem ipsum.
Original anime-style characters only (no real people).
```

## 背景块（仅 M2–M6，二选一）

### A · 极光

```text
Background: the character-tinted aurora only (soft peach blobs on #EEF0F6 base, about 45% visible, faint film grain),
no picture. Character bubbles are light glass (white 72% opacity).
```

### B · 场景插画

```text
Background: a soft, slightly blurred anime-style illustrated scene behind the conversation (for 小满: a sunlit room by a
window with sheer curtains, cherry blossoms outside, warm morning light). The scene itself is environment only: no people, no character
figure or face in the scene (avatars still show the character as usual); low contrast and softly blurred, with a gentle top and bottom fade so the
navigation and composer stay readable. Character bubbles are light glass (white 78% opacity) over the scene.
```

## 深色块（选定后追加）

```text
Dark mode (this whole screen is the DARK version, overriding any light base color above): near-black base #07070A,
aurora glows brighter (scene illustration, if any, becomes an evening / night version with dim warm lamps),
glass controls smoky dark gray, character bubbles rgba(255,255,255,0.10) with off-white text #F5F5F7,
user bubbles Apple blue, secondary text #B2B2B7, hairlines light at 8% opacity.
```

---

## 页面块

### M1 · 聊天列表（根页面）

```text
Screen: root tab "聊天" selected. Large title "聊天", top-right round avatar button. A glass search field "搜索".
Conversation rows (avatar 52px with a soft halo in each character's tint, name + gray instance, one-line preview,
time on the right): "小满 日常" preview "有一张晚霞超好看，等下发你" "14:32" with a blue unread count "2";
"林舟 剧情" preview "[互动卡片]" "昨天"; "白芷 夜聊" with gray preview "草稿：明天再聊" "周一";
"澄夏 旅行" preview "[语音] 0:08" "10/28". One row is swiped left revealing "置顶" (gray) and "删除" (red) actions.
Faint peach aurora at the top behind the title.
```

### M2 · 对话（最重要）

```text
Screen: conversation with 小满, full screen, no tab bar.
Top: round glass back button (left), centered glass capsule with avatar 32 + "小满" + small chevron (opens character info),
right: two round glass buttons, phone (voice call) and magnifier (search in chat).
Thread like iMessage / WeChat adapted to glass:
- centered small date pill "今天 08:02";
- 小满 (left, light glass bubbles, grouped: 4px gap inside a group, avatar 36 only next to the LAST bubble of a group,
  inner corners smaller, a small tail on the last bubble): "早呀～" / "今天降温了，出门记得带围巾";
- 你 (right, Apple-blue bubbles, white text): "收到！" / "你今天干嘛";
- 小满: "在整理上次拍的照片" / "有一张晚霞超好看，等下发你";
- under the last user bubble a tiny gray "已发送";
- at the bottom a typing indicator bubble with three gray dots next to 小满's avatar.
Bottom: floating glass composer above the home indicator: round "+" button, input capsule with placeholder "发消息…",
emoji (smile) icon and microphone icon inside the capsule at the right. No send button while empty.
```

### M3 · 长按菜单与引用

```text
Screen: conversation with 小满, no tab bar: round glass back button, centered glass capsule with avatar + "小满", round glass phone and magnifier buttons on the right; grouped light glass character bubbles on the left with avatar beside the last bubble of a group, Apple-blue user bubbles on the right; floating glass composer at the bottom ("+", input "发消息…", emoji and microphone icons). The user long-pressed the 小满 bubble "有一张晚霞超好看，等下发你":
the bubble is lifted and slightly enlarged, everything else blurred and dimmed behind it.
Under it, an iOS-style glass context menu (rows 44px, icons on the right): "引用", "复制", "朗读", "选择文本",
divider, "编辑", "重新生成", divider, "删除" in red.
```

### M4 · 富内容

```text
Screen: conversation with 小满, no tab bar: round glass back button, centered glass capsule with avatar + "小满", round glass phone and magnifier buttons on the right; grouped light glass character bubbles on the left with avatar beside the last bubble of a group, Apple-blue user bubbles on the right; floating glass composer at the bottom ("+", input "发消息…", emoji and microphone icons), scrolled to show varied message types:
- a 小满 voice bubble: play button, 12 waveform bars (half played, blue progress), "0:08", and a small "转文字" text button;
  below it the transcript expanded in small gray text "刚下班，路上风好大，你到家了吗？";
- a 小满 photo message: rounded 4:3 image of a sunset over a lake, tap-to-view;
- a sticker message: a cute peach-colored sticker of the character waving, no bubble background, 120px;
- a 你 bubble that quotes: inside the blue bubble top, a thin white left bar and small text "小满：有一张晚霞超好看", then "哇，真的好好看";
- a 小满 message row that contains interactive card content, shown as a compact glass row with a small grid icon,
  text "互动卡片 · 状态栏" and a chevron "打开" (opens the full card view);
- the latest 小满 reply was interrupted: bubble text ends with "……我们周六下午" followed by a small gray tag "未完成"
  and a blue text button "继续".
```

### M5 · 语音通话

```text
Screen: full-screen voice call with 小满 (in-app, not a system UI).
Center top: large avatar 160px with a breathing peach halo; name "小满"; gray call time "03:12".
Middle: live caption area showing what 小满 is saying, current sentence bright, previous one faded:
"那我们周六下午去看展吧，" / "我查了一下，那时候人少一点。"
A soft audio waveform ring around the avatar indicates she is speaking. Bottom: three round glass buttons with labels "静音", "免提", "字幕" and a large red hang-up button
in the center row below them. Home indicator area clear.
```

### M6 · 角色来电（Android 全屏来电）

```text
Screen: Android 16 full-screen incoming call notification on the lock screen, styled by the app:
blurred background from the background block, avatar 120px with peach halo, "小满" large, gray "来电".
Bottom: a green round "接听" button and a red round "拒绝" button, and between them a small glass text button
"回消息" (opens quick reply). Lock-screen clock "9:41" at the top.
```

### M7 · 通知与快捷回复（Android 通知栏）

```text
Screen: Android 16 notification shade pulled down over a home screen. One expanded notification from "Virtual Companion"
with small app icon, title "小满", time "现在", text "下班了吗？今天降温，记得带围巾", a small avatar at the right.
Its inline reply field is open: input "好，马上就走～" with a send arrow, and action chips "回复", "标为已处理".
Below, a collapsed second notification "白芷 · 语音消息 0:06". Material-style shade, but the app's notification uses
its own avatar and accent blue.
```

### M8 · 分享给 TA

```text
Screen: the app opened from the Android system share sheet, showing a bottom sheet over a dimmed screen (large sheet,
grabber at top, title "发给"). A horizontal row of character avatars with names: "小满" (selected, blue ring),
"白芷", "林舟", "澄夏". Below: a preview card of the shared content (a photo of a cat on a windowsill, and a link card
"周末展览 · example.com"). An input "说点什么…" and a pill button "发送" (blue) at the bottom right of the sheet.
```

### M9 · 陪伴（根页面）

```text
Screen: root tab "陪伴" selected (tab badge "2"). Large title "陪伴", top-right avatar.
A vertical timeline of cards from characters: "小满 · 日常" "今天 08:02" text "早呀，今天降温了，出门记得带围巾。"
with green dot "飞书已送达"; a missed-call card: phone icon in red, "小满 · 未接来电" "昨天 21:40", a voice-message chip
(play, waveform, "0:12") and a blue text button "回电"; a card from "白芷 · 夜聊" with orange dot "待发送".
Section "跟进" with one row "提醒带围巾 · 明天 19:00" and a checkbox. Row "静默时段  23:00 – 07:30" with a switch on.
```

### M10 · 角色（根页面）

```text
Screen: root tab "角色" selected. Large title "角色", top-right avatar, a glass "+" button left of it (import).
A 2-column grid of character cards: square portrait with soft tint halo, name, gray "2 个实例":
小满 (peach), 林舟 (cool blue), 白芷 (lavender), 澄夏 (orange). Tapping opens detail; show 小满 card pressed (scaled 0.97).
```

### M11 · 记忆（根页面）

```text
Screen: root tab "记忆" selected. Large title "记忆", top-right avatar. A selector capsule "小满 · 日常" with chevron,
a search field, and a segmented control "全部 128 / 待核验 3 / 已失效 12" (全部 selected, white slider).
Grouped list of memory rows: "喜欢桂花乌龙，不加糖" gray "10/28" green dot "已确认";
"周三晚上常去湖边散步" "10/24" orange dot "待核验"; "怕冷，冬天手总是冰的" "10/20" "已确认".
One row swiped left revealing "纠正" (blue) and "删除" (red).
```

### M12 · 剧情（根页面）

```text
Screen: root tab "剧情" selected, background aurora deep blue-teal. Large title "剧情", top-right avatar,
a pill button "新开局". Cinematic case cards (16:9 cover, 24px radius, foggy harbor illustration, fog gradient):
"雾港旧案" gray "第三幕 · 证物 6" with a pill "继续"; a second card "钟楼失踪案" "第一幕". Below, a grouped list "存档":
"第三幕开场 · 10/30 22:14" with text button "回档".
```

### M13 · 设置（大 sheet）

```text
Screen: settings as a large sheet over a dimmed page (grabber, title "设置", "完成" text button at top-right).
Grouped inset lists with 30px rounded-square colored icons and chevrons:
group 1: account row with avatar 56, name "你", gray "密码与身份验证器";
group 2: "模型", "语音", "通知", "外观";
group 3: "账户与数据";
group 4 header "酒馆": "AI 回复配置", "提示词格式", "世界书", "扩展", "人设", "角色卡" (these open the card view).
```

### M14 · 启动与离线状态

```text
Screen: conversation with 小满, no tab bar: round glass back button, centered glass capsule with avatar + "小满", round glass phone and magnifier buttons on the right; grouped light glass character bubbles on the left with avatar beside the last bubble of a group, Apple-blue user bubbles on the right; floating glass composer at the bottom ("+", input "发消息…", emoji and microphone icons), right after the app opens: history is already visible (小满: "早呀～" / "今天降温了，出门记得带围巾"; 你: "收到！" / "你今天干嘛"; 小满: "在整理上次拍的照片"). Below the navigation bar floats a small glass capsule with a spinning indicator "正在连接…".
The composer is visible; the user has typed "晚上吃什么" and the round blue send button is shown dimmed with a small
spinner (waiting to send, not lost). No other banners.
```

---

## 挑选时请重点看

1. 背景：A 极光还是 B 场景插画，看久了是否累、气泡是否清楚。
2. 对话（M2–M4）：气泡分组、头像、语音条、卡片占位行是否顺眼。
3. 通话与来电（M5、M6）：是否像真的打电话，按钮位置是否顺手。
4. 根页面（M1、M9–M12）与设置（M13）：标签栏、大标题、列表密度是否像同一款 App。
5. 状态（M14）：连接中的提示是否足够轻。
