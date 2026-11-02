# 桌面主题

`base.css` 首先加载 `aurora.css`，保留已选的极光外观。`theme.js` 从注册表加载选中的主题；主题只覆盖语义变量，未覆盖的值沿用极光。布局、文案、业务流程和手机样式不随主题改变。

新增主题只需两个步骤：

1. 在本目录增加 `<id>.css`。所有规则限定 `html[data-vc-layout="desktop"][data-vc-theme-id="<id>"]`，仅声明自定义属性。分别提供默认浅色、`[data-vc-theme="dark"]`、自动深色的 `@media (prefers-color-scheme: dark)` 值。根元素和 `body.vc-ui` 都要声明：前者供视图过渡伪元素与 JS 动效读值，后者覆盖公共控件的变量。可以从 `aurora.css` 复制需要改的变量；不要写组件选择器。
2. 在 `index.js` 的 `DESKTOP_THEMES` 增加 `{ id, name, css: new URL('./<id>.css', import.meta.url).href, variants: { bubble: 'grouped' } }`。两种可用气泡变体为 `grouped`（相邻角收窄）和 `rounded`（完整圆角）。未知变体按默认值处理。

注册表超过一个主题后，设置 › 外观自动显示「主题」和「当前角色主题」。角色覆盖使用持久角色引用，进入对话生效，离开恢复全局。明暗模式沿用原 `data-vc-theme`，主题使用独立的 `data-vc-theme-id`。偏好目前集中保存在 `theme.js` 的本机存取函数中；移动端 MB-2 定下同步契约后替换该存取处。

切换时先加载新的 CSS，再改变主题属性、释放上一个主题样式；加载失败保留当前外观，快速连续选择只接受最后一次。默认极光使用 CSS import，不等待 JS 请求。桌面样式链接使用 `(min-width: 744px)` 媒体条件，保持手机原生控件的绘制不受影响。新增主题不注入任意 JS 或组件样式。

验证：`desktop-theme.test.mjs` 检查偏好规则与组件字面值；`desktop-theme-checks.mjs` 随受管 `vc-ui-shell` 验证第二主题、浅深与自动模式、角色覆盖、加载失败和快速切换。测试主题只来自合成路由，不进入产品注册表。
