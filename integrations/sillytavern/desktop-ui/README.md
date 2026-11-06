# 桌面 React 应用

受管宿主在同源 `/` 和 `/desktop/` 提供电脑端 React 19 + TypeScript + Vite 应用，在同源 `/m/` 提供手机 React 入口（`mobile.html` → `src/mobile/app/main.tsx`）。SillyTavern 插件负责鉴权、注入会话身份 meta 并提供静态资源。桌面与手机共用 Go/ST 服务、独立引擎（`SessionBridge` 按需动态加载 `desktop/standalone/runtime.js`）和 F2 聊天存储。

## 代码边界

| 目录 | 职责 |
| --- | --- |
| `src/app/` | 电脑端启动、路由、Provider 与同意门禁接线 |
| `src/mobile/app/` | 手机入口启动与 `MobileApp` 壳装配（复用 `AppProviders` 与 `SessionBridge`） |
| `src/shell/` | 导航、极光、浮层宿主和离开保护。`useChrome.ts` 按 `744 / 1180 / 1600px` 切换四档桌面布局 |
| `src/design/` | 设计 token、分层 CSS 和 Base UI 控件皮肤。组件尺寸适配使用容器查询 |
| `src/features/` | 聊天、角色、记忆、陪伴、剧情及产品与酒馆设置 |
| `src/data/` | TanStack Query、API 接线、读写缓存与失效 |
| `src/runtime/` | SessionBridge 提供会话订阅与命令。`desktop/standalone/session.js` 持有消息、流式状态与 F2 保存 |
| `src/bridge/` | 原生 ST 的库模式挂载入口，为原生控制器与样板保留既有 48 个运行时导出 |

React 负责桌面页面和消息 DOM。`desktop/standalone/cards/` 负责 Helper / EJS / MVU iframe 与脚本生命周期，React 提供独立挂载节点。扩展纯逻辑和运行模块的导入由递归白名单测试约束。布局、色彩与交互沿用项目设计规范。[导入边界测试](../tests/desktop-import-boundary.test.mjs) · [DESIGN.md](../../../DESIGN.md)

## 扩展目录保留项

以下路径位于 `extension/vc-model-settings/desktop/`。原生扩展入口是 `../index.js`，UX-11 合成样板的入口是 `docs/product/v2-redesign/ux11/preview.js`。

| 文件 | 当前消费者 |
| --- | --- |
| `tavern-controller.js` | 桌面 `src/data/queries/tavern.ts`、`src/features/tavern/CodeField.tsx` |
| `tavern-defaults.js`、`tavern-fields.js` | `tavern-controller.js` 的默认数据和字段定义 |
| `notify.js` | 原生 `shell.js` 的收件箱角标和通知，样板 `settings-shell.js` 的通知权限 |
| `presentation.js` | 原生角色、记忆、收件箱与剧情控制器读取宿主布局 |
| `quick-switch.js` | 原生 `chat-view.js` 静态依赖，宽窗诊断和旧样板可挂载 |
| `status-card.js` | `shell.js` 的宽窗动态入口，UX-11 样板和独立状态卡单测 |
| `suggest.js` | 原生 `chat-react.js` 的回复建议，样板 `appearance.js` 的建议开关 |
| `transition.js` | 原生 `shell.js`、`chat-react.js`、`chat-search.js`、`lightbox.js` 的动效，以及 UX-11 样板 |
| `aurora.js`、`pointer-light.js` | UX-11 样板的极光和指针光，`aurora.js` 还由 `ambient.test.mjs` 消费 |
| `settings-shell.js` | UX-11 样板的设置入口与设置卸载单测 |
| `settings-voice.js`、`appearance.js` | `settings-shell.js` 的语音与外观分支，外观也用于旧 DR 对照 |
| `theme.js` | UX-11 样板、`appearance.js` 与新旧主题偏好兼容验证 |

`/native/` 固定使用原生手机布局，`nf-startup`、`f2-native` 和 `mb-engine` 覆盖其宿主行为。旧宽窗与 UX-11 样板保留的模块用于诊断和视觉对照。电脑端门禁走下面的 `dr2-*` 和 `nf-*` 场景。

## 构建与验证

从仓库根目录运行。首次准备需 Node 22.13+、本机 npm 依赖与锁定上游。[ST 集成说明](../README.md#首次准备)

```bash
npm --prefix integrations/sillytavern run check:desktop
npm --prefix integrations/sillytavern run build:desktop
npm --prefix integrations/sillytavern run test:desktop
bash scripts/check.sh
```

构建覆盖三份忽略的产物及其许可清单：桌面应用写到 `server-plugin/virtual-companion/desktop/app/`，手机入口写到 `server-plugin/virtual-companion/mobile/app/`，原生桥写到 `extension/vc-model-settings/desktop/build/index.js`，同时执行手机首屏静态依赖图体积预算门禁（JS gzip ≤ 300,000 bytes、CSS gzip ≤ 60,000 bytes）。受管装配会重建三者。直接跑离线 Node 单测前先构建。

运行 T11 整组时使用目标 worktree 的 `integrations/sillytavern/dev-managed/`，为栈分配独立端口和容器名。生成的 MemoryCore 模块从集成目录解析本地 npm 依赖。`catalog-admin` 由场景依赖自动补齐，总计 18 项。`nf-prompts` 包含正则参与实际生成的断言。`dr2-pages` 需要本机 `127.0.0.1:11438` 上的 `qwen3-embedding:0.6b`，`mb-engine` 需要同分支验收约定的手机 H5 产物。[受管验收说明](../README.md#受管端到端验收scriptsaccept-managedmjs)

```bash
node integrations/sillytavern/scripts/accept-managed.mjs --filter \
  dr2-layout,dr2-mvu-new,dr2-settings,dr2-pages,nf-startup,nf-desktop,nf-chat,nf-operations,nf-prompts,nf-cards,nf-media,nf-tavern,nf-business,nf-settings,f2-browser,f2-native,mb-engine
```

重采 T12 矩阵时用 `--filter dr2-layout --capture`，并以 `VC_DR2_REVIEW_DIR` 指定本轮目录。设置 `VC_DR2_REVIEW_STATE` 可只采某个状态。各轮结论见 [DR2 复审记录](../../../.review-queue/DR2/NOTES.md)。
