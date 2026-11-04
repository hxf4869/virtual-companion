# 电脑端前端重建设计（DR2）

日期：2026-11-04 · 分支：`desktop-react-rebuild`（基于 `codex/desktop-independent-frontend@3131d92b`）
Backlog：`docs/planning/2026-10-31-handoff-backlog.md` K 节（DR2-0 … DR2-12）· 计划：`docs/superpowers/plans/2026-11-04-desktop-react-rebuild.md`

## 1. 为什么做

Owner 对 codex 几轮电脑端产出不满意：**界面与交互适配经常要 Owner 亲手调**，问题不集中在某个页面或尺寸，
而是"各种都有"。Owner 的期望：

1. 能用 GitHub 开源组件就用开源，尽量少造轮子。
2. Owner 验收时没有明显错误和问题。

Claude 审计 `codex/desktop-independent-frontend` 后确认根因是结构性的，而不是个别缺陷：

| 证据 | 数值 |
| --- | --- |
| 电脑端由两套 UI 拼装 | 旧原生 JS 约 2.3 万行（`shell.js`、`chat-view.js`、`page.js` 等）+ 约 40 个 `mount*View` 挂入的 React 小树（约 7.5k 行） |
| 两套各自操作 DOM、各自持有状态 | 63 个模块同时被电脑端与手机 `/native/` 共用 |
| CSS | 约 1.28 万行，`!important` 1051 处 |
| 断点 | 十余种（744/760/800/900/1000/1023/1027/1100/1179/1180…）；另有 15 个 JS 文件自读 `innerWidth`/`matchMedia` 决定布局 |

另有已在本地受管环境证实的缺陷：MVU 卡新建空会话打开约 26 秒后失败（开场白不出现）、MVU 切换聊天报
`setLorebookSettings is not defined`；以及代码核实的：后台保存期间改动漏存、自动续写释放锁后停止失效、
切会话异步窗口读旧上下文、卡片 iframe 经 `TavernHelper.*` 绕过过期校验、表情包设置入口丢失、
预设另存后孤儿脏记录、人设编辑无离开保护、`/native/` 宽屏误入桌面布局等（审计报告见本次会话，摘要在第 9 节）。

## 2. 目标、非目标、反目标

**目标**

- G1 电脑端（`/` 与 `/desktop/`）成为**一个** React 应用：单入口、单路由、单状态源、单布局系统。
- G2 一套断点（744 / 1180 / 1600，DESIGN.md §11/§16.3），布局只由壳层决定；组件内部用容器查询。
- G3 通用交互全部用成熟开源组件（第 5 节清单），不自写焦点、键盘、弹层、滚动虚拟化、拖拽状态机。
- G4 视觉保持现状：DESIGN.md（尤其 §9、§16 沉浸玻璃）与 `.review-queue/UX-11/` 已选设计图是唯一视觉真源。
- G5 引擎层（提示词计算、世界书、宏、正则、复杂卡运行）**行为不变**，但删减手写适配：能直接复用锁定上游
  SillyTavern / Tavern Helper / EJS / MVU 模块的就复用。
- G6 修复第 9 节列出的全部已核实缺陷。
- G7 交付前 Claude 自查：受管环境、合成账号，四档宽度 × 浅深色无明显问题；`check.sh` 全量与受影响受管场景整组通过。

**非目标**

- 手机端：uni-app（`mb-mobile`）不在范围。
- 视觉改版：不改颜色、材质、版式、文案（文案改动先改 `2026-10-30-companion-copy.md`）。
- 新产品功能：不新增 backlog 外的能力。
- 后端重写：Go 与 ST 插件只在前端确需时做最小改动（第 7 节）。

**反目标（出现即视为失败，即使"能用"）**

- 电脑端仍有任何旧原生 JS 页面或 `mount*View` 式拼装；同一 DOM 子树两个渲染 owner。
- 新增 CSS 用 `!important` 压旧样式；新增第二套断点或组件读 `innerWidth`。
- 同时引入两套组件库或两套状态管理；引入无真实消费者的依赖。
- 手机 `/native/` 被弄坏；复杂卡 / 提示词等价场景退步；F2/CAS 冲突保护被绕过。
- Owner 验收时出现明显的错位、遮挡、裁切、深色未适配、焦点丢失、键盘不可达。

