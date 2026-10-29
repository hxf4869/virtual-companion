# V2 设计规范（工作副本）· Virtual Companion

版本：基于快照 R3（2026-10-27）建立的工作副本，2026-10-28（V2-W02）。
来源：[docs/source/v2-r3/DESIGN.md](../source/v2-r3/DESIGN.md)（只读快照，不改写）；Stitch 稿与页面实现的修订回写本文件。
用途：统一设计、Stitch 生成与 ST 页面实施的语义来源；ST 宿主实现映射见 §7，Stitch 页面映射见 §8.4。
状态：**设计规范与七类页面的 14 张 Stitch 桌面 / 手机稿已形成，来源见 §8.4。聊天、角色、记忆、主动陪伴、剧情、模型、账户与数据页面已在 SillyTavern 扩展中落地；旧 Vue 前端仍在，按 W15 第 5 步尚未删除。本句不代表 UI01–UI03 验收已经通过。**
图中的人物、对话、配置与任务状态均为合成示例。设计稿用于约束后续实现，不代表真实账户配置、
模型调用、通知投递、数据删除或手机运行验收已经通过。

## 1. 产品与设计方向

产品是个人使用的多角色 AI 陪伴与剧情应用，主宿主为 SillyTavern。核心感受是适合长时间阅读、角色清楚、操作直接、记忆可解释。界面使用简体中文，产品名在命名前使用“Virtual Companion”，不为当前工作额外设计品牌体系。

聊天内容是中心，角色列表、记忆和剧情信息按需出现。采用清晰文字层级和少量语义色，不用大量装饰遮挡文本、复杂卡状态栏和手机键盘。设置页采用常见表单，不要求用户理解 Node、Go、JSONL、CAS 等内部名词。

两个用户截图只表达模型配置要求，保留为参考：

- [供应商与三协议](../source/v2-r3/fixtures/model_config_protocols.png)
- [模型字段与高级配置](../source/v2-r3/fixtures/model_config_details.png)

不要把截图中的所有能力默认标记为支持；字段语义与实际能力按[架构 §17](../source/v2-r3/docs/03_architecture.md)落实。

## 2. 与 ST 生态的边界

- 继续使用原生 ST 的聊天、角色卡、世界书、预设、扩展生命周期与受支持的操作 API。
- 自有页面采用 ST 主题 / 组件 / UI extension 方式集成；新增导航入口使用最小实现。
- 不因 Stitch 导出 React / Vue 片段而新增一套完整聊天宿主、独立会话数据库或生成链。
- 原生 DOM / 事件有扩展依赖时先确认后改。需要改变的宿主行为集中记录为补丁，不在各页散落猴子补丁。
- 角色卡自带 HTML / iframe / 状态栏的样式可独立；产品只控制外层尺寸、滚动和主题入口，不能强行注入样式破坏卡作者布局。
- 复用已有图标与组件；没有实际重复需求不建设组件商城、通用表单平台或插件商店。

## 3. 视觉与布局 Tokens

以下为初始深色设计基线，适配长对话；实际 Stitch 稿可修订后回写本工作副本。原生 ST 主题仍需保持可用，不因自定义页面把全局主题选项弄坏。首版不要求额外维护两套独立皮肤代码。

| Token | 初始值 | 用途 |
|---|---|---|
| background | #14181F | 页面背景 |
| surface | #1C222C | 主要面板、表单 |
| surface-raised | #252D39 | 抽屉、弹窗、浮层 |
| border | #394453 | 普通分隔线与输入边框 |
| text-primary | #EFF3FA | 正文和主要标题 |
| text-secondary | #B7C1D2 | 辅助说明 |
| primary | #9AB9FF | 主要动作与选中状态 |
| text-on-primary | #131C30 | 主要按钮文字 |
| success | #8FD5AD | 已保存、实际验证通过 |
| warning | #F6C581 | 保存冲突、待配置、结果未确定 |
| danger | #FFAAA6 | 删除与明确错误 |
| spacing | 4 / 8 / 12 / 16 / 24 / 32 px | 统一间距级别 |
| radius | 8 px 输入、12 px 面板、16 px 大弹层 | 克制圆角 |
| font | 系统中文无衬线字体栈 | 不强制下载额外字体 |
| type | 14 辅助、16 正文、20 分节、28 页面标题 px | 手机表单以可读为先 |
| body-line-height | 1.6 | 长聊天阅读 |
| touch-target | 通常至少 44×44 px | 手机主要操作目标 |

