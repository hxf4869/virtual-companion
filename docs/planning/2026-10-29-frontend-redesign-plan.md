# V2 前端重设计实现计划（2026-10-29）

设计真源：根目录 [DESIGN.md](../../DESIGN.md)（第 2 版）；交互基线：
[docs/product/v2-redesign/prototype.src.html](../product/v2-redesign/prototype.src.html)。
本文件只规定落点、顺序、测试合同与验收；视觉与交互细节一律以 DESIGN.md 为准，不在此重复。

## 1. 边界

- 只改扩展 `integrations/sillytavern/extension/vc-model-settings/` 与对应测试 / 验收脚本；不改上游
  `upstream/`，宿主 HTML / CSS 不打补丁。必须改宿主脚本时，按 `scripts/lib/paths.mjs` 的
  `CORE_PATCH_SPECS` 新增 JS 补丁规格，并先说明原因。
- 不改 Go API、数据结构与 ST 生成链；新 UI 只通过现有扩展 API 与 ST 事件取数和挂钩。
- 不删测试、不加 skip。测试里锁定旧视觉的断言（旧色值、旧断点、旧导航数量、CSS 源码片段）随新设计
  改成新合同；锁定行为的断言（`data-action`、id、状态文案、焦点、门禁）保留。每批在交付说明里逐条列出
  改动的断言及理由。

## 2. 关键技术决定（来自四份只读调查）

| 主题 | 决定 | 依据 |
|---|---|---|
| 样式层 | 新建 `vc-ui.css`：后加载、不放 `@layer`、全部挂在 `body.vc-ui` 下，变量 `--vc-*`。压过宿主 `!important`：`body.no-blur *` 的去模糊（默认开启）、`documentstyle` / `bubblechat`、头像形状；隐藏 `#bg1`；去掉全局 `text-shadow` | `public/css/toggle-dependent.css:50-57,354-369`、`power-user.js:140,959` |
| 字号 | 刻度 = `calc(var(--fontScale) * 基准)`，输入框 `max(17px, …)` | `style.css:20-133`、`index.html:5061` |
| 主题色 | 监听 `meta[name=theme-color]` 并按明暗写回 | `power-user.js:1126-1128` |
| 抽屉 | 原位打开、换外观，不搬节点；按九个内容根 id 写样式，在 `.drawer-content` 内部插入本系统导航栏 | `script.js:10953-10989,12181-12189`；`RossAscends-mods.js:1209-1267`；`toggle-dependent.css:554-561` |
| 窄屏冲突 | `mobile-styles.css` 在 ≤1000px 把抽屉改成 fixed 全屏并锁 `body` 触摸；`body.vc-ui` 按 id 覆盖 | `mobile-styles.css:250-400` |
| 聊天 | `#chat` `#sheld` `#send_form` 内宿主节点与 `.mes` 结构不替换；`.mes` 仍为 `#chat` 直接子节点；滚动仍在 `#chat` | `script.js:448-449,2551-2704,2773,11226` |
| 流式渐清 | 开启宿主 `stream_fade_in`，把 `.text_segment` 动画改为模糊渐清；不往 `.mes_text` 插节点 | `util/stream-fadein.js:17-68`、`script.js:3643-3730` |
| 角色卡内容 | `.mes_text` 只设字体字号行高颜色；不限制 `.TH-render` / iframe 高度 | `JS-Slash-Runner/src/iframe/adjust_iframe_height.js` |
| 消息操作 | 长按菜单调用宿主已有入口（`.mes_copy`、`.mes_edit`、`#option_regenerate`、`swipe()` 等），不复制逻辑；与 swipe-picker 500ms 长按、手势 swipe 错开 | `script.js:11146-11990`；`swipe-picker.js:425-428` |
| 弹窗 | 宿主 `Popup` / `toastr` 只重绘；自有页继续用 `<dialog>` | `popup.js:235-240,679-685` |
| 图标 | Lucide 静态 SVG sprite 放扩展目录，由 Git 管理，不进 `vendor.lock.json`；宿主模板 Font Awesome 保留着色 | `scripts/lib/managed.mjs:94-100`、`vendor.lock.json` |
| 键盘 | 自有脚本监听 `visualViewport`，写 `--vc-keyboard`；不改宿主 `100dvh` 规则 | `index.html:8220-8226` |

## 3. 对照表

