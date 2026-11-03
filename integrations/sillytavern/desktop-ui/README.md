# 桌面自有界面

React + TypeScript + Vite。现有 ST 宿主、消息树、输入节点、角色卡脚本和生成链保持独立。

- 首次使用运行 `npm ci --prefix integrations/sillytavern --include=dev`。
- `npm --prefix integrations/sillytavern run check:desktop`：类型检查。
- `npm --prefix integrations/sillytavern run build:desktop`：构建同源 ES 模块到扩展 `desktop/build/`，同时写入实际打包依赖的许可；覆盖一份输出，不入库。
- `npm --prefix integrations/sillytavern test`：先构建再运行离线单测；直接运行 Node 单测前也须完成一次构建。
- 受管装配自动构建；在纯静态 UX-11 样板上调试前先构建。
- 通用交互先查 Base UI/shadcn/ui 官方组件和维护中的 GitHub 开源实现，现有库可满足时不自写键盘、焦点或弹层状态机。
- 沿用现有 `.vc-*` 类、语义 token 和素材。第一批 `Switch`/`Segment` 使用 Base UI，皮肤不重新定义；没有消费者的组件不引入。
- 业务设置通过页面 props 的动作调用原模块；组件只保留本次编辑/展示状态，不复制持久化状态或生成链。
- 现有壳在移除容器前调用挂载入口返回的卸载函数；同一子树只有一个渲染 owner。
- 有意视觉调整先出图并取得 Owner 确认；内部迁移用同数据、同视口前后对照。

公共壳层使用 Base UI Button / Avatar；侧栏采用 shadcn SidebarMenuButton / SidebarMenuBadge 的独立槽位组合，许可保留在 `THIRD_PARTY_LICENSES.txt`，构建时一并自托管。图标沿用原 Lucide sprite。

`mountSidebarView` 只渲染 `.vc-sidebar-content` 内部；选中镜片留在边界外，原控制器通过 props 同步选中、收展、未读与头像。设置分类、标题与保存动作由 `SettingsFrame` 管理，原控制器通过 props 更新；页面与宿主内容使用没有 React children 的独立槽位。禁止在这些 React 子树里用原生 DOM 更新角标或头像。

`dr-shell` 受管场景覆盖窗口断点、图标/头像中心、角标、模型页分类按钮和键盘导航。`--compare-reference` 严格比较正常 1440/390、侧栏悬停和宽屏模型页的全部像素；参照由固定旧 Git 代码生成，修复的 864 状态保留前后截图并校验几何关系。截图覆盖写入一套 `.review-queue/DR-4A/`。

计划见[后台重构计划](../../../docs/planning/2026-11-02-desktop-frontend-refactor-plan.md)，DR-1–DR-7及公共壳层已接入，DR-8汇总集成结果。

模型页由单一 `ModelPage` root 管理，业务控制器继续复用原API和model-logic。语音字段由共享 `VoiceForm` 管理；账户/数据/通知入口为 `SettingsOverview`，账户内容为 `AccountContents`，密码只从原生非受控表单读取并在结束时重置。分类切换、侧栏离开和销毁均先卸载相关root；禁止原生控制器写入其内部节点。

DR-4候选：`SettingsFrame`与`ShellFrame`管理自有导航、标题和公共容器；外部角色面板、搜索工具及ST正文各有无React children的明确槽位。搜索状态通过回调返回props，不能直接改写React拥有的节点。`AccountDialog`、`ConsentGate`、通用`AlertView`/`SheetView`消费Base UI Dialog/AlertDialog/Collapsible。`overlayMount`只桥接真实imperative消费者的React上下文，临时子确认随父层销毁；独立全屏账户页保持独立生命周期，被覆盖的共享设置Sheet通过库的open状态暂停交互。

`dr-overlays`沿用受管入口，冻结正常视觉并检查锚点、几何、焦点、返回、缩窗与宿主节点身份。旧桌面账户确认框的40px窄列属于已确认异常：旧图保留，候选验正确两列，其余正常图仍严格比较。菜单的物理像素取整和标准Tab离开已获Owner确认；41图及真实交互通过。独立root接入文档，imperative锚点的Tab只调用库公开close，不自写焦点循环。

