# UX-11 设计图生成提示词（gpt-image-2）

用途：在写代码前，用生成图确定桌面「沉浸玻璃」风格的强度与关键页面版式，由 Owner 挑选。
图只用于定方向与版式；选定后由 [实施方案](../../../planning/2026-11-01-ux11-desktop-immersive-plan.md) 的 T0 把图翻译成 DESIGN.md 第 4 版 token，开发只认 token 与 HTML 样板，不按图逐像素还原。

## 使用方法

1. 每次生成 = 「公共风格块」+「强度变体块（A / B / C 选一）」+「页面块」，三段原样拼接后提交。
2. 尺寸：桌面 `1536x1024`（横版）；手机 `1024x1536`（竖版）。质量选 high。
3. 每个页面先只出浅色 A / B / C 三张；选出强度后，再用同一变体出深色版。
4. 文件名：`<页面编号>-<变体>-<light|dark>-<序号>.png`，例如 `D1-B-dark-2.png`。
   存放到仓库根目录 `.review-queue/UX-11/images/`（已被 Git 忽略，不提交）。
5. 挑选结果写在同目录 `PICKS.md`：每个页面一行「编号 → 选中文件 + 一句话想保留什么 / 不要什么」。
   允许跨图组合，例如「D1 用 B 的背景强度，用 A 的侧栏」。
6. 生成图里的错字、乱码、按钮数量错误不影响挑选；只看风格、层次、密度和版式。

全部内容为合成示例：角色是原创虚构动漫风人物，不使用真实人物、品牌标志或真实数据。

---

## 公共风格块（每次必带）

```text
A high-fidelity desktop app UI screenshot for an AI companion chat app named "Virtual Companion",
designed in the visual language of Apple visionOS and macOS Sequoia, "immersive glass" style.
Chinese (Simplified) UI text, system font look (SF Pro / PingFang SC), crisp and legible.

Overall composition: a full-window ambient background made of 2–3 large, very soft, slowly drifting
aurora light blobs tinted by the current character's color (warm peach-coral for the default character),
plus a faint film-grain texture to avoid banding. On top float frosted-glass panels with 12px gaps
between them and the window edge: a narrow glass sidebar on the left, then one or more content panels.
Panels have 24px corner radius, strong background blur, subtle saturation boost, a 1px inner top
highlight, a hairline edge, and a soft large drop shadow so they feel layered in depth.
Inside panels, grouped list cards are slightly lighter/darker solid surfaces (not glass), 16px radius.

Single accent color: Apple blue #0071E3 used only for interactive elements and selection.
Status uses a small colored dot plus text (green = available, orange = needs setup, red = error).
Icons: thin rounded line icons (Lucide style, 1.75px stroke).
Typography: page title 28px bold, section title 17px semibold, body 15px regular, secondary 13px gray.
Buttons are pill-shaped, 44px tall, width fits the label (never stretched across the panel).
Primary button has a soft blue glow on hover. Generous but not wasteful whitespace, aligned to a clear grid.
No marketing hero sections, no lorem ipsum, no watermark, no browser chrome, no device frame.
Perfect pixel alignment, realistic product screenshot, 1x UI scale.
```

## 强度变体块（三选一）

### A · 轻盈极光

```text
Intensity: light and airy. Aurora blobs are pale and low-saturation (about 25% visible),
glass panels are highly translucent and bright, shadows are very soft. Calm, elegant, close to
Apple's own apps. Light mode base color #F2F3F7.
```

### B · 沉浸景深（推荐先看）

```text
Intensity: immersive. Aurora blobs are clearly visible and richly colored (about 45% visible),
with depth: the sidebar sits furthest back, content panels in front, dialogs and menus frontmost
with stronger blur and shadow. Selected items have a subtle glowing glass "lens" highlight.
Character avatars have a soft colored halo in the character's tint. Feels premium and alive
without hurting readability. Light mode base color #EEF0F6.
```

### C · 高光戏剧

```text
Intensity: dramatic. Saturated multi-hue aurora (character tint plus a violet and a blue companion hue),
strong glow around the active panel edge, specular highlights on glass, light rays and bokeh
particles in the background, bold depth separation. Maximum "wow" while text stays readable.
Light mode base color #EBEDF5.
```

深色版在变体块末尾追加：

```text
Dark mode: base color near-black #06070A, aurora blobs glow brighter against the dark,
glass panels are smoky dark gray (about 60% opacity), text is off-white #F5F5F7,
secondary text #98989D, hairline edges are light at 8% opacity.
```

---

## 页面块

统一的合成内容（保持各图一致，便于对比）：
角色「小满」（暖桃色氛围、短发少女、原创动漫风头像），实例「日常」；
其他会话：「林舟 · 剧情」（冷蓝氛围、少年）、「白芷 · 夜聊」（淡紫氛围、长发少女）、「澄夏 · 旅行」（橙色氛围）。