## 3. 约束

- 仓库规则：`AGENTS.md`（契约先行、`specs/generated/**` 只用工具生成、不删测试/不加 skip/不削弱断言、
  日志与截图无对话正文和凭据、UI 截图进 `.review-queue/<ID>/`）。
- 许可：V2 依赖 PolyForm Noncommercial 的 Tavern Helper，只供 Owner 本人非商业使用；新依赖须在
  `scripts/checks/license-inventory.yaml` 登记并通过 `check_licenses.py`；打包依赖许可由 `build-desktop.mjs` 自托管。
- 语音：TTS/ASR 只经 Go 后端；浏览器不直连。
- 部署：本项目不授权部署；合并 `main` 与生产部署需 Owner 另行决定（且须与 `mb-mobile` 联合发布，
  并补镜像中的 `mobile-dist` 构建步骤，见第 10 节）。
- 存储与清理：受管验收的容器、卷、临时目录按 OP-11 规则在任务结束前回收。

## 4. 目标架构

### 4.1 分层与目录

```
integrations/sillytavern/desktop-ui/          # 电脑端唯一前端工程（React 19 + TS + Vite）
  src/
    app/          入口、路由、Provider、错误边界、全局快捷键
    shell/        窗口布局（侧栏 / 面板栅格 / 断点）、极光背景、浮层宿主
    design/       token（CSS 变量）、分层 CSS、Base UI 皮肤组件（Button/Field/Switch/Menu/Dialog…）
    features/     chat / characters / memory / inbox / story / settings / tavern —— 每个功能一个目录
    data/         TanStack Query 客户端、各业务 API 钩子（包装现有 api.js / client.js 的请求）
    runtime/      与聊天运行模块的唯一桥：Session 状态订阅、发送 / 停止 / 操作命令
  tests/          Vitest 组件与钩子测试（happy-dom）
integrations/sillytavern/extension/vc-model-settings/desktop/standalone/
  engine/         聊天计算（保留，删适配）
  cards/          复杂卡运行（保留，修缺陷，删适配）
  session.js      会话 owner（保留语义，修缺陷；只暴露订阅 + 命令接口）
```

- **电脑端不再加载**：`shell.js`、`chat-view.js`、`chat-compose.js`、`chat-react.js`、`page.js`、`drawers.js`、
  `*-page.js`、`ui/*.js`、`desktop/*.js`（`standalone/` 除外）及其 CSS。它们若仍被 `/native/` 使用则原地保留，
  归手机原生宿主所有；电脑端从中只允许 import **无 DOM 的纯逻辑模块**（第 4.4 节白名单）。
- 构建：`desktop-ui` 从库模式改为应用模式，产出带 hash 的 `index.html` + 资源到同一 `desktop/build/` 目录；
  `server-plugin/virtual-companion/desktop/index.html` 改为由构建产出（或保留模板只引 1 个入口 JS + 1 个 CSS）。
  `host-auth.js` 注入 `vc-account-id`/`vc-session-id` meta 的方式不变。

### 4.2 状态归属（每类状态只有一个 owner）

| 状态 | Owner | 说明 |
| --- | --- | --- |
| 服务端数据（角色、记忆、陪伴、模型、设置文档、会话列表） | TanStack Query | 缓存、失效、重试、迟到响应丢弃；保存走 mutation，冲突 409 交给表单显示"我的草稿 / 最新版本" |
| 当前聊天（消息、流式、草稿、F2 token、变量） | `session.js` | React 经 `useSyncExternalStore` 订阅只读快照；所有写操作经 Session 命令 |
| 复杂卡 iframe 与脚本 | `cards/` | React 只提供叶子挂载位（ref），不读写 iframe 内部 |
| 路由与导航 | 路由库 | 目的地、会话 id、设置分类在 URL 中；离开保护统一在路由层 |
| 界面局部状态（展开、选中、输入框） | 组件本地 | 不进全局 store |
| 跨页面界面偏好（侧栏收起、主题、回复样式） | 一个很小的 store（zustand） | 持久化到现有 localStorage 键，键名不变 |
| 表单 | React Hook Form | 脏状态统一上报给路由离开保护 |

### 4.3 布局系统