不得仅因使用上述色值就声称无障碍已通过。实际稿与实现检查文字对比、键盘焦点、错误标识和可读性；状态同时有文字或图标，不只靠颜色区分。

### 响应式规则

| 场景 | 设计基线 |
|---|---|
| 宽桌面，参考 1440×900 | 左侧角色 / 会话导航约 260 px，中间聊天自适应；右侧记忆 / 剧情可折叠，不默认三栏同时挤满。 |
| 较窄桌面或平板 | 右侧内容改抽屉，保留聊天可读宽度；设置可使用两列。 |
| 手机，参考 390×844；补验 360 px 宽 | 单列主要内容，角色切换与辅助信息使用抽屉 / 独立页；不把桌面三栏缩小。 |
| 虚拟键盘打开 | 输入框和发送 / 停止按钮可见，安全区正确；消息列表能滚到最新，但不抢夺用户正在阅读的历史位置。 |
| 长表单 | 手机使用全屏或接近全屏页，内容区可滚动，保存 / 取消可达；不出现弹层内多层锁死滚动。 |

参考尺寸是设计输入，不是承诺所有机型逐一测试。首版至少验证实际目标手机及上述窄宽度边界。

## 4. 页面与必须呈现的状态

| 页面 ID | 内容 | 必须设计的状态 |
|---|---|---|
| UI-P01 聊天 | 多角色入口、角色 / 会话身份、消息、输入、复杂卡容器、当前模型、未读与记忆抽屉 | 空会话、流式中、停止、模型未配置、断线、F2 保存冲突、inbox 待写入 |
| UI-P02 角色 | 卡导入、角色模板、人设编辑、多个独立实例、世界书关联 | 首次创建、导入失败、模板与实例区别、编辑未保存 |
| UI-P03 记忆 | 搜索、来源、时间、修订、作用范围、纠正和删除 | 无结果、来源待核验、已失效、删除确认；原文仍保留的解释 |
| UI-P04 主动陪伴 / 通知 | 跟进事项、静默时间、角色级开关、inbox；邮箱 / 飞书配置与投递状态 | 未配置、已关闭、待发送、渠道接受、失败 / 结果未知、过期 |
| UI-P05 模型设置 | 供应商列表、三协议、模型编辑、能力、用途绑定、费用 | 空供应商、禁用、缺 Key、未知能力、配置冲突、显式测试中、预算不足 |
| UI-P06 剧情 | 案件选择、三 NPC、公共背景、行动、公共 / 私密线索、阶段、结局与回档 | 尚未开局、行动无效、缺配置、生成中、证据发现、结局、回档确认 |
| UI-P07 数据与账户 | 密码 / TOTP、导出、记忆与原文删除、删除进度和备份说明 | 导出处理中 / 部分完成、删除未完成、备份保留状态独立（V2 备份策略 W16 定义）、恢复限制 |

UI-P07 的数据域只覆盖 V2 数据：W01 已清除已定位的本机旧业务副本（ADR-0009 E3），V2 不接入旧来源——不需要导出、不进入 V2 上下文，也不保留旧聊天浏览器；不据此宣称全机所有数据副本（含匿名卷）已被证明不存在。V2 备份策略另行在 W16 定义（见 §8.3 与 §8.4）。

剧情页面不展示 NPC 的内部秘密或主持人真相给普通玩家。开发调试界面另设隔离的调试条件，不能把方便排错的全量状态放进正式页面 DOM、可读页面 JSON 或卡片 metadata。

角色归属、会话、剧情局和模型选择在用户需要决定时显示；不把源码路径、任务租约或内部失败栈放进普通产品流程。

## 5. 模型设置的具体交互

### 5.1 供应商

一张供应商卡包含名称、启停、Base URL、API Key 已配置状态、协议及模型列表。协议下拉仅包含：

- Anthropic Messages
- Chat Completions
- Responses