### D1 · 聊天（三栏 + 角色面板）— 最重要

```text
Screen: main chat view, 1536x1024 window.
Left: glass sidebar 232px wide with 5 destinations stacked vertically with icons and labels:
"聊天" (selected, glowing glass lens), "角色", "记忆", "陪伴" (with a small red badge "2"), "剧情";
at the bottom a round user avatar and a "设置" gear item.
Second column: glass panel 320px, title "聊天", a search field "搜索", and a conversation list:
rows with 48px round avatar, name + instance in gray ("小满 日常"), one-line preview, time on the right
("14:32", "昨天", "周一"), an unread blue dot on the first row. The selected row "小满 日常" is highlighted.
Center: the largest glass panel, the conversation. Top bar inside the panel: avatar, "小满" and gray "日常",
on the right two round glass icon buttons (character panel toggle, more). Messages column max 720px centered:
character messages as plain reading text without bubbles (17px, line-height 1.7), user messages as right-aligned
light gray bubbles. Example: character: "今晚风小了一点，要不要沿湖走一圈？我带了你上次说想喝的桂花乌龙。"
user: "好呀，等我十分钟。" character (streaming, last characters fading in, a small peach breathing dot at the end):
"那我在长椅那边等你，别跑太快……"
Bottom of the conversation panel: a floating glass composer capsule max 720px: "+" button, input placeholder
"发消息…", a microphone icon, and a round blue send button.
Right: collapsible glass character panel 320px: large 96px avatar with peach halo, name "小满", "日常",
a mood line with dot "心情 · 开心"; three round quick actions with labels "声音", "记忆", "设置";
a section "本次想起" with 3 small memory cards (e.g. "喜欢桂花乌龙", "周三晚上常散步", "怕冷");
a section "跟进" with one item "提醒带围巾 · 明天 19:00".
The peach aurora glows behind the whole window, strongest behind the conversation.
```

### D2 · 角色

```text
Screen: "角色" destination. Glass sidebar on the left ("角色" selected).
Main glass panel: title "角色", a search field and a pill button "导入角色" on the right of the title row.
A responsive grid of character cards (about 220px wide each, 4 per row): each card shows a large square
character portrait with a soft tint halo in that character's color, name below, and gray "2 个实例".
One card is hovered: lifted 4px with a slight 3D tilt and a moving specular highlight.
On the right, a 400px glass detail panel slid in for "小满": large portrait, name, short tag line "温柔 · 慢热",
a list group of instances ("日常 · 最近 14:32", "旅行 · 最近 10/24") each with a chevron,
and actions "新建实例" (pill), "编辑角色卡" (text button). Aurora tint follows the selected character (peach).
```

### D3 · 记忆

```text
Screen: "记忆" destination. Glass sidebar ("记忆" selected).
Main glass panel split in two: a 240px inner filter column with a character/instance selector "小满 · 日常",
and filters as a vertical list "全部 128", "待核验 3", "已失效 12";
the right area has a search field and a list of memory cards. Each card: one-line memory text
("喜欢桂花乌龙，不加糖"), gray meta line "小满 · 日常 · 10/28", a status dot + text ("已确认" / "待核验"),
and on hover two small text buttons "纠正" and "删除" (red). One card shows the "待核验" state with an
orange dot. Calm and dense enough for scanning, clean alignment.
```

### D4 · 陪伴

```text
Screen: "陪伴" destination (proactive messages from characters). Glass sidebar ("陪伴" selected, badge "2").
Main glass panel: title "陪伴"; a vertical timeline of message cards: avatar, "小满 · 日常", time "今天 08:02",
message text "早呀，今天降温了，出门记得带围巾。", delivery status "已送达" with a green dot;
another card with a voice message chip (waveform, "0:08") and status "待发送" orange dot.
Right 320px column inside the panel: card "跟进事项" with 2 items and checkboxes;
card "静默时段" with "23:00 – 07:30" and a switch (on).
```

### D5 · 剧情

```text
Screen: "剧情" destination. Glass sidebar ("剧情" selected).
Main glass panel: title "剧情", a pill button "新开局". Grid of cinematic case cards (16:9 covers, 24px radius)
with moody foggy illustrations and gradient fog at the bottom, title "雾港旧案", meta "第三幕 · 证物 6",
a "继续" pill button on each card. The hovered card has a light sweep and depth lift.
Below: a list group "存档" with rows "第三幕开场 · 10/30 22:14" and a text button "回档".
Background aurora is deep blue-teal for this screen.
```

### D6 · 设置 › 模型