- 壳层只用一个 CSS Grid：`[sidebar] [list?] [main] [panel?]`。列宽、显隐按 DESIGN.md §16.3 与 §11 取值，
  由 `data-chrome="compact|regular|wide"`（<1180 / 1180–1599 / ≥1600）在 `<html>` 上声明；`<744` 时
  电脑端仍可用（窄窗），使用 §11 的单列规则（侧栏变底部导航，详情 / 设置用全屏页）。
- 只有壳层读视口（一个 `useChrome()` 钩子，基于 `matchMedia`，供需要切换 DOM 结构的地方使用）；
  组件尺寸适配一律 `@container`。
- 浮层统一走 Base UI Portal 到壳层浮层宿主，层级用 DESIGN.md §4 叠层 token；浮层位置由 Floating UI（Base UI 内置）计算，
  窗口缩放 / 面板收展时自动重定位。
- CSS 组织：`@layer reset, tokens, base, components, features, utilities;`。token 从现有 `vc-ui.css` /
  `desktop/base.css` / `desktop/themes/aurora.css` 迁出并去重，**数值不变**；禁止 `!important`（`prefers-reduced-*`
  覆盖除外，需注释）。

### 4.4 允许电脑端复用的旧模块（纯逻辑白名单）

只允许 import 不触碰 DOM、不读 `window` 尺寸、不注册全局监听的模块，例如：`api.js`、`f2-client.js`、
`model-logic.js`、`account-logic.js`、`instance-queries.js`、`inbox-client.js`、`projection*.js`、`story-action.js`、
`story-projection.js`、`story-context.js`、`companion-prompt.js`、`companion-tools.js`、`memory-injection.js`、
`reply-planner.js`、`reply-pipeline.js`、`prompt-history.js`、`message-source.js`（核对后）、`settings-documents.js`、
`stickers.js` 的纯函数部分、`voice.js` 的播放器核心。最终白名单在 DR2-1 产出并由一个离线测试强制
（电脑端构建图里出现白名单外旧模块即失败）。含 DOM 的部分若有业务逻辑，**先拆出纯函数**（原地，手机端继续用），
再由 React 调用；不复制粘贴。

## 5. 开源组件选型

原则：已有依赖优先；每个新依赖必须替掉一段明确的手写代码，并登记许可。下表为 Claude 的选型（Owner 已授权
Claude 拍板），实施中如发现某库无法满足，换同类成熟库须在计划里记录理由。

| 需求 | 选用 | 许可 | 替掉的手写代码 |
| --- | --- | --- | --- |
| 无样式组件原语（Dialog、AlertDialog、Popover、Menu、Select、Tabs、Switch、Slider、Checkbox、Tooltip、Toast、Collapsible、ScrollArea、NumberField、Field） | **Base UI**（已在用） | MIT | `ui/sheet.js`、`ui/menu.js`、`ui/alert.js`、`ui/toast.js`、`ui/controls.js`、`Overlays.tsx` 自写部分 |
| 组件写法参照 | shadcn/ui 的 Base UI 变体（复制源码进 `design/`，已有先例 Sidebar） | MIT | 自写侧栏、表单行 |
| 服务端状态 | **@tanstack/react-query** v5 | MIT | 各页面控制器里的手写加载 / 重试 / 迟到判断 |
| 路由 | **@tanstack/react-router** 或 **react-router** v7（DR2-1 选一，Claude 倾向 TanStack Router：类型安全、内建离开拦截 `useBlocker`） | MIT | `shell.js` 自写目的地切换、`ui/nav.js` |
| 表单 | **react-hook-form** + **zod** | MIT | 设置页手写脏状态 / 校验 |
| 界面偏好小 store | **zustand** | MIT | `ui/theme.js` 等散落的 localStorage 读写 |
| 表情选择 | **emoji-mart** + `@emoji-mart/react` | MIT | `EmojiPanel.tsx`、`chat-react.js` 搜索 |
| 语音波形与播放进度 | **wavesurfer.js** v8 | BSD-3-Clause | `VoiceBubble.tsx` 手写波形 / RAF |
| 命令面板 / 快速切换（⌘K） | **cmdk** | MIT | `desktop/quick-switch.js`、`QuickSwitch.tsx` |
| 提示条 | Base UI Toast（优先）；不足再用 **sonner** | MIT | `ui/toast.js` |
| Markdown 渲染与净化 | 沿用引擎现有 showdown + DOMPurify（与 ST 等价，不换） | MIT/Apache | — |
| 代码编辑（酒馆设置的长文本 / JSON） | 沿用现有 Monaco 资源，经 **@monaco-editor/react** 加载 | MIT | `desktop/code-editor.js` |
| 图片灯箱 | **yet-another-react-lightbox** | MIT | `lightbox.js`、`Lightbox.tsx` |
| 拖拽排序（提示词顺序） | **@dnd-kit** | MIT | 上下移按钮外的手写拖拽（若无则只用其键盘排序） |
| 图标 | 沿用 Lucide sprite（DESIGN.md §9） | ISC | — |
| 组件测试 | **Vitest** + **@testing-library/react**（happy-dom 已在 devDeps） | MIT | — |