显示规范化最终地址。常见 Base URL 已带 /v1 时只追加正确 endpoint；对完整 endpoint 输入提供明确校验 / 转换提示，不默默双拼。模型列表可从服务商拉取时提供辅助按钮，始终允许手填 ID。

Key 输入保存后显示掩码或“已配置”，再编辑采用替换 / 清除；不把原值回填在页面数据里供复制。用户主动查看凭据若确有必要，使用既有权限能力，不因此新建凭据管理平台。配置保存和“测试连接 / 试生成”是两个动作，后者列出目标与是否产生费用。

### 5.2 模型

基础表单：显示名、模型 ID、上下文窗口 token、最大输出 token。高级区域按需展开：

| 字段 | UI 行为 |
|---|---|
| 输入类型 | 文本基础；图片、视频、PDF 分别显示声明 / 已验证 / 不支持。 |
| 能力 | 结构化输出、工具调用、system 消息、原生搜索各自独立，不靠模型名猜测全部开启。 |
| 推理 | 按当前协议和模型给可用等级 / 参数；未知映射明确待配置，不提供无限脚本 DSL。 |
| 智能配置 | 展示建议来源，修改前可看会覆盖哪些值；手工设置可保留。 |
| 计价 | 输入 / 输出价格、币种与单位可填；未知显示“未配置”，不能显示免费。 |
| 参数校验 | 错误靠近字段，保留输入；说明上下文需要给输出和工具结果预留空间。 |

样例见 [model_profiles.json](../source/v2-r3/fixtures/model_profiles.json)。它使用关闭的合成配置，不是可直接联机调用的真实模型清单。

### 5.3 用途绑定

以清晰表格显示“用途 → 模型 → 生效配置版本 / 状态”：

前台聊天、记忆提取与摘要、后台问候、剧情导演、NPC，以及独立 embedding。每个角色可有前台与后台绑定；NPC 可共用默认配置并按实际需求覆盖，不必新建复杂继承系统。

G2 下，前台换模型只改相应用途。编辑被多个用途共用的 profile 时，保存前展示影响列表并允许另存为。待配置 / 禁用时给直接跳转设置的入口，不静默回退到别人的 Key 或另一模型。

## 6. 关键交互与准确文案

### 保存冲突

示例文案：“这段对话已在另一处更新。你的输入已保留，请加载最新内容后继续。”提供“查看最新”和“保留草稿”操作。不能给一个绕过版本检查的“强制覆盖”按钮；用户重新应用修改也基于最新 revision。复杂卡自动保存失败应有可见状态，不只写浏览器日志。

### 记忆与删除

“删除这条长期记忆”配说明：“聊天原文仍保留，可能继续用于当前对话。”删除聊天与派生记忆需要显示范围。备份中的清理状态独立。未实现最终请求排除时，不提供“彻底忘记 / 永远不再看到”的按钮。

### 主动消息与通知

inbox 有待写入 ST、已写入、当前链接已移除等状态；邮箱 / 飞书有独立投递状态。渠道返回成功显示“渠道已接受”，没有设备回执就不显示“手机已收到”。应用已读由真实用户行为更新。

waiting-host 显示“需要打开此会话继续”，不伪装成完整角色回复。默认通知预览简短，目的邮箱 / 群可见；两个渠道可分别启用，不强制每次双发。实际通知测试必须使用用户配置的目标。

### 剧情回档

展示要回到的阶段、对后续行动与分支记忆的影响。回档不会自动删除所有备份；公开线索和角色私密知情范围重新计算。不能为了页面顺滑自动合并不同设备的剧情状态。

## 7. ST 宿主实现映射（W02 静态盘点）

本节记录当前锁定宿主中**实际已存在**的集成面，作为页面实现落点（§8.4）的依据。证据分两档标注：【静态】= 锁定版本源码定位（未运行验证）；【W00 实测】= W00 冒烟（执行计划 §6.4）在真实浏览器中的证据。V2 自有页面均未实现，本节不构成任何页面或 UI01–UI03 用例已通过的声明。

