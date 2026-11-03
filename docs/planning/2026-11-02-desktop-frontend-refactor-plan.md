# 电脑端前端替换与酒馆能力适配重构实施计划

> **2026-11-03 当前执行范围：第 11 节 NF-00–NF-11。** 第 1–10 节保留 DR 组件化的基线与历史回执；其中“ST 管理桌面消息树、原生输入和启动”的约束已由本轮 Owner 决定替代，不再约束 NF 实施。NF 是同一 Virtual Companion 电脑端的替换，不是第二套产品。本文件是唯一实施计划，进度仍只在既有 TODO 按 ID 回填。

> 执行方式：主 Agent 在隔离分支串行实施，每批有独立验收；遵循 `superpowers:executing-plans` 的逐项实施与最终评审方法。项目只维护本计划和既有 `TODO.md`，不建立第二套过程文件。

**目标：** 将桌面自有前端迁移为 React 组件，复用成熟开源交互组件，保持既有正常页面的视觉与业务行为，解决已确认的适配问题。

**架构：** React 只管理自有界面的独立容器，ST 继续管理消息树、原生输入、角色卡脚本、酒馆配置及唯一生成链。现有 API、校验和主题设置继续复用；按页面替换旧渲染器，完成一页即移除其旧实现和监听，不长期维护两套自有 UI。

**技术栈：** React、React DOM、TypeScript、Vite；通用交互优先 Base UI，按需采用 shadcn/ui 的开源组件代码。现有 CSS、Lucide 与 `--vc-*` token 是视觉真源，不引入另一套默认主题。

**依据：** Owner 本次明确选择 React，并要求优先复用 GitHub 上成熟开源实现；[DESIGN.md](../../DESIGN.md) §16、[ADR-0011](../decisions/0011-mobile-uniapp-ui-st-engine.md)、[既有 UX-11 计划](2026-11-01-ux11-desktop-immersive-plan.md)。本计划第 1–3 节是此次已确认的实施约束。

## 1. 范围与授权

- 以 `ux-11-desktop-immersive` 当前代码和已确认视觉为起点，工作分支 `codex/desktop-frontend-refactor`；不合并 `mb-mobile` 的业务改动。
- DR-1 已完成本地候选；Owner 追加授权提前实施 **DR-4A：公共壳层**，范围见第 9 节。其余批次仍按各自工作项推进，不预创建后续页面、存储、接口或通用框架。
- 后台专注桌面窗口与分屏；移动端日常布局独立。共享 ST 引擎、原生消息、复杂卡和手机 ST 视图须保持兼容。
- 用户已授权本次 React 路线必需的本地依赖和实现。依赖固定版本、核对 Node 22.13+ 兼容性与许可，登记现有许可清单。
- 本轮不改变服务端协议、数据库、生成链、文案、主题内容；不调用真实模型，不发送真实通知，不部署、不自动合并。
- 按仓库规则一次只推进一个 ID。只在本计划所列真实消费者上引入组件；不新增 feature flag、通用迁移框架或长期双渲染分支。

## 2. 视觉与行为约束

### 2.1 视觉真源与优先级

1. 当前桌面代码在合成数据下的正常页面与交互状态。
2. `DESIGN.md` §16、`desktop/themes/aurora.css`、`vc-ui.css` 与各桌面页面 CSS。
3. `.review-queue/UX-35/` 保留的逐像素迁移参照，以及现有 `docs/product/v2-redesign/ux11/` 合成样板。旧截图作为参照，不冒充当前候选的验收结果。

正常状态维持背景、玻璃材质、颜色、字体、字号、间距、圆角、图标、列宽、内容顺序及交互含义。不套用组件库的默认页面风格，不重绘现有素材。

### 2.2 需要 Owner 确认的事项

- **任何有意的可见视觉或布局调整，先生成对应状态的设计图，由 Owner 确认后按图还原。** 包括新增折叠布局、改变弹层表现、信息层级或控件尺寸。
- 内部拆分、类型化、替换组件交互且可见结果不变，不新增确认步骤。
- 如果现有视觉与所选组件的公开能力冲突，先说明具体冲突和候选图，不通过改截图基线、放宽容差或屏蔽内容解决。
- 当前没有待决定的视觉改版。第一批沿用现有外观页，目标为相同浏览器与视口下正常状态截图零差异。

### 2.3 状态与兼容

- 保留各设置项的存储键、值、默认值、生效事件、角色覆盖和全局偏好语义。
- 保留草稿、保存冲突、未保存离开确认、焦点返回、输入与滚动位置；业务校验复用现有模块。
- 框架与 ST 不共同修改同一子树。不得把 `.mes_text`、卡片 iframe 或原生输入节点交给 React 重建。
- 缩窗与放大必须检查内部裁切、操作可达、菜单锚点和弹层滚动，不能只检查文档横向溢出。

## 3. 开源复用规则

- 实现通用控件前，先查 Base UI/shadcn/ui 官方组件与维护中的 GitHub 项目；记录采用的实际组件和不能直接采用的具体原因。
- Dialog、AlertDialog、DropdownMenu、ContextMenu、Popover、Select、RadioGroup、Switch、Tabs 等不重新编写键盘、焦点和状态机。
- 原生按钮、输入框、HTML select 能满足需求时直接使用；不为简单控件叠加无实际用途的包装。
- 自有组件只负责当前视觉皮肤与真实业务组合；角色、记忆、剧情与宿主适配等产品特有逻辑继续由本项目实现。
- 不批量拷贝整套组件，不安装无消费者的组件包；引入开源代码保留许可，浏览器资源自托管，不增加第三方 CDN 请求。

## 4. 目录与职责

| 路径 | 职责 |
| --- | --- |
| `integrations/sillytavern/desktop-ui/` | React/TS 源码、类型配置、Vite 配置和开发约定 |
| `desktop-ui/src/components/` | 有实际页面消费者的开源组件皮肤 |
| `desktop-ui/src/features/<feature>/` | 当前迁移页面的组件和类型；不持有另一份 ST 业务状态 |
| `extension/vc-model-settings/desktop/` | 既有宿主衔接、主题与样式；已迁移页面的挂载/卸载入口 |
| `extension/vc-model-settings/desktop/build/` | 同源 ES 模块构建产物与第三方许可，忽略且可重建 |
| `scripts/build-desktop.mjs` | 既有集成工程的构建入口；一次覆盖输出，不持续累积版本 |
| `scripts/assemble-managed.mjs` | 受管装配前构建，再沿现有部署与一致性检查落位 |

不提前引入全局状态库或新路由。真实跨页面状态和导航消费者出现后，按已确认数据流选择现成方案。

## 5. Review Focus

1. 切换设置分类或销毁容器后，旧组件是否仍处理事件、写偏好或残留监听（DR-1 生命周期验收）。
2. 浅深色、不同分段选中值及开关状态下，默认组件 DOM 是否改变现有皮肤（DR-1 对照截图）。
3. 模型和语音请求晚到、401/409、保存中离开时，草稿是否保留且写入当前身份（DR-2/DR-3）。
4. 窗口连续缩放、放大和长内容时，内部面板或弹层是否被裁切而文档宽度检查仍通过（DR-4/DR-7）。
5. React/宿主重复挂载或事件通知时，是否意外创建第二条生成链或重建原生消息/卡片节点（DR-6/DR-8）。

## 6. 分批实施

### DR-1：React 工程接入与设置外观页（本地候选已完成）

**文件：** 新建 `desktop-ui/src/index.tsx`、`components/Switch.tsx`、`components/Segment.tsx`、`features/appearance/Appearance.tsx` 与类型；新建构建配置、构建入口、受管合成场景；新增 `desktop/appearance.js` 偏好边界；修改 `desktop/settings-shell.js`、`desktop/settings.css` 的局部功能样式、集成 `package.json`/lock、许可清单、装配入口、`Dockerfile.st`、既有标准检查/CI 入口和 `.gitignore`。构建、装配和 CI 的改动均服务于该页实际运行，不搭建独立部署体系。

**接口：** `mountAppearanceView(container: HTMLElement, props: AppearanceProps): () => void`；外部传入初始偏好与现有写入动作，返回实际消费者使用的卸载函数。开关采用 Base UI Switch，分段采用 Base UI RadioGroup；沿用 `.vc-switch`、`.vc-segment` 与内部滑块结构。

- [x] 先保存当前外观页正常状态的合成参照，覆盖 1440/1024/768 明暗；记录 390 的原有样板作为 ST 手机兼容对照。
- [x] 先加入失败的组件边界验收：分段/开关必须写入原偏好，键盘可操作，离开分类后旧组件不再处理动作；观察预期失败。
- [x] 增加锁定依赖与 React 构建，不引入全局 CSS reset。产物自托管，保留第三方许可且只留一份构建目录。
- [x] 迁移外观页，保留所有标签、顺序和默认值；卸载函数接入分类切换和设置壳销毁。
- [x] 打通受管装配和镜像构建路径，避免出现只在本机已构建后才能加载的静态 import。
- [x] 运行类型检查、构建、直接相关单测与外观交互场景；用原样板做稳定的逐像素前后对照，差异必须定位并还原。
- [x] 运行项目所需检查并更新 `TODO.md`。有界独立复核本批代码；不把 DR-1 完成写成整个后台已重构完成。

### DR-2：模型设置页组件化（本地候选已完成）

**文件：** `page.js`、`model-logic.js`、`desktop/settings-shell.js`；新增 `desktop-ui/src/features/models/`，复用已建立的基础控件。

**接口：** 继续消费 `providerDraftFromApi`、`buildProviderPut`、`validateProviderForm`、现有 API 和离开守卫，不新增另一套配置模型。

- [x] 基线覆盖供应商列表、供应商编辑、模型编辑、用途绑定、载入/失败/空状态和未保存确认。
- [x] 先补保存、冲突保留草稿与异步返回的回归，再迁移页面结构与表单控件。
- [x] 保留字段、协议、模型选择、保存含义及焦点行为；移除被替代的 DOM 渲染代码。
- [x] 复用 `model-page` 单测与受管模型场景，截图按相同状态对照；真实模型调用不作为结构迁移的必要步骤。

### DR-3：语音、通知、账户与数据设置（本地候选已完成）

**文件：** `voice-settings.js`、`data-rights.js`、`desktop/settings-shell.js`；对应 `desktop-ui/src/features/settings/` 子功能。