```text
Screen: settings, opened as a desktop page. Glass sidebar with "设置" selected at the bottom.
Main glass panel in macOS System Settings layout: left inner column 240px listing settings categories with
colored 28px rounded-square icons: "账户", "模型" (selected), "语音", "通知", "外观", "账户与数据",
then a group "酒馆" with "AI 回复配置", "提示词格式", "世界书", "扩展", "人设", "背景", "界面", "API 连接", "角色卡".
Right content area: header row with title "模型" and on the far right of the content column a pill button
"保存" (disabled/dimmed, because nothing changed).
Content: group "供应商" with rows "日常模型服务  ● 已启用  >" and "备用模型服务  ● 缺少密钥  >" and a text button "新建供应商".
Group "用途" as a clean 3-column table: purpose ("前台聊天"), model select ("日常模型服务 · 日常聊天"),
status dot + text ("已就绪"); rows: 前台聊天, 记忆提取与摘要, 后台问候, 剧情导演, 剧情 NPC, 向量检索 ("待配置" orange).
Group "本机模型": "向量 · 运行中", "重排 · 运行中" with a switch.
Group "用量": month switcher "‹ 2026-10 ›" and a small bar chart.
All groups aligned to one content column, form rows use a fixed label column and compact controls.
```

### D7 · 设置 › 语音（表单密度基准）

```text
Screen: settings › "语音", same settings layout as D6 with "语音" selected.
Right content: title "语音", pill button "保存" on the right of the header.
Form groups using one consistent row pattern: label column 160px on the left, control right after it
(not pushed to the far edge), compact inputs:
group "聊天语音": switch "可用" (on), "超时（秒）" number field "60", "每日上限" number field "60";
group "主动语音": switch on, "超时（秒）" "300", "每日上限" "8", "语音频率" select "标准";
group "语音输入": switch on, "超时（秒）" "30", "最长录音（秒）" "60";
a collapsible group header "场景指令" with a chevron (expanded) showing two labeled multi-line text areas
"早安" and "晚安"; a collapsed header "发送比例" with chevron.
Show one field in focus (blue 2px ring with soft glow). Show a toast at the top center of the content panel:
glass capsule with a check icon "已保存".
```

### D8 · 组件总表（用于统一细节）

```text
Screen: a design-system component sheet on the immersive glass background, organized in a clean grid of
labeled glass panels. Include, all in the same style:
Buttons: primary "保存", gray "取消", destructive "删除", text button "了解更多", disabled, loading "保存中…";
round glass icon button and a glass capsule of 3 icon buttons.
Inputs: text field with label column "显示名称", focused field with blue ring, error field with red outline
and message "密码不正确，请重试。", select "标准", number field, search field "搜索", multi-line text area.
Choice controls: checkbox checked/unchecked, switch on/off/disabled, slider with value "1.10×",
segmented control "少 / 标准 / 多".
Status: dot + text "可用" / "待配置" / "不可用"; badge "2".
Menu: a glass pop-up menu with items "复制", "编辑", separator, "删除" in red, with a checkmark item.
Feedback: toast "已保存", toast error "没有完成，请重试。"
Overlays: a compact confirm alert "放弃更改？" / "关闭后本次输入将丢失。" with "继续编辑" (focused) and "放弃" (red);
a 420px dialog "重新验证身份" with one password field and "取消" / "验证并继续".
Empty state: line icon, "暂无记忆", button "重新加载". Skeleton loading rows with shimmer.
```

### D9 · 弹窗场景（层次检查）

```text
Screen: settings › 模型 › "日常模型服务" provider detail page (label column form: "显示名称", "Base URL",
protocol choice list "Chat Completions" selected with checkmark, "API 密钥" row with "已保存" and "更换"),
with an unsaved change. In front of it a dimmed scrim and a centered compact glass confirm alert
"放弃更改？" "关闭后本次输入将丢失。" buttons "继续编辑" (default, focused ring) and "放弃" (red).
The dialog is clearly the frontmost layer: strongest blur, brightest edge highlight, biggest shadow.
```

### M1 · 手机对照（可选，只用于检查风格是否能延续到手机）

在公共风格块后追加 `Mobile phone screen 1024x1536, iOS 26 style, bottom floating glass tab bar with 5 tabs.`

```text
Screen: mobile chat with "小满", original iOS-style layout: top navigation with round back button, centered
avatar + name capsule, right round button; reading-style character messages, right-aligned user bubbles,
bottom floating glass composer above the floating glass tab bar is hidden in conversation.
Aurora tint is subtle (mobile keeps the original restrained look; only the background halo is slightly richer).
```

---

## 挑选时请重点看

1. 背景氛围强度：A / B / C 哪个看久了不累，深色是否更好。
2. 层次：侧栏、内容面板、弹窗三层是否一眼分得清。
3. 可读性：正文、次要文字在玻璃上是否清楚。
4. 密度：设置页（D6 / D7）标签与控件距离是否舒服，有没有「手机拉宽」的感觉。
5. 组件（D8）：按钮、输入、开关、菜单、提示是否像同一家族。