上游版本：ST 1.19.0（`7e8663cd`）、Tavern Helper 4.11.3（`0af42106`）、EJS 1.17.9（`d6f520d1`）、MVU（`d03b7dc8`），版本锁见 [upstream.lock.json](../../integrations/sillytavern/upstream.lock.json)。以下文件路径相对各自上游根目录（SillyTavern = `integrations/sillytavern/upstream/SillyTavern`，Helper = `integrations/sillytavern/upstream/JS-Slash-Runner`）。

### 7.1 主题 CSS 变量【静态】

- ST 主题不是替换 CSS 文件，而是一组运行时直写在 `<html>` 上的 `--SmartTheme*` CSS 变量。默认值定义于 `public/style.css:71-89`（`--SmartThemeBodyColor` 71、`--SmartThemeEmColor` 72、`--SmartThemeQuoteColor` 74、`--SmartThemeBlurTintColor` 76、`--SmartThemeChatTintColor` 77、`--SmartThemeUserMesBlurTintColor` 78 / `--SmartThemeBotMesBlurTintColor` 79、`--SmartThemeBorderColor` 82 等；`:root` 块自 `public/style.css:20` 起）。
- 运行时应用：`public/scripts/power-user.js:1104-1145` `applyThemeColor` 逐项 `document.documentElement.style.setProperty(...)`；`applyTheme(name)`（`power-user.js:1227` 起）按主题 JSON 键全量应用。
- 主题文件为每用户 `data/<handle>/themes/<name>.json`（服务端 `src/endpoints/themes.js:11-19`），字段即 power_user 键，另有 `custom_css` 经 `power-user.js:1147-1158` 注入 `<style id="custom-style">`，可整体覆盖。
- 扩展页面可直接依赖 `var(--SmartTheme*)` 取色；第三方实践：Tavern Helper `src/Panel.vue:30-36` 直接引用 `--SmartThemeQuoteColor`。
- 对 V2 的含义：自有页面可读取主题变量跟随原生主题，或按 §3 使用自有 token；两条路都已有静态依据，实际选择在 W03/W04 实现时定，不破坏原生主题选项。

### 7.2 原生聊天 DOM【静态；渲染链经 W00 实测】

- 滚动容器 / 消息列表 `#chat`：`public/index.html:8082`；滚动样式 `public/style.css:861-878`；JS 引用 `public/script.js:449`。
- 消息模板 `#message_template .mes`：`public/index.html:7391-7471`，含 `.mesAvatarWrapper`、`.name_text`、`.mes_buttons`、正文容器 `.mes_text`（7461）、`.swipe_left` / `.swipe_right`；模板取出 `public/script.js:448`。
- 渲染链：`messageFormatting()`（`public/script.js:1800`，Markdown → DOMPurify → HTML）→ `updateMessageElement()`（2618；2696 写 `.mes_text`）→ `addOneMessage()`（2551；2595-2596 维护 `.last_mes`）。
- 【W00 实测】本地固定 provider 的流式回复在该 DOM 真实渲染（`dom_mes=3`，截图确认三条消息可见），聊天 jsonl 原生落盘，刷新读回一致。

### 7.3 扩展导航与 popup 入口【静态】

- 扩展以 `public/scripts/extensions/` 下的 `manifest.json` + 主页面 ES module 加载（`public/scripts/extensions.js:533-553` fetch manifest、`813-841` 注入 module script）。在本次锁定栈已定位的机制中，UI extension 形态是「主页面 module + 自挂 DOM」（与 Helper 同构）；未在此检索范围内发现 iframe 形态 UI extension 的自动加载机制，不对本次未检索的其他扩展形态作排他结论。
- 公开挂载点（均实际存在）：
  - 魔法棒菜单 `#extensionsMenu`：模板 `public/scripts/templates/wandMenu.html`，注入与定位 `public/scripts/extensions.js:688-700`，按钮挂 `#leftSendForm`（`public/index.html:8103`）。
  - 扩展设置面板 `#extensions_settings`：`public/index.html:5773`；Helper 的挂载实践 `JS-Slash-Runner/src/index.ts:41`。
  - Popup API：`public/scripts/popup.js:149` `class Popup`（原生 `<dialog>`）、`popup.js:914` `callGenericPopup`、`popup.js:9` `POPUP_TYPE`；经 `getContext()` 暴露（`public/scripts/st-context.js:195、224-226`）。