DR-5候选：角色列表/详情与实例弹窗、人设编辑在`features/characters/`；记忆视图按`features/memory/`的Parts/List/Detail/Contents拆分，日记/收藏为实际复用的子视图。控制器继续负责数据与原API，表单经props同步，不重建输入或修补光标。页面栈在退出动画完成、删除节点之前卸载组件；普通页面也登记弹层owner，父root卸载会释放其未完成确认。

`dr-pages`调用真实生产挂载，预览只提供合成API和宿主边界。角色40对、记忆58对、陪伴64对共162对严格像素对照；输入/草稿、保存等待、跨断点焦点、短窗可达、子弹层销毁和内联按钮Esc有真实浏览器回归。陪伴列表/渠道/经典弹窗与验证内容位于`features/inbox/`；外部触发弹层以owner关联页面，host与opener各保留其原语义。DR-5本地候选完成。


聊天自有界面位于`features/chat/`，剧情、灯箱、贴纸设置及语音气泡位于`features/story/`。控制器只投影展示数据与原业务动作；ST消息、原生输入、脚本卡、媒体服务和生成链保留原owner。公共菜单/确认层经`overlayMount`进入实际父页面的React树，退出或宿主移除时卸载，不能直接改写React内部节点。

从仓库根目录运行下列既有场景；纯合成样板不访问11080。`--compare-reference`需要本worktree的`.review-queue/DR-*/`冻结旧源码/截图；缺失时不得用候选生成旧基线。所有对照使用原皮肤，无全局reset或默认组件库主题。

| 入口 | 范围 |
| --- | --- |
| `node integrations/sillytavern/scripts/desktop-appearance-accept.mjs --compare-reference` | 外观偏好、键盘与正常视觉 |
| `node integrations/sillytavern/scripts/desktop-shell-accept.mjs --compare-reference` | 三处对齐、收展、断点及125/150/200% CSS视口+DPR模拟 |
| `node integrations/sillytavern/scripts/desktop-models-accept.mjs --compare-reference` | 模型38图及保存/冲突/迟到响应 |
| `node integrations/sillytavern/scripts/desktop-settings-accept.mjs --compare-reference` | 设置84图及语音/账户/敏感操作 |
| `node integrations/sillytavern/scripts/desktop-overlays-accept.mjs --compare-reference` | 公共弹层41图、锚定/焦点/生命周期 |
| `node integrations/sillytavern/scripts/desktop-overlays-accept.mjs --chat-widgets --compare-reference` | 聊天自有控件96图、宿主节点与切会话边界 |
| `node integrations/sillytavern/scripts/desktop-pages-accept.mjs --feature all --compare-reference` | 角色/记忆/陪伴162图及实际操作 |
| `node integrations/sillytavern/scripts/desktop-pages-accept.mjs --feature rich --compare-reference` | 剧情/灯箱/贴纸/语音64图及首次展开、媒体清理 |

每批截图覆盖写一套after，before/reference不可覆盖。DR-6的ready参照固定补取完成及panel.refresh，原始诊断帧保留；公共壳层聊天对照复用该真实生产基线。刷新保留高亮已获Owner确认，4张建议回复帧另用accepted-selection，其余92张仍严格对原before；批准参照由冻结旧实现取得原皮肤的选中态，候选不补写选中。历史回放配对DR-7冻结的stickers.js与旧Sheet接口。DR-3历史语音截图只回放固定Git旧角色背景，交互前解除路由，角色生产页单独严格验证。不通过改文案、遮罩或阈值解决不同样板条件。

完整宿主走查仍使用`accept-managed.mjs --filter vc-ui-walkthrough`，需已安装的Chrome与隔离栈，覆盖360/390/768/1024/1280/1440明暗。走查产物从当前受管入口的`ctx.artifactsDir`取得位置，在同级`walkthrough-latest/`覆盖保留一套；不会写入另一worktree的运行目录。真实provider、TTS、通知、手工浏览器缩放及手机软键盘不由这些合成场景证明。