| 新界面（DESIGN.md） | 现有来源 | 方式 |
|---|---|---|
| 标签栏 / 侧边栏 | `#vc-chat-nav`（八个 `data-nav`）+ `#vc-chat-more` | 重做为五个目的地；模型、账户进设置；保留 `data-nav` 值 |
| 设置 sheet / 页 | 新建；入口为头像按钮 | 列表行打开模型、通知、账户与数据、外观、酒馆九项 |
| 会话列表 | 实例数据（`instance-page.js` 所用接口）+ ST 当前聊天 | 新建列表页；点行切换实例并进入对话 |
| 对话 | `#sheld` `#chat` `.mes` `#send_form`、`chat-shell.js` 状态、`f2-client.js` 冲突 | 只换外观与布局；状态胶囊、海报、氛围色为新增节点（不放进 `#chat` 被 `clearChat` 清除的位置） |
| 记忆（标签页与对话内检视） | `memory-page.js` `.vc-memory-dialog`、`#vc-memory-controls` | 重排为列表 + sheet / 检视栏；控件挂点不变 |
| 陪伴 | `inbox-page.js` `.vc-inbox-dialog` | 重排 |
| 角色 | `instance-page.js` `.vc-instance-dialog`；卡片编辑用 `#right-nav-panel` 原位打开 | 角色卡网格 + 实例；导入 / 编辑沿用宿主 |
| 剧情 | `story-page.js` `.vc-story`（`data-state` 状态机） | 案件卡、开场转场、NPC 打光、证物翻面 |
| 设置 › 模型 | `page.js` `#vc-model-settings-root .vcms-overlay` | 重排为分组表单；全部 id 与 `data-action` 保留 |
| 设置 › 账户与数据 | `data-rights.js` `.vc-data-dialog` | 重排；五个分区 `aria-label` 保留 |
| 设置 › 酒馆九页 | `#left-nav-panel` `#rm_api_block` `#AdvancedFormatting` `#WorldInfo` `#user-settings-block` `#Backgrounds` `#rm_extensions_block` `#PersonaManagement`（角色卡编辑为 `#right-nav-panel`） | 原位打开，换外观；`#extensions_settings*` 第三方区只套 token |

## 4. 分批与写入 owner

同一文件同时只有一个写入 owner。`vc-ui.css` 与组件脚本由 F0 建立后冻结，之后的增改经设计把关者
（Claude）合入；各页只改自己的脚本与样式文件。

| 批次 | 内容 | 主要文件 | 依赖 |
|---|---|---|---|
| F0 地基 | `vc-ui.css`（tokens 明暗、材质、宿主覆盖、通用控件、`.popup` / toastr 重绘）；`ui/` 组件脚本（推入 / 返回、头像飞行、弹出菜单、sheet 拖拽、alert、提示条、分段控件、开关、弹簧）；Lucide sprite 与图标函数；`body.vc-ui` 开关、`theme-color`、`visualViewport` | 新增 `vc-ui.css`、`ui/*.js`、`icons/`；`index.js` 只加挂载 | — |
| F1 外壳 | 标签栏 / 侧边栏、一级页面容器与大标题、设置 sheet / 页、会话列表；三档断点布局 | `chat-shell.js`、`chat-shell.css`、`index.js` | F0 |
| F2 聊天 | 消息铺开 / 气泡、输入区、流式渐清、长按菜单、海报与氛围色、对话状态胶囊、F2 冲突 sheet、对话内记忆检视 | `chat-shell.*`（F1 交接后）、`f2-client.js`、新 `chat-view.*` | F1 |
| F3 设置与酒馆 | 九个抽屉原位成页、模型页（含“本机模型”区：embedding 与重排的名称、运行状态、重排开关，接口由 LM 任务提供）、账户与数据、外观 | `page.js`、`style.css` 模型段、`data-rights.js`、`account.css`、新 `drawers.*` | F1 |
| F4a 记忆 | 记忆标签页 | `memory-page.js`、记忆样式迁出 `style.css` 到 `memory.css` | F1 |
| F4b 陪伴 | 陪伴标签页 | `inbox-page.js`、`inbox.css` | F1 |
| F4c 角色 | 角色标签页 | `instance-page.js`、`instance.css` | F1 |
| F4d 剧情 | 剧情标签页与舞台 | `story-page.js`、`story.css` | F1 |
| F5 收尾 | 桌面三栏与检视栏联动、全站走查、DOM 映射复核 | 按缺陷归属 | F2–F4 |

F0、F1 串行；F2、F3、F4a–d 共六路并行。

## 5. 验收

每批交付必须同时满足：

1. 单测：`node --test "integrations/sillytavern/tests/*.test.mjs"` 全过；更新的断言逐条说明。
2. 受管浏览器验收：本批涉及的 `w15-ui`、`ui03`、`w05`–`w07`、剧情相关场景通过（`accept-managed.mjs`），
   选择器随新 DOM 更新但断言的行为不减。
3. 截图：390×844 与 1440×900，浅色与深色，本批涉及的每个页面与状态；另抽查 360、768。
   截图交设计把关者对照 DESIGN.md 与原型逐项评审，未通过的按评审意见返工。
4. 设计检测：`node <impeccable>/scripts/detect.mjs --json <改动文件>`，机械问题修掉。
5. 合并前：`bash scripts/check.sh`。

整体完成条件：DESIGN.md 第 3 节规则无违例；第 11 节验收宽度全部走查；`body.vc-ui` 去掉后 ST 原生
外观仍可用；角色卡状态栏（C04 卡）与 Tavern Helper iframe 在新外观下正常显示与自适应高度。

## 6. 风险

- 宿主设置可能把新外观改坏（主题色、文档模式、头像形状、去模糊）：F0 用覆盖规则固定，并在验收中逐项切换核对。
- 抽屉“点外部关闭”会被标签栏点击触发：抽屉成页时标签栏隐藏，返回按钮放在抽屉内部。
- 中文流式分段依赖 `Intl.Segmenter`，片段粒度不可控：只要求渐清效果连贯，不承诺按字。
- 测试合同面广（约百个选择器与文案）：每批先列出受影响断言再动手。