- 主题切换、扩展导航 UI、Popup 的浏览器实际行为 W00 未测。

### 7.4 iframe 受保护边界【静态；脚本 iframe 经 W00 实测】

- ST 核心不在 `.mes_text` 放行 iframe：`public/script.js:1957-1967` 的 DOMPurify 配置未放行 iframe（vendored DOMPurify 默认禁用）；本次锁定栈中已定位的消息内 iframe 实现方是 Tavern Helper：
  - 渲染 iframe `TH-message--*`：`JS-Slash-Runner/src/panel/render/Iframe.vue:2-11`（无 sandbox；srcdoc 或同源 blob URL）；挂载于消息内 `div.TH-render`（`src/store/iframe_runtimes/message.ts:8-34` + `src/panel/Render.vue:96-99` Teleport）。
  - 脚本 iframe `TH-script--*`（隐藏运行）：`src/panel/script/Iframe.vue:2`，Teleport 到 body（`src/panel/Script.vue:21-29`）。
  - 高度由 iframe 内脚本自适应写 `frameElement.style.height`（`src/iframe/adjust_iframe_height.js`）；视口高度经 `--TH-viewport-height` 代理（`src/iframe/adjust_viewport.js`，内容中的 `Nvh` 被重写为该变量）。
- 对 V2 的含义：§2「只控制外层尺寸、滚动」在机制上可行（iframe 同源、无 sandbox，外层可约束容器），但固定高度与 Helper 高度自适应逻辑相互对抗，未经实测，不作为受支持用法；不向 iframe 内注入样式。
- 【W00 实测】脚本 iframe 真实执行：主页面出现 `window.Mvu`，`[InitVar]` 把 `trust` 初始化为严格值 10。
- 「受保护」指产品不注入、不破坏卡作者的样式与布局（§2），不是安全隔离：iframe 无 sandbox 属性且与主页面同源；本节不构成安全评估结论。

### 7.5 原生模型选择投影【静态；custom source 读写经 W00 实测】

- 前台模型 UI 在 API 连接面板：source 下拉 `#chat_completion_source`（`public/index.html:2922`）；custom source 的 Base URL `#custom_api_url_text`（3812）、模型 `#custom_model_id` / `#model_custom_select`（3833-3838）；字段映射 `public/scripts/openai.js:349-350`（`settingsToUpdate`）。
- 读写链：`loadOpenAISettings`（`openai.js:4320-4367`）读入并回填控件；输入回写 `openai.js:7082-7091`（`oai_settings.custom_url` / `custom_model` + `saveSettingsDebounced`）；持久化 `public/script.js:8051-8115`（payload 顶层 `oai_settings`，8090）→ `POST /api/settings/save` → 用户 settings.json 原子写（`src/endpoints/settings.js:204-209`）。
- `getContext().chatCompletionSettings` 即 `oai_settings` 活引用（`public/scripts/st-context.js:227`；定义 `openai.js:520`；ST 1.19.0 不挂 `window.oai_settings`）。
- 【W00 实测】经该活引用把 custom source 连到本地固定 provider（127.0.0.1:8743），`custom_url` / `model` 持久化到 settings.json，页面刷新读回一致；出站请求含角色描述、世界书与用户消息。
- Go 模型目录 → ST 前台投影（执行计划调整 5：Go 为唯一权威，ST 前台是受版本同步的投影）：本次已定位的原生入口为 `chatCompletionSettings` 活引用与 `saveSettingsDebounced`，经原生设置保存路径（`/api/settings/save` → 用户 settings.json）持久化；Go 目录的版本化投影仍待 W03 实现和验证。

### 7.6 未验证边界（不宣称通过）

- 主题系统、扩展导航 UI、Popup、模型选择器 UI、connection profile 的浏览器实际行为均未实测（W00 未覆盖）。
- 移动端仅有静态证据：viewport meta（`public/index.html:8`）、`isMobile()` UA 分支（`public/scripts/RossAscends-mods.js:143-147`）、`public/css/mobile-styles.css`（≤1000px 媒体查询）；未在任何手机实测。
- UI-P01–P07 的 V2 增量页面均未实现；本节任何条目不作为 UI01–UI03 用例或手机验收的通过证据。