- [x] 按页面迁移，保留引擎可用性、保存等待、401/409 和密码/身份验证流程。
- [x] 保存中禁止重复提交，离开守卫继续生效；账户敏感值不进入日志或截图。
- [x] 每页复用已有 API 和校验，运行直接相关受管场景与视觉对照，不更改语音推理配置。

### DR-4：桌面外壳与弹层

**文件：** `shell.js`、`desktop/settings-shell.js`、`ui/menu.js`、`ui/sheet.js`、`ui/alert.js` 及其实际消费者。

- [x] 将自有导航、标题与内容容器迁入 React；ST 宿主区域保持独立边界。
- [x] 用现成菜单/弹窗组件替换自有键盘与焦点逻辑；删除被替代的定位与监听实现。
- [x] 针对已复现的 1440→768 菜单越界先写失败回归，再修复持续锚定。
- [x] 宽屏维持当前布局；任何新的窄窗折叠/浮层布局先出图确认再实施。
- [x] 验证分类切换、焦点归还、嵌套弹层、长内容和连续缩窗。

### DR-5：角色、记忆与陪伴页面

**文件：** `instance-page.js`、`memory-page.js`、`inbox-page.js`、`diary-page.js`、`favorites-page.js` 与各桌面样式。

- [x] 依次迁移角色列表/详情、记忆列表/详情、陪伴消息/设置、日记和收藏，不增加业务能力。
- [x] 列表与详情消费原服务数据；保留角色作用域、纠正/删除语义、筛选与空状态。
- [x] 先补直接受影响的交互回归，随后每页做视觉与窄窗操作可达检查。

### DR-6：聊天自有界面与宿主边界

**文件：** `chat-view.js`、`chat-compose.js`、`chat-react.js`、`desktop/chat-scroll.js`、`desktop/chat-search.js`、`message-source.js` 及宿主接线。

- [x] 迁移自有会话列表、工具栏、来源检视和搜索；保持原生消息树、输入节点与脚本卡区域。
- [x] 状态通过实际 ST 事件进入唯一适配入口；命令由用户动作触发，不在组件挂载时发起生成。
- [x] 保留草稿、流式显示、停止/继续、候选、编辑、历史加载和滚动锚点。
- [x] 覆盖切会话与晚到事件，验证无重复生成、无串草稿、无卡片节点重建。

### DR-7：剧情与富内容边界

**文件：** `story-page.js`、`story-projection.js`、`lightbox.js`、`stickers.js`、`voice-chat.js` 及实际桌面表现层。

- [x] 迁移自有列表与操作区域，保持 ST 舞台、Helper/EJS/MVU 内容的渲染权和原流程。
- [x] 使用开源通用弹层与选择控件组合既有产品表现，不复制酒馆渲染引擎。
- [x] 核验长内容、图片、嵌套 iframe、语音和返回路径，视觉变化仍按出图确认约定处理。

### DR-8：整体验收与旧代码收尾

- [x] 按已迁移页面清除无消费者的旧渲染、监听和样式；测试不删除、不跳过、不削弱断言。
- [x] 沿用既有样板场景和受管入口，核验正常/空/载入/失败/编辑等实际状态；不建立重复验收编排。
- [x] 完成桌面 1440/1280/1024/768、断点附近与浏览器放大检查；移动端只验证共享宿主兼容路径。
- [x] 在最终稳定候选上完成仓库必要检查、直接受影响的受管场景和视觉复核；报告未验证项。
- [x] 用户明确授权发布前，交付本地候选与结果，不自动部署或合并。

## 7. 验证、产物与停止条件