版本取 npm 当前稳定版并在 `package-lock.json` 锁定；新增依赖属于 V2 工作项依赖，按 ADR-0009 已获持久授权。

## 6. 引擎层与复杂卡

- **行为冻结**：NF-02 的"同输入最终请求 / 状态 / 事件逐项等价"测试（`nf-prompts`、`nf-regex`、`nf-chat` 九组、
  离线 `tests/*.test.mjs`）是门槛；任何引擎改动必须让它们保持通过且断言不变。
- **删减方向**：`engine/st/**` 是 ST 源码拷贝。DR2-9 逐文件对比锁定上游（`upstream.lock.json` 指向的提交），能直接
  从受管运行副本按原路径 import 的改为直接 import（经补丁或 import map 去掉 DOM 依赖），不能的保留拷贝并在
  文件头注明差异原因；`helper-*.js`、`cards/*` 同理对照 `JS-Slash-Runner` 源。AGPL 声明与 `ST-LICENSE` 保留。
- **接口**：React 只经 `runtime/` 桥调用 Session；Session 不 import 任何 React 或旧 UI 模块。
- **聊天列表不虚拟化**：复杂卡 iframe、EJS 单一可变闭包要求历史楼层按序渲染且不被卸载，虚拟化会改变引擎行为。
  保留现有"分页（每页 80 条）+ 向上加载 + 阅读位置恢复"语义，把 `chat-scroll.js` 的算法迁成一个 React 钩子
  （纯函数部分原地拆出复用）。楼层节点一经挂载，只在会话切换或该消息被删除时卸载；React `key` 用消息稳定标识
  （不用下标），避免 B12。
- **卡片脚本依赖的宿主 DOM 契约保留**（属于 G5 行为不变）：`#chat`、`#chat > .mes[mesid]`、`.mes_text`、
  `#send_textarea`、`#send_but`、楼层 iframe id `TH-message--<mesid>--<n>`、脚本 iframe id `TH-script--*`、
  `html[data-vc-app]`/`[data-vc-runtime]`。新组件按此契约渲染这些节点；其余类名与结构自由。
- **Helper 接口回退补齐**：摸底确认独立桌面 `TavernHelper` 比上游少 106 个顶层 API（原生 ST 下可用）。按"引擎行为不变"，
  补齐 MVU / EJS / 常见复杂卡实际调用的部分（计划 Task 15 列出清单）；无已知卡片消费者的接口（音频、扩展管理、文件、
  原始导入等）不补，调用时明确抛 `VC_HELPER_UNSUPPORTED:<name>`，记入 backlog。
- **已知与上游一致的问题**（作者注释拼接对象、`CHAT_COMPLETION_PROMPT_READY` 未 await、`swipes_info` 拼写、
  楼层 iframe 无 sandbox）：与上游 Tavern Helper 等价，**本次不改**，在计划中记为已知项。

## 7. 后端改动规则

- 前端重建预计不需要 Go 改动；若需要（例如设置文档缺接口、会话列表缺字段），**契约先行**：先改
  OpenAPI / catalog，再由 **Codex CLI `gpt-6.1-sol`（max 推理）** 实现，一次一个范围明确的任务；Claude 审 diff、
  跑 Go 测试与受影响受管场景后合并。
- ST 插件（`server-plugin/`）与补丁（`patches/`）属于前端集成层，由前端执行者改，Claude 审。