## 8. Stitch 交付流程与页面映射

### 8.1 来源与使用

已通过用户的 Stitch 连接生成设计稿；项目为
[Virtual Companion V2 · SillyTavern 原生宿主 · 桌面与手机](https://stitch.withgoogle.com/projects/2796557797507753149)，
project ID 为 `2796557797507753149`，各页复用设计系统 `assets/6185810107007504198`。
§8.4 指定当前采用的 screen，项目中其他迭代版本不作为实施基线。
导出的 PNG 原样保存在 `docs/product/v2-design-assets/`，供后续页面实现直接查看。
生成的 HTML 只用于布局参考，不能直接替代 ST 的 DOM、生命周期或真实 API；未引入其 CDN、框架或示例业务逻辑。

参考 Google 官方组织的 [stitch-skills](https://github.com/google-labs-code/stitch-skills/tree/0337446dadde6f8c94210444e2aa9d546126480f)，尤其 [manage-design-system](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-design/skills/manage-design-system/SKILL.md)、[design-md](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-utilities/skills/design-md/SKILL.md) 和 [generate-design](https://github.com/google-labs-code/stitch-skills/blob/0337446dadde6f8c94210444e2aa9d546126480f/plugins/stitch-design/skills/generate-design/SKILL.md)。工具实现可能变化，执行时读取所用固定版本的实际说明。

1. 执行会话检查当前环境的 Stitch MCP / CLI / 技能可用性，使用用户自己的可访问项目。现有材料足够做设计说明，无须先问完整品牌问卷。
2. 将本文件作为设计语义来源；新项目可直接从描述形成设计系统，不要求先生成一堆无规范页面再倒推。
3. 先做 UI-P01 聊天、UI-P05 模型、UI-P06 剧情，形成桌面 / 手机整体一致性；再补其他页面及关键状态。复用同一设计系统。
4. 记录真实 Stitch project / screen 标识、生成的图片或页面资源位置，以及映射到本页面 ID 的关系，回填 §8.4 映射表；不新建另一套进度平台。
5. 检查功能、可读性、手机布局与 ST 宿主边界（§7），必要迭代后再实现相应页面。真正的产品取舍变化才找用户讨论，普通视觉细节由 Agent 根据此规范推进。
6. 以 ST 组件 / 扩展方式实现（落点见 §8.4 与 §7.3）。Stitch 生成代码可作布局参考，依赖和事件处理须按实际工程接入；不能直接把孤立页面当成已集成产品。
7. 用真实浏览器检查实现与稿件的主要布局、状态和操作，按 UI01–UI03 及复杂卡案例验证。
8. 缺工具 / 账号时标明准确阻塞，完成可做的设计输入和独立工程；不得冒称已经出图或悄悄换工具完成“Stitch 验收”。

### 8.2 可直接给 Stitch 的项目提示词

~~~text
请基于给定 DESIGN.md，为 Virtual Companion 设计简体中文 Web 应用。
这是原生 SillyTavern 主宿主上的多角色长期陪伴与三 NPC 剧情产品。
遵循同一套语义色、字体、间距与组件状态，优先长对话阅读和手机使用。
输出真实软件页面，不使用手机/电脑样机，不用营销落地页替代应用。

桌面参考 1440×900，手机参考 390×844，并能适应 360 px 宽。
先设计 UI-P01 聊天、UI-P05 模型设置、UI-P06 剧情，再扩展角色、
记忆、主动通知、数据与账户。角色卡 HTML/iframe 是受保护内容区，
必须有足够阅读宽度与独立滚动；不要重新发明卡片运行时。

模型支持 Anthropic Messages、Chat Completions、Responses，
自定义 URL、Key、模型 ID、上下文、最大输出和高级能力。
用途独立绑定，费用未知与配置未填写要清楚显示。

请设计普通、空、加载、失败、保存冲突和手机键盘打开的关键状态。
邮箱与飞书是首版通知渠道，区分渠道接受与应用已读。
剧情只显示玩家有权知道的线索。使用合成人名与示例内容，
不要在设计稿放真实凭据或私人聊天。
~~~

### 8.3 逐页追加要求

| 页面 | 追加说明 |
|---|---|
| UI-P01 | 显示角色“澄夏”、多实例列表、两条合成对话、可折叠记忆、流式停止和一次保存冲突；手机键盘打开时输入区可操作。 |
| UI-P02 / P03 | 区分卡模板与角色实例；记忆展示来源与发生日期，更正 / 删除解释清楚，不用复杂管理后台风格。 |
| UI-P04 | 两个独立渠道卡，邮箱字段与飞书 Webhook 字段，默认正文预览关闭；展示一条成功接受、一条结果未知。 |
| UI-P05 | 参照随包两图的字段，显示供应商协议下拉、长模型表单和用途绑定；无密钥、无预算时保留设置入口。 |
| UI-P06 | “雨夜旅馆：失踪的怀表”案件、三名 NPC、公共时间线、用户可见线索和可用行动；不显示主持人谜底。 |
| UI-P07 | 导出部分完成、删除处理中的准确状态；明确 V2 备份保留状态独立（策略 W16 定义）。W01 已清除已定位的本机旧业务副本（ADR-0009 E3：不需导出、不进入 V2 上下文，不宣称全机数据副本已证不存在），不提供旧数据导出 / 浏览入口，不制作旧聊天浏览器。 |

### 8.4 七页面 Stitch 来源映射表

以下为选定的真实设计来源；PNG 链接可离线查看，screen ID 可在上述项目中定位，
或通过 Stitch `get_screen` 读取 `projects/2796557797507753149/screens/<screen-id>` 获取原始截图与 HTML 资源。

**尺寸口径**：表内尺寸是导出 PNG 像素，不是浏览器 viewport。Stitch 可能导出双倍像素、
含外围画布或完整长页的图片，部分手机稿的 API 设备字段也返回 DESKTOP；均不能据此认定手机适配已通过。
实施参考尺寸仍为 §3 的 1440×900、390×844 与 360px 窄宽度。手机长表单为整页滚动；
键盘为设计示意，真实软键盘、焦点、横向溢出及 ST 集成行为在对应实现项验证。

| 页面 | 后续工作项 | 关键状态（全列见 §4） | 实现落点（尚未实现） | 桌面稿与 screen ID | 手机稿与 screen ID |
|---|---|---|---|---|---|
| UI-P01 聊天 | 设计稿 W02；首轮实现 W04；F2 冲突完整化 W05；inbox 待写入状态 W10 | 空会话、流式中、停止、模型未配置、断线、F2 保存冲突、inbox 待写入 | 原生聊天 DOM（§7.2）承载消息与复杂卡容器；多实例入口、记忆抽屉、当前模型与 inbox 状态经公开扩展入口挂载（§7.3） | [D · 2560×2048](v2-design-assets/UI-P01-D.png)<br>`1e5f36d100af4f0fb08ba1825e03aa92` | [M · 780×1768](v2-design-assets/UI-P01-M.png)<br>`03c72ceddf43434f991838d12dd98ce5` |
| UI-P05 模型设置 | W03（验收含 UI03，有设计稿后） | 空供应商、禁用、缺 Key、未知能力、配置冲突、显式测试中、预算不足 | V2 扩展页面，Go 模型目录为唯一权威；前台投影写 `chatCompletionSettings`（§7.5） | [D · 2560×2048](v2-design-assets/UI-P05-D.png)<br>`5c9e68ec91ac4cc7ac2f24511e2cbf1f` | [M · 780×4514](v2-design-assets/UI-P05-M.png)<br>`a459eeaa5065407481d25e18a079519b` |
| UI-P06 剧情 | W12（界面）；回档状态 W14 | 尚未开局、行动无效、缺配置、生成中、证据发现、结局、回档确认 | V2 扩展页面，剧情世界状态在 Go；玩家知情边界见 §4 | [D · 2560×2048](v2-design-assets/UI-P06-D.png)<br>`00fd3d73739f4e2cb9e3fc9b31b205bd` | [M · 780×1948](v2-design-assets/UI-P06-M.png)<br>`a4991f8bf9ad4302b53e1cd527897998` |
| UI-P02 角色 | W04（角色选择 / 导航）；多实例数据模型 W05；整页收敛 W15 | 首次创建、导入失败、模板与实例区别、编辑未保存 | ST 原生角色卡管理为基底；模板 / 实例区分与实例列表为 V2 扩展 UI | [D · 2560×2048](v2-design-assets/UI-P02-D.png)<br>`bc6ae0f4a3784ed9b24645b73a11357b` | [M · 780×1864](v2-design-assets/UI-P02-M.png)<br>`dea7d39dca1d44698380f7194e54823d` |
| UI-P03 记忆 | W08（页面依赖设计稿） | 无结果、来源待核验、已失效、删除确认；原文仍保留的解释 | V2 扩展页面，接 Go 记忆 API | [D · 2560×2048](v2-design-assets/UI-P03-D.png)<br>`defb870c76744fc5a526af67763f115f` | [M · 780×1768](v2-design-assets/UI-P03-M.png)<br>`521058ea81ff4f8dad86379b72c9cabe` |
| UI-P04 主动陪伴 / 通知 | W09（跟进 / 静默 / G2 后台）＋ W10（inbox / 渠道投递） | 未配置、已关闭、待发送、渠道接受、失败 / 结果未知、过期 | V2 扩展页面，投递状态在 Go；渠道接受 ≠ 手机显示 ≠ 已读 | [D · 2560×2048](v2-design-assets/UI-P04-D.png)<br>`7f993ac6a8984a5e83e953dd5eb7a00b` | [M · 780×3000](v2-design-assets/UI-P04-M.png)<br>`dbc403c69dfa4d9a928d408f94d091a8` |
| UI-P07 数据与账户 | W05（密码 / TOTP）；W06（D02–D05）；W16（备份恢复与 V2 备份策略）；整页收敛 W15 | 导出处理中 / 部分完成、删除未完成、备份保留状态独立（W16）、恢复限制 | V2 扩展页面，导出 / 删除编排复用 Go；旧业务副本已按 W01 定向清除，无旧聊天浏览器 | [D · 2560×3336](v2-design-assets/UI-P07-D.png)<br>`d3eeb7b139d54c0892dbdfd37bed8fed` | [M · 780×3536](v2-design-assets/UI-P07-M.png)<br>`6b646ccccb5249ceb268efdb807910d5` |

图稿与规范共同约束状态：桌面聊天展示生成中，手机聊天展示冲突与保留草稿；手机模型表单展示参数错误、
保存与测试禁用；手机剧情展示回档影响；通知区分会话写入、渠道接受与应用已读；数据页展示导出部分完成、
删除未完成与备份待核验。未单独出图的空态、加载态等按 §4／§6 实现，不把一个静态样例当作完整交互验收。

已对稿件的主要布局和关键状态做目视与导出文案核对，并修正生成器补入的错误存储、保留期限和多设备语义。
图片中的示例数值、头像、人物与案件描述不定义运行默认值或剧情真相；实现数据以契约、固定 fixture 与用户配置为准。
代码不得复制稿件中的模拟计时器、假成功回调或额外导航能力。模板与世界书继续使用原生管理流程，
不由稿件推导新的独立词条覆盖机制。真实配置、来源校验、F2 冲突、任务执行和玩家知情边界仍需生产代码验证。

## 9. 设计完成条件

同一份设计规范能约束不同 Agent 的新增页面；核心桌面 / 手机页面有真实 Stitch 来源；页面状态与产品能力一致；目标 ST 宿主兼容；手机界面无横向溢出，主要输入与冲突处理可完成；截图字段能在实际配置中找到对应含义。

本文件不提供额外审批制度、独立设计进度表或每次修改全量视觉测试。发生相关页面 / 组件变更时验证受影响部分，最终进行关键路径浏览器检查。

W02 已提供规范、ST 静态集成映射、七页面的桌面 / 手机设计来源及后续工作项对应。
本项仅完成 UI01「设计来源」子项。ST 页面与稿件的实际对应、主题兼容、可操作状态、手机键盘和窄屏、
模型字段真实生效分别由 W03–W15 的相关实现与验证证明；UI01 整案、UI02、UI03 不在本项提前标 PASS。