组件选型修正：首轮真实浏览器回归复现 Radix RadioGroup 快速方向键只移动焦点、不提交值，与上游 [#4094](https://github.com/radix-ui/primitives/issues/4094) 一致。改用 shadcn/ui 同样支持的 Base UI 分支，保留原回归断言；不自行修补第三方状态机，不同时保留两套基础组件依赖。

- 单测使用现有 Node test runner；真实组件交互使用现有 Playwright 驱动浏览器，不用自造 mini DOM 验证 Base UI。
- 外观基线由固定 Git 旧渲染器产生，与新组件在同一页面原子对照，使用同一浏览器、数据、字体、视口和稳定动画状态；不修改图片、不扩大遮罩、不把候选覆盖为基线。
- `.review-queue/DR-1/` 仅保留本批一套 before/after 代表截图、失败对照及 `NOTES.md`；重复运行覆盖本批产物，临时浏览器与 loopback 样板服务结束即关闭。
- 构建只覆盖 `desktop/build/`，不产生时间戳版本目录；不改缓存协议或增加没有消费者的校验文件。
- 初始 26 项桌面相关基线单测已通过。该结果不能替代修改后的验证，也不能代表受管环境或视觉通过。
- 必要检查失败时只修本批直接原因，再重跑受影响部分；无关既有失败如实报告。
- 出现未确认的视觉调整、宿主/协议边界必须改变、真实外部调用或部署需求时，只停相应部分并说明证据。
- 批次仅在其自身验收实际通过后标记完成；Owner 2026-11-02 已授权按第 10 节持续执行剩余批次，不以批次切换为由等待“继续”。

## 8. DR-1 本地候选结果（2026-11-02）

React/TS/Vite 与 Base UI 外观页已接入，既有存储/事件与皮肤保留，旧外观渲染器已移除。构建与类型检查、受管 `dr-appearance` 合成样板场景、独立源码复核通过。桌面 12 组合与手机既有样板 2 组合分组逐 PNG 字节对照为零差异；1px 位移反例被检出。

标准检查首轮 43 秒：基础约束、许可、构建及 Go 通过；ST 1013 PASS / 10 FAIL / 2 SKIP。同步新场景清单并复用本机既有锁定上游源码后，仅重跑受影响 8 个测试文件，53 PASS / 0 FAIL / 0 SKIP；不重复未变更的已通过检查。

独立复核无 Critical / Important / Minor。生产镜像实际构建、完整真实 ST 宿主走查未在本批运行；390 仅为既有手机样板对照。尚未提交、合并或部署。详细方法和限制保留在 `.review-queue/DR-1/NOTES.md`，DR-2–DR-8 仍待实施。

## 9. DR-4A：公共壳层（Owner 调整优先级）

本批提前执行 DR-4 的侧栏、头像与设置标题按钮，弹层和业务页不在范围内。沿用现有宽窄断点、尺寸、玻璃皮肤和控制器；修复已确认的 864×858 下图标偏左 5px、头像偏右 6px、标题图标偏左 9px。不增加侧栏按钮或新的收展视觉方案，检查既有宽窄窗口自动收展及现存收展状态。

**文件与接口：** 在 `desktop-ui/src/components/` 增加有消费者的 `IconButton`、`Avatar`、`Sidebar` 与 sprite 图标组件；`src/index.tsx` 导出 `mountSidebarView(container, props)`（返回 `update(props)` / `unmount()`）和 `mountSettingsHeaderView(container, props)`（返回卸载函数）。`shell.js` 保留导航、角标与身份数据控制器，停止直接修改 React 子树；React 边界为侧栏内部独立容器，现有选中镜片留在其外。`desktop/settings-shell.js` 挂载/卸载标题图标按钮，标题与业务保存按钮继续由原控制器管理。

**开源：** 使用已锁定的 Base UI Button / Avatar；参考 shadcn SidebarMenuButton / SidebarMenuBadge / Avatar 的独立槽位、固定图标与独立角标布局，保留 MIT 许可。无新增生产依赖。旧 Mini DOM 不支持 React，现有壳层挂载测试改用仅开发依赖 Happy DOM，保留原断言；仅开发依赖 pngjs 比较全部像素，布局仍由真实 Chrome 受管场景验收。`npm test` 自动构建，避免新 checkout 缺少被忽略的 bundle。

**共享消费者补充：** `page.js` 的模型页也消费分类按钮，须接入同一 React 按钮槽位并在重绘/关闭前卸载。只改此公共标题控件，不提前实施 DR-2 的模型表单迁移。合成 preview 不再额外为生产侧栏注入指针光晕属性；悬停对照与宽屏模型页一并纳入原视觉验收。

- [x] 在现有 UX-11 合成环境保存正常 1440/390 明暗参照，并先验证三个几何回归确实失败。
- [x] 迁移侧栏和头像到 React；控制器以 props 同步选中、未读、身份与收展；移动 ST 路径保持现有行为。
- [x] 用公共图标按钮替换设置分类按钮，断点仅控制显示；删除被替代的 DOM 与冲突布局规则，不使用位移修正。
- [x] 验证 390/744/768/864/1023/1024/1179/1180/1440 与返回宽窗，角标 0/1/99+、图片/首字头像、键盘和选中项、缩放后的设置分类可达；正常 1440/390 图像对照。
- [x] 类型/构建、相关单测与受管场景通过；截图覆盖到 `.review-queue/DR-4A/` 一套 before/after，更新本计划与 TODO 后停止。本批不提交、合并或部署。

### DR-4A 本地候选结果

三处偏移回归先 RED（-5/+6/-9px），后 GREEN。独立复核发现模型页共享按钮漏迁与新增悬停标记；均按保留既有视觉的约束补 RED→GREEN 回归并修正。正常账户页 1440/390 明暗、生产侧栏悬停、1440 模型页明暗共 7 对全图像素严格一致；864 明暗为本批已授权的对齐修复，另以几何关系断言验收。1px 位移反例被检出，不用遮罩或容差。

最终类型/构建、ST 整组单测 1025 PASS / 0 FAIL / 0 SKIP、`check.sh --quick` 与受管 `dr-appearance,dr-shell` 2/2 通过。窗口断点往返、864×390 短窗、已有展开偏好、角标 0/1/99+、图片尺寸、设置分类菜单与 Enter 导航通过。验收为合成宿主，不代表完整真实 ST 宿主或生产镜像已实测；未提交、合并或部署。截图与详细范围见 `.review-queue/DR-4A/NOTES.md`。DR-4 的通用弹层与后续页面仍未实施。

## 10. 持续 Goal（Owner 2026-11-02）

开工检查：React/Base UI 路线、现有视觉、桌面/移动端边界、ST DOM 管理边界和本地交付范围均已明确，当前没有必须 Owner 决策的事项。

- 顺序：DR-2 → DR-3 → DR-4（保留已完成的 DR-4A）→ DR-5 → DR-6 → DR-7 → DR-8。主 Agent 串行写入，在本计划和 TODO 记录状态，不另建流程文件或迁移框架。
- 按已确认计划持续实现与验收；组件选型、内部拆分和保持视觉的实现细节自行处理。每批先保存正常视觉参照和失败回归，再迁移实际消费者、移除旧实现，验收通过后推进下一 ID。
- 有意改变正常页面的视觉/布局时，先提供对应状态图等待 Owner 确认，仅停依赖该决定的部分，继续独立工作；不修改业务协议或借迁移增加产品功能。
- 完成条件：全部剩余批次的实际消费者迁移、旧实现清理、类型/构建与项目必要单测、受影响受管浏览器场景、正常视觉及真实适配回归通过；完成可用的合成完整宿主集成验证并如实列出无法覆盖的部分，不把样板当完整宿主。
- 本 Goal 交付本地候选与验收结果，不自动提交、合并、部署、调用真实模型/通知；出现需要这些动作的部分单独说明，其余授权工作继续。

### DR-2 完成记录（2026-11-02）

- 状态：本地候选已完成。模型页头/状态、供应商列表与编辑、模型列表与编辑、用途绑定、本机模型、用量和重认证已由同一个 React root 管理；仅外部容器与 ST 发送门禁保留原生 ownership。替代的字符串渲染、表单 DOM 写入与重复 input/change/click/keydown/toggle 监听已移除，关闭时卸载 root。
- 复用 Base UI Button/Switch、既有图标与皮肤，输入和选择器用原生控件；原 model-logic/API/版本/离开守卫保持单一来源，无新增生产依赖、服务协议或业务能力。模型对象保持编辑身份，可编辑配置标识不再承担选择身份。
- 已 RED→GREEN：选择器/月份按钮节点和焦点、新模型连续输入/手动与暂时冲突标识/删除、旧月份与供应商检查/发现回写、连接字段编辑后旧检查、旧模型核验完成切回旧供应商、克隆 VERIFIED 状态导致无法保存、保存后丢当前模型、冲突采用最新后的旧脏状态、本机重排重复提交。保存与绑定写入等待时禁用表单；重认证等待同时锁住原草稿并拒绝离开，跨上下文关闭原重认证和密码。
- 独立冻结的 `reference/page.js`（迁移前真实源码，含 DR-4A）不能覆盖；原有20对正常页加空/载入/失败、高级/放弃/冲突，共38对全图逐像素一致，无容差或遮罩。保留原导航标题刷新时机；视觉未改版。连续1440→1280/1180/1179/1024/1023/864/768/744→1440、864×600短窗、输入节点与草稿、保存可达和分类图标中心回归通过。
- 验证：最终 TypeScript/Vite 构建通过，`npm --prefix integrations/sillytavern test` 1025 PASS / 0 FAIL / 0 SKIP；整组检查发现的两项旧源码正则已升级为真实 Happy DOM 挂载/编辑断言并通过，未删除/跳过原测试。`check.sh --quick` 通过；共享 `dr-appearance,dr-shell` 2/2通过（共同合成宿主生命周期 helper 与 Switch 扩展）；最终 `desktop-models-accept.mjs --compare-reference` 38对及表单/保存/冲突/异步/重认证/缩窗全部通过。
- 独立复核无新增结构回归；确认两项 Important 历史缺口（保存中输入丢失、重认证误续写另一供应商）纳入本批修复，并补失败后通过的真实浏览器回归。其余审查无阻塞。截图和方法见 `.review-queue/DR-2/NOTES.md`。
- 边界：本批是合成生产组件/控制器验收，未运行真实完整 ST 宿主、生产镜像或真实模型/通知；完整宿主留在 DR-8。未提交、未合并、未部署。

### DR-3 完成记录（2026-11-02）

- 状态：本地候选完成，受管场景与独立复核通过。桌面/共享全局与角色语音用同一React VoiceForm；账户/数据入口和通知用SettingsOverview；账户的密码、会话、设备、同意、导出、删除与重认证内容用AccountContents。原生dialog仅作容器，内容Root和alert专用子树各有单一owner。
- 已冻结6份真实迁移前源（voice-settings.js、data-rights.js、desktop/settings-shell.js、consent.js、account.css、settings-pages.css）。84对图像目前全图RGBA严格一致：1440/864桌面4页明暗16，语音载入/失败明暗4，1440/390共享全局/角色声音明暗8，1440/390账户8状态明暗32、账户载入/错误明暗8、设备/设备确认/删除确认/同意确认明暗16。既有参照不可覆盖，不设容差、遮罩或逐元素位移。
- 保留readGlobalVoiceSettings/relationshipVoicePayload、原敏感动作/身份快照/API与轮询，未增加生产依赖。密码为不受控原生输入，仅在提交闭包短暂使用；通过字段key清空，不进入props、属性或存储。旧语音/账户字符串渲染与重复控件监听已移除，账户同意旧renderer删除；仍有实际消费者的全局consent gate留到DR-4通用弹层一起迁移。
- 已RED→GREEN：卸载后的语音旧按钮继续写入、共享表单保存中可输入、卸载后的账户入口重开旧流程、普通账户入口可在验证等待中关闭、关闭账户后嵌套确认与监听残留。另验证版本/开关/百分比载荷、保存离开锁定、409保留草稿、音色/语速/频率、试听参数与关闭后晚到、通知权限等待/切分类失效/拒绝不重复询问。真实按钮的改密/导出/取回/同意撤回/删除保持先重认证再原API；会话/设备撤销更新界面。所有请求为合成API，无真实模型/通知/账号操作。
- 验证：类型/Vite通过；账户迁移后整组ST1025 PASS/0 FAIL/0 SKIP；场景注册相关13项通过，quick通过。原Mini DOM渲染断言已改为Happy DOM实际挂载，保留原安全/载荷/路由/CSS断言；原始表单字符串值保留空数字，数值单位同一文本节点恢复6像素排字差异。
- 最终受管 `dr-settings` 1/1通过（84张及全部实际按钮回归）。独立复核唯一Important：侧栏/完成离开语音时漏destroy；新增回归先等待设置确实退出，确认旧保存产生1次PUT的RED，再补卸载得到GREEN。复核确认无剩余阻塞；未变化的整组不重复运行。
- DR-4已确认的旧问题：账户内alert装饰图标带hidden，祖先.vcms-root [hidden]强制隐藏，桌面网格仍保留40px首列，文案落窄列（旧截图亦如此）。DR-3不将该旧错误当正常布局通过；DR-4使用现成弹层并恢复既有正常全局alert布局，另写几何失败回归。通用菜单/alert/sheet、账户原生dialog外壳和全局consent gate在DR-4统一接手。
- 未做完整真实ST宿主/生产镜像或真实模型/通知；完整集成留给DR-8。未提交、未合并、未部署。当前不存在待Owner决定的新视觉方案；如确需新布局仍先出图确认。

### DR-4 阶段记录（最终结果见下文）

- 自有外壳导航/页头/内容容器、移动ST共享tabbar、聊天身份标题已迁入React；ST消息/输入、业务页内容与原生抽屉留在无React children的明确槽位。设置分类/标题和语音保存动作由SettingsFrame统一管理。
- 通用menu/alert/sheet改为锁定的Base UI组件，保留imperative消费者入口。删除旧菜单一次性手算定位与通用弹层的自写Tab/Escape/焦点trap；产品特有的sheet拖拽档位/弹簧仍复用原逻辑。嵌套确认经实际popup owner归入同一React树，让Base UI管理层级；父层销毁时释放子层与未完成确认。
- 账户原生showModal容器与首次同意gate改为Base UI Dialog；模型独立弹层也使用Dialog，嵌入设置时保持region。敏感动作仍由原模块负责。首次同意正文展开复用Collapsible，无新增生产依赖。
- 失败回归：旧菜单1440缩窗后仍停旧坐标；账户alert图标被hidden隐藏但保留40px首列，文案挤在窄列；模型独立页Esc提示存在但实际无关闭处理。各修复已有独立回归；最终整体验收尚未完成，不宣称本批完成。
- 已冻结14份扩展源码/CSS及preview源，一套before/after。初始24对正常截图有18对严格相同；4张菜单差异已定位为Base UI物理像素取整（示例214.984→215px），2张sheet层截图正在检查稳定渲染。另新增首次同意正常/展开/重认证12对，全图RGBA严格一致。
- 待Owner回答的两项具体取舍：①是否接受菜单库原生最多半个物理像素的坐标取整（前后实图已提供）；②是否采用库原生Tab/Shift+Tab离开菜单行为，替代旧自写Tab循环。公开API无法同时满足旧浮点坐标与旧Tab行为；不加偏移或自写键盘补丁，不将未答复视为批准。只暂停菜单最终定案，其余部分继续。
- Node Portal测试须先建立真实Happy DOM再导入生产bundle：Base UI的useIsoLayoutEffect在无document时固定为空操作。已补共享测试bootstrap并保留原断言；真实Tab循环断言迁至真实Chrome，Happy DOM不模拟浏览器的原生Tab默认动作。整组验证仍在运行。

#### DR-4 已收敛的非菜单候选

- 正常视觉：公共壳/确认/多层sheet/设置与首次同意共36对，其中32对全图严格一致，剩4张仅菜单物理像素取整待Owner；两张sheet层的中间帧差异已通过等待实际动画稳定消除，不改基线/容差。模型38对正常/交互图及全部表单、保存、冲突、异步、缩窗回归通过；模型已有遮罩/滚动锁，Dialog使用公开trap-focus模式，避免重复接管。初始焦点仍为原标题。
- DR-3相关84张：78个正常状态全图严格一致；6个已确认旧桌面alert异常保留原图，候选验证40px图标与文案正确两列；共享手机正常确认仍严格像素对照。全部实际语音/账户/通知/敏感按钮回归通过。Base UI嵌套Backdrop显式forceRender，维持既有每层scrim。
- 新增RED→GREEN：本机重排保存等待的侧栏离开、设置壳destroy误另弹模型脏草稿确认、账户destroy后下载finally更新已卸载root、全局入口指向已销毁账户。模型isBusy用于实际离开守卫，detach只卸载视图/失效请求并保留原控制器草稿；账户destroy幂等且注销自己入口。独立增量复核两项Important已关闭。
- 手机ST共享路径RED→GREEN：独立账户页后面的设置Sheet抢Escape。覆盖时通过Base UI open状态暂停后层交互，保留原DOM，返回恢复原设置和焦点；390→1440时移除旧设置Sheet，独立账户仍显示。该路径、嵌套确认/焦点和销毁定向通过；不改独立移动端分支。
- 已有整组ST1025通过，新增2项生命周期测试后最终整组在运行；相关39、29、16项分组通过，菜单决策仍待Owner，不能勾选DR-4整体完成。未提交/合并/部署或调用真实服务。

- 补查真实消费者：聊天搜索与角色面板原来直接插入React公共壳层。改为3个明确空槽位及搜索状态回调，原按钮样式扩展到实际槽位；未复制业务renderer。独立旧shell+Git旧widget/CSS又冻结1440/864明暗4张，严格一致；4次往返缩窗保留同一ST消息/.mes_text/工具按钮，搜索命中和Esc焦点归还通过，相关46项通过。增量所有权复核无新增问题。当前正常壳层/弹层参照增至40对：36对严格一致，4菜单待决。
- 收尾验证：最近稳定候选ST1027/1027、quick和受管dr-shell/dr-appearance 2/2通过（工具槽位最后小改后重跑相关46项；最终ST与聊天模式补充错误断言正在复核）。2个账户生命周期Important的增量复核已通过。

#### DR-4 当前停止范围与 DR-5 接续

最终非菜单候选：ST1027 PASS/0 FAIL/0 SKIP、quick通过；聊天4图严格一致及宿主节点/搜索/缩窗通过，模型Esc/同步销毁/864×390短窗展开长表单底部与保存操作可达通过；非菜单独立复核与实际消费者槽位增量复核均无剩余问题。菜单两项Owner选择仍未回复，不视作批准，DR-4整体不勾完成。后续只保留该项待决，按本节“只停依赖部分、继续独立工作”接续DR-5，不并行写入不同ID。

DR-5先迁移角色生产挂载路径。已发现角色/陪伴及旧记忆样板有重复控制器和DOM改装；先让合成样板复用真实生产挂载、只注入数据/宿主边界，再冻结现有生产视觉。不能以旧样板的重复实现冒充生产验收，也不因此改动生产页面视觉。

#### DR-5 角色子项（本地候选完成，批次继续）

角色列表/详情、实例弹窗和人设编辑内容已迁入React；复用原生输入、原生dialog与既有页面栈，不再拼接页面HTML或修补光标。外壳导入按钮通过props注册，退出动画结束前卸载对应组件，销毁时释放自己的注册和所有root。实例保存等待拒绝重入和身份切换；缓存页面返回保留草稿，新增实例保留所属characterRef。实际控制器失败回放确认旧版重复PATCH为2次、所属角色字段缺失；候选2项生命周期单测通过。

真实生产挂载的1440/864/390明暗列表/详情/新建/人设、空/载入/失败/长文及实例弹窗/未保存确认共40对全图RGBA严格一致。连续输入保留同一字段与焦点、侧栏往返草稿、Esc取消、保存等待/原PATCH载荷、1440→390→1440及864×390保存可达、卸载旧按钮不再写入通过。相关78项单测通过；原字符串合同已改读真实React挂载结果，不保留生产旧renderer。独立复核与整组检查在DR-5全部页面稳定后运行，不重复已通过的未变化检查。记忆页开始迁移，DR-5整体尚未完成。

DR-4补充：最终dr-shell通过，外观对照的旧设置壳因DR-3已移除旧语音导出而不能加载；回放配套固定Git同版voice-settings.js后，dr-appearance正常视觉与交互严格对照通过。未恢复生产旧导出。

#### DR-5 记忆、日记与收藏子项（自查通过，批次继续）

生产列表/时间线、详情、内联纠正、旧记忆弹窗、日记与收藏已迁入React，保留原数据控制器/接口/作用域/版本与清理语义。通用开关/分段/详情焦点复用Base UI；浏览器原生dialog继续管理旧弹窗。视图按Parts/List/Detail/Contents与类型分文件，旧字符串renderer、重复输入监听与自写Tab trap移除。普通角色/记忆root复用既有owner登记，临时确认/菜单随父视图卸载。

记忆58对加角色40对共98对正常图像全图RGBA严格一致；记忆检索、分区/钉住、纠正、取消删除及提示、字体、收藏/提醒操作通过。新增RED→GREEN：检索重建字段；744→390移动详情外层造成失焦；普通列表销毁残留确认。窗口1280/1024/864/768/744/390往返保留同一详情字段、焦点与草稿，864×390保存可达；父页销毁释放详情、遮罩与未完成确认，未产生DELETE。

相关124项单测通过。旧releaseSegment源码次序断言已改为真实分段控件重绘、一次回调和卸载后旧节点失效，保留尚未迁移陪伴侧的原断言。独立只读复核角色/记忆19个范围文件发现1项Important：Tab到内联取消/保存后Esc无效；真实Chrome先复现，再将处理移至编辑块共同祖先，两个按钮焦点回归及记忆整组交互通过。无其他已确认阻塞；陪伴页面仍待迁移，DR-5整体不勾完成。


#### Owner 菜单决策已确认（2026-11-03）

Owner 明确接受菜单每轴最多半个物理像素的原生定位取整，并选择 Tab/Shift+Tab 离开关闭、Escape 回到锚点。原 before 保留，已展示的4张菜单候选独立保存为 accepted-menu；后续仍严格全图比较这些已批准图，另校验坐标差不超过0.5/dpr，不放宽其他页面阈值。

菜单采用 Base UI Menu，移除强制 tabIndex/autoFocus。独立 root 接入文档，确保 Portal 焦点出口存在；imperative 外部锚点没有 Menu.Trigger，因此 Tab 只调用库公开 close，不取消原生导航、不计算/移动焦点或实现循环。其余键盘与定位由库管理。真实回归先复现出口0而非2及Tab不退出；候选公共14项单测及 dr-overlays 41图/交互通过：40正常中36张对旧图严格一致、4张对Owner批准菜单严格一致，另1张账户旧异常检查正确两列。

嵌套 Sheet 的216753像素合成残影已定位到保留的 finished 进入动画：释放该动画后差异为0。生产进入动画结束后释放 fill，最终状态沿用CSS默认值；未添加位置补丁。菜单/独立root/动画的增量只读复核无阻塞。最终稳定候选ST1031/1031（0 FAIL/0 SKIP）、quick通过，DR-5整组162图及全部实际交互通过。DR-4本地候选完成。

#### DR-5 陪伴子项及复核结果

陪伴列表、渠道、经典弹窗、冲突与重新验证内容已迁入React；保留原API、字段校验与读写控制器。Switch/RadioGroup使用Base UI、经典弹窗仍用原生dialog；密码字段非受控、成功/清除/销毁后清空，敏感值不传入React props。移除旧字符串renderer、整表单DOM解析与重复监听。模式行分隔/末端圆角按可见行匹配，隐藏表单代理保留事件与状态但不参与动画裁切；Space、方向键均由库处理。

新增旧请求跨关闭/重开/角色切换的RED→GREEN单测；真实Chrome验证字段身份、草稿/切角色确认、等待锁定/防重、渠道保存和凭据清空、已读宿主回调，以及1440→390往返和864×390操作可达。角色40、记忆58、陪伴64合计162张正常图已严格RGBA一致。直接相关60项单测通过；完整ST1030项曾通过。

独立复核陪伴14文件发现2项Important，均已真实复现并修正：Sheet退出动画开始后dismiss不能同步卸载；外部侧栏触发确认缺页面owner。现在定位host/回焦opener与生命周期owner明确分离，确认/冲突层显式归属listScreen；finish幂等，退出动画中也能同步dismiss。外部宿主焦点和侧栏确认两种销毁回归均RED 2!=0→GREEN，增量复核已关闭原2问题。新增Sheet幂等单测通过，最后稳定候选ST1031 PASS/0 FAIL/0 SKIP、quick和162图整组实际交互全部通过，DR-5本地候选完成，接续DR-6。未提交、合并、部署或调用真实模型/通知。


#### DR-6 本地候选完成（2026-11-03）

搜索、快速切换、记忆检视、引用与消息工具、表情/回应、会话列表、角色面板/纠正、建议回复和状态卡已组件化。通用行为复用 Base UI Dialog/Autocomplete/Toolbar 与公共 Button/Segment；原API、ST事件、唯一生成链、原生消息/输入/脚本卡仍由既有控制器和宿主管理。朗读状态通过回调传给组件，移除跨owner直接改写。

96张正常全图RGBA严格一致，无遮罩和容差。原始参照保留；初始帧混有700/2000/5000ms会话补取的不同阶段，ready对照令冻结旧实现与候选都先完成补取，再通过同一公开panel.refresh取得已加载状态。首次收尾时，“刷新后持续高亮当前会话”尚未获Owner单项确认，因此先保留旧生命周期。Owner随后已明确批准，补充实现与验收见下文。

实际行为覆盖搜索与原生节点身份、连续输入/空草稿、切会话/重绑/迟到响应、朗读等待防重、表情连续插入、键盘、短窗和嵌套销毁。独立复核2项Important（父面板销毁残留删除确认、同一记忆并发纠正）均先真实RED [1,2]，修复后GREEN [0,1]并关闭。另修复policy刷新期间busy朗读入口消失；原业务API未复制。chat-view39、搜索8及更新后的真实DOM合同通过。

#### DR-7 本地候选完成（2026-11-03）

剧情gate/stage、原生legacy对话框内容、证物叶组件、灯箱、贴纸入口/设置和语音气泡自有内容已迁React。灯箱使用Base UI Dialog，语音展开使用Collapsible，贴纸复用Switch/Segment/Button；原剧情sanitize/action/projection/rewind、图库操作与播放器业务保留。贴纸页面和嵌套确认归属实际外观页owner，Sheet标题/页头显隐通过状态更新，关闭与迟到回调不再重建旧UI。

预览先移除重复剧情renderer，改用生产mountStoryTab及合成服务边界，再冻结旧实现。64张正常全图RGBA严格一致：剧情/灯箱46、真实installStickers入口/设置6、语音12。字段身份/草稿、刷新焦点、首尾图片方向键保留zoom、库原生Tab循环、父销毁与切聊天关闭、波形/倍速/seek/resize和宿主移除释放rAF通过。

收尾实际复现首次语音展开测量26px而最终45.5px：测量内容的padding也在收缩。改为库测量/动画外层、原p保留自然内容与皮肤，原回归RED→GREEN、64图仍严格一致；没有加偏移或手写折叠状态机。story44、stickers17、fix-fe2 12、voice8相关单测通过；旧Mini DOM合同升级为真实生产React DOM，原断言保留。独立源码与语音增量复核无剩余Critical/Important/Minor。

#### DR-8 本地候选完成（2026-11-03）

标准检查在收尾前通过（39s）；最后一次标准检查的类型/构建、许可、Catalog/OpenAPI和Go均通过，ST仅旧产物路径源码断言失败。更新为实际隔离/覆盖行为后，ST整组1032 PASS/0 FAIL/0 SKIP；随后产物位置改为直接消费ctx.artifactsDir、同目录覆盖，受影响壳层25项重跑通过。无测试删除、skip或断言削弱。最终共享外观14组合、模型38图、公共弹层41图、设置84图、业务页162图和富内容64图及各组行为通过；聊天96图和壳层缩放/收展通过。旧账户异常按正确两列几何验收，已批准菜单按accepted-menu严格比较，其余正常图不放宽像素要求。

历史样板差异单独处理，不改生产外观也不覆盖before：DR-3共享语音背后的角色样板在DR-5改为真实生产挂载后，占位由“搜索”变成生产的“搜索角色”（257像素）；仅历史截图回放固定Git旧背景，交互前解除路由，当前角色页仍由DR-5严格验证。DR-4的简化聊天背景已被DR-6真实生产样板替代，四张聊天图沿用DR-6冻结旧实现、相同稳定加载状态，其他弹层仍用原DR-4参照。

完整ST合成宿主使用本worktree专用dr8目录、11852–11855端口和vc-dr8容器，未接管11080或vc-local-dev。分组结果：ui04-browser（真实Helper/EJS/MVU与停止/继续）、story-view-browser、hl-reply、hl-stickers通过；vc-ui-walkthrough在360/390/768/1024/1280/1440明暗共12组通过；最终最新候选重跑为110812ms，catalog-admin+走查2/2通过；f2-chat-ui通过原生发送/保存冲突/候选/停止继续顺序、桌面及共享手机菜单、消息编辑/记忆检视/拍一拍。不是一次全选调用全绿：首轮旧选择器/清理方式失败，修正验收脚本后重跑相应组通过。

脚本不再假定Menu.Popup持有role=menu，按实际语义列表定位；走查关闭通过Escape/取消/放弃等公开动作，不删除React弹层、遮罩或修改pointer-events。最终走查首轮在1024明色的即时默认焦点断言失败；上游实际在微任务/rAF设置焦点，改为等待真实取消按钮获得焦点后保留原断言，整组重跑通过，未手动focus。壳层额外通过125/150/200%的CSS视口+DPR缩放模拟；这不等于手工操作浏览器缩放或真实手机软键盘。

完整宿主保留上游噪声：6条可选贴纸manifest 404、一次/st/sources/reconcile 404、停止流时原生StreamingProcessor的AbortError；未观察到React挂载异常，不将其写成零console错误。未运行真实provider/TTS/通知、生产镜像构建、部署或Owner人工体验验收。完整宿主走查本轮没有可用记忆详情样本，不能据此声称该分支已跑；其详情/纠正/保存由DR-5真实生产组件+合成API场景覆盖。测试进程及专用PG/MinIO容器和临时卷已退出清理，隔离栈派生数据/运行副本已回收。走查使用实际ctx.artifactsDir的同级walkthrough-latest覆盖一套，旧重试目录定向清理；保留必要分组结果与.review-queue/DR-8/native的390/1440明暗代表图。已完成本Goal的DR-2–DR-8本地候选，未提交/合并/部署；无待决的必需视觉改版。详细路径和限制见.review-queue/DR-8/NOTES.md。


#### DR-6 补充确认：刷新后保留会话高亮（2026-11-03）

Owner已明确接受此前实图中的“刷新后保留蓝色高亮”，颜色、形状和布局沿用原选中态。原先reload清空rowSelection，随后依赖角色面板setConversationSelection补回，产生两个状态来源；现由壳层直接从ST当前vc_binding.relationshipId投影aria-current，删除独立选中状态和面板跨模块回写。没有改CSS、增加依赖或操作React内部节点。

新增真实DOM回归先RED（当前绑定已有列表却无高亮）后GREEN，覆盖同会话刷新、切换、旧列表晚到、侧栏收展和清除绑定。受影响壳层26项及ST整组1033项通过，0 FAIL/0 SKIP。聊天浏览器整组96图与行为通过；92张用原before严格比较，4张建议回复状态用独立accepted-selection严格比较。批准参照由冻结旧实现经其原公开panel.refresh取得原皮肤选中态，原before不覆盖；候选不调用该入口补高亮。1440明暗变化仅位于当前会话行背景，864列表隐藏时图像仍零差异。历史回放的旧Sheet与DR-7冻结的同期stickers.js配对，避免新接口与旧模块错配。

窗口1180/1179/1024/864/768/744/1440往返、侧栏自动收展及既有窄窗展开偏好、定时补取/CHAT_CHANGED、切到另一绑定及清除绑定的实际浏览器回归通过。此项使用合成宿主边界；未重新启动完整ST栈，未提交/合并/部署，11080保持原实例。


#### 发布授权（2026-11-03）

Owner明确要求提交并push当前codex/desktop-frontend-refactor分支、部署线上供试用，并更新本地11080旧实例。此次授权覆盖既有部署流程、备份/自检和本地代码更新；不合并main或mb-mobile，不重置业务数据。发布版本、验证和结果在TODO的DR-8条目回填。


#### 发布完成（2026-11-03）

Owner已确认首次推送目标。实现提交`392894079ae0d8e37abc4c53b8ce7f32198c5768`已push并跟踪origin同名分支；未合并main或mb-mobile。发布前check.sh 39s全部通过，相同候选内容的完整受管8场景一轮全绿；镜像从已验证的暂存树构建，提交后用Git差异确认内容完全一致，再标记为39289407并按现有deploy.sh部署。

线上39289407部署与自检完成：加密备份自校验通过，203个迁移/最新V282一致；Go、ST、MemoryCore、向量、重排与三个已配置语音引擎健康通过。额外核验线上数据卷实际具有React bundle和本次绑定派生高亮逻辑，外部HTTPS登录返回200。历史镜像、旧备份/扩展快照和传输包按OP-11清理；临时构建目录和无用候选镜像标签回收，当前运行/部署镜像及必要共享层保留。

本地11080已从旧项目目录的前端挂载切换至本重构worktree并重建ST，健康、登录200和新前端代码检查通过。只更新了本地自有前端，原Go/MemoryCore等服务和业务卷保留。本地继续依赖该worktree路径；本轮未执行真实业务消息/通知发送或Owner人工体验验收，供Owner随后试用反馈。此前各批“未提交/未部署”为当时本地候选阶段的历史记录。


## 11. NF 电脑端替换与酒馆能力适配（2026-11-03）

### 11.1 已确认的范围与基线

正式电脑端复用现有 React、TypeScript、Vite、Base UI、主题、组件与同源部署，替换当前页面；开发先走 `/desktop/`。
“独立”指启动、导航、页面、设置、消息列表、输入与生命周期不依赖完整 ST 页面；不新建应用、业务存储或生成服务。
桌面禁止完整 ST iframe、先初始化 ST 再隐藏、模拟抽屉点击或观察原生 DOM 补皮肤。仅卡片 HTML/脚本 iframe 可保留。
本轮不重写手机；现有 ST/Go 服务、功能与复杂卡能力均保留。真实模型费用、通知、生产部署、新增生产依赖均未授权。

- 原主工作树：`/Users/hxf/projects/virtual-companion`，`ux-11-desktop-immersive@a8b240e2`；未跟踪 zip 不处理。
- React 来源：`codex/desktop-frontend-refactor@09690d26`（已 fetch 核对，跟踪远端一致），上游父实现 `39289407`。
  DR-1–DR-8 是可复用的组件化成果，不代表独立前端已完成。原工作树 11 个文件有未提交改动，本轮全部保留、不复制或提交。
- 本轮唯一写入 owner：主 Agent；隔离工作树 `/Users/hxf/.codex/worktrees/desktop-independent-frontend/virtual-companion`，
  分支 `codex/desktop-independent-frontend`，推送 origin 同名跟踪分支。只读子任务可以提供证据，不建立固定多 Agent 流水线。
- 手机分支 `mb-mobile@bedf0320`，`/Users/hxf/projects/virtual-companion-mobile/mobile/src/engine/engine.mjs` 的
  `createEngine({src='/'})` 为真实消费者。NF-10 必须先提供明确原生宿主入口并适配它，再切桌面根入口；不能靠 UA 猜测绕过。
- 上游锁定：ST `7e8663cd9`、Helper `0af421068e`、EJS `d6f520d149`、MVU `d03b7dc8a6`；原始检出只读，派生物走受管装配。

### 11.2 责任边界与状态语义

| 所有者 | 保留/迁移责任 |
| --- | --- |
| 自有前端 | 全部桌面界面与页面生命周期、列表/消息/输入、草稿、焦点、滚动和请求失效 |
| 聊天运行模块 | 实际需要的 ST 提示词组装、世界书、宏、正则和生成钩子；纯计算复用，显式状态注入，解除 DOM/原生设置/完整初始化依赖 |
| 卡片运行模块 | 当前锁定 Helper/EJS/MVU、消息 iframe、卡片脚本、变量/swipe、编辑重处理与历史回放；React 仅提供叶子挂载位 |
| ST Node | 原始聊天、角色卡、世界书、受控生成和插件；所有聊天写入沿用现有 F2/CAS，不绕过冲突保护 |
| Go | 现有身份、模型目录、预算、记忆、陪伴、语音、通知与剧情状态；不并行改写 ST 聊天文件，凭据不进入浏览器 |

一操作只有一条生成流程。沿用页面加载时账号/会话快照、ST CSRF 与 Go 双提交令牌；不在写前自动换身份。
绑定和模型目录沿用既有 revision。保存冲突保留本地草稿，迟到请求不得覆盖新会话、已卸载页面或新身份。

### 11.3 现有功能逐项迁移表

路径相对 `integrations/sillytavern/`；接口以当前 api.js、ST 路由/F2 及相关 OpenAPI 为真源。

| 功能及当前来源 | 目标批次/复用位置 | 现有接口 | 必须解除的依赖 | 直接验收场景 |
| --- | --- | --- | --- | --- |
| 登录/身份/首屏：server-plugin/lib/host-auth.js、auth/ | NF-01 桌面 HTML 与独立客户端，复用原登录 | `/auth/api/session`、`/csrf-token`、Go bridge | 仅 `/` 绑定会话、原生 index.html/startup | 未登录/非 ACTIVE/删号/身份变化拒绝；独立 URL 正确绑定 |
| 导航/会话列表：shell.js、conversations.js、React Sidebar/Conversations | NF-01 复用组件与行数据转换 | `/api/chats/recent`、`/api/characters/all`、relationships | `loadNative()`、ST context、延迟补取/原生面板 | 聊天模块延迟期间导航、列表、历史、设置仍可用；网络无完整宿主 |
| 角色卡输入/世界书/宏/正则：ST script.js、world-info.js、macros/、regex/engine.js | NF-02 计算运行模块 | 既有角色/世界书/设置读取 | 所有入口静态导回 script.js；全局状态/DOM/预设单例 | 同一合成角色/历史/设置/时钟，最终请求与状态逐项对照 |
| 提示词/预算/生成事件：ST openai.js、PromptManager.js | NF-02/03 定向提取计算段 | 原生受控 chat-completions generate 与 Go 目录 | Generate 读取 textarea；PromptManager 导入 popup/移动检测 | 预设排列、token 预算和钩子前后顺序一致；三协议请求形状 |
| 记忆/陪伴/剧情注入：memory-injection、companion-prompt、story-context | NF-02 复用纯逻辑，显式上下文/事件 | memory recall、`vc_memory`/`vc_companion`/`vc_story` | ST setExtensionPrompt、事件注册时序 | plan→memory→companion；EJS 后追加身份；剧情不召回日常记忆 |
| 打开/发送/流式/停止/错误/保存/恢复：chat-compose、F2 client、ST Generate | NF-03 桌面输入与会话 owner | `/api/chats/get`、`/api/chats/save`、受控生成、F2 metadata | 原生 send_form/textarea、StreamingProcessor、全局 chat | 重复点击、切聊天、迟到响应、断网、409、多端同聊、草稿保留 |
| Helper/EJS/MVU：锁定扩展与 scripts/lib/complex-card.mjs | NF-04 卡片运行模块与 iframe 叶子 | Helper variables/messages/worldbook/events，原保存链 | Helper 主入口挂 Vue/设置面板、`.mes` 扫描；EJS 自动 UI；MVU 父 API | 现有 C04/C05 全链、下一轮新变量、编辑后重新处理及历史回放 |
| 重新生成/继续/候选/编辑/删除：chat-view/compose/react | NF-05 自有消息操作 | 原聊天与 F2 保存/来源 | 原生按钮点击、message DOM | 一操作一生成；候选变量、来源、保存版本与恢复一致 |
| 引用/复制/搜索/历史/滚动/阅读：chat-search、desktop/chat-scroll、message-source | NF-05 复用 React 工具与算法 | 现有来源/记忆 API、聊天读取 | `#chat > .mes`、mesid、ST滚动容器 | 引用定位、加载前后锚点、切聊天草稿与阅读位置 |
| 图片/贴纸/语音条/朗读/输入：stickers、lightbox、voice-chat/input、React叶组件 | NF-05 现有服务/组件 | 现有 Go voice、ASR/TTS、素材 API | 原生消息插槽/移除观察、宿主输入 | 不串播放/来源，卸载释放；合成语音/图片，不调用真实服务 |
| 模型：page、model-logic、React models/ | NF-06 保留控制器/组件 | providers/model-purposes/local-models | 原魔杖挂载、关闭回原抽屉 | 默认/存储/revision/未保存确认/401/409/迟到响应；保存不试连 |
| 语音/通知/账户/数据/外观：settings-shell、voice-settings、data-rights、appearance | NF-06 复用 React 与原校验 | voice settings、auth、exports、theme prefs | 原生 persona DOM、模型页宿主、抽屉分流 | 存储键/角色覆盖/保存校验、销毁与未保存、密码生命周期 |
| 酒馆九类配置：TAVERN_ENTRIES、drawers.js | NF-07 自有设置页 | settings、presets、worldinfo、personas、backgrounds、characters/extensions；缺口契约先行 | 模拟点击原生抽屉、DOM搬运/监听/覆盖 | 逐字段读/写/刷新；现有支持项不删；非表单键保留 |
| 角色/实例/人设：instance-page、persona、React characters/ | NF-08 拆宿主控制器，复用视图 | characters、relationships、persona | characters全局、选择/导入/创建原生聊天 | 角色/实例作用域、导入失败、草稿、防重与未保存 |
| 记忆/陪伴/日记/收藏：memory/inbox/diary/favorites-page 与 React | NF-08 复用控制器与组件 | 既有 Go API/分页/来源 | shell路由、ST绑定/已读宿主回调 | 作用域、分页、草稿、纠正/删除语义不变 |
| 剧情：story-page/projection/action 与 React story/ | NF-08 复用规则与玩家投影 | 现有 Go story / ST projection save | ST舞台/元数据/原生消息 | 三 NPC 隔离、行动/回档/投影原子保存、日常记忆隔离 |
| 主题/窗口/缩放/受管构建：desktop/、Vite、assemble-managed | NF-09/10/11 沿原体系 | 同源静态资源与受管入口 | 无消费者桌面挂载/抽屉接管/覆盖样式 | 同条件启动改善、窗口往返/明暗/缩放；手机不递归嵌入 |

### 11.4 编号、依赖与验收

NF-00 → NF-01 → NF-02 → NF-03 → NF-04 → NF-05 → NF-06 → NF-07 → NF-08 → NF-09 → NF-10 → NF-11。
NF-05–08 虽无强制相互依赖，本轮仍串行、单一写入 owner。每批验证/提交/立即推送同名跟踪分支，正常批次后继续。

| ID | 完整交付与验收门槛 |
| --- | --- |
| NF-00 | 核对基线/范围、迁移表、合成冷/热测量、登记 Backlog/TODO，并更新冲突架构条款 |
| NF-01 | `/desktop/` 直接启动自有导航、列表、历史与设置；认证/会话保护不退步；人为延迟聊天模块时仍可操作；实际网络无原生页面/完整启动脚本/隐藏宿主 |
| NF-02 | 定向抽离角色/世界书/宏/正则/预设/提示词与必要钩子；同合成输入对比最终请求和状态，不能以回复相似代替 |
| NF-03 | 普通聊天纵切，三协议/流式/停止/错误/F2/CAS/刷新；重复动作、切会话、迟到/断网/冲突保留草稿 |
| NF-04 | 第一阶段技术门槛：打开合成复杂卡→世界书→EJS→生成→MVU→状态面板→保存→刷新；下一轮读取新值、编辑重处理及历史回放通过 |
| NF-05 | 全部既有聊天操作与媒体迁移；候选/变量/消息来源不脱节；历史锚定和阅读位置保持 |
| NF-06 | 模型/语音/通知/账户/数据/外观独立工作；原默认/键/覆盖/校验/离开确认/身份与异步语义完整 |
| NF-07 | 九类受支持酒馆设置自有页，直接读写接口；不再操作原生抽屉；接口缺口先改契约 |
| NF-08 | 角色/实例/记忆/陪伴/日记/收藏/剧情去宿主依赖；不改作用域、分页、删除语义与剧情约束 |
| NF-09 | 依据基线按需加载/拆资源/去重复初始化；分别报告 UI 可操作、可发送、模型响应，不能只提前空壳 |
| NF-10 | 手机明确原生宿主入口+实际消费者适配/验证先完成，再替换桌面 `/`；清理已替代桌面挂载/监听/样式 |
| NF-11 | 完整业务/复杂卡/恢复/多端冲突、窗口/缩放/浅深色、构建/受管装配；交付候选、性能对比与明确未验证项 |

停止条件：NF-04 必需能力不能脱离完整 ST 时，写明具体依赖与验证失败，仅暂停依赖该结论的工作；
不得恢复隐藏 ST 或删减复杂卡后勾选通过。产品取舍、费用、生产部署、新生产依赖等授权缺口只暂停相关部分。
不以正常批次完成为停止理由，不重新讨论是否覆盖酒馆皮肤。未实测/未通过项不标完成。

### 11.5 合成测量与直接验证

- 复用 `scripts/accept-managed.mjs` 注册表，NF-00 的 `nf-startup` 场景不另建验收编排。
- 固定 1440×900、DPR 1、浅色、reduce motion、24 条合成消息、相同卡/设置/时间；provider 为现有合成 provider。
  cold=新浏览器上下文、warm=同一上下文再次导航；均为已启动服务器，不声称清除了 OS 缓存或测了真实生产冷机。
- UI 可操作：点击“角色”后导航完成；历史打开：公开入口打开指定文件且 24 条消息已渲染；
  可发送：模型就绪、当前绑定建立且输入可编辑。全过程不调用模型。会话打开另记录操作至历史完成的增量耗时。
- 后续同条件独立桌面追加对照；NF-01 未实现生成时只能报告 UI/历史，不把可编辑输入等同可发送。
- 测量数据与直接验证结果在稳定候选后回填本节；固定输出 `ctx.artifactsDir/nf-startup.json`，本工作树保留最后一套有效结果，重试残留按归属回收。
- NF-00 原生基线实测通过（2026-11-03，Chrome，本工作树独占 11952–11955；两个所选受管场景通过，浏览器生成请求 0）：

| 缓存 | UI 可操作 ms | 24 条历史完成 ms（自导航） | 打开会话增量 ms | 可发送 ms（自导航） |
| --- | ---: | ---: | ---: | ---: |
| cold | 2922 | 3693 | 765 | 3990 |
| warm | 2357 | 2921 | 564 | 3205 |

有效结果 `dev-managed/artifacts/accept-2026-11-03T05-22-12-663Z/nf-startup.json`。NF-02 发现原先“可发送”检查的
`no-connection` 样式类在原生页不存在，因此修正为实际 `online_status`，必要时调用原生连接动作做本地 `/models` 检查；
旧 `03-40-36` 记录的可发送计时作废，后续对照使用上表。本轮仍无生成请求。这是各一次观测，不是分位数或生产 SLA；
NF-09 必须在相同条件下成对重测，不把历史文档中的 15.7s 当作本轮基线。首次引导通过创建真实合成绑定消除，未删除弹窗或强制点击。
初次缺构建产物、vendor-cache 与场景注册顺序/重复选择器问题均按现有入口修正；失败不记通过。

### 11.6 定向抽离的已证实边界

不得直接 import ST `Generate`、`world-info`、regex engine、PromptManager、Helper/EJS dist：它们静态导回 `public/script.js`。
原始定位：`script.js:4290/4311/4564/4635`、`openai.js:1542/3146`、`world-info.js:892/4709/5175`。
宏 parser/lexer/walker/registry、正则筛选/替换、世界书扫描/预算/递归/定时效果与 Prompt/Collection 计算可以复用，
必须显式注入状态、tokenizer、加载器与事件，不能仅拼角色说明+历史。

Helper `src/tauritavern_chat_surface.ts:47–75,150–173,186–204` 已有 prepareContent/claim/mount/dispose 叶子边界，
但仍依赖 ST/Pinia，不能原样加载整个 dist。`src/iframe/predefine.js:11–34` 从父窗口取 TavernHelper/EjsTemplate/YAML/z/context，
MVU `src/function/global/index.ts:165–184` 把 Mvu 暴露给父窗口；可保留卡片 iframe 与窄父 API。
Helper variables `src/function/variables.ts:56–82,128–153` 的 message.variables[swipe_id]/chat/character/global 语义必须保留。
EJS 底层 `src/3rdparty/ejs.js` 可复用，但 Prompt Template 的 handler/evaluate/variables/worldinfo 钩子仍需抽离；
MVU InitVar/Request/Response/Cleanup 与按钮不可删。

现有顺序：index.js 189–194 的 planReply→memory.intercept→injectCompanionPrompt；世界书/组装后 EJS 改写 SETTINGS_READY；
index.js 218–221、239–241 再追加记忆/陪伴/剧情身份。剧情模式清除日常记忆和陪伴提示，保留既有 IN_PROMPT/IN_CHAT 位置。

NF-00 收尾：TypeScript/Vite 构建、ST 离线整组 1033/1033（0 FAIL/0 SKIP）、受管 catalog-admin+nf-startup 2/2、`git diff --check` 通过。受管 ST/Go/provider/MemoryCore 与专属 PG/MinIO 容器及临时卷已按原入口退出清理；未部署、未调用真实服务。


### 11.7 NF-01 独立入口候选（2026-11-03）

- `/desktop/` 由原 host-auth 在线核验 Go 身份/TOTP/删除态、登记同一 profile 并绑定 ST 会话，返回自有 HTML；
  HTML 捕获账号/会话，独立 client 获取原 ST CSRF，Go bridge 继续沿用原双提交和身份快照。无新数据接口或业务存储。
- 同一 React/Vite bundle 增加自有 DesktopChat；消息与输入由 React 管理，页面控制器仍复用原组件/主题/服务。
  shell 新增实际被桌面消费的历史/打开/渲染槽位，原生消费者的默认路径保持。无 iframe、无原生 `script.js`、完整扩展启动器或 ST context 请求。
- 真正延迟 `standalone/runtime.js`：角色搜索、模型/外观设置、24条历史打开、草稿往返均可操作。
  真实网络资源列表保存在受管结果 nf-desktop.json 的 resources 字段；禁止入口计数0、iframe0、模型生成请求0。
- 这是 NF-01 的候选范围：发送 disabled（不把可输入当可发送），复杂卡/完整聊天操作/深层业务适配继续按 NF-02–08。
  `/` 与手机分支未变，不宣称已替换默认入口或完成整个电脑端。
- 几何回归先 RED：消息根274px/面板846px；补独立文档所需 width/box-sizing 后 GREEN，输入区沿用既有阅读宽度。
  首轮窄窗截图含 viewtransition 中间帧，改为等待实际有限动画结束，未改皮肤或放宽阈值。
- TypeScript/Vite、设计检测、标准 `bash scripts/check.sh` 全部通过（45s）；受管 catalog-admin+nf-desktop 2/2通过。
  390/1440浅深4图留在 `.review-queue/NF-01/`，一次只读独立视觉复核 disposition=ship，仅覆盖所示状态。
  初始标题重名选择器失败已修正为level 1，原断言保留；未删测试/skip、未调用真实服务或部署。

### 11.8 NF-02 聊天计算模块（2026-11-03）

- `desktop/standalone/engine/` 保留锁定 ST 的计算源码与许可，入口以显式 context/settings、世界书读取、tokenizer、
  事件和媒体资源端口工作；不导入原生 `script.js`、设置控件、扩展自动启动器或 `Generate`。`/lib.js` 只提供原有纯第三方库。
- 本批源码约1.5万行，主要为原有算法而非新增产品机制：世界书扫描/递归/预算/定时效果对应受支持卡片；
  legacy及现代 parser/lexer/walker/registry 对应现有两代宏；PromptManager/OpenAI 计算对应预设排序、工具预算、
  多媒体与三协议请求形状。正则、变量、角色字段及缺省设置是这些实际调用链的直接依赖。不迁入它们的界面和启动闭包，
  不新增后端生成服务、持久化副本或通用兼容框架。
- 复用原模型绑定/参数投影、历史窗口、plan→memory→companion 拦截顺序与剧情注入模块。原 EventEmitter 的 await、
  makeFirst/makeLast、错误与一次监听语义保留。受控 Chat Completion 原生不发 BEFORE_COMBINE；AFTER_COMBINE
  原载荷为 `{prompt:'',dryRun}`，保留副作用时序而不将其字符串改造成 messages。
- `nf-prompts` 使用同一合成卡、24条长历史、递归世界书、scoped正则、预设变量、固定时钟和随机输入；
  在真实模型出站前截住原生请求，逐字段比较最终序列化 JSON、聊天/全局变量、世界书定时状态、上下文窗口和生成事件顺序。
  Chat、Responses、Claude 与旧宏各一组；不以模型回复相似替代。原生 Claude 代理弹窗只确认当前合成受控标记，
  参考页失败先关闭浏览器上下文，避免等待弹窗导致清理挂起。
- 记忆外部输入采用内存录制回放：原生必须真实召回成功，候选完整业务请求（含F2版本）与页面身份逐项一致后，
  才按次数/顺序回放同一HTTP响应；多调、漏调、参数不同均失败。原因是原生 `setvar` 会排入1秒后的元数据保存，
  两个顺序运行的浏览器即使持有相同冻结版本，也可能面对不同的服务器持久版本。没有修改F2或memory快照保护；
  该计算等价测试不证明真实召回/保存/多端冲突，后者继续NF-03。
- 此批只提供准备请求能力。真实输入对应的人设/角色打开、受控发送、流式/停止和F2保存归 NF-03；
  当前锁定 EJS/Helper/MVU 的真实卡片运行与回放仍归 NF-04，不宣称已经通过复杂卡门槛。
- 稳定候选验证：TypeScript/Vite与离线1036/1036、零fail/skip；受管catalog-admin+nf-desktop+nf-prompts 3/3，
  4组最终请求/状态/事件完全一致，模型出站0。结果在 `dev-managed/artifacts/accept-2026-11-03T05-34-34-117Z/results.json`。
  初期缺省常量导出、状态标记和原生连接/代理确认边界均已修正后复验；未删测试或放宽等价断言。

### 11.9 NF-03 普通聊天纵切（2026-11-03）

- `standalone/session.js` 为桌面唯一生成/聊天写入owner；先保存用户消息并取得F2 ACK，再准备和发送。打开会话串行收尾旧生成，
  UI历史读取仍独立；旧读请求的AbortSignal同时限定回调归属，迟到ACK不改变新会话。所有JSONL写入复用 `createF2Client`、
  `prepareSourceIdentities` 与原ST保存接口；Go不写聊天文件，不另建生成服务。原模型绑定、预算和记忆来源复核继续经受控出站端点。
- 流式分帧、文本/reasoning、工具delta及回复清理使用锁定ST纯算法。普通Claude保持Anthropic事件，工具循环包装的Claude按实际
  choices形状读取；原ST流可能保留text/plain响应头，使用本次生成stream标记判定。DONE/finish/EOF/错误分别处理，停止或断流保留
  部分回复且标为非记忆证据。原有可选reply planner仍走同一受控quiet调用，配置保存本身不调用模型。
- 原生聊天头的user_name/character_name是占位值。当前称呼取实际用户设置/人设，角色名取当前卡；按原头像存在性、聊天锁定、
  连接顺序、默认人设、自动锁定和临时描述规则选择。多连接选择复用既有Sheet；迟到选择不应用。
- 发送先收取输入，原始草稿在F2确认前由本轮owner保留；失败与最新版本合并使用原F2 mergeInput。输入宏通过显式UI读取端口，
  bias在原发送位置求值一次，重试不重复追加用户消息。复用vc-draft存储，以账号/角色头像/聊天文件限定桌面作用域，避免同名文件
  草稿混用；旧原生键未删除，其迁移与列表草稿展示在NF-05收尾、根入口切换前验。保存冲突继续用原项目弹层与三个动作，
  只注入独立的查看最新/复制回调，不加载原生ST页面。原生消费者沿原默认动作，单独回归。
- 桌面消息、输入、等待、失败和停止由React管理，沿用原类名/皮肤；data-generating由实际会话状态驱动。发送/停止使用不同节点身份，
  同一鼠标双击的第二击不会误触停止；正常单击与键盘停止保留。媒体和完整聊天操作继续NF-05，真实复杂卡运行继续NF-04。
- 定向恢复场景实际覆盖：HTTP错误与重试、在途ACK期间新草稿、provider真实取消、断流部分保存、另一消费者先保存后的409、
  显式读取最新、同名文件不同角色切换与刷新草稿。三协议流式/非流式、Claude工具循环与原quiet规划共9组通过；
  catalog-admin、nf-desktop、nf-prompts、nf-chat 4/4通过，结果为 `dev-managed/artifacts/accept-2026-11-03T07-51-16-410Z/results.json`。
  共享原生F2完整场景单独通过（`accept-2026-11-03T07-12-32-001Z`，60.9s）。仅使用合成provider，无真实费用或通知。
- 两个真实界面回归先失败后修复：窄窗resize丢失底部定位；缺少原生dialog基础规则导致关闭的冲突层仍拦截点击。
  分别增加pinned resize行为与独立文档的关闭dialog基础规则，未修改既有皮肤。390/1440明暗4图在 `.review-queue/NF-03/`，
  只读独立复核 disposition=ship；静态复核只证明所示布局，发送、滚动和弹层由真实浏览器行为断言覆盖。
- 原生提示词对照显式预热实际tokenizer，并在计算检查点调用原公开取消metadata debounce接口，避免UI计时器改变固定输入；
  保留最终请求/全部source状态逐项等价断言，真实保存与冲突另由nf-chat和原生F2场景覆盖。
- 标准check的约束、TypeScript/Vite与Go检查通过；ST默认高并发的既有80ms预留超时用例在进入预留前超时，
  单文件复验通过，同一整组限制4个worker后1043/1043通过（0 fail/skip，25.2s）。未改超时、测试或断言。
  `git diff --check`通过；受管私有进程/容器/临时卷按原入口清理。复杂卡、媒体、完整设置与其余页面仍按后续批次验收。

### 11.10 NF-04 卡片运行与第一阶段门槛

- EJS复用锁定原bundle和原handler/evaluate/variables/worldinfo闭包；装配时只改宿主导入与显式初始化，
  不运行其设置页、命令或编辑器启动。保留原worker/sandbox、全局→初始→聊天→当前swipe浅覆盖、permanent渲染和保存语义。
  EJS最终请求监听须先于项目memory/companion/story监听，不能把它放在注入之后。
- Helper复用当前卡片实际消费的变量、事件、脚本按钮、消息及世界书API实现，状态/持久化与消息渲染改接现有会话owner。
  变量更新前后仍捕获并复核F2来源；消息variables[swipe]、chat、character、global独立。React消息叶子不包含children，
  卡片运行模块独占该叶子的HTML/iframe生命周期；不复制原生消息树，也不加载原生设置控件。
  本批约3.6k行主要是原叶子源码：variables/message/worldbook对应初始化、更新/重演和存储；event/script/global/util对应原MVU入口、
  按钮与等待；predefine/尺寸/清理脚本对应真实iframe及既有配置；format/Markdown/AccountStorage/klona对应原正则显示、净化、
  外部媒体策略和变量克隆。新端口仅衔接这些消费者，不搬原生UI或新增通用兼容层。
- MVU继续运行现有锁定自托管脚本及生命周期补丁，不重写变量解析器或伪造Mvu对象。卡片iframe只加载卡片HTML/脚本，
  与完整ST页面隔离。以现有complex-card合成卡和受管场景验证InitVar→世界书/EJS→生成→MVU→面板→保存/刷新，
  再验下一轮EJS、编辑重处理与历史回放；门槛通过后继续NF-05。
- EJS在锁定bundle导入时还会注册SlashCommand对象。派生入口保留两个原回调，改为显式导出；设置API直接更新原存储键，
  不依赖原控件。worker仍用原EJS库和compileTemplate消息协议，补齐上游发布树缺失的资源，同时放到原生调用路径，
  避免同一设置在手机/原生宿主失效。受管原生场景实际编译并执行得到2，桌面真实请求启用worker+sandbox后仍正确读取变量。
- MVU `registerAsUniqueScript` 原来从 `#tavern_helper div[data-script-id]` 取有效实例。桌面派生物只将此输入改为真实脚本登记表，
  保留按注册集合过滤和最后有效实例选主；不强制should_enable。原生MVU路径和原生命周期补丁保留。
  Helper旧源码中的变量/事件/消息/世界书转换与iframe前导脚本保留；klona沿现有锁定2.0.6并附原MIT许可，无新增生产依赖。
- 六类变量实际保存并刷新验证：message/chat走F2，character/script走原角色卡，preset走原预设，global走原设置。
  脚本data/button/info仍回写所属原结构，配置写入排队且捕获原目标，不增加业务存储。旧异步消息变量结果仍由原source guard拒绝，
  回调带捕获的metadata归属；过期旧操作不能把新会话标成冲突，回归先RED再GREEN。切换前等待卡片渲染、配置写入和pagehide清理。
- 真实合成链：InitVar10→首轮15→刷新保持15→下一轮EJS条件生效且变量17→编辑后原按钮重处理19/false→下一轮EJS读取false→
  编辑旧楼层并按原“重演楼层”算法得到25→保存/刷新仍25。重处理/重演无额外模型请求；不以常量Mvu或模拟变量面板代替。
- React给卡片内容和操作栏各自提供无children槽位；修复直接挂到React父节点导致按钮在重绘时丢失的问题。
  原Markdown/净化算法及p/list/table基础规则迁入；异步内容撑高会使原简化pinned标记误脱离，几何回归先RED，
  改复用原nextFollow用户输入规则并观察真实尺寸。普通/复杂卡1440与390明暗均GREEN；真实wheel向上阅读后增长和停止不抢位置。
  `.review-queue/NF-04/` 保留8图，两次只读视觉复核均ship；MVU原有短暂加载提示可遮住部分标题，不据静态图宣称覆盖所有交互。
- 标准 `bash scripts/check.sh` 全部通过（38s，ST1044/1044，0 fail/skip）；受管catalog-admin+f2-chat-ui+nf-chat+nf-cards 4/4通过，普通聊天9组、
  复杂链、六作用域、原生worker与原生F2均通过；结果 `dev-managed/artifacts/accept-2026-11-03T09-42-33-284Z/results.json`。
  原生共享场景明确合成预设/世界书和EJS模式，避免继承提示词对照场景的setvar副作用；增加两页初始版本一致断言。
  入口延迟与4组新旧提示词另在 `accept-2026-11-03T09-59-03-766Z` 复验3/3通过，模型出站0。
  一次原生超时因观察中的Promise未及时接拒绝而跳过退出清理，已修复场景观察逻辑并定向回收仅属本轮的进程/容器/临时卷。
  所有失败保留原断言，未删测试/skip、未调用真实模型或通知、未部署。完整媒体/聊天操作和扩展设置继续NF-05–07；根入口尚未切换。


### 11.11 NF-05 聊天操作与媒体

- 唯一Session接入重新生成、继续、候选、编辑、删除、引用、复制、收藏/提醒和回应；操作直接调用owner，
  不模拟原生按钮。继续保留当前消息/候选身份；重新生成沿原语义替换末条；候选各自保存swipes、swipe_info、
  variables、来源、日期和生成信息。新候选先切上下文，再发原MESSAGE_SWIPED和生成钩子，保留真实MVU初始化。
  空响应/网络错误前恢复原候选；编辑冲突可复制完整拒绝快照；重试保持本次操作类型，草稿不被候选/媒体操作消耗。
- 编辑复用锁定ST updateMessage的正则、trim、宏与bias计算，沿原MESSAGE_EDITED/UPDATED、EJS渲染及F2保存。
  原始JSONL仍只由ST持有，Go不写聊天；每次动作只有一条现有生成流程。工具栏、Sheet、菜单和表情面板复用原React/Base UI。
  回应栏等到菜单公开onClosed再卸载，避免outside-press先移除节点而吃掉真实click。
- 历史按80条展开，原始聊天仍全量读取/保存；搜索主动展开全部历史。复用原ChatScroll的跳转、未读、日期、阅读位置、
  长回复落地与前插锚点，增加真实销毁契约；浮层挂到独占空槽位。浏览器自动锚定与自有补偿发生双重位移，
  已由自有控制器接管（overflow-anchor:none）；程序补偿不重新选择用户阅读锚点。End即使已经在底部也明确重新跟随，
  窗口变化不被当成用户向上滚动；浮钮用实际输入区高度定位，不遮挡停止按钮。
- 原分段/展开全文渲染在自有内容leaf中复用；卡片HTML仍由原formatter/EJS/iframe处理。
  图片、贴纸、语音条分别由独占leaf承载，复用原灯箱、表情目录、贴纸策略、VoiceBubble和单例播放器。
  语音策略和朗读校验捕获的chat、F2身份、message、candidate和source，切会话/编辑/切候选停止旧播放；
  录音安装器释放tracks/AudioContext/RAF/定时器/事件，销毁或切会话后迟到ASR不发送。
  语音状态使用既有saveChatConditional，生成中延迟到最终F2提交，避免改动正在出站的版本基线；旧轮nudge在异步语音前清理。
- 草稿继续使用既有vc-draft存储，桌面按account/avatar/file隔离；只在明确打开的会话迁入旧file-only键，
  避免同文件名的其他角色在列表遍历时提前领走旧草稿。会话列表通过原React视图显示当前作用域草稿。
- 受管nf-operations实际验证180条历史、前插锚定、全历史搜索、阅读位置恢复、重生成/继续/候选/编辑/删除/引用/复制、候选来源与变量、
  原草稿迁入/刷新及回应；收藏/提醒业务整合继续NF-08，不把本批未运行的交互算作通过。nf-media实际走合成TTS/ASR、真实MediaRecorder与16k mono PCM16、播放/倍速/转文字、
  朗读、受控PNG、灯箱和贴纸发送。PNG用固定320×240合成图，保持原8192上下文预算；没有为测试放宽预算。
  真实复杂卡在原完整链后补验候选25/31、来源切换、保存/刷新，已有候选切换不增加生成。
- 独立桌面最终结果：catalog-admin+nf-operations+nf-media+nf-cards 4/4通过，
  `dev-managed/artifacts/accept-2026-11-03T11-27-10-570Z/results.json`；普通聊天9组在
  `accept-2026-11-03T11-17-01-103Z`通过。共享原生voice-chat、voice-input、f2-chat-ui分别在
  `accept-2026-11-03T11-09-44-040Z`通过；该轮旧桌面候选的截图就绪问题已在最终独立场景修复和复验。
  标准bash scripts/check.sh 38s全部通过，ST1050/1050、0 fail/skip；新场景补入原注册表与其完整性断言，没有第二套编排。
- 视觉第一轮发现390输入区表情按钮缺少样式，另占26px灰行，麦克风bottom820超出textarea bottom794。
  原样式增加standalone作用域（原生/手机条件保留），并复用既有SMILE路径补齐sprite。
  新增按钮方形和严格框内几何，旧候选先RED、最终GREEN；390/1440明暗12张第二轮ship。
  `.review-queue/NF-05/`保留最终12图、两张修复前图和NOTES；静态图不冒充交互、音质或其他窗口验证。
- 本批未调用真实模型、通知或生产部署，无新增生产依赖。根路径仍为原生ST；设置和其余页面继续NF-06–08，
  手机明确宿主地址和根入口切换继续NF-10。仅清理本批已失效的重试产物，不动其他任务、共享缓存或现有基线。