## 8. 执行与分工

| 角色 | 谁 | 职责 |
| --- | --- | --- |
| 调度与决策 | Claude | 拆任务、写任务说明、审 diff、合并、跑验证、视觉最终判断、与 Owner 沟通 |
| 前端执行 | Gemini 4 Argon High（`agy -p … --model gemini-4-argon-high`） | 每次一个计划任务，在独立 worktree 写代码、跑该任务的验证命令、提交 |
| 后端执行 | Codex CLI `gpt-6.1-sol` max | 仅第 7 节触发时 |
| 视觉初审 | Sonnet 子代理（visual-inspector） | 截图初审；Claude 终审（Owner 规定视觉验收不交给 codex/grok 类执行者） |

- 并行规则：同一时刻同一文件 / 模块只有一个写入者；能并行的任务在计划里标明，并行时各用独立 worktree，
  由 Claude 依次合入 `desktop-react-rebuild`。
- 计划写到"Gemini 拿到单个任务即可独立完成"的粒度；Owner 也可以之后直接让 Gemini 按计划逐项执行。

## 9. 必修缺陷清单（来自审计，均已核实）

| # | 现象 | 位置 | 证据 |
| --- | --- | --- | --- |
| B1 | MVU 卡新建空会话打开约 26 秒后失败，开场白不出现 | `standalone/session.js:143`（先 `cards.open` 等 MVU，后放开场白） | 本地受管实测；对照组（预置开场白）正常 |
| B2 | MVU 切换聊天报 `setLorebookSettings is not defined` | 桌面 Helper 接口缺 `setLorebookSettings` | 本地受管实测控制台 |
| B3 | 后台保存返回时无条件清 `metadataDirty`，保存在途期间的修改漏存 | `session.js:63` | 代码 |
| B4 | 自动续写在释放 `job` 后才判断；期间停止无效，`GENERATION_ENDED` 提前触发半截语音 | `session.js:301` | 代码 |
| B5 | `openConversation` 在激活完成前返回，来源跳转 / 侧栏选中 / 已读读到旧会话 | `standalone/app.js:134` | 代码 |
| B6 | iframe 内 `TavernHelper.*` 调用绕过 `assertFrame`，切走会话后旧 iframe 可写当前会话变量；`frame` 为 null 时抛 TypeError | `cards/predefine.js:12`、`cards/index.js:114` | 代码 |
| B7 | 电脑端表情包管理入口丢失（未调用 `installStickers`/设置入口） | `standalone/app.js` | 代码对比 a8b240e2 |
| B8 | 预设另存 / 导入后孤儿脏记录无法重置并阻挡离开；活动预设名未写回设置 | `desktop/tavern-settings.js:469` | 代码 |
| B9 | 人设编辑无脏状态上报与离开保护 | `desktop-ui/.../Characters.tsx` `PersonaEditor` | 代码 |
| B10 | `/native/` 宽度 ≥744 时进入桌面布局，但桌面样式已移除 | `shell.js` `applyChrome` | 代码 |
| B11 | 外观页沿用首次打开时的角色 / 偏好 | `Appearance.tsx` | 代码 |
| B12 | 删除前序消息导致后续消息语音气泡 / 楼层重挂载、状态丢失 | `DesktopChat.tsx` effect 依赖 `index`/`message` | 代码 |
| B13 | 语音气泡重挂载后播放状态与全局播放器脱节 | `VoiceBubble.tsx` | 代码 |
| B14 | 删除世界书后全局 / 角色 / 聊天中的绑定引用未清理 | `tavern-settings.js:491` | 代码 |
| B15 | 删除角色卡未中止在途读取、未刷新会话列表 | `standalone/app.js:253` | 代码 |

B1–B6、B14、B15 属引擎 / 会话层，必须修且补回归测试（B1、B2 补受管场景，见计划 DR2-10）；B7–B13 随 UI 重建自然消失，
但计划中必须有对应验收点证明。

## 10. 验收

### 10.1 测试处置（Owner 2026-11-04 授权）

Owner："用不到就删了，尽可能减少我审图或者测试。"据此：

- **随模块删除**：只测试被删除的电脑端旧 UI 模块（`desktop/*.js` 非 `standalone/`、仅电脑端使用的 `shell`/`chat-view` 分支等）
  的离线单测，与模块同一提交删除，不逐项迁移。仍被 `/native/` 使用的模块，其测试保留且必须继续通过。
- **像素对照退役**：`--compare-reference` 严格像素对照与其冻结基线不再作为电脑端门槛；`dr-shell`、`dr-overlays`、
  `dr-pages`、`dr-appearance`、`dr-models`、`dr-settings` 中只针对旧电脑端 DOM 的场景随旧 UI 删除，其业务断言
  （保存 / 冲突 / 迟到响应 / 敏感操作 / 焦点与键盘）由新的 `dr2-*` 受管场景按新 DOM 覆盖。
- **不得删除或削弱**：引擎、会话、F2/CAS、复杂卡、提示词等价、`/native/` 与手机相关的测试与场景。
- 删除测试的提交信息写明"依 Owner 2026-11-04 授权随旧模块删除"。

### 10.2 门槛

- **自动**：`bash scripts/check.sh` 全量；Vitest 组件测试；受管场景整组：`nf-startup nf-desktop nf-chat nf-operations
  nf-prompts nf-regex nf-cards nf-media f2-browser f2-native`（按新 DOM 契约调整选择器，不改业务断言），以及新增
  `dr2-layout`（四档宽度的几何断言：面板不遮标题栏 / 输入区、无横向滚动、浮层在视口内且跟随锚点、焦点可见）、
  `dr2-settings`（设置与酒馆读写、冲突、离开保护）、`dr2-pages`（角色 / 记忆 / 陪伴 / 剧情主流程）、`dr2-mvu-new`（B1/B2）。
- **视觉（尽量不占用 Owner）**：几何类问题由 `dr2-layout` 自动断言；外观由 Claude 负责——四档宽度
  `390×844`、`1024×768`、`1440×900`、`1920×1080` × 浅 / 深截图，Sonnet 初审、Claude 终审，问题修完再交付。
  截图入 `.review-queue/DR2/`，只在最终交付时给 Owner 一份精选（每个一级页面浅 / 深各一张 + 发现与处理说明），
  中间批次不请 Owner 审图。
- **视觉判定依据**：DESIGN.md 有明确数值处以 DESIGN.md 为准；未规定处以 `codex/desktop-independent-frontend@3131d92b`
  当前实现为准；深色以当前实现为准（DESIGN.md §16 深色仍"待核对"）。第三方组件按 token 重新上皮肤，允许与旧手写
  组件有差异，但须符合 DESIGN.md §9 组件规格。
- 明显问题定义：错位、遮挡（尤其面板盖住标题栏 / 输入区）、裁切、横向滚动、文字对比不足、深色漏适配、焦点不可见、
  键盘不可达、浮层不跟随锚点。
- **旧代码收尾**：电脑端构建图中无白名单外旧模块（离线测试强制）；`desktop/*.js`（`standalone/` 除外）与仅电脑端使用的
  CSS 删除；`/native/` 相关受管场景通过。
- **不在本项目内**：合并 `main`、部署、`mobile-dist` 镜像构建步骤——作为后续 Owner 决策项列入 backlog K 节末尾。

## 11. 留给执行者的决定

- 路由库在 TanStack Router 与 React Router v7 间二选一（DR2-1，写明理由）。
- 每个页面内部组件拆分方式、文件命名。
- 容器查询的具体断点（在 DESIGN.md 数值约束内）。
- Vitest 用例粒度（每个 feature 至少覆盖：渲染、主要交互、冲突 / 错误状态）。

## 12. Claude 替 Owner 做的决定（Owner 可推翻）

- 新分支与独立 worktree，不改 codex 分支。
- 组件以 Base UI 为唯一原语库，第 5 节其余库为补充。
- 引擎层"不改行为、只删适配"。
- 窄窗（<744）电脑端也要可用，按 DESIGN.md §11 单列规则。
- 已知与上游一致的四个问题本次不改。
- 聊天列表不虚拟化（不引入 react-virtuoso），保留分页 + 阅读位置恢复；卡片依赖的宿主 DOM 契约保留（第 6 节）。
- 视觉判定：DESIGN.md 数值优先，其余与深色以当前实现为准；验收以人工审图 + 几何断言代替像素对照（第 10.2 节）。
